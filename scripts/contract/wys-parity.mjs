#!/usr/bin/env node
// wys26 parity contract: guest-list `request` versus the registration function's parity
// `register` (spec §4.1, §7, §11, §14.1; flags wys_form_v2 / wys_status_edit).
//
// WHAT IT PROVES, on the HIDDEN canary event only (canary-onsite, engine guest_list_v1):
//   1. the same request sent to both functions gives the same HTTP status, the same JSON
//      answer and the same gl_guest row, compared COLUMN BY COLUMN (every column of the
//      table, including any column added later: an unknown column must be equal too);
//   2. the same refusals: honeypot, each missing field, invalid e-mail, no part, closed,
//      unknown event, duplicate (also across the two functions and in another case), flood;
//   3. the same e-mails as logged in gl_email_log (kinds, recipients, sender, event), and,
//      rendered from the repository code for the very rows written: the same subject and
//      words, the acknowledgement adding only "View my request" (personal link), the staff
//      notice identical;
//   4. a parity row is an ordinary guest-list row: guest-list's guest view, staff decide
//      (pass e-mail, QR = /admin/guest-list/<slug>/checkin?token=<token>) and gl_checkin
//      work on it unchanged;
//   5. the personal-page actions behind wys_status_edit (status / update / cancel through
//      `registration`, with the gl_guest.token): what they change and nothing else, the
//      refusals (locked, missing_fields, no_part, sign_in_required), a self-cancelled
//      request brought back by the parity form only, a staff-cancelled one never.
//   Optional (MEMBER_JWT): the user_id rule of a signed-in request (linked only when the
//   account PROVED that very address) and "Add to my account" (attach).
//
// KNOWN DIFFERENCES (on purpose; see supabase/functions/registration/README.md, `register`):
//   - the switch: parity answers 403 not_available while wys_form_v2 is off, EXCEPT on a
//     hidden event (this canary): that is why this script runs with every switch off;
//   - the deployed guest-list (version 6, frozen until 28 Nov) sends the pre-refonte HTML
//     frame without a text part; parity sends the SMC e-mail layout v1 (the repo's
//     guest-list look). Point 3 compares the repository templates; compare the two inboxes
//     by eye once (subject, words, sender, reply-to) before flipping wys_form_v2;
//   - reply-to when the event has no settings.contact_email (this canary): deployed
//     guest-list contact@smartmarinaconnect.com, parity events@m3monaco.com (wys26 sets
//     contact_email: identical there). Not logged, so not checked here: look at the inbox;
//   - parity e-mails go out after the answer (the script waits for them).
//
// SAFETY: it WRITES rows on the canary (production database) and SENDS REAL E-MAILS to the
// CONTRACT_EMAIL inbox (and to CONTRACT_EMAIL with tag "staff" as the staff address). It
// refuses any slug that is not canary-*, wys26 in any form, an event that is not hidden,
// not guest_list_v1 or has a public catalogue row, and runs only while the "provisioning"
// switch is off (an approval below queues an account job; its row is deleted at the end,
// so provision-person skips it). It deletes the canary's guest rows at the start and at the
// end, and puts back requests_open = false, notify_email and capacity as they were.
// The attach test (MEMBER_JWT only) leaves one review_log row (action "attach") about a
// canary row: staff cannot delete review_log rows.
//
// Usage (Node 18+; run from the repository root, it reads the functions' source):
//   node scripts/contract/wys-parity.mjs --offline
//       renders the two functions' templates for sample rows and compares them; no network,
//       no database: safe anywhere, run it after any change to either function.
//   SUPABASE_URL=https://<ref>.supabase.co SUPABASE_ANON_KEY=<public anon key> \
//   STAFF_JWT=<access token of a verified admin session> \
//   CONTRACT_EMAIL='you+{tag}@your-domain' [MEMBER_JWT=<access token of a test account>] \
//   node scripts/contract/wys-parity.mjs [--slug canary-onsite] [--yes]
//       without --yes it only prints the plan. Never commit tokens or keys.
// Optional: SITE_URL (the functions' SITE_URL secret, default https://smartmarinaconnect.com),
//           CONTRACT_CAPTCHA (a Turnstile token; only if TURNSTILE_ENFORCE=true, which this
//           script cannot satisfy for its ~40 requests: run it in soft mode).

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const opt = (name, dflt) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : dflt;
};

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const SUPABASE_URL = (process.env.SUPABASE_URL || '').replace(/\/+$/, '');
const ANON = process.env.SUPABASE_ANON_KEY || '';
const STAFF = process.env.STAFF_JWT || '';
const MEMBER = process.env.MEMBER_JWT || '';
const EMAIL_TEMPLATE = process.env.CONTRACT_EMAIL || '';
const SITE_URL = (process.env.SITE_URL || 'https://smartmarinaconnect.com').replace(/\/+$/, '');
const CAPTCHA = process.env.CONTRACT_CAPTCHA || undefined;
const SLUG = opt('--slug', 'canary-onsite');
const OFFLINE = flag('--offline');
const RUN = Date.now().toString(36);

