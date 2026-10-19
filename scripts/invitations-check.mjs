// Checks of the "Invitation campaigns" module: title rules, import, duplicates, the
// ticket and letter PDFs (whole names, auto-shrink, accents, missing glyphs), the e-mail to
// copy into your own mailbox, and "Mark as sent" (edge function action mark_sent, driven
// against an in-memory copy of the SQL functions' contracts).
//   node scripts/invitations-check.mjs
//   node scripts/invitations-check.mjs --samples <kit>/reference --out <dir>
// The second form also renders our PDFs and the kit's validated samples to PNG and
// compares them pixel by pixel (the samples hold real guest names: they never enter
// the repository, so the comparison only runs where the kit is).
// Invented names only in this file: the repository is public.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const opt = (k) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : null; };

const esbuild = await import(pathToFileURL(path.join(root, 'node_modules/esbuild/lib/main.js')).href);
const outFile = path.join(os.tmpdir(), `invitations-check-${process.pid}.mjs`);
await esbuild.build({
  stdin: {
    contents: `export * from './lib/names'; export * from './lib/importer'; export * from './lib/render';
               export * from './lib/pdf'; export * from './lib/positions'; export * from './lib/norm';
               export * from './lib/emailCopy'; export * from '../../../supabase/functions/invitation-campaign/markSent.ts';`,
    resolveDir: path.join(root, 'src/components/invitations'), loader: 'ts',
  },
  bundle: true, platform: 'node', format: 'esm', outfile: outFile, logLevel: 'error',
  alias: { '@': path.join(root, 'src') },
});
const M = await import(pathToFileURL(outFile).href);
fs.rmSync(outFile, { force: true });

