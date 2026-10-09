#!/usr/bin/env node
// Guest-list contract tests (spec §14.1), against a HIDDEN CANARY event only.
//
// What it proves: the guest-list edge function (frozen until 28 Nov, serves
// /wys26) still behaves exactly as WYS needs after a change to gl_*, the
// registration function or the WYS pages: request rules, personal page, RSVP,
// plus-one, staff decide / invite / resend / cancel, the door check-in RPC.
// With --parity it also runs the registration function's wys26-parity
// "register" and compares the row it writes with a guest-list "request" row.
//
// It WRITES rows on the canary event (production database) and SENDS REAL
// E-MAILS to the CONTRACT_EMAIL inbox. It never touches another event: it
// refuses any slug that does not start with "canary-", and any event that is
// not hidden or has a public catalogue row. It deletes the canary's guest rows
// at the start and at the end, and leaves requests closed.
//
// Usage (Node 18+, no dependency):
//   SUPABASE_URL=https://<ref>.supabase.co \
//   SUPABASE_ANON_KEY=<public anon key> \
//   STAFF_JWT=<access token of a verified admin session> \
//   CONTRACT_EMAIL='you+{tag}@your-domain' \
//   node scripts/contract/guest-list.mjs [--slug canary-onsite] [--parity] [--yes]
// Without --yes it only prints the plan. Never commit tokens or keys.
// Optional: SITE_URL (default https://smartmarinaconnect.com; the QR URL check),
//           CONTRACT_CAPTCHA (a Turnstile token, once TURNSTILE_ENFORCE=true).

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const opt = (name, dflt) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : dflt;
};

const SUPABASE_URL = (process.env.SUPABASE_URL || '').replace(/\/+$/, '');
const ANON = process.env.SUPABASE_ANON_KEY || '';
const STAFF = process.env.STAFF_JWT || '';
const EMAIL_TEMPLATE = process.env.CONTRACT_EMAIL || '';
const SITE_URL = (process.env.SITE_URL || 'https://smartmarinaconnect.com').replace(/\/+$/, '');
const CAPTCHA = process.env.CONTRACT_CAPTCHA || undefined;
const SLUG = opt('--slug', 'canary-onsite');
const PARITY = flag('--parity');
const RUN = Date.now().toString(36);

const PLAN = [
  'event: public read of the canary',
  'request ok / duplicate -> ok / honeypot -> ok and no row / missing fields -> 400 / no part -> 400 / closed -> 400 / flood (41 rows) -> 429',
  'guest by token (no checkin_url before confirmation)',
  'staff decide approve -> confirmed + "pass" e-mail logged, checkin_url = /admin/guest-list/<slug>/checkin?token=<token>',
  'staff decide reject (with and without notify)',
  'staff invite -> invited + "invitation" e-mail; rsvp accept -> confirmed + pass; rsvp decline',
  'declined-then-accept with a full event -> 409 full',
  'plus_one request of a confirmed guest; staff resend (pass); staff cancel',
  'gl_checkin ok / already / unknown / undo (and gl_checkin_v2 when it exists)',
  ...(PARITY ? ['registration parity register: same row shape, response and e-mail kinds as guest-list request'] : []),
];

function die(msg) {
  console.error(`contract: ${msg}`);
  process.exit(2);
}

if (!SLUG.startsWith('canary-')) die(`refusing slug "${SLUG}": only canary-* events may be tested`);
if (!flag('--yes')) {
  console.log(`Plan for ${SLUG} (nothing is sent without --yes):`);
  for (const p of PLAN) console.log(`  - ${p}`);
  console.log('Needs SUPABASE_URL, SUPABASE_ANON_KEY, STAFF_JWT, CONTRACT_EMAIL (with {tag}).');
  process.exit(0);
}
if (!SUPABASE_URL || !ANON || !STAFF) die('set SUPABASE_URL, SUPABASE_ANON_KEY and STAFF_JWT');
if (!EMAIL_TEMPLATE.includes('{tag}') || !EMAIL_TEMPLATE.includes('@')) die('set CONTRACT_EMAIL to an inbox you read, with {tag}, e.g. you+{tag}@example.com');

const mail = (tag) => EMAIL_TEMPLATE.replace('{tag}', `smc-${RUN}-${tag}`).toLowerCase();

// ─── HTTP helpers ─────────────────────────────────────────────────────────
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

