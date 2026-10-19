/* ─── PDFs in the browser: preview, downloads, ZIP, files for the sender ───
 * Imported lazily by the screens (pdf-lib, fontkit and JSZip load only here).
 */
import type { InvitationCampaign, InvitationRecipient } from '../types';
import { loadAssets, updateRecipient, uploadPdf } from './api';
import { fileSlug, filePrefix, letterPdf, ticketPdf, type PdfIssue, type PdfResult } from './pdf';
import { emailCopyFor, emailCopyText } from './emailCopy';
import { saveBlob } from './sheets';

export type { PdfIssue, PdfResult };

export interface GuestPdfs { ticket: PdfResult; letter: PdfResult; issues: PdfIssue[] }

export async function guestPdfs(c: InvitationCampaign, r: InvitationRecipient, which: 'both' | 'ticket' | 'letter' = 'both'): Promise<GuestPdfs> {
  const assets = await loadAssets(c);
  const empty: PdfResult = { bytes: new Uint8Array(), issues: [] };
  const ticket = which === 'letter' ? empty : await ticketPdf(assets, c, r);
  const letter = which === 'ticket' ? empty : await letterPdf(assets, c, r);
  return { ticket, letter, issues: [...ticket.issues, ...letter.issues] };
}

export const ticketName = (c: InvitationCampaign, r: InvitationRecipient) => `${filePrefix(c)}_Ticket_${fileSlug(r)}.pdf`;
export const letterName = (c: InvitationCampaign, r: InvitationRecipient) => `${filePrefix(c)}_Letter_${fileSlug(r)}.pdf`;
export const emailName = (c: InvitationCampaign, r: InvitationRecipient) => `${filePrefix(c)}_Email_${fileSlug(r)}.txt`;

/**
 * "Download ticket + letter" of one guest: the two PDFs, as the platform e-mail attaches them,
 * ready to attach to an e-mail sent from your own mailbox. Nothing is saved when a PDF has an
 * error (the issues come back instead).
 */
export async function downloadGuestPdfs(c: InvitationCampaign, r: InvitationRecipient): Promise<{ ok: true } | { ok: false; issues: PdfIssue[] }> {
  const p = await guestPdfs(c, r);
  const errors = p.issues.filter(x => x.level === 'error');
  if (errors.length) return { ok: false, issues: errors };
  saveBlob(new Blob([p.letter.bytes as unknown as BlobPart], { type: 'application/pdf' }), letterName(c, r));
  // Two files from one click: a short gap so the browser takes the second one too.
  await new Promise(res => setTimeout(res, 400));
  saveBlob(new Blob([p.ticket.bytes as unknown as BlobPart], { type: 'application/pdf' }), ticketName(c, r));
  return { ok: true };
}

export interface ZipResult { blob: Blob | null; done: number; skipped: { r: InvitationRecipient; issues: PdfIssue[] }[] }

/**
 * One folder per guest, numbered as in the campaign's list (01_First_Last/, with
 * WYS_Ticket_First_Last.pdf and WYS_Letter_First_Last.pdf), so a ZIP of a few selected
 * guests keeps the numbers of the table.
 */
export async function zipFor(c: InvitationCampaign, list: InvitationRecipient[], onProgress?: (n: number) => void, numberOf?: (r: InvitationRecipient) => number,
  opts: { email?: boolean } = {}): Promise<ZipResult> {
  const JSZip = (await import('jszip')).default;
  const zip = new JSZip();
  const skipped: ZipResult['skipped'] = [];
  const width = Math.max(2, String(Math.max(list.length, ...list.map(r => numberOf?.(r) ?? 0))).length);
  const used = new Map<string, number>();
  let done = 0;
  for (let i = 0; i < list.length; i++) {
    const r = list[i];
    const p = await guestPdfs(c, r);
    onProgress?.(i + 1);
    const errors = p.issues.filter(x => x.level === 'error');
    if (errors.length) { skipped.push({ r, issues: errors }); continue; }
    let slug = fileSlug(r);
    const n = (used.get(slug) || 0) + 1; used.set(slug, n);
    if (n > 1) slug += `_${n}`;
    const folder = zip.folder(`${String(numberOf?.(r) ?? i + 1).padStart(width, '0')}_${slug}`)!;
    folder.file(ticketName(c, r).replace(fileSlug(r), slug), p.ticket.bytes);
    folder.file(letterName(c, r).replace(fileSlug(r), slug), p.letter.bytes);
    // To send them yourself: the e-mail of that guest (address, subject, text) next to the PDFs.
    if (opts.email) folder.file(emailName(c, r).replace(fileSlug(r), slug), emailCopyText(emailCopyFor(c, r)));
    done++;
  }
  return { blob: done ? await zip.generateAsync({ type: 'blob' }) : null, done, skipped };
}

/**
 * Generates the guest's ticket and letter and stores them where the sender reads them
 * (invitation-files/<campaign>/<guest>/ticket.pdf and letter.pdf). Refuses a guest whose
 * PDFs have an error (missing character, name too long, letter too long, no signature).
 */
export async function prepareForSending(c: InvitationCampaign, r: InvitationRecipient): Promise<{ ok: true; r: InvitationRecipient } | { ok: false; issues: PdfIssue[] }> {
  const p = await guestPdfs(c, r);
  const errors = p.issues.filter(x => x.level === 'error');
  if (errors.length) return { ok: false, issues: errors };
  const ticket_pdf_path = await uploadPdf(c.id, r.id, 'ticket', p.ticket.bytes);
  const letter_pdf_path = await uploadPdf(c.id, r.id, 'letter', p.letter.bytes);
  const updated = await updateRecipient(r.id, { ticket_pdf_path, letter_pdf_path, generated_at: new Date().toISOString() });
  return { ok: true, r: updated };
}
