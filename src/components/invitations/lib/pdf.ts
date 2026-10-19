/* ─── Ticket and letter PDFs (pdf-lib + fontkit) ───
 *
 * Layout: the kit's SPEC.md, reference/ticket.py and reference/letter.py (millimetres
 * from the bottom left corner). Loaded only on the invitation screens.
 *
 * - Fonts are embedded WHOLE (subset: false): with subsetting, pdf-lib + fontkit kept
 *   only the first letter of some names ("Luck Machin" printed "L").
 * - Ligatures are off, as in the ReportLab renders the samples come from.
 * - A character a font cannot draw is never printed as an empty box: it is replaced
 *   by "?" and reported as an error, and the screens refuse to send or download that PDF.
 * - Ticket: "template" overlays the name on the validated artwork of the campaign's
 *   folder (identical to the samples); "drawn" draws everything from the campaign data.
 * - Letter: drawn from the campaign texts on the banner of the campaign's folder.
 *
 * No browser API here: the screens pass the asset bytes, and so does the test script.
 */
import { PDFDocument, rgb, setCharacterSpacing, type PDFFont, type PDFImage, type PDFPage, type RGB } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import type { InvitationCampaign, InvitationRecipient, InvitationTicketStyle } from '../types';
import { clean } from './norm';
import { dateLabel, fill, parseMarkup, variablesFor, type RunStyle } from './render';
import { salutation } from './names';
import { ticketSchedule } from './presets';

export const MM = 72 / 25.4;

export interface FontBytes {
  light: ArrayBuffer; regular: ArrayBuffer; medium: ArrayBuffer; semibold: ArrayBuffer;
  pagellaRegular: ArrayBuffer; pagellaItalic: ArrayBuffer;
}
export type FontKey = keyof FontBytes;

export interface InvitationAssets {
  fonts: FontBytes;
  /** The campaign folder's blank tickets (template mode). */
  templates: { white?: ArrayBuffer | null; navy?: ArrayBuffer | null };
  logos: {
    banner?: ArrayBuffer | null;
    m3Navy?: ArrayBuffer | null; m3White?: ArrayBuffer | null;
    wysNavy?: ArrayBuffer | null; wysWhite?: ArrayBuffer | null;
    omniNavy?: ArrayBuffer | null; omniWhite?: ArrayBuffer | null;
  };
  /** The letter signature (PNG or JPEG), or null when the campaign has none or it failed to load. */
  signature?: ArrayBuffer | null;
}

export interface PdfIssue { level: 'error' | 'warning'; code: string; message: string }
export interface PdfResult { bytes: Uint8Array; issues: PdfIssue[] }

type Campaign = Pick<InvitationCampaign, 'name' | 'ticket_style' | 'letter_date' | 'settings' | 'texts'>;
type Guest = Pick<InvitationRecipient, 'name_on_ticket' | 'name_on_letter' | 'greeting' | 'position' | 'organisation' | 'first_name' | 'last_name'>;

const hex = (h: string): RGB => { const n = parseInt(h.slice(1), 16); return rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255); };
const C = {
  navy: hex('#0A2E5C'), sky: hex('#8EC5E5'), steel: hex('#5E9CC4'), slate: hex('#6B7F99'),
  hair: hex('#C9D3DF'), ink: hex('#1F2D40'), white: rgb(1, 1, 1),
  paleBlue: hex('#B9CCE0'), navyRule: hex('#3E6190'), navyFine: hex('#9FB4CC'),
};
const NBSP = String.fromCharCode(160);
const FONT_LABEL: Record<FontKey, string> = {
  light: 'Montserrat Light', regular: 'Montserrat Regular', medium: 'Montserrat Medium', semibold: 'Montserrat SemiBold',
  pagellaRegular: 'Pagella', pagellaItalic: 'Pagella Italic',
};

interface FontkitFont { hasGlyphForCodePoint(cp: number): boolean }

/** One document: fonts embedded on first use, every drawn string checked for glyphs. */
class Doc {
  private fonts = new Map<FontKey, PDFFont>();
  readonly issues: PdfIssue[] = [];
  private missing = new Map<string, Set<string>>();
  constructor(readonly pdf: PDFDocument, readonly assets: InvitationAssets) {}

