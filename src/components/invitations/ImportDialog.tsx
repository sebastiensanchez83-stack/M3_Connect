import { useEffect, useMemo, useRef, useState, type DragEvent } from 'react';
import { AlertTriangle, FileUp, Loader2, Upload } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { toast } from '@/hooks/use-toast';
import type { InvitationCampaign, InvitationRecipient, InvitationRecipientInsert } from './types';
import { eventRecipients, insertRecipients, logAction, type GlGuestLite } from './lib/api';
import {
  FIELDS, HIT_LABEL, WHERE_LABEL, buildDrafts, defaultChoice, earlierInFile, findHeaderRow, findHits, guessMapping, pickSheet,
  type DuplicateHit, type FieldKey, type ImportChoice, type ImportDraft, type KnownPerson, type Mapping,
} from './lib/importer';
import { CHECK_LABEL, type CheckReason } from './lib/names';
import { normKey, personKey } from './lib/norm';
import { decodeText, readCsvText, readXlsx, type Sheet } from './lib/sheets';

const STRONG: CheckReason[] = ['title_other', 'title_read', 'name_split', 'single_name', 'case_changed', 'position_translated', 'position_french', 'note_check'];

interface Reviewed { d: ImportDraft; hits: DuplicateHit[]; inFile: boolean; choice: ImportChoice }

