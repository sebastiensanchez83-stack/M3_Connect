import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import {
  AlertTriangle, CheckCircle2, ChevronDown, ChevronUp, Download, Eye, Loader2, Plus, Trash2, Upload, UserCheck, Wand2,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { toast } from '@/hooks/use-toast';
import { useAuth } from '@/contexts/AuthContext';
import type { InvitationCampaign, InvitationCampaignSettings, InvitationRecipient, InvitationRecipientUpdate, InvitationTicketStyle } from './types';
import { insertRecipients, type GlGuestLite } from './lib/api';
import { CHECK_LABEL, parseContact, proposeNames, splitSuffix } from './lib/names';
import { translatePosition } from './lib/positions';
import { isEmail } from './lib/norm';
import { guestName, type GuestRow } from './lib/model';
import { saveBlob } from './lib/sheets';
import { ImportDialog } from './ImportDialog';
import { PreviewPanel } from './PreviewPanel';
import { StatusChip } from './ui';

export interface GuestsTabProps {
  campaign: InvitationCampaign;
  rows: GuestRow[];
  guests: GlGuestLite[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  saveRecipient: (id: string, patch: InvitationRecipientUpdate) => Promise<boolean>;
  removeRecipients: (ids: string[]) => Promise<void>;
  patchSettings: (patch: Partial<InvitationCampaignSettings>) => Promise<void>;
  setStyle: (s: InvitationTicketStyle) => void;
  reload: () => Promise<void>;
}

type Filter = 'all' | 'check' | 'no_email' | 'unsent';
const FILTERS: { key: Filter; label: string }[] = [
  { key: 'all', label: 'All' }, { key: 'check', label: 'To check' }, { key: 'no_email', label: 'No e-mail' }, { key: 'unsent', label: 'Not sent yet' },
];

const attention = (g: GuestRow) => g.r.needs_check || g.dups.length > 0 || !!g.request;
const editable = (g: GuestRow) => g.status === 'draft' || g.status === 'ready';

export function GuestsTab(p: GuestsTabProps) {
  const { campaign, rows, selectedId, onSelect } = p;
  const [filter, setFilter] = useState<Filter>('all');
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [open, setOpen] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [adding, setAdding] = useState(false);
  const [zipping, setZipping] = useState<string | null>(null);

  const shown = useMemo(() => rows.filter(g =>
    filter === 'all' ? true : filter === 'check' ? attention(g) : filter === 'no_email' ? !g.r.email : editable(g) || g.status === 'not_sent'), [rows, filter]);
  const counts = useMemo(() => ({
    all: rows.length, check: rows.filter(attention).length, no_email: rows.filter(g => !g.r.email).length,
    unsent: rows.filter(g => editable(g) || g.status === 'not_sent').length,
  }), [rows]);
  const selected = rows.find(g => g.r.id === selectedId) || null;
  const pickedRows = rows.filter(g => picked.has(g.r.id));

  useEffect(() => { setPicked(s => new Set([...s].filter(id => rows.some(g => g.r.id === id)))); }, [rows]);

  const toggle = (id: string) => setPicked(s => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const allShownPicked = shown.length > 0 && shown.every(g => picked.has(g.r.id));

  const bulkStatus = async (status: 'draft' | 'ready') => {
    const ids = pickedRows.filter(editable).map(g => g.r.id);
    for (const id of ids) await p.saveRecipient(id, { status });
    toast({ title: `${ids.length} guest${ids.length === 1 ? '' : 's'} marked ${status}` });
  };
  const bulkRemove = async () => {
    const ids = pickedRows.filter(g => editable(g) && !g.r.gl_guest_id).map(g => g.r.id);
    if (!ids.length) return;
    if (!confirm(`Remove ${ids.length} guest${ids.length === 1 ? '' : 's'} from this campaign? Guests already invited are kept.`)) return;
    await p.removeRecipients(ids);
    setPicked(new Set());
  };
  const zip = async (list: InvitationRecipient[]) => {
    if (!list.length) return;
    setZipping(`0/${list.length}`);
    try {
      const gen = await import('./lib/generate');
      const res = await gen.zipFor(campaign, list, n => setZipping(`${n}/${list.length}`), r => rows.findIndex(g => g.r.id === r.id) + 1);
      if (res.blob) saveBlob(res.blob, `${campaign.settings?.file_prefix || 'Invitation'}_Invitations.zip`);
      if (res.skipped.length) {
        toast({ title: `${res.skipped.length} guest${res.skipped.length === 1 ? '' : 's'} left out of the ZIP`, description: res.skipped.map(s => `${guestName(s.r)}: ${s.issues[0].message}`).join(' '), variant: 'destructive' });
      } else toast({ title: `ZIP ready: ${res.done} guest${res.done === 1 ? '' : 's'}` });
    } catch (e) {
      toast({ title: 'The ZIP could not be made', description: (e as Error).message, variant: 'destructive' });
    } finally { setZipping(null); }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap gap-1" role="group" aria-label="Show">
          {FILTERS.map(f => (
            <button key={f.key} type="button" aria-pressed={filter === f.key} onClick={() => setFilter(f.key)}
              className={`rounded-full border px-3 py-1 text-xs ${filter === f.key ? 'bg-[#0A2E5C] text-white border-[#0A2E5C]' : 'bg-white text-gray-700 hover:border-[#5E9CC4]'}`}>
              {f.label} ({counts[f.key]})
            </button>
          ))}
        </div>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="outline" onClick={() => setAdding(true)}><Plus className="h-4 w-4 mr-1" /> Add a guest</Button>
          <Button size="sm" onClick={() => setImporting(true)}><Upload className="h-4 w-4 mr-1" /> Import Excel or CSV</Button>
        </div>
      </div>

      {picked.size > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-md border bg-sky-50 px-3 py-2 text-sm">
          <span className="font-medium">{picked.size} selected</span>
          <Button size="sm" variant="outline" onClick={() => bulkStatus('ready')}>Mark ready</Button>
          <Button size="sm" variant="outline" onClick={() => bulkStatus('draft')}>Back to draft</Button>
          <Button size="sm" variant="outline" disabled={!!zipping} onClick={() => zip(pickedRows.map(g => g.r))}>
            {zipping ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Download className="h-4 w-4 mr-1" />}{zipping ? `PDFs ${zipping}` : 'PDFs (ZIP)'}
          </Button>
          <Button size="sm" variant="ghost" className="text-red-700" onClick={bulkRemove}><Trash2 className="h-4 w-4 mr-1" /> Remove</Button>
          <button type="button" className="ml-auto text-xs text-gray-500 underline" onClick={() => setPicked(new Set())}>Clear</button>
        </div>
      )}

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)] items-start">
        <div className="min-w-0 space-y-2">
          {!rows.length && (
            <div className="rounded-lg border bg-white p-8 text-center text-sm text-gray-600">
              No guest yet. Import your Excel list (sheet "Prêts pour invitation") or the kit CSV, or add guests one by one.
            </div>
          )}

          {/* Table, 640 px and wider */}
          {rows.length > 0 && (
            <div className="hidden sm:block rounded-lg border bg-white overflow-x-auto">
              <table className="w-full text-sm min-w-[540px] table-fixed">
                <thead className="bg-gray-50 text-left text-[10.5px] uppercase tracking-wider text-gray-500">
                  <tr>
                    <th className="p-2 w-10"><Checkbox aria-label="Select all shown" checked={allShownPicked}
                      onCheckedChange={v => setPicked(v === true ? new Set([...picked, ...shown.map(g => g.r.id)]) : new Set([...picked].filter(id => !shown.some(g => g.r.id === id))))} /></th>
                    <th className="p-2">Name on ticket and greeting</th>
                    <th className="p-2 w-[33%]">E-mail</th>
                    <th className="p-2 w-36">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {shown.map(g => {
                    const i = rows.indexOf(g);
                    const isOpen = open === g.r.id;
                    return [
                      <tr key={g.r.id} onFocusCapture={() => onSelect(g.r.id)} onClick={() => onSelect(g.r.id)}
                        className={`border-t align-top ${selectedId === g.r.id ? 'bg-sky-50' : ''}`}>
                        <td className="p-2 pt-3">
                          <Checkbox aria-label={`Select ${guestName(g.r)}`} checked={picked.has(g.r.id)} onCheckedChange={() => toggle(g.r.id)} />
                          <div className="mt-1 text-[11px] text-gray-400">{String(i + 1).padStart(2, '0')}</div>
                        </td>
                        <td className="p-1">
                          <EditText label={`Name on ticket, ${guestName(g.r)}`} value={g.r.name_on_ticket} required disabled={!editable(g)}
                            onSave={v => p.saveRecipient(g.r.id, { name_on_ticket: v })} className="font-medium" />
                          <div className="flex items-center">
                            <span className="pl-2 text-xs text-gray-400 shrink-0" aria-hidden>{(g.r.greeting || '').startsWith('Your ') ? '' : 'Dear'}</span>
                            <EditText label={`Greeting after Dear, ${guestName(g.r)}`} value={g.r.greeting} disabled={!editable(g)} placeholder={g.r.name_on_ticket}
                              onSave={v => p.saveRecipient(g.r.id, { greeting: v || null })} className="!h-7 !text-xs text-gray-700" />
                          </div>
                          <div className="px-2 text-xs text-gray-500 truncate">{[g.r.position, g.r.organisation].filter(Boolean).join(', ') || <span className="italic">No job title or organisation</span>}</div>
                        </td>
                        <td className="p-1">
                          <EmailCell g={g} save={p.saveRecipient} />
                        </td>
                        <td className="p-2 pt-2">
                          <div className="flex items-start justify-between gap-1">
                            <StatusChip status={g.status} />
                            <Button size="sm" variant="ghost" className="h-7 w-7 p-0 shrink-0" aria-expanded={isOpen} aria-label={`${isOpen ? 'Hide' : 'Show'} details of ${guestName(g.r)}`}
                              onClick={e => { e.stopPropagation(); setOpen(isOpen ? null : g.r.id); onSelect(g.r.id); }}>
                              {isOpen ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                            </Button>
                          </div>
                          <Flags g={g} />
                        </td>
                      </tr>,
                      isOpen && (
                        <tr key={`${g.r.id}-ed`} className="bg-gray-50/60">
                          <td colSpan={4} className="p-3"><RecipientEditor g={g} {...p} /></td>
                        </tr>
                      ),
                    ];
                  })}
                  {!shown.length && <tr><td colSpan={4} className="p-6 text-center text-gray-400">Nobody in this view.</td></tr>}
                </tbody>
              </table>
            </div>
          )}

          {/* Cards, under 640 px */}
          <ul className="sm:hidden space-y-2">
            {shown.map(g => (
              <li key={g.r.id} className={`rounded-lg border bg-white p-3 space-y-2 ${selectedId === g.r.id ? 'ring-2 ring-[#5E9CC4]' : ''}`}>
                <div className="flex items-start gap-2">
                  <Checkbox className="mt-1" aria-label={`Select ${guestName(g.r)}`} checked={picked.has(g.r.id)} onCheckedChange={() => toggle(g.r.id)} />
                  <div className="min-w-0 flex-1">
                    <div className="font-medium text-gray-900 break-words">{guestName(g.r)}</div>
                    <div className="text-xs text-gray-500 break-words">{[g.r.position, g.r.organisation].filter(Boolean).join(', ')}</div>
                    <div className="text-xs text-gray-600 mt-0.5">{(g.r.greeting || g.r.name_on_ticket).startsWith('Your ') ? g.r.greeting : `Dear ${g.r.greeting || g.r.name_on_ticket}`},</div>
                  </div>
                  <StatusChip status={g.status} />
                </div>
                <EmailCell g={g} save={p.saveRecipient} />
                <Flags g={g} />
                <div className="flex gap-2">
                  <Button size="sm" variant="outline" onClick={() => { onSelect(g.r.id); document.getElementById('inv-preview')?.scrollIntoView({ behavior: 'smooth' }); }}>
                    <Eye className="h-4 w-4 mr-1" /> Preview
                  </Button>
                  <Button size="sm" variant="outline" aria-expanded={open === g.r.id} onClick={() => { setOpen(open === g.r.id ? null : g.r.id); onSelect(g.r.id); }}>
                    {open === g.r.id ? 'Close' : 'Edit'}
                  </Button>
                </div>
                {open === g.r.id && <RecipientEditor g={g} {...p} />}
              </li>
            ))}
          </ul>

          {rows.length > 0 && (
            <div className="flex flex-wrap items-center gap-2 pt-1">
              <Button size="sm" variant="outline" disabled={!!zipping} onClick={() => zip(rows.map(g => g.r))}>
                {zipping ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Download className="h-4 w-4 mr-1" />}
                {zipping ? `Preparing PDFs ${zipping}` : `Download every PDF (ZIP, ${rows.length})`}
              </Button>
              <span className="text-xs text-gray-500">One folder per guest: 01_First_Last/, with the ticket and the letter.</span>
            </div>
          )}
        </div>

        <div id="inv-preview" className="min-w-0 xl:sticky xl:top-4">
          <PreviewPanel campaign={campaign} recipient={selected?.r || null} onStyle={p.setStyle} />
        </div>
      </div>

      <ImportDialog open={importing} onClose={() => setImporting(false)} campaign={campaign} recipients={rows.map(g => g.r)} guests={p.guests} onImported={p.reload} />
      <AddGuestDialog open={adding} onClose={() => setAdding(false)} campaign={campaign} rows={rows} onAdded={async id => { await p.reload(); onSelect(id); }} />
    </div>
  );
}

/* ─── Small pieces ─── */

function Flags({ g }: { g: GuestRow }) {
  const items: ReactNode[] = [];
  if (g.r.needs_check) items.push(<span key="c" className="inline-flex items-center gap-1 text-amber-800"><AlertTriangle className="h-3 w-3" />To check</span>);
  if (g.dups.length) items.push(<span key="d" className="inline-flex items-center gap-1 text-red-700"><AlertTriangle className="h-3 w-3" />Possible duplicate</span>);
  if (g.request) items.push(<span key="q" className="inline-flex items-center gap-1 text-purple-800"><AlertTriangle className="h-3 w-3" />Requested on /wys26{g.adopt ? ': adopt' : ''}</span>);
  if (g.r.profile_user_id) items.push(<span key="p" className="inline-flex items-center gap-1 text-green-800"><UserCheck className="h-3 w-3" />Has an account</span>);
  if (!items.length) return null;
  return <div className="mt-1 flex flex-col gap-0.5 text-[11px]">{items}</div>;
}

export function EditText({ value, onSave, label, disabled, placeholder, className = '', required = false, multiline = false, validate }: {
  value: string | null | undefined; onSave: (v: string) => Promise<boolean>; label: string; disabled?: boolean; placeholder?: string | null;
  className?: string; required?: boolean; multiline?: boolean; validate?: (v: string) => string | null;
}) {
  const [v, setV] = useState(value ?? '');
  const [err, setErr] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  useEffect(() => { setV(value ?? ''); setErr(null); }, [value]);
  const commit = async () => {
    const t = v.replace(/[ \t]+/g, ' ').trim();
    if (t === (value ?? '').trim()) { setErr(null); return; }
    if (required && !t) { setErr('Required'); return; }
    const e = validate?.(t) ?? null;
    if (e) { setErr(e); return; }
    setErr(null); setSaving(true);
    const ok = await onSave(t);
    setSaving(false);
    if (!ok) setV(value ?? '');
  };
  const common = {
    'aria-label': label, 'aria-invalid': !!err, disabled, value: v, placeholder: placeholder ?? undefined,
    onChange: (e: { target: { value: string } }) => setV(e.target.value), onBlur: commit,
  };
  return (
    <div className="min-w-0">
      {multiline
        ? <Textarea rows={2} {...common} className={`text-sm ${className}`} />
        : <Input {...common} onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); if (e.key === 'Escape') { setV(value ?? ''); setErr(null); } }}
          className={`h-9 border-transparent bg-transparent hover:border-gray-200 focus:bg-white px-2 text-sm ${err ? 'border-red-400' : ''} ${saving ? 'opacity-60' : ''} ${className}`} />}
      {err && <div className="px-2 text-xs text-red-700">{err}</div>}
    </div>
  );
}

