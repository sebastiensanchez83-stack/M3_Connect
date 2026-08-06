// The printable programme, as an actual file.
//
// "Download the programme" used to open a new window and call print(), which
// hands you the operating system's print dialog and leaves you to work out that
// "Save as PDF" is hiding in it. People asked for a download and got a printer.
// This builds the PDF directly, so the button downloads a PDF.

const PAGE_W = 210;
const PAGE_H = 297;
const M_LEFT = 18;
const M_RIGHT = 18;
const M_TOP = 20;
const M_BOTTOM = 18;
const CONTENT_W = PAGE_W - M_LEFT - M_RIGHT;
const TIME_W = 26;                       // the left time column
const BODY_X = M_LEFT + TIME_W;
const BODY_W = CONTENT_W - TIME_W;
const FONT = 'helvetica';
const NAVY: [number, number, number] = [11, 38, 83];
const GREY: [number, number, number] = [107, 122, 153];
const INK: [number, number, number] = [22, 38, 74];

export interface ProgrammeSession {
  title: string;
  starts_at: string | null;
  ends_at: string | null;
  room?: string | null;
  speakers?: string | null;
  description?: string | null;
}

export interface ProgrammeDay {
  key: string;                           // already-formatted day heading
  items: ProgrammeSession[];
}

export interface ProgrammeMeta {
  title: string;
  subtitle: string;
  /** Printed in the corner of every page when the programme is not final. */
  draftNotice?: string | null;
}

export interface ProgrammeAssets {
  /** Event banner, drawn full width at the top of the first page. */
  banner?: string | null;
  /** Partner-logo strip, drawn full width at the foot of every page. */
  footer?: string | null;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Doc = any;

/** Natural size of a data-URL image, so it scales without distortion. */
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

export async function buildProgrammePdf(
  days: ProgrammeDay[],
  meta: ProgrammeMeta,
  fmtTime: (iso: string | null) => string,
  assets: ProgrammeAssets = {},
) {
  const { jsPDF } = await import('jspdf');
  const doc: Doc = new jsPDF({ unit: 'mm', format: 'a4' });

  // Both strips are measured before anything is laid out: the banner decides
  // where the first page starts, the footer decides where every page must stop.
  let bannerH = 0;
  if (assets.banner) {
    const s = await imageSize(assets.banner);
    bannerH = s.w ? (PAGE_W * s.h) / s.w : 0;
  }
  let footerH = 0;
  if (assets.footer) {
    const s = await imageSize(assets.footer);
    footerH = s.w ? (PAGE_W * s.h) / s.w : 0;
  }
  const bottomLimit = PAGE_H - Math.max(M_BOTTOM, footerH + 8);

  let y = bannerH ? bannerH + 10 : M_TOP;
  if (bannerH) {
    try { doc.addImage(assets.banner, 0, 0, PAGE_W, bannerH); } catch { /* a bad image must not lose the programme */ }
  }

  const room = (need: number) => {
    if (y + need <= bottomLimit) return;
    doc.addPage();
    // Continuation pages carry the footer but not the banner — a second full
    // strip would eat a third of the page for no new information.
    y = M_TOP;
  };

  // ---- title -------------------------------------------------------------
  doc.setFont(FONT, 'bold'); doc.setFontSize(17); doc.setTextColor(...NAVY);
  doc.text(meta.title, M_LEFT, y); y += 6.5;
  doc.setFont(FONT, 'normal'); doc.setFontSize(9.5); doc.setTextColor(...GREY);
  doc.text(meta.subtitle, M_LEFT, y); y += 5;
  if (meta.draftNotice) {
    doc.setFontSize(8.5); doc.setTextColor(180, 120, 20);
    doc.text(meta.draftNotice, M_LEFT, y); y += 5;
  }
  y += 3;

  for (const day of days) {
    // A day heading alone at the foot of a page helps nobody.
    room(16);
    doc.setFont(FONT, 'bold'); doc.setFontSize(10); doc.setTextColor(...NAVY);
    doc.text(day.key.toUpperCase(), M_LEFT, y); y += 2.2;
    doc.setDrawColor(...NAVY); doc.setLineWidth(0.5);
    doc.line(M_LEFT, y, PAGE_W - M_RIGHT, y); y += 5.5;

    for (const s of day.items) {
      doc.setFont(FONT, 'bold'); doc.setFontSize(9.5);
      const titleLines: string[] = doc.splitTextToSize(s.title || '—', BODY_W);
      doc.setFont(FONT, 'normal'); doc.setFontSize(8.4);
      const metaBits = [s.speakers, s.room].filter(Boolean).join(' · ');
      const metaLines: string[] = metaBits ? doc.splitTextToSize(metaBits, BODY_W) : [];
      const descLines: string[] = s.description ? doc.splitTextToSize(s.description, BODY_W) : [];
      const blockH = titleLines.length * 4.4 + metaLines.length * 3.8 + descLines.length * 3.8 + 4;

      room(blockH);
      const top = y;

      doc.setFont(FONT, 'normal'); doc.setFontSize(8.6); doc.setTextColor(...GREY);
      const time = s.starts_at
        ? `${fmtTime(s.starts_at)}${s.ends_at ? ` – ${fmtTime(s.ends_at)}` : ''}`
        : '';
      if (time) doc.text(time, M_LEFT, y);

      doc.setFont(FONT, 'bold'); doc.setFontSize(9.5); doc.setTextColor(...INK);
      for (const l of titleLines) { doc.text(l, BODY_X, y); y += 4.4; }
      if (metaLines.length) {
        doc.setFont(FONT, 'normal'); doc.setFontSize(8.4); doc.setTextColor(...GREY);
        for (const l of metaLines) { doc.text(l, BODY_X, y); y += 3.8; }
      }
      if (descLines.length) {
        doc.setFont(FONT, 'normal'); doc.setFontSize(8.4); doc.setTextColor(75, 85, 99);
        for (const l of descLines) { doc.text(l, BODY_X, y); y += 3.8; }
      }

      y = Math.max(y, top) + 2;
      doc.setDrawColor(238, 240, 244); doc.setLineWidth(0.2);
      doc.line(M_LEFT, y - 1.2, PAGE_W - M_RIGHT, y - 1.2);
      y += 1.5;
    }
    y += 3;
  }

  // ---- footer strip + page numbers on every page -------------------------
  const pages = doc.getNumberOfPages();
  for (let p = 1; p <= pages; p++) {
    doc.setPage(p);
    if (footerH) {
      try { doc.addImage(assets.footer, 0, PAGE_H - footerH, PAGE_W, footerH); } catch { /* ignore */ }
    }
    doc.setFont(FONT, 'normal'); doc.setFontSize(7.6); doc.setTextColor(...GREY);
    doc.text(`${p} / ${pages}`, PAGE_W - M_RIGHT, PAGE_H - (footerH ? footerH + 3.5 : 10), { align: 'right' });
  }

  return doc;
}

export async function downloadProgrammePdf(
  days: ProgrammeDay[],
  meta: ProgrammeMeta,
  fmtTime: (iso: string | null) => string,
  assets: ProgrammeAssets = {},
  filename = 'sm26-programme.pdf',
) {
  const doc = await buildProgrammePdf(days, meta, fmtTime, assets);
  doc.save(filename);
}