  async font(k: FontKey): Promise<PDFFont> {
    let f = this.fonts.get(k);
    if (!f) {
      f = await this.pdf.embedFont(this.assets.fonts[k], { subset: false, features: { liga: false, clig: false, dlig: false, calt: false } });
      this.fonts.set(k, f);
    }
    return f;
  }

  /** The text as it can be drawn: unknown characters become "?" and are reported. */
  safe(text: string, f: PDFFont, k: FontKey, field: string): string {
    const fk = (f as unknown as { embedder: { font: FontkitFont } }).embedder.font;
    let out = '';
    for (const ch of text) {
      const cp = ch.codePointAt(0)!;
      if (cp === 32 || cp === 160 || fk.hasGlyphForCodePoint(cp)) { out += ch; continue; }
      const key = `${field}|${FONT_LABEL[k]}`;
      if (!this.missing.has(key)) this.missing.set(key, new Set());
      this.missing.get(key)!.add(ch);
      out += '?';
    }
    return out;
  }

  finish() {
    for (const [key, chars] of this.missing) {
      const [field, font] = key.split('|');
      this.issues.push({
        level: 'error', code: 'missing_glyph',
        message: `${field}: ${[...chars].map(c => `"${c}"`).join(', ')} cannot be printed in ${font}. Change the text (for example a Latin spelling).`,
      });
    }
  }
}

function tracked(page: PDFPage, text: string, x: number, y: number, f: PDFFont, size: number, track: number, color: RGB, align: 'left' | 'center' | 'right' = 'left') {
  const chars = [...text];
  const w = chars.reduce((s, ch) => s + f.widthOfTextAtSize(ch, size), 0) + track * Math.max(0, chars.length - 1);
  const x0 = align === 'center' ? x - w / 2 : align === 'right' ? x - w : x;
  page.pushOperators(setCharacterSpacing(track));
  page.drawText(text, { x: x0, y, size, font: f, color });
  page.pushOperators(setCharacterSpacing(0));
  return w;
}

async function newDoc(assets: InvitationAssets, template?: ArrayBuffer | null): Promise<Doc> {
  const pdf = template ? await PDFDocument.load(template) : await PDFDocument.create();
  pdf.registerFontkit(fontkit);
  return new Doc(pdf, assets);
}

function meta(pdf: PDFDocument, c: Campaign, kind: string, name: string) {
  const s = c.settings || {};
  const ev = [clean(s.name) || clean(c.name), clean(s.city)].filter(Boolean).join(' ');
  pdf.setTitle(`${ev}, ${kind}${name ? `, ${name}` : ''}`);
  pdf.setAuthor('M3 Monaco');
  pdf.setCreator('Smart Marina Connect');
  pdf.setProducer('Smart Marina Connect');
}

/* ─── Ticket: 210 x 99 mm ─── */

export const TICKET = { W: 210 * MM, H: 99 * MM, STUB: 150 * MM, ML: 14 * MM, NAME_MAX: 124 * MM, NAME_MAX_PT: 20, NAME_MIN_PT: 11 };

/** The size the guest's name prints at (20 pt, down by 0.5 pt, never under 11 pt). */
export function ticketNameSize(f: PDFFont, name: string): { size: number; fits: boolean } {
  let size = TICKET.NAME_MAX_PT;
  while (size > TICKET.NAME_MIN_PT && f.widthOfTextAtSize(name, size) > TICKET.NAME_MAX) size -= 0.5;
  return { size, fits: f.widthOfTextAtSize(name, size) <= TICKET.NAME_MAX };
}