const emailError = (v: string) => (v && !isEmail(v) ? 'Not a valid e-mail address' : null);

function EmailCell({ g, save }: { g: GuestRow; save: GuestsTabProps['saveRecipient'] }) {
  const locked = !!g.r.gl_guest_id;
  return (
    <div>
      <EditText label={`E-mail, ${guestName(g.r)}`} value={g.r.email} disabled={locked} placeholder="Type the e-mail address"
        validate={emailError} onSave={v => save(g.r.id, { email: v ? v.toLowerCase() : null })} />
      {locked && <div className="px-2 text-[11px] text-gray-400">On the guest list: e-mail fixed</div>}
    </div>
  );
}

function Field({ label, children, wide = false }: { label: string; children: ReactNode; wide?: boolean }) {
  return (
    <label className={`block min-w-0 ${wide ? 'sm:col-span-2' : ''}`}>
      <span className="block text-[11px] uppercase tracking-wider text-gray-500 mb-0.5">{label}</span>
      {children}
    </label>
  );
}

function RecipientEditor({ g, campaign, saveRecipient, removeRecipients, patchSettings }: { g: GuestRow } & GuestsTabProps) {
  const { isAdmin } = useAuth();
  const r = g.r;
  const can = editable(g);
  const save = (patch: InvitationRecipientUpdate) => saveRecipient(r.id, patch);
  const box = 'border-gray-200 bg-white';

  const propose = async () => {
    const suffix = splitSuffix(r.name_on_letter || '').suffix;
    const pr = proposeNames({ honorific: r.honorific, first: r.first_name, last: r.last_name, suffix });
    if (!pr.name_on_ticket) { toast({ title: 'Fill the first name and surname first', variant: 'destructive' }); return; }
    await save({ name_on_ticket: pr.name_on_ticket, name_on_letter: pr.name_on_letter, greeting: pr.greeting });
    toast({ title: 'Names proposed', description: `${pr.name_on_ticket} · ${pr.greeting.startsWith('Your ') ? pr.greeting : `Dear ${pr.greeting}`}` });
  };
  const translate = async () => {
    const t = translatePosition(r.position);
    if (t.translated) await save({ position: t.text });
    else toast({ title: 'This job title is not in the translation list', description: 'Type the English title by hand.' });
  };
  const dismiss = async (otherId: string) => {
    const list = new Set(campaign.settings?.dismissed_duplicates || []);
    // Both directions: the other campaign guest stops pointing at this one too.
    list.add(`${r.id}:${otherId}`); list.add(`${otherId}:${r.id}`);
    await patchSettings({ dismissed_duplicates: [...list] });
  };
  const setAdopt = async (on: boolean) => {
    const list = new Set(campaign.settings?.adopt || []);
    if (on) list.add(r.id); else list.delete(r.id);
    await patchSettings({ adopt: [...list] });
  };
  const remove = async (why: string) => {
    if (!confirm(`${why}\n\nRemove ${guestName(r)} from this campaign?`)) return;
    await removeRecipients([r.id]);
  };
  const posFrench = translatePosition(r.position).french;

  return (
    <div className="space-y-3 text-sm">
      {g.request && (
        <div className="rounded-md border border-purple-200 bg-purple-50 p-3 space-y-2">
          <p className="text-purple-900"><b>{g.request.first_name} {g.request.last_name}</b> asked for an invitation on the public /wys26 page ({new Date(g.request.created_at).toLocaleDateString('en-GB')}). Their request is still pending in WYS 2026.</p>
          <p className="text-xs text-purple-900">Adopt it: this campaign sends its invitation on that same guest-list row, with the same personal link and QR. Or leave it to WYS 2026, where it is approved or refused as usual.</p>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant={g.adopt ? 'default' : 'outline'} onClick={() => setAdopt(!g.adopt)}>
              {g.adopt ? <><CheckCircle2 className="h-4 w-4 mr-1" /> Adopted into this campaign</> : 'Adopt the request into this campaign'}
            </Button>
            {can && !r.gl_guest_id && <Button size="sm" variant="outline" onClick={() => remove('The request stays in WYS 2026, untouched.')}>Leave it to WYS 2026</Button>}
          </div>
        </div>
      )}

      {g.dups.length > 0 && (
        <div className="rounded-md border border-red-200 bg-red-50 p-3 space-y-2">
          <p className="font-medium text-red-900">Possible duplicate: one person receives one invitation only.</p>
          <ul className="space-y-1">
            {g.dups.map(d => (
              <li key={`${d.other_kind}-${d.other_id}`} className="flex flex-wrap items-center gap-2 text-red-900">
                <span>{d.match_on === 'email' ? 'Same e-mail' : d.match_on === 'name_org' ? 'Same name and organisation' : 'Same name'} as <b>{d.other_label}</b>{' '}
                  {d.other_kind === 'guest' ? 'on the event guest list' : d.other_campaign_id === campaign.id ? 'in this campaign' : 'in another campaign of this event'} ({d.other_status})</span>
                {d.match_on !== 'email' && <Button size="sm" variant="outline" className="h-7" onClick={() => dismiss(d.other_id)}>Not the same person</Button>}
              </li>
            ))}
          </ul>
          {can && !r.gl_guest_id && <Button size="sm" variant="outline" className="text-red-800" onClick={() => remove('This guest is already invited elsewhere.')}><Trash2 className="h-4 w-4 mr-1" /> Remove this guest</Button>}
        </div>
      )}

      {r.needs_check && (
        <div className="rounded-md border border-amber-200 bg-amber-50 p-3 space-y-2">
          <ul className="list-disc pl-5 text-amber-900 space-y-0.5">
            {(g.reasons.length ? g.reasons.map(x => CHECK_LABEL[x]) : ['Flagged when imported']).map(t => <li key={t}>{t}</li>)}
          </ul>
          <Button size="sm" variant="outline" onClick={() => save({ needs_check: false })}><CheckCircle2 className="h-4 w-4 mr-1" /> Checked</Button>
        </div>
      )}

      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
        <Field label="Title"><EditText label="Title" value={r.honorific} disabled={!can} placeholder="Mr, Ms, Dr, Eng., H.E." onSave={v => save({ honorific: v || null })} className={box} /></Field>
        <Field label="First name"><EditText label="First name" value={r.first_name} disabled={!can} onSave={v => save({ first_name: v || null })} className={box} /></Field>
        <Field label="Surname"><EditText label="Surname" value={r.last_name} disabled={!can} onSave={v => save({ last_name: v || null })} className={box} /></Field>
        <Field label="Name on ticket"><EditText label="Name on ticket" value={r.name_on_ticket} required disabled={!can} onSave={v => save({ name_on_ticket: v })} className={box} /></Field>
        <Field label="Name on letter"><EditText label="Name on letter" value={r.name_on_letter} disabled={!can} placeholder={r.name_on_ticket} onSave={v => save({ name_on_letter: v || null })} className={box} /></Field>
        <Field label='Greeting (after "Dear")'><EditText label="Greeting" value={r.greeting} disabled={!can} placeholder={r.name_on_ticket} onSave={v => save({ greeting: v || null })} className={box} /></Field>
        <Field label="Job title">
          <EditText label="Job title" value={r.position} disabled={!can} onSave={v => save({ position: v || null })} className={box} />
          {posFrench && can && <button type="button" className="text-xs text-[#0A2E5C] underline mt-0.5" onClick={translate}>Translate into English</button>}
        </Field>
        <Field label="Organisation"><EditText label="Organisation" value={r.organisation} disabled={!can} onSave={v => save({ organisation: v || null })} className={box} /></Field>
        <Field label="Country"><EditText label="Country" value={r.country} disabled={!can} onSave={v => save({ country: v || null })} className={box} /></Field>
        <Field label="Phone"><EditText label="Phone" value={r.phone} disabled={!can} onSave={v => save({ phone: v || null })} className={box} /></Field>
        <Field label="Notes" wide><EditText label="Notes" value={r.notes} multiline onSave={v => save({ notes: v || null })} className={box} /></Field>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {can && <Button size="sm" variant="outline" onClick={propose}><Wand2 className="h-4 w-4 mr-1" /> Propose names from title, first name, surname</Button>}
        {can && (r.status === 'draft'
          ? <Button size="sm" variant="outline" onClick={() => save({ status: 'ready' })}>Mark ready</Button>
          : <Button size="sm" variant="outline" onClick={() => save({ status: 'draft' })}>Back to draft</Button>)}
        {r.profile_user_id && (isAdmin
          ? <Link className="text-xs text-green-800 underline" to={`/admin/users/${r.profile_user_id}`}>Has a platform account</Link>
          : <span className="text-xs text-green-800">Has a platform account</span>)}
        {can && !r.gl_guest_id && <Button size="sm" variant="ghost" className="ml-auto text-red-700" onClick={() => remove('Their ticket and letter are not kept.')}><Trash2 className="h-4 w-4 mr-1" /> Remove</Button>}
      </div>
    </div>
  );
}

