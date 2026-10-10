import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ArrowDown, ArrowUp, Pencil, Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { EditDialog } from '@/components/home/dashboard/EditKit';
import { cn } from '@/lib/utils';
import { ADMIN_BTN, AdminStatusPill } from '../AdminUI';
import { Block, Field, INPUT, Note, TEXTAREA, ToggleRow } from './editorUi';
import {
  profileFieldWord, questionKey, questionKindWord,
  type EventKind, type ProfileField, type QuestionKind, type QuestionOption, type QuestionRow,
} from './eventAdmin';
import type { FormIssue, QuestionsForm } from './editorModel';

/** Which profile field an answer of this kind may fill (contract: profile_field). */
const PROFILE_FOR_KIND: Partial<Record<QuestionKind, ProfileField[]>> = {
  text: ['job_title'],
  country: ['country'],
  phone: ['phone'],
  url: ['linkedin_url'],
};

const blank = (key: string, order: number): QuestionRow => ({
  key, label: '', help: null, kind: 'text', options: null, max_length: null, required: false,
  ticket_keys: null, profile_field: null, editable_after_submit: true, display_order: order,
});

interface Preset { key: string; label: string; make: () => Omit<QuestionRow, 'display_order'> }

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
 */
export function QuestionsTab({
  value,
  onChange,
  issues,
  kind,
  hasRegistrations,
}: {
  value: QuestionsForm;
  onChange: (next: QuestionsForm) => void;
  issues: FormIssue[];
  kind: EventKind;
  hasRegistrations: boolean;
}) {
  const { t } = useTranslation();
  const list = value.list;
  const setList = (next: QuestionRow[]) => onChange({ list: next.map((q, i) => ({ ...q, display_order: i })) });
  const [editing, setEditing] = useState<{ index: number | null; draft: QuestionRow; choices: string } | null>(null);
  const [dialogError, setDialogError] = useState<string | null>(null);
  // The window keeps its content while it fades out.
  const [dialogOpen, setDialogOpen] = useState(false);

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
  ];
  const freePresets = presets.filter((p) => !list.some((q) => q.key === p.key));

  const kinds: QuestionKind[] = ['text', 'textarea', 'select', 'multiselect', 'checkbox', 'consent', 'url', 'phone', 'country', 'sectors'];

  const openNew = () => {
    setDialogError(null);
    setEditing({ index: null, draft: blank('', list.length), choices: '' });
    setDialogOpen(true);
  };
  const openEdit = (index: number) => {
    setDialogError(null);
    const q = list[index];
    setEditing({ index, draft: { ...q }, choices: (q.options || []).map((o) => o.label).join('\n') });
    setDialogOpen(true);
  };
  const move = (i: number, d: -1 | 1) => {
    const j = i + d;
    if (j < 0 || j >= list.length) return;
    const next = [...list];
    [next[i], next[j]] = [next[j], next[i]];
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
    const allowedProfile = PROFILE_FOR_KIND[d.kind] || [];
    const row: QuestionRow = {
      ...d,
      label: d.label.trim().slice(0, 300),
      help: d.help?.trim() ? d.help.trim().slice(0, 500) : null,
      options: isList
        ? mergeChoices(editing.index === null ? [] : (list[editing.index].options || []), unique.map((s) => s.slice(0, 200)))
        : null,
      profile_field: d.profile_field && allowedProfile.includes(d.profile_field) ? d.profile_field : null,
    };
    if (editing.index === null) {
      row.key = questionKey(row.label, list.map((q) => q.key));
      setList([...list, row]);
    } else {
      setList(list.map((q, i) => (i === editing.index ? row : q)));
    }
    setDialogOpen(false);
  };

  const err = (i: number) => issues.find((x) => x.tab === 'questions' && x.field === `q${i}`)?.message;

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
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
                <li key={q.key || i} className={cn('rounded-card border bg-white p-4', err(i) ? 'border-red-300' : 'border-rule')}>
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div className="min-w-0">
                      <p className="text-[15px] font-semibold leading-5 text-navy [overflow-wrap:anywhere]">
                        <span className="mr-1.5 tabular-nums text-meta">{i + 1}.</span>{q.label || t('adminEvents.q.untitled', 'Untitled question')}
                      </p>
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        <AdminStatusPill>{questionKindWord(q.kind, t)}</AdminStatusPill>
                        {q.required && <AdminStatusPill tone="warning">{t('adminEvents.q.required', 'Required')}</AdminStatusPill>}
                        {q.profile_field && <AdminStatusPill tone="info">{t('adminEvents.q.toProfile', 'Saved to profile')}</AdminStatusPill>}
                        {!q.editable_after_submit && <AdminStatusPill>{t('adminEvents.q.final', 'Cannot be changed later')}</AdminStatusPill>}
                      </div>
                      {err(i) && <p role="alert" className="mt-2 text-[13px] font-medium text-red-700">{err(i)}</p>}
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
          <Button type="button" variant="outline" size="sm" className={ADMIN_BTN} onClick={openNew}>
            <Plus className="mr-1.5 h-4 w-4" aria-hidden="true" /> {t('adminEvents.q.add', 'Write a question')}
          </Button>
        </Block>

        {freePresets.length > 0 && (
          <Block
            title={t('adminEvents.q.presetsTitle', 'Ready-made questions')}
            description={t('adminEvents.q.presetsBody', 'Add one in a click. You can change its wording afterwards.')}
          >
            <div className="flex flex-wrap gap-2">
              {freePresets.map((p) => (
                <button
                  key={p.key}
                  type="button"
                  onClick={() => setList([...list, { ...p.make(), display_order: list.length }])}
                  className="inline-flex items-center gap-1.5 rounded-pill border border-rule bg-white px-3 py-2 text-left text-[14px] font-medium text-navy transition-colors hover:border-navy/40 hover:bg-chip focus:outline-none focus-visible:shadow-focus"
                >
                  <Plus className="h-4 w-4 shrink-0 text-teal" aria-hidden="true" /> {p.label}
                </button>
              ))}
            </div>
          </Block>
        )}
      </div>

      <FormPreview list={list} />

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
            answered={hasRegistrations && editing.index !== null}
            draft={editing.draft}
            choices={editing.choices}
            kinds={kinds}
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
        'grid h-10 w-10 place-items-center rounded-pill border bg-white transition-colors focus:outline-none focus-visible:shadow-focus disabled:opacity-35',
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
  onDraft,
  onChoices,
}: {
  /** An existing question of an event that already has registrations. */
  answered: boolean;
  draft: QuestionRow;
  choices: string;
  kinds: QuestionKind[];
  onDraft: (d: QuestionRow) => void;
  onChoices: (c: string) => void;
}) {
  const { t } = useTranslation();
  const set = <K extends keyof QuestionRow>(k: K, v: QuestionRow[K]) => onDraft({ ...draft, [k]: v });
  const isList = draft.kind === 'select' || draft.kind === 'multiselect';
  const profileChoices = PROFILE_FOR_KIND[draft.kind] || [];
  return (
    <div className="space-y-4">
      <Field label={draft.kind === 'consent' ? t('adminEvents.q.statement', 'The statement they agree to') : t('adminEvents.q.wording', 'Question')} htmlFor="q-label">
        <Textarea id="q-label" rows={2} value={draft.label} onChange={(e) => set('label', e.target.value)} className={TEXTAREA} maxLength={300} />
      </Field>
      <Field label={t('adminEvents.q.type', 'Type of answer')}>
        <Select value={draft.kind} onValueChange={(k) => set('kind', k as QuestionKind)}>
          <SelectTrigger className={INPUT} aria-label={t('adminEvents.q.type', 'Type of answer')}><SelectValue /></SelectTrigger>
          <SelectContent>
            {kinds.map((k) => <SelectItem key={k} value={k}>{questionKindWord(k, t)}</SelectItem>)}
          </SelectContent>
        </Select>
      </Field>
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

/** What a registrant sees, roughly: the questions in order, greyed out. */
function FormPreview({ list }: { list: QuestionRow[] }) {
  const { t } = useTranslation();
  return (
    <aside className="hidden lg:block">
      <div className="rounded-card border border-rule bg-page p-4">
        <p className="text-meta-caps">{t('adminEvents.q.preview', 'What people see')}</p>
        <div className="mt-3 space-y-3 rounded-card border border-rule bg-white p-4" aria-hidden="true">
          {[t('adminEvents.q.pvFirst', 'First name'), t('adminEvents.q.pvLast', 'Last name'), t('adminEvents.q.pvEmail', 'E-mail')].map((l) => (
            <div key={l}>
              <p className="text-[12px] font-semibold text-navy">{l}</p>
              <div className="mt-1 h-8 rounded-field border border-rule bg-page" />
            </div>
          ))}
          {list.map((q) => (
            <div key={q.key || q.label}>
              {q.kind === 'checkbox' || q.kind === 'consent' ? (
                <p className="flex items-start gap-2 text-[12px] text-navy">
                  <span className="mt-0.5 h-3.5 w-3.5 shrink-0 rounded-[4px] border border-rule bg-page" />
                  <span className="[overflow-wrap:anywhere]">{q.label || '…'}{q.required ? ' *' : ''}</span>
                </p>
              ) : (
                <>
                  <p className="text-[12px] font-semibold text-navy [overflow-wrap:anywhere]">{q.label || '…'}{q.required ? ' *' : ''}</p>
                  {q.help && <p className="text-[11px] text-meta [overflow-wrap:anywhere]">{q.help}</p>}
                  {q.kind === 'select' || q.kind === 'multiselect' ? (
                    <div className="mt-1 flex flex-wrap gap-1">
                      {(q.options || []).slice(0, 6).map((o) => (
                        <span key={o.value} className="rounded-pill border border-rule px-2 py-0.5 text-[11px] text-meta">{o.label}</span>
                      ))}
                    </div>
                  ) : (
                    <div className={cn('mt-1 rounded-field border border-rule bg-page', q.kind === 'textarea' ? 'h-14' : 'h-8')} />
                  )}
                </>
              )}
            </div>
          ))}
          <div className="h-9 rounded-pill bg-gold/70" />
        </div>
      </div>
    </aside>
  );
}
