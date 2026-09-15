// A small PostgREST, enough for what supabase-js sends from this app:
// select with nested embeds (alias:table!hint(cols)), horizontal filters incl.
// or/and/not and embedded filters, order, limit/offset, single/maybeSingle,
// exact counts, and insert/upsert/update/delete with return=representation.
// Relationships come from the live schema's foreign keys (relations.ts), so an
// embed resolves to an object or an array exactly as it would in production.
import { table, persist, uuid, nowIso, Row } from './store';
import { RELATIONS } from './relations';

type SelectNode =
  | { kind: 'star' }
  | { kind: 'col'; name: string; alias: string; path: string[]; text: boolean }
  | { kind: 'embed'; alias: string; table: string; hints: string[]; inner: boolean; spread: boolean; children: SelectNode[] };

export const misses: string[] = [];
const warn = (msg: string) => {
  if (!misses.includes(msg)) misses.push(msg);
  console.warn('[demo]', msg);
};

// ─── select parsing ─────────────────────────────────────────────────
function splitTop(s: string, sep = ','): string[] {
  const out: string[] = [];
  let depth = 0, cur = '', quote = false;
  for (const ch of s) {
    if (ch === '"') quote = !quote;
    if (!quote) {
      if (ch === '(') depth++;
      if (ch === ')') depth--;
      if (ch === sep && depth === 0) { out.push(cur); cur = ''; continue; }
    }
    cur += ch;
  }
  if (cur.trim()) out.push(cur);
  return out.map(x => x.trim()).filter(Boolean);
}

export function parseSelect(sel: string | null): SelectNode[] {
  if (!sel || sel.trim() === '' || sel.trim() === '*') return [{ kind: 'star' }];
  return splitTop(sel.replace(/\s+/g, '')).map(parseNode);
}

function parseNode(tok: string): SelectNode {
  if (tok === '*') return { kind: 'star' };
  const paren = tok.indexOf('(');
  if (paren > -1 && tok.endsWith(')')) {
    let head = tok.slice(0, paren);
    const inner = tok.slice(paren + 1, -1);
    let spread = false;
    if (head.startsWith('...')) { spread = true; head = head.slice(3); }
    let alias = '';
    const colon = head.indexOf(':');
    if (colon > -1) { alias = head.slice(0, colon); head = head.slice(colon + 1); }
    const [tbl, ...hints] = head.split('!');
    return {
      kind: 'embed', alias: alias || tbl, table: tbl, hints: hints.filter(h => h !== 'inner' && h !== 'left'),
      inner: hints.includes('inner'), spread, children: parseSelect(inner),
    };
  }
  let alias = '';
  let expr = tok;
  const colon = tok.indexOf(':');
  // `alias:col` but not `col::cast`
  if (colon > -1 && tok[colon + 1] !== ':') { alias = tok.slice(0, colon); expr = tok.slice(colon + 1); }
  expr = expr.replace(/::\w+$/, '');
  const text = expr.includes('->>');
  const path = expr.split(/->>?/);
  const name = path.shift()!;
  return { kind: 'col', name, alias: alias || (path.length ? path[path.length - 1] : name), path, text };
}

// ─── relationships ──────────────────────────────────────────────────
function resolveEmbed(parent: string, node: Extract<SelectNode, { kind: 'embed' }>) {
  let cands = [
    ...RELATIONS.filter(r => r.t === parent && r.ft === node.table).map(r => ({ r, many: false })),
    ...RELATIONS.filter(r => r.t === node.table && r.ft === parent).map(r => ({ r, many: true })),
  ];
  if (node.hints.length) {
    const hinted = cands.filter(c => node.hints.some(h => h === c.r.c || h === c.r.k || h === c.r.fc));
    if (hinted.length) cands = hinted;
  }
  if (!cands.length) {
    warn(`no relationship ${parent} -> ${node.table}`);
    return null;
  }
  return cands[0];
}

// ─── filters ────────────────────────────────────────────────────────
type Filter = { col: string; op: string; val: string; neg: boolean } | { logic: 'or' | 'and'; neg: boolean; items: Filter[] };

