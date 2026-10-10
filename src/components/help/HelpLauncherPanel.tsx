import { useEffect, useId, useMemo, useRef, useState, type RefObject } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronDown, ExternalLink } from 'lucide-react';
import { SearchField } from '@/components/brand/SearchField';
import { UnderlineLink } from '@/components/brand/UnderlineLink';
import { useMediaQuery } from '@/components/motion/useReducedMotion';
import { cn } from '@/lib/utils';
import { buildHelpSections, helpHref } from './helpContent';
import { buildHelpIndex, helpQueryWords, searchHelp, type HelpIndexEntry } from './helpSearch';
import type { HelpPlace } from './helpPlaces';

/**
 * The inside of the Help button's panel (HelpLauncher.tsx), loaded the first
 * time it is needed: a search through the whole help centre (helpSearch.ts,
 * the same search as /help) and, while nothing is typed, the three questions
 * of this page.
 *
 * A question opens its answer right here, in the panel (one at a time), so
 * reading it never leaves the page and nothing typed is lost. Under the answer,
 * its own links and "Read it in the help centre" (/help#<id>); on a page with a
 * form those open in a new tab.
 */

/** Found answers shown first; "Show all" shows the rest, here in the panel. */
const MAX_RESULTS = 5;

export function HelpLauncherPanel({ place, panelRef, member }: { place: HelpPlace; panelRef: RefObject<HTMLDivElement>; member: boolean }) {
  const { t } = useTranslation();
  const wide = useMediaQuery('(min-width: 640px)');
  const sections = useMemo(() => buildHelpSections(t), [t]);
  const index = useMemo(() => buildHelpIndex(sections), [sections]);
  const byId = useMemo(() => new Map(index.map((entry) => [entry.item.id, entry])), [index]);
  const [query, setQuery] = useState('');
  const [openId, setOpenId] = useState<string | null>(null);
  const [all, setAll] = useState(false);
  const listRef = useRef<HTMLUListElement>(null);
  /** After "Show all": the focus goes to the first answer that was not shown before. */
  const focusFrom = useRef<number | null>(null);

  const words = helpQueryWords(query);
  const wordsKey = words.join(' ');
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const result = useMemo(() => searchHelp(index, words), [index, wordsKey]);
  const searching = result.mode !== 'idle';

  // The answers found: the ones whose question holds the words first.
  const found: HelpIndexEntry[] = useMemo(() => {
    if (!result.ids) return [];
    const hits = index.filter((entry) => result.ids!.has(entry.item.id));
    const strong = result.strong;
    return strong ? [...hits].sort((a, b) => Number(strong.has(b.item.id)) - Number(strong.has(a.item.id))) : hits;
  }, [index, result]);

  // New words: the first answers again.
  useEffect(() => setAll(false), [wordsKey]);

  const pageQuestions = place.ids.map((id) => byId.get(id)).filter((e): e is HelpIndexEntry => !!e);
  const shown = searching ? (all ? found : found.slice(0, MAX_RESULTS)) : pageQuestions;
  const more = searching && !all ? found.length - MAX_RESULTS : 0;

  // With a mouse, straight into the search; on a touch screen the keyboard would hide the questions.
  useEffect(() => {
    if (typeof window.matchMedia !== 'function' || !window.matchMedia('(pointer: fine)').matches) return;
    // Unless the reader already moved inside the panel while it loaded.
    const panel = panelRef.current;
    const active = document.activeElement;
    if (panel && (active === panel || !panel.contains(active))) {
      panel.querySelector<HTMLInputElement>('input[type="search"]')?.focus({ preventScroll: true });
    }
  }, [panelRef]);

  // An answer opened low in the panel: the panel scrolls so it can be read (its question stays in view).
  useEffect(() => {
    const panel = panelRef.current;
    if (!openId || !panel) return;
    const entry = listRef.current?.querySelector<HTMLElement>(`[data-help-entry="${openId}"]`);
    if (!entry) return;
    const p = panel.getBoundingClientRect();
    const e = entry.getBoundingClientRect();
    if (e.bottom > p.bottom - 8) panel.scrollTop += Math.max(0, Math.min(e.bottom - p.bottom + 16, e.top - p.top - 12));
  }, [openId, panelRef]);

  // "Show all": the focus on the first answer that was not there (the button is gone).
  useEffect(() => {
    if (focusFrom.current === null || !all) return;
    const buttons = listRef.current?.querySelectorAll<HTMLButtonElement>('[data-help-q]');
    buttons?.[focusFrom.current]?.focus();
    focusFrom.current = null;
  }, [all]);

  return (
    <div className="mt-3">
      <SearchField
        tone="light"
        size={wide ? 'md' : 'lg'}
        value={query}
        onValueChange={setQuery}
        // Enter: to the first answer found.
        onSearch={() => listRef.current?.querySelector<HTMLButtonElement>('[data-help-q]')?.focus()}
        label={t('helpButton.searchLabel', 'Search the help centre')}
        placeholder={t('helpButton.searchPlaceholder', 'For example: password')}
      />

      {/* What the search found, said once. */}
      <p className="sr-only" role="status" aria-live="polite" aria-atomic="true">
        {!searching
          ? ''
          : found.length === 0
            ? t('helpButton.none', 'No answer has these words.')
            : t('helpButton.foundCount', { count: found.length, defaultValue_one: '{{count}} answer found', defaultValue_other: '{{count}} answers found' })}
      </p>

      {/* No title over an empty list: the sentence below says it. */}
      {!(searching && found.length === 0) && (
        <h3 className="text-meta-caps mt-4">
          {searching
            ? result.mode === 'closest'
              ? t('helpButton.closest', 'The closest answers')
              : t('helpButton.found', 'Answers found')
            : t('helpButton.forThisPage', 'Questions about this page')}
        </h3>
      )}

      {searching && found.length === 0 ? (
        <p className="mt-4 text-[15px] leading-[22px] text-meta">
          {t('helpButton.noneBody', 'No answer has these words. Try a shorter word, such as “password”, or write to the team below.')}
        </p>
      ) : (
        <ul ref={listRef} className="mt-2 space-y-0.5">
          {shown.map((entry) => (
            <Question
              key={entry.item.id}
              entry={entry}
              open={openId === entry.item.id}
              onToggle={() => setOpenId((id) => (id === entry.item.id ? null : entry.item.id))}
              newTab={!!place.keepPage}
              member={member}
            />
          ))}
        </ul>
      )}

      {more > 0 && (
        <button
          type="button"
          onClick={() => {
            focusFrom.current = MAX_RESULTS;
            setAll(true);
          }}
          className="focus-ring -ml-1 mt-2 inline-flex min-h-11 items-center rounded-field px-1 text-[15px] font-semibold text-navy underline decoration-navy/30 underline-offset-4 hover:decoration-gold"
        >
          {t('helpButton.showAll', { count: found.length, defaultValue: 'Show all {{count}} answers' })}
        </button>
      )}
    </div>
  );
}

