#!/usr/bin/env node
// Renders sample Smart Marina Connect service e-mails to HTML + text files so they can be
// opened in a browser, and checks that the shared e-mail layout is identical everywhere.
//
//   node scripts/email-previews.mjs                 write the previews, then run the checks
//   node scripts/email-previews.mjs <folder>        same, into <folder>
//   node scripts/email-previews.mjs --check         checks only, writes nothing
//
// The previews are rendered by the REAL code of the edge functions (send-email,
// send-notification, claim-code-signup, contact-submit, guest-list, guest-webinar-register,
// guest-webinar-reminders, send-reference-email, send-status-notification, sp-notify,
// sponsor-invite, messages-digest and ops-health): their source is transpiled with the TypeScript compiler, the remote
// imports are cut and Deno, createClient and QRCode are stubbed, so nothing here can drift
// from what is deployed. Nothing is sent, nothing touches the network or the database.
// Sample data is fictional. (The QR code of the World Yachting Summit pass is drawn here with
// the local qrcode package, only so the preview shows an image; the function attaches its own.)
//
// Default folder: <home>/M3 Dropbox/Victor Meyer/MONACO MARINA MANAGEMENT/9 M3 Connect/
//                 Design/Propositions SMC/E-mails   (or EMAIL_PREVIEW_DIR)

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const checkOnly = args.includes("--check");
const folderArg = args.find((a) => !a.startsWith("--"));
const defaultOut = path.join(
  os.homedir(),
  "M3 Dropbox",
  "Victor Meyer",
  "MONACO MARINA MANAGEMENT",
  "9 M3 Connect",
  "Design",
  "Propositions SMC",
  "E-mails",
);
const outDir = path.resolve(folderArg || process.env.EMAIL_PREVIEW_DIR || defaultOut);

const failures = [];
const fail = (msg) => failures.push(msg);

// ---------------------------------------------------------------- shared layout block

const START = "// ---- SMC e-mail layout v1";
const END = "// ---- end SMC e-mail layout ----";
const layoutOf = (src) => {
  const a = src.indexOf(START);
  const b = src.indexOf(END);
  return a < 0 || b < 0 ? null : src.slice(a, b + END.length);
};

const reference = layoutOf(fs.readFileSync(path.join(root, "docs", "email-layout.ts"), "utf8"));
if (!reference) throw new Error("docs/email-layout.ts has no layout block");
// A backslash followed by u and a hex digit or a brace (written with fromCharCode so this file has none).
const hasBackslashU = (src) => {
  const needle = String.fromCharCode(92) + "u";
  for (let i = src.indexOf(needle); i >= 0; i = src.indexOf(needle, i + 1)) {
    if (/[0-9a-fA-F{]/.test(src[i + 2] || "")) return true;
  }
  return false;
};

const fnDir = path.join(root, "supabase", "functions");
// guest-list is frozen until 29 Nov 2026 (WYS): its copy of the block keeps the old gold
// accent and is not compared. Remove it from this set when guest-list is redeployed.
const FROZEN_LAYOUT = new Set(["guest-list"]);
const frozenSeen = [];
const withLayout = [];
const resendWithout = [];
for (const name of fs.readdirSync(fnDir).sort()) {
  const file = path.join(fnDir, name, "index.ts");
  if (!fs.existsSync(file)) continue;
  const src = fs.readFileSync(file, "utf8");
  const block = layoutOf(src);
  if (block) {
    withLayout.push(name);
    if (FROZEN_LAYOUT.has(name)) frozenSeen.push(name);
    else if (block !== reference) fail(`${name}: the SMC e-mail layout block differs from docs/email-layout.ts`);
    if (hasBackslashU(src)) fail(`${name}: contains a backslash-u escape (the MCP deploy mangles them)`);
    if (src.includes("api.resend.com") && !src.includes("reply_to")) fail(`${name}: sends through Resend without a reply_to`);
  } else if (src.includes("api.resend.com") && !name.startsWith("sm26-")) {
    resendWithout.push(name);
  }
}

// The unsubscribe token helper is pasted in send-notification and messages-digest (they
// sign) and unsubscribe (verifies): every copy must stay identical.
{
  const T_START = "// ---- SMC unsubscribe token v1";
  const T_END = "// ---- end SMC unsubscribe token ----";
  const tokenBlock = (fn) => {
    const src = fs.readFileSync(path.join(fnDir, fn, "index.ts"), "utf8");
    const a = src.indexOf(T_START);
    const b = src.indexOf(T_END);
    return a < 0 || b < 0 ? null : src.slice(a, b + T_END.length);
  };
  const sn = tokenBlock("send-notification");
  const un = tokenBlock("unsubscribe");
  const md = tokenBlock("messages-digest");
  if (!sn || !un) fail("unsubscribe token block missing from send-notification or unsubscribe");
  else if (sn !== un) fail("the unsubscribe token block differs between send-notification and unsubscribe");
  if (!md) fail("unsubscribe token block missing from messages-digest");
  else if (un && md !== un) fail("the unsubscribe token block differs between messages-digest and unsubscribe");
  if (hasBackslashU(fs.readFileSync(path.join(fnDir, "messages-digest", "index.ts"), "utf8"))) fail("messages-digest: contains a backslash-u escape (the MCP deploy mangles them)");
  if (hasBackslashU(fs.readFileSync(path.join(fnDir, "unsubscribe", "index.ts"), "utf8"))) fail("unsubscribe: contains a backslash-u escape (the MCP deploy mangles them)");
}

// ---------------------------------------------------------------- load the real code

function load(fn, names, env = {}) {
  let src = fs.readFileSync(path.join(fnDir, fn, "index.ts"), "utf8");
  src = src.replace(/^import .*$/gm, ""); // remote (esm.sh) imports: not needed to render
  const js = ts.transpileModule(src, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
  }).outputText;
  const Deno = { env: { get: (k) => env[k] }, serve() {} };
  const createClient = () => ({}); // a few functions build their client at the top level
  const QRCode = {};
  return new Function("Deno", "createClient", "QRCode", `${js}\nreturn { ${names.join(", ")} };`)(Deno, createClient, QRCode);
}

const auth = load("send-email", ["COPY", "buildEmail", "buildEmailText"]);
const notif = load("send-notification", ["renderNotification", "TYPE_TO_CATEGORY", "commentEmailData"]);
const claim = load("claim-code-signup", ["buildConfirmationEmail"]);
const status = load("send-status-notification", ["renderStatusEmail", "renderDecisionEmail", "DECISION_TYPES"]);
const contact = load("contact-submit", ["renderInboxEmail"]);
const refMail = load("send-reference-email", ["buildReferenceEmail"]);
const webReg = load("guest-webinar-register", ["buildConfirmationEmail"]);
const webRem = load("guest-webinar-reminders", ["buildReminderEmail"]);
const sponsorInvite = load("sponsor-invite", ["buildInviteEmail"]);
const spNotify = load("sp-notify", ["buildAssetNeededEmail"]);
const guestList = load("guest-list", ["renderPass", "renderInvitation", "renderRequestAck", "renderReject", "renderStaffNotice"]);
// Registration core (9 Oct 2026): registration, registration-cron, provision-person.
const reg = load("registration", [
  "ctxOf", "buildIcs", "checkAnswer", "renderWebinarConfirmed", "renderReceived", "renderWaitlisted", "renderAlreadyRegistered",
  "renderOnsiteConfirmed", "renderInfoRequested", "renderNotAccepted", "renderCancelled", "renderStatusLinks",
  "renderStaffNewRegistration", "renderStaffInfoProvided", "renderFloodAlert", "renderParityAck", "renderParityStaffNotice",
]);
const regCron = load("registration-cron", [
  "ctxOf", "durationMs", "remindersOf", "renderReminder", "renderFollowup", "renderReplayAvailable", "renderEventDigest", "renderReviewDigest", "signUnsubToken",
  // Registration Phase 3: the daily review digest by queue tab, and the notification outbox sender.
  "digestTotal", "normOrgName", "outboxDueAt", "outboxRequest", "heldNote", "OUTBOX_SENDERS",
]);
const provision = load("provision-person", ["renderAccountReady", "renderTeamMemberAdded"]);
const digest = load("messages-digest", ["renderDigest", "signUnsubToken"]);
// Registration Phase 2 (11 Oct 2026): account-signup, accept-invite (+ new send-notification types).
const acct = load("account-signup", ["renderAccountAlreadyExists", "renderEmailProof", "signInLinks", "typeLabel", "companyCard", "foldName", "significantLength"]);
const invite = load("accept-invite", ["renderInviteLink", "signInviteToken", "readInviteToken", "inviteTokenValid", "maskEmail", "fmtDay"]);
// Health monitor (16 Oct 2026): ops-health (staff alert only).
const ops = load("ops-health", ["renderAlert", "decideDue", "settingsOf", "projectUrl", "isMuted", "heartbeatDue"]);

// A token signed by send-notification verifies in the unsubscribe function, and a
// tampered or foreign one does not (sample key, nothing leaves this process).
{
  const signer = load("send-notification", ["signUnsubToken"]);
  const checker = load("unsubscribe", ["verifyUnsubToken"]);
  const key = "example-service-role-key";
  const uid = "00000000-0000-4000-8000-000000000001";
  const tok = await signer.signUnsubToken(key, uid, "b2b");
  const ok = await checker.verifyUnsubToken(key, tok);
  if (!ok || ok.userId !== uid || ok.category !== "b2b") fail("unsubscribe token: a fresh token does not verify");
  const [body, sig] = tok.split(".");
  // Change the FIRST character: all its 6 bits are signature bits. (The last base64url
  // character also carries padding bits, so changing it can decode to the same bytes.)
  const flipped = (sig[0] === "A" ? "B" : "A") + sig.slice(1);
  if (await checker.verifyUnsubToken(key, `${body}.${flipped}`)) fail("unsubscribe token: a tampered signature verifies");
  if (await checker.verifyUnsubToken("another-key", tok)) fail("unsubscribe token: a token verifies under another key");
  const forged = Buffer.from(JSON.stringify({ v: 1, u: "00000000-0000-4000-8000-000000000002", c: "all", iat: 1 })).toString("base64url");
  if (await checker.verifyUnsubToken(key, `${forged}.${sig}`)) fail("unsubscribe token: a swapped payload verifies");
  if (/[^A-Za-z0-9_.-]/.test(tok)) fail("unsubscribe token: not URL-safe");
  // The Friday digest signs its own links (category b2b): they must verify in the unsubscribe function.
  const dtok = await digest.signUnsubToken(key, uid, "b2b");
  const dok = await checker.verifyUnsubToken(key, dtok);
  if (!dok || dok.userId !== uid || dok.category !== "b2b") fail("unsubscribe token: a messages-digest token does not verify");
}

// ---------------------------------------------------------------- samples

const SITE = "https://smartmarinaconnect.com";
const items = [];

// Auth e-mails (Supabase Auth "Send Email" hook -> send-email)
{
  const en = auth.COPY.en;
  const add = (id, label, mail, to, o = {}) =>
    items.push({
      id,
      source: `send-email · ${label}`,
      to,
      subject: mail.subject,
      html: auth.buildEmail({ lang: "en", greeting: o.greeting ?? en.hello("Alex"), ...mail, buttonUrl: o.link, code: o.code }),
      text: auth.buildEmailText({ lang: "en", greeting: o.greeting ?? en.hello("Alex"), ...mail, buttonUrl: o.link, code: o.code }),
    });
  const hash = "EXAMPLE_TOKEN_HASH";
  add("auth-1-signup-confirmation", "signup", en.signup, "alex.martin@example.com", {
    link: `${SITE}/welcome?token_hash=${hash}&type=signup`,
  });
  add("auth-2-password-recovery", "recovery", en.recovery(true), "alex.martin@example.com", {
    link: `${SITE}/reset-password?token_hash=${hash}&type=recovery`,
  });
  add("auth-3-invite", "invite", en.invite, "new.colleague@example.com", {
    greeting: en.hello(""),
    link: `${SITE}/welcome?token_hash=${hash}&type=invite`,
  });
  add("auth-4-magic-link", "magiclink", en.magiclink, "alex.martin@example.com", {
    link: `https://example.supabase.co/auth/v1/verify?token=${hash}&type=magiclink&redirect_to=${encodeURIComponent(SITE)}`,
  });
  add("auth-5-email-change", "email_change (new address)", en.emailChangeNew("alex.new@example.com", true), "alex.new@example.com", {
    link: `https://example.supabase.co/auth/v1/verify?token=${hash}&type=email_change&redirect_to=${encodeURIComponent(SITE)}`,
  });
  add("auth-6-verification-code", "reauthentication", en.reauthentication, "alex.martin@example.com", { code: "482916" });
  items[items.length - 1].noButton = true; // a code to type, no link
}