interface TicketTheme {
  page: RGB; stub: RGB; logo: 'navy' | 'white'; sep: RGB; label: RGB; line: RGB; text: RGB; hair: RGB; dlab: RGB; dval: RGB;
  fine: RGB; sTop: RGB; sRule: RGB; sBig: RGB; sTxt: RGB; sEd: RGB; sFine: RGB;
}
const THEMES: Record<InvitationTicketStyle, TicketTheme> = {
  white: {
    page: C.white, stub: C.navy, logo: 'navy', sep: C.hair, label: C.slate, line: C.navy, text: C.navy, hair: C.hair,
    dlab: C.steel, dval: C.navy, fine: C.slate, sTop: C.sky, sRule: C.sky, sBig: C.white, sTxt: C.white, sEd: C.sky, sFine: C.paleBlue,
  },
  navy: {
    page: C.navy, stub: C.white, logo: 'white', sep: C.navyRule, label: C.paleBlue, line: C.white, text: C.white, hair: C.navyRule,
    dlab: C.sky, dval: C.white, fine: C.navyFine, sTop: C.steel, sRule: C.sky, sBig: C.navy, sTxt: C.navy, sEd: C.steel, sFine: C.slate,
  },
};

export type TicketArtwork = 'template' | 'drawn';
export const ticketArtwork = (c: Campaign): TicketArtwork => ((c.settings as { ticket_artwork?: string })?.ticket_artwork === 'drawn' ? 'drawn' : 'template');

export async function ticketPdf(assets: InvitationAssets, c: Campaign, g: Guest, style: InvitationTicketStyle = c.ticket_style): Promise<PdfResult> {
  const mode = ticketArtwork(c);
  const template = mode === 'template' ? (style === 'navy' ? assets.templates.navy : assets.templates.white) : null;
  if (mode === 'template' && !template) throw new Error('ticket_template_missing');
  const d = await newDoc(assets, template);
  const page = template ? d.pdf.getPage(0) : d.pdf.addPage([TICKET.W, TICKET.H]);
  const T = THEMES[style];
  if (mode === 'drawn') await drawTicketArtwork(d, page, c, T);
  await drawTicketSchedule(d, page, c, T);

  const italic = await d.font('pagellaItalic');
  const name = d.safe(clean(g.name_on_ticket), italic, 'pagellaItalic', 'Name on ticket');
  if (name) {
    const { size, fits } = ticketNameSize(italic, name);
    if (!fits) d.issues.push({ level: 'error', code: 'name_too_long', message: 'The name on the ticket does not fit on one line, even at 11 pt. Shorten it.' });
    page.drawText(name, { x: TICKET.ML, y: 50.2 * MM, size, font: italic, color: T.text });
  } else {
    d.issues.push({ level: 'error', code: 'no_name', message: 'The name on the ticket is empty.' });
  }
  d.finish();
  meta(d.pdf, c, 'Invitation', clean(g.name_on_ticket));
  return { bytes: await d.pdf.save(), issues: d.issues };
}

/**
 * One line between the line under the name and the hairline above DATE / VENUE / ACCESS
 * (baseline y = 30 mm): each part's label in the DATE-label style, then its time in the
 * value style. Drawn on the validated artwork too (that band is empty there).
 */
async function drawTicketSchedule(d: Doc, page: PDFPage, c: Campaign, T: TicketTheme) {
  const schedule = ticketSchedule(c);
  if (!schedule.length) return;
  const semibold = await d.font('semibold');
  const regular = await d.font('regular');
  const y = 30 * MM;
  let x = TICKET.ML;
  schedule.forEach((p, i) => {
    const label = d.safe(clean(p.label).toUpperCase(), semibold, 'semibold', 'Ticket times');
    const time = d.safe(clean(p.time), regular, 'regular', 'Ticket times');
    if (label) x += tracked(page, label, x, y, semibold, 5.6, 1.2, T.dlab) + 2.2 * MM;
    if (time) {
      page.drawText(time, { x, y, size: 7.6, font: regular, color: T.dval });
      x += regular.widthOfTextAtSize(time, 7.6);
    }
    if (i < schedule.length - 1) x += 8 * MM;
  });
  if (x > TICKET.STUB - 12 * MM) d.issues.push({ level: 'error', code: 'times_too_long', message: 'The times on the ticket run past the line. Shorten them in Settings.' });
}