let pass = 0; let fail = 0;
const check = (name, ok, detail = '') => {
  if (ok) { pass++; console.log(`PASS ${name}`); } else { fail++; console.log(`FAIL ${name}${detail ? `: ${detail}` : ''}`); }
};
const eq = (name, got, want) => check(name, JSON.stringify(got) === JSON.stringify(want), `got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);

/* 1. Titles, names, greetings */
const P = (raw) => { const p = M.parseContact(raw); return { ...p, ...M.proposeNames({ honorific: p.honorific, first: p.first, last: p.last, suffix: p.suffix }) }; };
let p = P('S.E. Dr. Amina Rahal Ostrova');
eq('S.E. becomes H.E., Dr without period', p.honorific, 'H.E. Dr');
eq('Excellency greeting', p.greeting, 'Your Excellency');
eq('Excellency on the ticket', p.name_on_ticket, 'H.E. Dr Amina Rahal Ostrova');
p = P('Mr. Karim Al Nouri');
eq('Mr + particle surname', [p.first, p.last, p.greeting], ['Karim', 'Al Nouri', 'Mr Al Nouri']);
p = P('Eng. Tarek Selim');
eq('Eng. keeps its period, greeting Eng. + surname', [p.name_on_ticket, p.greeting], ['Eng. Tarek Selim', 'Eng. Selim']);
p = P('Dr Lina Ostrova Bey');
eq('Dr + last word surname', p.greeting, 'Dr Bey');
p = P('Jordan Pell');
eq('No title: full name, gender never guessed', p.greeting, 'Jordan Pell');
p = P('Omar Faisal Hadi, CFA');
eq('Suffix on the letter only', [p.name_on_ticket, p.name_on_letter], ['Omar Faisal Hadi', 'Omar Faisal Hadi, CFA']);
check('Three-word name flagged for the surname split', p.reasons.includes('name_split'));
p = P('Prof. Elena Varga');
check('Uncommon title kept and flagged', p.honorific === 'Prof.' && p.reasons.includes('title_other'));
p = P('DUVAL Marc');
eq('Surname in capitals first', [p.first, p.last], ['Marc', 'Duval']);
p = P('HE Amir Example Ali');
eq('"HE" without periods is H.E., not a surname in capitals', [p.honorific, p.first, p.last, p.name_on_ticket, p.greeting],
  ['H.E.', 'Amir Example', 'Ali', 'H.E. Amir Example Ali', 'Your Excellency']);
check('... and flagged so staff check it', p.reasons.includes('title_read'));
p = P('SE M. Paul Exemple');
eq('"SE M." gives H.E. and the French title kept', [p.honorific, p.first, p.last, p.greeting], ['H.E. M.', 'Paul', 'Exemple', 'Your Excellency']);
check('... flagged: title read, uncommon title', p.reasons.includes('title_read') && p.reasons.includes('title_other'));
p = P('HH Sheikh Rashid Example');
eq('"HH" without periods is H.H.', [p.honorific, p.greeting], ['H.H. Sheikh', 'Your Highness']);
p = P('He Wei');
eq('"He" in normal case stays a name (a common surname)', [p.honorific, p.first, p.last], ['', 'He', 'Wei']);
p = P('HE Ahmed Ali');
eq('"HE Ahmed Ali" gives a "Your Excellency" letter, never "Dear Ahmed Ali He"', [p.name_on_ticket, M.salutation(p.greeting)], ['H.E. Ahmed Ali', 'Your Excellency,']);
eq('Dear line for an Excellency', M.salutation('Your Excellency'), 'Your Excellency,');
eq('Dear line otherwise', M.salutation('Mr Duval'), 'Dear Mr Duval,');
eq('French title translated', M.translatePosition('Directeur général').text, 'Chief Executive Officer');
check('Unknown French title flagged', M.translatePosition('Directeur de la stratégie portuaire régionale').french);
eq('English title untouched', M.translatePosition('Head of Marinas'), { text: 'Head of Marinas', translated: false, french: false });
for (const t of ['General Manager', 'Executive Vice President', 'Commercial Director', 'Head of Industry Relations']) check(`English title not taken for French: ${t}`, !M.translatePosition(t).french);
eq('Greeting "Dear Your Excellency" from a file', M.cleanGreeting('Dear Your Excellency'), 'Your Excellency');
eq('Name key as the database (titles, accents)', M.normKey('H.E. Dr Élise  Varga-Noor', true), 'elise varga noor');

/* 2. Import: Victor's columns, the kit CSV, duplicates */
const victor = [['#', 'Pays / Région', 'Organisation', 'Contact', 'Poste', 'Notes'],
  ['1', 'France', 'Port Exemple', 'M. Paul Exemple', 'Directeur général', ''],
  ['2', 'UAE', 'Example Authority', 'S.E. Nadia Exemplar', 'Chairman', 'Orthographe à vérifier']];
const vm = M.guessMapping(victor[0]);
eq("Victor's columns mapped", [vm.order, vm.country, vm.organisation, vm.contact, vm.position, vm.notes], [0, 1, 2, 3, 4, 5]);
const vd = M.buildDrafts(victor, 0, vm);
eq('French job title translated on import', vd[0].position, 'Chief Executive Officer');
check('"à vérifier" note flagged', vd[1].reasons.includes('note_check'));
eq('Excellency from the Contact column', [vd[1].name_on_ticket, vd[1].greeting], ['H.E. Nadia Exemplar', 'Your Excellency']);
const kit = [['name_on_ticket', 'name_on_letter', 'greeting', 'position', 'organisation', 'email', 'notes'],
  ['Mr Sam Example', 'Mr Sam Example', 'Mr Example', 'CEO', 'Example Marinas', '', ''],
  ['Mr Sam Example', 'Mr Sam Example', 'Mr Example', 'CEO', 'Example Marinas', '', '']];
const km = M.guessMapping(kit[0]);
const kd = M.buildDrafts(kit, 0, km);
eq('Kit CSV columns read', [kd[0].name_on_ticket, kd[0].greeting, kd[0].first_name, kd[0].last_name], ['Mr Sam Example', 'Mr Example', 'Sam', 'Example']);
check('Same guest twice in one file: second skipped', M.earlierInFile(kd).has(1) && !M.earlierInFile(kd).has(0));
const known = [{ kind: 'recipient', id: 'r1', where: 'this', label: 'Sam Example', email: null, name_key: M.personKey(kd[0]), org_key: M.normKey('Example Marinas'), status: 'draft' }];
const hits = M.findHits(kd[0], known);
check('Same guest imported again: flagged as same name and organisation', hits.length === 1 && hits[0].on === 'name_org');
eq('... and skipped by default, not duplicated', M.defaultChoice(hits, false), 'skip');
const req = [{ kind: 'guest', id: 'g1', where: 'guest_list', label: 'Sam Example', email: 'sam@example.com', name_key: 'x', org_key: '', status: 'requested', source: 'request' }];
eq('Pending /wys26 request: imported and flagged (adoption chosen per row)', M.defaultChoice(M.findHits({ ...kd[0], email: 'sam@example.com' }, req), false), 'import');
const inv = [{ ...req[0], status: 'invited', source: 'invitation' }];
eq('Same e-mail already invited on the event: skipped', M.defaultChoice(M.findHits({ ...kd[0], email: 'SAM@example.com' }, inv), false), 'skip');

/* 3. PDFs */
const pub = path.join(root, 'public/invitations');
const buf = (p) => { const b = fs.readFileSync(p); return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength); };
const assets = {
  fonts: {
    light: buf(`${pub}/fonts/Montserrat-Light.ttf`), regular: buf(`${pub}/fonts/Montserrat-Regular.ttf`),
    medium: buf(`${pub}/fonts/Montserrat-Medium.ttf`), semibold: buf(`${pub}/fonts/Montserrat-SemiBold.ttf`),
    pagellaRegular: buf(`${pub}/fonts/Pagella-Regular.ttf`), pagellaItalic: buf(`${pub}/fonts/Pagella-Italic.ttf`),
  },
  templates: { white: buf(`${pub}/wys26/templates/tpl_ticket_white.pdf`), navy: buf(`${pub}/wys26/templates/tpl_ticket_navy.pdf`) },
  logos: Object.fromEntries([['banner', 'letter_banner'], ['m3Navy', 'm3_navy'], ['m3White', 'm3_white'], ['wysNavy', 'wys_navy'],
    ['wysWhite', 'wys_white'], ['omniNavy', 'omni_navy'], ['omniWhite', 'omni_white']].map(([k, f]) => [k, buf(`${pub}/wys26/logos/${f}.png`)])),
  signature: null,
};
const preset = JSON.parse(fs.readFileSync(path.join(root, 'src/components/invitations/presets/wys-dubai-2026.json'), 'utf8'));
const campaign = ({ settings = {}, ...over } = {}) => ({
  name: 'Test', ticket_style: 'white', letter_date: '2026-10-09',
  texts: { ticket: preset.ticket, letter: preset.letter, email: preset.email }, ...over,
  settings: { ...preset.event, assets: 'wys26', ticket_artwork: 'template', signature: 'none', ...settings },
});
const guest = (name, extra = {}) => ({ name_on_ticket: name, name_on_letter: name, greeting: name, position: 'Chief Executive Officer', organisation: 'Example Marinas', first_name: null, last_name: null, ...extra });

const FONT_DATA = path.join(root, 'node_modules/pdfjs-dist/standard_fonts') + path.sep;
const pdfjs = await import(pathToFileURL(path.join(root, 'node_modules/pdfjs-dist/legacy/build/pdf.mjs')).href);
const textOf = async (bytes) => {
  const doc = await pdfjs.getDocument({ data: bytes.slice(), isEvalSupported: false, useSystemFonts: false, standardFontDataUrl: FONT_DATA }).promise;
  const page = await doc.getPage(1);
  const tc = await page.getTextContent();
  await doc.destroy();
  return tc.items.map(i => ({ str: i.str, size: Math.hypot(i.transform[0], i.transform[1]), x: i.transform[4], w: i.width }));
};
const hasLine = (items, s) => items.some(i => i.str === s);

for (const artwork of ['template', 'drawn']) {
  for (const style of ['white', 'navy']) {
    const c = campaign({ ticket_style: style, settings: { ticket_artwork: artwork } });
    const t = await M.ticketPdf(assets, c, guest('Luck Machin'));
    const items = await textOf(t.bytes);
    check(`"Luck Machin" whole on the ticket (${artwork}, ${style})`, hasLine(items, 'Luck Machin') && t.issues.length === 0, JSON.stringify(t.issues));
  }
}
const letter = await M.letterPdf(assets, campaign(), guest('Luck Machin', { greeting: 'Mr Machin' }));
const litems = await textOf(letter.bytes);
check('"Luck Machin" whole on the letter', hasLine(litems, 'Luck Machin') && hasLine(litems, 'Dear Mr Machin,'), litems.slice(0, 6).map(i => i.str).join(' | '));
check('Letter: no issue without signature when turned off', letter.issues.length === 0, JSON.stringify(letter.issues));
const sigMissing = await M.letterPdf(assets, campaign({ settings: { signature: 'sm26' } }), guest('Luck Machin'));
check('Letter: missing signature is reported', sigMissing.issues.some(i => i.code === 'no_signature'));

for (const name of ['H.E. Dr Abdel Rahman Ostrova', 'Ms Anastasia Konstantinova Papadopoulou-Lunde', 'Mr Bartholomew Alexander Fitzwilliam-Montgomery', 'H.E. Sheikh Abdulrahman Hamdan Al Qasimi Haddad']) {
  const t = await M.ticketPdf(assets, campaign(), guest(name));
  const it = (await textOf(t.bytes)).find(i => i.str === name);
  check(`One line on the ticket: "${name}" (${name.length} chars)`, !!it && it.w <= 124 * M.MM + 0.01 && t.issues.length === 0,
    it ? `size ${it.size.toFixed(1)} width ${(it.w / M.MM).toFixed(1)} mm` : 'not found');
  if (it) console.log(`     ${name.length} characters at ${it.size.toFixed(1)} pt, ${(it.w / M.MM).toFixed(1)} mm wide`);
}
const tooLong = 'Mr Bartholomew Alexander Fitzwilliam-Montgomery of Somewhere Very Far Away Indeed';
check('A name too long even at 11 pt is reported', (await M.ticketPdf(assets, campaign(), guest(tooLong))).issues.some(i => i.code === 'name_too_long'));
for (const name of ['Élodie Varga', 'Zuzana Example', 'Łukasz Żółć', 'Øyvind Ærø']) {
  const t = await M.ticketPdf(assets, campaign(), guest(name));
  const l = await M.letterPdf(assets, campaign(), guest(name));
  check(`Accents print: "${name}"`, hasLine(await textOf(t.bytes), name) && hasLine(await textOf(l.bytes), name) && !t.issues.length && !l.issues.length);
}
const cjk = String.fromCharCode(0x738b) + ' Example';
const bad = await M.ticketPdf(assets, campaign(), guest(cjk));
check('A character missing from the font is reported, not printed as a box', bad.issues.some(i => i.code === 'missing_glyph'), JSON.stringify(bad.issues));
const badL = await M.letterPdf(assets, campaign(), guest(cjk));
check('... on the letter too', badL.issues.some(i => i.code === 'missing_glyph'));

/* 4. "Send yourself": the e-mail to copy, and "Mark as sent" (edge function action mark_sent) */
const mailCampaign = campaign();
let mc = M.emailCopyFor(mailCampaign, { email: 'luck@example.com', name_on_ticket: 'Mr Luck Machin', name_on_letter: 'Mr Luck Machin', greeting: 'Mr Machin' });
eq('E-mail copy: subject of the campaign', mc.subject, 'Join us in Dubai on 27 November');
check('E-mail copy: greeting filled, plain text', mc.body.startsWith('Dear Mr Machin,\n\n') && !mc.body.includes('{{') && !mc.body.includes('\r'), mc.body.slice(0, 40));
check('E-mail copy: no trailing line break', !/\n$/.test(mc.body));
check('E-mail copy: mailto with address, subject and text', !!mc.mailto && mc.mailto.startsWith('mailto:luck@example.com?subject=Join%20us') && mc.mailto.includes('&body=Dear%20Mr%20Machin%2C%0D%0A'), String(mc.mailto).slice(0, 80));
mc = M.emailCopyFor(mailCampaign, { email: 'he@example.com', name_on_ticket: 'H.E. Amira Example', greeting: 'Your Excellency' });
check('E-mail copy: "Your Excellency," replaces "Dear ..."', mc.body.startsWith('Your Excellency,\n') && !mc.body.includes('Dear Your'), mc.body.slice(0, 40));
mc = M.emailCopyFor(campaign({ texts: { email: { subject: 'For {{name_on_ticket}}', body: 'Dear {{greeting}},\n\n**Bold** words and *Italic* titles, {{typo}}.' } } }),
  { email: null, name_on_ticket: 'Ms Jo Example', greeting: 'Ms Example' });
eq('E-mail copy: markup dropped, unknown variable kept and listed', [mc.subject, mc.body, mc.unknown, mc.to],
  ['For Ms Jo Example', 'Dear Ms Example,\n\nBold words and Italic titles, {{typo}}.', ['{{typo}}'], '']);
check('E-mail copy: the text file has the address line, CRLF', M.emailCopyText(mc).startsWith('To: (no e-mail address yet)\r\nSubject: For Ms Jo Example\r\n\r\nDear Ms Example,'));

// The handler's date and channel checks.
const NOW = new Date('2026-10-16T09:00:00Z');
eq('mark_sent: channel and empty date (now)', M.parseHandSent('post', '', NOW), { ok: true, channel: 'post', sentOn: null });
eq('mark_sent: a past date kept', M.parseHandSent('email', '2026-10-09', NOW), { ok: true, channel: 'email', sentOn: '2026-10-09' });
eq('mark_sent: tomorrow (time zones) accepted', M.parseHandSent('phone', '2026-10-17', NOW).ok, true);
eq('mark_sent: "platform" passes the parser (only a send that may have gone out takes it, see below)', M.parseHandSent('platform', null, NOW), { ok: true, channel: 'platform', sentOn: null });
eq('mark_sent: refusals', ['platform_letter', 'letter', ''].map(c => M.parseHandSent(c, null, NOW).error).concat(
  ['2026-02-30', '16/10/2026', 42].map(d => M.parseHandSent('post', d, NOW).error), [M.parseHandSent('post', '2026-10-19', NOW).error, M.parseHandSent('post', '2024-01-01', NOW).error]),
  ['bad_channel', 'bad_channel', 'bad_channel', 'bad_date', 'bad_date', 'bad_date', 'future_date', 'too_old']);
eq('mark_sent: the SM26 channels, without "Letter drawn here"', [...M.INVITATION_HAND_CHANNELS], ['email', 'post', 'phone', 'in_person', 'third_party']);

// An in-memory copy of the SQL functions' contracts (supabase/migrations/2026101709*, 20261017093000)
// and of the sender's lock, to drive markSentOne as index.ts does.
function fakeDb({ capacity = null } = {}) {
  const db = { capacity, guests: [], recipients: [], emailLog: [], journal: [], dups: [], failMark: null, n: 0 };
  const gid = () => `g${++db.n}`;
  const rec = (id) => db.recipients.find(r => r.id === id);
  const held = () => db.guests.filter(g => g.status === 'invited' || g.status === 'confirmed').length;
  const byEmail = (e) => db.guests.find(g => g.email === e);
  const log = (recipient_id, action, payload) => db.journal.push({ recipient_id, action, payload });
  const fns = {
    invitation_link_guest({ p_recipient_id: id, p_force, p_adopt }) {
      const r = rec(id);
      if (r.gl_guest_id) { const g = db.guests.find(x => x.id === r.gl_guest_id); return { ok: true, already_linked: true, created: false, guest_id: g.id, guest_status: g.status }; }
      if (!['draft', 'ready'].includes(r.status)) return { ok: false, error: 'bad_status', status: r.status };
      if (!r.email) return { ok: false, error: 'no_email' };
      if (!r.first_name || !r.last_name) return { ok: false, error: 'missing_name' };
      const g = byEmail(r.email);
      if (g) {
        const other = db.recipients.find(x => x.gl_guest_id === g.id);
        if (other) return { ok: false, error: 'guest_linked_elsewhere', guest_id: g.id, other_recipient_id: other.id };
        if (!p_adopt) return { ok: false, error: 'already_on_list', guest_id: g.id, guest_status: g.status, guest_source: g.source };
      }
      if (db.capacity != null && !p_force && held() + 1 > db.capacity) return { ok: false, error: 'capacity', held: held(), capacity: db.capacity };
      const ng = { id: gid(), email: r.email, status: 'invited', source: 'invitation' };
      db.guests.push(ng); r.gl_guest_id = ng.id; log(id, 'guest_created', { guest_id: ng.id });
      return { ok: true, created: true, adopted: false, guest_id: ng.id, guest_status: 'invited' };
    },
    invitation_adopt_request({ p_recipient_id: id, p_force }) {
      const r = rec(id); const g = byEmail(r.email);
      if (!g || g.status !== 'requested' || g.source !== 'request') return { ok: false, error: 'not_pending_request' };
      if (db.capacity != null && !p_force && held() + 1 > db.capacity) return { ok: false, error: 'capacity', held: held(), capacity: db.capacity };
      g.status = 'invited'; r.gl_guest_id = g.id; log(id, 'request_adopted', { guest_id: g.id });
      return { ok: true, adopted: true, adopted_request: true, guest_id: g.id, guest_status: 'invited' };
    },
    invitation_relink_guest({ p_recipient_id: id, p_force }) {
      const r = rec(id); const g = byEmail(r.email);
      if (!g || g.status !== 'cancelled' || g.source !== 'invitation' || db.emailLog.some(l => l.guest_id === g.id)
        || !db.journal.some(l => l.recipient_id === id && l.action === 'guest_unlinked' && l.payload.guest_id === g.id)) return { ok: false, error: 'not_relinkable' };
      if (db.capacity != null && !p_force && held() + 1 > db.capacity) return { ok: false, error: 'capacity', held: held(), capacity: db.capacity };
      g.status = 'invited'; r.gl_guest_id = g.id; log(id, 'guest_relinked', { guest_id: g.id });
      return { ok: true, created: true, relinked: true, guest_id: g.id, guest_status: 'invited' };
    },
    invitation_unlink_guest({ p_recipient_id: id }) {
      const r = rec(id); const g = db.guests.find(x => x.id === r.gl_guest_id);
      if (!g || !['draft', 'ready'].includes(r.status) || g.status !== 'invited' || db.emailLog.some(l => l.guest_id === g.id)) return { ok: false, error: 'not_undoable' };
      g.status = 'cancelled'; r.gl_guest_id = null; log(id, 'guest_unlinked', { guest_id: g.id });
      return { ok: true, guest_id: g.id, guest_status: 'cancelled' };
    },
    invitation_unadopt_request({ p_recipient_id: id }) {
      const r = rec(id); const g = db.guests.find(x => x.id === r.gl_guest_id);
      if (!g || !['draft', 'ready'].includes(r.status) || g.status !== 'invited') return { ok: false, error: 'not_undoable' };
      g.status = 'requested'; r.gl_guest_id = null; log(id, 'request_unadopted', { guest_id: g.id });
      return { ok: true, guest_id: g.id, guest_status: 'requested' };
    },
    invitation_mark_sent({ p_recipient_id: id, p_message_id }) {
      if (db.failMark === 'refuse') return { ok: false, error: 'not_linked' };
      if (db.failMark === 'throw') throw new Error('invitation_mark_sent: connection reset');
      const r = rec(id);
      if (!r.gl_guest_id || !r.email) return { ok: false, error: 'not_linked' };
      db.emailLog.push({ guest_id: r.gl_guest_id, kind: 'invitation', to_email: r.email });
      if (['draft', 'ready'].includes(r.status)) r.status = 'sent';
      r.sent_at = r.sent_at || 'now'; r.sending_at = null; r.send_error = null;
      log(id, 'invitation_sent', { guest_id: r.gl_guest_id, resend: false, message_id: p_message_id });
      if (db.failMark === 'lost') { db.failMark = null; throw new Error('invitation_mark_sent: the answer was lost'); }
      return { ok: true, status: r.status, guest_id: r.gl_guest_id };
    },
  };
  let tick = 0;
  db.deps = {
    async claim(id) {
      await null;
      const r = rec(id);
      if (!r || !['draft', 'ready'].includes(r.status) || r.sending_at) return null;
      r.sending_at = `lock${++tick}`;
      return { at: r.sending_at, row: { ...r } };
    },
    async unlock(id, at) { const r = rec(id); if (r.sending_at === at) r.sending_at = null; },
    async release(id, at, code) { const r = rec(id); if (r.sending_at === at) { r.sending_at = null; r.send_error = code; } },
    async duplicates(id) { return db.dups.filter(d => d.recipient_id === id); },
    async rpc(fn, args) { await null; return fns[fn](args); },
    async read(id) { const r = rec(id); return r ? { ...r } : null; },
    async setSentAt(id, iso) { const r = rec(id); if (r.status !== 'sent') return false; r.sent_at = iso; return true; },
    async journal(id, action, payload) { log(id, action, payload); },
  };
  db.add = (id, extra = {}) => {
    const r = { id, email: `${id}@example.com`, first_name: 'Jo', last_name: id, status: 'ready', gl_guest_id: null, sending_at: null, send_error: null, sent_at: null, ...extra };
    db.recipients.push(r); return r;
  };
  // The health monitor (ops_health_checks, wys.emails_missing): an invited row without an 'invitation' line.
  db.monitorMissing = () => db.guests.filter(g => g.status === 'invited' && !db.emailLog.some(l => l.guest_id === g.id && l.kind === 'invitation')).length;
  db.logLines = (id) => { const r = rec(id); return db.emailLog.filter(l => l.guest_id === r.gl_guest_id).length; };
  return db;
}
const opts = (o = {}) => ({ actor: 'staff-1', channel: 'post', sentOn: null, adopt: false, force: false, dismissed: new Set(), ...o });
const fresh = (db, id) => ({ ...db.recipients.find(r => r.id === id) });

let fdb = fakeDb({ capacity: 3 });
fdb.add('r1');
let res = await M.markSentOne(fdb.deps, fresh(fdb, 'r1'), opts({ sentOn: '2026-10-10' }));
const r1 = fdb.recipients[0];
check('Mark as sent: the guest joins the guest list as invited', res.outcome === 'sent' && !!r1.gl_guest_id && fdb.guests[0].status === 'invited' && fdb.guests[0].source === 'invitation', JSON.stringify(res));
check('... one gl_email_log "invitation" line to the guest (the monitor stays green)', fdb.emailLog.length === 1 && fdb.emailLog[0].kind === 'invitation' && fdb.emailLog[0].to_email === 'r1@example.com' && fdb.monitorMissing() === 0);
check('... status sent, sent_at the date given, lock released', r1.status === 'sent' && r1.sent_at === '2026-10-10T12:00:00.000Z' && r1.sending_at === null, JSON.stringify(r1));
check('... channel in the journal: "hand:post" on invitation_sent, and sent_by_hand', fdb.journal.some(l => l.action === 'invitation_sent' && l.payload.message_id === 'hand:post')
  && fdb.journal.some(l => l.action === 'sent_by_hand' && l.payload.channel === 'post' && l.payload.sent_on === '2026-10-10'));
eq('... the Tracking channel read back from the journal', M.invitationChannels(fdb.journal).get('r1'), 'post');
res = await M.markSentOne(fdb.deps, fresh(fdb, 'r1'), opts());
check('Mark again: skipped, never twice', res.outcome === 'skipped' && res.code === 'already_sent' && fdb.emailLog.length === 1, JSON.stringify(res));
fdb.add('r2');
const stale = fresh(fdb, 'r2');
const both = await Promise.all([M.markSentOne(fdb.deps, stale, opts()), M.markSentOne(fdb.deps, stale, opts())]);
check('Double click: one mark, the other skipped, one log line', both.filter(x => x.outcome === 'sent').length === 1 && both.some(x => x.code === 'in_progress_or_sent') && fdb.logLines('r2') === 1, JSON.stringify(both));
res = await M.markSentOne(fdb.deps, stale, opts());
check('A stale read of a guest marked since: skipped under the lock', res.outcome === 'skipped' && fdb.logLines('r2') === 1);

fdb.guests.push({ id: 'gx', email: 'busy@example.com', status: 'confirmed', source: 'request' });
fdb.add('r3');
res = await M.markSentOne(fdb.deps, fresh(fdb, 'r3'), opts());
const r3 = fdb.recipients.find(r => r.id === 'r3');
check('Capacity full: blocked, nothing on the guest list, no log line, lock released', res.outcome === 'blocked' && res.code === 'capacity' && res.detail === '3/3'
  && !r3.gl_guest_id && r3.status === 'ready' && r3.sending_at === null && fdb.emailLog.length === 2, JSON.stringify(res));
res = await M.markSentOne(fdb.deps, fresh(fdb, 'r3'), opts({ force: true }));
check('... over capacity when staff force it', res.outcome === 'sent' && fdb.logLines('r3') === 1);

fdb = fakeDb();
fdb.guests.push({ id: 'g-wys', email: 'known@example.com', status: 'invited', source: 'invitation' });
fdb.emailLog.push({ guest_id: 'g-wys', kind: 'invitation', to_email: 'known@example.com' });
fdb.add('r4', { email: 'known@example.com' });
res = await M.markSentOne(fdb.deps, fresh(fdb, 'r4'), opts());
check('Address already invited in WYS 2026: blocked, not invited twice', res.outcome === 'blocked' && res.code === 'already_on_list' && fdb.guests.length === 1 && fdb.emailLog.length === 1, JSON.stringify(res));
fdb.add('r5'); await M.markSentOne(fdb.deps, fresh(fdb, 'r5'), opts());
fdb.add('r6', { email: 'r5@example.com' });
res = await M.markSentOne(fdb.deps, fresh(fdb, 'r6'), opts());
check('Same e-mail as a guest already marked: blocked (one address, one person)', res.outcome === 'blocked' && res.code === 'guest_linked_elsewhere' && fdb.logLines('r5') === 1, JSON.stringify(res));
fdb.add('r7');
fdb.dups.push({ recipient_id: 'r7', match_on: 'name', other_kind: 'guest', other_id: 'g-wys' });
res = await M.markSentOne(fdb.deps, fresh(fdb, 'r7'), opts());
check('Possible same person not dismissed: blocked', res.outcome === 'blocked' && res.code === 'same_person' && !fdb.recipients.find(r => r.id === 'r7').gl_guest_id, JSON.stringify(res));
res = await M.markSentOne(fdb.deps, fresh(fdb, 'r7'), opts({ dismissed: new Set(['r7:g-wys']) }));
check('... marked once staff chose "Not the same person"', res.outcome === 'sent');
fdb.guests.push({ id: 'g-req', email: 'asked@example.com', status: 'requested', source: 'request' });
fdb.add('r8', { email: 'asked@example.com' });
res = await M.markSentOne(fdb.deps, fresh(fdb, 'r8'), opts());
check('Pending /wys26 request not adopted: blocked', res.outcome === 'blocked' && res.code === 'pending_request', JSON.stringify(res));
res = await M.markSentOne(fdb.deps, fresh(fdb, 'r8'), opts({ adopt: true }));
check('... adopted when staff chose it: same guest-list row, its log line', res.outcome === 'sent' && res.adopted === 'request' && res.guest_id === 'g-req' && fdb.logLines('r8') === 1, JSON.stringify(res));
fdb.add('r9', { email: null });
res = await M.markSentOne(fdb.deps, fresh(fdb, 'r9'), opts());
check('No e-mail address: blocked (the guest list and the entry pass need it)', res.outcome === 'blocked' && res.code === 'no_email');
fdb.add('r10', { status: 'declined' });
res = await M.markSentOne(fdb.deps, fresh(fdb, 'r10'), opts());
check('A guest who declined before being invited: not marked', res.outcome === 'skipped' && res.code === 'already_sent');

fdb = fakeDb();
fdb.add('r11'); fdb.failMark = 'refuse';
res = await M.markSentOne(fdb.deps, fresh(fdb, 'r11'), opts());
const r11 = fdb.recipients[0];
check('Recording refused: failed, the link undone, no invited row without its log line', res.outcome === 'failed' && res.code === 'mark_failed' && !r11.gl_guest_id
  && fdb.guests[0].status === 'cancelled' && fdb.monitorMissing() === 0 && r11.sending_at === null && r11.status === 'ready', JSON.stringify(res));
fdb.failMark = null;
res = await M.markSentOne(fdb.deps, fresh(fdb, 'r11'), opts());
check('... marked on the next try: its own row re-opened, same id', res.outcome === 'sent' && r11.gl_guest_id === fdb.guests[0].id && fdb.guests.length === 1 && fdb.logLines('r11') === 1, JSON.stringify(res));
fdb.add('r12'); fdb.failMark = 'lost';
res = await M.markSentOne(fdb.deps, fresh(fdb, 'r12'), opts({ channel: 'in_person' }));
check('Recorded but the answer lost: read back as marked, one log line, not undone', res.outcome === 'sent' && fdb.logLines('r12') === 1
  && fdb.recipients[1].status === 'sent' && fdb.monitorMissing() === 0, JSON.stringify(res));
fdb.add('r13'); fdb.failMark = 'throw';
res = await M.markSentOne(fdb.deps, fresh(fdb, 'r13'), opts());
check('Database error while recording: failed, link undone, monitor green', res.outcome === 'failed' && !fdb.recipients[2].gl_guest_id && fdb.monitorMissing() === 0, JSON.stringify(res));
fdb.failMark = null;
// A platform send interrupted (it may have gone): linked, still ready, no log line yet. Marking it records it.
fdb.guests.push({ id: 'g-unsure', email: 'unsure@example.com', status: 'invited', source: 'invitation' });
fdb.add('r14', { email: 'unsure@example.com', gl_guest_id: 'g-unsure', send_error: 'send_uncertain' });
check('(an interrupted platform send leaves the monitor warning)', fdb.monitorMissing() === 1);
res = await M.markSentOne(fdb.deps, fresh(fdb, 'r14'), opts({ channel: 'email' }));
check('... marking it as sent records it: log line, monitor green, mark cleared', res.outcome === 'sent' && fdb.logLines('r14') === 1
  && fdb.monitorMissing() === 0 && fdb.recipients[3].send_error === null, JSON.stringify(res));
// "Platform e-mail" only records a platform send that may have gone out.
fdb.add('r15');
res = await M.markSentOne(fdb.deps, fresh(fdb, 'r15'), opts({ channel: 'platform' }));
const r15 = fdb.recipients.find(r => r.id === 'r15');
check('"Platform e-mail" for a guest the platform never sent: blocked, nothing linked, lock released', res.outcome === 'blocked' && res.code === 'platform_not_sent'
  && !r15.gl_guest_id && !r15.sending_at && r15.status === 'ready' && fdb.logLines('r15') === 0, JSON.stringify(res));
fdb.guests.push({ id: 'g-unsure2', email: 'unsure2@example.com', status: 'invited', source: 'invitation' });
fdb.add('r16', { email: 'unsure2@example.com', gl_guest_id: 'g-unsure2', send_error: 'send_uncertain' });
res = await M.markSentOne(fdb.deps, fresh(fdb, 'r16'), opts({ channel: 'platform' }));
check('An interrupted send found in the Resend log: recorded as the platform e-mail, one log line', res.outcome === 'sent' && res.channel === 'platform' && fdb.logLines('r16') === 1
  && fdb.journal.some(l => l.recipient_id === 'r16' && l.action === 'invitation_sent' && l.payload.message_id === M.PLATFORM_RECORDED), JSON.stringify(res));
// Sent but not recorded: the platform e-mail went out, so it is recorded as the platform's whatever is chosen.
fdb.guests.push({ id: 'g-gone', email: 'gone@example.com', status: 'invited', source: 'invitation' });
fdb.add('r17', { email: 'gone@example.com', gl_guest_id: 'g-gone', send_error: 'sent_not_recorded' });
check('(an e-mail sent but not recorded leaves the monitor warning)', fdb.monitorMissing() === 1);
res = await M.markSentOne(fdb.deps, fresh(fdb, 'r17'), opts({ channel: 'post' }));
const j17 = fdb.journal.find(l => l.recipient_id === 'r17' && l.action === 'sent_by_hand');
check('Sent but not recorded: recorded as the platform e-mail, the choice kept in the journal, monitor green', res.outcome === 'sent' && res.channel === 'platform'
  && fdb.logLines('r17') === 1 && j17?.payload.channel === 'platform' && j17?.payload.chosen === 'post' && j17?.payload.after === 'sent_not_recorded'
  && fdb.monitorMissing() === 0, JSON.stringify([res, j17]));
const recorded = M.invitationChannels(fdb.journal.filter(l => l.action === 'invitation_sent' || l.action === 'sent_by_hand'));
eq('Tracking shows them as the platform e-mail; a hand mark stays by hand', [recorded.get('r16'), recorded.get('r17'), recorded.get('r14'), recorded.get('r12')], ['platform', 'platform', 'email', 'in_person']);
const chans = M.invitationChannels([
  { recipient_id: 'a', action: 'invitation_sent', payload: { resend: false, message_id: 're_123' } },
  { recipient_id: 'a', action: 'invitation_sent', payload: { resend: true, message_id: 're_456' } },
  { recipient_id: 'b', action: 'invitation_sent', payload: { resend: false, message_id: 'hand:third_party' } },
  { recipient_id: 'c', action: 'sent_by_hand', payload: { channel: 'phone' } },
  { recipient_id: 'd', action: 'invitation_sent', payload: { resend: true, message_id: null } },
]);
eq('Tracking channels: platform, by hand, first send only', [chans.get('a'), chans.get('b'), chans.get('c'), chans.get('d')], ['platform', 'third_party', 'phone', undefined]);

/* 4b. Times on the ticket (Victor, 19 Oct 2026) */
{
  const def = await M.ticketPdf(assets, campaign(), guest('Luck Machin'));
  check('Ticket prints the WYS 2026 times by default, within the line', !def.issues.some((i) => i.code === 'times_too_long'));
  const none = await M.ticketPdf(assets, campaign({ settings: { schedule: [] } }), guest('Luck Machin'));
  check('An empty times list prints nothing and raises nothing', !none.issues.some((i) => i.code === 'times_too_long'));
  const long = await M.ticketPdf(assets, campaign({ settings: { schedule: [
    { label: 'Conference, lunch and afternoon workshops', time: '9:00 to 17:30' },
    { label: 'Cocktail and gala dinner on the terrace', time: '19:30 to 23:30' },
  ] } }), guest('Luck Machin'));
  check('Times too long for the line are reported', long.issues.some((i) => i.code === 'times_too_long'));
}

/* 5. Optional: pixel comparison with the kit's validated samples */
const samples = opt('--samples');
if (samples) {
  const out = opt('--out') || path.join(os.tmpdir(), 'invitations-compare');
  fs.mkdirSync(out, { recursive: true });
  const { createCanvas } = await import(pathToFileURL(path.join(root, 'node_modules/@napi-rs/canvas/index.js')).href);
  const render = async (bytes, scale) => {
    const doc = await pdfjs.getDocument({ data: bytes.slice(), isEvalSupported: false, standardFontDataUrl: FONT_DATA }).promise;
    const page = await doc.getPage(1);
    const vp = page.getViewport({ scale });
    const canvas = createCanvas(Math.round(vp.width), Math.round(vp.height));
    await page.render({ canvasContext: canvas.getContext('2d'), viewport: vp }).promise;
    await doc.destroy();
    return canvas;
  };
  const compare = async (label, ours, sampleFile, scale) => {
    const theirs = new Uint8Array(fs.readFileSync(path.join(samples, sampleFile)));
    const a = await render(ours, scale); const b = await render(theirs, scale);
    const da = a.getContext('2d').getImageData(0, 0, a.width, a.height).data;
    const db = b.getContext('2d').getImageData(0, 0, b.width, b.height).data;
    const diff = createCanvas(a.width, a.height); const dc = diff.getContext('2d'); const img = dc.createImageData(a.width, a.height);
    let n = 0; let minX = 1e9; let minY = 1e9; let maxX = -1; let maxY = -1;
    for (let i = 0; i < da.length; i += 4) {
      const d = Math.abs(da[i] - db[i]) + Math.abs(da[i + 1] - db[i + 1]) + Math.abs(da[i + 2] - db[i + 2]);
      const px = (i / 4) % a.width; const py = Math.floor(i / 4 / a.width);
      if (d > 60) { n++; img.data[i] = 220; img.data[i + 3] = 255; minX = Math.min(minX, px); maxX = Math.max(maxX, px); minY = Math.min(minY, py); maxY = Math.max(maxY, py); }
      else { img.data[i] = img.data[i + 1] = img.data[i + 2] = 255 - (255 - da[i]) / 4; img.data[i + 3] = 255; }
    }
    dc.putImageData(img, 0, 0);
    fs.writeFileSync(path.join(out, `${label}-ours.png`), a.toBuffer('image/png'));
    fs.writeFileSync(path.join(out, `${label}-ours.pdf`), ours);
    fs.writeFileSync(path.join(out, `${label}-sample.png`), b.toBuffer('image/png'));
    fs.writeFileSync(path.join(out, `${label}-diff.png`), diff.toBuffer('image/png'));
    const pct = (100 * n) / (a.width * a.height);
    const box = n ? ` in x ${(minX / scale / M.MM).toFixed(1)} to ${(maxX / scale / M.MM).toFixed(1)} mm, y ${((a.height - maxY) / scale / M.MM).toFixed(1)} to ${((a.height - minY) / scale / M.MM).toFixed(1)} mm from the bottom` : '';
    console.log(`     ${label}: ${n} different pixels of ${a.width * a.height} (${pct.toFixed(3)}%)${box}`);
    return pct;
  };
  // The samples' guest names come from the command line, never from this file.
  const ticketName = opt('--ticket-name');
  const letterGuest = opt('--letter-guest'); // "Name|Job title|Organisation|Greeting"
  if (ticketName) {
    for (const artwork of ['template', 'drawn']) {
      const t = await M.ticketPdf(assets, campaign({ settings: { ticket_artwork: artwork, schedule: [] } }), guest(ticketName));
      const pct = await compare(`ticket-${artwork}`, t.bytes, 'sample_ticket_white.pdf', 4);
      check(`Ticket (${artwork}) matches sample_ticket_white.pdf`, pct < 0.05, `${pct.toFixed(3)}% of pixels differ`);
    }
  }
  if (letterGuest) {
    const [n, pos, org, greet] = letterGuest.split('|');
    const l = await M.letterPdf(assets, campaign(), { name_on_ticket: n, name_on_letter: n, greeting: greet || n, position: pos, organisation: org });
    const pct = await compare('letter', l.bytes, 'sample_letter.pdf', 2);
    // ReportLab squeezed the word spaces of one bullet line (Tw -0.034 pt, its width estimate); pdf-lib
    // keeps natural spaces, so that line's words sit up to 0.2 mm further right. Nothing else differs.
    check('Letter (no signature) matches sample_letter.pdf', pct < 0.3, `${pct.toFixed(3)}% of pixels differ`);
  }
  console.log(`     PNGs in ${out}`);
}

console.log(`\n${pass} PASS, ${fail} FAIL`);
process.exit(fail ? 1 : 0);