// Notifications (send-notification)
{
  // send-notification signs a token for the recipient account (see the "unsubscribe"
  // function); the introduction (partner_request_accepted: two recipients and M3 in
  // copy) gets the plain page, which asks the reader to sign in.
  const unsub = (type) => (type === "partner_request_accepted" ? `${SITE}/unsubscribe` : `${SITE}/unsubscribe?t=EXAMPLE_PAYLOAD.EXAMPLE_SIGNATURE`);
  const add = (n, type, to, data, note) => {
    const r = notif.renderNotification(type, data, "", unsub(type));
    if (!r.html.includes(`href="${unsub(type)}"`)) fail(`notif ${type}: the footer Unsubscribe link is not the one given`);
    if (!r.text.includes(unsub(type))) fail(`notif ${type}: the text part has no unsubscribe link`);
    if (/unsubscribe\?email=/.test(r.html + r.text)) fail(`notif ${type}: an unsubscribe link still carries the address`);
    items.push({ id: `notif-${String(n).padStart(2, "0")}-${type.replace(/_/g, "-")}`, source: `send-notification · ${type}${note ? ` (${note})` : ""}`, to, ...r });
  };
  add(1, "event_registration_confirmed", "alex.martin@example.com", {
    first_name: "Alex", event_title: "Monaco Smart & Sustainable Marina Rendezvous 2027", event_date: "12 June 2027", event_location: "Grimaldi Forum, Monaco",
  });
  add(2, "partner_request_received", "camille.durand@example.com", {
    first_name: "Camille", partner_name: "Nautic Systems", message: "We would like to discuss shore power for your new pontoon. Could we schedule a call this month?",
  });
  add(3, "partner_request_accepted", "jordan.lee@example.com", {
    first_name: "Jordan Lee (Nautic Systems)", acceptor_name: "Camille Durand (Port Azur Marina)",
  }, "introduction, two recipients, CC");
  add(4, "webinar_accepted", "sam.rivera@example.com", { first_name: "Sam", title: "Shore power: lessons from three marinas" });
  add(5, "user_account_approved", "alex.martin@example.com", { first_name: "Alex", org_name: "Port Azur Marina" });
  add(6, "payment_confirmed", "alex.martin@example.com", { first_name: "Alex", amount: "€250.00", payment_type: "event_participation", transaction_id: "924529", event_title: "Example Marina Forum 2026" });
  add(7, "rfp_rejected", "camille.durand@example.com", { first_name: "Camille", title: "Fuel dock renovation", reason: "The scope is not detailed enough for partners to quote. Please add the dock length and the expected timeline." }, "reason note");
  add(8, "sponsorship_approved", "alex.martin@example.com", { first_name: "Alex", requested_tier: "Gold" }, "bullet list");
  add(9, "org_claim_code", "harbour.master@example.com", { first_name: "Marie", org_name: "Port Azur Marina", claim_code: "AZUR-7K2Q", email: "harbour.master@example.com" }, "code box");
  add(10, "partner_onboarding_welcome", "contact@example.com", { first_name: "Léa", email: "contact@example.com" }, "long, headed steps");
  add(11, "membership_payment_received", "admin@example.com", { amount: "€500", submitter: "Alex Martin", org_name: "Port Azur Marina", transaction_id: "TXN-EXAMPLE-0001" }, "admin, info table");
  add(12, "profile_reminder_verified_but_thin", "alex.martin@example.com", { first_name: "Alex" }, "reminder with bullets");
  add(13, "team_invitation", "new.colleague@example.com", { first_name: "Sam", org_name: "Port Azur Marina & Yacht Club", signup_url: `${SITE}/?signup=true&email=new.colleague%40example.com` }, "ampersand in a name");
  add(14, "payment_failed", "alex.martin@example.com", { first_name: "Alex", amount: "€250.00", event_title: "Example Marina Forum 2026" });
  // Registration Phase 2 (11 Oct 2026). join_url / expires_on are set by the function itself
  // (flag account_signup_v2, teamInvitationLink); the rest by authorizeResolvedSend.
  const joinUrl = `${SITE}/join/EXAMPLE_INVITE_TOKEN.EXAMPLE_SIGNATURE`;
  add(15, "team_invitation", "new.colleague@example.com", { first_name: "Sam", org_name: "Port Azur Marina & Yacht Club", join_url: joinUrl, expires_on: "10 November 2026" }, "new sign-up: /join/<token> link");
  add(16, "team_invitation_reminder", "new.colleague@example.com", { first_name: "Sam", org_name: "Port Azur Marina & Yacht Club", join_url: joinUrl, expires_on: "10 November 2026" }, "new sign-up: /join/<token> link");
  add(17, "team_join_request", "camille.durand@example.com", { first_name: "Camille", org_name: "Port Azur Marina", requester_name: "Sam Rivera", requester_email: "sam.rivera@example.com", requester_job: "Harbour master" }, "to the company owner");
  add("17b", "team_join_request", "camille.durand@example.com", { first_name: "Camille", org_name: "Port Azur Marina", requester_name: "Sam Rivera", requester_email: "sam.rivera@example.com", requester_job: "", requester_unproven: "yes" }, "requester address not proven (sent by M3 or the service)");
  add(18, "team_join_approved", "sam.rivera@example.com", { first_name: "Sam", org_name: "Port Azur Marina", org_verified: "yes" }, "company verified by M3");
  add("18b", "team_join_approved", "sam.rivera@example.com", { first_name: "Sam", org_name: "Harbourline & Sons", org_verified: "" }, "company not verified yet");
  add(19, "account_under_review", "alex.martin@example.com", { first_name: "Alex", review_path: "new", org_name: "Bluequay Energy", sla: "within 2 working days" }, "person + new company");
  add("19b", "account_under_review", "alex.martin@example.com", { first_name: "Alex", review_path: "join", org_name: "Port Azur Marina", sla: "within 2 working days" }, "asked to join a verified company");
  add("19c", "account_under_review", "alex.martin@example.com", { first_name: "Alex", review_path: "claim", org_name: "Port Azur Marina", sla: "within 2 working days" }, "asked to manage an ownerless company");
  add("19d", "account_under_review", "alex.martin@example.com", { first_name: "Alex", review_path: "none", org_name: "", sla: "within 2 working days" }, "no company");
  // Article comments (21 Oct 2026): every field is set by sendCommentEmails from the database
  // (resource_comment_email); comment_path is the article's address with the comment's anchor.
  const commentPath = "/resources/five-lessons-from-the-first-fully-connected-marina#comment-00000000-0000-4000-8000-0000000000c1";
  add(20, "comment_mention", "sam.rivera@example.com", {
    first_name: "Sam", author_name: "Alex Martin", author_org: "Port Azur Marina",
    article_title: "Five lessons from the first fully connected marina",
    excerpt: "Great read. @Sam Rivera, this is what we discussed in Monaco: @Nautic Systems fitted the shore power.",
    comment_path: commentPath,
  }, "tagged by name");
  add("20b", "comment_mention", "camille.durand@example.com", {
    first_name: "Camille", author_name: "Alex Martin", author_org: "Port Azur Marina", via_org: "Nautic Systems",
    article_title: "Five lessons from the first fully connected marina",
    excerpt: "Great read. @Sam Rivera, this is what we discussed in Monaco: @Nautic Systems fitted the shore power.",
    comment_path: commentPath,
  }, "a company tagged: to its owner");
  add(21, "comment_report", "staff@example.com", {
    first_name: "Victor", reporter_name: "Camille Durand", author_name: "Jordan Lee", author_org: "Harbourline Systems",
    article_title: "Five lessons from the first fully connected marina", reason: "Advertising for their own product.",
    excerpt: "Buy our berth sensors now, 30% off this week only!", open_reports: "1", comment_path: commentPath,
  }, "to the M3 team");
  // Every other notification type, with one generic set of fictional data (C4: a preview of
  // every e-mail the site can send).
  const generic = {
    first_name: "Alex", title: "Fuel dock renovation", event_title: "Marina Days 2027", event_date: "12 June 2027", event_location: "Grimaldi Forum, Monaco",
    org_name: "Port Azur Marina", partner_name: "Nautic Systems", marina_name: "Port Azur Marina", amount: "€500.00", invoice_ref: "INV-EXAMPLE-0042",
    payment_type: "sponsorship", transaction_id: "TXN-EXAMPLE-0001", reason: "The description is too short for partners to understand the need.",
    moderator_notes: "Clear topic, two speakers confirmed.", submitter: "Alex Martin", submission_type: "rfp", requested_tier: "Gold", deadline: "30 November 2026",
    details: "Shore power for 40 berths.", message: "Thank you for your interest.", requester_name: "Sam Rivera", requester_email: "sam.rivera@example.com",
    email: "alex.martin@example.com", confirmed_count: "3",
  };
  let n = 22;
  for (const type of Object.keys(notif.TYPE_TO_CATEGORY)) {
    if (items.some((i) => i.source.startsWith(`send-notification · ${type}`) && i.source.slice(`send-notification · ${type}`.length).match(/^( |$)/))) continue;
    add(n++, type, "alex.martin@example.com", generic, "generic sample data");
    items[items.length - 1].noButton = true; // some admin notices have no button
  }
}

// Other Resend senders (each has its own function)
const EXAMPLE_ID = "00000000-0000-4000-8000-000000000001";
const GUEST_TOKEN = "00000000-0000-4000-8000-000000000002";
const webinar = {
  id: "00000000-0000-4000-8000-0000000000aa",
  title: "Shore power: lessons from three marinas",
  description: null,
  date_time: "2027-02-18T14:00:00.000Z",
  end_date_time: "2027-02-18T15:00:00.000Z",
  location: null,
  event_type: "webinar",
  access_level: "public",
  invitation_only: false,
  published: true,
};
const wys = {
  id: "00000000-0000-4000-8000-0000000000bb",
  slug: "wys26",
  title: "World Yachting Summit 2026",
  capacity: 300,
  notify_email: "events@m3monaco.com",
  requests_open: true,
  settings: {
    tagline: "Where the yachting industry meets",
    date_label: "27 November 2026",
    venue: "Example Convention Centre",
    city: "Dubai",
    programme_note: "Doors open at 08:30. Business attire.",
  },
};
const wysGuest = {
  id: "00000000-0000-4000-8000-0000000000cc",
  first_name: "Alex",
  last_name: "Martin",
  email: "alex.martin@example.com",
  phone: "+33 6 00 00 00 00",
  company: "Port Azur Marina",
  job_title: "Harbour master",
  country: "France",
  motivation: "We are renewing our fuel dock and would like to meet suppliers.\nTwo colleagues may join if places allow.",
  wants_conference: true,
  wants_gala: true,
  conference: true,
  gala: true,
  plus_one_of: null,
  token: GUEST_TOKEN,
};
let wysQr = ""; // the pass e-mail points at an attachment (cid:entryqr); previews draw the code inline
try {
  const { default: QRCode } = await import("qrcode");
  wysQr = await QRCode.toDataURL(`${SITE}/admin/guest-list/wys26/checkin?token=${GUEST_TOKEN}`, { margin: 2, width: 480, errorCorrectionLevel: "M" });
} catch {
  /* no qrcode package: the preview keeps the cid reference */
}
{
  const add = (id, source, to, mail, o = {}) => items.push({ id, source, to, ...mail, ...o });
  const confirmLink = `${SITE}/welcome?token_hash=EXAMPLE_TOKEN_HASH&type=signup&next=${encodeURIComponent("/onboarding?code=AZUR-7K2Q")}`;

  add("wys-1-invitation", "guest-list · invitation (World Yachting Summit)", "alex.martin@example.com", guestList.renderInvitation(wys, wysGuest));
  add("wys-2-pass-with-qr", "guest-list · confirmation with entry QR (World Yachting Summit)", "alex.martin@example.com", guestList.renderPass(wys, wysGuest), {
    previewHtml: (html) => (wysQr ? html.replace("cid:entryqr", wysQr) : html),
  });
  add("wys-3-request-received", "guest-list · request acknowledgement", "alex.martin@example.com", guestList.renderRequestAck(wys, wysGuest), { noButton: true });
  add("wys-4-request-declined", "guest-list · request rejected", "alex.martin@example.com", guestList.renderReject(wys, wysGuest), { noButton: true });
  add("wys-5-staff-request", "guest-list · staff notification (new request)", "events@m3monaco.com", guestList.renderStaffNotice(wys, wysGuest));
  add(
    "wys-6-staff-plus-one",
    "guest-list · staff notification (plus-one, no motivation)",
    "events@m3monaco.com",
    guestList.renderStaffNotice(wys, { ...wysGuest, first_name: "Sam", last_name: "Rivera", email: "sam.rivera@example.com", motivation: "", wants_gala: false }, { ...wysGuest, first_name: "Alex" }),
  );

  add(
    "contact-1-alert-to-m3",
    "contact-submit · contact form alert to the M3 inbox",
    "events@m3monaco.com",
    contact.renderInboxEmail(
      { name: "Camille Durand", email: "camille.durand@example.com", company: "Port Azur Marina", subject: "partnership", message: "Hello,\n\nWe would like to discuss shore power for our new pontoon.\nCould we schedule a call this month?\n\nThank you,\nCamille", source: "/contact" },
      EXAMPLE_ID,
      "2026-10-08T09:41:00.000Z",
    ),
    { noButton: true },
  );

  add(
    "reference-1-confirm-recommendation",
    "send-reference-email · client recommendation to confirm",
    "pat.keller@example.com",
    refMail.buildReferenceEmail({
      recipientFirstName: "Pat",
      partnerLegalName: "Nautic Systems",
      referenceId: "REF-2026-000123",
      verificationCode: "482916",
      expiresAt: "22/10/2026, 12:00:00",
      recipientEmail: "pat.keller@example.com",
      clientLegalName: "Port Azur Marina & Yacht Club",
      clientCountry: "France",
      clientWebsite: "https://port-azur.example.com",
      signerName: "Pat Keller",
      signerTitle: "Technical director",
      projectName: "Shore power renewal, pontoons A to D",
      projectLocation: "Cannes",
      projectStartDate: "2025-09-01",
      projectEndDate: "2026-03-31",
      projectDeliveryDate: "2026-04-15",
      contractReference: "",
      solutionProduct: "Smart shore power pedestals",
      scopeDescription: "Supply and commissioning of 64 metered pedestals with remote monitoring.",
      resultsSummary: "Energy losses fell by a fifth and berth billing is now automatic.",
      keyKpis: "-21% losses, 64 berths metered, 0 downtime at cut-over",
      recommendationStatement: "Nautic Systems delivered on time and on budget and the team was a pleasure to work with.",
      confirmUrl: `${SITE}/reference/confirm?token=EXAMPLE_CONFIRM_TOKEN&ref=REF-2026-000123`,
      rejectUrl: `${SITE}/reference/reject?token=EXAMPLE_REJECT_TOKEN&ref=REF-2026-000123`,
    }),
    // The subject is built next to the Resend call in the function, not by the template.
    { subject: "Action required — Confirm a client recommendation (REF-2026-000123)" },
  );

  add("webinar-1-guest-confirmation", "guest-webinar-register · guest registration confirmation (.ics attached)", "sam.rivera@example.com", webReg.buildConfirmationEmail({ firstName: "Sam", event: webinar }));
  add("webinar-2-reminder", "guest-webinar-reminders · day-before reminder (.ics attached)", "sam.rivera@example.com", webRem.buildReminderEmail("Sam", webinar));

  add("account-1-claim-code-confirm", "claim-code-signup · confirm the e-mail address of a claim-code account", "harbour.master@example.com", claim.buildConfirmationEmail("en", "Marie", "Port Azur Marina & Yacht Club", confirmLink));
  add("account-2-status-approved", "send-status-notification · account approved", "alex.martin@example.com", status.renderStatusEmail("verified", "Alex", ""));
  add("account-3-status-rejected", "send-status-notification · application not approved, with reason", "camille.durand@example.com", status.renderStatusEmail("rejected", "Camille", "The profile does not describe the activity of the company yet.\nPlease add a short description and a website."));
  add("account-4-status-suspended", "send-status-notification · account suspended", "sam.rivera@example.com", status.renderStatusEmail("suspended", "Sam", ""));

  add("sponsor-1-portal-ready", "sponsor-invite · sponsorship portal ready (magic link)", "jordan.lee@example.com", sponsorInvite.buildInviteEmail("Jordan", "Nautic Systems", `https://example.supabase.co/auth/v1/verify?token=EXAMPLE_TOKEN&type=magiclink&redirect_to=${encodeURIComponent(SITE + "/welcome")}`));
  add("sponsor-2-asset-needed", "sp-notify · sponsor asset needed", "jordan.lee@example.com", spNotify.buildAssetNeededEmail("Nautic Systems", "Company logo (SVG, white version)", `${SITE}/account?tab=sponsorship`));

  // The Friday digest of company messages (messages-digest): no e-mail per message.
  const digestUnsub = `${SITE}/unsubscribe?t=EXAMPLE_PAYLOAD.EXAMPLE_SIGNATURE`;
  const longText = "Thank you for the quick answer. We can visit the marina on Tuesday morning to measure the pontoons and check the existing power cabinets, then send you a first estimate before the end of the month.";
  add("digest-1-messages-and-requests", "messages-digest · Friday digest (5 messages, 2 requests waiting)", "camille.durand@example.com", digest.renderDigest({
    firstName: "Camille",
    messageCount: 5,
    previews: [
      { name: "Jordan Lee", company: "Nautic Systems", text: longText.slice(0, 140) },
      { name: "Sam Rivera", company: "Harbourline & Sons", text: "Here is the brochure we mentioned. Happy to set up a call next week." },
      { name: "Jordan Lee", company: "Nautic Systems", text: "Do you have the plans of pontoon C?" },
    ],
    requestCount: 2,
    requests: [
      { name: "Léa Martin", company: "Bluequay Energy", text: "We install shore power for marinas of your size. Could we introduce our team?" },
      { name: "Pat Keller", company: "Tidewater Architects", text: "" },
    ],
  }, digestUnsub));
  add("digest-2-request-only", "messages-digest · Friday digest (one request, no message)", "alex.martin@example.com", digest.renderDigest({
    firstName: "",
    messageCount: 0,
    previews: [],
    requestCount: 1,
    requests: [{ name: "Jordan Lee", company: "Nautic Systems", text: "Hello, we would like to discuss smart berth sensors with your team." }],
  }, digestUnsub));
  for (const id of ["digest-1-messages-and-requests", "digest-2-request-only"]) {
    const it = items.find((x) => x.id === id);
    if (!it.html.includes(`href="${digestUnsub}"`) || !it.text.includes(digestUnsub)) fail(`${id}: the unsubscribe link is missing`);
    // /inbox, not /?open=inbox: signed out, /inbox asks to sign in first, then shows Messages.
    if (!it.html.includes(`href="${SITE}/inbox"`) || !it.text.includes(`${SITE}/inbox`) || it.html.includes('open=inbox')) fail(`${id}: the button does not open Messages (${SITE}/inbox)`);
  }
  if (items.find((x) => x.id === "digest-1-messages-and-requests").subject !== "This week you received 5 messages") fail("digest-1: unexpected subject");
}

