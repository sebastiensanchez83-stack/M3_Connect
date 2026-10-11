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
// sponsor-invite and messages-digest): their source is transpiled with the TypeScript compiler, the remote
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
const withLayout = [];
const resendWithout = [];
for (const name of fs.readdirSync(fnDir).sort()) {
  const file = path.join(fnDir, name, "index.ts");
  if (!fs.existsSync(file)) continue;
  const src = fs.readFileSync(file, "utf8");
  const block = layoutOf(src);
  if (block) {
    withLayout.push(name);
    if (block !== reference) fail(`${name}: the SMC e-mail layout block differs from docs/email-layout.ts`);
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

function load(fn, names) {
  let src = fs.readFileSync(path.join(fnDir, fn, "index.ts"), "utf8");
  src = src.replace(/^import .*$/gm, ""); // remote (esm.sh) imports: not needed to render
  const js = ts.transpileModule(src, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
  }).outputText;
  const Deno = { env: { get: () => undefined }, serve() {} };
  const createClient = () => ({}); // a few functions build their client at the top level
  const QRCode = {};
  return new Function("Deno", "createClient", "QRCode", `${js}\nreturn { ${names.join(", ")} };`)(Deno, createClient, QRCode);
}

const auth = load("send-email", ["COPY", "buildEmail", "buildEmailText"]);
const notif = load("send-notification", ["renderNotification", "TYPE_TO_CATEGORY"]);
const claim = load("claim-code-signup", ["buildConfirmationEmail"]);
const status = load("send-status-notification", ["renderStatusEmail"]);
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
]);
const provision = load("provision-person", ["renderAccountReady", "renderTeamMemberAdded"]);
const digest = load("messages-digest", ["renderDigest", "signUnsubToken"]);
// Registration Phase 2 (11 Oct 2026): account-signup, accept-invite (+ new send-notification types).
const acct = load("account-signup", ["renderAccountAlreadyExists", "renderEmailProof", "signInLinks", "typeLabel", "companyCard", "foldName", "significantLength"]);
const invite = load("accept-invite", ["renderInviteLink", "signInviteToken", "readInviteToken", "inviteTokenValid", "maskEmail", "fmtDay"]);

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
  const flipped = sig.slice(0, -2) + (sig.slice(-2) === "AA" ? "AB" : "AA");
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
  add(18, "team_join_approved", "sam.rivera@example.com", { first_name: "Sam", org_name: "Port Azur Marina", org_verified: "yes" }, "company verified by M3");
  add("18b", "team_join_approved", "sam.rivera@example.com", { first_name: "Sam", org_name: "Harbourline & Sons", org_verified: "" }, "company not verified yet");
  add(19, "account_under_review", "alex.martin@example.com", { first_name: "Alex", review_path: "new", org_name: "Bluequay Energy", sla: "within 2 working days" }, "person + new company");
  add("19b", "account_under_review", "alex.martin@example.com", { first_name: "Alex", review_path: "join", org_name: "Port Azur Marina", sla: "within 2 working days" }, "asked to join a verified company");
  add("19c", "account_under_review", "alex.martin@example.com", { first_name: "Alex", review_path: "claim", org_name: "Port Azur Marina", sla: "within 2 working days" }, "asked to manage an ownerless company");
  add("19d", "account_under_review", "alex.martin@example.com", { first_name: "Alex", review_path: "none", org_name: "", sla: "within 2 working days" }, "no company");
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
  add("cron-10-review-digest", "registration-cron · M3 daily review digest", "events@m3monaco.com", regCron.renderReviewDigest({
    registrations: [
      { title: "World Yachting Summit 2026", slug: "wys26", requested: 4, needs_info: 0, oldestDays: 3, url: `${SITE}/admin/guest-list/wys26` },
      { title: "Marina Days 2027", slug: "marina-days-2027", requested: 2, needs_info: 1, oldestDays: 1, url: `${SITE}/admin/events/${regOnsiteCat.id}` },
    ],
    people: { pending: 5, submitted: 3, oldestDays: 6 },
    companies: { pending: 2, byVerifiedMembers: 1, oldestDays: 9 },
    provisioning: { failed: 1, queued: 0 },
  }));
  add("account-5-ready-set-password", "provision-person · account created at confirmation (set password)", regGuest.email, provision.renderAccountReady("Sam", "Marina Days 2027", `${SITE}/welcome?token_hash=EXAMPLE_TOKEN_HASH&type=invite&next=%2Fdashboard`));
  add("account-6-team-member-added", "provision-person · FYI to the company owner", "camille.durand@example.com", provision.renderTeamMemberAdded("Camille", "Sam Rivera", regGuest.email, "Port Azur Marina & Yacht Club", "Marina Days 2027"));

  // Registration Phase 2: account-signup and accept-invite (fictional data).
  add("account-7-already-exists", "account-signup · sign-up tried with the address of an existing account", "alex.martin@example.com", acct.renderAccountAlreadyExists("Alex", acct.signInLinks(SITE)));
  add("account-8-email-proof", "account-signup · confirm your e-mail address (dashboard banner)", "alex.martin@example.com", acct.renderEmailProof("Alex", "alex.martin@example.com", `${SITE}/verify-email?t=EXAMPLE_PROOF_TOKEN_EXAMPLE_PROOF_TOKEN_1234567`));
  add("account-9-invite-link", "accept-invite · fresh invitation link asked from an older e-mail", "new.colleague@example.com", invite.renderInviteLink("Sam", "Port Azur Marina & Yacht Club", true, `${SITE}/join/EXAMPLE_INVITE_TOKEN.EXAMPLE_SIGNATURE`, "10 November 2026"));
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
  const glNotice = guestList.renderStaffNotice(wys, wysGuest);
  const pNotice = reg.renderParityStaffNotice(wys, wysGuest);
  if (glNotice.subject !== pNotice.subject || glNotice.html !== pNotice.html || glNotice.text !== pNotice.text) fail("registration: the wys26 staff notice differs from guest-list's");
  const plusHost = { ...wysGuest, first_name: "Alex" };
  const plusRow = { ...wysGuest, first_name: "Sam", last_name: "Rivera", email: "sam.rivera@example.com", motivation: "" };
  if (guestList.renderStaffNotice(wys, plusRow, plusHost).html !== reg.renderParityStaffNotice(wys, plusRow, plusHost).html) fail("registration: the wys26 plus-one staff notice differs from guest-list's");
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
      registrations: [{ title: evilImg, slug: "x", requested: 1, needs_info: 0, oldestDays: 0, url: `${SITE}/?a="${bad}"` }],
      people: { pending: 0, submitted: 0, oldestDays: 0 }, companies: { pending: 0, byVerifiedMembers: 0, oldestDays: 0 }, provisioning: { failed: 0, queued: 0 },
    }).html,
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
  const flipped = `${head}.${mac.slice(0, -2)}${mac.slice(-2) === "AA" ? "AB" : "AA"}`;
  const tf = invite.readInviteToken(flipped);
  if (tf && (await invite.inviteTokenValid(key, tf, org, "sam.rivera@example.com"))) fail("invite token: a tampered signature verifies");
  const other = await signer.signInviteToken(key, "00000000-0000-4000-8000-0000000000e4", org, "sam.rivera@example.com");
  const swapped = invite.readInviteToken(`${other.split(".")[0]}.${mac}`);
  if (swapped && (await invite.inviteTokenValid(key, swapped, org, "sam.rivera@example.com"))) fail("invite token: a signature moved to another invitation verifies");
  for (const bad of ["", "abc", `${head}`, `${head}.${mac}.x`, "00000000-0000-4000-8000-0000000000e1", 42, null]) {
    if (invite.readInviteToken(bad)) fail(`invite token: malformed token ${JSON.stringify(bad)} reads`);
  }

  // The new e-mails: the join link in both parts, no token in a subject, names for types.
  for (const id of ["notif-15-team-invitation", "notif-16-team-invitation-reminder", "account-9-invite-link"]) {
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
      acct.renderEmailProof(evilImg, `${bad}@example.com`, `${SITE}/verify-email?t="${bad}"`).html,
    "accept-invite": invite.renderInviteLink(bad, evilImg, true, `${SITE}/join/"${bad}"`, bad).html + invite.renderInviteLink(bad, evilImg, false, SITE, "").html,
    "send-notification phase 2": notif.renderNotification("team_join_request", { first_name: bad, org_name: evilImg, requester_name: evilImg, requester_email: bad, requester_job: evilImg }, "", u).html +
      notif.renderNotification("team_join_approved", { first_name: bad, org_name: evilImg, org_verified: "" }, "", u).html +
      notif.renderNotification("account_under_review", { first_name: bad, review_path: "new", org_name: evilImg, sla: evilImg }, "", u).html +
      notif.renderNotification("team_invitation", { first_name: bad, org_name: evilImg, join_url: `${SITE}/join/"${bad}"`, expires_on: evilImg }, "", u).html,
  };
  for (const [fn, html] of Object.entries(phase2Evils)) if (spoiled(html)) fail(`escaping: ${fn} let a typed value reach the HTML as markup`);
  // The invitation button can only ever point at the site, whatever join_url says.
  const off = notif.renderNotification("team_invitation", { org_name: "X", join_url: "https://evil.example.com/join/x" }, "", u);
  if (off.html.includes("evil.example.com") || off.text.includes("evil.example.com")) fail("send-notification: the invitation button left the site origin");
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