function parseFilterValue(raw: string): { op: string; val: string; neg: boolean } {
  let neg = false;
  let s = raw;
  if (s.startsWith('not.')) { neg = true; s = s.slice(4); }
  const dot = s.indexOf('.');
  return { op: dot > -1 ? s.slice(0, dot) : s, val: dot > -1 ? s.slice(dot + 1) : '', neg };
}

function parseLogic(expr: string): Filter[] {
  // expr is the inside of or=( ... )
  return splitTop(expr).map(part => {
    const m = part.match(/^(not\.)?(or|and)\((.*)\)$/);
    if (m) return { logic: m[2] as 'or' | 'and', neg: !!m[1], items: parseLogic(m[3]) };
    const dot = part.indexOf('.');
    const col = part.slice(0, dot);
    return { col, ...parseFilterValue(part.slice(dot + 1)) };
  });
}

function unquote(v: string) {
  return v.length >= 2 && v.startsWith('"') && v.endsWith('"') ? v.slice(1, -1) : v;
}

function listVals(v: string): string[] {
  const inner = v.replace(/^\(/, '').replace(/\)$/, '').replace(/^\{/, '').replace(/\}$/, '');
  return splitTop(inner).map(unquote);
}

function cmp(a: any, b: string): number {
  if (a === null || a === undefined) return NaN;
  const na = Number(a), nb = Number(b);
  if (typeof a !== 'boolean' && a !== '' && b !== '' && !isNaN(na) && !isNaN(nb)) return na - nb;
  return String(a) < b ? -1 : String(a) > b ? 1 : 0;
}

function likeToRegex(p: string, flags: string) {
  const esc = p.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/[*%]/g, '.*').replace(/_/g, '.');
  return new RegExp(`^${esc}$`, flags);
}

function getPath(row: Row, col: string): any {
  if (!col.includes('->')) return row[col];
  const [head, ...rest] = col.split(/->>?/);
  let v = row[head];
  for (const k of rest) v = v == null ? undefined : v[unquote(k)];
  return v;
}

