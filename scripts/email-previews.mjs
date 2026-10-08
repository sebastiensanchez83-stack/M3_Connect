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
// guest-webinar-reminders, send-reference-email, send-status-notification, sp-notify and
// sponsor-invite): their source is transpiled with the TypeScript compiler, the remote
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
  const unsub = (to) => `${SITE}/unsubscribe?email=${encodeURIComponent(to)}`;
  const add = (n, type, to, data, note) => {
    const r = notif.renderNotification(type, data, "", unsub(to));
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
  add(6, "payment_confirmed", "alex.martin@example.com", { first_name: "Alex", amount: "€500", payment_type: "membership", transaction_id: "TXN-EXAMPLE-0001" });
  add(7, "rfp_rejected", "camille.durand@example.com", { first_name: "Camille", title: "Fuel dock renovation", reason: "The scope is not detailed enough for partners to quote. Please add the dock length and the expected timeline." }, "reason note");
  add(8, "sponsorship_approved", "alex.martin@example.com", { first_name: "Alex", requested_tier: "Gold" }, "bullet list");
  add(9, "org_claim_code", "harbour.master@example.com", { first_name: "Marie", org_name: "Port Azur Marina", claim_code: "AZUR-7K2Q", email: "harbour.master@example.com" }, "code box");
  add(10, "partner_onboarding_welcome", "contact@example.com", { first_name: "Léa", email: "contact@example.com" }, "long, headed steps");
  add(11, "membership_payment_received", "admin@example.com", { amount: "€500", submitter: "Alex Martin", org_name: "Port Azur Marina", transaction_id: "TXN-EXAMPLE-0001" }, "admin, info table");
  add(12, "profile_reminder_verified_but_thin", "alex.martin@example.com", { first_name: "Alex" }, "reminder with bullets");
  add(13, "team_invitation", "new.colleague@example.com", { first_name: "Sam", org_name: "Port Azur Marina & Yacht Club", signup_url: `${SITE}/?signup=true&email=new.colleague%40example.com` }, "ampersand in a name");
  add(14, "payment_failed", "alex.martin@example.com", { first_name: "Alex", amount: "€500", reason: "The card was declined." }, "reason note");
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
