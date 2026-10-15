import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ArrowDown, ArrowUp, Eye, GripVertical, Pencil, Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { EditDialog } from '@/components/home/dashboard/EditKit';
import { cn } from '@/lib/utils';
import { AdminStatusPill } from '../AdminUI';
import { Block, EDITOR_BTN, Field, INPUT, Note, TEXTAREA, ToggleRow } from './editorUi';
import {
  STANDARD_FIELDS, profileFieldWord, questionKey, questionKindWord,
  type EventKind, type EventPart, type FieldRule, type ProfileField, type QuestionKind, type QuestionOption, type QuestionRow,
  type StandardField,
} from './eventAdmin';
import { partsOptions, priceCents, type FormIssue, type QuestionsForm, type TicketDraft } from './editorModel';

/**
 * Which profile field an answer of this kind may fill (contract: profile_field). Never
 * the phone: co-members of a company read each other's profiles, and a number given to
 * M3 for one event is not meant for them (the database ignores it too).
 */
const PROFILE_FOR_KIND: Partial<Record<QuestionKind, ProfileField[]>> = {
  text: ['job_title'],
  country: ['country'],
  url: ['linkedin_url'],
};

const blank = (key: string, order: number): QuestionRow => ({
  key, label: '', help: null, kind: 'text', options: null, max_length: null, required: false,
  ticket_keys: null, profile_field: null, editable_after_submit: true, display_order: order,
});

interface Preset { key: string; label: string; onsiteOnly?: boolean; make: () => Omit<QuestionRow, 'display_order'> }

/**
 * The choices of a list question after an edit. Answers are stored as the choice's
 * VALUE, so a value never changes once given:
 *   1. a line whose wording is unchanged keeps its value;
 *   2. an edited line (a typo fixed) keeps the value of the choice that stood at the same
 *      place, when that choice's wording is gone from the list;
 *   3. only a truly new line gets a new value (its wording, made unique).
 */
function mergeChoices(prev: QuestionOption[], labels: string[]): QuestionOption[] {
  const out: (QuestionOption | null)[] = labels.map(() => null);
  const used = new Set<string>();
  labels.forEach((label, i) => {
    const same = prev.find((o) => o.label === label && !used.has(o.value));
    if (same) { out[i] = { value: same.value, label }; used.add(same.value); }
  });
  labels.forEach((label, i) => {
    if (out[i]) return;
    const old = prev[i];
    if (old && !labels.includes(old.label) && !used.has(old.value)) { out[i] = { value: old.value, label }; used.add(old.value); }
  });
  const reserved = new Set([...used, ...prev.map((o) => o.value)]);
  labels.forEach((label, i) => {
    if (out[i]) return;
    let value = label.slice(0, 200);
    for (let n = 2; reserved.has(value); n++) value = `${label.slice(0, 190)} (${n})`;
    reserved.add(value);
    out[i] = { value, label };
  });
  return out as QuestionOption[];
}

/**
 * Questions: the event's own questions, after name, e-mail and the standard fields.
 * Ready-made ones in one click, or your own; the order here is the order on the form.
 * Each question keeps its internal key for life (answers are stored under it).
 * On-site events (on-site editor): ready-made questions as switches, a question can be
 * asked to some participation types only, drag to order, and a phone-sized preview.
 */
