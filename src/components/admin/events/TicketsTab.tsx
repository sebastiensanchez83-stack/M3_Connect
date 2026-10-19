import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ArrowDown, ArrowUp, EyeOff, Pencil, Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { EditDialog } from '@/components/home/dashboard/EditKit';
import { cn } from '@/lib/utils';
import { AdminStatusPill } from '../AdminUI';
import { Block, EDITOR_BTN, Field, INPUT, Note, TEXTAREA, ToggleRow } from './editorUi';
import { COMPANY_TYPES, companyTypeWord, questionKey, type EventPart } from './eventAdmin';
import { priceCents, type FormIssue, type TicketDraft, type TicketsForm } from './editorModel';

interface Preset { key: string; make: () => TicketDraft }

const blank = (key: string): TicketDraft => ({
  key, label: '', description: '', price: '', priceNote: '', inviteOnly: false, capacity: '', allowedTypes: [], parts: [], active: true,
});

/** The price as the form shows it: the note first, else the amount (display only). */
function priceWord(x: TicketDraft): string {
  if (x.priceNote.trim()) return x.priceNote.trim();
  const c = priceCents(x.price);
  if (c === null || Number.isNaN(c)) return '';
  if (c === 0) return 'Free';
  return new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'EUR', maximumFractionDigits: c % 100 ? 2 : 0 }).format(c / 100);
}

/**
 * Participation types (gl_ticket) of an on-site event, and its parts (conference, gala
 * dinner). With one type or none, people are not asked to choose. Each type keeps its
 * internal key for life (registrations store it); a type someone registered with is
 * switched off when removed, never deleted (admin_save_event does the same).
 * Prices and notes are display only until December.
 */
