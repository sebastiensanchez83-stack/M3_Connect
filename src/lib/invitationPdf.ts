// Renders an official invitation letter to PDF (A4) with jsPDF.
//
// Two things the built-in helpers can't do and that an official letter needs:
// justified paragraphs, and bold runs inside a justified paragraph (the source
// letter bolds the event name, the dates, the venue, the RSVP date). So the
// text is laid out word by word: **bold** markers become runs, runs become
// words carrying their own font, and each line is justified by spreading the
// leftover width across its gaps.
//
// Throughout, `y` is the BASELINE of the next line to draw.

export interface LetterAssets {
  /** Full-width header strip, as a data URL. */
  banner?: string | null;
  /** Sender logo shown next to the address block. */
  logo?: string | null;
  /** Signature, drawn under the signatory's name. */
  signature?: string | null;
  /** Company stamp, drawn beside the signature. */
  stamp?: string | null;
}

export interface LetterData {
  senderLines: string[];
  addressBlock: string;          // recipient, one line per line
  place: string;
  dateLine: string;              // already localised
  subjectLabel: string;          // "Objet" / "Subject"
  subject: string;
  salutation: string;
  paragraphs: string[];          // may contain **bold** runs
  complimentaryClose: string;
  signatoryName: string;
  signatoryTitle: string;
  signatoryOrg: string;
  footer: string;
}

// A word may straddle a bold boundary — "**Awards**," is one word made of a
// bold segment and a plain one. Splitting per run instead would insert a space
// before the comma, which is what a first pass did.
interface Seg { text: string; bold: boolean }
interface Word { segs: Seg[]; w: number }

const PAGE_W = 210;
const PAGE_H = 297;
const M_LEFT = 25;
const M_RIGHT = 25;
const M_BOTTOM = 20;     // the footer line sits at 285mm, so this clears it
const M_TOP_NEXT = 28;   // first baseline on a continuation page
const CONTENT_W = PAGE_W - M_LEFT - M_RIGHT;
const FONT = 'helvetica';
// Tuned so a letter of this length still lands on ONE page under the header
// strip, the way the hand-made original does.
const SIZE = 9.6;
const LEADING = 4.3;     // mm between baselines
const PARA_GAP = 2.4;    // extra mm after a paragraph
const ADDR_LEADING = 4.2;

/** Split "a **b** c" into runs. */
function parseRuns(s: string): { text: string; bold: boolean }[] {
  const out: { text: string; bold: boolean }[] = [];
  const re = /\*\*([\s\S]+?)\*\*/g;
  let last = 0; let m: RegExpExecArray | null;
  while ((m = re.exec(s)) !== null) {
    if (m.index > last) out.push({ text: s.slice(last, m.index), bold: false });
    out.push({ text: m[1], bold: true });
    last = m.index + m[0].length;
  }
  if (last < s.length) out.push({ text: s.slice(last), bold: false });
  return out.length ? out : [{ text: s, bold: false }];
}

/** Strip the markers, for a plain-text preview. */
export const stripMarkers = (s: string) => s.replace(/\*\*([\s\S]+?)\*\*/g, '$1');

// jsPDF has no exported instance type we can name here.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Doc = any;

/**
 * Runs -> words. Flatten to characters first so a word is split on whitespace
 * only, never on a bold boundary, then regroup each word's characters into
 * same-weight segments.
 */
function toWords(doc: Doc, runs: { text: string; bold: boolean }[]): Word[] {
  let plain = '';
  const bold: boolean[] = [];
  for (const r of runs) {
    for (let i = 0; i < r.text.length; i++) { plain += r.text[i]; bold.push(r.bold); }
  }
  const words: Word[] = [];
  const re = /\S+/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(plain)) !== null) {
    const start = m.index;
    const segs: Seg[] = [];
    for (let i = start; i < start + m[0].length; i++) {
      const last = segs[segs.length - 1];
      if (last && last.bold === bold[i]) last.text += plain[i];
      else segs.push({ text: plain[i], bold: bold[i] });
    }
    let w = 0;
    for (const s of segs) { doc.setFont(FONT, s.bold ? 'bold' : 'normal'); w += doc.getTextWidth(s.text); }
    words.push({ segs, w });
  }
  doc.setFont(FONT, 'normal');
  return words;
}