async function rest(method, path, body) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    method,
    headers: {
      apikey: ANON,
      Authorization: `Bearer ${STAFF}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { json = text; }
  if (!res.ok) throw new Error(`${method} ${path}: ${res.status} ${typeof json === 'string' ? json : JSON.stringify(json)}`);
  return json;
}
const rpc = (name, body) => rest('POST', `rpc/${name}`, body);

// ─── Results ──────────────────────────────────────────────────────────────
let pass = 0, fail = 0;
function check(id, label, ok, detail = '') {
  if (ok) pass++; else fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${id} ${label}${ok ? '' : `  -> ${detail}`}`);
}
const show = (r) => `${r.status} ${JSON.stringify(r.json)}`;

// ─── Fixtures ─────────────────────────────────────────────────────────────
let ev;
async function guestByEmail(email) {
  const rows = await rest('GET', `gl_guest?event_id=eq.${ev.id}&email=eq.${encodeURIComponent(email)}&select=*`);
  return rows[0] || null;
}
async function mailKinds(guestId) {
  const rows = await rest('GET', `gl_email_log?guest_id=eq.${guestId}&select=kind`);
  return rows.map((r) => r.kind);
}
async function setEvent(patch) {
  await rest('PATCH', `gl_event?id=eq.${ev.id}`, patch);
}
async function wipeGuests() {
  // plus-ones first (they reference their host)
  await rest('DELETE', `gl_guest?event_id=eq.${ev.id}&plus_one_of=not.is.null`);
  await rest('DELETE', `gl_guest?event_id=eq.${ev.id}`);
}
const person = (tag, extra = {}) => ({
  first_name: 'Contract', last_name: `Test ${tag}`, email: mail(tag),
  company: 'SMC contract test', job_title: 'Tester', country: 'Monaco', phone: '+377 0000',
  motivation: 'Automated contract test', wants_conference: true, wants_gala: true,
  ...(CAPTCHA ? { captcha: CAPTCHA } : {}), ...extra,
});