function testOne(row: Row, f: { col: string; op: string; val: string; neg: boolean }): boolean {
  const v = getPath(row, f.col);
  const val = unquote(f.val);
  let r: boolean;
  switch (f.op) {
    case 'eq': r = v !== null && v !== undefined && (typeof v === 'boolean' ? String(v) === val : cmp(v, val) === 0); break;
    case 'neq': r = v !== null && v !== undefined && !(typeof v === 'boolean' ? String(v) === val : cmp(v, val) === 0); break;
    case 'gt': r = cmp(v, val) > 0; break;
    case 'gte': r = cmp(v, val) >= 0; break;
    case 'lt': r = cmp(v, val) < 0; break;
    case 'lte': r = cmp(v, val) <= 0; break;
    case 'like': r = v != null && likeToRegex(val, '').test(String(v)); break;
    case 'ilike': r = v != null && likeToRegex(val, 'i').test(String(v)); break;
    case 'is':
      r = val === 'null' ? v === null || v === undefined : val === 'true' ? v === true : val === 'false' ? v === false : false;
      break;
    case 'in': r = listVals(val).some(x => v !== null && v !== undefined && String(v) === x); break;
    case 'cs': {
      const want = val.startsWith('{') ? listVals(val) : (() => { try { return JSON.parse(val); } catch { return [val]; } })();
      if (Array.isArray(v)) r = (Array.isArray(want) ? want : [want]).every((x: any) => v.map(String).includes(String(x)));
      else if (v && typeof v === 'object') r = Object.entries(want || {}).every(([k, x]) => JSON.stringify(v[k]) === JSON.stringify(x));
      else r = false;
      break;
    }
    case 'cd': r = Array.isArray(v) && v.every(x => listVals(val).includes(String(x))); break;
    case 'ov': r = Array.isArray(v) && v.some(x => listVals(val).includes(String(x))); break;
    case 'fts': case 'plfts': case 'phfts': case 'wfts':
      r = v != null && String(v).toLowerCase().includes(val.replace(/[':&|!]/g, ' ').trim().toLowerCase()); break;
    default:
      warn(`unsupported filter op ${f.op}`);
      r = true;
  }
  return f.neg ? !r : r;
}

function testFilter(row: Row, f: Filter): boolean {
  if ('logic' in f) {
    const r = f.logic === 'or' ? f.items.some(i => testFilter(row, i)) : f.items.every(i => testFilter(row, i));
    return f.neg ? !r : r;
  }
  return testOne(row, f);
}

const RESERVED = new Set(['select', 'order', 'limit', 'offset', 'on_conflict', 'columns']);

interface Query {
  top: Filter[];
  embedded: Record<string, Filter[]>; // alias path -> filters
  order: { col: string; desc: boolean; nullsFirst: boolean }[];
  limit?: number;
  offset?: number;
}

function parseQuery(params: URLSearchParams): Query {
  const q: Query = { top: [], embedded: {}, order: [] };
  params.forEach((value, key) => {
    if (RESERVED.has(key)) return;
    const logic = key.match(/^(?:(.+)\.)?(not\.)?(or|and)$/);
    if (logic) {
      const f: Filter = { logic: logic[3] as 'or' | 'and', neg: !!logic[2], items: parseLogic(value.replace(/^\(/, '').replace(/\)$/, '')) };
      if (logic[1]) (q.embedded[logic[1]] ||= []).push(f); else q.top.push(f);
      return;
    }
    const pv = parseFilterValue(value);
    // `a.b` is an embedded filter unless `a` is a JSON arrow path
    if (key.includes('.') && !key.includes('->')) {
      const i = key.lastIndexOf('.');
      (q.embedded[key.slice(0, i)] ||= []).push({ col: key.slice(i + 1), ...pv });
    } else {
      q.top.push({ col: key, ...pv });
    }
  });
  const order = params.get('order');
  if (order) {
    for (const part of splitTop(order)) {
      const [col, ...mods] = part.split('.');
      const desc = mods.includes('desc');
      q.order.push({ col, desc, nullsFirst: mods.includes('nullsfirst') ? true : mods.includes('nullslast') ? false : desc });
    }
  }
  if (params.get('limit')) q.limit = Number(params.get('limit'));
  if (params.get('offset')) q.offset = Number(params.get('offset'));
  return q;
}

function sortRows(rows: Row[], order: Query['order']) {
  if (!order.length) return rows;
  return [...rows].sort((a, b) => {
    for (const o of order) {
      const va = getPath(a, o.col), vb = getPath(b, o.col);
      const an = va === null || va === undefined, bn = vb === null || vb === undefined;
      if (an || bn) {
        if (an && bn) continue;
        return (an ? -1 : 1) * (o.nullsFirst ? 1 : -1);
      }
      const c = cmp(va, String(vb));
      if (c !== 0 && !isNaN(c)) return o.desc ? -c : c;
    }
    return 0;
  });
}

// ─── projection ─────────────────────────────────────────────────────
function project(tableName: string, row: Row, nodes: SelectNode[], q: Query, prefix: string): Row | null {
  const out: Row = {};
  for (const n of nodes) {
    if (n.kind === 'star') { Object.assign(out, row); continue; }
    if (n.kind === 'col') {
      if (n.name === 'count' && !(n.name in row)) continue;
      let v = row[n.name];
      for (const k of n.path) v = v == null ? null : v[unquote(k)];
      if (n.text && v != null && typeof v === 'object') v = JSON.stringify(v);
      out[n.alias] = v === undefined ? null : v;
      continue;
    }
    const rel = resolveEmbed(tableName, n);
    const key = prefix ? `${prefix}.${n.alias}` : n.alias;
    if (!rel) { out[n.alias] = null; continue; }
    const target = table(n.table);
    let related = rel.many
      ? target.filter(t => t[rel.r.c] != null && String(t[rel.r.c]) === String(row[rel.r.fc]))
      : target.filter(t => row[rel.r.c] != null && String(t[rel.r.fc]) === String(row[rel.r.c]));
    const ef = q.embedded[key] || [];
    related = related.filter(r => ef.every(f => testFilter(r, f)));
    const countOnly = n.children.length === 1 && n.children[0].kind === 'col' && n.children[0].name === 'count';
    if (countOnly) { out[n.alias] = [{ count: related.length }]; continue; }
    const projected = related.map(r => project(n.table, r, n.children, q, key)).filter(Boolean) as Row[];
    if (n.inner && projected.length === 0) return null;
    if (rel.many) {
      out[n.alias] = projected;
    } else {
      const one = projected[0] ?? null;
      if (n.spread && one) Object.assign(out, one); else out[n.alias] = one;
    }
  }
  return out;
}

// ─── request handling ───────────────────────────────────────────────
export interface PgResponse { status: number; body: any; headers?: Record<string, string> }

const pgError = (status: number, code: string, message: string): PgResponse =>
  ({ status, body: { code, message, details: null, hint: null } });

function finish(rows: Row[], headers: Headers, total: number | null, method: string): PgResponse {
  const accept = headers.get('accept') || '';
  const h: Record<string, string> = {};
  if (total !== null) h['content-range'] = rows.length ? `0-${rows.length - 1}/${total}` : `*/${total}`;
  if (method === 'HEAD') return { status: 200, body: null, headers: h };
  if (accept.includes('vnd.pgrst.object')) {
    if (rows.length !== 1) return pgError(406, 'PGRST116', `JSON object requested, multiple (or no) rows returned (${rows.length} rows)`);
    return { status: 200, body: rows[0], headers: h };
  }
  return { status: 200, body: rows, headers: h };
}

function withDefaults(tableName: string, input: Row): Row {
  const row: Row = { ...input };
  if (row.id === undefined && !['organization_members'].includes(tableName)) row.id = uuid();
  if (row.created_at === undefined) row.created_at = nowIso();
  if (row.updated_at === undefined) row.updated_at = nowIso();
  return row;
}

export function handleTable(method: string, tableName: string, params: URLSearchParams, headers: Headers, body: any): PgResponse {
  const rows = table(tableName);
  const q = parseQuery(params);
  const nodes = parseSelect(params.get('select'));
  const prefer = headers.get('prefer') || '';
  const wantCount = /count=(exact|planned|estimated)/.test(prefer);
  const wantRows = method === 'GET' || method === 'HEAD' || prefer.includes('return=representation');

  const render = (list: Row[]) => list.map(r => project(tableName, r, nodes, q, '')).filter(Boolean) as Row[];

  if (method === 'GET' || method === 'HEAD') {
    let matched = rows.filter(r => q.top.every(f => testFilter(r, f)));
    let projected = render(sortRows(matched, q.order));
    const total = projected.length;
    const off = q.offset || 0;
    projected = q.limit !== undefined ? projected.slice(off, off + q.limit) : projected.slice(off);
    matched = [];
    return finish(projected, headers, wantCount ? total : null, method);
  }

  if (method === 'POST') {
    const items: Row[] = (Array.isArray(body) ? body : [body]).filter(Boolean);
    const upsert = prefer.includes('resolution=');
    const ignore = prefer.includes('ignore-duplicates');
    const conflictCols = (params.get('on_conflict') || 'id').split(',');
    const written: Row[] = [];
    for (const item of items) {
      if (upsert) {
        const existing = rows.find(r => conflictCols.every(c => item[c] !== undefined && String(r[c]) === String(item[c])));
        if (existing) {
          if (!ignore) Object.assign(existing, item, { updated_at: nowIso() });
          written.push(existing);
          continue;
        }
      }
      const row = withDefaults(tableName, item);
      rows.push(row);
      written.push(row);
    }
    persist();
    return wantRows ? finish(render(written), headers, wantCount ? written.length : null, method) : { status: 201, body: null };
  }

  if (method === 'PATCH') {
    const matched = rows.filter(r => q.top.every(f => testFilter(r, f)));
    for (const r of matched) Object.assign(r, body || {}, { updated_at: nowIso() });
    persist();
    return wantRows ? finish(render(matched), headers, wantCount ? matched.length : null, method) : { status: 204, body: null };
  }

  if (method === 'DELETE') {
    const matched = rows.filter(r => q.top.every(f => testFilter(r, f)));
    const snapshot = render(matched);
    for (const r of matched) rows.splice(rows.indexOf(r), 1);
    persist();
    return wantRows ? finish(snapshot, headers, wantCount ? matched.length : null, method) : { status: 204, body: null };
  }

  return pgError(405, 'PGRST000', `method ${method} not supported`);
}