async function drawTicketArtwork(d: Doc, page: PDFPage, c: Campaign, T: TicketTheme) {
  const { W, H, STUB, ML } = TICKET;
  const s = c.settings || {};
  const t = c.texts?.ticket || {};
  const vars = variablesFor(c, null);
  page.drawRectangle({ x: 0, y: 0, width: W, height: H, color: T.page });
  page.drawRectangle({ x: STUB, y: 0, width: W - STUB, height: H, color: T.stub });

  // Logos: M3, separator, WYS, separator, OMNIYAT; centred on y = 85 mm.
  const top = H - 13 * MM;
  const logos = T.logo === 'navy'
    ? [d.assets.logos.m3Navy, d.assets.logos.wysNavy, d.assets.logos.omniNavy]
    : [d.assets.logos.m3White, d.assets.logos.wysWhite, d.assets.logos.omniWhite];
  const heights = [9.5 * MM, 8.5 * MM, 2.6 * MM];
  let x = ML;
  for (let i = 0; i < logos.length; i++) {
    const bytes = logos[i];
    if (bytes) {
      const img = await d.pdf.embedPng(bytes);
      const h = heights[i];
      const w = img.width * h / img.height;
      page.drawImage(img, { x, y: top - h / 2 - 1 * MM, width: w, height: h });
      x += w + 6 * MM;
    }
    if (i < logos.length - 1 && bytes) {
      page.drawLine({ start: { x, y: top - 6 * MM }, end: { x, y: top + 3.5 * MM }, thickness: 0.5, color: T.sep });
      x += 6 * MM;
    }
  }

  const medium = await d.font('medium');
  const semibold = await d.font('semibold');
  const regular = await d.font('regular');
  const light = await d.font('light');
  const pagella = await d.font('pagellaRegular');
  const italic = await d.font('pagellaItalic');
  const txt = (v: string | undefined) => fill(v, vars);

  tracked(page, d.safe(txt(t.eyebrow), medium, 'medium', 'Ticket heading'), ML, 62 * MM, medium, 6.2, 1.1, T.label);
  page.drawLine({ start: { x: ML, y: 47 * MM }, end: { x: STUB - 12 * MM, y: 47 * MM }, thickness: 0.6, color: T.line });
  page.drawText(d.safe(txt(t.line_under_name), italic, 'pagellaItalic', 'Line under the name'), { x: ML, y: 39.5 * MM, size: 11.5, font: italic, color: T.text });

  page.drawLine({ start: { x: ML, y: 25 * MM }, end: { x: STUB - 12 * MM, y: 25 * MM }, thickness: 0.5, color: T.hair });
  const cols: [string, string][] = [['DATE', clean(s.date_label)], ['VENUE', clean(s.venue)], ['ACCESS', clean(s.access)]];
  const cx = [ML, ML + 35 * MM, ML + 84 * MM];
  cols.forEach(([lab, val], i) => {
    tracked(page, lab, cx[i], 19.5 * MM, semibold, 5.6, 1.2, T.dlab);
    page.drawText(d.safe(val, regular, 'regular', `Ticket ${lab.toLowerCase()}`), { x: cx[i], y: 14.5 * MM, size: 7.6, font: regular, color: T.dval });
  });
  page.drawText(d.safe(txt(t.fine_print), light, 'light', 'Ticket fine print'), { x: ML, y: 7.5 * MM, size: 5.6, font: light, color: T.fine });

  // Stub, centred on x = 180 mm.
  const sc = STUB + (W - STUB) / 2;
  const centred = (text: string, y: number, f: PDFFont, size: number, color: RGB) =>
    page.drawText(text, { x: sc - f.widthOfTextAtSize(text, size) / 2, y, size, font: f, color });
  tracked(page, d.safe(txt(t.stub_top), medium, 'medium', 'Stub heading'), sc, H - 15 * MM, medium, 5.6, 1.6, T.sTop, 'center');
  page.drawLine({ start: { x: sc - 5 * MM, y: H - 19 * MM }, end: { x: sc + 5 * MM, y: H - 19 * MM }, thickness: 0.5, color: T.sRule });
  centred(d.safe(txt(t.stub_day), pagella, 'pagellaRegular', 'Stub day'), H - 44 * MM, pagella, 56, T.sBig);
  tracked(page, d.safe(txt(t.stub_month_year), medium, 'medium', 'Stub month'), sc, H - 52 * MM, medium, 7, 2.2, T.sTxt, 'center');
  tracked(page, d.safe(txt(t.stub_city), light, 'light', 'Stub city'), sc, H - 58.5 * MM, light, 7, 2.2, T.sTxt, 'center');
  centred(d.safe(txt(t.stub_edition), italic, 'pagellaItalic', 'Stub edition'), 22 * MM, italic, 10.5, T.sEd);
  centred(d.safe(clean(s.contact_email_ticket), light, 'light', 'Stub e-mail'), 11 * MM, light, 5.4, T.sFine);
  centred(d.safe(clean(s.website), light, 'light', 'Stub website'), 7.5 * MM, light, 5.4, T.sFine);
}


