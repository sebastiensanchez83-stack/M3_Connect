/* ─── Reading and writing spreadsheets (CSV and .xlsx) ───
 *
 * CSV: the SM26 importer's reader (quotes, doubled quotes, CRLF; separator sniffed
 * from the header; Windows-1252 files from a French Excel re-decoded).
 * .xlsx: read with JSZip (already a dependency) and the browser's XML parser,
 * loaded only when a file is dropped on the import screen. Shared strings,
 * inline strings, numbers and booleans; formulas give their cached value.
 * Old .xls files are refused with a message (save as .xlsx or CSV).
 */

export interface Sheet { name: string; rows: string[][] }

export function sniffDelimiter(str: string): string {
  const firstLine = str.split(/\r?\n/, 1)[0] || '';
  const outside = firstLine.replace(/"[^"]*"/g, '');
  const counts = [',', ';', '\t'].map(d => [d, outside.split(d).length - 1] as const);
  const best = counts.reduce((a, b) => (b[1] > a[1] ? b : a));
  return best[1] > 0 ? best[0] : ',';
}

export function parseCSV(str: string, delim: string): string[][] {
  const rows: string[][] = []; let row: string[] = []; let f = ''; let i = 0; let q = false;
  while (i < str.length) {
    const c = str[i];
    if (q) { if (c === '"') { if (str[i + 1] === '"') { f += '"'; i += 2; continue; } q = false; i++; continue; } f += c; i++; continue; }
    if (c === '"') { q = true; i++; continue; }
    if (c === delim) { row.push(f); f = ''; i++; continue; }
    if (c === '\r') { i++; continue; }
    if (c === '\n') { row.push(f); rows.push(row); row = []; f = ''; i++; continue; }
    f += c; i++;
  }
  if (f.length || row.length) { row.push(f); rows.push(row); }
  return rows;
}

const REPLACEMENT = String.fromCharCode(0xfffd);
const BOM = 0xfeff;

export function decodeText(buf: ArrayBuffer): string {
  let text = new TextDecoder('utf-8').decode(buf);
  if (text.includes(REPLACEMENT)) {
    try { text = new TextDecoder('windows-1252').decode(buf); } catch { /* keep utf-8 */ }
  }
  if (text.charCodeAt(0) === BOM) text = text.slice(1);
  return text;
}

export function readCsvText(text: string): Sheet {
  return { name: 'CSV', rows: parseCSV(text, sniffDelimiter(text)) };
}