// Registration core: registration, registration-cron, provision-person (fictional data).
const regWebinarEv = {
  id: "00000000-0000-4000-8000-0000000000d1", slug: "shore-power-webinar", title: "Shore power webinar", legacy_event_id: webinar.id,
  engine: "core_v2", kind: "webinar", registration_mode: "instant", hidden: false, reminders: [], settings: {},
  meeting_url: "https://meet.example.com/j/123456", replay_url: null, notify_email: "events@m3monaco.com", staff_alert_mode: "each", standard_fields: {},
};
const regOnsiteEv = {
  id: "00000000-0000-4000-8000-0000000000d2", slug: "marina-days-2027", title: "Marina Days 2027", legacy_event_id: "00000000-0000-4000-8000-0000000000d3",
  engine: "core_v2", kind: "onsite", registration_mode: "review", hidden: false, reminders: ["P7D"],
  settings: { practical_info: "Doors open at 08:30. Bring an ID.\nPublic parking on the quay." }, notify_email: "events@m3monaco.com", standard_fields: { company: "required" },
};
const regOnsiteCat = { id: "00000000-0000-4000-8000-0000000000d3", title: "Marina Days 2027", date_time: "2027-03-11T08:30:00.000Z", end_date_time: "2027-03-11T17:00:00.000Z", is_full_day: false, location: "Port Hercule, Monaco", published: true };
const regGuest = {
  id: "00000000-0000-4000-8000-0000000000d4", first_name: "Sam", last_name: "Rivera", email: "sam.rivera@example.com", company: "Nautic Systems",
  job_title: "Sales manager", phone: "+33 6 00 00 00 01", country: "France", status: "confirmed", source: "registration", ticket_key: null,
  answers: { objective: "Meet marinas renewing their shore power", sectors: ["energy"] }, info_request: "Could you tell us which marina you work with?",
  checkin_token: "00000000-0000-4000-8000-0000000000d5", user_id: null,
};
const regQuestions = [
  { key: "objective", label: "What would you like to get from the day?", kind: "textarea" },
  { key: "sectors", label: "Sectors", kind: "sectors" },
];
const STATUS_LINK = `${SITE}/registration?t=EXAMPLE_STATUS_TOKEN_EXAMPLE_STATUS_TOKEN_123`;
const sampleDigest = {
  tabs: [
    { label: "People & companies", count: 8, oldestDays: 6, detail: "5 people, 2 companies, 1 company claim", url: `${SITE}/admin/review` },
    { label: "Event registrations", count: 6, oldestDays: 3, detail: "2 events, 1 waiting for an answer", url: `${SITE}/admin/review` },
    { label: "Team joins", count: 2, oldestDays: null, detail: "", url: `${SITE}/admin/review`, fyi: "new in the last 24 hours" },
    { label: "Duplicates", count: 1, oldestDays: null, detail: "possible duplicate companies, e.g. Port Azur Marina / Port Azur Marina SAS", url: `${SITE}/admin/review`, fyi: "to check" },
  ],
  registrations: [
    { title: "World Yachting Summit 2026", slug: "wys26", requested: 4, needs_info: 0, oldestDays: 3, url: `${SITE}/admin/guest-list/wys26` },
    { title: "Marina Days 2027", slug: "marina-days-2027", requested: 2, needs_info: 1, oldestDays: 1, url: `${SITE}/admin/events/00000000-0000-4000-8000-0000000000d3` },
  ],
  provisioning: { failed: 1, queued: 0 },
  emails: { gaveUp: 2, gaveUpRecent: 1, held: 2 },
};
{
  const add = (id, source, to, mail, o = {}) => items.push({ id, source, to, ...mail, ...o });
  const wctx = reg.ctxOf(regWebinarEv, { ...webinar, id: webinar.id });
  const octx = reg.ctxOf(regOnsiteEv, regOnsiteCat);
  const qrPreview = (html) => (wysQr ? html.replace("cid:passqr", wysQr) : html);
  add("reg-01-webinar-confirmed", "registration · webinar registration confirmed (.ics attached)", regGuest.email, reg.renderWebinarConfirmed(wctx, regGuest, { status: STATUS_LINK, join: regWebinarEv.meeting_url }));
  add("reg-02-received", "registration · registration received (M3 review)", regGuest.email, reg.renderReceived(octx, { ...regGuest, status: "requested" }, { status: STATUS_LINK }, "within 2 working days"));
  add("reg-03-request-received", "registration · invitation request received", regGuest.email, reg.renderReceived(octx, { ...regGuest, status: "requested", source: "request" }, { status: STATUS_LINK }, "within 2 working days"));
  add("reg-04-waitlisted", "registration · waiting list", regGuest.email, reg.renderWaitlisted(wctx, { ...regGuest, status: "waitlisted" }, { status: STATUS_LINK }));
  add("reg-05-already-registered", "registration · already registered (same public answer)", regGuest.email, reg.renderAlreadyRegistered(wctx, regGuest, { status: STATUS_LINK }));
  add("reg-06-onsite-confirmed", "registration · on-site place confirmed, entry QR (staff decision)", regGuest.email, reg.renderOnsiteConfirmed(octx, regGuest, { status: STATUS_LINK, ticket: "Visitor" }), { previewHtml: qrPreview });
  add("reg-07-info-requested", "registration · M3 needs a detail", regGuest.email, reg.renderInfoRequested(octx, { ...regGuest, status: "needs_info" }, { status: STATUS_LINK }, regGuest.info_request));
  add("reg-08-not-accepted", "registration · not accepted", regGuest.email, reg.renderNotAccepted(octx, { ...regGuest, status: "rejected" }));
  add("reg-09-cancelled", "registration · cancelled by the person", regGuest.email, reg.renderCancelled(wctx, { ...regGuest, status: "cancelled" }));
  add("reg-10-status-links", "registration · Get my links (two events)", regGuest.email, reg.renderStatusLinks("Sam", [
    { title: wctx.title, when: "Thursday 18 February 2027, 15:00–16:00 (CET)", url: STATUS_LINK, label: "View my registration" },
    { title: "World Yachting Summit 2026", when: "27 November 2026", url: `${SITE}/wys26/guest?t=${GUEST_TOKEN}`, label: "View my request" },
  ]), { noButton: true });
  add("reg-11-staff-new", "registration · staff alert, new registration", "events@m3monaco.com", reg.renderStaffNewRegistration(octx, { ...regGuest, status: "requested" }, regQuestions, "Visitor"));
  add("reg-12-staff-info", "registration · staff alert, information provided (answer + changed details)", "events@m3monaco.com", reg.renderStaffInfoProvided(octx, { ...regGuest, status: "requested" }, regQuestions, null, { answer: "We work with Port Azur Marina, I manage their shore power project.", changed: ["Company", "What would you like to get from the day?"] }));
  add("reg-12b-staff-info-unchanged", "registration · staff alert, information provided (details confirmed as they are)", "events@m3monaco.com", reg.renderStaffInfoProvided(octx, { ...regGuest, status: "requested" }, regQuestions, null));
  add("reg-13-flood", "registration · staff alert, unusual activity", "events@m3monaco.com", reg.renderFloodAlert(wctx, 57));
  add("reg-14-wys-parity-ack", "registration · wys26 request acknowledgement (parity, + View my request)", wysGuest.email, reg.renderParityAck(wys, wysGuest));
  add("reg-15-wys-parity-staff", "registration · wys26 staff notification (parity)", "events@m3monaco.com", reg.renderParityStaffNotice(wys, wysGuest));

  const unsubAccount = { label: "Unsubscribe from event e-mails", url: `${SITE}/unsubscribe?t=EXAMPLE_PAYLOAD.EXAMPLE_SIGNATURE` };
  const unsubGuest = { label: "Stop e-mails about this event", url: `${STATUS_LINK}&reminders=off` };
  const cw = regCron.ctxOf(regWebinarEv, { ...webinar });
  const co = regCron.ctxOf(regOnsiteEv, regOnsiteCat);
  add("cron-1-reminder-7-days", "registration-cron · webinar reminder 7 days before", regGuest.email, regCron.renderReminder(cw, regGuest, { key: "P7D", ms: 7 * 86400000 }, { status: STATUS_LINK, join: regWebinarEv.meeting_url, qr: false, optOut: unsubGuest }));
  add("cron-2-reminder-1-day", "registration-cron · webinar reminder the day before (join link)", regGuest.email, regCron.renderReminder(cw, regGuest, { key: "P1D", ms: 86400000 }, { status: STATUS_LINK, join: regWebinarEv.meeting_url, qr: false, optOut: unsubAccount }));
  add("cron-3-reminder-1-hour", "registration-cron · webinar reminder 1 hour before (join link)", regGuest.email, regCron.renderReminder(cw, regGuest, { key: "PT1H", ms: 3600000 }, { status: STATUS_LINK, join: regWebinarEv.meeting_url, qr: false, optOut: unsubGuest }));
  add("cron-4-reminder-onsite", "registration-cron · on-site reminder 7 days before (practical information, QR)", regGuest.email, regCron.renderReminder(co, regGuest, { key: "P7D", ms: 7 * 86400000 }, { status: STATUS_LINK, join: null, qr: true, optOut: unsubGuest }), { previewHtml: qrPreview });
  add("cron-5-followup-replay", "registration-cron · absentee follow-up with the replay", regGuest.email, regCron.renderFollowup(cw, regGuest, { replay: "https://replay.example.com/shore-power", attendanceKnown: true, optOut: unsubGuest }));
  add("cron-6-followup-no-replay", "registration-cron · absentee follow-up, no replay yet", regGuest.email, regCron.renderFollowup(cw, regGuest, { replay: null, attendanceKnown: true, optOut: unsubAccount }));
  add("cron-7-replay-everyone", "registration-cron · replay available (attendance not recorded)", regGuest.email, regCron.renderFollowup(cw, regGuest, { replay: "https://replay.example.com/shore-power", attendanceKnown: false, optOut: unsubGuest }));
  add("cron-8-replay-available", "registration-cron · replay added after the follow-up", regGuest.email, regCron.renderReplayAvailable(cw, regGuest, { replay: "https://replay.example.com/shore-power", optOut: unsubGuest }));
  add("cron-9-event-digest", "registration-cron · staff digest of new registrations (event in digest mode)", "events@m3monaco.com", regCron.renderEventDigest(co, [
    { first_name: "Sam", last_name: "Rivera", company: "Nautic Systems", status: "requested" },
    { first_name: "Alex", last_name: "Martin", company: "Port Azur Marina", status: "confirmed" },
  ], 2));
  add("cron-10-review-digest", "registration-cron · M3 daily review digest (queue tabs)", "events@m3monaco.com", regCron.renderReviewDigest(sampleDigest));
  add("account-5-ready-set-password", "provision-person · account created at confirmation (set password)", regGuest.email, provision.renderAccountReady("Sam", "Marina Days 2027", `${SITE}/welcome?token_hash=EXAMPLE_TOKEN_HASH&type=invite&next=%2Fdashboard`));
  add("account-5b-ready-after-pass", "provision-person · account e-mail one minute after the World Yachting Summit QR e-mail", wysGuest.email, provision.renderAccountReady(wysGuest.first_name, "World Yachting Summit 2026", `${SITE}/welcome?token_hash=EXAMPLE_TOKEN_HASH&type=recovery&next=%2Fdashboard`, true));
  // Registration Phase 3: decisions of the M3 review queue (send-status-notification, sent
  // by the notification outbox of registration-cron).
  const dec = (type, f) => status.renderDecisionEmail(type, { firstName: "Alex", orgName: "", orgVerified: false, note: "", ...f });
  add("decision-1-approved-member", "send-status-notification · user_account_approved, member of a validated company", "alex.martin@example.com", dec("user_account_approved", { orgName: "Port Azur Marina & Yacht Club", orgVerified: true }));
  add("decision-2-approved-participant", "send-status-notification · user_account_approved, participant (no validated company)", "alex.martin@example.com", dec("user_account_approved", {}));
  add("decision-3-rejected", "send-status-notification · user_account_rejected, with reason and Ask M3 to review again", "camille.durand@example.com", dec("user_account_rejected", { firstName: "Camille", note: "We could not link this account to a company of the marina sector.\nAdd your company website to your profile." }));
  add("decision-4-info-requested", "send-status-notification · account_info_requested", "sam.rivera@example.com", dec("account_info_requested", { firstName: "Sam", note: "Which marina or company do you work for? A website is enough." }));
  add("decision-5-company-validated", "send-status-notification · company_validated", "camille.durand@example.com", dec("company_validated", { firstName: "Camille", orgName: "Harbourline & Sons", orgVerified: true }));
  add("decision-6-claim-approved", "send-status-notification · claim_approved (verified company)", "harbour.master@example.com", dec("claim_approved", { firstName: "Marie", orgName: "Port Azur Marina & Yacht Club", orgVerified: true }));
  add("decision-7-claim-declined", "send-status-notification · claim_declined, with a note", "jordan.lee@example.com", dec("claim_declined", { firstName: "Jordan", orgName: "Port Azur Marina & Yacht Club", orgVerified: true, note: "The marina already has a manager on the platform." }));
  add("account-6-team-member-added", "provision-person · FYI to the company owner", "camille.durand@example.com", provision.renderTeamMemberAdded("Camille", "Sam Rivera", regGuest.email, "Port Azur Marina & Yacht Club", "Marina Days 2027"));

  // Registration Phase 2: account-signup and accept-invite (fictional data).
  add("account-7-already-exists", "account-signup · sign-up tried with the address of an existing account", "alex.martin@example.com", acct.renderAccountAlreadyExists("Alex", acct.signInLinks(SITE)));
  add("account-8-email-proof", "account-signup · confirm your e-mail address (dashboard banner)", "alex.martin@example.com", acct.renderEmailProof("alex.martin@example.com", `${SITE}/verify-email?t=EXAMPLE_PROOF_TOKEN_EXAMPLE_PROOF_TOKEN_1234567`));
  add("account-9-invite-link", "accept-invite · fresh invitation link asked from an older e-mail", "new.colleague@example.com", invite.renderInviteLink("Sam", "Port Azur Marina & Yacht Club", true, `${SITE}/join/EXAMPLE_INVITE_TOKEN.EXAMPLE_SIGNATURE`, "10 November 2026"));
  add("account-9b-invite-link", "accept-invite · fresh invitation link, company not verified by M3 (no name typed by its owner)", "new.colleague@example.com", invite.renderInviteLink("Sam", "Harbourline & Sons", false, `${SITE}/join/EXAMPLE_INVITE_TOKEN.EXAMPLE_SIGNATURE`, "10 November 2026"));
}

