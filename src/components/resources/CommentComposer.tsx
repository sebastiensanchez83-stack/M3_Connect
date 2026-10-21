import { useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { AtSign, Building2, Loader2, UserRound, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { LogoTile } from '@/components/brand/OrgCard';
import { useRegistrationFlags } from '@/lib/flags';
import { cn } from '@/lib/utils';
import {
  activeQuery, COMMENT_MAX, COMMENT_MAX_TAGS, searchMentions, tagLabel, tagsInText, toStoredBody,
  type MentionSuggestion, type PickedTag,
} from '@/lib/articleComments';

/**
 * Writing a comment, with tags (Victor, 21 Oct 2026; written for members who are not at ease
 * with technology): a big text box, a line saying "Type @ to tag a person or a company" with a
 * button that types the "@" for them, and, while a name is being typed after "@", a list right
 * under the box (in the page, not floating: it never covers what is typed, and works the same
 * with a finger, the mouse or the keyboard: arrows, Enter or Tab to choose, Esc to close).
 *
 * The text stays readable while typing ("@Alex Morel"); the people and companies chosen show
 * under it as "Tagged: …" with a way to remove each one. On send, each "@Name" still in the
 * text becomes a stored tag (src/lib/articleComments.ts); the server checks them again.
 *
 * `compact`: the side panel of the article page on large screens (a smaller box and list, so the
 * comments above keep room). The help line says "by e-mail" only once the comment e-mails are on
 * (registration_flags.article_comment_emails).
 */
export function CommentComposer({
  initialText = '',
  initialTags = [],
  submitLabel,
  busyLabel,
  onSubmit,
  onCancel,
  autoFocus = false,
  compact = false,
  label,
}: {
  initialText?: string;
  initialTags?: PickedTag[];
  submitLabel: string;
  busyLabel: string;
  /** Resolves when saved (the box empties for a new comment); throws a message to show. */
  onSubmit: (storedBody: string) => Promise<void>;
  onCancel?: () => void;
  autoFocus?: boolean;
  /** Smaller box and suggestion list (the side panel on large screens). */
  compact?: boolean;
  /** The box's visible label. */
  label: string;
}) {
  const { t } = useTranslation();
  const { flags } = useRegistrationFlags();
  const emailsOn = flags.article_comments && flags.article_comment_emails;
  const baseId = useId();
  const boxId = `${baseId}-box`;
  const listId = `${baseId}-list`;
  const helpId = `${baseId}-help`;
  const errorId = `${baseId}-error`;
  const ref = useRef<HTMLTextAreaElement>(null);
  /** Where the cursor goes once the text we just changed is on screen (a tag chosen, an "@" typed for them). */
  const caretAfterRender = useRef<number | null>(null);
  const [text, setText] = useState(initialText);
  const [picked, setPicked] = useState<PickedTag[]>(initialTags);
  const [cursor, setCursor] = useState(initialText.length);
  const [suggestions, setSuggestions] = useState<MentionSuggestion[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchFailed, setSearchFailed] = useState(false);
  const [active, setActive] = useState(0);
  const [dismissedAt, setDismissedAt] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (autoFocus) ref.current?.focus();
  }, [autoFocus]);

  // The "@..." being typed, unless it is a tag already chosen and the cursor is past its name:
  // after "@Sam Rivera " the person writes on, they are not looking for anyone.
  const typed = activeQuery(text, cursor);
  const q = typed && picked.some((p) => text.startsWith(`@${p.label}`, typed.start) && cursor >= typed.start + 1 + p.label.length)
    ? null
    : typed;
  const open = !!q && dismissedAt !== q.start;
  const query = q?.query.trim() ?? '';
  const tagsLeft = COMMENT_MAX_TAGS - tagsInText(text, picked).length;

  // The suggestions for the name being typed (2 characters at least), a moment after typing stops.
  useEffect(() => {
    if (!open || query.length < 2 || tagsLeft <= 0) {
      setSuggestions([]);
      setSearching(false);
      setSearchFailed(false);
      return;
    }
    let alive = true;
    setSearching(true);
    const timer = window.setTimeout(() => {
      searchMentions(query)
        .then((rows) => {
          if (!alive) return;
          setSuggestions(rows);
          setSearchFailed(false);
          setActive(0);
        })
        .catch(() => {
          if (!alive) return;
          setSuggestions([]);
          setSearchFailed(true);
        })
        .finally(() => { if (alive) setSearching(false); });
    }, 220);
    return () => { alive = false; window.clearTimeout(timer); };
  }, [open, query, tagsLeft]);

  const visibleLength = text.trim().length;
  const tooLong = visibleLength > COMMENT_MAX;
  const syncCursor = () => setCursor(ref.current?.selectionStart ?? text.length);

  const choose = (s: MentionSuggestion) => {
    if (!q) return;
    const label = tagLabel(s.label);
    if (!label) return;
    const insert = `@${label} `;
    const next = text.slice(0, q.start) + insert + text.slice(cursor);
    const pos = q.start + insert.length;
    setText(next);
    setPicked((cur) => [...cur.filter((p) => !(p.id === s.id && p.kind === s.kind) && p.label !== label), { kind: s.kind, id: s.id, label }]);
    setSuggestions([]);
    setCursor(pos);
    caretAfterRender.current = pos;
  };

  /** Removes a tag: its "@" goes, the name stays as plain words. */
  const untag = (p: PickedTag) => {
    setPicked((cur) => cur.filter((x) => x !== p));
    setText((cur) => cur.split(`@${p.label}`).join(p.label));
  };

  /** "Tag someone": types an "@" where the cursor is (with a space before it when needed). */
  const startTag = () => {
    const el = ref.current;
    const at = el?.selectionStart ?? text.length;
    const needsSpace = at > 0 && !/\s/.test(text[at - 1]);
    const insert = `${needsSpace ? ' ' : ''}@`;
    const next = text.slice(0, at) + insert + text.slice(at);
    const pos = at + insert.length;
    setText(next);
    setCursor(pos);
    setDismissedAt(null);
    caretAfterRender.current = pos;
  };

  // The cursor after a change made for the person, as soon as the new text is in the box
  // (before the next key press, so nothing they type lands elsewhere).
  useLayoutEffect(() => {
    const pos = caretAfterRender.current;
    const el = ref.current;
    if (pos === null || !el) return;
    caretAfterRender.current = null;
    el.focus();
    el.setSelectionRange(pos, pos);
  }, [text]);

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (!open) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      setDismissedAt(q?.start ?? null);
      return;
    }
    if (!suggestions.length) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((i) => (i + 1) % suggestions.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((i) => (i - 1 + suggestions.length) % suggestions.length);
    } else if (e.key === 'Enter' || e.key === 'Tab') {
      e.preventDefault();
      choose(suggestions[Math.min(active, suggestions.length - 1)]);
    }
  };

  const submit = async () => {
    if (busy) return;
    if (!visibleLength) {
      setError(t('comments.err.empty', 'Please write something first.'));
      ref.current?.focus();
      return;
    }
    if (tooLong) {
      setError(t('comments.err.tooLong', { max: COMMENT_MAX, defaultValue: 'Your comment is too long: {{max}} characters at most.' }));
      ref.current?.focus();
      return;
    }
    setError(null);
    setBusy(true);
    try {
      await onSubmit(toStoredBody(text.trim(), tagsInText(text, picked)));
      if (!onCancel) {
        setText('');
        setPicked([]);
        setCursor(0);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const shownTags = tagsInText(text, picked);
  const listOpen = open && tagsLeft > 0;
  const activeId = listOpen && suggestions.length ? `${listId}-${Math.min(active, suggestions.length - 1)}` : undefined;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-2">
        <label htmlFor={boxId} className="text-[16px] font-semibold leading-6 text-navy">{label}</label>
        <button
          type="button"
          onClick={startTag}
          className="inline-flex min-h-11 items-center gap-1.5 rounded-pill border border-navy/55 bg-white px-4 text-[15px] font-semibold text-navy transition-colors hover:border-navy hover:bg-chip focus:outline-none focus-visible:shadow-focus"
        >
          <AtSign className="h-4 w-4" aria-hidden="true" />
          {t('comments.tagSomeone', 'Tag someone')}
        </button>
      </div>
      <p id={helpId} className="text-[15px] leading-6 text-meta">
        {compact
          ? t('comments.tagHelpShort', 'Type @ to tag a person or a company.')
          : emailsOn
          ? t('comments.tagHelp', 'Type @ to tag a person or a company: they will be told on the site and by e-mail.')
          : t('comments.tagHelpSite', 'Type @ to tag a person or a company: they will see it on their dashboard.')}
      </p>
      <textarea
        id={boxId}
        ref={ref}
        value={text}
        rows={compact ? 2 : 4}
        onChange={(e) => {
          setText(e.target.value);
          setCursor(e.target.selectionStart ?? e.target.value.length);
          setDismissedAt(null);
          if (error) setError(null);
        }}
        onKeyDown={onKeyDown}
        onKeyUp={syncCursor}
        onClick={syncCursor}
        onSelect={syncCursor}
        placeholder={t('comments.placeholder', 'Write your comment here…')}
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={listOpen}
        aria-controls={listOpen ? listId : undefined}
        aria-activedescendant={activeId}
        aria-describedby={[helpId, error ? errorId : ''].filter(Boolean).join(' ')}
        aria-invalid={!!error || tooLong}
        className={cn(
          compact ? 'min-h-[88px]' : 'min-h-[132px]',
          'block w-full resize-y rounded-field border bg-white px-4 py-3 text-[16px] leading-6 text-ink placeholder:text-meta/70',
          'focus:border-navy focus:outline-none focus-visible:shadow-focus',
          error || tooLong ? 'border-red-400' : 'border-navy/40',
        )}
      />

      {/* The suggestions, under the box (never on top of the text). */}
      {listOpen && (
        <div className="rounded-field border border-navy/30 bg-white shadow-sm">
          <p className="border-b border-rule px-4 py-2 text-[14px] leading-5 text-meta" aria-live="polite">
            {query.length < 2
              ? t('comments.keepTyping', 'Keep typing the name of the person or the company…')
              : searching
                ? t('comments.searching', { q: query, defaultValue: 'Looking for "{{q}}"…' })
                : searchFailed
                  ? t('comments.searchFailed', 'We could not look the name up. Please try again.')
                  : suggestions.length
                    ? t('comments.pickOne', 'Press a name to tag it:')
                    : t('comments.noMatch', { q: query, defaultValue: 'No member or company found with "{{q}}". Only validated members and companies can be tagged.' })}
          </p>
          {suggestions.length > 0 && (
            <ul id={listId} role="listbox" aria-label={t('comments.suggestions', 'People and companies to tag')} className={cn(compact ? 'max-h-[200px]' : 'max-h-[320px]', 'overflow-y-auto py-1')}>
              {suggestions.map((s, i) => {
                const on = i === Math.min(active, suggestions.length - 1);
                return (
                  <li key={`${s.kind}:${s.id}`} role="presentation">
                    <button
                      type="button"
                      id={`${listId}-${i}`}
                      role="option"
                      aria-selected={on}
                      tabIndex={-1}
                      onMouseDown={(e) => e.preventDefault()}
                      onMouseEnter={() => setActive(i)}
                      onClick={() => choose(s)}
                      className={cn(
                        'flex min-h-[56px] w-full cursor-pointer items-center gap-3 px-4 py-2 text-left transition-colors',
                        on ? 'bg-foam' : 'hover:bg-page',
                      )}
                    >
                      {s.kind === 'company' ? (
                        <LogoTile src={s.image_url} name={s.label} size={40} className="!rounded-pill !p-1" />
                      ) : s.image_url ? (
                        <img src={s.image_url} alt="" className="h-10 w-10 shrink-0 rounded-full object-cover" />
                      ) : (
                        <span aria-hidden="true" className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-teal text-white">
                          <UserRound className="h-5 w-5" />
                        </span>
                      )}
                      <span className="min-w-0 flex-1">
                        <span className="block text-[16px] font-semibold leading-6 text-navy [overflow-wrap:anywhere]">{s.label}</span>
                        {s.detail && <span className="line-clamp-2 block text-[14px] leading-5 text-meta [overflow-wrap:anywhere]">{s.detail}</span>}
                      </span>
                      <span className="inline-flex shrink-0 items-center gap-1 rounded-pill bg-chip px-2.5 py-0.5 text-[13px] font-semibold text-navy">
                        {s.kind === 'company'
                          ? <><Building2 className="h-3.5 w-3.5" aria-hidden="true" />{t('comments.kindCompany', 'Company')}</>
                          : <><UserRound className="h-3.5 w-3.5" aria-hidden="true" />{t('comments.kindPerson', 'Person')}</>}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
      {open && tagsLeft <= 0 && (
        <p className="text-[14px] leading-5 text-meta" aria-live="polite">
          {t('comments.tagsFull', { max: COMMENT_MAX_TAGS, defaultValue: 'You have tagged {{max}} people or companies: that is the most for one comment.' })}
        </p>
      )}

      {shownTags.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[14px] font-semibold text-navy">{t('comments.taggedLabel', 'Tagged:')}</span>
          {shownTags.map((p) => (
            <span key={`${p.kind}:${p.id}`} className="inline-flex min-h-9 items-center gap-1 rounded-pill bg-foam pl-3 text-[14px] font-semibold text-navy">
              {p.kind === 'company' ? <Building2 className="h-3.5 w-3.5" aria-hidden="true" /> : <UserRound className="h-3.5 w-3.5" aria-hidden="true" />}
              {p.label}
              <button
                type="button"
                onClick={() => untag(p)}
                aria-label={t('comments.untag', { name: p.label, defaultValue: 'Remove the tag of {{name}}' })}
                className="ml-0.5 grid h-9 w-9 place-items-center rounded-full text-navy transition-colors hover:bg-white focus:outline-none focus-visible:shadow-focus"
              >
                <X className="h-4 w-4" aria-hidden="true" />
              </button>
            </span>
          ))}
        </div>
      )}

      {error && (
        <p id={errorId} role="alert" className="rounded-field border border-red-200 bg-red-50 px-3 py-2.5 text-[15px] leading-6 text-red-900">
          {error}
        </p>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <span className={cn('text-[14px] leading-5', tooLong ? 'font-semibold text-red-700' : 'text-meta')} aria-live="polite">
          {visibleLength > COMMENT_MAX - 200
            ? t('comments.charsLeft', { n: COMMENT_MAX - visibleLength, defaultValue: '{{n}} characters left' })
            : ''}
        </span>
        <div className="flex flex-wrap items-center gap-3">
          {onCancel && (
            <button
              type="button"
              onClick={onCancel}
              disabled={busy}
              className="inline-flex min-h-11 items-center rounded-pill border border-navy/55 bg-white px-5 text-[15px] font-semibold text-navy transition-colors hover:border-navy hover:bg-chip focus:outline-none focus-visible:shadow-focus disabled:opacity-60"
            >
              {t('common.cancel', 'Cancel')}
            </button>
          )}
          <Button type="button" variant="cta" size="sm" arrow={false} roll={!busy} disabled={busy} onClick={() => void submit()} className="min-w-[10rem] justify-center">
            {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />}
            {busy ? busyLabel : submitLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}