/* ─── Letter: A4 ─── */

export const LETTER = {
  W: 595.2756, H: 841.8898, M: 22 * MM, TOP: 200 * MM, BOTTOM: 24 * MM,
  SIZE: 9.4, LEADING: 15.2, AFTER: 8.5, ITALIC_SIZE: 10.3, BULLET_SIZE: 12, BULLET_INDENT: 13, BULLET_FIRST: -9, BULLET_AFTER: 3,
  SIGNATURE_H: 22 * MM,
};

interface Piece { text: string; font: PDFFont; key: FontKey; size: number; color: RGB }
interface Word { pieces: Piece[]; width: number; space: Piece | null }

function words(pieces: Piece[]): Word[] {
  const out: Word[] = [];
  let cur: Piece[] = [];
  const push = (space: Piece | null) => {
    if (!cur.length) return;
    out.push({ pieces: cur, width: cur.reduce((s, p) => s + p.font.widthOfTextAtSize(p.text, p.size), 0), space });
    cur = [];
  };
  for (const p of pieces) {
    const parts = p.text.split(' ');
    parts.forEach((part, k) => {
      if (k > 0) push({ ...p, text: ' ' });
      if (part) cur.push({ ...p, text: part });
    });
  }
  push(null);
  return out;
}
const spaceW = (p: Piece | null) => (p ? p.font.widthOfTextAtSize(' ', p.size) : 0);

interface ParaOpts { indentFirst: number; indentRest: number; after: number }

/**
 * ReportLab Paragraph in a Frame, as letter.py used it: greedy line breaks, fixed
 * leading of 15.2 pt, the first baseline one font size (the line's largest) under
 * the top, spaceAfter added below. Returns the next top; draws when page is given.
 */
function paragraph(page: PDFPage | null, pieces: Piece[], top: number, o: ParaOpts, issues: { overflow: boolean }): number {
  const ws = words(pieces);
  const lines: Word[][] = [];
  let line: Word[] = [];
  let width = 0;
  for (const w of ws) {
    const avail = LETTER.W - 2 * LETTER.M - (lines.length ? o.indentRest : o.indentFirst);
    const add = line.length ? spaceW(line[line.length - 1].space) + w.width : w.width;
    if (line.length && width + add > avail + 0.01) { lines.push(line); line = [w]; width = w.width; }
    else { line.push(w); width += add; }
  }
  if (line.length) lines.push(line);
  // The first baseline sits one font size (the line's largest) under the top; the next
  // ones one leading apart.
  const firstSize = lines.length ? Math.max(...lines[0].flatMap(w => w.pieces.map(p => p.size))) : 0;
  lines.forEach((ln, i) => {
    const baseline = top - firstSize - i * LETTER.LEADING;
    if (baseline < LETTER.BOTTOM) issues.overflow = true;
    if (!page) return;
    let x = LETTER.M + (i === 0 ? o.indentFirst : o.indentRest);
    ln.forEach((w, wi) => {
      for (const p of w.pieces) {
        page.drawText(p.text, { x, y: baseline, size: p.size, font: p.font, color: p.color });
        x += p.font.widthOfTextAtSize(p.text, p.size);
      }
      if (wi < ln.length - 1) x += spaceW(w.space);
    });
  });
  const bottom = top - lines.length * LETTER.LEADING;
  if (bottom < LETTER.BOTTOM - 0.01) issues.overflow = true;
  return bottom - o.after;
}