// Health monitor alert (ops-health): staff only, fictional problems.
{
  const add = (id, source, to, mail) => items.push({ id, source, to, ...mail });
  const when = new Date("2026-11-27T05:00:00Z");
  const cta = ops.projectUrl("https://exampleref.supabase.co", SITE);
  const due = [
    { check_id: "wys.pass_missing", area: "guest list", status: "fail", summary: "2 confirmed guest(s) without a QR e-mail logged (wys26): resend the pass." },
    { check_id: "reg.provisioning", area: "registration", status: "warn", summary: "3 guest(s) wait for the \"choose your password\" e-mail: switch provisioning is OFF." },
  ];
  const others = [{ check_id: "security.open_functions", area: "security", status: "warn", summary: "2 internal function(s) anyone can run through the API." }];
  add("ops-1-health-alert", "ops-health · problems found (at most once per problem per 6 h)", "events@m3monaco.com", ops.renderAlert({ due, others, when, realertHours: 6, ctaUrl: cta }));
  add("ops-2-health-test", "ops-health · test e-mail ({\"test\": true}), nothing wrong", "events@m3monaco.com", ops.renderAlert({ due: [], others: [], when, realertHours: 6, ctaUrl: cta, test: true }));
}

// ---------------------------------------------------------------- checks on what was rendered

for (const it of items) {
  const where = it.id;
  if (/undefined|NaN|\[object/.test(it.html.replace(/<style[\s\S]*?<\/style>/, ""))) fail(`${where}: html contains undefined/NaN/[object]`);
  if (/undefined|NaN|\[object/.test(it.text)) fail(`${where}: text contains undefined/NaN/[object]`);
  for (const m of it.html.matchAll(/href="([^"]*)"/g)) {
    if (!/^(https:\/\/|mailto:)/.test(m[1])) fail(`${where}: unexpected link ${m[1]}`);
  }
  if (!it.html.includes("events@m3monaco.com")) fail(`${where}: footer contact missing`);
  if (!it.html.includes("logo-white.png")) fail(`${where}: logo missing`);
  if (!it.text.includes("Questions? events@m3monaco.com")) fail(`${where}: text footer missing`);
  const cta = it.html.match(/<a href="([^"]+)" target="_blank" style="display:inline-block;padding:14px 28px/);
  if (!cta && !it.noButton) fail(`${where}: no button`);
  else if (cta && !it.text.includes(cta[1].replace(/&amp;/g, "&"))) fail(`${where}: the button link is missing from the text part`);
}

// Untrusted values must never turn into markup.
{
  const evil = notif.renderNotification(
    "webinar_accepted",
    { first_name: '"><b id=x>', title: "<img src=x onerror=alert(1)>" },
    "",
    `${SITE}/unsubscribe`,
  );
  if (/<img src=x|<b id=x/.test(evil.html)) fail("escaping: notification data reached the HTML as markup");
  const bad = '"><b id=x>';
  const evilImg = "<img src=x onerror=alert(1)>";
  const spoiled = (html) => /<img src=x|<b id=x|<script|<s>x/.test(html.replace(/<style[\s\S]*?<\/style>/, ""));
  const evils = {
    "send-status-notification": status.renderStatusEmail("rejected", bad, evilImg).html,
    "contact-submit": contact.renderInboxEmail({ name: bad, email: "a@example.com", company: evilImg, subject: "other", message: `${evilImg}\n<script>x</script>`, source: bad }, evilImg, "2026-10-08T09:41:00.000Z").html,
    "claim-code-signup": claim.buildConfirmationEmail("en", "Marie", "<script>x</script>", `${SITE}/?a=1&b="${bad}"`).html,
    "guest-list": guestList.renderPass({ ...wys, title: `${evilImg} Summit`, settings: { ...wys.settings, venue: bad, programme_note: evilImg } }, { ...wysGuest, first_name: bad }).html +
      guestList.renderStaffNotice(wys, { ...wysGuest, first_name: bad, motivation: evilImg, company: bad }).html,
    "guest-webinar-register": webReg.buildConfirmationEmail({ firstName: bad, event: { ...webinar, title: evilImg } }).html,
    "guest-webinar-reminders": webRem.buildReminderEmail(bad, { ...webinar, title: evilImg }).html,
    "send-reference-email": refMail.buildReferenceEmail({
      recipientFirstName: bad, partnerLegalName: evilImg, referenceId: bad, verificationCode: bad, expiresAt: bad, recipientEmail: bad,
      clientLegalName: evilImg, clientCountry: bad, clientWebsite: evilImg, signerName: bad, signerTitle: evilImg, projectName: bad,
      projectLocation: bad, projectStartDate: bad, projectEndDate: bad, projectDeliveryDate: bad, contractReference: bad, solutionProduct: bad,
      scopeDescription: evilImg, resultsSummary: evilImg, keyKpis: bad, recommendationStatement: evilImg, confirmUrl: `${SITE}/?a=1&b="${bad}"`, rejectUrl: `${SITE}/?c=2`,
    }).html,
    "sponsor-invite": sponsorInvite.buildInviteEmail(bad, evilImg, `${SITE}/?a=1&b="${bad}"`).html,
    "sp-notify": spNotify.buildAssetNeededEmail(bad, evilImg, `${SITE}/?a=1&b="${bad}"`).html,
    "messages-digest": digest.renderDigest({
      firstName: bad, messageCount: 2, previews: [{ name: bad, company: evilImg, text: `${evilImg} <script>x</script>` }],
      requestCount: 1, requests: [{ name: evilImg, company: bad, text: evilImg }],
    }, `${SITE}/unsubscribe?t=a"${bad}`).html,
  };
  for (const [fn, html] of Object.entries(evils)) if (spoiled(html)) fail(`escaping: ${fn} let a typed value reach the HTML as markup`);

  // What the World Yachting Summit pass promises must stay in the function: the inline QR
  // is the attachment with content id "entryqr", plus the same image as a file.
  const glSrc = fs.readFileSync(path.join(fnDir, "guest-list", "index.ts"), "utf8");
  if (!glSrc.includes('content_id: "entryqr"') || !glSrc.includes('filename: "entry-pass.png"')) fail("guest-list: the QR attachments (entryqr, entry-pass.png) are no longer sent");
  const pass = items.find((i) => i.id === "wys-2-pass-with-qr");
  if (pass && !pass.html.includes('src="cid:entryqr"')) fail("wys-2-pass-with-qr: the inline QR reference (cid:entryqr) is gone");

  const evilAuth = auth.buildEmail({ lang: "en", greeting: "<i>Hi</i>", ...auth.COPY.en.emailChangeNew("<s>x</s>@example.com", false), buttonUrl: `${SITE}/?a=1&b="2"` });
  if (/<s>x|<i>Hi/.test(evilAuth)) fail("escaping: auth e-mail values reached the HTML as markup");
}