export function ImportDialog({ open, onClose, campaign, recipients, guests, onImported }: {
  open: boolean; onClose: () => void; campaign: InvitationCampaign; recipients: InvitationRecipient[]; guests: GlGuestLite[];
  onImported: () => void | Promise<void>;
}) {
  const [step, setStep] = useState<'file' | 'map' | 'review'>('file');
  const [fileName, setFileName] = useState('');
  const [sheets, setSheets] = useState<Sheet[]>([]);
  const [sheetIdx, setSheetIdx] = useState(0);
  const [headerRow, setHeaderRow] = useState(0);
  const [mapping, setMapping] = useState<Mapping>({});
  const [paste, setPaste] = useState('');
  const [rows, setRows] = useState<Reviewed[]>([]);
  const [others, setOthers] = useState<(InvitationRecipient & { campaign_name: string })[]>([]);
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);
  const fileRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!open) return;
    setStep('file'); setFileName(''); setSheets([]); setRows([]); setPaste('');
    eventRecipients(campaign.gl_event_id, campaign.id).then(setOthers).catch(() => setOthers([]));
  }, [open, campaign.gl_event_id, campaign.id]);

  const sheet = sheets[sheetIdx];

  const takeSheets = (list: Sheet[], name: string) => {
    const usable = list.filter(s => s.rows.some(r => r.some(c => c.trim())));
    if (!usable.length) { toast({ title: 'Nothing to import', description: 'The file has no rows.', variant: 'destructive' }); return; }
    const idx = pickSheet(usable.map(s => s.name));
    setSheets(usable); setSheetIdx(idx); setFileName(name);
    const hr = findHeaderRow(usable[idx].rows);
    setHeaderRow(hr); setMapping(guessMapping(usable[idx].rows[hr] || []));
    setStep('map');
  };

  const readFile = async (file: File) => {
    setBusy(true);
    try {
      const buf = await file.arrayBuffer();
      if (/\.xlsx?$/i.test(file.name) || /spreadsheetml|ms-excel/.test(file.type)) {
        takeSheets(await readXlsx(buf), file.name);
      } else {
        takeSheets([readCsvText(decodeText(buf))], file.name);
      }
    } catch (e) {
      const m = (e as Error).message;
      toast({
        title: 'This file could not be read',
        description: m === 'old_xls' ? 'This is an old .xls file. In Excel, save it as .xlsx (or CSV) and drop it again.' : 'Use an Excel .xlsx file or a CSV.',
        variant: 'destructive',
      });
    } finally { setBusy(false); }
  };
  const onDrop = (e: DragEvent) => { e.preventDefault(); setDragging(false); const f = e.dataTransfer.files?.[0]; if (f) readFile(f); };

  const pickSheetIdx = (i: number) => {
    setSheetIdx(i);
    const hr = findHeaderRow(sheets[i].rows);
    setHeaderRow(hr); setMapping(guessMapping(sheets[i].rows[hr] || []));
  };

  const header = sheet?.rows[headerRow] || [];
  const sample = (col: number | undefined) => {
    if (col === undefined || !sheet) return '';
    for (let i = headerRow + 1; i < sheet.rows.length; i++) { const v = (sheet.rows[i]?.[col] || '').trim(); if (v) return v; }
    return '';
  };
  const hasName = mapping.contact !== undefined || mapping.name_on_ticket !== undefined || (mapping.first_name !== undefined && mapping.last_name !== undefined);

  // Everybody already known on this event: this campaign, its other campaigns, its guest list.
  const known = useMemo<KnownPerson[]>(() => {
    const linked = new Set([...recipients, ...others].map(r => r.gl_guest_id).filter(Boolean) as string[]);
    const fromRecipient = (r: InvitationRecipient, where: KnownPerson['where'], campaign_name?: string): KnownPerson => ({
      kind: 'recipient', id: r.id, where, campaign_name, label: r.name_on_ticket, email: r.email,
      name_key: r.name_key || personKey(r), org_key: r.org_key || normKey(r.organisation), status: r.status,
    });
    return [
      ...recipients.map(r => fromRecipient(r, 'this')),
      ...others.map(r => fromRecipient(r, 'other_campaign', r.campaign_name)),
      ...guests.filter(g => !linked.has(g.id)).map(g => ({
        kind: 'guest' as const, id: g.id, where: 'guest_list' as const, label: `${g.first_name} ${g.last_name}`.trim(), email: g.email,
        name_key: normKey(`${g.first_name} ${g.last_name}`, true), org_key: normKey(g.company), status: g.status, source: g.source,
      })),
    ];
  }, [recipients, others, guests]);

  const review = () => {
    if (!sheet) return;
    const drafts = buildDrafts(sheet.rows, headerRow, mapping);
    if (!drafts.length) { toast({ title: 'No guest found', description: 'Check the name column.', variant: 'destructive' }); return; }
    const dupInFile = earlierInFile(drafts);
    setRows(drafts.map((d, i) => {
      const hits = findHits(d, known);
      return { d, hits, inFile: dupInFile.has(i), choice: defaultChoice(hits, dupInFile.has(i)) };
    }));
    setStep('review');
  };

  const readPaste = () => {
    const text = paste.trim();
    if (!text) return;
    takeSheets([readCsvText(text)], 'Pasted rows');
  };

  const toImport = rows.filter(r => r.choice === 'import');
  const doImport = async () => {
    if (!toImport.length) return;
    setBusy(true);
    try {
      const maxOrder = Math.max(0, ...recipients.map(r => r.sort_order || 0));
      const useFileOrder = !recipients.length && toImport.every(r => r.d.order !== null);
      const payload: InvitationRecipientInsert[] = toImport.map(({ d }, i) => ({
        campaign_id: campaign.id,
        sort_order: useFileOrder ? d.order : maxOrder + i + 1,
        honorific: d.honorific || null, first_name: d.first_name || null, last_name: d.last_name || null,
        name_on_ticket: d.name_on_ticket, name_on_letter: d.name_on_letter || null, greeting: d.greeting || null,
        position: d.position || null, organisation: d.organisation || null, country: d.country || null,
        email: d.email && !d.email_invalid ? d.email : null, phone: d.phone || null, notes: d.notes || null,
        needs_check: d.reasons.some(x => STRONG.includes(x)) || d.email_invalid,
        status: 'draft',
      }));
      const added = await insertRecipients(payload);
      await logAction(campaign.id, 'guests_imported', { added: added.length, skipped: rows.length - toImport.length, source: /\.xlsx$/i.test(fileName) ? 'xlsx' : 'csv' });
      toast({ title: `${added.length} guest${added.length > 1 ? 's' : ''} imported`, description: rows.length > toImport.length ? `${rows.length - toImport.length} skipped.` : undefined });
      await onImported();
      onClose();
    } catch (e) {
      const err = e as Error & { code?: string };
      toast({
        title: 'Nothing was imported',
        description: err.code === '23505' ? 'Two guests would share an e-mail address in this campaign. Skip one of them.' : err.message,
        variant: 'destructive',
      });
    } finally { setBusy(false); }
  };

  const setChoice = (i: number, choice: ImportChoice) => setRows(rs => rs.map((r, k) => (k === i ? { ...r, choice } : r)));
  const flagged = rows.filter(r => r.d.reasons.some(x => STRONG.includes(x)) || r.d.email_invalid).length;
  const dupCount = rows.filter(r => r.hits.length || r.inFile).length;

  return (
    <Dialog open={open} onOpenChange={o => { if (!o) onClose(); }}>
      <DialogContent className="max-w-5xl w-[calc(100vw-1rem)] max-h-[92vh] overflow-y-auto p-4 sm:p-6">
        <DialogHeader><DialogTitle>Import guests</DialogTitle></DialogHeader>

        {step === 'file' && (
          <div className="space-y-4">
            <div
              onDragOver={e => { e.preventDefault(); setDragging(true); }} onDragLeave={() => setDragging(false)} onDrop={onDrop}
              className={`rounded-lg border-2 border-dashed p-8 text-center ${dragging ? 'border-[#5E9CC4] bg-sky-50' : 'border-gray-300'}`}>
              <FileUp className="mx-auto h-8 w-8 text-gray-400" />
              <p className="mt-2 text-sm text-gray-700">Drop your Excel file (.xlsx) or a CSV here</p>
              <p className="text-xs text-gray-500">The sheet "Prêts pour invitation" is picked when it exists. Columns are matched on the next step.</p>
              <Button className="mt-3" variant="outline" disabled={busy} onClick={() => fileRef.current?.click()}>
                {busy ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Upload className="h-4 w-4 mr-2" />}Choose a file
              </Button>
              <input ref={fileRef} type="file" accept=".xlsx,.csv,.tsv,.txt,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv" className="hidden"
                onChange={e => { const f = e.target.files?.[0]; if (f) readFile(f); e.target.value = ''; }} />
            </div>
            <details className="text-sm">
              <summary className="cursor-pointer font-medium">Or paste rows from Excel (with the header row)</summary>
              <Textarea rows={6} className="mt-2 font-mono text-xs" value={paste} onChange={e => setPaste(e.target.value)} aria-label="Rows pasted from Excel" />
              <Button size="sm" className="mt-2" variant="outline" disabled={!paste.trim()} onClick={readPaste}>Read these rows</Button>
            </details>
          </div>
        )}

        {step === 'map' && sheet && (
          <div className="space-y-4">
            <div className="flex flex-wrap items-end gap-4 text-sm">
              <div><div className="text-xs text-gray-500">File</div><div className="font-medium break-all">{fileName}</div></div>
              {sheets.length > 1 && (
                <label className="block">
                  <span className="text-xs text-gray-500 block">Sheet</span>
                  <select className="border rounded-md h-9 px-2 bg-white" value={sheetIdx} onChange={e => pickSheetIdx(Number(e.target.value))}>
                    {sheets.map((s, i) => <option key={i} value={i}>{s.name}</option>)}
                  </select>
                </label>
              )}
              <label className="block">
                <span className="text-xs text-gray-500 block">Header row</span>
                <select className="border rounded-md h-9 px-2 bg-white" value={headerRow}
                  onChange={e => { const hr = Number(e.target.value); setHeaderRow(hr); setMapping(guessMapping(sheet.rows[hr] || [])); }}>
                  {sheet.rows.slice(0, 10).map((r, i) => <option key={i} value={i}>Row {i + 1}: {r.filter(Boolean).slice(0, 3).join(', ').slice(0, 40)}</option>)}
                </select>
              </label>
              <span className="text-gray-500">{Math.max(0, sheet.rows.length - headerRow - 1)} rows below the header</span>
            </div>
            <p className="text-sm text-gray-600">Match each field to a column of your file. A full name with its title (your <b>Contact</b> column) is enough: the module proposes the name on the ticket, the name on the letter and the greeting. E-mail addresses can be typed in the table afterwards.</p>
            <div className="grid sm:grid-cols-2 gap-x-6 gap-y-2">
              {FIELDS.map(f => (
                <label key={f.key} className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)] items-center gap-2 text-sm">
                  <span className="text-gray-700">{f.label}</span>
                  <span className="min-w-0">
                    <select className="border rounded-md h-9 px-2 bg-white w-full" value={mapping[f.key] ?? ''}
                      onChange={e => setMapping(m => { const n = { ...m }; if (e.target.value === '') delete n[f.key as FieldKey]; else n[f.key as FieldKey] = Number(e.target.value); return n; })}>
                      <option value="">Not in the file</option>
                      {header.map((h, i) => <option key={i} value={i}>{h || `Column ${i + 1}`}</option>)}
                    </select>
                    {mapping[f.key] !== undefined && <span className="block text-xs text-gray-400 truncate">e.g. {sample(mapping[f.key]) || 'empty'}</span>}
                  </span>
                </label>
              ))}
            </div>
            {!hasName && <p role="alert" className="text-sm text-red-700">Choose the column with the guests' names (Contact, Name on ticket, or First name and Surname).</p>}
            <div className="flex flex-wrap gap-2 justify-end">
              <Button variant="outline" onClick={() => setStep('file')}>Back</Button>
              <Button disabled={!hasName} onClick={review}>Review the guests</Button>
            </div>
          </div>
        )}

        {step === 'review' && (
          <div className="space-y-3">
            <div className="flex flex-wrap gap-x-6 gap-y-1 text-sm">
              <span><b>{toImport.length}</b> to import</span>
              <span><b>{rows.length - toImport.length}</b> skipped</span>
              <span className={dupCount ? 'text-amber-700' : ''}><b>{dupCount}</b> possible duplicate{dupCount === 1 ? '' : 's'}</span>
              <span className={flagged ? 'text-amber-700' : ''}><b>{flagged}</b> to check</span>
            </div>
            <p className="text-xs text-gray-500">Nothing is merged: a guest who may already be invited is shown with what they match, and you choose. Rows marked to check stay flagged in the table until you clear them.</p>
            <ul className="divide-y rounded-md border">
              {rows.map((row, i) => (
                <li key={i} className={`p-3 text-sm grid gap-2 sm:grid-cols-[auto_minmax(0,1fr)_auto] items-start ${row.choice === 'skip' ? 'bg-gray-50 text-gray-500' : ''}`}>
                  <span className="text-xs text-gray-400 w-10">{row.d.order ?? `L${row.d.line}`}</span>
                  <div className="min-w-0 space-y-1">
                    <div className="flex flex-wrap items-baseline gap-x-3">
                      <span className="font-medium text-gray-900">{row.d.name_on_ticket}</span>
                      {row.d.name_on_letter !== row.d.name_on_ticket && <span className="text-xs text-gray-500">letter: {row.d.name_on_letter}</span>}
                      <span className="text-xs text-gray-600">{row.d.greeting.startsWith('Your ') ? row.d.greeting : `Dear ${row.d.greeting}`},</span>
                    </div>
                    <div className="text-xs text-gray-600">
                      {[row.d.position, row.d.organisation, row.d.country].filter(Boolean).join(' · ')}
                      {row.d.position_original && <span className="text-gray-400"> (was "{row.d.position_original}")</span>}
                    </div>
                    <div className="text-xs">
                      {row.d.email ? <span className={row.d.email_invalid ? 'text-red-700' : 'text-gray-600'}>{row.d.email}{row.d.email_invalid ? ': not a valid address, not imported' : ''}</span>
                        : <span className="text-gray-400">No e-mail (type it in the table)</span>}
                    </div>
                    {(row.d.reasons.length > 0 || row.d.suggested_greeting) && (
                      <ul className="text-xs text-amber-800 space-y-0.5">
                        {row.d.reasons.map(x => <li key={x}>{CHECK_LABEL[x]}{x === 'greeting_kept' && row.d.suggested_greeting ? `: "${row.d.suggested_greeting}"` : ''}</li>)}
                      </ul>
                    )}
                    {(row.inFile || row.hits.length > 0) && (
                      <ul className="text-xs text-red-800 space-y-0.5">
                        {row.inFile && <li className="flex gap-1"><AlertTriangle className="h-3.5 w-3.5 shrink-0" />Same person as an earlier row of this file</li>}
                        {row.hits.map((h, k) => (
                          <li key={k} className="flex gap-1"><AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                            {HIT_LABEL[h.on]} as {h.person.label} {WHERE_LABEL[h.person.where]}{h.person.campaign_name ? ` "${h.person.campaign_name}"` : ''} ({hitStatus(h.person)})
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                  <select aria-label={`Import ${row.d.name_on_ticket}`} className="border rounded-md h-9 px-2 bg-white text-sm" value={row.choice}
                    onChange={e => setChoice(i, e.target.value as ImportChoice)}>
                    <option value="import">Import</option>
                    <option value="skip">Skip</option>
                  </select>
                </li>
              ))}
            </ul>
            <div className="flex flex-wrap gap-2 justify-end sticky bottom-0 bg-white py-2">
              <Button variant="outline" onClick={() => setStep('map')}>Back</Button>
              <Button disabled={busy || !toImport.length} onClick={doImport}>
                {busy && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}Import {toImport.length} guest{toImport.length === 1 ? '' : 's'}
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function hitStatus(p: KnownPerson): string {
  if (p.kind === 'guest') {
    if (p.status === 'requested' && p.source === 'request') return 'asked for an invitation on the public page; you choose later whether to adopt the request';
    return { invited: 'invited', confirmed: 'confirmed', declined: 'declined', rejected: 'request refused', cancelled: 'cancelled', requested: 'request pending' }[p.status] || p.status;
  }
  return p.status;
}
