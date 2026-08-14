// The post-event impact report, as a file you can send.
//
// The feedback console answers "how did it go?" on screen, which is the wrong
// shape for the people who ask: sponsors deciding whether to renew, the Yacht
// Club, a board. They want one document, on the event's letterhead, that they
// can forward. This builds it from the same answers, so the report and the
// console can never disagree.
//
// Presentation only — the caller assembles the blocks. That keeps the numbers
// in one place (the console, where they are also displayed) rather than
// recomputed here and quietly drifting.

const PAGE_W = 210;
const PAGE_H = 297;
const M_LEFT = 18;
const M_RIGHT = 18;
const M_TOP = 20;
const M_BOTTOM = 18;
const CONTENT_W = PAGE_W - M_LEFT - M_RIGHT;
const FONT = 'helvetica';
const NAVY: [number, number, number] = [11, 38, 83];
const GREY: [number, number, number] = [107, 122, 153];
const INK: [number, number, number] = [22, 38, 74];
const RULE: [number, number, number] = [222, 228, 238];

export type ReportBlock =
  // Headline figures — attendance, response rate, countries.
  | { kind: 'stats'; heading: string; note?: string; items: { label: string; value: string }[] }
  // Anything scored or counted: ratings, matrix rows, objectives picked.
  | { kind: 'bars'; heading: string; note?: string; items: { label: string; value: number; max: number; caption: string }[] }
  // What people actually wrote. Only ever the consented ones — see the console.
  | { kind: 'quotes'; heading: string; note?: string; items: { text: string; author?: string }[] }
  // Commitments and their state. The sponsor report is mostly this: what was
  // promised, and what has been done about it.
  | { kind: 'checklist'; heading: string; note?: string; items: { label: string; detail?: string | null; state: string }[] }
  // A space the document deliberately leaves empty, for figures that live
  // outside the platform and are filled in before sending.
  | { kind: 'placeholder'; heading: string; note?: string; lines: number };

export interface ReportMeta { title: string; subtitle: string; note?: string }
export interface ReportAssets { banner?: string | null; footer?: string | null }

type Doc = import('jspdf').jsPDF;

function imageSize(dataUrl: string): Promise<{ w: number; h: number }> {
  return new Promise(resolve => {
    const img = new Image();
    img.onload = () => resolve({ w: img.naturalWidth, h: img.naturalHeight });
    img.onerror = () => resolve({ w: 0, h: 0 });
    img.src = dataUrl;
  });
}