export function TicketsTab({
  value,
  onChange,
  issues,
  usage,
  savedKeys,
  invitesReady = false,
}: {
  value: TicketsForm;
  onChange: (next: TicketsForm) => void;
  issues: FormIssue[];
  /** Registrations per type key (loaded when people have registered). */
  usage: Record<string, number> | null;
  /** Keys of the types as saved: a new type never takes one of them. */
  savedKeys: string[];
  /** The registration function sends invitations: an invite-only type can be given. */
  invitesReady?: boolean;
}) {
  const { t } = useTranslation();
  const list = value.list;
  const parts = value.parts;
  const setList = (next: TicketDraft[]) => onChange({ ...value, list: next });
  const [editing, setEditing] = useState<{ index: number | null; draft: TicketDraft } | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [dialogError, setDialogError] = useState<string | null>(null);
  const err = (field: string) => issues.find((i) => i.tab === 'tickets' && i.field === field)?.message;
  const used = (key: string) => (usage?.[key] ?? 0) > 0;
  const taken = () => [...list.map((x) => x.key), ...savedKeys, ...Object.keys(usage || {})];

  const presets: Preset[] = [
    { key: 'attendee', make: () => ({ ...blank('attendee'), label: t('adminEvents.tk.attendee', 'Attendee'), description: t('adminEvents.tk.attendeeBody', 'Full access to the event.') }) },
    { key: 'visitor', make: () => ({ ...blank('visitor'), label: t('adminEvents.tk.visitor', 'Visitor'), description: t('adminEvents.tk.visitorBody', 'Visits the exhibition and the talks open to visitors.') }) },
    { key: 'exhibitor', make: () => ({ ...blank('exhibitor'), label: t('adminEvents.tk.exhibitor', 'Exhibitor'), description: t('adminEvents.tk.exhibitorBody', 'Your company has a stand at the event.'), priceNote: t('adminEvents.tk.onAgreement', 'On agreement') }) },
    { key: 'startup', make: () => ({ ...blank('startup'), label: t('adminEvents.tk.startup', 'Startup'), description: t('adminEvents.tk.startupBody', 'An early-stage company presenting its innovation.') }) },
    { key: 'press', make: () => ({ ...blank('press'), label: t('adminEvents.tk.press', 'Press'), description: t('adminEvents.tk.pressBody', 'Accreditation for journalists of validated media companies.'), allowedTypes: ['media_partner'] }) },
    { key: 'speaker', make: () => ({ ...blank('speaker'), label: t('adminEvents.tk.speaker', 'Speaker'), inviteOnly: true, priceNote: t('adminEvents.tk.byInvitation', 'By invitation') }) },
    { key: 'vip', make: () => ({ ...blank('vip'), label: t('adminEvents.tk.vip', 'VIP'), inviteOnly: true, priceNote: t('adminEvents.tk.byInvitation', 'By invitation') }) },
    { key: 'sponsor', make: () => ({ ...blank('sponsor'), label: t('adminEvents.tk.sponsor', 'Sponsor'), description: t('adminEvents.tk.sponsorBody', 'For the companies sponsoring the event.'), inviteOnly: true, priceNote: t('adminEvents.tk.onAgreement', 'On agreement') }) },
  ];
  // A preset keeps its fixed key: one removed and added again before saving is the same type again (upsert by key).
  const freePresets = presets.filter((p) => !list.some((x) => x.key === p.key));

  const addPreset = (p: Preset) => {
    const row = p.make();
    // Every type includes every part by default (one click in each type to change it).
    row.parts = parts.map((pt) => pt.key);
    setList([...list, row]);
  };

  const move = (i: number, d: -1 | 1) => {
    const j = i + d;
    if (j < 0 || j >= list.length) return;
    const next = [...list];
    [next[i], next[j]] = [next[j], next[i]];
    setList(next);
  };

  const openNew = () => {
    setDialogError(null);
    setEditing({ index: null, draft: { ...blank(''), parts: parts.map((p) => p.key) } });
    setDialogOpen(true);
  };
  const openEdit = (index: number) => {
    setDialogError(null);
    setEditing({ index, draft: { ...list[index] } });
    setDialogOpen(true);
  };
  const saveDialog = () => {
    if (!editing) return;
    const d = editing.draft;
    if (!d.label.trim()) { setDialogError(t('adminEvents.tk.needLabel', 'Give the type a name.')); return; }
    if (d.capacity.trim() && (!/^\d+$/.test(d.capacity.trim()) || Number(d.capacity) < 1)) {
      setDialogError(t('adminEvents.tk.needCapacity', 'Write a whole number of places, or leave it empty.'));
      return;
    }
    if (d.price.trim() && Number.isNaN(priceCents(d.price) as number)) {
      setDialogError(t('adminEvents.tk.needPrice', 'Write the price as a number of euros, like 450 or 450.50.'));
      return;
    }
    const row: TicketDraft = {
      ...d,
      label: d.label.trim().slice(0, 120),
      description: d.description.trim().slice(0, 500),
      priceNote: d.priceNote.trim().slice(0, 80),
      allowedTypes: [...d.allowedTypes].sort(),
    };
    if (editing.index === null) {
      row.key = questionKey(row.label, taken(), 'type');
      setList([...list, row]);
    } else {
      setList(list.map((x, i) => (i === editing.index ? row : x)));
    }
    setDialogOpen(false);
  };

  /* -------------------------------------------------------------- parts */
  const setParts = (next: EventPart[]) => {
    // A part removed is also taken out of every type.
    const keys = new Set(next.map((p) => p.key));
    onChange({ parts: next, list: list.map((x) => ({ ...x, parts: x.parts.filter((k) => keys.has(k)) })) });
  };
  const addPart = (label = '', when = '') => {
    const key = questionKey(label || 'part', [...parts.map((p) => p.key)], 'part');
    const next = [...parts, { key, label, when }];
    onChange({ parts: next, list: list.map((x) => ({ ...x, parts: [...x.parts, key] })) });
  };
  const addGalaPreset = () => {
    const extra: EventPart[] = [];
    if (!parts.some((p) => p.key === 'conference')) extra.push({ key: 'conference', label: t('adminEvents.tk.partConference', 'Conference'), when: t('adminEvents.tk.partDaytime', 'Daytime') });
    if (!parts.some((p) => p.key === 'gala')) extra.push({ key: 'gala', label: t('adminEvents.tk.partGala', 'Gala dinner'), when: t('adminEvents.tk.partEvening', 'Evening') });
    if (!extra.length) return;
    onChange({ parts: [...parts, ...extra], list: list.map((x) => ({ ...x, parts: [...x.parts, ...extra.map((p) => p.key)] })) });
  };

  return (
    <div className="space-y-6">
      <Block
        title={t('adminEvents.tk.title', 'Participation types')}
        description={t('adminEvents.tk.body', 'How people take part: attendee, exhibitor, press… With one type or none, nobody is asked to choose. Prices and notes are shown on the form only: nothing is paid on the platform before December.')}
      >
        {err('list') && <Note tone="danger"><span role="alert">{err('list')}</span></Note>}
        {/* What the form will do with these types (saving is never blocked for it). */}
        {list.length > 0 && !list.some((x) => x.active) && (
          <Note tone="warning">{t('adminEvents.tk.allOff', 'Every type is switched off: people register without choosing a type.')}</Note>
        )}
        {list.some((x) => x.active) && list.filter((x) => x.active).every((x) => x.inviteOnly) && (
          <Note tone="warning">
            {invitesReady
              ? t('adminEvents.tk.allInviteOnly', 'Every type switched on is by invitation only: nobody can register on their own, only the people you invite.')
              : t('adminEvents.tk.allInviteOnlyLater', 'Every type switched on is by invitation only, and sending invitations comes in a later update: for now nobody could register. Switch on a type open to everyone.')}
          </Note>
        )}
        {!invitesReady && list.some((x) => x.active && x.inviteOnly) && list.some((x) => x.active && !x.inviteOnly) && (
          <Note>{t('adminEvents.tk.inviteOnlyLater', 'Types by invitation only are shown on the form, but nobody can have them until sending invitations arrives, in a later update.')}</Note>
        )}
        {list.length === 0 ? (
          <p className="text-[14px] text-meta">{t('adminEvents.tk.none', 'No participation type: everyone registers the same way.')}</p>
        ) : (
          <ol className="space-y-3">
            {list.map((x, i) => {
              const price = priceWord(x);
              const e = err(`t${i}`);
              return (
                <li key={x.key || i} className={cn('rounded-card border bg-white p-4', e ? 'border-red-300' : 'border-rule', !x.active && 'bg-page')}>
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div className="min-w-0">
                      <p className={cn('text-[15px] font-semibold leading-5 [overflow-wrap:anywhere]', x.active ? 'text-navy' : 'text-meta')}>
                        <span className="mr-1.5 tabular-nums text-meta">{i + 1}.</span>{x.label || t('adminEvents.tk.untitled', 'Untitled type')}
                      </p>
                      {x.description && <p className="mt-1 text-[13px] leading-[18px] text-meta [overflow-wrap:anywhere]">{x.description}</p>}
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {!x.active && <AdminStatusPill icon={EyeOff}>{t('adminEvents.tk.off', 'Switched off')}</AdminStatusPill>}
                        {price && <AdminStatusPill tone="navy">{price}</AdminStatusPill>}
                        {x.capacity && <AdminStatusPill>{t('adminEvents.tk.places', '{{n}} places', { n: x.capacity })}</AdminStatusPill>}
                        {x.inviteOnly && <AdminStatusPill tone="warning">{t('adminEvents.tk.inviteOnly', 'By invitation only')}</AdminStatusPill>}
                        {x.allowedTypes.length > 0 && (
                          <AdminStatusPill tone="info">
                            {t('adminEvents.tk.keptFor', 'For: {{list}}', { list: x.allowedTypes.map((ty) => companyTypeWord(ty, t)).join(', ') })}
                          </AdminStatusPill>
                        )}
                        {parts.length > 0 && (
                          <AdminStatusPill>
                            {x.parts.length
                              ? parts.filter((p) => x.parts.includes(p.key)).map((p) => p.label || p.key).join(' + ')
                              : t('adminEvents.tk.noPart', 'No part')}
                          </AdminStatusPill>
                        )}
                        {used(x.key) && (
                          <AdminStatusPill>{t('adminEvents.tk.used', '{{n}} registered', { n: usage?.[x.key] ?? 0 })}</AdminStatusPill>
                        )}
                      </div>
                      {e && <p role="alert" className="mt-2 text-[13px] font-medium text-red-700">{e}</p>}
                    </div>
                    <div className="flex shrink-0 flex-wrap items-center gap-1.5">
                      <IconBtn label={t('adminEvents.q.up', 'Move up')} onClick={() => move(i, -1)} disabled={i === 0}><ArrowUp className="h-4 w-4" /></IconBtn>
                      <IconBtn label={t('adminEvents.q.down', 'Move down')} onClick={() => move(i, 1)} disabled={i === list.length - 1}><ArrowDown className="h-4 w-4" /></IconBtn>
                      <IconBtn label={t('adminEvents.q.edit', 'Change')} onClick={() => openEdit(i)}><Pencil className="h-4 w-4" /></IconBtn>
                      {used(x.key) ? (
                        <IconBtn
                          label={x.active ? t('adminEvents.tk.switchOff', 'Switch off (people registered with it)') : t('adminEvents.tk.switchOn', 'Switch on again')}
                          onClick={() => setList(list.map((y, j) => (j === i ? { ...y, active: !y.active } : y)))}
                        >
                          <EyeOff className="h-4 w-4" />
                        </IconBtn>
                      ) : (
                        <IconBtn label={t('adminEvents.remove', 'Remove')} onClick={() => setList(list.filter((_, j) => j !== i))} danger><Trash2 className="h-4 w-4" /></IconBtn>
                      )}
                    </div>
                  </div>
                </li>
              );
            })}
          </ol>
        )}
        <Button type="button" variant="outline" size="sm" className={EDITOR_BTN} onClick={openNew}>
          <Plus className="mr-1.5 h-4 w-4" aria-hidden="true" /> {t('adminEvents.tk.add', 'Add a type')}
        </Button>
      </Block>

      {freePresets.length > 0 && (
        <Block
          title={t('adminEvents.tk.presetsTitle', 'Ready-made types')}
          description={t('adminEvents.tk.presetsBody', 'Add one in a click, then change its name, price or places.')}
        >
          <div className="flex flex-wrap gap-2">
            {freePresets.map((p) => {
              const sample = p.make();
              return (
                <button
                  key={p.key}
                  type="button"
                  onClick={() => addPreset(p)}
                  className="inline-flex min-h-11 items-center gap-1.5 rounded-pill border border-rule bg-white px-3 py-2 text-left text-[14px] font-medium text-navy transition-colors hover:border-navy/40 hover:bg-chip focus:outline-none focus-visible:shadow-focus"
                >
                  <Plus className="h-4 w-4 shrink-0 text-teal" aria-hidden="true" />
                  {sample.label}
                  {sample.allowedTypes.includes('media_partner') && <span className="text-meta">· {t('adminEvents.tk.mediaOnly', 'Media only')}</span>}
                  {sample.inviteOnly && <span className="text-meta">· {t('adminEvents.tk.invitationWord', 'invitation')}</span>}
                </button>
              );
            })}
          </div>
        </Block>
      )}

      <Block
        title={t('adminEvents.tk.partsTitle', 'Programme parts')}
        description={t('adminEvents.tk.partsBody', 'For an event in several parts (a conference, then a gala dinner): say which parts each type includes. Add the question "Which parts will you attend?" in Questions to let people choose.')}
      >
        {parts.length === 0 ? (
          <p className="text-[14px] text-meta">{t('adminEvents.tk.noParts', 'One single part.')}</p>
        ) : (
          <ul className="space-y-3">
            {parts.map((p, i) => (
              <li key={p.key} className={cn('rounded-card border p-3', err(`p${i}`) ? 'border-red-300' : 'border-rule')}>
                <div className="flex flex-col gap-2 sm:flex-row sm:items-start">
                  <div className="grid min-w-0 flex-1 gap-2 sm:grid-cols-2">
                    <Input
                      value={p.label}
                      onChange={(e) => setParts(parts.map((x, j) => (j === i ? { ...x, label: e.target.value.slice(0, 80) } : x)))}
                      placeholder={t('adminEvents.tk.partName', 'Name, e.g. Gala dinner')}
                      aria-label={t('adminEvents.tk.partNameLabel', 'Name of the part')}
                      className={INPUT}
                    />
                    <Input
                      value={p.when}
                      onChange={(e) => setParts(parts.map((x, j) => (j === i ? { ...x, when: e.target.value.slice(0, 80) } : x)))}
                      placeholder={t('adminEvents.tk.partWhen', 'When, e.g. Evening')}
                      aria-label={t('adminEvents.tk.partWhenLabel', 'When it takes place')}
                      className={INPUT}
                    />
                  </div>
                  <Button type="button" variant="outline" size="sm" className={cn(EDITOR_BTN, 'self-end sm:self-auto')} onClick={() => setParts(parts.filter((_, j) => j !== i))}>
                    <Trash2 className="mr-1 h-4 w-4" aria-hidden="true" /> {t('adminEvents.remove', 'Remove')}
                  </Button>
                </div>
                {err(`p${i}`) && <p role="alert" className="mt-2 text-[13px] font-medium text-red-700">{err(`p${i}`)}</p>}
              </li>
            ))}
          </ul>
        )}
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="outline" size="sm" className={EDITOR_BTN} onClick={() => addPart()}>
            <Plus className="mr-1.5 h-4 w-4" aria-hidden="true" /> {t('adminEvents.tk.addPart', 'Add a part')}
          </Button>
          {!(parts.some((p) => p.key === 'conference') && parts.some((p) => p.key === 'gala')) && (
            <Button type="button" variant="outline" size="sm" className={EDITOR_BTN} onClick={addGalaPreset}>
              <Plus className="mr-1.5 h-4 w-4" aria-hidden="true" /> {t('adminEvents.tk.galaPreset', 'Conference + Gala dinner')}
            </Button>
          )}
        </div>
      </Block>

      <EditDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        title={editing?.index === null ? t('adminEvents.tk.newTitle', 'New participation type') : t('adminEvents.tk.editTitle', 'Change the participation type')}
        onSave={saveDialog}
        saveLabel={t('adminEvents.tk.keep', 'Keep this type')}
        error={dialogError}
        wide
      >
        {editing && (
          <TicketFields
            draft={editing.draft}
            parts={parts}
            used={editing.index !== null && used(list[editing.index]?.key)}
            invitesReady={invitesReady}
            onDraft={(draft) => setEditing({ ...editing, draft })}
          />
        )}
      </EditDialog>
    </div>
  );
}