/* ─── Adding one guest by hand ─── */

function AddGuestDialog({ open, onClose, campaign, rows, onAdded }: {
  open: boolean; onClose: () => void; campaign: InvitationCampaign; rows: GuestRow[]; onAdded: (id: string) => void | Promise<void>;
}) {
  const [f, setF] = useState({ contact: '', position: '', organisation: '', country: '', email: '' });
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (open) setF({ contact: '', position: '', organisation: '', country: '', email: '' }); }, [open]);
  const parsed = f.contact.trim() ? parseContact(f.contact) : null;
  const pr = parsed ? proposeNames({ honorific: parsed.honorific, first: parsed.first, last: parsed.last, suffix: parsed.suffix }) : null;
  const pos = translatePosition(f.position);
  const emailBad = !!f.email.trim() && !isEmail(f.email.trim());
  const sameEmail = f.email.trim() && rows.some(g => (g.r.email || '') === f.email.trim().toLowerCase());

  const add = async () => {
    if (!parsed || !pr) return;
    setBusy(true);
    try {
      const [row] = await insertRecipients([{
        campaign_id: campaign.id, sort_order: Math.max(0, ...rows.map(g => g.r.sort_order || 0)) + 1,
        honorific: parsed.honorific || null, first_name: parsed.first || null, last_name: parsed.last || null,
        name_on_ticket: pr.name_on_ticket, name_on_letter: pr.name_on_letter, greeting: pr.greeting,
        position: pos.text || null, organisation: f.organisation.trim() || null, country: f.country.trim() || null,
        email: f.email.trim() ? f.email.trim().toLowerCase() : null,
        needs_check: parsed.reasons.some(x => x !== 'suffix') || pos.translated || pos.french, status: 'draft',
      }]);
      toast({ title: `${pr.name_on_ticket} added` });
      onClose();
      if (row) await onAdded(row.id);
    } catch (e) {
      const err = e as Error & { code?: string };
      toast({ title: 'Not added', description: err.code === '23505' ? 'This e-mail is already used by a guest of this campaign.' : err.message, variant: 'destructive' });
    } finally { setBusy(false); }
  };

  return (
    <Dialog open={open} onOpenChange={o => { if (!o) onClose(); }}>
      <DialogContent className="w-[calc(100vw-1rem)] max-w-lg">
        <DialogHeader><DialogTitle>Add a guest</DialogTitle></DialogHeader>
        <div className="space-y-3 text-sm">
          <Field label="Full name with title"><Input value={f.contact} placeholder="H.E. Dr Jane Doe" onChange={e => setF({ ...f, contact: e.target.value })} /></Field>
          {pr && (
            <div className="rounded-md bg-gray-50 border p-2 text-xs space-y-0.5">
              <div>Ticket: <b>{pr.name_on_ticket}</b></div>
              {pr.name_on_letter !== pr.name_on_ticket && <div>Letter: <b>{pr.name_on_letter}</b></div>}
              <div>Greeting: <b>{pr.greeting.startsWith('Your ') ? pr.greeting : `Dear ${pr.greeting}`},</b></div>
              {parsed && parsed.reasons.filter(x => x !== 'suffix').map(x => <div key={x} className="text-amber-800">{CHECK_LABEL[x]}</div>)}
              <div className="text-gray-500">Everything stays editable in the table.</div>
            </div>
          )}
          <Field label="Job title"><Input value={f.position} onChange={e => setF({ ...f, position: e.target.value })} /></Field>
          {pos.translated && <p className="text-xs text-amber-800">Will be saved as "{pos.text}"</p>}
          <div className="grid grid-cols-2 gap-3">
            <Field label="Organisation"><Input value={f.organisation} onChange={e => setF({ ...f, organisation: e.target.value })} /></Field>
            <Field label="Country"><Input value={f.country} onChange={e => setF({ ...f, country: e.target.value })} /></Field>
          </div>
          <Field label="E-mail"><Input type="email" value={f.email} aria-invalid={emailBad} onChange={e => setF({ ...f, email: e.target.value })} /></Field>
          {emailBad && <p className="text-xs text-red-700">Not a valid e-mail address.</p>}
          {sameEmail && <p className="text-xs text-red-700">A guest of this campaign already has this e-mail.</p>}
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={onClose}>Cancel</Button>
            <Button disabled={busy || !pr?.name_on_ticket || emailBad || !!sameEmail} onClick={add}>{busy && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}Add</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