// ---------------------------------------------------------------- write

if (!checkOnly) {
  fs.mkdirSync(outDir, { recursive: true });
  const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  for (const it of items) {
    fs.writeFileSync(path.join(outDir, `${it.id}.html`), it.previewHtml ? it.previewHtml(it.html) : it.html);
    fs.writeFileSync(path.join(outDir, `${it.id}.txt`), it.text);
  }
  const rows = items
    .map(
      (it) =>
        `<tr><td><a href="${it.id}.html">${esc(it.id)}</a></td><td>${esc(it.subject)}</td><td>${esc(it.source)}</td><td><a href="${it.id}.txt">text</a></td></tr>`,
    )
    .join("\n");
  fs.writeFileSync(
    path.join(outDir, "index.html"),
    `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>Smart Marina Connect e-mail previews</title>
<style>body{margin:0;padding:32px 20px;background:#eef2f8;font:15px/1.5 Arial,Helvetica,sans-serif;color:#1f2937}main{max-width:980px;margin:0 auto}h1{color:#0b2653;font-size:26px;margin:0 0 6px}p{color:#5b6475;margin:0 0 20px}table{width:100%;border-collapse:collapse;background:#fff;border-radius:12px;overflow:hidden}th,td{padding:10px 14px;text-align:left;border-bottom:1px solid #e3e7ee;vertical-align:top}th{font-size:12px;letter-spacing:1px;text-transform:uppercase;color:#1f7a8c}a{color:#0b2653;font-weight:bold}</style></head>
<body><main><h1>E-mail previews</h1><p>Rendered by the real code of the edge functions (send-email, send-notification and the other Resend senders) with fictional data,${new Date().toISOString().slice(0, 10)}. Regenerate with <code>node scripts/email-previews.mjs</code>.</p>
<table><tr><th>Preview</th><th>Subject</th><th>Source</th><th></th></tr>
${rows}
</table></main></body></html>`,
  );
}

// ---------------------------------------------------------------- report

console.log(`Layout block: identical in ${withLayout.length - failures.filter((f) => f.includes("differs")).length}/${withLayout.length} function(s) (${withLayout.join(", ")})`);
if (resendWithout.length) console.log(`Resend senders not on the new layout yet: ${resendWithout.join(", ")}`);
console.log(`${items.length} e-mails rendered${checkOnly ? " (nothing written)" : ` into ${outDir}`}`);
if (failures.length) {
  console.error(`\n${failures.length} problem(s):`);
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
console.log("All checks passed.");