function IconBtn({ label, onClick, disabled, danger, children }: { label: string; onClick: () => void; disabled?: boolean; danger?: boolean; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      className={cn(
        'grid h-11 w-11 place-items-center rounded-pill border bg-white transition-colors focus:outline-none focus-visible:shadow-focus disabled:opacity-35',
        danger ? 'border-red-200 text-red-700 hover:bg-red-50' : 'border-rule text-navy hover:bg-chip',
      )}
    >
      {children}
    </button>
  );
}

function Chip({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onClick}
      className={cn(
        'min-h-11 rounded-pill border px-3.5 py-2 text-[13px] font-medium transition-colors focus:outline-none focus-visible:shadow-focus',
        on ? 'border-navy bg-navy text-white' : 'border-rule bg-white text-navy hover:border-navy/40',
      )}
    >
      {children}
    </button>
  );
}

function TicketFields({ draft, parts, used, invitesReady, onDraft }: { draft: TicketDraft; parts: EventPart[]; used: boolean; invitesReady: boolean; onDraft: (d: TicketDraft) => void }) {
  const { t } = useTranslation();
  const set = <K extends keyof TicketDraft>(k: K, v: TicketDraft[K]) => onDraft({ ...draft, [k]: v });
  const toggle = (k: 'allowedTypes' | 'parts', v: string) => set(k, draft[k].includes(v) ? draft[k].filter((x) => x !== v) : [...draft[k], v]);
  return (
    <div className="space-y-4">
      <Field label={t('adminEvents.tk.name', 'Name')} htmlFor="tk-label">
        <Input id="tk-label" value={draft.label} onChange={(e) => set('label', e.target.value)} className={INPUT} maxLength={120} />
      </Field>
      <Field label={t('adminEvents.tk.description', 'Description')} htmlFor="tk-desc" optional>
        <Textarea id="tk-desc" rows={2} value={draft.description} onChange={(e) => set('description', e.target.value)} className={TEXTAREA} maxLength={500} />
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={t('adminEvents.tk.price', 'Price (euros)')} htmlFor="tk-price" optional hint={t('adminEvents.tk.priceHint', 'Shown only. 0 shows "Free".')}>
          <Input id="tk-price" inputMode="decimal" value={draft.price} onChange={(e) => set('price', e.target.value.replace(/[^\d.,\s]/g, '').slice(0, 12))} className={INPUT} placeholder="450" />
        </Field>
        <Field label={t('adminEvents.tk.note', 'Or a note instead of a price')} htmlFor="tk-note" optional hint={t('adminEvents.tk.noteHint', 'E.g. "On agreement", "By invitation".')}>
          <Input id="tk-note" value={draft.priceNote} onChange={(e) => set('priceNote', e.target.value)} className={INPUT} maxLength={80} />
        </Field>
      </div>
      <Field label={t('adminEvents.tk.capacity', 'Places for this type')} htmlFor="tk-cap" optional hint={t('adminEvents.tk.capacityHint', 'Empty: only the limit of the whole event applies.')}>
        <Input id="tk-cap" inputMode="numeric" value={draft.capacity} onChange={(e) => set('capacity', e.target.value.replace(/[^\d]/g, '').slice(0, 6))} className={`${INPUT} max-w-[12rem]`} />
      </Field>
      <ToggleRow
        checked={draft.inviteOnly}
        onChange={(on) => set('inviteOnly', on)}
        title={t('adminEvents.tk.inviteOnlyTitle', 'By invitation only')}
        body={invitesReady
          ? t('adminEvents.tk.inviteOnlyBody', 'Shown on the form but nobody can pick it: M3 gives it with an invitation.')
          : t('adminEvents.tk.inviteOnlyBodyLater', 'Shown on the form but nobody can pick it: M3 gives it with an invitation, once sending invitations arrives (a later update).')}
      />
      <Field
        label={t('adminEvents.tk.keptForTitle', 'Only for these company types')}
        hint={t('adminEvents.tk.keptForHint', 'Only signed-in members of a validated company of these types can pick it (Press: Media). None ticked: everyone.')}
      >
        <div className="flex flex-wrap gap-2">
          {COMPANY_TYPES.map((ty) => (
            <Chip key={ty} on={draft.allowedTypes.includes(ty)} onClick={() => toggle('allowedTypes', ty)}>{companyTypeWord(ty, t)}</Chip>
          ))}
        </div>
      </Field>
      {parts.length > 0 && (
        <Field label={t('adminEvents.tk.includes', 'Includes')}>
          <div className="flex flex-wrap gap-2">
            {parts.map((p) => (
              <Chip key={p.key} on={draft.parts.includes(p.key)} onClick={() => toggle('parts', p.key)}>{p.label || p.key}</Chip>
            ))}
          </div>
        </Field>
      )}
      <ToggleRow
        checked={draft.active}
        onChange={(on) => set('active', on)}
        title={t('adminEvents.tk.activeTitle', 'Offered on the form')}
        body={used
          ? t('adminEvents.tk.activeUsed', 'People registered with this type. Switched off, they keep it; nobody new can pick it.')
          : t('adminEvents.tk.activeBody', 'Off: kept here but not offered.')}
      />
    </div>
  );
}