export async function letterPdf(assets: InvitationAssets, c: Campaign, g: Guest): Promise<PdfResult> {
  const d = await newDoc(assets, null);
  const page = d.pdf.addPage([LETTER.W, LETTER.H]);
  const { W, H, M } = LETTER;
  const light = await d.font('light');
  const semi = await d.font('semibold');
  const italic = await d.font('pagellaItalic');
  const s = c.settings || {};
  const L = c.texts?.letter || {};
  const vars = variablesFor(c, g);

  // Banner: full width, ratio 6:1 (35 mm).
  if (assets.logos.banner) {
    const img = await d.pdf.embedPng(assets.logos.banner);
    page.drawImage(img, { x: 0, y: H - W / 6, width: W, height: W / 6 });
  } else {
    d.issues.push({ level: 'error', code: 'no_banner', message: 'The letter banner of this campaign could not be loaded.' });
  }

  // "Monaco, 9 October 2026", right-aligned on x = 188 mm.
  const date = dateLabel(c.letter_date) || dateLabel(new Date().toISOString().slice(0, 10));
  const place = clean(L.place);
  const dl = d.safe(place ? `${place}, ${date}` : date, light, 'light', 'Letter date');
  page.drawText(dl, { x: W - M - light.widthOfTextAtSize(dl, 9.4), y: 245 * MM, size: 9.4, font: light, color: C.slate });

  // The guest block.
  const name = d.safe(clean(g.name_on_letter) || clean(g.name_on_ticket), semi, 'semibold', 'Name on letter');
  const fit = (text: string, f: PDFFont, max: number, min: number, step: number) => {
    let size = max; while (size > min && f.widthOfTextAtSize(text, size) > W - 2 * M) size = Math.round((size - step) * 100) / 100;
    if (f.widthOfTextAtSize(text, size) > W - 2 * M) d.issues.push({ level: 'error', code: 'line_too_long', message: `"${text.slice(0, 40)}..." does not fit on the letter. Shorten it.` });
    return size;
  };
  if (name) page.drawText(name, { x: M, y: 235 * MM, size: fit(name, semi, 10, 7, 0.2), font: semi, color: C.navy });
  let y = 229.5 * MM;
  for (const [label, v] of [['Job title', g.position], ['Organisation', g.organisation]] as const) {
    const line = d.safe(clean(v), light, 'light', label);
    if (!line) continue;
    page.drawText(line, { x: M, y, size: fit(line, light, 9.4, 7, 0.2), font: light, color: C.slate });
    y -= 5 * MM;
  }
  page.drawText(d.safe(salutation(g.greeting, name), light, 'light', 'Greeting'), { x: M, y: 210 * MM, size: 9.4, font: light, color: C.ink });

  // Body.
  const styleOf = async (st: RunStyle, base: { key: FontKey; color: RGB }): Promise<Omit<Piece, 'text'>> =>
    st === 'bold' ? { font: semi, key: 'semibold', size: LETTER.SIZE, color: base.color }
      : st === 'italic' ? { font: italic, key: 'pagellaItalic', size: LETTER.ITALIC_SIZE, color: base.color }
        : { font: await d.font(base.key), key: base.key, size: LETTER.SIZE, color: base.color };
  const piecesOf = async (text: string, field: string, base: { key: FontKey; color: RGB } = { key: 'light', color: C.ink }) => {
    const out: Piece[] = [];
    for (const r of parseMarkup(fill(text, vars).replace(/\s+/g, ' ').trim())) {
      const st = await styleOf(r.style, base);
      out.push({ ...st, text: d.safe(r.text, st.font, st.key, field) });
    }
    return out;
  };
  const flags = { overflow: false };
  const normal: ParaOpts = { indentFirst: 0, indentRest: 0, after: LETTER.AFTER };
  let top = LETTER.TOP;
  for (const p of (L.paragraphs || []).filter(t => clean(t))) top = paragraph(page, await piecesOf(p, 'Letter text'), top, normal, flags);
  const bullets = (L.bullets || []).filter(t => clean(t));
  for (const b of bullets) {
    const bullet: Piece = { text: '•', font: semi, key: 'semibold', size: LETTER.BULLET_SIZE, color: C.steel };
    const gap: Piece = { text: NBSP + NBSP, font: light, key: 'light', size: LETTER.SIZE, color: C.ink };
    const body = await piecesOf(b, 'Letter bullet');
    // The bullet, the two no-break spaces and the first word make one word, as in ReportLab.
    top = paragraph(page, [bullet, gap, ...body], top,
      { indentFirst: LETTER.BULLET_INDENT + LETTER.BULLET_FIRST, indentRest: LETTER.BULLET_INDENT, after: LETTER.BULLET_AFTER }, flags);
  }
  const closing = (L.closing_paragraphs || []).filter(t => clean(t));
  if (bullets.length && closing.length) top -= 8;
  for (const p of closing) top = paragraph(page, await piecesOf(p, 'Letter text'), top, normal, flags);

  // Signature: the image (SM26 letterhead copy) between the closing line and the name.
  const wantsSignature = (s as { signature?: string }).signature !== 'none';
  if (wantsSignature && assets.signature) {
    const b = new Uint8Array(assets.signature);
    const img: PDFImage = b[0] === 0x89 ? await d.pdf.embedPng(assets.signature) : await d.pdf.embedJpg(assets.signature);
    const w = Math.min(img.width * LETTER.SIGNATURE_H / img.height, 80 * MM);
    const h = w * img.height / img.width;
    page.drawImage(img, { x: M - 1.5 * MM, y: top - h, width: w, height: h });
    top -= h + 2;
    if (top - 2 * LETTER.LEADING < LETTER.BOTTOM) flags.overflow = true;
  } else {
    if (wantsSignature) d.issues.push({ level: 'error', code: 'no_signature', message: 'The signature image could not be loaded. Reload the page, or turn the signature off in Settings.' });
    top -= 14;
  }
  const sigName = clean(L.signatory_name);
  const sigTitle = clean(L.signatory_title);
  if (sigName) top = paragraph(page, await piecesOf(`**${sigName.replace(/\*/g, '')}**`, 'Signatory', { key: 'light', color: C.navy }), top, { ...normal, after: 0 }, flags);
  if (sigTitle) top = paragraph(page, await piecesOf(sigTitle, 'Signatory title', { key: 'light', color: C.slate }), top, normal, flags);
  if (flags.overflow) d.issues.push({ level: 'error', code: 'letter_overflow', message: 'The letter is longer than one page. Shorten the texts in Settings.' });

  // Footer: sky rule at 16 mm, text centred at 11 mm.
  page.drawLine({ start: { x: M, y: 16 * MM }, end: { x: W - M, y: 16 * MM }, thickness: 0.6, color: C.sky });
  const footer = d.safe(fill(L.footer, vars), light, 'light', 'Letter footer');
  if (footer) page.drawText(footer, { x: W / 2 - light.widthOfTextAtSize(footer, 7) / 2, y: 11 * MM, size: 7, font: light, color: C.slate });

  d.finish();
  meta(d.pdf, c, 'Invitation Letter', clean(g.name_on_letter) || clean(g.name_on_ticket));
  return { bytes: await d.pdf.save(), issues: d.issues };
}

/* ─── Files ─── */

/** "Élodie Varga" gives "Elodie_Varga". */
export function fileSlug(g: Pick<InvitationRecipient, 'first_name' | 'last_name' | 'name_on_ticket'>): string {
  const base = [g.first_name, g.last_name].map(v => clean(v)).filter(Boolean).join(' ') || clean(g.name_on_ticket) || 'Guest';
  return base.normalize('NFD').replace(/\p{M}/gu, '').replace(/[^A-Za-z0-9]+/g, '_').replace(/^_|_$/g, '') || 'Guest';
}

export const filePrefix = (c: Campaign) => clean((c.settings as { file_prefix?: string })?.file_prefix).replace(/[^A-Za-z0-9]+/g, '_') || 'Invitation';
