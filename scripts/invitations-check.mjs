// Checks of the "Invitation campaigns" module: title rules, import, duplicates, and the
// ticket and letter PDFs (whole names, auto-shrink, accents, missing glyphs).
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
               export * from './lib/pdf'; export * from './lib/positions'; export * from './lib/norm';`,
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

/* 4. Optional: pixel comparison with the kit's validated samples */
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
      const t = await M.ticketPdf(assets, campaign({ settings: { ticket_artwork: artwork } }), guest(ticketName));
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