async function main() {
  const evs = await rest('GET', `gl_event?slug=eq.${SLUG}&select=*`);
  ev = evs[0];
  if (!ev) die(`no gl_event "${SLUG}" (apply 20261009200000_registration_prereqs)`);
  if (ev.legacy_event_id) die(`"${SLUG}" has a public catalogue row: refusing`);
  if (ev.hidden !== true) die(`"${SLUG}" is not hidden: refusing`);
  const originalCapacity = ev.capacity;

  try {
    await wipeGuests();
    await setEvent({ requests_open: true, capacity: 20, notify_email: null });

    // ── event ──
    let r = await gl({ action: 'event', slug: SLUG });
    check('E1', 'event: public read', r.status === 200 && r.json?.event?.slug === SLUG && r.json?.event?.requests_open === true, show(r));

    // ── request ──
    const A = person('a');
    r = await gl({ action: 'request', slug: SLUG, ...A });
    if (r.status === 400 && r.json?.error === 'captcha') die('Turnstile is enforced: set CONTRACT_CAPTCHA');
    let ga = await guestByEmail(A.email);
    check('Q1', 'request ok -> {ok:true}, one row source=request status=requested',
      r.status === 200 && r.json?.ok === true && ga?.source === 'request' && ga?.status === 'requested' && ga?.wants_conference && ga?.wants_gala, show(r));
    check('Q1b', 'request ack e-mail logged', ga && (await mailKinds(ga.id)).includes('request_ack'));
    r = await gl({ action: 'request', slug: SLUG, ...A });
    const dupes = await rest('GET', `gl_guest?event_id=eq.${ev.id}&email=eq.${encodeURIComponent(A.email)}&select=id`);
    check('Q2', 'duplicate -> same {ok:true}, still one row', r.status === 200 && r.json?.ok === true && dupes.length === 1, show(r));
    const H = person('honeypot');
    r = await gl({ action: 'request', slug: SLUG, ...H, website: 'http://spam.example' });
    check('Q3', 'honeypot -> {ok:true} and no row', r.status === 200 && r.json?.ok === true && !(await guestByEmail(H.email)), show(r));
    r = await gl({ action: 'request', slug: SLUG, ...person('missing', { job_title: '' }) });
    check('Q4', 'missing job title -> 400 missing_fields', r.status === 400 && r.json?.error === 'missing_fields', show(r));
    r = await gl({ action: 'request', slug: SLUG, ...person('nopart', { wants_conference: false, wants_gala: false }) });
    check('Q5', 'no part -> 400 no_part', r.status === 400 && r.json?.error === 'no_part', show(r));
    await setEvent({ requests_open: false });
    r = await gl({ action: 'request', slug: SLUG, ...person('closed') });
    check('Q6', 'closed -> 400 closed', r.status === 400 && r.json?.error === 'closed', show(r));
    await setEvent({ requests_open: true });
    const flood = Array.from({ length: 41 }, (_, i) => ({
      event_id: ev.id, source: 'request', status: 'requested', first_name: 'Flood', last_name: `${i}`,
      email: `flood-${RUN}-${i}@example.invalid`,
    }));
    await rest('POST', 'gl_guest', flood);
    r = await gl({ action: 'request', slug: SLUG, ...person('flood') });
    check('Q7', 'more than 40 requests in 10 minutes -> 429 busy', r.status === 429 && r.json?.error === 'busy', show(r));
    await rest('DELETE', `gl_guest?event_id=eq.${ev.id}&first_name=eq.Flood`);

    // ── guest page ──
    ga = await guestByEmail(A.email);
    r = await gl({ action: 'guest', token: ga.token });
    check('G1', 'guest by token: requested, no checkin_url', r.status === 200 && r.json?.guest?.status === 'requested' && r.json?.guest?.checkin_url === null, show(r));
    r = await gl({ action: 'guest', token: '00000000-0000-4000-8000-000000000000' });
    check('G2', 'unknown token -> 404', r.status === 404, show(r));

    // ── staff decide ──
    r = await gl({ action: 'decide', slug: SLUG, guest_ids: [ga.id], decision: 'approve' }, STAFF);
    ga = await guestByEmail(A.email);
    check('D1', 'approve -> confirmed, pass sent', r.status === 200 && r.json?.approved === 1 && r.json?.sent === 1 && ga.status === 'confirmed', show(r));
    check('D1b', 'pass e-mail logged', (await mailKinds(ga.id)).includes('pass'));
    r = await gl({ action: 'guest', token: ga.token });
    const qrUrl = `${SITE_URL}/admin/guest-list/${SLUG}/checkin?token=${ga.token}`;
    check('D1c', 'QR / checkin_url = /admin/guest-list/<slug>/checkin?token=<token>', r.json?.guest?.checkin_url === qrUrl, show(r));
    try {
      const jobs = await rest('GET', `account_provision_job?source_id=eq.${ga.id}&select=status`);
      check('D1d', 'one provisioning job queued for the confirmed guest (registration_core)', jobs.length === 1, JSON.stringify(jobs));
    } catch {
      console.log('INFO D1d account_provision_job not present (before registration_core)');
    }
    const R1 = person('reject1');
    await gl({ action: 'request', slug: SLUG, ...R1 });
    let gr = await guestByEmail(R1.email);
    r = await gl({ action: 'decide', slug: SLUG, guest_ids: [gr.id], decision: 'reject' }, STAFF);
    gr = await guestByEmail(R1.email);
    check('D2', 'reject without notify -> rejected, no reject e-mail', r.status === 200 && gr.status === 'rejected' && !(await mailKinds(gr.id)).includes('reject'), show(r));
    const R2 = person('reject2');
    await gl({ action: 'request', slug: SLUG, ...R2 });
    gr = await guestByEmail(R2.email);
    r = await gl({ action: 'decide', slug: SLUG, guest_ids: [gr.id], decision: 'reject', notify: true }, STAFF);
    check('D3', 'reject with notify -> reject e-mail', r.status === 200 && (await mailKinds(gr.id)).includes('reject'), show(r));
    r = await gl({ action: 'decide', slug: SLUG, guest_ids: [ga.id], decision: 'approve' });
    check('D4', 'decide without a staff session -> 401', r.status === 401, show(r));

    // ── invite / rsvp ──
    const I = person('invite');
    r = await gl({ action: 'invite', slug: SLUG, guests: [{ first_name: I.first_name, last_name: I.last_name, email: I.email, company: I.company }] }, STAFF);
    let gi = await guestByEmail(I.email);
    check('I1', 'invite -> invited, source invitation, invitation e-mail', r.status === 200 && r.json?.invited === 1 && gi?.status === 'invited' && gi?.source === 'invitation' && (await mailKinds(gi.id)).includes('invitation'), show(r));
    r = await gl({ action: 'rsvp', token: gi.token, answer: 'accept' });
    gi = await guestByEmail(I.email);
    check('I2', 'rsvp accept -> confirmed + pass', r.status === 200 && gi.status === 'confirmed' && (await mailKinds(gi.id)).includes('pass'), show(r));
    r = await gl({ action: 'rsvp', token: gi.token, answer: 'decline' });
    gi = await guestByEmail(I.email);
    check('I3', 'rsvp decline -> declined', r.status === 200 && gi.status === 'declined', show(r));
    const held = (await rest('GET', `gl_guest?event_id=eq.${ev.id}&status=in.(confirmed,invited)&select=id`)).length;
    await setEvent({ capacity: held });
    r = await gl({ action: 'rsvp', token: gi.token, answer: 'accept' });
    check('I4', 'declined-then-accept with a full event -> 409 full', r.status === 409 && r.json?.error === 'full', show(r));
    await setEvent({ capacity: 20 });

    // ── plus-one, resend, cancel ──
    const P = person('plusone');
    r = await gl({ action: 'plus_one', token: ga.token, first_name: P.first_name, last_name: P.last_name, email: P.email, company: P.company });
    const gp = await guestByEmail(P.email);
    check('P1', 'plus-one request -> row source plus_one, requested, linked to the host', r.status === 200 && gp?.source === 'plus_one' && gp?.status === 'requested' && gp?.plus_one_of === ga.id, show(r));
    r = await gl({ action: 'plus_one', token: ga.token, first_name: 'X', last_name: 'Y', email: mail('plusone2') });
    check('P2', 'second plus-one -> 400 already', r.status === 400 && r.json?.error === 'already', show(r));
    r = await gl({ action: 'resend', slug: SLUG, guest_id: ga.id }, STAFF);
    check('S1', 'resend to a confirmed guest -> pass', r.status === 200 && r.json?.ok === true && r.json?.kind === 'pass', show(r));
    r = await gl({ action: 'cancel', slug: SLUG, guest_id: gp.id }, STAFF);
    check('S2', 'cancel -> cancelled', r.status === 200 && (await guestByEmail(P.email)).status === 'cancelled', show(r));

    // ── door ──
    let c = await rpc('gl_checkin', { p_event_id: ev.id, p_token: ga.token, p_guest_id: null, p_undo: false });
    check('K1', 'gl_checkin by QR token -> ok', c?.ok === true && c?.guest_id === ga.id, JSON.stringify(c));
    c = await rpc('gl_checkin', { p_event_id: ev.id, p_token: ga.token, p_guest_id: null, p_undo: false });
    check('K2', 'second scan -> already', c?.ok === true && c?.already === true, JSON.stringify(c));
    c = await rpc('gl_checkin', { p_event_id: ev.id, p_token: '00000000-0000-4000-8000-000000000000', p_guest_id: null, p_undo: false });
    check('K3', 'unknown token -> unknown_token', c?.ok === false && c?.error === 'unknown_token', JSON.stringify(c));
    c = await rpc('gl_checkin', { p_event_id: ev.id, p_token: null, p_guest_id: ga.id, p_undo: true });
    check('K4', 'undo -> undone', c?.ok === true && c?.undone === true, JSON.stringify(c));
    try {
      c = await rpc('gl_checkin_v2', { p_event_id: ev.id, p_token: ga.token, p_guest_id: null, p_undo: false });
      check('K5', 'gl_checkin_v2 on the shared-door canary -> ok', c?.ok === true && c?.guest_id === ga.id, JSON.stringify(c));
    } catch {
      console.log('INFO K5 gl_checkin_v2 not present (before registration_core)');
    }

    // ── parity (registration function, wys26 mode) ──
    if (PARITY) {
      const Z = person('parity');
      r = await fn('registration', { action: 'register', slug: SLUG, ...Z });
      const gz = await guestByEmail(Z.email);
      const legacyCols = ['source', 'status', 'first_name', 'last_name', 'company', 'job_title', 'country', 'phone', 'motivation', 'wants_conference', 'wants_gala', 'conference', 'gala', 'plus_one_of'];
      const B = person('parity-ref');
      await gl({ action: 'request', slug: SLUG, ...B });
      const gb = await guestByEmail(B.email);
      const same = gz && gb && legacyCols.every((k) => k === 'last_name' || JSON.stringify(gz[k]) === JSON.stringify(gb[k]));
      check('Z1', 'parity register -> {ok:true}, row equal to a guest-list request on the legacy columns',
        r.status === 200 && JSON.stringify(r.json) === JSON.stringify({ ok: true }) && same, `${show(r)} row=${JSON.stringify(gz)}`);
      const kinds = gz ? await mailKinds(gz.id) : [];
      check('Z2', 'parity ack logged as request_ack', kinds.includes('request_ack'), JSON.stringify(kinds));
      r = await fn('registration', { action: 'register', slug: SLUG, ...Z });
      check('Z3', 'parity duplicate -> {ok:true}', r.status === 200 && r.json?.ok === true, show(r));
    }
  } finally {
    try {
      await wipeGuests();
      await setEvent({ requests_open: false, capacity: originalCapacity ?? 20 });
      console.log('cleanup: canary guest rows deleted, requests closed');
    } catch (e) {
      console.error('CLEANUP FAILED, clean the canary by hand:', e.message);
      fail++;
    }
  }
  console.log(`\n${pass} PASS, ${fail} FAIL (guest-list contract on ${SLUG}, run ${RUN})`);
  process.exitCode = fail ? 1 : 0;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