export function QuestionsTab({
  value,
  onChange,
  issues,
  kind,
  hasRegistrations,
  savedKeys = [],
  reservedKeys = [],
  fields,
  tickets = [],
  parts = [],
}: {
  value: QuestionsForm;
  onChange: (next: QuestionsForm) => void;
  issues: FormIssue[];
  kind: EventKind;
  hasRegistrations: boolean;
  /** Keys of the questions as saved: those may already have answers. */
  savedKeys?: string[];
  /** Keys a new question must not take: saved questions and every answer key ever stored. */
  reservedKeys?: string[];
  /** The standard fields of How to register (saved or not), for the preview. */
  fields: Record<StandardField, FieldRule>;
  /** On-site: the participation types (Participation types tab, saved or not). */
  tickets?: TicketDraft[];
  /** On-site: the parts of the event. */
  parts?: EventPart[];
}) {
  const { t } = useTranslation();
  const onsite = kind === 'onsite';
  const list = value.list;
  const setList = (next: QuestionRow[]) => onChange({ list: next.map((q, i) => ({ ...q, display_order: i })) });
  const [editing, setEditing] = useState<{ index: number | null; draft: QuestionRow; choices: string } | null>(null);
  const [dialogError, setDialogError] = useState<string | null>(null);
  // The window keeps its content while it fades out.
  const [dialogOpen, setDialogOpen] = useState(false);
  const [dragFrom, setDragFrom] = useState<number | null>(null);
  const [dragOver, setDragOver] = useState<number | null>(null);
  const [showPreview, setShowPreview] = useState(false);
  const activeTickets = tickets.filter((x) => x.active);

  const presets: Preset[] = [
    {
      key: 'heard_about',
      label: t('adminEvents.q.presetHeard', 'How did you hear about this event?'),
      make: () => ({
        ...blank('heard_about', 0), label: t('adminEvents.q.presetHeard', 'How did you hear about this event?'), kind: 'select',
        // Values stay in English for good (answers are stored as values); labels can be reworded.
        options: [
          { value: 'Smart Marina Connect newsletter', label: t('adminEvents.q.heardNewsletter', 'Smart Marina Connect newsletter') },
          { value: 'LinkedIn', label: t('adminEvents.q.heardLinkedin', 'LinkedIn') },
          { value: 'Smart Marina Connect website', label: t('adminEvents.q.heardWebsite', 'Smart Marina Connect website') },
          { value: 'A colleague', label: t('adminEvents.q.heardColleague', 'A colleague') },
          { value: 'Other', label: t('adminEvents.q.heardOther', 'Other') },
        ],
      }),
    },
    {
      key: 'linkedin',
      label: t('adminEvents.q.presetLinkedin', 'LinkedIn profile'),
      make: () => ({ ...blank('linkedin', 0), label: t('adminEvents.q.presetLinkedin', 'LinkedIn profile'), kind: 'url', profile_field: 'linkedin_url' }),
    },
    {
      key: 'objective',
      label: kind === 'webinar' ? t('adminEvents.q.presetGoalWebinar', 'What would you like to get from this webinar?') : t('adminEvents.q.presetGoal', 'What would you like to get from this event?'),
      make: () => ({
        ...blank('objective', 0),
        label: kind === 'webinar' ? t('adminEvents.q.presetGoalWebinar', 'What would you like to get from this webinar?') : t('adminEvents.q.presetGoal', 'What would you like to get from this event?'),
        kind: 'textarea',
      }),
    },
    {
      key: 'speaker_question',
      label: t('adminEvents.q.presetSpeaker', 'A question for the speakers'),
      make: () => ({ ...blank('speaker_question', 0), label: t('adminEvents.q.presetSpeaker', 'A question for the speakers'), kind: 'textarea' }),
    },
    {
      key: 'accessibility',
      label: t('adminEvents.q.presetAccess', 'Accessibility needs'),
      make: () => ({
        ...blank('accessibility', 0), label: t('adminEvents.q.presetAccess', 'Accessibility needs'), kind: 'textarea',
        help: t('adminEvents.q.presetAccessHelp', 'Tell us if you need anything to take part comfortably.'),
      }),
    },
    {
      key: 'dietary',
      onsiteOnly: true,
      label: t('adminEvents.q.presetDiet', 'Dietary requirements'),
      make: () => ({
        ...blank('dietary', 0), label: t('adminEvents.q.presetDiet', 'Dietary requirements'), kind: 'text',
        help: t('adminEvents.q.presetDietHelp', 'Vegetarian, allergies… Leave empty if none.'),
      }),
    },
    {
      key: 'billing_address',
      onsiteOnly: true,
      label: t('adminEvents.q.presetBilling', 'Billing address'),
      make: () => ({
        ...blank('billing_address', 0), label: t('adminEvents.q.presetBilling', 'Billing address'), kind: 'textarea',
        help: t('adminEvents.q.presetBillingHelp', 'Company name and full postal address for the invoice.'),
      }),
    },
    {
      key: 'vat_number',
      onsiteOnly: true,
      label: t('adminEvents.q.presetVat', 'VAT number'),
      make: () => ({
        ...blank('vat_number', 0), label: t('adminEvents.q.presetVat', 'VAT number'), kind: 'text', max_length: 40,
        help: t('adminEvents.q.presetVatHelp', 'For companies in the European Union.'),
      }),
    },
  ];
  if (onsite && parts.length > 0) {
    presets.push({
      key: 'parts',
      onsiteOnly: true,
      label: t('adminEvents.q.presetParts', 'Which parts will you attend?'),
      make: () => ({ ...blank('parts', 0), label: t('adminEvents.q.presetParts', 'Which parts will you attend?'), kind: 'parts', required: true, options: partsOptions(parts) }),
    });
  }
  const shownPresets = presets.filter((p) => onsite || !p.onsiteOnly);
  const freePresets = shownPresets.filter((p) => !list.some((q) => q.key === p.key));

  const kinds: QuestionKind[] = ['text', 'textarea', 'select', 'multiselect', 'checkbox', 'consent', 'url', 'phone', 'country', 'sectors'];

  const openNew = () => {
    setDialogError(null);
    setEditing({ index: null, draft: blank('', list.length), choices: '' });
    setDialogOpen(true);
  };
  const openEdit = (index: number) => {
    setDialogError(null);
    const q = list[index];
    // An empty list of types means "everyone" (the database reads it so).
    const draft = { ...q, ticket_keys: q.ticket_keys && q.ticket_keys.length ? q.ticket_keys : null };
    setEditing({ index, draft, choices: (q.options || []).map((o) => o.label).join('\n') });
    setDialogOpen(true);
  };
  const move = (i: number, d: -1 | 1) => {
    const j = i + d;
    if (j < 0 || j >= list.length) return;
    const next = [...list];
    [next[i], next[j]] = [next[j], next[i]];
    setList(next);
  };
  const moveTo = (from: number, to: number) => {
    if (from === to || from < 0 || to < 0 || from >= list.length || to >= list.length) return;
    const next = [...list];
    const [row] = next.splice(from, 1);
    next.splice(to, 0, row);
    setList(next);
  };

  const saveDialog = () => {
    if (!editing) return;
    const d = editing.draft;
    if (!d.label.trim()) { setDialogError(t('adminEvents.q.needLabel', 'Write the question.')); return; }
    const isList = d.kind === 'select' || d.kind === 'multiselect';
    const labels = editing.choices.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
    const unique = Array.from(new Set(labels));
    if (isList && unique.length < 2) { setDialogError(t('adminEvents.q.needChoices', 'Write at least two choices, one per line.')); return; }
    if (d.ticket_keys && d.ticket_keys.length === 0) { setDialogError(t('adminEvents.q.needTickets', 'Tick at least one participation type, or ask everyone.')); return; }
    const allowedProfile = PROFILE_FOR_KIND[d.kind] || [];
    const row: QuestionRow = {
      ...d,
      label: d.label.trim().slice(0, 300),
      help: d.help?.trim() ? d.help.trim().slice(0, 500) : null,
      options: isList
        ? mergeChoices(editing.index === null ? [] : (list[editing.index].options || []), unique.map((s) => s.slice(0, 200)))
        : d.kind === 'parts' ? partsOptions(parts) : null,
      profile_field: d.profile_field && allowedProfile.includes(d.profile_field) ? d.profile_field : null,
    };
    if (editing.index === null) {
      // Never the internal name of a removed question: its stored answers would come back.
      row.key = questionKey(row.label, [...list.map((q) => q.key), ...reservedKeys]);
      setList([...list, row]);
    } else {
      setList(list.map((q, i) => (i === editing.index ? row : q)));
    }
    setDialogOpen(false);
  };

  const err = (i: number) => issues.find((x) => x.tab === 'questions' && x.field === `q${i}`)?.message;
  const ticketWords = (keys: string[] | null) => (keys && keys.length
    ? keys.map((k) => tickets.find((x) => x.key === k)?.label || k).join(', ')
    : '');

  const addPreset = (p: Preset) => setList([...list, { ...p.make(), display_order: list.length }]);
  const presetOn = (p: Preset) => list.some((q) => q.key === p.key);
  const togglePreset = (p: Preset, on: boolean) => {
    if (on) addPreset(p);
    else setList(list.filter((q) => q.key !== p.key));
  };

  return (
    <div className={cn('grid gap-6', onsite ? 'lg:grid-cols-[minmax(0,1fr)_340px]' : 'lg:grid-cols-[minmax(0,1fr)_320px]')}>
      <div className="min-w-0 space-y-6">
        <Block
          title={t('adminEvents.q.title', 'Questions')}
          description={t('adminEvents.q.body', 'Asked after name, e-mail and the fields of the How to register tab. Keep it short: every extra question loses a few registrations.')}
        >
          {hasRegistrations && (
            <Note tone="warning">
              {t('adminEvents.q.hasRegs2', 'People have already registered. Their answers are kept if you change or remove a question; answers to a removed question appear under its internal name in the export and in the details of each person.')}
            </Note>
          )}
          {list.length === 0 ? (
            <p className="text-[14px] text-meta">{t('adminEvents.q.none', 'No question yet: people only give their name, e-mail and the fields you chose.')}</p>
          ) : (
            <ol className="space-y-3">
              {list.map((q, i) => (
                <li
                  key={q.key || i}
                  draggable={onsite}
                  onDragStart={onsite ? (e) => { setDragFrom(i); e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', String(i)); } : undefined}
                  onDragOver={onsite ? (e) => { if (dragFrom !== null) { e.preventDefault(); setDragOver(i); } } : undefined}
                  onDragLeave={onsite ? () => setDragOver((x) => (x === i ? null : x)) : undefined}
                  onDrop={onsite ? (e) => { e.preventDefault(); if (dragFrom !== null) moveTo(dragFrom, i); setDragFrom(null); setDragOver(null); } : undefined}
                  onDragEnd={onsite ? () => { setDragFrom(null); setDragOver(null); } : undefined}
                  className={cn(
                    'rounded-card border bg-white p-4 transition-shadow',
                    err(i) ? 'border-red-300' : 'border-rule',
                    dragOver === i && dragFrom !== i && 'ring-2 ring-navy/30',
                    dragFrom === i && 'opacity-60',
                  )}
                >
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div className="flex min-w-0 items-start gap-2">
                      {onsite && (
                        <span
                          className="mt-0.5 hidden cursor-grab text-meta sm:block"
                          title={t('adminEvents.q.drag', 'Drag to change the order')}
                          aria-hidden="true"
                        >
                          <GripVertical className="h-4 w-4" />
                        </span>
                      )}
                      <div className="min-w-0">
                        <p className="text-[15px] font-semibold leading-5 text-navy [overflow-wrap:anywhere]">
                          <span className="mr-1.5 tabular-nums text-meta">{i + 1}.</span>{q.label || t('adminEvents.q.untitled', 'Untitled question')}
                        </p>
                        <div className="mt-2 flex flex-wrap gap-1.5">
                          <AdminStatusPill>{questionKindWord(q.kind, t)}</AdminStatusPill>
                          {q.required && <AdminStatusPill tone="warning">{t('adminEvents.q.required', 'Required')}</AdminStatusPill>}
                          {q.profile_field && q.profile_field !== 'phone' && <AdminStatusPill tone="info">{t('adminEvents.q.toProfile', 'Saved to profile')}</AdminStatusPill>}
                          {!q.editable_after_submit && <AdminStatusPill>{t('adminEvents.q.final', 'Cannot be changed later')}</AdminStatusPill>}
                          {onsite && q.ticket_keys && q.ticket_keys.length > 0 && (
                            <AdminStatusPill tone="navy">{t('adminEvents.q.onlyFor', 'Only: {{list}}', { list: ticketWords(q.ticket_keys) })}</AdminStatusPill>
                          )}
                        </div>
                        {err(i) && <p role="alert" className="mt-2 text-[13px] font-medium text-red-700">{err(i)}</p>}
                      </div>
                    </div>
                    <div className="flex shrink-0 flex-wrap items-center gap-1.5">
                      <IconBtn label={t('adminEvents.q.up', 'Move up')} onClick={() => move(i, -1)} disabled={i === 0}><ArrowUp className="h-4 w-4" /></IconBtn>
                      <IconBtn label={t('adminEvents.q.down', 'Move down')} onClick={() => move(i, 1)} disabled={i === list.length - 1}><ArrowDown className="h-4 w-4" /></IconBtn>
                      <IconBtn label={t('adminEvents.q.edit', 'Change')} onClick={() => openEdit(i)}><Pencil className="h-4 w-4" /></IconBtn>
                      <IconBtn label={t('adminEvents.remove', 'Remove')} onClick={() => setList(list.filter((_, j) => j !== i))} danger><Trash2 className="h-4 w-4" /></IconBtn>
                    </div>
                  </div>
                </li>
              ))}
            </ol>
          )}
          <Button type="button" variant="outline" size="sm" className={EDITOR_BTN} onClick={openNew}>
            <Plus className="mr-1.5 h-4 w-4" aria-hidden="true" /> {t('adminEvents.q.add', 'Write a question')}
          </Button>
        </Block>

        {onsite ? (
          <Block
            title={t('adminEvents.q.presetsTitle', 'Ready-made questions')}
            description={t('adminEvents.q.presetsSwitchBody', 'Switch one on to add it at the end of the list. You can change its wording afterwards.')}
          >
            <ul className="divide-y divide-rule rounded-card border border-rule">
              {shownPresets.map((p) => {
                const on = presetOn(p);
                const id = `preset-${p.key}`;
                return (
                  <li key={p.key} className="flex items-center justify-between gap-4 px-4 py-3">
                    <label htmlFor={id} className="min-w-0 cursor-pointer text-[15px] font-medium leading-5 text-navy [overflow-wrap:anywhere]">{p.label}</label>
                    <Switch id={id} checked={on} onCheckedChange={(x) => togglePreset(p, x)} className="shrink-0" />
                  </li>
                );
              })}
            </ul>
          </Block>
        ) : freePresets.length > 0 && (
          <Block
            title={t('adminEvents.q.presetsTitle', 'Ready-made questions')}
            description={t('adminEvents.q.presetsBody', 'Add one in a click. You can change its wording afterwards.')}
          >
            <div className="flex flex-wrap gap-2">
              {freePresets.map((p) => (
                <button
                  key={p.key}
                  type="button"
                  onClick={() => addPreset(p)}
                  className="inline-flex min-h-11 items-center gap-1.5 rounded-pill border border-rule bg-white px-3 py-2 text-left text-[14px] font-medium text-navy transition-colors hover:border-navy/40 hover:bg-chip focus:outline-none focus-visible:shadow-focus"
                >
                  <Plus className="h-4 w-4 shrink-0 text-teal" aria-hidden="true" /> {p.label}
                </button>
              ))}
            </div>
          </Block>
        )}

        {onsite && (
          <div className="lg:hidden">
            <Button type="button" variant="outline" size="sm" className={EDITOR_BTN} aria-expanded={showPreview} onClick={() => setShowPreview((x) => !x)}>
              <Eye className="mr-1.5 h-4 w-4" aria-hidden="true" />
              {showPreview ? t('adminEvents.q.hidePreview', 'Hide the preview') : t('adminEvents.q.showPreview', 'See the form as people see it')}
            </Button>
            {showPreview && <PhonePreview className="mt-4" list={list} fields={fields} tickets={activeTickets} parts={parts} />}
          </div>
        )}
      </div>

      {onsite
        ? <aside className="hidden lg:block"><div className="sticky top-32"><PhonePreview list={list} fields={fields} tickets={activeTickets} parts={parts} /></div></aside>
        : <FormPreview list={list} fields={fields} />}

      <EditDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        title={editing?.index === null ? t('adminEvents.q.newTitle', 'New question') : t('adminEvents.q.editTitle', 'Change the question')}
        onSave={saveDialog}
        saveLabel={t('adminEvents.q.keep', 'Keep this question')}
        error={dialogError}
        wide
      >
        {editing && (
          <QuestionFields
            answered={hasRegistrations && editing.index !== null && savedKeys.includes(list[editing.index]?.key)}
            draft={editing.draft}
            choices={editing.choices}
            kinds={editing.draft.kind === 'parts' ? [...kinds, 'parts'] : kinds}
            tickets={onsite ? activeTickets : []}
            onDraft={(draft) => setEditing({ ...editing, draft })}
            onChoices={(choices) => setEditing({ ...editing, choices })}
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

function QuestionFields({
  answered,
  draft,
  choices,
  kinds,
  tickets,
  onDraft,
  onChoices,
}: {
  /** An existing question of an event that already has registrations. */
  answered: boolean;
  draft: QuestionRow;
  choices: string;
  kinds: QuestionKind[];
  /** On-site: the active participation types (who the question is asked to). */
  tickets: TicketDraft[];
  onDraft: (d: QuestionRow) => void;
  onChoices: (c: string) => void;
}) {
  const { t } = useTranslation();
  const set = <K extends keyof QuestionRow>(k: K, v: QuestionRow[K]) => onDraft({ ...draft, [k]: v });
  const isList = draft.kind === 'select' || draft.kind === 'multiselect';
  const profileChoices = PROFILE_FOR_KIND[draft.kind] || [];
  const scoped = !!draft.ticket_keys;
  const toggleTicket = (key: string) => {
    const cur = draft.ticket_keys || [];
    set('ticket_keys', cur.includes(key) ? cur.filter((k) => k !== key) : [...cur, key]);
  };
  return (
    <div className="space-y-4">
      <Field label={draft.kind === 'consent' ? t('adminEvents.q.statement', 'The statement they agree to') : t('adminEvents.q.wording', 'Question')} htmlFor="q-label">
        <Textarea id="q-label" rows={2} value={draft.label} onChange={(e) => set('label', e.target.value)} className={TEXTAREA} maxLength={300} />
      </Field>
      <Field
        label={t('adminEvents.q.type', 'Type of answer')}
        hint={answered ? t('adminEvents.q.typeLocked', 'People have answered: to ask it differently, add a new question and remove this one.') : undefined}
      >
        <Select value={draft.kind} onValueChange={(k) => set('kind', k as QuestionKind)} disabled={answered || draft.kind === 'parts'}>
          <SelectTrigger className={INPUT} aria-label={t('adminEvents.q.type', 'Type of answer')}><SelectValue /></SelectTrigger>
          <SelectContent>
            {kinds.map((k) => <SelectItem key={k} value={k}>{questionKindWord(k, t)}</SelectItem>)}
          </SelectContent>
        </Select>
      </Field>
      {draft.kind === 'parts' && (
        <p className="text-[13px] leading-[18px] text-meta">{t('adminEvents.q.partsAuto', 'The choices are the parts of the event, set in Participation types.')}</p>
      )}
      {isList && (
        <Field label={t('adminEvents.q.choices', 'Choices')} htmlFor="q-choices" hint={t('adminEvents.q.choicesHint', 'One choice per line.')}>
          <Textarea id="q-choices" rows={5} value={choices} onChange={(e) => onChoices(e.target.value)} className={TEXTAREA} />
        </Field>
      )}
      {isList && answered && (
        <Note tone="warning">
          {t('adminEvents.q.answeredChoices', 'People have already answered. Fixing the wording of a choice keeps their answers. If you remove a choice, someone who picked it must choose again the next time they change their answers.')}
        </Note>
      )}
      <Field label={t('adminEvents.q.help', 'Help text under the question')} htmlFor="q-help" optional>
        <Input id="q-help" value={draft.help || ''} onChange={(e) => set('help', e.target.value)} className={INPUT} maxLength={500} />
      </Field>
      {tickets.length > 1 && (
        <Field label={t('adminEvents.q.askedTo', 'Asked to')}>
          <div className="space-y-3">
            <div className="flex flex-wrap gap-2" role="radiogroup" aria-label={t('adminEvents.q.askedTo', 'Asked to')}>
              {[
                { on: !scoped, label: t('adminEvents.q.everyone', 'Everyone'), go: () => set('ticket_keys', null) },
                { on: scoped, label: t('adminEvents.q.someTypes', 'Some participation types only'), go: () => set('ticket_keys', draft.ticket_keys ?? []) },
              ].map((o) => (
                <button
                  key={o.label}
                  type="button"
                  role="radio"
                  aria-checked={o.on}
                  onClick={o.go}
                  className={cn(
                    'min-h-11 rounded-pill border px-3.5 py-2 text-[13px] font-medium transition-colors focus:outline-none focus-visible:shadow-focus',
                    o.on ? 'border-navy bg-navy text-white' : 'border-rule bg-white text-navy hover:border-navy/40',
                  )}
                >
                  {o.label}
                </button>
              ))}
            </div>
            {scoped && (
              <div className="flex flex-wrap gap-2">
                {tickets.map((x) => {
                  const on = (draft.ticket_keys || []).includes(x.key);
                  return (
                    <button
                      key={x.key}
                      type="button"
                      aria-pressed={on}
                      onClick={() => toggleTicket(x.key)}
                      className={cn(
                        'min-h-11 rounded-pill border px-3.5 py-2 text-[13px] font-medium transition-colors focus:outline-none focus-visible:shadow-focus',
                        on ? 'border-teal bg-foam text-navy' : 'border-rule bg-white text-meta hover:border-navy/40',
                      )}
                    >
                      {x.label || x.key}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </Field>
      )}
      <ToggleRow
        checked={draft.required}
        onChange={(on) => set('required', on)}
        title={draft.kind === 'consent' ? t('adminEvents.q.mustAgree', 'They must agree to register') : t('adminEvents.q.mustAnswer', 'An answer is required')}
      />
      <ToggleRow
        checked={draft.editable_after_submit}
        onChange={(on) => set('editable_after_submit', on)}
        title={t('adminEvents.q.editable', 'They can change their answer later')}
        body={t('adminEvents.q.editableBody', 'From their personal registration page, until the event starts.')}
      />
      {profileChoices.length > 0 && (
        <ToggleRow
          checked={!!draft.profile_field}
          onChange={(on) => set('profile_field', on ? profileChoices[0] : null)}
          title={t('adminEvents.q.saveProfile', 'Save the answer to their profile')}
          body={t('adminEvents.q.saveProfileBody', 'Fills the "{{field}}" of a member\'s profile when it is still empty.', { field: profileFieldWord(profileChoices[0], t) })}
        />
      )}
    </div>
  );
}

/**
 * What a registrant sees, roughly: name and e-mail, the standard fields chosen in How to
 * register (in the form's order), then the questions, greyed out. (Webinars.)
 */
function FormPreview({ list, fields }: { list: QuestionRow[]; fields: Record<StandardField, FieldRule> }) {
  const { t } = useTranslation();
  const standard = standardLines(fields, t);
  return (
    <aside className="hidden lg:block">
      <div className="rounded-card border border-rule bg-page p-4">
        <p className="text-meta-caps">{t('adminEvents.q.preview', 'What people see')}</p>
        <div className="mt-3 space-y-3 rounded-card border border-rule bg-white p-4" aria-hidden="true">
          {standard.map((l) => (
            <div key={l}>
              <p className="text-[12px] font-semibold text-navy">{l}</p>
              <div className="mt-1 h-8 rounded-field border border-rule bg-page" />
            </div>
          ))}
          {list.map((q) => <PreviewQuestion key={q.key || q.label} q={q} />)}
          <div className="h-9 rounded-pill bg-gold/70" />
        </div>
      </div>
    </aside>
  );
}

function standardLines(fields: Record<StandardField, FieldRule>, t: ReturnType<typeof useTranslation>['t']): string[] {
  const fieldWords: Record<StandardField, string> = {
    company: t('adminEvents.reg.company', 'Company'),
    job_title: t('adminEvents.reg.jobTitle', 'Job title'),
    phone: t('adminEvents.reg.phone', 'Phone'),
    country: t('adminEvents.reg.country', 'Country'),
  };
  return [
    `${t('adminEvents.q.pvFirst', 'First name')} *`,
    `${t('adminEvents.q.pvLast', 'Last name')} *`,
    `${t('adminEvents.q.pvEmail', 'E-mail')} *`,
    ...STANDARD_FIELDS.filter((f) => fields[f] !== 'hidden').map((f) => (
      fields[f] === 'required' ? `${fieldWords[f]} *` : `${fieldWords[f]} ${t('adminEvents.optional', '(optional)')}`
    )),
  ];
}

function PreviewQuestion({ q, parts }: { q: QuestionRow; parts?: EventPart[] }) {
  const options = q.kind === 'parts' && parts ? partsOptions(parts) : (q.options || []);
  if (q.kind === 'checkbox' || q.kind === 'consent') {
    return (
      <p className="flex items-start gap-2 text-[12px] text-navy">
        <span className="mt-0.5 h-3.5 w-3.5 shrink-0 rounded-[4px] border border-rule bg-page" />
        <span className="[overflow-wrap:anywhere]">{q.label || '…'}{q.required ? ' *' : ''}</span>
      </p>
    );
  }
  return (
    <div>
      <p className="text-[12px] font-semibold text-navy [overflow-wrap:anywhere]">{q.label || '…'}{q.required ? ' *' : ''}</p>
      {q.help && <p className="text-[11px] text-meta [overflow-wrap:anywhere]">{q.help}</p>}
      {q.kind === 'select' || q.kind === 'multiselect' || q.kind === 'parts' ? (
        <div className="mt-1 flex flex-wrap gap-1">
          {options.slice(0, 6).map((o) => (
            <span key={o.value} className="rounded-pill border border-rule px-2 py-0.5 text-[11px] text-meta">{o.label}</span>
          ))}
        </div>
      ) : (
        <div className={cn('mt-1 rounded-field border border-rule bg-page', q.kind === 'textarea' ? 'h-14' : 'h-8')} />
      )}
    </div>
  );
}

/**
 * On-site: the form in a phone frame, as a registrant on a phone sees it. With several
 * participation types, pick one to see the questions asked to that type.
 */
function PhonePreview({ list, fields, tickets, parts, className }: {
  list: QuestionRow[];
  fields: Record<StandardField, FieldRule>;
  tickets: TicketDraft[];
  parts: EventPart[];
  className?: string;
}) {
  const { t } = useTranslation();
  const [ticket, setTicket] = useState<string | null>(null);
  const chosen = tickets.length > 1 ? (tickets.find((x) => x.key === ticket)?.key ?? tickets[0].key) : tickets[0]?.key ?? null;
  const shown = list.filter((q) => !q.ticket_keys || q.ticket_keys.length === 0 || (chosen !== null && q.ticket_keys.includes(chosen)));
  const price = (x: TicketDraft) => {
    if (x.priceNote.trim()) return x.priceNote.trim();
    const c = priceCents(x.price);
    if (c === null || Number.isNaN(c)) return '';
    return c === 0 ? t('adminEvents.tk.free', 'Free') : `€${(c / 100).toFixed(c % 100 ? 2 : 0)}`;
  };
  return (
    <div className={cn('mx-auto w-full max-w-[320px]', className)}>
      <p className="mb-2 text-meta-caps">{t('adminEvents.q.preview', 'What people see')}</p>
      <div className="rounded-[34px] border-[10px] border-navy bg-navy shadow-lg">
        <div className="mx-auto mb-1 mt-0.5 h-1.5 w-16 rounded-full bg-white/25" aria-hidden="true" />
        <div className="max-h-[560px] overflow-y-auto rounded-[22px] bg-white p-4">
          <div className="space-y-3">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-teal">{t('adminEvents.q.pvRegister', 'Register')}</p>
            {standardLines(fields, t).map((l) => (
              <div key={l} aria-hidden="true">
                <p className="text-[12px] font-semibold text-navy">{l}</p>
                <div className="mt-1 h-8 rounded-field border border-rule bg-page" />
              </div>
            ))}
            {tickets.length > 1 && (
              <div className="space-y-1.5 pt-1">
                <p className="text-[12px] font-semibold text-navy">{t('adminEvents.q.pvHow', 'How will you take part?')} *</p>
                {tickets.map((x) => {
                  const on = x.key === chosen;
                  return (
                    <button
                      key={x.key}
                      type="button"
                      onClick={() => setTicket(x.key)}
                      aria-pressed={on}
                      className={cn(
                        'flex w-full items-start justify-between gap-2 rounded-field border-2 px-2.5 py-2 text-left text-[12px] focus:outline-none focus-visible:shadow-focus',
                        on ? 'border-navy bg-foam' : 'border-rule bg-white',
                        x.inviteOnly && 'opacity-60',
                      )}
                    >
                      <span className="min-w-0 font-semibold text-navy [overflow-wrap:anywhere]">{x.label || '…'}</span>
                      {price(x) && <span className="shrink-0 text-meta">{price(x)}</span>}
                    </button>
                  );
                })}
                <p className="text-[10px] leading-[14px] text-meta">{t('adminEvents.q.pvPick', 'Tap a type to see its questions.')}</p>
              </div>
            )}
            {shown.map((q) => <PreviewQuestion key={q.key || q.label} q={q} parts={parts} />)}
            <div className="h-9 rounded-pill bg-gold/80" aria-hidden="true" />
          </div>
        </div>
      </div>
    </div>
  );
}
