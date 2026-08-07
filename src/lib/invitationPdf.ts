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
  /** mm between baselines. Squeezed by the fitting pass when a letter runs long. */
  leading: number;
}

/**
 * Every vertical measurement the letter uses. They are a set rather than
 * constants because the layout is tried at several densities until it fits on
 * one page — see buildInvitationPdf.
 */
interface Metrics {
  size: number;
  leading: number;
  paraGap: number;
  subjectGap: number;
  addrLeading: number;
  dateGap: number;
  senderGap: number;
  sigGap: number;
}

const metricsAt = (k: number, size: number): Metrics => ({
  size,
  leading: LEADING * k,
  paraGap: PARA_GAP * k,
  subjectGap: SUBJECT_GAP * k,
  addrLeading: ADDR_LEADING * k,
  dateGap: 17 * k,
  senderGap: 7 * k,
  sigGap: 5 * k,
});

/**
 * Draw one justified paragraph. `x`/`width` allow an indented first block
 * (the subject line sits after its "Objet:" label).
 */
function drawParagraph(doc: Doc, flow: Flow, text: string, x: number, width: number, firstX?: number, firstWidth?: number, draw = true): void {
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
        if (draw) doc.text(s.text, px, flow.y);
        px += doc.getTextWidth(s.text);
      }
      px += gap;
    }
    flow.y += flow.leading;
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

  // ---- measure the artwork once -------------------------------------------
  // Heights are needed before any text is placed: the banner decides where the
  // first line starts, the footer decides where the last one may fall, and the
  // signature decides how much room its block must reserve.
  const heightFor = async (url: string, w = PAGE_W, fallback = 0) => {
    const s = await imageSize(url);
    return s.w ? (w * s.h) / s.w : fallback;
  };
  const bannerH = assets.banner ? await heightFor(assets.banner, PAGE_W, 26) : 0;
  const stripH = assets.footerImage ? await heightFor(assets.footerImage) : 0;
  const LOGO_W = 20;
  const logoH = assets.logo ? await heightFor(assets.logo, LOGO_W, 11) : 0;
  const SIG_W = 40;
  const sigH = assets.signature ? await heightFor(assets.signature, SIG_W, 16) : 0;
  const STAMP_W = 32;
  const stampH = assets.stamp ? await heightFor(assets.stamp, STAMP_W, 19) : 0;

  const legalY = PAGE_H - (stripH ? stripH + 5 : 12);
  const bottom = (d.footer.trim() ? legalY : PAGE_H - stripH) - 6;
  const top = bannerH ? bannerH + 9 : 24;

  /**
   * Lay the letter out at a given density. With `draw` false it only walks the
   * geometry on a scratch document, which is how the fitting pass below can ask
   * "would this fit?" without embedding two megabytes of artwork each time.
   * Returns the number of pages the text needed.
   */
  const layout = (doc: Doc, m: Metrics, draw: boolean): number => {
    let pages = 1;
    doc.setFont(FONT, 'normal');
    doc.setFontSize(m.size);
    doc.setTextColor(20, 28, 44);

    const flow: Flow = {
      y: 0,
      bottom,
      leading: m.leading,
      newPage: () => {
        pages += 1;
        if (draw) { doc.addPage(); doc.setFontSize(m.size); doc.setTextColor(20, 28, 44); }
        return M_TOP_NEXT;
      },
    };

    // ---- header strip -----------------------------------------------------
    if (draw && bannerH) {
      try { doc.addImage(assets.banner, 0, 0, PAGE_W, bannerH); } catch { /* a bad image must not lose the letter */ }
    }

    // ---- sender -----------------------------------------------------------
    const sender = d.senderLines.filter(Boolean);
    let senderX = M_LEFT;
    if (logoH) {
      senderX = M_LEFT + LOGO_W + 4;
      if (draw) { try { doc.addImage(assets.logo, M_LEFT, top - 4, LOGO_W, logoH); } catch { /* ignore */ } }
    }
    sender.forEach((l, i) => {
      doc.setFont(FONT, i === 0 ? 'bold' : 'normal');
      if (draw) doc.text(l, senderX, top + i * m.addrLeading);
    });
    doc.setFont(FONT, 'normal');
    flow.y = top + Math.max(sender.length * m.addrLeading, 13) + m.senderGap;

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
    if (draw) addr.forEach((l, i) => doc.text(l, addrX, flow.y + i * m.addrLeading));
    flow.y += addr.length * m.addrLeading + 6;

    // ---- place & date ---------------------------------------------------
    if (draw) doc.text(dateText, addrX, flow.y);
    flow.y += m.dateGap;

    // ---- subject --------------------------------------------------------
    if (d.subject.trim()) {
      if (flow.y > flow.bottom) flow.y = flow.newPage();
      doc.setFont(FONT, 'normal');
      // The authorities letter heads the subject with no "Subject:" label.
      if (d.subjectLabel.trim()) {
        const label = `${d.subjectLabel}: `;
        if (draw) doc.text(label, M_LEFT, flow.y);
        const lw = doc.getTextWidth(label);
        drawParagraph(doc, flow, d.subject, M_LEFT, CONTENT_W, M_LEFT + lw, CONTENT_W - lw, draw);
      } else {
        drawParagraph(doc, flow, d.subject, M_LEFT, CONTENT_W, undefined, undefined, draw);
      }
      flow.y += m.subjectGap;
    }

    // ---- salutation -----------------------------------------------------
    if (d.salutation.trim()) {
      if (flow.y > flow.bottom) flow.y = flow.newPage();
      if (draw) doc.text(d.salutation, M_LEFT, flow.y);
      flow.y += m.leading + m.paraGap;
    }

    // ---- body -----------------------------------------------------------
    for (const p of d.paragraphs) {
      if (!p.trim()) continue;
      drawParagraph(doc, flow, p, M_LEFT, CONTENT_W, undefined, undefined, draw);
      flow.y += m.paraGap;
    }
    if (d.complimentaryClose.trim()) {
      drawParagraph(doc, flow, d.complimentaryClose, M_LEFT, CONTENT_W, undefined, undefined, draw);
      flow.y += m.paraGap;
    }
    if (d.signOff.trim()) {
      if (flow.y > flow.bottom) flow.y = flow.newPage();
      if (draw) doc.text(d.signOff, M_LEFT, flow.y);
      flow.y += m.leading + m.paraGap;
    }

    // ---- signature ------------------------------------------------------
    // Keep the block together: a name on one page and its signature on the
    // next would read as a forgery. The reservation is measured from the real
    // artwork rather than assumed.
    const sigLines = (d.signatoryName ? 4.6 : 0) + (d.signatoryOrg ? 4.6 : 0);
    const sigBlock = sigLines + Math.max(sigH, stampH) + 4;
    if (flow.y + sigBlock > flow.bottom) flow.y = flow.newPage(); else flow.y += m.sigGap;
    const sigRight = PAGE_W - M_RIGHT;
    doc.setFont(FONT, 'bold');
    if (d.signatoryName) {
      if (draw) doc.text(`${d.signatoryName}${d.signatoryTitle ? `, ${d.signatoryTitle}` : ''}`, sigRight, flow.y, { align: 'right' });
      flow.y += 4.6;
    }
    if (d.signatoryOrg) {
      if (draw) doc.text(d.signatoryOrg, sigRight, flow.y, { align: 'right' });
      flow.y += 4.6;
    }
    doc.setFont(FONT, 'normal');
    const artTop = flow.y + 1;
    if (draw && sigH) {
      try { doc.addImage(assets.signature, sigRight - SIG_W, artTop, SIG_W, sigH); } catch { /* ignore */ }
    }
    if (draw && stampH) {
      try { doc.addImage(assets.stamp, sigRight - STAMP_W - 44, artTop, STAMP_W, stampH); } catch { /* ignore */ }
    }
    flow.y = artTop + Math.max(sigH, stampH);
    if (flow.y > flow.bottom + 6) pages = Math.max(pages, 2);   // artwork overhang

    return pages;
  };

  // ---- fit it on one page -------------------------------------------------
  // An official invitation that runs onto a second page just to carry the
  // signature looks like a mistake, and it is: the content is a page's worth.
  // So the layout is measured first and tightened until it fits — spacing goes
  // first, and only if that is not enough does the type shrink, because a
  // slightly tighter letter reads better than a slightly smaller one.
  const scratch: Doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const TIGHTEST = metricsAt(0.76, 8.8);
  let chosen: Metrics | null = null;
  outer:
  for (const size of [SIZE, 9.2, 8.8]) {
    for (const k of [1, 0.94, 0.88, 0.82, 0.76]) {
      const m = metricsAt(k, size);
      if (layout(scratch, m, false) === 1) { chosen = m; break outer; }
    }
  }
  // Genuinely too long for one page — let it run rather than shrink to nothing.
  const metrics = chosen ?? TIGHTEST;

  const doc: Doc = new jsPDF({ unit: 'mm', format: 'a4' });
  layout(doc, metrics, true);

  // ---- footer, on every page ---------------------------------------------
  // Two footers, stacked: the partner-logo strip sits flush to the bottom edge
  // like the header does, and the legal line just above it. Both heights were
  // worked out before layout, so the body never runs into either.
  if (assets.footerImage || d.footer.trim()) {
    const pages = doc.getNumberOfPages();
    for (let p = 1; p <= pages; p++) {
      doc.setPage(p);
      if (stripH) {
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