// ---------------------------------------------------------------- registration core checks
{
  // The unsubscribe token block pasted in registration-cron is identical to the
  // unsubscribe function's, and a token it signs verifies there.
  const T_START = "// ---- SMC unsubscribe token v1";
  const T_END = "// ---- end SMC unsubscribe token ----";
  const blockOf = (fn) => {
    const src = fs.readFileSync(path.join(fnDir, fn, "index.ts"), "utf8");
    const a = src.indexOf(T_START);
    const b = src.indexOf(T_END);
    return a < 0 || b < 0 ? null : src.slice(a, b + T_END.length);
  };
  for (const fn of ["registration-cron"]) {
    const block = blockOf(fn);
    if (!block) fail(`${fn}: the unsubscribe token block is missing`);
    else if (block !== blockOf("unsubscribe")) fail(`${fn}: the unsubscribe token block differs from the unsubscribe function`);
  }
  const checker = load("unsubscribe", ["verifyUnsubToken"]);
  const key = "example-service-role-key";
  const uid = "00000000-0000-4000-8000-000000000009";
  const tok = await regCron.signUnsubToken(key, uid, "events");
  const ok = await checker.verifyUnsubToken(key, tok);
  if (!ok || ok.userId !== uid || ok.category !== "events") fail("registration-cron: its unsubscribe token does not verify in the unsubscribe function");

  // wys26 parity: the staff notice is guest-list's, byte for byte; the acknowledgement is
  // guest-list's plus the "View my request" button to the personal link.
  // Until guest-list is redeployed (after 29 Nov) its frozen copy keeps the old gold accent:
  // compare with the accent colour aligned. Drop acc() once FROZEN_LAYOUT is empty.
  const acc = (h) => (FROZEN_LAYOUT.has("guest-list") ? h.replaceAll("#7cc4f0", "#d7a647") : h);
  const glNotice = guestList.renderStaffNotice(wys, wysGuest);
  const pNotice = reg.renderParityStaffNotice(wys, wysGuest);
  if (glNotice.subject !== pNotice.subject || glNotice.html !== acc(pNotice.html) || glNotice.text !== pNotice.text) fail("registration: the wys26 staff notice differs from guest-list's");
  const plusHost = { ...wysGuest, first_name: "Alex" };
  const plusRow = { ...wysGuest, first_name: "Sam", last_name: "Rivera", email: "sam.rivera@example.com", motivation: "" };
  if (guestList.renderStaffNotice(wys, plusRow, plusHost).html !== acc(reg.renderParityStaffNotice(wys, plusRow, plusHost).html)) fail("registration: the wys26 plus-one staff notice differs from guest-list's");
  const glAck = guestList.renderRequestAck(wys, wysGuest);
  const pAck = reg.renderParityAck(wys, wysGuest);
  const personal = `${SITE}/wys26/guest?t=${GUEST_TOKEN}`;
  if (glAck.subject !== pAck.subject) fail("registration: the wys26 acknowledgement subject differs from guest-list's");
  if (pAck.text.replace(`View my request: ${personal}\n\n`, "") !== glAck.text) fail("registration: the wys26 acknowledgement text differs from guest-list's (apart from the button)");
  if (!pAck.html.includes(`href="${personal}"`)) fail("registration: the wys26 acknowledgement has no View my request link");

  // The staff alert of an answered question carries the answer and what changed.
  {
    const it = items.find((i) => i.id === "reg-12-staff-info");
    if (!it || !it.html.includes("Port Azur Marina, I manage") || !it.text.includes("Their answer:") || !it.text.includes("Details changed: Company")) fail("reg-12-staff-info: the answer or the changed details are missing");
    const un = items.find((i) => i.id === "reg-12b-staff-info-unchanged");
    if (!un || !un.text.includes("No details were changed.")) fail("reg-12b-staff-info-unchanged: no 'No details were changed.' line");
  }

  // No status token, QR or personal link in a subject line.
  for (const it of items.filter((i) => /^(reg|cron|account-5|account-6)-/.test(i.id))) {
    if (/registration\?t=|guest\?t=|token|EXAMPLE_/i.test(it.subject)) fail(`${it.id}: a link or token in the subject`);
  }
  // Reminders and follow-ups carry an opt-out link; transactional mails do not.
  for (const it of items.filter((i) => i.id.startsWith("cron-") && !/digest/.test(i.id))) {
    if (!/Unsubscribe from event e-mails|Stop e-mails about this event/.test(it.html) || !/unsubscribe|reminders=off/.test(it.text)) fail(`${it.id}: no opt-out link`);
  }
  for (const id of ["reg-06-onsite-confirmed", "cron-4-reminder-onsite"]) {
    const it = items.find((i) => i.id === id);
    if (it && !it.html.includes('src="cid:passqr"')) fail(`${id}: the inline QR reference (cid:passqr) is gone`);
  }
  for (const id of ["reg-01-webinar-confirmed", "cron-2-reminder-1-day", "cron-3-reminder-1-hour"]) {
    const it = items.find((i) => i.id === id);
    if (it && !it.html.includes("https://meet.example.com/j/123456")) fail(`${id}: the join link is missing`);
  }

  // Durations of gl_event.reminders, default reminders, answers, calendar file.
  const D = 86400000;
  const durations = { P7D: 7 * D, P1D: D, PT1H: 3600000, PT30M: 1800000, P1W: 7 * D, P1DT2H: D + 7200000 };
  for (const [k, v] of Object.entries(durations)) if (regCron.durationMs(k) !== v) fail(`registration-cron: duration ${k} read as ${regCron.durationMs(k)}`);
  for (const bad of ["1D", "P", "PXD", "P-1D", "PT"]) if (regCron.durationMs(bad) !== null) fail(`registration-cron: invalid duration ${bad} accepted`);
  const keys = (ev) => regCron.remindersOf(regCron.ctxOf(ev, null)).map((r) => r.key).join(",");
  if (keys({ ...regWebinarEv, reminders: [] }) !== "PT1H,P1D,P7D") fail("registration-cron: default webinar reminders are not 7 days, 1 day, 1 hour");
  if (keys({ ...regOnsiteEv, reminders: [] }) !== "P7D") fail("registration-cron: default on-site reminder is not 7 days");
  if (keys({ ...regWebinarEv, reminders: ["P1D"] }) !== "P1D") fail("registration-cron: gl_event.reminders is not followed");
  if (keys({ ...regWebinarEv, settings: { no_reminders: true } }) !== "") fail("registration-cron: settings.no_reminders is not followed");
  const q = (kind, extra = {}) => ({ key: "k", kind, ...extra });
  const opts = [{ value: "a", label: "A" }, "b"];
  const cases = [
    [q("text"), "", "empty"], [q("checkbox"), false, "empty"], [q("checkbox"), "yes", "bad"], [q("consent"), true, "value"],
    [q("select", { options: opts }), "b", "value"], [q("select", { options: opts }), "c", "bad"],
    [q("multiselect", { options: opts }), ["a", "b"], "value"], [q("multiselect", { options: opts }), ["z"], "bad"],
    [q("sectors"), ["anything"], "value"], [q("parts", { options: opts }), "a", "bad"], [q("text"), 12, "bad"],
  ];
  for (const [question, value, want] of cases) {
    const r = reg.checkAnswer(question, value);
    const got = r.bad ? "bad" : r.empty ? "empty" : "value";
    if (got !== want) fail(`registration: answer ${JSON.stringify(value)} to a ${question.kind} question gave ${got}, expected ${want}`);
  }
  if (reg.checkAnswer(q("text", { max_length: 5 }), "abcdefgh").value !== "abcde") fail("registration: max_length is not applied");
  const ics = reg.buildIcs(reg.ctxOf({ ...regWebinarEv, title: "Marées, quais; et pontons" }, { ...webinar, title: "Marées, quais; et pontons" }), "https://meet.example.com/j/1");
  if (!ics || !ics.includes("SUMMARY:Marées\\, quais\\; et pontons") || /[^\r]\n/.test(ics) || !ics.startsWith("BEGIN:VCALENDAR")) fail("registration: the calendar file is malformed");

  // Untrusted values never turn into markup.
  const bad = '"><b id=x>';
  const evilImg = "<img src=x onerror=alert(1)>";
  const spoiled = (html) => /<img src=x|<b id=x|<script|<s>x/.test(html.replace(/<style[\s\S]*?<\/style>/, ""));
  const evilEv = { ...regOnsiteEv, title: evilImg, settings: { practical_info: evilImg, venue: bad } };
  const evilCtx = reg.ctxOf(evilEv, { ...regOnsiteCat, title: `${evilImg} Days`, location: bad });
  const evilG = { ...regGuest, first_name: bad, last_name: evilImg, company: evilImg, job_title: bad, info_request: evilImg, answers: { objective: evilImg, sectors: [bad] } };
  const evilQ = [{ key: "objective", label: evilImg, kind: "textarea" }, { key: "sectors", label: bad, kind: "sectors" }];
  const evilCron = regCron.ctxOf(evilEv, { ...regOnsiteCat, title: `${evilImg} Days` });
  const regEvils = {
    "registration webinar": reg.renderWebinarConfirmed(evilCtx, evilG, { status: `${SITE}/?a=1&b="${bad}"`, join: `https://x.example.com/?q="${bad}"` }).html,
    "registration received": reg.renderReceived(evilCtx, evilG, { status: STATUS_LINK }, evilImg).html,
    "registration onsite": reg.renderOnsiteConfirmed(evilCtx, evilG, { status: STATUS_LINK, ticket: evilImg }).html,
    "registration info": reg.renderInfoRequested(evilCtx, evilG, { status: STATUS_LINK }, evilImg).html,
    "registration links": reg.renderStatusLinks(bad, [{ title: evilImg, when: bad, url: `${SITE}/?a="${bad}"`, label: evilImg }]).html,
    "registration staff": reg.renderStaffNewRegistration(evilCtx, evilG, evilQ, evilImg).html + reg.renderStaffInfoProvided(evilCtx, evilG, evilQ, bad, { answer: evilImg, changed: [bad, evilImg] }).html,
    "registration cancelled": reg.renderCancelled(evilCtx, evilG).html + reg.renderNotAccepted(evilCtx, evilG).html + reg.renderWaitlisted(evilCtx, evilG, { status: null }).html,
    "registration-cron reminder": regCron.renderReminder(evilCron, evilG, { key: "P7D", ms: 7 * D }, { status: STATUS_LINK, join: null, qr: true, optOut: { label: evilImg, url: `${SITE}/?a="${bad}"` } }).html,
    "registration-cron follow-up": regCron.renderFollowup(evilCron, evilG, { replay: null, attendanceKnown: true, optOut: { label: "x", url: SITE } }).html,
    "registration-cron digests": regCron.renderEventDigest(evilCron, [evilG], 1).html + regCron.renderReviewDigest({
      tabs: [{ label: evilImg, count: 1, oldestDays: 0, detail: `${bad} ${evilImg}`, url: `${SITE}/?a="${bad}"` }, { label: bad, count: 1, oldestDays: null, detail: evilImg, url: SITE, fyi: evilImg }],
      registrations: [{ title: evilImg, slug: "x", requested: 1, needs_info: 0, oldestDays: 0, url: `${SITE}/?a="${bad}"` }],
      provisioning: { failed: 0, queued: 0 }, emails: { gaveUp: 0, gaveUpRecent: 0, held: 0 },
    }).html,
    "send-status-notification decisions": status.DECISION_TYPES.map((t) => status.renderDecisionEmail(t, { firstName: bad, orgName: evilImg, orgVerified: true, note: `${evilImg}\n<script>x</script>` }).html).join(""),
    "provision-person": provision.renderAccountReady(bad, evilImg, `${SITE}/?a="${bad}"`).html + provision.renderTeamMemberAdded(bad, evilImg, bad, evilImg, evilImg).html,
  };
  for (const [fn, html] of Object.entries(regEvils)) if (spoiled(html)) fail(`escaping: ${fn} let a typed value reach the HTML as markup`);
}

// ---------------------------------------------------------------- registration Phase 2 checks
{
  // The invite token block is pasted in send-notification (signs) and accept-invite (checks).
  const I_START = "// ---- SMC invite token v1";
  const I_END = "// ---- end SMC invite token ----";
  const blockOf = (fn) => {
    const src = fs.readFileSync(path.join(fnDir, fn, "index.ts"), "utf8");
    const a = src.indexOf(I_START);
    const b = src.indexOf(I_END);
    return a < 0 || b < 0 ? null : src.slice(a, b + I_END.length);
  };
  const sb = blockOf("send-notification");
  const ab = blockOf("accept-invite");
  if (!sb || !ab) fail("invite token block missing from send-notification or accept-invite");
  else if (sb !== ab) fail("the invite token block differs between send-notification and accept-invite");

  // A link signed by send-notification opens in accept-invite, for that row only.
  const signer = load("send-notification", ["signInviteToken"]);
  const key = "example-service-role-key";
  const inv = "00000000-0000-4000-8000-0000000000e1";
  const org = "00000000-0000-4000-8000-0000000000e2";
  const tok = await signer.signInviteToken(key, inv, org, "Sam.Rivera@Example.com");
  const t = invite.readInviteToken(tok);
  if (!t || t.invitationId !== inv) fail("invite token: the invitation id does not read back");
  if (/[^A-Za-z0-9_.-]/.test(tok) || tok.length > 120) fail(`invite token: not URL-safe or too long (${tok.length})`);
  if (tok.toLowerCase().includes("sam") || tok.includes(inv)) fail("invite token: the address or the raw id is readable in the link");
  if (!t || !(await invite.inviteTokenValid(key, t, org, "sam.rivera@example.com"))) fail("invite token: a fresh token does not verify in accept-invite");
  if (t && (await invite.inviteTokenValid(key, t, org, "other@example.com"))) fail("invite token: verifies for another address");
  if (t && (await invite.inviteTokenValid(key, t, "00000000-0000-4000-8000-0000000000e3", "sam.rivera@example.com"))) fail("invite token: verifies for another company");
  if (t && (await invite.inviteTokenValid("another-key", t, org, "sam.rivera@example.com"))) fail("invite token: verifies under another key");
  const [head, mac] = tok.split(".");
  // The first character, not the last: see the unsubscribe check above (the last one also
  // carries padding bits, so roughly 1 run in 256 "tampered" a token into the same bytes).
  const flipped = `${head}.${mac[0] === "A" ? "B" : "A"}${mac.slice(1)}`;
  const tf = invite.readInviteToken(flipped);
  if (tf && (await invite.inviteTokenValid(key, tf, org, "sam.rivera@example.com"))) fail("invite token: a tampered signature verifies");
  const other = await signer.signInviteToken(key, "00000000-0000-4000-8000-0000000000e4", org, "sam.rivera@example.com");
  const swapped = invite.readInviteToken(`${other.split(".")[0]}.${mac}`);
  if (swapped && (await invite.inviteTokenValid(key, swapped, org, "sam.rivera@example.com"))) fail("invite token: a signature moved to another invitation verifies");
  for (const bad of ["", "abc", `${head}`, `${head}.${mac}.x`, "00000000-0000-4000-8000-0000000000e1", 42, null]) {
    if (invite.readInviteToken(bad)) fail(`invite token: malformed token ${JSON.stringify(bad)} reads`);
  }

  // The new e-mails: the join link in both parts, no token in a subject, names for types.
  for (const id of ["notif-15-team-invitation", "notif-16-team-invitation-reminder", "account-9-invite-link", "account-9b-invite-link"]) {
    const it = items.find((i) => i.id === id);
    const link = `${SITE}/join/EXAMPLE_INVITE_TOKEN.EXAMPLE_SIGNATURE`;
    if (!it || !it.html.includes(`href="${link}"`) || !it.text.includes(link)) fail(`${id}: the /join/<token> link is missing`);
    if (it && !it.text.includes("10 November 2026")) fail(`${id}: the expiry day is missing`);
  }
  for (const it of items.filter((i) => /^(notif-1[5-9]|account-[7-9])/.test(i.id))) {
    if (/join\/|verify-email|token|EXAMPLE_/i.test(it.subject)) fail(`${it.id}: a link or token in the subject`);
  }
  {
    const old = items.find((i) => i.id === "notif-13-team-invitation");
    if (!old || !old.html.includes("signup=true") || old.html.includes("/join/")) fail("notif-13-team-invitation: without join_url the old invitation (caller's link) must be unchanged");
    const proof = items.find((i) => i.id === "account-8-email-proof");
    if (!proof || !proof.text.includes(`${SITE}/verify-email?t=`)) fail("account-8-email-proof: the /verify-email link is missing");
    const exists = items.find((i) => i.id === "account-7-already-exists");
    if (!exists || !exists.html.includes(`${SITE}/?signin=true&amp;forgot=true`) || !exists.text.includes(`${SITE}/?signin=true&forgot=true`)) fail("account-7-already-exists: the reset link is missing");
    const join = items.find((i) => i.id === "notif-19b-account-under-review");
    if (!join || !join.text.includes("asked the owner of Port Azur Marina")) fail("notif-19b-account-under-review: the join wording is missing");
    const none = items.find((i) => i.id === "notif-19d-account-under-review");
    if (!none || /your company,/.test(none.text)) fail("notif-19d-account-under-review: a company is named for a person without one");
    // The proof e-mail and an unverified company's link carry no name typed by someone else.
    if (!proof || !/^Hello,$/m.test(proof.text) || /Alex/.test(proof.html)) fail("account-8-email-proof: the greeting must be a plain Hello, (unproven name)");
    const unv = items.find((i) => i.id === "account-9b-invite-link");
    if (!unv || !/^Hello,$/m.test(unv.text) || /Sam/.test(unv.html) || /Harbourline/.test(unv.subject)) fail("account-9b-invite-link: an unverified company's link must not carry the invitee name typed by its owner, nor the company in the subject");
    const unproven = items.find((i) => i.id === "notif-17b-team-join-request");
    const proven = items.find((i) => i.id === "notif-17-team-join-request");
    if (!unproven || !unproven.text.includes("not confirmed this e-mail address")) fail("notif-17b-team-join-request: the unproven-address warning is missing");
    if (!proven || proven.text.includes("not confirmed this e-mail address")) fail("notif-17-team-join-request: a proven requester gets the unproven warning");
  }
  if (acct.typeLabel("partner") !== "Service provider" || acct.typeLabel("media_partner") !== "Media" || acct.typeLabel("x") !== "") fail("account-signup: company type labels");
  const card = acct.companyCard({ id: "00000000-0000-4000-8000-0000000000f1", name: " Port Azur ", logo_url: "javascript:alert(1)", city: "Cannes", country: "France", organization_type: "partner", owner_user_id: "x", claim_code: "SECRET", access_status: "verified" });
  if (!card || Object.keys(card).sort().join(",") !== "city,country,id,logo_url,name,type,type_label" || card.logo_url !== null || card.type_label !== "Service provider") fail(`account-signup: a company card carries more than the public fields (${JSON.stringify(card)})`);
  if (acct.foldName("Pört Àzur – Marina") !== "port azur - marina") fail(`account-signup: name folding gave ${acct.foldName("Pört Àzur – Marina")}`);
  if (acct.significantLength(" a- b ") !== 2 || acct.significantLength("Port") !== 4) fail("account-signup: the 3-character rule counts the wrong characters");
  if (invite.maskEmail("sam.rivera@example.com") !== "s***@example.com") fail("accept-invite: masked address");
  if (invite.fmtDay("2026-11-10T08:00:00Z") !== "10 November 2026") fail(`accept-invite: expiry day ${invite.fmtDay("2026-11-10T08:00:00Z")}`);

  // Untrusted values never turn into markup.
  const bad = '"><b id=x>';
  const evilImg = "<img src=x onerror=alert(1)>";
  const spoiled = (html) => /<img src=x|<b id=x|<script|<s>x/.test(html.replace(/<style[\s\S]*?<\/style>/, ""));
  const u = `${SITE}/unsubscribe`;
  const phase2Evils = {
    "account-signup": acct.renderAccountAlreadyExists(bad, { signIn: `${SITE}/?a="${bad}"`, reset: `${SITE}/?b="${bad}"` }).html +
      acct.renderEmailProof(`${bad}@example.com`, `${SITE}/verify-email?t="${bad}"`).html,
    "accept-invite": invite.renderInviteLink(bad, evilImg, true, `${SITE}/join/"${bad}"`, bad).html + invite.renderInviteLink(bad, evilImg, false, SITE, "").html,
    "send-notification phase 2": notif.renderNotification("team_join_request", { first_name: bad, org_name: evilImg, requester_name: evilImg, requester_email: bad, requester_job: evilImg, requester_unproven: evilImg }, "", u).html +
      notif.renderNotification("team_join_approved", { first_name: bad, org_name: evilImg, org_verified: "" }, "", u).html +
      notif.renderNotification("account_under_review", { first_name: bad, review_path: "new", org_name: evilImg, sla: evilImg }, "", u).html +
      notif.renderNotification("team_invitation", { first_name: bad, org_name: evilImg, join_url: `${SITE}/join/"${bad}"`, expires_on: evilImg }, "", u).html,
  };
  for (const [fn, html] of Object.entries(phase2Evils)) if (spoiled(html)) fail(`escaping: ${fn} let a typed value reach the HTML as markup`);
  // Article comments: names, the article title, the comment and the reason are members' words.
  const commentEvil = notif.renderNotification("comment_mention", { first_name: bad, author_name: evilImg, author_org: evilImg, via_org: evilImg, article_title: evilImg, excerpt: evilImg, comment_path: `/resources/x#comment-"${bad}` }, "", u).html +
    notif.renderNotification("comment_report", { first_name: bad, reporter_name: evilImg, author_name: evilImg, author_org: evilImg, article_title: evilImg, reason: evilImg, excerpt: evilImg, open_reports: "2", comment_path: "/x" }, "", u).html;
  if (spoiled(commentEvil)) fail("escaping: send-notification comment e-mails let a typed value reach the HTML as markup");
  const offComment = notif.renderNotification("comment_mention", { author_name: "X", comment_path: "https://evil.example.com/resources/x" }, "", u);
  if (offComment.html.includes("evil.example.com") || offComment.text.includes("evil.example.com")) fail("send-notification: the comment button left the site origin");
  if (notif.TYPE_TO_CATEGORY.comment_mention !== "comments" || notif.TYPE_TO_CATEGORY.comment_report !== "admin") fail("send-notification: comment e-mails must be filed under comments (tags) and admin (reports)");
  // A member's words never carry a web address into the platform's own e-mail (mail programs link them).
  const linky = "see https://evil.example.com/a and www.evil.example.com and evil.example.com/login now";
  const cm = notif.commentEmailData("comment_report", { excerpt: linky, reason: linky, comment_id: "x", resource_slug: "x" });
  if ([cm.excerpt, cm.reason].some((v) => v.includes("evil.example.com") || !v.includes("[link]"))) fail("send-notification: a web address typed in a comment reached the e-mail");
  const calm = "Berths: 1.5 m, and/or 2.5 m. Thanks @Alex Morel.";
  if (notif.commentEmailData("comment_mention", { excerpt: calm }).excerpt !== calm) fail("send-notification: a comment excerpt without any link was changed");
  // The invitation button can only ever point at the site, whatever join_url says.
  const off = notif.renderNotification("team_invitation", { org_name: "X", join_url: "https://evil.example.com/join/x" }, "", u);
  if (off.html.includes("evil.example.com") || off.text.includes("evil.example.com")) fail("send-notification: the invitation button left the site origin");
  // ACCOUNT_SITE_URL: the signed invitation link (and only it) opens on the account site,
  // which must be one of our own sites.
  const PREVIEW = "https://refonte--m3connectv2.netlify.app";
  const onPreview = load("send-notification", ["renderNotification"], { SITE_URL: SITE, ACCOUNT_SITE_URL: `${PREVIEW}/` });
  const joinP = onPreview.renderNotification("team_invitation", { org_name: "X", join_url: `${SITE}/join/EXAMPLE_INVITE_TOKEN.EXAMPLE_SIGNATURE` }, "", u);
  if (!joinP.text.includes(`${PREVIEW}/join/EXAMPLE_INVITE_TOKEN.EXAMPLE_SIGNATURE`)) fail("send-notification: with ACCOUNT_SITE_URL the invitation link is not on the account site");
  const oldP = onPreview.renderNotification("team_invitation", { org_name: "X", signup_url: `${SITE}/join/00000000-0000-4000-8000-0000000000e1` }, "", u);
  if (oldP.text.includes(PREVIEW) || !oldP.text.includes(`${SITE}/join/00000000-0000-4000-8000-0000000000e1`)) fail("send-notification: ACCOUNT_SITE_URL moved an old invitation link off the site");
  const otherP = onPreview.renderNotification("team_join_request", { org_name: "X", requester_email: "a@example.com" }, "", u);
  if (otherP.text.includes(PREVIEW)) fail("send-notification: ACCOUNT_SITE_URL moved a button that is not the invitation link");
  const foreign = load("send-notification", ["renderNotification"], { SITE_URL: SITE, ACCOUNT_SITE_URL: "https://evil.example.com" })
    .renderNotification("team_invitation", { org_name: "X", join_url: `${SITE}/join/x.y` }, "", u);
  if (foreign.text.includes("evil.example.com") || !foreign.text.includes(`${SITE}/join/x.y`)) fail("send-notification: an ACCOUNT_SITE_URL outside our sites was used");
}