interface Flow {
  /** Baseline for the next line. */
  y: number;
  /** Start a new page and return its first baseline. */
  newPage: () => number;
}

/**
 * Draw one justified paragraph. `x`/`width` allow an indented first block
 * (the subject line sits after its "Objet:" label).
 */
function drawParagraph(doc: Doc, flow: Flow, text: string, x: number, width: number, firstX?: number, firstWidth?: number): void {
  const words = toWords(doc, parseRuns(text));
  if (!words.length) return;
  doc.setFont(FONT, 'normal');
  const spaceW = doc.getTextWidth(' ');

  // Greedy line break. The first line may be narrower than the rest.
  const lines: Word[][] = [];
  let line: Word[] = [];
  let lineW = 0;
  const widthOf = (idx: number) => (idx === 0 && firstWidth != null ? firstWidth : width);
  for (const w of words) {
    const add = line.length ? spaceW + w.w : w.w;
    if (line.length && lineW + add > widthOf(lines.length)) {
      lines.push(line); line = [w]; lineW = w.w;
    } else { line.push(w); lineW += add; }
  }
  if (line.length) lines.push(line);

  lines.forEach((ln, i) => {
    if (flow.y > PAGE_H - M_BOTTOM) flow.y = flow.newPage();
    const lx = i === 0 && firstX != null ? firstX : x;
    const lw = widthOf(i);
    const isLast = i === lines.length - 1;
    const natural = ln.reduce((a, w) => a + w.w, 0) + spaceW * (ln.length - 1);
    // Never stretch the closing line of a paragraph, nor a single word.
    const gap = !isLast && ln.length > 1 ? spaceW + (lw - natural) / (ln.length - 1) : spaceW;
    let px = lx;
    for (const w of ln) {
      for (const s of w.segs) {
        doc.setFont(FONT, s.bold ? 'bold' : 'normal');
        doc.text(s.text, px, flow.y);
        px += doc.getTextWidth(s.text);
      }
      px += gap;
    }
    flow.y += LEADING;
  });
  doc.setFont(FONT, 'normal');
}

/** Natural size of a data-URL image, so we can scale it without distortion. */
function imageSize(dataUrl: string): Promise<{ w: number; h: number }> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve({ w: img.naturalWidth || 1, h: img.naturalHeight || 1 });
    img.onerror = () => resolve({ w: 0, h: 0 });
    img.src = dataUrl;
  });
}

/** Fetch a URL and turn it into a data URL jsPDF can embed. */
export async function toDataUrl(url: string): Promise<string | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const blob = await res.blob();
    return await new Promise((resolve) => {
      const fr = new FileReader();
      fr.onload = () => resolve(String(fr.result || ''));
      fr.onerror = () => resolve(null);
      fr.readAsDataURL(blob);
    });
  } catch { return null; }
}

