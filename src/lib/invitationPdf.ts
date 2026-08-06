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
  /** Full-width footer strip (partner logos), drawn at the foot of every page. */
  footerImage?: string | null;
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
  subjectLabel: string;          // "Objet" / "Subject" — empty prints the subject alone
  subject: string;
  salutation: string;
  paragraphs: string[];          // may contain **bold** runs
  complimentaryClose: string;
  signOff: string;               // "Yours sincerely," — optional
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
// 4.3mm was 1.27x the type size — tight for a letter meant to be read once,
// slowly, by somebody deciding whether to attend. 4.8 is ~1.42x, which is the
// usual range for body text and still lands the standard letter on one page.
const LEADING = 4.8;     // mm between baselines
const PARA_GAP = 2.4;    // extra mm after a paragraph
const ADDR_LEADING = 4.2;
// The subject is a heading; it needs air under it, not a paragraph gap.
const SUBJECT_GAP = 7;

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
  /** Lowest baseline the text may use, in mm. Depends on how tall the footer is. */
  bottom: number;
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
    if (flow.y > flow.bottom) flow.y = flow.newPage();
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

  // The footer strip is measured BEFORE anything is laid out, because how tall
  // it is decides how far down the text may run. Measuring it at the end, where
  // it is drawn, would let the body flow underneath it.
  let stripH = 0;
  if (assets.footerImage) {
    const s = await imageSize(assets.footerImage);
    stripH = s.w ? (PAGE_W * s.h) / s.w : 0;
  }
  const legalY = PAGE_H - (stripH ? stripH + 5 : 12);
  const bottom = (d.footer.trim() ? legalY : PAGE_H - (stripH || 0)) - 6;

  const flow: Flow = {
    y: 0,
    bottom,
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

  // ---- recipient, flush to the right text margin --------------------------
  // A fixed 58% of the text width still read as drifting toward the middle. The
  // block is now placed so its WIDEST line ends exactly on the right margin, so
  // the column lines up with the justified body below it however long the
  // address happens to be. The lines stay left-aligned with each other — an
  // address ragged down its left edge reads as a mistake. The date line is
  // measured too, since it shares the column and would otherwise overhang.
  const addr = d.addressBlock.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
  const dateText = `${d.place}, ${d.dateLine}`;
  const rightEdge = PAGE_W - M_RIGHT;
  const colW = Math.max(0, ...addr.map(l => doc.getTextWidth(l)), doc.getTextWidth(dateText));
  // Flush right; the floor only catches an unusually long line, which would
  // otherwise start so far left it read as body text rather than an address.
  const addrX = Math.max(rightEdge - colW, M_LEFT + CONTENT_W * 0.5);
  addr.forEach((l, i) => doc.text(l, addrX, flow.y + i * ADDR_LEADING));
  flow.y += addr.length * ADDR_LEADING + 6;

  // ---- place & date -------------------------------------------------------
  doc.text(dateText, addrX, flow.y);
  flow.y += 17;

  // ---- subject ------------------------------------------------------------
  if (d.subject.trim()) {
    if (flow.y > flow.bottom) flow.y = flow.newPage();
    doc.setFont(FONT, 'normal');
    // The authorities letter heads the subject with no "Subject:" label.
    if (d.subjectLabel.trim()) {
      const label = `${d.subjectLabel}: `;
      doc.text(label, M_LEFT, flow.y);
      const lw = doc.getTextWidth(label);
      drawParagraph(doc, flow, d.subject, M_LEFT, CONTENT_W, M_LEFT + lw, CONTENT_W - lw);
    } else {
      drawParagraph(doc, flow, d.subject, M_LEFT, CONTENT_W);
    }
    flow.y += SUBJECT_GAP;
  }

  // ---- salutation ---------------------------------------------------------
  if (d.salutation.trim()) {
    if (flow.y > flow.bottom) flow.y = flow.newPage();
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
  if (d.signOff.trim()) {
    if (flow.y > flow.bottom) flow.y = flow.newPage();
    doc.text(d.signOff, M_LEFT, flow.y);
    flow.y += LEADING + PARA_GAP;
  }

  // ---- signature ----------------------------------------------------------
  // Keep the block together: a name on one page and its signature on the next
  // would read as a forgery.
  const SIG_BLOCK = 28;   // two lines + the signature artwork
  if (flow.y + SIG_BLOCK > flow.bottom) flow.y = flow.newPage(); else flow.y += 5;
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
  // Two footers, stacked: the partner-logo strip sits flush to the bottom edge
  // like the header does, and the legal line just above it. Both heights were
  // worked out before layout, so the body never runs into either.
  if (assets.footerImage || d.footer.trim()) {
    const pages = doc.getNumberOfPages();
    for (let p = 1; p <= pages; p++) {
      doc.setPage(p);
      if (assets.footerImage && stripH) {
        try { doc.addImage(assets.footerImage, 0, PAGE_H - stripH, PAGE_W, stripH); } catch { /* a bad image must not lose the letter */ }
      }
      if (d.footer.trim()) {
        doc.setFontSize(7.4);
        doc.setTextColor(130, 140, 160);
        doc.text(d.footer, PAGE_W / 2, legalY, { align: 'center' });
      }
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