export async function buildFeedbackReportPdf(
  blocks: ReportBlock[],
  meta: ReportMeta,
  assets: ReportAssets = {},
) {
  const { jsPDF } = await import('jspdf');
  const doc: Doc = new jsPDF({ unit: 'mm', format: 'a4' });

  // Measured before laying anything out: the banner sets where page one starts,
  // the footer sets where every page must stop.
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
    try { doc.addImage(assets.banner as string, 0, 0, PAGE_W, bannerH); } catch { /* a bad image must not lose the report */ }
  }

  const room = (need: number) => {
    if (y + need <= bottomLimit) return;
    doc.addPage();
    // Continuation pages carry the footer but not the banner: a second full
    // strip would spend a third of the page saying nothing new.
    y = M_TOP;
  };

  // ---- title ---------------------------------------------------------------
  doc.setFont(FONT, 'bold'); doc.setFontSize(17); doc.setTextColor(...NAVY);
  doc.text(meta.title, M_LEFT, y); y += 6.5;
  doc.setFont(FONT, 'normal'); doc.setFontSize(9.5); doc.setTextColor(...GREY);
  doc.text(meta.subtitle, M_LEFT, y); y += 5;
  if (meta.note) {
    doc.setFontSize(8.5);
    doc.text(doc.splitTextToSize(meta.note, CONTENT_W) as string[], M_LEFT, y);
    y += 5;
  }
  y += 3;

  const heading = (text: string, note?: string) => {
    room(18);
    doc.setFont(FONT, 'bold'); doc.setFontSize(10); doc.setTextColor(...NAVY);
    doc.text(text.toUpperCase(), M_LEFT, y); y += 2.2;
    doc.setDrawColor(...NAVY); doc.setLineWidth(0.5);
    doc.line(M_LEFT, y, PAGE_W - M_RIGHT, y); y += 5;
    if (note) {
      doc.setFont(FONT, 'normal'); doc.setFontSize(8); doc.setTextColor(...GREY);
      const lines = doc.splitTextToSize(note, CONTENT_W) as string[];
      doc.text(lines, M_LEFT, y); y += lines.length * 3.6 + 1.5;
    }
  };

  for (const block of blocks) {
    if (block.kind === 'stats') {
      heading(block.heading, block.note);
      // Three across; the figure large enough to be read from a slide.
      const colW = CONTENT_W / 3;
      for (let i = 0; i < block.items.length; i += 3) {
        room(16);
        const row = block.items.slice(i, i + 3);
        row.forEach((it, c) => {
          const x = M_LEFT + c * colW;
          doc.setFont(FONT, 'bold'); doc.setFontSize(16); doc.setTextColor(...NAVY);
          doc.text(it.value, x, y + 6);
          doc.setFont(FONT, 'normal'); doc.setFontSize(8); doc.setTextColor(...GREY);
          doc.text(doc.splitTextToSize(it.label, colW - 4) as string[], x, y + 10.5);
        });
        y += 17;
      }
      y += 2;
    }

    if (block.kind === 'bars') {
      heading(block.heading, block.note);
      const labelW = CONTENT_W * 0.52;
      const barW = CONTENT_W * 0.30;
      const barX = M_LEFT + labelW;
      for (const it of block.items) {
        room(7);
        doc.setFont(FONT, 'normal'); doc.setFontSize(8.6); doc.setTextColor(...INK);
        doc.text(doc.splitTextToSize(it.label, labelW - 3)[0] as string, M_LEFT, y + 3);
        // Track, then fill. A zero-width fill would still draw a sliver, so skip it.
        doc.setFillColor(...RULE);
        doc.roundedRect(barX, y + 0.8, barW, 2.4, 1.2, 1.2, 'F');
        const frac = it.max > 0 ? Math.max(0, Math.min(1, it.value / it.max)) : 0;
        if (frac > 0.02) {
          doc.setFillColor(...NAVY);
          doc.roundedRect(barX, y + 0.8, barW * frac, 2.4, 1.2, 1.2, 'F');
        }
        doc.setFontSize(8.2); doc.setTextColor(...GREY);
        doc.text(it.caption, barX + barW + 3, y + 3);
        y += 6.2;
      }
      y += 3;
    }

    if (block.kind === 'checklist') {
      heading(block.heading, block.note);
      const stateX = PAGE_W - M_RIGHT - 26;
      for (const it of block.items) {
        doc.setFont(FONT, 'normal'); doc.setFontSize(8.8); doc.setTextColor(...INK);
        const lines = doc.splitTextToSize(it.label, stateX - M_LEFT - 8) as string[];
        room(lines.length * 4 + (it.detail ? 4 : 0) + 2.5);
        // A filled dot for done, hollow for outstanding: readable in black and
        // white, which is how a contract annexe usually ends up being printed.
        const done = /deliver/i.test(it.state);
        doc.setDrawColor(...NAVY); doc.setLineWidth(0.4);
        if (done) { doc.setFillColor(...NAVY); doc.circle(M_LEFT + 1.6, y + 1.4, 1.4, 'FD'); }
        else doc.circle(M_LEFT + 1.6, y + 1.4, 1.4, 'D');
        doc.text(lines, M_LEFT + 6, y + 2.4);
        doc.setFontSize(7.6); doc.setTextColor(...GREY);
        doc.text(it.state, PAGE_W - M_RIGHT, y + 2.4, { align: 'right' });
        y += lines.length * 4;
        if (it.detail) {
          doc.setFontSize(7.6); doc.setTextColor(...GREY);
          doc.text(doc.splitTextToSize(it.detail, stateX - M_LEFT - 8)[0] as string, M_LEFT + 6, y + 2);
          y += 4;
        }
        y += 1.6;
      }
      y += 3;
    }

    if (block.kind === 'placeholder') {
      heading(block.heading, block.note);
      // Ruled lines rather than a blank gap: it reads as "to be completed"
      // rather than as something the generator forgot.
      doc.setDrawColor(...RULE); doc.setLineWidth(0.3);
      for (let i = 0; i < block.lines; i++) {
        room(7);
        doc.line(M_LEFT, y + 4, PAGE_W - M_RIGHT, y + 4);
        y += 7;
      }
      y += 3;
    }

    if (block.kind === 'quotes') {
      heading(block.heading, block.note);
      for (const q of block.items) {
        doc.setFont(FONT, 'normal'); doc.setFontSize(8.8); doc.setTextColor(...INK);
        const lines = doc.splitTextToSize(q.text, CONTENT_W - 6) as string[];
        room(lines.length * 4 + (q.author ? 5 : 2) + 3);
        // A rule down the left rather than a box: quieter, and it survives a
        // quote that runs over a page break.
        doc.setDrawColor(...RULE); doc.setLineWidth(0.8);
        doc.line(M_LEFT + 1, y - 1, M_LEFT + 1, y + lines.length * 4);
        doc.text(lines, M_LEFT + 5, y + 2.5);
        y += lines.length * 4 + 1.5;
        if (q.author) {
          doc.setFontSize(7.8); doc.setTextColor(...GREY);
          doc.text(q.author, M_LEFT + 5, y + 2); y += 4;
        }
        y += 2.5;
      }
      y += 1;
    }
  }

  // ---- footer strip + page numbers on every page ---------------------------
  const pages = doc.getNumberOfPages();
  for (let p = 1; p <= pages; p++) {
    doc.setPage(p);
    if (footerH && assets.footer) {
      try { doc.addImage(assets.footer, 0, PAGE_H - footerH, PAGE_W, footerH); } catch { /* ignore */ }
    }
    doc.setFont(FONT, 'normal'); doc.setFontSize(7.5); doc.setTextColor(...GREY);
    doc.text(`${p} / ${pages}`, PAGE_W - M_RIGHT, PAGE_H - Math.max(footerH + 3, 8), { align: 'right' });
  }

  return doc;
}

export async function downloadFeedbackReportPdf(
  blocks: ReportBlock[],
  meta: ReportMeta,
  assets: ReportAssets = {},
  filename = 'sm26-impact-report.pdf',
) {
  const doc = await buildFeedbackReportPdf(blocks, meta, assets);
  doc.save(filename);
}