export async function buildInvitationPdf(d: LetterData, assets: LetterAssets = {}) {
  const { jsPDF } = await import('jspdf');
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  doc.setFont(FONT, 'normal');
  doc.setFontSize(SIZE);
  doc.setTextColor(20, 28, 44);

  const flow: Flow = {
    y: 0,
    newPage: () => { doc.addPage(); doc.setFontSize(SIZE); doc.setTextColor(20, 28, 44); return M_TOP_NEXT; },
  };

  // ---- header strip -------------------------------------------------------
  let top = 24;
  if (assets.banner) {
    const s = await imageSize(assets.banner);
    const h = s.w ? (PAGE_W * s.h) / s.w : 26;
    try { doc.addImage(assets.banner, 0, 0, PAGE_W, h); top = h + 9; } catch { /* a bad image must not lose the letter */ }
  }

  // ---- sender -------------------------------------------------------------
  const sender = d.senderLines.filter(Boolean);
  let senderX = M_LEFT;
  if (assets.logo) {
    const s = await imageSize(assets.logo);
    const lw = 20;
    const lh = s.w ? (lw * s.h) / s.w : 11;
    try { doc.addImage(assets.logo, M_LEFT, top - 4, lw, lh); senderX = M_LEFT + lw + 4; } catch { /* ignore */ }
  }
  sender.forEach((l, i) => {
    doc.setFont(FONT, i === 0 ? 'bold' : 'normal');
    doc.text(l, senderX, top + i * ADDR_LEADING);
  });
  doc.setFont(FONT, 'normal');
  flow.y = top + Math.max(sender.length * ADDR_LEADING, 13) + 7;

  // ---- recipient, indented to the right half ------------------------------
  const addr = d.addressBlock.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
  const addrX = M_LEFT + CONTENT_W * 0.5;
  addr.forEach((l, i) => doc.text(l, addrX, flow.y + i * ADDR_LEADING));
  flow.y += addr.length * ADDR_LEADING + 6;

  // ---- place & date -------------------------------------------------------
  doc.text(`${d.place}, ${d.dateLine}`, addrX, flow.y);
  flow.y += 9;

  // ---- subject ------------------------------------------------------------
  if (d.subject.trim()) {
    if (flow.y > PAGE_H - M_BOTTOM) flow.y = flow.newPage();
    const label = `${d.subjectLabel}: `;
    doc.setFont(FONT, 'normal');
    doc.text(label, M_LEFT, flow.y);
    const lw = doc.getTextWidth(label);
    drawParagraph(doc, flow, d.subject, M_LEFT, CONTENT_W, M_LEFT + lw, CONTENT_W - lw);
    flow.y += PARA_GAP;
  }

  // ---- salutation ---------------------------------------------------------
  if (d.salutation.trim()) {
    if (flow.y > PAGE_H - M_BOTTOM) flow.y = flow.newPage();
    doc.text(d.salutation, M_LEFT, flow.y);
    flow.y += LEADING + PARA_GAP;
  }

  // ---- body ---------------------------------------------------------------
  for (const p of d.paragraphs) {
    if (!p.trim()) continue;
    drawParagraph(doc, flow, p, M_LEFT, CONTENT_W);
    flow.y += PARA_GAP;
  }
  if (d.complimentaryClose.trim()) {
    drawParagraph(doc, flow, d.complimentaryClose, M_LEFT, CONTENT_W);
    flow.y += PARA_GAP;
  }

  // ---- signature ----------------------------------------------------------
  // Keep the block together: a name on one page and its signature on the next
  // would read as a forgery.
  const SIG_BLOCK = 28;   // two lines + the signature artwork
  if (flow.y + SIG_BLOCK > PAGE_H - M_BOTTOM) flow.y = flow.newPage(); else flow.y += 5;
  const sigRight = PAGE_W - M_RIGHT;
  doc.setFont(FONT, 'bold');
  if (d.signatoryName) {
    doc.text(`${d.signatoryName}${d.signatoryTitle ? `, ${d.signatoryTitle}` : ''}`, sigRight, flow.y, { align: 'right' });
    flow.y += 4.6;
  }
  if (d.signatoryOrg) { doc.text(d.signatoryOrg, sigRight, flow.y, { align: 'right' }); flow.y += 4.6; }
  doc.setFont(FONT, 'normal');
  const artTop = flow.y + 1;
  if (assets.signature) {
    const s = await imageSize(assets.signature);
    const w = 40;
    const h = s.w ? (w * s.h) / s.w : 16;
    try { doc.addImage(assets.signature, sigRight - w, artTop, w, h); } catch { /* ignore */ }
  }
  if (assets.stamp) {
    const s = await imageSize(assets.stamp);
    const w = 32;
    const h = s.w ? (w * s.h) / s.w : 19;
    try { doc.addImage(assets.stamp, sigRight - w - 44, artTop, w, h); } catch { /* ignore */ }
  }

  // ---- footer, on every page ---------------------------------------------
  if (d.footer.trim()) {
    const pages = doc.getNumberOfPages();
    for (let p = 1; p <= pages; p++) {
      doc.setPage(p);
      doc.setFontSize(7.4);
      doc.setTextColor(130, 140, 160);
      doc.text(d.footer, PAGE_W / 2, PAGE_H - 12, { align: 'center' });
    }
  }

  return doc;
}

const slug = (s: string) => (s || 'invitation')
  .toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'invitation';

export async function downloadInvitationPdf(d: LetterData, assets: LetterAssets, filename: string) {
  const doc = await buildInvitationPdf(d, assets);
  doc.save(`${slug(filename)}.pdf`);
}

export async function invitationPdfBlobUrl(d: LetterData, assets: LetterAssets): Promise<string> {
  const doc = await buildInvitationPdf(d, assets);
  return URL.createObjectURL(doc.output('blob'));
}
