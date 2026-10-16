// Renders the invitation e-mail of the "Invitation campaigns" module to files, with the exact
// code the edge function sends (supabase/functions/invitation-campaign/render.ts), for a few
// INVENTED guests: a plain title, an Excellency ("Your Excellency," replaces "Dear ...,"),
// accents, and the optional "join Smart Marina Connect" line.
//
//   node scripts/invitation-email-preview.mjs [content.json] [out-dir]
//
// content.json: optional, a campaign content file shaped like the kit's
// wys_dubai_2026_content.json ({event, email: {subject, body}}). It stays OUTSIDE this public
// repository (the real text carries a signature and a phone number); without it a neutral
// sample text is used. out-dir: default <system temp>/invitation-email-previews, never the
// repository. Open index.html there. Needs Node 22.18 or later (it loads the .ts directly).

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const here = resolve(new URL('.', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const render = await import(pathToFileURL(join(here, '..', 'supabase', 'functions', 'invitation-campaign', 'render.ts')).href);
const {
  renderInvitationEmail, invitationAttachmentNames, invitationSender, INVITATION_JOIN_LINE_DEFAULT, INVITATION_EMAIL_VARIABLES,
} = render;

const contentPath = process.argv[2];
const outDir = resolve(process.argv[3] || join(tmpdir(), 'invitation-email-previews'));

const SAMPLE = {
  event: {
    name: 'World Yachting Summit', edition: '2nd edition', date_label: '27 November 2026', city: 'Dubai',
    venue: 'The Lana, Dorchester Collection', access: 'Conference and Gala Dinner', rsvp_deadline_label: '13 November 2026',
    rsvp_email: 'events@m3monaco.com', hosts: 'M3 Monaco and OMNIYAT', website: 'www.worldyachtingsummit.com',
  },
  email: {
    subject: 'Join us in {{city}} on 27 November',
    body: 'Dear {{greeting}},\n\nI hope you are well.\n\nIt would be a real pleasure to count you among our guests at the **{{event_name}}**, on {{date}} at {{venue}}, {{city}}.\n\nYou will find attached your invitation letter and your personal invitation card.\n\nWhen you have a moment, could you let us know by {{rsvp_deadline}} if you can make it? Simply reply to {{rsvp_email}}.\n\nWarm regards,\n\nThe events team\nM3 Monaco',
  },
};
const content = contentPath ? JSON.parse(readFileSync(contentPath, 'utf8')) : SAMPLE;

const campaign = (joinLine) => ({
  name: 'Preview campaign',
  rsvp_deadline: content.event?.rsvp_deadline_iso || '2026-11-13',
  sender_name: null, sender_email: null, reply_to: null,
  settings: content.event || {},
  texts: { email: { ...(content.email || {}), join_platform_line: joinLine ? INVITATION_JOIN_LINE_DEFAULT : null } },
});

// Invented people only: never a real guest in a public repository.
const GUESTS = [
  { key: 'mr', label: 'Plain title', join: false, r: { honorific: 'Mr', first_name: 'Jean', last_name: 'Exemple', name_on_ticket: 'Mr Jean Exemple', greeting: 'Mr Exemple', position: 'Chief Executive Officer', organisation: 'Example Marinas' } },
  { key: 'excellency', label: 'Excellency', join: false, r: { honorific: 'H.E.', first_name: 'Sample', last_name: 'Minister', name_on_ticket: 'H.E. Dr Sample Minister', name_on_letter: 'H.E. Dr Sample Minister', greeting: 'Your Excellency', position: 'Minister of Tourism', organisation: 'Example Ministry' } },
  { key: 'accents', label: 'Accents, no title', join: false, r: { first_name: 'Élodie', last_name: 'Génová', name_on_ticket: 'Élodie Génová', position: 'Head of Waterfront Development', organisation: 'Société Exemple' } },
  { key: 'join-line', label: 'With the optional "join Smart Marina Connect" line', join: true, r: { honorific: 'Ms', first_name: 'Sara', last_name: 'Sample', name_on_ticket: 'Ms Sara Sample', greeting: 'Ms Sample', organisation: 'Example Developments' } },
];

mkdirSync(outDir, { recursive: true });
const rows = [];
for (const g of GUESTS) {
  const c = campaign(g.join);
  const mail = renderInvitationEmail(c, g.r);
  const files = invitationAttachmentNames(c, g.r);
  const sender = invitationSender(c);
  writeFileSync(join(outDir, `${g.key}.html`), mail.html);
  writeFileSync(join(outDir, `${g.key}.txt`), `From: ${sender.from}\nReply-To: ${sender.replyTo}\nSubject: ${mail.subject}\nAttachments: ${files.letter}, ${files.ticket}\n\n${mail.text}`);
  rows.push({ g, mail, files, sender });
  console.log(`${g.key}: "${mail.subject}" | ${files.letter} + ${files.ticket}${mail.unknown.length ? ` | UNKNOWN ${mail.unknown.join(' ')}` : ''}`);
}
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
writeFileSync(join(outDir, 'index.html'), `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Invitation e-mail previews</title>
<style>body{font-family:Arial,Helvetica,sans-serif;margin:0;padding:16px;background:#eef2f8;color:#1f2937}h1{font-size:20px}
.card{background:#fff;border:1px solid #e3e7ee;border-radius:10px;margin:0 0 20px;overflow:hidden}.meta{padding:12px 16px;font-size:13px;line-height:20px;border-bottom:1px solid #e3e7ee}
iframe{width:100%;height:560px;border:0;display:block}</style></head><body>
<h1>Invitation e-mail previews</h1><p style="font-size:13px">${contentPath ? 'Content: ' + esc(contentPath) : 'Neutral sample text'}. Variables: ${INVITATION_EMAIL_VARIABLES.map(([k]) => '{{' + k + '}}').join(' ')}</p>
${rows.map(({ g, mail, files, sender }) => `<div class="card"><div class="meta"><strong>${esc(g.label)}</strong><br>From: ${esc(sender.from)} &middot; Reply-To: ${esc(sender.replyTo)}<br>Subject: ${esc(mail.subject)}<br>Attachments: ${esc(files.letter)}, ${esc(files.ticket)}</div><iframe src="${g.key}.html" title="${esc(g.label)}"></iframe></div>`).join('\n')}
</body></html>`);
console.log(`\nWritten to ${outDir} (open index.html)`);