/** "B12" gives column 1 (zero-based). */
function colIndex(ref: string): number {
  const letters = (ref.match(/^[A-Z]+/i)?.[0] || 'A').toUpperCase();
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

const NS_MAIN = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const NS_REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';

function textOf(el: Element): string {
  // A shared or inline string: plain <t>, or rich runs <r><t>; phonetic hints (<rPh>) skipped.
  const direct = Array.from(el.children).find(c => c.localName === 't');
  if (direct) return direct.textContent || '';
  return Array.from(el.children).filter(c => c.localName === 'r')
    .map(r => Array.from(r.children).filter(c => c.localName === 't').map(t => t.textContent || '').join('')).join('');
}

export async function readXlsx(buf: ArrayBuffer): Promise<Sheet[]> {
  const head = new Uint8Array(buf.slice(0, 4));
  if (head[0] === 0xd0 && head[1] === 0xcf) throw new Error('old_xls');
  if (head[0] !== 0x50 || head[1] !== 0x4b) throw new Error('not_xlsx');
  const JSZip = (await import('jszip')).default;
  const zip = await JSZip.loadAsync(buf);
  const xml = async (path: string) => {
    const f = zip.file(path);
    return f ? new DOMParser().parseFromString(await f.async('string'), 'application/xml') : null;
  };
  const wb = await xml('xl/workbook.xml');
  const rels = await xml('xl/_rels/workbook.xml.rels');
  if (!wb || !rels) throw new Error('not_xlsx');
  const target = new Map<string, string>();
  for (const r of Array.from(rels.getElementsByTagName('Relationship'))) {
    const t = r.getAttribute('Target') || '';
    target.set(r.getAttribute('Id') || '', t.startsWith('/') ? t.slice(1) : `xl/${t.replace(/^\.\//, '')}`);
  }
  const shared: string[] = [];
  const ss = await xml('xl/sharedStrings.xml');
  if (ss) for (const si of Array.from(ss.getElementsByTagNameNS('*', 'si'))) shared.push(textOf(si));

  const sheets: Sheet[] = [];
  for (const s of Array.from(wb.getElementsByTagNameNS('*', 'sheet'))) {
    const name = s.getAttribute('name') || `Sheet ${sheets.length + 1}`;
    const rid = s.getAttributeNS(NS_REL, 'id') || s.getAttribute('r:id') || '';
    const doc = await xml(target.get(rid) || '');
    if (!doc) continue;
    const rows: string[][] = [];
    for (const row of Array.from(doc.getElementsByTagNameNS('*', 'row'))) {
      const rIndex = Number(row.getAttribute('r') || rows.length + 1) - 1;
      const out: string[] = [];
      let next = 0;
      for (const c of Array.from(row.getElementsByTagNameNS('*', 'c'))) {
        const ref = c.getAttribute('r');
        const ci = ref ? colIndex(ref) : next;
        next = ci + 1;
        const type = c.getAttribute('t');
        const v = Array.from(c.children).find(x => x.localName === 'v')?.textContent ?? '';
        let val = '';
        if (type === 's') val = shared[Number(v)] ?? '';
        else if (type === 'inlineStr') { const is = Array.from(c.children).find(x => x.localName === 'is'); val = is ? textOf(is) : ''; }
        else if (type === 'b') val = v === '1' ? 'TRUE' : 'FALSE';
        else val = v;
        while (out.length < ci) out.push('');
        out[ci] = val;
      }
      while (rows.length < rIndex) rows.push([]);
      rows[rIndex] = out;
    }
    sheets.push({ name, rows });
  }
  return sheets;
}

/* ─── Writing: a one-sheet .xlsx (inline strings) and a CSV Excel opens ─── */

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
// XML 1.0 forbids most control characters; a stray one would make Excel refuse the file.
const xmlSafe = (s: string) => Array.from(s).filter(ch => { const c = ch.charCodeAt(0); return c === 9 || c === 10 || c === 13 || c >= 32; }).join('');
const colName = (i: number) => { let s = ''; i += 1; while (i > 0) { const m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = Math.floor((i - 1) / 26); } return s; };

export async function writeXlsx(rows: (string | number | null | undefined)[][], sheetName: string): Promise<Blob> {
  const JSZip = (await import('jszip')).default;
  const zip = new JSZip();
  const name = esc(sheetName.replace(/[\\/?*[\]:]/g, ' ').slice(0, 31) || 'Sheet1');
  zip.file('[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    + '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
    + '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
    + '<Default Extension="xml" ContentType="application/xml"/>'
    + '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>'
    + '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>'
    + '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>'
    + '</Types>');
  zip.file('_rels/.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
    + '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>'
    + '</Relationships>');
  zip.file('xl/workbook.xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    + `<workbook xmlns="${NS_MAIN}" xmlns:r="${NS_REL}"><sheets><sheet name="${name}" sheetId="1" r:id="rId1"/></sheets></workbook>`);
  zip.file('xl/_rels/workbook.xml.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
    + '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>'
    + '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>'
    + '</Relationships>');
  zip.file('xl/styles.xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    + `<styleSheet xmlns="${NS_MAIN}"><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts>`
    + '<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>'
    + '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>'
    + '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>'
    + '<cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/></cellXfs>'
    + '</styleSheet>');
  const body = rows.map((r, ri) => `<row r="${ri + 1}">${r.map((v, ci) => {
    const ref = `${colName(ci)}${ri + 1}`;
    const style = ri === 0 ? ' s="1"' : '';
    if (typeof v === 'number' && Number.isFinite(v)) return `<c r="${ref}"${style}><v>${v}</v></c>`;
    const s = xmlSafe(String(v ?? ''));
    return s ? `<c r="${ref}"${style} t="inlineStr"><is><t xml:space="preserve">${esc(s)}</t></is></c>` : '';
  }).join('')}</row>`).join('');
  zip.file('xl/worksheets/sheet1.xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    + `<worksheet xmlns="${NS_MAIN}"><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>`
    + `<sheetData>${body}</sheetData></worksheet>`);
  return zip.generateAsync({ type: 'blob', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
}

const csvCell = (v: unknown) => { const s = String(v ?? ''); return /[",;\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };

/** A CSV with a BOM, so Excel reads the accents. */
export function csvBlob(rows: (string | number | null | undefined)[][]): Blob {
  return new Blob([String.fromCharCode(BOM) + rows.map(r => r.map(csvCell).join(',')).join('\r\n')], { type: 'text/csv;charset=utf-8' });
}

export function saveBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}
