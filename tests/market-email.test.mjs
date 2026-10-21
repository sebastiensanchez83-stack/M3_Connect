// Marina requests (21 Oct 2026): the e-mail the requester gets when M3 changes a status, and the
// lists the admin page offers, checked against their other copies:
//   - the words: src/components/admin/v2/market/marketEmail.ts (the admin page's preview) and
//     supabase/functions/send-notification/index.ts (the e-mail itself) must say the same thing;
//   - the statuses: src/components/admin/v2/market/marketKinds.ts and the database's lists in
//     supabase/migrations/20261021175000_market_requests.sql (market_request_statuses,
//     market_request_mails).
// Run: node tests/market-email.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';
import { marketRequestWords, statusSendsEmail } from '../src/components/admin/v2/market/marketEmail.ts';
import { KIND_STATUSES, REQUEST_KINDS, projectTitle, statusFilterOf, STATUS_FILTERS } from '../src/components/admin/v2/market/marketKinds.ts';

const read = (p) => fs.readFileSync(new URL(p, import.meta.url), 'utf8');
const A = '// ---- market request e-mail words v1';
const B = '// ---- end market request e-mail words ----';
const block = (src) => {
  const a = src.indexOf(A);
  const b = src.indexOf(B);
  assert.ok(a >= 0 && b > a, 'the words block is marked');
  return src.slice(a, b + B.length);
};
const edgeSrc = read('../supabase/functions/send-notification/index.ts');
const clientSrc = read('../src/components/admin/v2/market/marketEmail.ts');
const sql = read('../supabase/migrations/20261021175000_market_requests.sql');

const edgeWords = new Function(
  `${ts.transpileModule(block(edgeSrc), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText}\nreturn marketRequestWords;`,
)();

const STATUSES = [...new Set(Object.values(KIND_STATUSES).flat())];

test('the two copies of the words are the same text', () => {
  assert.equal(block(edgeSrc), block(clientSrc).replace('export function marketRequestWords', 'function marketRequestWords'));
});

test('every kind, status, title, message and name gives the same e-mail in both copies', () => {
  let n = 0;
  for (const kind of [...REQUEST_KINDS, '']) {
    for (const status of [...STATUSES, '']) {
      for (const title of ['', 'Shore power "C to F"']) {
        for (const message of ['', 'Line one.\nLine two.']) {
          for (const first of ['', 'Alex']) {
            assert.deepEqual(edgeWords(kind, status, title, message, first), marketRequestWords(kind, status, title, message, first), `${kind}/${status}`);
            n++;
          }
        }
      }
    }
  }
  assert.ok(n > 100);
});

test('an e-mail exists exactly for the statuses that send one', () => {
  for (const kind of ['rfp', 'consultation', 'project']) {
    for (const status of KIND_STATUSES[kind]) {
      assert.equal(marketRequestWords(kind, status, 'T', '', '') !== null, statusSendsEmail(kind, status), `${kind}/${status}`);
    }
  }
  for (const status of KIND_STATUSES.lead) assert.equal(statusSendsEmail('lead', status), false, `lead/${status}`);
});

test('the turned-down e-mail gives the reason; a message is added to the others', () => {
  const rej = marketRequestWords('rfp', 'rejected', 'Fuel dock', 'Too short.', 'Camille');
  assert.match(rej.body, /Reason: Too short\./);
  assert.match(rej.body, /correct it from your account, then reply to this e-mail: we will look at it again/);
  assert.doesNotMatch(marketRequestWords('project', 'rejected', 'Energy project', 'x', '').body, /look at it again/);
  assert.match(marketRequestWords('consultation', 'closed', 'T', 'Thank you.', '').body, /Message from the M3 team:\nThank you\./);
  assert.equal(marketRequestWords('rfp', 'approved', 'T', '', 'Alex').greeting, 'Hello Alex,');
  assert.equal(marketRequestWords('project', 'approved', 'T', '', '').tab, 'projects');
});

test('a marina project is approved, never published; no e-mail says "partner" (paying sponsors only)', () => {
  // marina_projects is read by its author and M3 only: no member ever sees a project.
  for (const status of KIND_STATUSES.project) {
    const w = marketRequestWords('project', status, 'Energy project', 'x', '');
    if (w) assert.doesNotMatch(`${w.subject} ${w.title} ${w.body}`, /publish|marketplace/i, `project/${status}`);
  }
  assert.equal(marketRequestWords('project', 'approved', 'T', '', '').subject, 'Your marina project is approved');
  for (const kind of REQUEST_KINDS) {
    for (const status of STATUSES) {
      const w = marketRequestWords(kind, status, 'T', '', '');
      if (w) assert.doesNotMatch(`${w.subject} ${w.title} ${w.body} ${w.footer}`, /partner/i, `${kind}/${status}`);
    }
  }
});

test('the statuses are the database lists', () => {
  const lists = {
    rfp: /when 'rfp' then array\[([^\]]+)\]/,
    consultation: /when 'consultation' then array\[([^\]]+)\]/,
    project: /when 'project' then array\[([^\]]+)\]/,
    lead: /when 'lead' then array\[([^\]]+)\]/,
  };
  for (const [kind, re] of Object.entries(lists)) {
    const m = sql.match(re);
    assert.ok(m, `market_request_statuses has ${kind}`);
    assert.deepEqual(m[1].split(',').map((s) => s.trim().replace(/'/g, '')), KIND_STATUSES[kind], kind);
  }
  assert.ok(sql.includes("when p_kind in ('rfp', 'consultation') then coalesce(p_status in ('approved', 'rejected', 'closed'), false)"));
  assert.ok(sql.includes("when p_kind = 'project' then coalesce(p_status in ('approved', 'rejected', 'completed'), false)"));
});

test('a project is named as the database names it', () => {
  assert.equal(projectTitle('energy'), 'Energy project');
  assert.equal(projectTitle('fuel_station'), 'Fuel Station project');
  assert.equal(projectTitle(''), 'Marina project');
  assert.equal(projectTitle(null), 'Marina project');
});

test('the old screens\' ?status= links land on a filter', () => {
  for (const s of [...STATUSES, ...STATUS_FILTERS.map((f) => f.value)]) assert.ok(STATUS_FILTERS.some((f) => f.value === statusFilterOf(s)), s);
  assert.equal(statusFilterOf('new'), 'waiting');
  assert.equal(statusFilterOf('nonsense'), null);
  assert.equal(statusFilterOf(null), null);
});