function die(msg) {
  console.error(`wys-parity: ${msg}`);
  process.exit(2);
}

// ─── Results ──────────────────────────────────────────────────────────────
let pass = 0, fail = 0;
function check(id, label, ok, detail = '') {
  if (ok) pass++; else fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${id} ${label}${ok ? '' : `  -> ${detail}`}`);
}
const info = (msg) => console.log(`INFO ${msg}`);
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// ─── The functions' own templates (same loader as scripts/email-previews.mjs) ──
async function loadRenderers() {
  let ts;
  try {
    ts = (await import('typescript')).default;
  } catch {
    die('the typescript package is needed for the template comparison (run from the repository root)');
  }
  const load = (fn, names) => {
    let src = fs.readFileSync(path.join(ROOT, 'supabase', 'functions', fn, 'index.ts'), 'utf8');
    src = src.replace(/^import .*$/gm, '');
    const js = ts.transpileModule(src, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText;
    const Deno = { env: { get: (k) => (k === 'SITE_URL' ? SITE_URL : undefined) }, serve() {} };
    return new Function('Deno', 'createClient', 'QRCode', `${js}\nreturn { ${names.join(', ')} };`)(Deno, () => ({}), {});
  };
  return {
    gl: load('guest-list', ['renderRequestAck', 'renderStaffNotice']),
    reg: load('registration', ['renderParityAck', 'renderParityStaffNotice']),
  };
}

/** Point 3: the parity e-mails of `row` against guest-list's, from the repository code. */
function compareTemplates(R, id, ev, row) {
  const personal = `${SITE_URL}/${ev.slug}/guest?t=${row.token}`;
  const glAck = R.gl.renderRequestAck(ev, row);
  const pAck = R.reg.renderParityAck(ev, row);
  check(`${id}a`, 'ack subject identical', glAck.subject === pAck.subject, `${glAck.subject} / ${pAck.subject}`);
  check(`${id}b`, 'ack words identical apart from "View my request: <personal link>"',
    pAck.text.replace(`View my request: ${personal}\n\n`, '') === glAck.text, pAck.text);
  const escaped = personal.replace(/&/g, '&amp;');
  check(`${id}c`, 'ack has the "View my request" button to /<slug>/guest?t=<token>',
    pAck.html.includes(`href="${escaped}"`) && pAck.html.includes('View my request'), personal);
  // Apart from the button row, the HTML is guest-list's.
  const strip = (html) => html.replace(/<tr><td class="px" align="left" style="padding:8px 40px 8px;">[\s\S]*?<\/table><\/td><\/tr>/, '');
  check(`${id}d`, 'ack HTML identical apart from the button', strip(pAck.html) === glAck.html);
  const glN = R.gl.renderStaffNotice(ev, row);
  const pN = R.reg.renderParityStaffNotice(ev, row);
  check(`${id}e`, 'staff notice identical (subject, HTML, text)', glN.subject === pN.subject && glN.html === pN.html && glN.text === pN.text, `${glN.subject} / ${pN.subject}`);
  check(`${id}f`, 'no token in a subject', !glAck.subject.includes(String(row.token)) && !pN.subject.includes(String(row.token)));
}

if (OFFLINE) {
  const R = await loadRenderers();
  const ev = {
    id: '00000000-0000-4000-8000-0000000000e1', slug: 'canary-onsite', title: 'Canary <on-site> "test" & co',
    capacity: 20, notify_email: 'staff@example.com', requests_open: true,
    settings: { date_label: 'Friday 27 November 2026', venue: 'Yacht Club de Monaco', city: 'Monaco', contact_email: 'contact@smartmarinaconnect.com' },
  };
  const row = {
    id: '00000000-0000-4000-8000-0000000000a1', token: '3f1c2d4e-5a6b-4c7d-8e9f-0a1b2c3d4e5f', event_id: ev.id,
    source: 'request', status: 'requested', first_name: 'Ana <b>', last_name: "O'Neil & Sons", email: 'ana@example.com',
    phone: '+377 00 00', company: 'Port <Azur>', job_title: 'Harbour master', country: 'Monaco',
    motivation: 'Line one\nLine <two> & "three"', wants_conference: true, wants_gala: false, plus_one_of: null,
  };
  compareTemplates(R, 'T1', ev, row);
  compareTemplates(R, 'T2', { ...ev, title: 'World Yachting Summit 2026', settings: {} }, { ...row, motivation: '', phone: '', country: '', wants_gala: true });
  console.log(`\n${pass} PASS, ${fail} FAIL (wys parity templates, offline)`);
  process.exit(fail ? 1 : 0);
}

// ─── Live run ─────────────────────────────────────────────────────────────
const PLAN = [
  'parity form state: registration `form` on the canary says engine guest_list_v1, parity true',
  'same request to guest-list and to registration: same status, same JSON, rows equal column by column',
  'refusals on both: honeypot, missing first/last name, invalid e-mail, missing company / job title, no part, closed, unknown event, flood (41 rows) -> 429',
  'duplicates on both (same function, across functions, other letter case): same {ok:true}, no new row, no new e-mail',
  'e-mails: gl_email_log kinds, recipients, sender and event identical; repository templates compared for the rows written',
  'personal page (wys_status_edit actions, canary skips the switch): status / update / cancel and their refusals',
  'self-cancelled request: guest-list re-request records nothing; parity re-request brings the same row back; staff-cancelled never',
  'guest-list on a parity row: guest view, staff approve (pass + QR URL), gl_checkin',
  ...(MEMBER ? ['MEMBER_JWT: user_id only for a proven account sending its own address; attach ("Add to my account")'] : []),
];

if (!SLUG.startsWith('canary-') || /wys/i.test(SLUG)) die(`refusing slug "${SLUG}": only canary-* events may be tested, never wys26`);
if (!flag('--yes')) {
  console.log(`Plan for ${SLUG} (nothing is sent without --yes):`);
  for (const p of PLAN) console.log(`  - ${p}`);
  console.log('Needs SUPABASE_URL, SUPABASE_ANON_KEY, STAFF_JWT, CONTRACT_EMAIL (with {tag}); optional MEMBER_JWT.');
  process.exit(0);
}
if (!SUPABASE_URL || !ANON || !STAFF) die('set SUPABASE_URL, SUPABASE_ANON_KEY and STAFF_JWT');
if (!EMAIL_TEMPLATE.includes('{tag}') || !EMAIL_TEMPLATE.includes('@')) die('set CONTRACT_EMAIL to an inbox you read, with {tag}, e.g. you+{tag}@example.com');

const mail = (tag) => EMAIL_TEMPLATE.replace('{tag}', `smc-${RUN}-${tag}`).toLowerCase();
const STAFF_INBOX = mail('staff');

async function fn(name, body, jwt = ANON) {
  const res = await fetch(`${SUPABASE_URL}/functions/v1/${name}`, {
    method: 'POST',
    headers: { apikey: ANON, Authorization: `Bearer ${jwt}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  let json = null;
  try { json = await res.json(); } catch { /* empty */ }
  return { status: res.status, json };
}
const gl = (body, jwt) => fn('guest-list', body, jwt);
const reg = (body, jwt) => fn('registration', body, jwt);
const show = (r) => `${r.status} ${JSON.stringify(r.json)}`;
const sameAnswer = (a, b) => a.status === b.status && same(a.json, b.json);

