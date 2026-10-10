import { useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ExternalLink } from 'lucide-react';
import { SearchField } from '@/components/brand/SearchField';
import { useMediaQuery } from '@/components/motion/useReducedMotion';
import { cn } from '@/lib/utils';
import { buildHelpSections, helpHref } from './helpContent';
import { buildHelpIndex, helpQueryWords, searchHelp, type HelpIndexEntry } from './helpSearch';
import type { HelpPlace } from './helpPlaces';

/**
 * The inside of the Help button's panel (HelpLauncher.tsx), loaded the first
 * time it is needed: a search through the whole help centre (helpSearch.ts,
 * the same search as /help) and, while nothing is typed, the three questions
 * of this page. Each question opens its answer on /help (/help#<id>); on a page
 * with a form, in a new tab.
 */

/** More found answers than this: the first ones, then "Open the help centre" says the rest. */
const MAX_RESULTS = 5;

export function HelpLauncherPanel({ place, panelRef }: { place: HelpPlace; panelRef: RefObject<HTMLDivElement> }) {
  const { t } = useTranslation();
  const wide = useMediaQuery('(min-width: 640px)');
  const sections = useMemo(() => buildHelpSections(t), [t]);
  const index = useMemo(() => buildHelpIndex(sections), [sections]);
  const byId = useMemo(() => new Map(index.map((entry) => [entry.item.id, entry])), [index]);
  const [query, setQuery] = useState('');
  const listRef = useRef<HTMLUListElement>(null);

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

  const pageQuestions = place.ids.map((id) => byId.get(id)).filter((e): e is HelpIndexEntry => !!e);
  const shown = searching ? found.slice(0, MAX_RESULTS) : pageQuestions;

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

  return (
    <div className="mt-3">
      <SearchField
        tone="light"
        size={wide ? 'md' : 'lg'}
        value={query}
        onValueChange={setQuery}
        // Enter: to the first answer found.
        onSearch={() => listRef.current?.querySelector<HTMLAnchorElement>('a')?.focus()}
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
            <QuestionLink key={entry.item.id} entry={entry} newTab={!!place.keepPage} />
          ))}
        </ul>
      )}

      {searching && found.length > MAX_RESULTS && (
        <p className="mt-2 text-[14px] leading-5 text-meta">
          {t('helpButton.more', { count: found.length - MAX_RESULTS, defaultValue_one: '{{count}} more answer in the help centre.', defaultValue_other: '{{count}} more answers in the help centre.' })}
        </p>
      )}
    </div>
  );
}

function QuestionLink({ entry, newTab }: { entry: HelpIndexEntry; newTab: boolean }) {
  const { t } = useTranslation();
  const Icon = entry.section.icon;
  return (
    <li>
      <Link
        to={helpHref(entry.item.id)}
        {...(newTab ? { target: '_blank', rel: 'noopener' } : {})}
        className={cn(
          'group -mx-2 flex min-h-11 items-start gap-3 rounded-field px-2 py-2 text-left transition-colors hover:bg-page',
          'focus:outline-none focus-visible:[box-shadow:inset_0_0_0_2px_#0b2653]',
        )}
      >
        <span aria-hidden="true" className="mt-px grid h-8 w-8 shrink-0 place-items-center rounded-field bg-chip text-navy">
          <Icon className="h-4 w-4" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-[15px] font-semibold leading-5 text-navy [overflow-wrap:anywhere]">
            <span className="card-ul">{entry.item.q}</span>
            {newTab && (
              <>
                <ExternalLink className="ml-1 inline h-3.5 w-3.5 -translate-y-px text-meta" aria-hidden="true" />
                <span className="sr-only"> {t('helpButton.newTab', '(opens in a new tab)')}</span>
              </>
            )}
          </span>
          <span className="mt-0.5 block text-[13px] leading-4 text-meta">{entry.section.title}</span>
        </span>
      </Link>
    </li>
  );
}