// ---------------------------------------------------------------- registration Phase 3 checks
{
  const get = (id) => items.find((i) => i.id === id);
  // Decision e-mails: wording, links, no company name of an unverified company in a subject.
  const member = get("decision-1-approved-member");
  if (!member || !member.text.includes("member of Smart Marina Connect for Port Azur Marina & Yacht Club") || member.text.includes("participant")) fail("decision-1-approved-member: the 'member of <company>' wording is missing");
  const part = get("decision-2-approved-participant");
  if (!part || !part.text.includes("You are a participant") || /member of Smart Marina Connect for/.test(part.text)) fail("decision-2-approved-participant: the participant wording is missing");
  const rej = get("decision-3-rejected");
  if (!rej || !rej.text.includes("Ask M3 to review again") || !rej.text.includes(`${SITE}/dashboard`) || !rej.html.includes("We could not link this account")) fail("decision-3-rejected: reason or Ask M3 to review again missing");
  const info = get("decision-4-info-requested");
  if (!info || !info.text.includes("Which marina or company do you work for?")) fail("decision-4-info-requested: M3's question is missing");
  const unverified = status.renderDecisionEmail("claim_approved", { firstName: "", orgName: "Harbourline & Sons", orgVerified: false, note: "" });
  if (!unverified || unverified.subject.includes("Harbourline")) fail("claim_approved: an unverified company named in the subject");
  if (!/^Hello,$/m.test(unverified.text)) fail("decision e-mails: no first name must give a plain Hello,");
  for (const t of status.DECISION_TYPES) {
    const m = status.renderDecisionEmail(t, { firstName: "A", orgName: "B", orgVerified: true, note: "C" });
    if (!m || !m.subject || /undefined/.test(m.subject + m.text)) fail(`send-status-notification: ${t} does not render`);
  }
  if (status.renderDecisionEmail("verified", { firstName: "", orgName: "", orgVerified: false, note: "" }) !== null) fail("send-status-notification: an old status must not be a decision type");
  // The three account e-mails of the old live site keep their words.
  if (status.renderStatusEmail("verified", "Alex", "").subject !== "Your Smart Marina Connect account has been approved!") fail("send-status-notification: the old 'verified' e-mail changed");
  if (!status.renderStatusEmail("rejected", "Alex", "R").text.includes("resubmit your application")) fail("send-status-notification: the old 'rejected' e-mail changed");

  // Account e-mail after the QR e-mail: says the pass is separate; never without an event.
  const after = get("account-5b-ready-after-pass");
  if (!after || !after.text.includes("Your entry pass is in a separate e-mail")) fail("account-5b-ready-after-pass: no mention of the separate entry pass");
  if (get("account-5-ready-set-password")?.text.includes("entry pass")) fail("account-5-ready-set-password: mentions a pass it does not follow");
  if (provision.renderAccountReady("Sam", "", `${SITE}/welcome`, true).text.includes("entry pass")) fail("provision-person: the pass note without an event");

  // Review digest: tabs, FYI tabs never send it alone, the queue link.
  const dg = get("cron-10-review-digest");
  for (const label of ["People & companies", "Event registrations", "Team joins", "Duplicates"]) if (!dg || !dg.text.includes(label)) fail(`cron-10-review-digest: tab ${label} missing`);
  if (!dg || !dg.text.includes("oldest: 6 days") || !dg.text.includes(`${SITE}/admin/review`)) fail("cron-10-review-digest: oldest age or queue link missing");
  if (regCron.digestTotal(sampleDigest) !== 8 + 6 + 1 + 1) fail(`registration-cron: digest total ${regCron.digestTotal(sampleDigest)}`);
  const fyiOnly = { ...sampleDigest, tabs: sampleDigest.tabs.map((t) => (t.fyi ? t : { ...t, count: 0 })), provisioning: { failed: 0, queued: 3 }, emails: { gaveUp: 3, gaveUpRecent: 0, held: 4 } };
  if (regCron.digestTotal(fyiOnly) !== 0) fail("registration-cron: team joins, duplicates, held e-mails or e-mails that gave up days ago alone would send the digest");
  if (!dg || !dg.text.includes("2 e-mails gave up after 5 attempts, 1 of them in the last 24 hours")) fail("cron-10-review-digest: the e-mails that gave up are not counted as expected");
  if (regCron.normOrgName("Pört Àzur Marina S.A.S.") !== "port azur marina" || regCron.normOrgName("Spa Resorts SpA") !== "spa resorts" || regCron.normOrgName("D.O.O.") !== "doo") fail("registration-cron: normOrgName differs from normalize_org_name");

  // Outbox sender: routes, requests, back-off.
  const S = regCron.OUTBOX_SENDERS;
  if (S.account_under_review !== "send-notification" || S.team_join_request !== "send-notification" || S.user_account_approved !== "send-status-notification" || S.claim_declined !== "send-status-notification") fail("registration-cron: outbox routes");
  for (const t of status.DECISION_TYPES) if (S[t] !== "send-status-notification") fail(`registration-cron: no outbox route for ${t}`);
  const uid = "00000000-0000-4000-8000-0000000000a1";
  const inv = "00000000-0000-4000-8000-0000000000a2";
  const row = (o) => ({ id: 7, kind: "account_under_review", user_id: uid, subject_id: uid, data: {}, created_at: "2026-10-20T10:00:00.000Z", claimed_at: null, attempts: 0, last_error: null, ...o });
  const r1 = regCron.outboxRequest(row({}));
  if (JSON.stringify(r1) !== JSON.stringify({ type: "account_under_review", user_id: uid })) fail(`outbox: account_under_review request ${JSON.stringify(r1)}`);
  const r2 = regCron.outboxRequest(row({ kind: "team_join_request", subject_id: inv }));
  if (r2.type !== "team_join_request" || r2.data?.invitation_id !== inv || r2.user_id) fail(`outbox: team_join_request request ${JSON.stringify(r2)}`);
  const r3 = regCron.outboxRequest(row({ kind: "user_account_rejected", data: { reason: "x" } }));
  if (r3.outbox_id !== 7 || r3.user_id !== uid || r3.data?.reason !== "x") fail(`outbox: decision request ${JSON.stringify(r3)}`);
  const T0 = Date.parse("2026-10-20T10:00:00.000Z");
  const M = 60000;
  const due = (o) => regCron.outboxDueAt(row(o)) - T0;
  if (due({}) !== 2 * M) fail("outbox: a new row is not left 2 minutes to the page that queued it");
  const claimedAt = "2026-10-20T11:00:00.000Z";
  const C = Date.parse(claimedAt) - T0;
  if (due({ claimed_at: claimedAt, attempts: 1 }) !== C + 10 * M) fail("outbox: a claim without a result is not a 10-minute lease");
  if (due({ claimed_at: claimedAt, attempts: 1, last_error: "attempt 1 failed: x" }) !== C + 2 * M) fail("outbox: back-off after attempt 1 is not 2 minutes");
  if (due({ claimed_at: claimedAt, attempts: 3, last_error: "attempt 3 failed: x" }) !== C + 30 * M) fail("outbox: back-off after attempt 3 is not 30 minutes");
  if (due({ claimed_at: claimedAt, attempts: 4, last_error: "attempt 4 failed: x" }) !== C + 120 * M) fail("outbox: back-off after attempt 4 is not 2 hours");
  if (due({ claimed_at: claimedAt, attempts: 2, last_error: "attempt 1 failed: x" }) !== C + 10 * M) fail("outbox: an older failure must not shorten the lease of a new claim");
  // send-notification's duplicate window: 11 minutes, whatever the back-off; its daily cap (429): a day.
  if (due({ claimed_at: claimedAt, attempts: 1, last_error: 'attempt 1 failed: send-notification answered "duplicate" for a row nobody marked sent: the same e-mail was tried less than 10 minutes ago (duplicate window), tried again after it' }) !== C + 11 * M) fail("outbox: a duplicate answer does not wait out the 10-minute window");
  if (due({ claimed_at: claimedAt, attempts: 4, last_error: "attempt 4 failed: x (duplicate window)" }) !== C + 120 * M) fail("outbox: the duplicate wait must not shorten a longer back-off");
  if (due({ claimed_at: claimedAt, attempts: 2, last_error: "attempt 2 failed: send-notification 429 Too many e-mails for this organization today, try again tomorrow" }) !== C + 1440 * M) fail("outbox: a 429 is not retried a day later");
  // A forced run naming its rows: no wait for a new row or a back-off, but the lease and the duplicate window stay.
  const fdue = (o) => regCron.outboxDueAt(row(o), true);
  if (fdue({}) !== 0) fail("outbox: a forced row still waits 2 minutes");
  if (fdue({ claimed_at: claimedAt, attempts: 3, last_error: "attempt 3 failed: x" }) !== 0) fail("outbox: a forced row still backs off");
  if (fdue({ claimed_at: claimedAt, attempts: 1 }) !== Date.parse(claimedAt) + 10 * M) fail("outbox: a forced run may take a row whose attempt may be in flight");
  if (fdue({ claimed_at: claimedAt, attempts: 1, last_error: "attempt 1 failed: x (duplicate window)" }) !== Date.parse(claimedAt) + 11 * M) fail("outbox: a forced run ignores the duplicate window");
  if (!regCron.heldNote("account_under_review").startsWith("held: ") || !regCron.heldNote("something_else").startsWith("held: ")) fail("outbox: held notes must start with 'held: '");

  // The source rules of the lane, read from the functions.
  const src = (fn) => fs.readFileSync(path.join(fnDir, fn, "index.ts"), "utf8");
  const ccs = src("claim-code-signup");
  if (!ccs.includes("This company already has an owner on Smart Marina Connect. Ask them to invite you to the team.")) fail("claim-code-signup: the owned-company refusal (same words as the database) is missing");
  const sm26 = src("sm26-attendee-invite");
  // Q5 behind review_queue, as sponsor-invite (fixer, 15 Oct): non-staff = pending only while the flag is on.
  if (!/access_status: newAccountPending \? "pending" : "verified"/.test(sm26) || !/if \(!isStaff\) \{\s*const q5 = await reviewQueueOn\(admin\);/.test(sm26)
      || !sm26.includes("review_queue === true") || !/if \(q5 === null\) return json\(req, \{[^}]*\}, 503\)/.test(sm26)) {
    fail("sm26-attendee-invite: the Q5 rule (non-staff = pending, only while registration_flags.review_queue is on; unreadable = 503) is missing");
  }
  const sp = src("sponsor-invite");
  if (!/access_status: isStaff \? "verified" : "pending"/.test(sp) || !sp.includes("as_owner")) fail("sponsor-invite: the Q5 rule is missing");
  if (!sp.includes("review_queue === true") || !/if \(!q5\)/.test(sp)) fail("sponsor-invite: the Q5 rule must wait for registration_flags.review_queue (the July behaviour with the flag off)");
  const pp = src("provision-person");
  if (!pp.includes('"pass"') || !pp.includes('"reg_confirmed"') || !pp.includes("CONFIRMATION_MAIL_GAP_MS")) fail("provision-person: the 'QR e-mail first' rule is missing");
  if (!pp.includes("force && order.giveUp && !order.strict")) fail("provision-person: a staff send-now may skip the wys26 QR e-mail");
  const rc = src("registration-cron");
  if (!rc.includes("force_needs_ids") || !rc.includes("force_needs_job_ids")) fail("registration-cron: a forced run with the flag off must name its rows");
  const ssn = src("send-status-notification");
  if (!ssn.includes("queuedDecisionFor(supabase, user_id, status)")) fail("send-status-notification: the old shape must not send a decision the outbox holds");
  if (/from\("sm_/.test(pp) || /from\("sm_/.test(src("registration-cron"))) fail("provision-person / registration-cron must not touch sm_* tables");
}

// Sign-up activation links always open /welcome (forced password step), whatever page
// the caller of signUp asked for: the pre-registration takeover fix (send-email).
{
  const { signupConfirmLink } = load("send-email", ["signupConfirmLink"]);
  const cases = [
    [`${SITE}/onboarding?email_confirmed=true`, `${SITE}/welcome?next=%2Fonboarding%3Femail_confirmed%3Dtrue&token_hash=H&type=signup`],
    [`${SITE}/welcome?next=%2Fjoin%2Fabc%3Femail_confirmed%3Dtrue`, `${SITE}/welcome?next=%2Fjoin%2Fabc%3Femail_confirmed%3Dtrue&token_hash=H&type=signup`],
    [`${SITE}/`, `${SITE}/welcome?next=%2Fonboarding&token_hash=H&type=signup`],
    [`${SITE}/reset-password?next=%2Faccount`, `${SITE}/welcome?next=%2Fonboarding&token_hash=H&type=signup`],
    ["not a url", `${SITE}/welcome?next=%2Fonboarding&token_hash=H&type=signup`],
    ["javascript:alert(1)", `${SITE}/welcome?next=%2Fonboarding&token_hash=H&type=signup`],
    ["http://localhost:5173/onboarding", "http://localhost:5173/welcome?next=%2Fonboarding&token_hash=H&type=signup"],
  ];
  for (const [redirect, want] of cases) {
    const got = signupConfirmLink(redirect, SITE, "H");
    if (got !== want) fail(`send-email signupConfirmLink(${redirect}): ${got}, expected ${want}`);
  }
  if (signupConfirmLink("not a url", "also not", "H") !== null) fail("send-email signupConfirmLink: unreadable URLs should give null");
}

// ---------------------------------------------------------------- ops-health checks
// The re-alert rule (at most once per problem per realert_hours; a warn that turns into a
// fail is a new problem; muted checks never), the settings clamps and the escaping.
{
  const H = 3600000;
  const now = Date.parse("2026-11-27T12:00:00Z");
  const at = (hoursAgo) => new Date(now - hoursAgo * H).toISOString();
  const warn = { check_id: "a.check", area: "a", status: "warn", summary: "x" };
  const failing = { ...warn, status: "fail" };
  const due = (c, prev, mute = []) => ops.decideDue([c], new Map(prev ? [[c.check_id, prev]] : []), new Set(mute), 6 * H, now).length === 1;
  const cases = [
    ["never e-mailed", due(warn, null), true],
    ["e-mailed 5 h ago", due(warn, { check_id: "a.check", last_alert_at: at(5), last_alert_status: "warn" }), false],
    ["e-mailed 6 h ago", due(warn, { check_id: "a.check", last_alert_at: at(6), last_alert_status: "warn" }), true],
    ["warn e-mailed 1 h ago, now fail", due(failing, { check_id: "a.check", last_alert_at: at(1), last_alert_status: "warn" }), true],
    ["fail e-mailed 1 h ago, now warn", due(warn, { check_id: "a.check", last_alert_at: at(1), last_alert_status: "fail" }), false],
    ["fail e-mailed 1 h ago, cleared, fails again", due(failing, { check_id: "a.check", last_alert_at: at(1), last_alert_status: "fail", cleared_at: at(0.5) }), false],
    ["muted", due(failing, null, ["a.check"]), false],
    ["warn muted at its level", due(warn, null, ["a.check:warn"]), false],
    ["fail of a check muted at warn only", due(failing, null, ["a.check:warn"]), true],
    ["seen but never e-mailed (no recipient then)", due(warn, { check_id: "a.check", last_alert_at: null }), true],
  ];
  if (ops.isMuted(warn, new Set(["a.check:fail"])) || !ops.isMuted(failing, new Set(["a.check:fail"]))) fail("ops-health isMuted: a level mute must match that level only");
  // The heartbeat: only after a recorded run, and never while a due problem reached nobody.
  const hb = [
    [ops.heartbeatDue(true, 0, 0), true], [ops.heartbeatDue(true, 2, 1), true],
    [ops.heartbeatDue(true, 2, 0), false], [ops.heartbeatDue(false, 0, 0), false],
  ];
  hb.forEach(([got, want], i) => { if (got !== want) fail(`ops-health heartbeatDue case ${i}: ${got}, expected ${want}`); });
  for (const [label, got, want] of cases) if (got !== want) fail(`ops-health decideDue: ${label} gave ${got}, expected ${want}`);

  const s = ops.settingsOf({ enabled: "true", recipients: ["A@Example.com", "a@example.com", "not an address", 3], realert_hours: 1, mute: ["x", 2], http_checks: "no" });
  if (s.enabled !== false) fail("ops-health settingsOf: only a JSON true enables the monitor");
  if (s.recipients.join(",") !== "a@example.com") fail(`ops-health settingsOf: recipients ${s.recipients.join(",")}`);
  if (s.realertHours !== 6) fail(`ops-health settingsOf: realert_hours under 6 must clamp to 6, got ${s.realertHours}`);
  if (![...s.mute].join(",").startsWith("x") || s.mute.size !== 1) fail("ops-health settingsOf: mute keeps strings only");
  if (s.httpChecks !== true) fail("ops-health settingsOf: only a JSON false turns the HTTP checks off");
  if (s.heartbeatUrl !== "") fail("ops-health settingsOf: no heartbeat_url must give none");
  if (ops.settingsOf({ heartbeat_url: " https://hc.example.org/ping/abc " }).heartbeatUrl !== "https://hc.example.org/ping/abc") fail("ops-health settingsOf: an https heartbeat_url is kept (trimmed)");
  for (const bad of ["http://hc.example.org/ping/abc", "javascript:alert(1)", "https://a b", 42, `https://x.org/${"a".repeat(500)}`]) {
    if (ops.settingsOf({ heartbeat_url: bad }).heartbeatUrl !== "") fail(`ops-health settingsOf: heartbeat_url ${String(bad).slice(0, 40)} must be refused`);
  }
  if (ops.settingsOf("garbage").enabled !== false || ops.settingsOf(null).realertHours !== 6) fail("ops-health settingsOf: a value of the wrong shape must give the defaults");
  if (ops.settingsOf({ recipients: Array.from({ length: 15 }, (_, i) => `r${i}@example.com`) }).recipients.length !== 10) fail("ops-health settingsOf: more than 10 recipients");
  if (ops.projectUrl("https://abc123.supabase.co", SITE) !== "https://supabase.com/dashboard/project/abc123") fail("ops-health projectUrl");
  if (ops.projectUrl("", SITE) !== `${SITE}/admin`) fail("ops-health projectUrl fallback");

  const evil = ops.renderAlert({
    due: [{ check_id: '"><b id=x>', area: "<img src=x onerror=alert(1)>", status: "fail", summary: "<script>x</script>" }],
    others: [{ check_id: "<img src=x onerror=alert(1)>", area: "a", status: "warn", summary: "y" }],
    when: new Date("2026-11-27T05:00:00Z"), realertHours: 6, ctaUrl: `${SITE}/?a="><b id=x>`,
  });
  if (/<img src=x|<b id=x|<script/.test(evil.html.replace(/<style[\s\S]*?<\/style>/, ""))) fail("escaping: ops-health let a report value reach the HTML as markup");
  const alert = items.find((i) => i.id === "ops-1-health-alert");
  if (alert && (!alert.subject.startsWith("Health check: 1 failing, 2 warnings") || !alert.text.includes("security.open_functions"))) {
    fail(`ops-health alert: subject or the still-open line is wrong (${alert.subject})`);
  }
  // The alert names checks, counts and job or function names only: no address may appear.
  for (const it of items.filter((i) => i.id.startsWith("ops-"))) {
    if (/@example\.com/.test(it.html + it.text)) fail(`${it.id}: an e-mail address appears in the health alert`);
  }
}

// ---------------------------------------------------------------- write

if (!checkOnly) {
  fs.mkdirSync(outDir, { recursive: true });
  const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  for (const it of items) {
    fs.writeFileSync(path.join(outDir, `${it.id}.html`), it.previewHtml ? it.previewHtml(it.html) : it.html);
    fs.writeFileSync(path.join(outDir, `${it.id}.txt`), it.text);
  }
  // C4 (go-live): the WYS e-mails sent until 29 Nov come from the DEPLOYED guest-list v6
  // (commit 446b1c9a, frozen), not from the repository copy. Render that version too: its
  // send functions run with fetch, the database and QRCode stubbed; nothing leaves this process.
  const extra = [];
  try {
    const { execFileSync } = await import("node:child_process");
    let src = execFileSync("git", ["show", "446b1c9a:supabase/functions/guest-list/index.ts"], { cwd: root, encoding: "utf8" });
    src = src.replace(/^import .*$/gm, "");
    const js = ts.transpileModule(src, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText;
    const sent = [];
    const fetchStub = async (_url, init) => (sent.push(JSON.parse(init.body)), { ok: true, text: async () => "" });
    const Deno = { env: { get: (k) => ({ RESEND_API_KEY: "example", SITE_URL: SITE })[k] }, serve() {} };
    const createClient = () => ({ from: () => ({ insert: () => Promise.resolve({}) }) });
    const QR = { toDataURL: async () => wysQr || "data:image/png;base64," };
    const gl6 = new Function("Deno", "createClient", "QRCode", "fetch", `${js}\nreturn { sendPass, sendInvitation, sendRequestAck, sendReject, notifyStaff };`)(Deno, createClient, QR, fetchStub);
    const ev6 = { ...wys, notify_email: "events@m3monaco.com" };
    const plus = { ...wysGuest, first_name: "Sam", last_name: "Rivera", email: "sam.rivera@example.com", motivation: "", wants_gala: false, plus_one_of: wysGuest.id };
    const runs = [
      ["wys-live-1-invitation", () => gl6.sendInvitation(ev6, wysGuest, null)],
      ["wys-live-2-pass-with-qr", () => gl6.sendPass(ev6, wysGuest, null)],
      ["wys-live-3-request-received", () => gl6.sendRequestAck(ev6, wysGuest)],
      ["wys-live-4-request-declined", () => gl6.sendReject(ev6, wysGuest, null)],
      ["wys-live-5-staff-request", () => gl6.notifyStaff(ev6, wysGuest)],
      ["wys-live-6-staff-plus-one", () => gl6.notifyStaff(ev6, plus, wysGuest)],
    ];
    for (const [id, run] of runs) {
      sent.length = 0;
      await run();
      const m = sent[0];
      if (m) extra.push({ id, source: "guest-list v6 (deployed, frozen until 29 Nov)", subject: m.subject, html: wysQr ? m.html.replace("cid:entryqr", wysQr) : m.html });
    }
  } catch (e) {
    console.warn(`guest-list v6 not rendered: ${e.message}`);
  }

  // Q16 draft: the one-off notice to the members who never signed in with a password
  // (list: docs/operations/q16-no-password-members.sql). Draft only, sent by nobody here.
  {
    const lay = load("sponsor-invite", ["emailLayout", "emText", "emP"]);
    const signIn = `${SITE}/?signin=true`;
    const subject = "Smart Marina Connect: please choose a password";
    const body1 = "Our new Smart Marina Connect website is now live. Signing in now uses your e-mail address and a password. Codes and links sent by e-mail are no longer offered.";
    const body2 = "You have always signed in with a code or a link, so you do not have a password yet. Please click Forgot password once on the sign-in window, then choose your password from the e-mail you receive. Your account and your company stay as they are.";
    extra.push({
      id: "q16-password-notice",
      source: "draft, one-off send (Q16)",
      subject,
      html: lay.emailLayout({
        preheader: "Click Forgot password once to choose your password.",
        eyebrow: "Your account",
        title: "Choose your password",
        greeting: "Hello Alex,",
        bodyHtml: lay.emP(body1) + lay.emP(body2),
        cta: { label: "Sign in", url: signIn },
        signoff: "Best regards,<br>The Smart Marina Connect team",
        reason: "You receive this e-mail because you have a Smart Marina Connect account.",
      }),
      text: lay.emText({ title: "Choose your password", greeting: "Hello Alex,", body: `${body1}\n\n${body2}`, cta: { label: "Sign in", url: signIn }, signoff: "Best regards,\nThe Smart Marina Connect team", reason: "You receive this e-mail because you have a Smart Marina Connect account." }),
    });
  }
  for (const it of extra) {
    fs.writeFileSync(path.join(outDir, `${it.id}.html`), it.html);
    if (it.text) fs.writeFileSync(path.join(outDir, `${it.id}.txt`), it.text);
  }

  // When each e-mail leaves (French, for Victor) and when its function goes live.
  const WHEN = {
    "auth-1": "Inscription : lien pour confirmer l'adresse e-mail (quand « Confirm email » sera activé).",
    "auth-2": "La personne clique « Forgot password ».",
    "auth-3": "M3 invite quelqu'un depuis Supabase (invitation Auth).",
    "auth-4": "Lien de connexion par e-mail (n'est plus proposé une fois la connexion par mot de passe seule activée).",
    "auth-5": "La personne change son adresse e-mail (envoyé à la nouvelle adresse).",
    "auth-6": "Code de vérification demandé avant une action sensible.",
    event_registration_confirmed: "Inscription à un événement confirmée (ancien parcours d'inscription).",
    partner_request_received: "Un membre envoie une demande de contact à un partenaire.",
    partner_request_accepted: "Le partenaire accepte : mise en relation des deux, M3 en copie.",
    partner_request_rejected: "Le partenaire décline une demande de contact.",
    webinar_accepted: "M3 accepte une proposition de webinaire.",
    webinar_rejected: "M3 refuse une proposition de webinaire.",
    webinar_moderator_approved: "Un modérateur pré-approuve un webinaire (alerte aux admins).",
    user_account_approved: "M3 valide un compte.",
    payment_confirmed: "Paiement en ligne réussi.",
    payment_failed: "Paiement en ligne échoué ou abandonné.",
    rfp_submitted: "Un membre dépose un appel d'offres (alerte aux admins).",
    rfp_approved: "M3 publie l'appel d'offres d'un membre.",
    rfp_rejected: "M3 refuse un appel d'offres, avec la raison.",
    rfp_closed: "Un appel d'offres est clôturé.",
    consultation_submitted: "Un membre dépose une consultation (alerte aux admins).",
    consultation_approved: "M3 publie la consultation d'un membre.",
    consultation_rejected: "M3 refuse une consultation, avec la raison.",
    consultation_closed: "Une consultation est clôturée.",
    project_rejected: "M3 refuse un projet publié par un membre.",
    project_status_updated: "Le statut d'un projet d'un membre change.",
    reference_confirmed: "Le client confirme une recommandation (e-mail au partenaire).",
    reference_rejected: "Le client refuse une recommandation (e-mail au partenaire).",
    exposition_approved: "M3 accepte une demande d'exposant.",
    exposition_rejected: "M3 refuse une demande d'exposant.",
    exposition_invoice_sent: "M3 envoie la facture d'exposant.",
    exposition_paid: "La facture d'exposant est payée.",
    sponsorship_approved: "M3 valide un niveau de sponsoring.",
    sponsorship_invoice_sent: "M3 envoie la facture de sponsoring.",
    sponsorship_paid: "La facture de sponsoring est payée.",
    sponsorship_rejected: "M3 refuse une demande de sponsoring.",
    org_claim_code: "M3 envoie le code d'une entreprise à la personne qui va la gérer.",
    partner_onboarding_welcome: "Un partenaire est créé : bienvenue en 3 étapes.",
    membership_payment_received: "Paiement d'adhésion reçu (alerte aux admins).",
    profile_reminder_verified_but_thin: "Relance automatique : compte validé, profil peu rempli.",
    profile_reminder_signup_stalled: "Relance automatique : inscription commencée, pas finie.",
    profile_reminder_onboarding_incomplete: "Relance automatique : profil d'entreprise incomplet.",
    profile_reminder_pending_review_followup: "Relance automatique : compte toujours en attente de validation.",
    team_invitation: "Un membre invite un collègue dans son entreprise.",
    team_invitation_reminder: "Relance d'une invitation pas encore utilisée.",
    team_join_request: "Quelqu'un demande à rejoindre l'entreprise (e-mail au responsable).",
    team_join_approved: "Le responsable accepte la demande (e-mail à la personne).",
    join_request_received: "Ancien parcours : demande pour rejoindre une entreprise reçue.",
    join_request_approved: "Ancien parcours : demande pour rejoindre une entreprise acceptée.",
    join_request_rejected: "Ancien parcours : demande pour rejoindre une entreprise refusée.",
    account_under_review: "Après l'inscription : le compte attend la validation de M3 (à partir de l'allumage de front_door, D5).",
    admin_new_submission: "Un membre soumet un contenu à valider (alerte aux admins).",
    "wys-": "WYS, NOUVEAU design : pas avant le redéploiement de guest-list, après le 29 nov.",
    "wys-live-1": "WYS : M3 envoie une invitation depuis la liste d'invités.",
    "wys-live-2": "WYS : invitation acceptée ou demande validée par M3 ; QR d'entrée joint.",
    "wys-live-3": "WYS : accusé de réception d'une demande d'invitation (formulaire /wys26).",
    "wys-live-4": "WYS : M3 refuse une demande.",
    "wys-live-5": "WYS : alerte à M3 pour chaque nouvelle demande.",
    "wys-live-6": "WYS : alerte à M3 pour une demande d'accompagnant.",
    "contact-1": "Formulaire /contact : alerte à events@m3monaco.com.",
    "reference-1": "Un partenaire demande à son client de confirmer une recommandation.",
    "webinar-1": "Un invité sans compte s'inscrit à un webinaire (ancien parcours).",
    "webinar-2": "La veille d'un webinaire, aux invités sans compte (ancien parcours).",
    "account-1": "Inscription avec un code d'entreprise : confirmer l'adresse.",
    "account-2": "M3 valide un compte (ancien message de statut).",
    "account-3": "M3 refuse une demande de compte (ancien message de statut).",
    "account-4": "M3 suspend un compte.",
    "sponsor-1": "M3 ouvre le portail sponsor (lien de connexion).",
    "sponsor-2": "M3 demande un élément (logo, visuel) à un sponsor.",
    "digest-": "Chaque vendredi vers 10 h : messages et demandes non lus de la semaine (rien si rien de neuf).",
    "reg-01": "Inscription à un webinaire confirmée (.ics joint).",
    "reg-02": "Inscription à un événement sur place reçue, en attente de M3.",
    "reg-03": "Demande d'invitation reçue (événement sur invitation).",
    "reg-04": "Événement complet : liste d'attente.",
    "reg-05": "La personne s'inscrit une deuxième fois : rappel de son inscription.",
    "reg-06": "M3 confirme la place sur place, avec le QR d'entrée.",
    "reg-07": "M3 demande une précision sur une inscription.",
    "reg-08": "M3 n'accepte pas une inscription.",
    "reg-09": "La personne annule son inscription.",
    "reg-10": "La personne demande « Get my links ».",
    "reg-11": "Alerte à M3 : nouvelle inscription.",
    "reg-12": "Alerte à M3 : la personne a répondu à la demande de précision.",
    "reg-13": "Alerte à M3 : activité inhabituelle sur les inscriptions.",
    "reg-14": "WYS, nouveau formulaire : accusé de réception (seulement si wys_form_v2 est allumé).",
    "reg-15": "WYS, nouveau formulaire : alerte à M3 (seulement si wys_form_v2 est allumé).",
    "cron-1": "Rappel 7 jours avant un webinaire.",
    "cron-2": "Rappel la veille d'un webinaire, avec le lien.",
    "cron-3": "Rappel 1 heure avant un webinaire.",
    "cron-4": "Rappel 7 jours avant un événement sur place (infos pratiques, QR).",
    "cron-5": "Après un webinaire, aux absents, avec le replay.",
    "cron-6": "Après un webinaire, aux absents, replay pas encore prêt.",
    "cron-7": "Replay disponible, à tous les inscrits (présence non relevée).",
    "cron-8": "Replay ajouté après la relance des absents.",
    "cron-9": "Résumé à M3 des nouvelles inscriptions (événement en mode résumé).",
    "cron-10": "Chaque jour : résumé à M3 de ce qui attend une validation.",
    "account-5-": "Compte créé à la confirmation d'une inscription : choisir son mot de passe.",
    "account-5b": "WYS : une minute après l'e-mail avec le QR, compte prêt (choisir son mot de passe).",
    "decision-1": "M3 valide le compte (membre d'une entreprise validée).",
    "decision-2": "M3 valide le compte (participant, sans entreprise validée).",
    "decision-3": "M3 refuse le compte, avec la raison.",
    "decision-4": "M3 demande une précision avant de valider le compte.",
    "decision-5": "M3 valide une nouvelle entreprise.",
    "decision-6": "M3 accepte qu'une personne gère une entreprise.",
    "decision-7": "M3 refuse cette demande, avec une note.",
    "account-6": "Au responsable : un collègue a rejoint l'entreprise.",
    "account-7": "Inscription avec l'adresse d'un compte qui existe déjà.",
    "account-8": "Confirmer son adresse e-mail (bannière du tableau de bord).",
    "account-9": "La personne demande un nouveau lien d'invitation depuis un ancien e-mail.",
    "ops-1": "Surveillance : problème détecté (à M3 seulement, au plus une fois par 6 h).",
    "ops-2": "Surveillance : e-mail de test.",
    "q16-": "BROUILLON (question 16) : envoi unique aux ~45 membres sans mot de passe, après l'étape D5 ligne 4, avec ton OK.",
  };
  const DEPLOY = {
    "send-email": "P7, avant le jour J",
    "messages-digest": "Jour J, D3 (10 h 30)",
    "guest-list": "Après le 29 nov",
    "guest-list v6 (deployed, frozen until 29 Nov)": "Déjà en ligne, inchangé",
    "draft, one-off send (Q16)": "Envoi manuel",
  };
  for (const fn of ["send-notification", "send-status-notification", "sponsor-invite", "claim-code-signup", "contact-submit", "guest-webinar-register", "guest-webinar-reminders", "sp-notify", "send-reference-email"]) DEPLOY[fn] = "Jour J, D2 (9 h 15)";
  for (const fn of ["registration", "registration-cron", "provision-person", "account-signup", "accept-invite", "ops-health"]) DEPLOY[fn] = "Déjà en ligne (doré) ; bleu à J+1–J+5";
  const whenOf = (it) => {
    const type = it.source.match(/^send-notification · ([a-z_0-9]+)/)?.[1];
    if (type) return WHEN[type] || `Notification du site (${type}).`;
    const key = Object.keys(WHEN).filter((k) => k.includes("-") && it.id.startsWith(k)).sort((a, b) => b.length - a.length)[0];
    return key ? WHEN[key] : "";
  };
  const deployOf = (it) => DEPLOY[it.source] || DEPLOY[it.source.split(" · ")[0]] || "";
  const all = [...items.filter((i) => !i.id.startsWith("wys-")), ...extra, ...items.filter((i) => i.id.startsWith("wys-"))];
  const rows = all
    .map(
      (it) =>
        `<tr><td><a href="${it.id}.html">${esc(it.id)}</a></td><td>${esc(whenOf(it))}</td><td>${esc(it.subject)}</td><td>${esc(it.source.split(" · ")[0])}<br><small>${esc(deployOf(it))}</small></td><td>${it.text ? `<a href="${it.id}.txt">texte</a>` : ""}</td></tr>`,
    )
    .join("\n");
  const invit = fs.existsSync(path.join(outDir, "invitation-campaign", "index.html"))
    ? `<tr><td><a href="invitation-campaign/index.html">invitation-campaign</a></td><td>${esc("Campagnes d'invitation (kit WYS) : M3 lance une campagne depuis l'admin. Déjà en ligne, inchangé.")}</td><td>(texte de la campagne)</td><td>invitation-campaign</td><td></td></tr>`
    : "";
  fs.writeFileSync(
    path.join(outDir, "index.html"),
    `<!DOCTYPE html><html lang="fr"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>Aperçus des e-mails</title>
<style>body{margin:0;padding:32px 20px;background:#eef2f8;font:15px/1.5 Arial,Helvetica,sans-serif;color:#1f2937}main{max-width:1100px;margin:0 auto}h1{color:#0b2653;font-size:26px;margin:0 0 6px}p{color:#5b6475;margin:0 0 20px}table{width:100%;border-collapse:collapse;background:#fff;border-radius:12px;overflow:hidden}th,td{padding:10px 14px;text-align:left;border-bottom:1px solid #e3e7ee;vertical-align:top}th{font-size:12px;letter-spacing:1px;text-transform:uppercase;color:#1b6ea8}a{color:#0b2653;font-weight:bold}small{color:#5b6475}</style></head>
<body><main><h1>Aperçus des e-mails</h1><p>Chaque e-mail que le site peut envoyer à partir du jour J, rendu par le vrai code des fonctions, avec des données fictives (${new Date().toISOString().slice(0, 10)}). Rien n'a été envoyé. Les e-mails de la SM26 (fonctions sm26-*) ne sont pas ici : ils restent tels quels jusqu'au 29 nov.</p>
<table><tr><th>Aperçu</th><th>Quand il part</th><th>Objet</th><th>Fonction / mise en ligne</th><th></th></tr>
${rows}
${invit}
</table></main></body></html>`,
  );
}

// ---------------------------------------------------------------- report

console.log(`Layout block: identical in ${withLayout.length - frozenSeen.length - failures.filter((f) => f.includes("differs")).length}/${withLayout.length - frozenSeen.length} function(s) (${withLayout.filter((n) => !FROZEN_LAYOUT.has(n)).join(", ")})`);
if (frozenSeen.length) console.log(`Frozen, not compared (old gold copy until 29 Nov): ${frozenSeen.join(", ")}`);
if (resendWithout.length) console.log(`Resend senders not on the new layout yet: ${resendWithout.join(", ")}`);
console.log(`${items.length} e-mails rendered${checkOnly ? " (nothing written)" : ` into ${outDir}`}`);
if (failures.length) {
  console.error(`\n${failures.length} problem(s):`);
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
console.log("All checks passed.");