async function rest(method, p, body) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${p}`, {
    method,
    headers: { apikey: ANON, Authorization: `Bearer ${STAFF}`, 'Content-Type': 'application/json', Prefer: 'return=representation' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { json = text; }
  if (!res.ok) throw new Error(`${method} ${p}: ${res.status} ${typeof json === 'string' ? json : JSON.stringify(json)}`);
  return json;
}
const rpc = (name, body) => rest('POST', `rpc/${name}`, body);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let ev;
const byEmail = async (email) => (await rest('GET', `gl_guest?event_id=eq.${ev.id}&email=eq.${encodeURIComponent(email)}&select=*`))[0] || null;
const countByEmail = async (email) => (await rest('GET', `gl_guest?event_id=eq.${ev.id}&email=ilike.${encodeURIComponent(email)}&select=id`)).length;
const logOf = (guestId) => rest('GET', `gl_email_log?guest_id=eq.${guestId}&select=kind,to_email,sent_by,event_id&order=kind`);
const setEvent = (patch) => rest('PATCH', `gl_event?id=eq.${ev.id}`, patch);
async function wipeGuests() {
  await rest('DELETE', `gl_guest?event_id=eq.${ev.id}&plus_one_of=not.is.null`);
  await rest('DELETE', `gl_guest?event_id=eq.${ev.id}`);
}
/** gl_email_log rows of a guest, waiting for the parity e-mails (sent after the answer). */
async function waitLog(guestId, atLeast, ms = 20000) {
  const until = Date.now() + ms;
  let rows = await logOf(guestId);
  while (rows.length < atLeast && Date.now() < until) {
    await sleep(1000);
    rows = await logOf(guestId);
  }
  return rows;
}

// One request body with the awkward inputs guest-list normalises: spaces, letter case,
// over-long values, a part left out (= wanted), a part as the text "false" (= wanted).
const LONG = (n, c) => c.repeat(n);
function body(tag, extra = {}) {
  return {
    slug: SLUG,
    first_name: `  Contract ${LONG(90, 'x')}  `,
    last_name: 'Parity Test',
    email: `  ${mail(tag).toUpperCase()}  `,
    phone: `+377 ${LONG(50, '9')}`,
    company: `SMC contract <test> & "co" ${LONG(200, 'c')}`,
    job_title: '  Tester  ',
    country: 'Monaco',
    motivation: `Line one\nLine <two> ${LONG(2100, 'm')}`,
    wants_conference: 'false',
    ...(CAPTCHA ? { captcha: CAPTCHA } : {}),
    ...extra,
  };
}

// Columns that differ between two rows by nature (two people, two moments).
const PER_ROW = new Set(['id', 'token', 'email', 'created_at', 'updated_at']);
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Point 1: every column of the two rows. Prints the table, returns the differing columns. */
function compareRows(id, a, b, aEmail, bEmail) {
  const cols = [...new Set([...Object.keys(a), ...Object.keys(b)])].sort();
  const diffs = [];
  const rows = [];
  for (const c of cols) {
    let verdict;
    if (PER_ROW.has(c)) {
      if (c === 'email') verdict = a.email === aEmail && b.email === bEmail ? 'per row (trimmed, lower case: OK)' : 'BAD';
      else if (c === 'token' || c === 'id') verdict = UUID_RE.test(a[c]) && UUID_RE.test(b[c]) && a[c] !== b[c] ? 'per row (DB gen_random_uuid: OK)' : 'BAD';
      else verdict = !Number.isNaN(Date.parse(a[c])) && !Number.isNaN(Date.parse(b[c])) ? 'per row (DB now(): OK)' : 'BAD';
    } else {
      verdict = same(a[c], b[c]) ? 'equal' : 'DIFFERENT';
    }
    if (verdict === 'BAD' || verdict === 'DIFFERENT') diffs.push(c);
    rows.push([c, PER_ROW.has(c) ? '…' : JSON.stringify(a[c]), PER_ROW.has(c) ? '…' : JSON.stringify(b[c]), verdict]);
  }
  const cut = (s) => (s.length > 40 ? `${s.slice(0, 37)}...` : s);
  console.log(`\n  ${'column'.padEnd(18)} ${'guest-list'.padEnd(40)} ${'parity'.padEnd(40)} verdict`);
  for (const [c, x, y, v] of rows) console.log(`  ${c.padEnd(18)} ${cut(x).padEnd(40)} ${cut(y).padEnd(40)} ${v}`);
  console.log('');
  check(id, `rows equal column by column (${cols.length} columns)`, diffs.length === 0, diffs.join(', '));
  return diffs;
}

async function main() {
  const R = await loadRenderers();
  const evs = await rest('GET', `gl_event?slug=eq.${SLUG}&select=*`);
  ev = evs[0];
  if (!ev) die(`no gl_event "${SLUG}"`);
  if (ev.slug === 'wys26' || ev.legacy_event_id) die(`"${SLUG}" has a public catalogue row: refusing`);
  if (ev.hidden !== true) die(`"${SLUG}" is not hidden: refusing`);
  if (ev.engine !== 'guest_list_v1') die(`"${SLUG}" is not a guest_list_v1 event: refusing`);
  const flagsRow = await rest('GET', 'platform_settings?key=eq.registration_flags&select=value');
  if (flagsRow[0]?.value?.provisioning === true) die('the "provisioning" switch is ON: switch it off before a contract run');
  const original = { requests_open: ev.requests_open, capacity: ev.capacity, notify_email: ev.notify_email };

  try {
    await wipeGuests();
    await setEvent({ requests_open: true, capacity: 20, notify_email: STAFF_INBOX });
    ev = (await rest('GET', `gl_event?id=eq.${ev.id}&select=*`))[0];

    // ── 0. the parity form state ──
    let r = await reg({ action: 'form', slug: SLUG });
    check('F1', 'registration form: guest_list_v1, parity true on the hidden canary',
      r.status === 200 && r.json?.engine === 'guest_list_v1' && r.json?.parity === true, show(r));

    // ── 1. the same request to both ──
    const A = body('gl');
    const B = body('parity');
    const ra = await gl({ action: 'request', ...A });
    if (ra.status === 400 && ra.json?.error === 'captcha') die('Turnstile is enforced (TURNSTILE_ENFORCE=true): run in soft mode');
    const rb = await reg({ action: 'register', ...B });
    check('R1', 'same answer: 200 {"ok":true} from both', sameAnswer(ra, rb) && ra.status === 200 && same(ra.json, { ok: true }), `${show(ra)} | ${show(rb)}`);
    const ga = await byEmail(mail('gl'));
    const gb = await byEmail(mail('parity'));
    if (!ga || !gb) die(`a row is missing (guest-list ${!!ga}, parity ${!!gb})`);
    compareRows('R2', ga, gb, mail('gl'), mail('parity'));
    check('R3', 'normalised like guest-list: first name cut to 80, company 160, phone 40, motivation 2000, "false" part = wanted',
      gb.first_name.length === 80 && gb.company.length === 160 && gb.phone.length === 40 && gb.motivation.length === 2000 &&
      gb.wants_conference === true && gb.wants_gala === true && gb.job_title === 'Tester', JSON.stringify(gb).slice(0, 300));

    // ── 3. e-mails ──
    const la = await waitLog(ga.id, 2);
    const lb = await waitLog(gb.id, 2);
    const shape = (rows, guestEmail) => rows.map((x) => ({ kind: x.kind, to: x.to_email === guestEmail ? 'guest' : x.to_email === STAFF_INBOX ? 'staff' : x.to_email, sent_by: x.sent_by, event: x.event_id === ev.id }));
    check('M1', 'guest-list logged request_ack (guest) + staff_notify (staff)',
      same(shape(la, mail('gl')), [{ kind: 'request_ack', to: 'guest', sent_by: null, event: true }, { kind: 'staff_notify', to: 'staff', sent_by: null, event: true }]), JSON.stringify(la));
    check('M2', 'parity logged the same e-mails (kinds, recipients, sender, event)', same(shape(lb, mail('parity')), shape(la, mail('gl'))), JSON.stringify(lb));
    compareTemplates(R, 'M3', ev, gb);
    info('compare the two acknowledgements and staff notices in the inbox once: same subject and words, the parity one adds "View my request" (look: see the header)');

    // ── 2. refusals and duplicates, sent to both ──
    const both = async (id, label, b, expect, tagA, tagB) => {
      const x = await gl({ action: 'request', ...b(tagA) });
      const y = await reg({ action: 'register', ...b(tagB) });
      const rowsA = tagA ? await countByEmail(mail(tagA)) : 0;
      const rowsB = tagB ? await countByEmail(mail(tagB)) : 0;
      check(id, `${label}: ${expect.status} ${JSON.stringify(expect.json)} from both`,
        sameAnswer(x, y) && x.status === expect.status && same(x.json, expect.json) && rowsA === (expect.rows ?? 0) && rowsB === (expect.rows ?? 0),
        `${show(x)} | ${show(y)} | rows ${rowsA}/${rowsB}`);
    };
    const missing = { status: 400, json: { error: 'missing_fields' } };
    await both('E1', 'honeypot', (t) => body(t, { website: 'http://spam.example' }), { status: 200, json: { ok: true } }, 'hp-a', 'hp-b');
    await both('E2', 'no first name', (t) => body(t, { first_name: '   ' }), missing, 'fn-a', 'fn-b');
    await both('E3', 'no last name', (t) => body(t, { last_name: '' }), missing, 'ln-a', 'ln-b');
    await both('E4', 'invalid e-mail', () => body('x', { email: 'not-an-email' }), missing, null, null);
    await both('E5', 'no company', (t) => body(t, { company: '' }), missing, 'co-a', 'co-b');
    await both('E6', 'no job title', (t) => body(t, { job_title: ' ' }), missing, 'jt-a', 'jt-b');
    await both('E7', 'no part', (t) => body(t, { wants_conference: false, wants_gala: false }), { status: 400, json: { error: 'no_part' } }, 'np-a', 'np-b');
    await both('E8', 'unknown event', (t) => body(t, { slug: 'canary-does-not-exist' }), { status: 404, json: { error: 'not_found' } }, 'ue-a', 'ue-b');
    await setEvent({ requests_open: false });
    await both('E9', 'requests closed', (t) => body(t), { status: 400, json: { error: 'closed' } }, 'cl-a', 'cl-b');
    await setEvent({ requests_open: true });

    const before = [(await logOf(ga.id)).length, (await logOf(gb.id)).length];
    await both('D1', 'duplicate, same function', () => body('gl'), { status: 200, json: { ok: true }, rows: 0 }, null, null);
    let x = await gl({ action: 'request', ...body('gl') });
    let y = await reg({ action: 'register', ...body('parity') });
    check('D2', 'duplicate of its own row: {ok:true}, still one row each', sameAnswer(x, y) && (await countByEmail(mail('gl'))) === 1 && (await countByEmail(mail('parity'))) === 1, `${show(x)} | ${show(y)}`);
    x = await gl({ action: 'request', ...body('parity') });
    y = await reg({ action: 'register', ...body('gl') });
    check('D3', 'duplicate across the functions: {ok:true}, nothing written', sameAnswer(x, y) && same(x.json, { ok: true }) && (await countByEmail(mail('gl'))) === 1 && (await countByEmail(mail('parity'))) === 1, `${show(x)} | ${show(y)}`);
    y = await reg({ action: 'register', ...body('gl', { email: mail('gl').replace(/^./, (c) => c.toUpperCase()) }) });
    check('D4', 'duplicate in another letter case: {ok:true}, nothing written', y.status === 200 && same(y.json, { ok: true }) && (await countByEmail(mail('gl'))) === 1, show(y));
    await sleep(3000);
    const after = [(await logOf(ga.id)).length, (await logOf(gb.id)).length];
    check('D5', 'duplicates sent no e-mail', same(before, after), `${before} -> ${after}`);
    const unchanged = await byEmail(mail('parity'));
    check('D6', 'duplicates changed nothing on the row', same({ ...unchanged, updated_at: 0 }, { ...gb, updated_at: 0 }), JSON.stringify(unchanged).slice(0, 200));

    const flood = Array.from({ length: 41 }, (_, i) => ({
      event_id: ev.id, source: 'request', status: 'requested', first_name: 'Flood', last_name: `${i}`, email: `flood-${RUN}-${i}@example.invalid`,
    }));
    await rest('POST', 'gl_guest', flood);
    await both('E10', 'flood (more than 40 requests in 10 minutes)', (t) => body(t), { status: 429, json: { error: 'busy' } }, 'fl-a', 'fl-b');
    await rest('DELETE', `gl_guest?event_id=eq.${ev.id}&first_name=eq.Flood`);

    // ── 5. personal page (wys_status_edit; the hidden canary skips the switch) ──
    r = await reg({ action: 'status', token: gb.token });
    check('S1', 'status by personal link: requested, can edit and cancel, e-mail masked, not linked',
      r.status === 200 && r.json?.via === 'guest_link' && r.json?.status === 'requested' && r.json?.can_edit === true && r.json?.can_cancel === true &&
      r.json?.linked === false && r.json?.request?.email_masked && !String(r.json.request.email_masked).includes(mail('parity').split('@')[0].slice(1)), show(r));
    r = await reg({ action: 'status', token: '00000000-0000-4000-8000-000000000000' });
    check('S2', 'unknown personal link -> 404 not_found', r.status === 404 && r.json?.error === 'not_found', show(r));
    const pre = await byEmail(mail('parity'));
    r = await reg({ action: 'update', token: gb.token, company: '  New company  ', wants_gala: false });
    const post = await byEmail(mail('parity'));
    const changed = Object.keys(post).filter((k) => !same(pre[k], post[k])).sort();
    check('S3', 'update changes only company, wants_gala (and updated_at)',
      r.status === 200 && r.json?.request?.company === 'New company' && same(changed, ['company', 'updated_at', 'wants_gala']) && post.company === 'New company', `${show(r)} changed=${changed}`);
    r = await reg({ action: 'update', token: gb.token, company: '' });
    check('S4', 'update without a company -> 400 missing_fields', r.status === 400 && r.json?.error === 'missing_fields', show(r));
    r = await reg({ action: 'update', token: gb.token, wants_conference: false });
    check('S5', 'update leaving no part -> 400 no_part', r.status === 400 && r.json?.error === 'no_part', show(r));
    r = await reg({ action: 'update', token: gb.token, first_name: 'Mallory', email: 'other@example.com' });
    const post2 = await byEmail(mail('parity'));
    check('S6', 'names and e-mail are never changed', r.status === 200 && post2.first_name === post.first_name && post2.email === post.email, show(r));
    r = await reg({ action: 'attach', token: gb.token });
    check('S7', 'attach without a session -> 401 sign_in_required', r.status === 401 && r.json?.error === 'sign_in_required', show(r));

    // Self-cancel, then the two forms again.
    r = await reg({ action: 'cancel', token: gb.token });
    let gc = await byEmail(mail('parity'));
    check('C1', 'cancel -> cancelled; decided_at / decided_by empty; cancelled_at stamped',
      r.status === 200 && same(r.json, { ok: true, status: 'cancelled' }) && gc.status === 'cancelled' && !gc.decided_at && !gc.decided_by && !!gc.cancelled_at, show(r));
    r = await gl({ action: 'guest', token: gb.token });
    check('C2', 'guest-list guest view of the cancelled request: status cancelled', r.status === 200 && r.json?.guest?.status === 'cancelled', show(r));
    r = await reg({ action: 'update', token: gb.token, country: 'France' });
    x = await reg({ action: 'cancel', token: gb.token });
    check('C3', 'update / cancel of a cancelled request -> 409 locked', r.status === 409 && r.json?.error === 'locked' && x.status === 409 && x.json?.error === 'locked', `${show(r)} | ${show(x)}`);
    const acksBefore = (await logOf(gb.id)).filter((l) => l.kind === 'request_ack').length;
    r = await gl({ action: 'request', ...body('parity') });
    gc = await byEmail(mail('parity'));
    check('C4', 'guest-list re-request of a self-cancelled request: {ok:true}, nothing recorded (frozen guest-list)', r.status === 200 && same(r.json, { ok: true }) && gc.status === 'cancelled', show(r));
    r = await reg({ action: 'register', ...body('parity') });
    const back = await byEmail(mail('parity'));
    const logAfter = await waitLog(gb.id, (await logOf(gb.id)).length + 1);
    const acksAfter = logAfter.filter((l) => l.kind === 'request_ack').length;
    check('C5', 'parity re-request: same row and token back to requested, cancelled_at cleared, a new acknowledgement',
      r.status === 200 && same(r.json, { ok: true }) && back.id === gb.id && back.token === gb.token && back.status === 'requested' && back.cancelled_at === null && acksAfter === acksBefore + 1,
      `${show(r)} status=${back.status} acks ${acksBefore}->${acksAfter}`);
    await sleep(2000);
    const staffNotices = (await logOf(gb.id)).filter((l) => l.kind === 'staff_notify').length;
    check('C5b', 'revived within a day: no second staff notice for that row', staffNotices === 1, `${staffNotices} staff_notify`);
    await gl({ action: 'cancel', slug: SLUG, guest_id: ga.id }, STAFF);
    r = await reg({ action: 'register', ...body('gl') });
    const staffCancelled = await byEmail(mail('gl'));
    check('C6', 'a request cancelled by staff never comes back through the parity form', r.status === 200 && same(r.json, { ok: true }) && staffCancelled.status === 'cancelled' && !!staffCancelled.decided_by, show(r));

    // ── 4. guest-list on a parity row ──
    r = await gl({ action: 'guest', token: gb.token });
    check('G1', 'guest-list guest view of a parity row: requested, no checkin_url', r.status === 200 && r.json?.guest?.status === 'requested' && r.json?.guest?.checkin_url === null, show(r));
    r = await gl({ action: 'decide', slug: SLUG, guest_ids: [gb.id], decision: 'approve' }, STAFF);
    const gbc = await byEmail(mail('parity'));
    check('G2', 'guest-list staff approve of a parity row -> confirmed, pass e-mail', r.status === 200 && r.json?.approved === 1 && r.json?.sent === 1 && gbc.status === 'confirmed' && (await logOf(gb.id)).some((l) => l.kind === 'pass'), show(r));
    r = await gl({ action: 'guest', token: gb.token });
    check('G3', 'QR / checkin_url = /admin/guest-list/<slug>/checkin?token=<the same token>', r.json?.guest?.checkin_url === `${SITE_URL}/admin/guest-list/${SLUG}/checkin?token=${gb.token}`, show(r));
    const c = await rpc('gl_checkin', { p_event_id: ev.id, p_token: gb.token, p_guest_id: null, p_undo: false });
    check('G4', 'gl_checkin with the parity row token -> ok', c?.ok === true && c?.guest_id === gb.id, JSON.stringify(c));
    r = await reg({ action: 'status', token: gb.token });
    x = await reg({ action: 'cancel', token: gb.token });
    check('G5', 'personal page of a confirmed guest: no edit, no cancel (RSVP decline stays on guest-list)',
      r.status === 200 && r.json?.can_edit === false && r.json?.can_cancel === false && r.json?.request === null && x.status === 409, `${show(r)} | ${show(x)}`);

    // ── optional: a signed-in request ──
    if (MEMBER) {
      const ures = await fetch(`${SUPABASE_URL}/auth/v1/user`, { headers: { apikey: ANON, Authorization: `Bearer ${MEMBER}` } });
      const u = await ures.json().catch(() => null);
      if (!ures.ok || !u?.id) {
        check('U0', 'MEMBER_JWT is a live session', false, `${ures.status}`);
      } else {
        const prof = (await rest('GET', `profiles?user_id=eq.${u.id}&select=email,email_proven_at`))[0] || {};
        const proven = !!prof.email_proven_at && String(prof.email || '').toLowerCase() === String(u.email || '').toLowerCase();
        info(`member account ${u.id}: ${proven ? 'PROVEN' : 'not proven'} address`);
        const own = String(u.email).toLowerCase();
        if (await byEmail(own)) await rest('DELETE', `gl_guest?event_id=eq.${ev.id}&email=eq.${encodeURIComponent(own)}`);
        r = await reg({ action: 'register', ...body('member', { email: own }) }, MEMBER);
        const gm = await byEmail(own);
        check('U1', `signed in with its own address: user_id ${proven ? 'set' : 'left empty (address not proven)'}`,
          r.status === 200 && same(r.json, { ok: true }) && gm && gm.user_id === (proven ? u.id : null), `${show(r)} user_id=${gm?.user_id}`);
        r = await reg({ action: 'register', ...body('member-other') }, MEMBER);
        const go = await byEmail(mail('member-other'));
        check('U2', 'signed in with another address: user_id empty', r.status === 200 && go && go.user_id === null, `${show(r)} user_id=${go?.user_id}`);
        if (gm?.user_id) await rest('PATCH', `gl_guest?id=eq.${gm.id}`, { user_id: null });
        r = await reg({ action: 'attach', token: go.token }, MEMBER);
        const ga2 = await byEmail(mail('member-other'));
        check('U3', 'attach with a session ("Add to my account") links that one row', r.status === 200 && ga2.user_id === u.id, show(r));
        r = await reg({ action: 'status', token: go.token }, MEMBER);
        check('U4', 'status then says linked_to_me', r.status === 200 && r.json?.linked_to_me === true, show(r));
        r = await reg({ action: 'attach', token: go.token }, MEMBER);
        check('U5', 'attach again -> {ok:true, already:true}', r.status === 200 && r.json?.already === true, show(r));
      }
    }
  } finally {
    try {
      await wipeGuests();
      await setEvent({ requests_open: false, capacity: original.capacity ?? 20, notify_email: original.notify_email });
      console.log('cleanup: canary guest rows deleted, requests closed, notify_email and capacity restored');
    } catch (e) {
      console.error('CLEANUP FAILED, clean the canary by hand:', e.message);
      fail++;
    }
  }
  console.log(`\n${pass} PASS, ${fail} FAIL (wys parity contract on ${SLUG}, run ${RUN})`);
  process.exitCode = fail ? 1 : 0;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