function Question({
  entry,
  open,
  onToggle,
  newTab,
  member,
}: {
  entry: HelpIndexEntry;
  open: boolean;
  onToggle: () => void;
  newTab: boolean;
  member: boolean;
}) {
  const { t } = useTranslation();
  const answerId = `${useId()}-answer`;
  const { item, section } = entry;
  const Icon = section.icon;
  const tab = newTab ? { target: '_blank', rel: 'noopener' } : {};
  // Another answer ("#publishing-kinds") is read on /help; dashboard links only mean something to members.
  const links = (item.links ?? [])
    .filter((l) => member || !l.members)
    .map((l) => ({ ...l, to: l.to.startsWith('#') ? `/help${l.to}` : l.to }));

  return (
    <li data-help-entry={item.id}>
      <button
        type="button"
        data-help-q=""
        aria-expanded={open}
        aria-controls={answerId}
        onClick={onToggle}
        className={cn(
          'group -mx-2 flex min-h-11 w-[calc(100%+1rem)] items-start gap-3 rounded-field px-2 py-2 text-left transition-colors hover:bg-page',
          'focus:outline-none focus-visible:[box-shadow:inset_0_0_0_2px_#0b2653]',
          open && 'bg-page',
        )}
      >
        <span aria-hidden="true" className="mt-px grid h-8 w-8 shrink-0 place-items-center rounded-field bg-chip text-navy">
          <Icon className="h-4 w-4" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-[15px] font-semibold leading-5 text-navy [overflow-wrap:anywhere]">
            <span className="card-ul">{item.q}</span>
          </span>
          <span className="mt-0.5 block text-[13px] leading-4 text-meta">{section.title}</span>
        </span>
        <ChevronDown
          aria-hidden="true"
          className={cn('mt-1.5 h-4 w-4 shrink-0 text-meta transition-transform duration-200 motion-reduce:transition-none', open && 'rotate-180 text-navy')}
        />
      </button>

      <div id={answerId} hidden={!open} className="pb-3 pl-11 pr-1 pt-1">
        {open && (
          <div className="space-y-2.5 text-[15px] leading-[22px] text-ink">
            {/* The how-to first, then what follows from it (as on /help). */}
            {item.steps && (
              <ol className="space-y-2">
                {item.steps.map((s, i) => (
                  <li key={s} className="flex items-start gap-2.5">
                    <span aria-hidden="true" className="mt-px grid h-6 w-6 shrink-0 place-items-center rounded-full bg-foam text-[13px] font-semibold text-teal-text">
                      {i + 1}
                    </span>
                    <span className="min-w-0">
                      <span className="sr-only">{t('help.step', { n: i + 1, defaultValue: 'Step {{n}}:' })} </span>
                      {s}
                    </span>
                  </li>
                ))}
              </ol>
            )}
            {item.a.map((p) => <p key={p}>{p}</p>)}
            <div className="flex flex-col items-start">
              {links.map((l) => (
                <UnderlineLink key={l.to} to={l.to} {...tab} external={newTab} arrow={!newTab} className="min-h-11 !text-[15px]">
                  {l.label}
                  {newTab && <NewTabIcon />}
                </UnderlineLink>
              ))}
              <UnderlineLink to={helpHref(item.id)} {...tab} external={newTab} arrow={!newTab} className="min-h-11 !text-[14px] !text-meta hover:!text-navy">
                {t('helpButton.readMore', 'Read it in the help centre')}
                {newTab && <NewTabIcon />}
              </UnderlineLink>
            </div>
          </div>
        )}
      </div>
    </li>
  );
}

/** The small "opens in a new tab" mark (UnderlineLink's `external` says it to screen readers). */
function NewTabIcon() {
  return <ExternalLink className="ml-1 inline h-3.5 w-3.5 -translate-y-px" aria-hidden="true" />;
}
