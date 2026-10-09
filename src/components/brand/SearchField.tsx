import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Compass, Search, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useMotion } from '@/components/motion/MotionProvider';
import { useOnScreen } from '@/components/motion/useInView';
import type { SuggestGroup, SuggestScope } from '@/lib/searchSuggestions';
import { SuggestionPopup, WANTED_ROOM, roomAround, useAnchoredPlacement, useSuggestionSections, type SuggestOption } from './SearchSuggestions';

export { ALL_SUGGESTIONS, type SuggestGroup } from '@/lib/searchSuggestions';

/**
 * The light grey of every hint in the field, typed or static, well apart from
 * the ink of a real search: the design audit of 8 Oct 2026 read the typed
 * examples ("Croatia", "Marina software") as text already in the field.
 */
const PLACEHOLDER_TONE = 'placeholder:text-meta/75';
const NO_GROUPS: readonly SuggestGroup[] = [];
const TYPED_TONE = 'text-meta/75';

/**
 * The search pill of the refonte: a white pill with a gold compass at its left,
 * the field, and a round navy button with a magnifier that turns gold on hover.
 * Example searches are typed into the placeholder, in the placeholder's light
 * grey, letter by letter (55 ms a letter, a 1.6 s pause, erased at 22 ms a
 * letter), each example once: after one round the static placeholder stays.
 * The typing stops for good as soon as the field gets focus or holds text, runs
 * only while the field is on screen, and never runs under reduced motion or
 * while motion is paused (the static placeholder shows).
 *
 * Submitting goes to the directory search (/directory?q=…) unless `onSearch`
 * is given. A real <form role="search">, so Enter on a phone keyboard works.
 *
 * Pages that filter as you type (the directory itself) pass `value` and
 * `onValueChange`: the field is then controlled and gets a clear button.
 * `size="md"` (48 px) fits a toolbar; `size="lg"` (56 px) a hero. Both are
 * optional; without them the field behaves as before.
 *
 * `suggest` (Victor, 9 Oct 2026: "typing a name should drop down suggestions")
 * lists, from the second letter, the companies, articles, events and themes
 * that match, grouped, with a last line "See all results for 'x'" that does
 * what Enter does (SearchSuggestions.tsx). The field is then an ARIA combobox:
 * Up and Down move through the options, Enter opens the one chosen (or searches
 * when none is), Esc closes the list; a click elsewhere closes it too. Each page
 * asks for the groups it is about (the library: articles only). On a page that
 * filters as you type, the list only opens when it has something to suggest
 * (the page's own results already answer the rest). When the list opens with
 * little room under the field, the page scrolls up a little to make room.
 */
export function SearchField({
  examples,
  placeholder,
  label,
  action = '/directory',
  param = 'q',
  onSearch,
  tone = 'onPhoto',
  className,
  value: controlledValue,
  onValueChange,
  size = 'lg',
  inputId,
  suggest,
  suggestScope = 'directory',
}: {
  /** Suggestions as the visitor types (2+ letters): which groups, in this order. None by default. */
  suggest?: readonly SuggestGroup[];
  /** Companies suggested: the whole directory (default) or the event sponsors only (/partners). */
  suggestScope?: SuggestScope;
  /** Controlled value (filter-as-you-type pages). Leave undefined for the usual uncontrolled field. */
  value?: string;
  /** Called on every keystroke and on clear, with the field's new value. */
  onValueChange?: (value: string) => void;
  /** 'lg' 56 px (default, heroes); 'md' 48 px (toolbars). */
  size?: 'md' | 'lg';
  /** id of the <input> (default: generated). */
  inputId?: string;
  /** Example searches to type, e.g. "EV chargers in the Mediterranean". Empty = no typing. */
  examples?: string[];
  /** Static placeholder (focus, reduced motion, pause). */
  placeholder?: string;
  /** Accessible label of the field. */
  label?: string;
  /** Route that receives the query. */
  action?: string;
  param?: string;
  /** Replaces the navigation (e.g. filter in place). */
  onSearch?: (query: string) => void;
  /** 'onPhoto' = white pill over a hero; 'light' = bordered pill on white. */
  tone?: 'onPhoto' | 'light';
  className?: string;
}) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const { still, reduced } = useMotion();
  const generatedId = useId();
  const id = inputId ?? generatedId;
  const inputRef = useRef<HTMLInputElement>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const pillRef = useRef<HTMLDivElement>(null);
  const popupRef = useRef<HTMLDivElement>(null);
  const onScreen = useOnScreen(formRef, reduced || !examples?.length);
  const [innerValue, setInnerValue] = useState('');
  const controlled = controlledValue !== undefined;
  const value = controlled ? controlledValue : innerValue;
  const setValue = (next: string) => {
    if (!controlled) setInnerValue(next);
    onValueChange?.(next);
  };
  const [focused, setFocused] = useState(false);
  const [stopped, setStopped] = useState(false);
  const [typed, setTyped] = useState('');
  /** The next example to type: kept across pauses (off screen, background tab), so the round is never restarted. */
  const nextExample = useRef(0);

  const staticPlaceholder = placeholder ?? t('brand.search.placeholder', 'Search marinas and service providers');
  const typing = !!examples?.length && !still && !stopped && !focused && onScreen && value === '';

  useEffect(() => {
    if (!typing || !examples?.length) return;
    let alive = true;
    let timer = 0;
    let pos = 0;
    let deleting = false;
    const step = () => {
      if (!alive) return;
      const ex = nextExample.current;
      if (ex >= examples.length) {
        setStopped(true);
        return;
      }
      const word = examples[ex];
      if (!deleting) {
        pos += 1;
        setTyped(word.slice(0, pos));
        if (pos >= word.length) {
          deleting = true;
          timer = window.setTimeout(step, 1600);
          return;
        }
        timer = window.setTimeout(step, 55);
      } else {
        pos -= 1;
        setTyped(word.slice(0, pos));
        if (pos <= 0) {
          deleting = false;
          nextExample.current = ex + 1;
          // One round through the examples, then the static placeholder for good.
          if (nextExample.current >= examples.length) {
            setStopped(true);
            return;
          }
          timer = window.setTimeout(step, 450);
          return;
        }
        timer = window.setTimeout(step, 22);
      }
    };
    timer = window.setTimeout(step, 600);
    return () => {
      alive = false;
      window.clearTimeout(timer);
    };
  }, [typing, examples]);

  // ── Suggestions ──
  const suggestOn = !!suggest?.length;
  /** Focus is in the field (dropped 150 ms after a blur, so a tap on an option still lands). */
  const [inUse, setInUse] = useState(false);
  const blurTimer = useRef(0);
  /** Closed by Esc, a choice, Tab or a press elsewhere; typing opens it again. */
  const [dismissed, setDismissed] = useState(false);
  const [active, setActive] = useState(-1);
  const { sections, loading, settled, ready } = useSuggestionSections({
    query: value,
    groups: suggest ?? NO_GROUPS,
    scope: suggestScope,
    enabled: suggestOn && inUse,
  });
  const listboxId = `${id}-suggestions`;
  const optionId = useCallback((i: number) => `${id}-option-${i}`, [id]);
  /** Enter goes to the directory search (no onSearch): the last line says so. */
  const toDirectory = !onSearch && action === '/directory';
  const seeAll = useMemo<SuggestOption>(
    () => ({
      id: 'see-all',
      group: 'all',
      label: toDirectory
        ? t('brand.suggest.seeAllDirectory', { query: value.trim(), defaultValue: 'Search the directory for “{{query}}”' })
        : t('brand.suggest.seeAll', { query: value.trim(), defaultValue: 'See all results for “{{query}}”' }),
      visual: { kind: 'icon', icon: Search },
    }),
    [t, value, toDirectory],
  );
  const options = useMemo(() => [...sections.flatMap((s) => s.options), seeAll], [sections, seeAll]);
  const suggestionCount = options.length - 1;
  /** The page filters its own list as you type (directory, library, sponsors). */
  const filtersInPlace = controlled && !!onValueChange;
  // There, the page's results already answer: the list only opens with something to suggest.
  const open = suggestOn && inUse && !dismissed && ready && (!filtersInPlace || suggestionCount > 0);
  const place = useAnchoredPlacement(pillRef, open);
  /** The list is on screen (it waits while the field is out of sight): what the combobox says. */
  const expanded = open && place !== null;

  // The list opens with little room under the field (a hero low on a laptop screen, a phone with its
  // keyboard out): the page scrolls up a little, never hiding the field under the header.
  const openedOnce = useRef(false);
  useEffect(() => {
    if (!open) {
      openedOnce.current = false;
      return;
    }
    if (openedOnce.current) return;
    openedOnce.current = true;
    const el = pillRef.current;
    if (!el) return;
    const room = roomAround(el);
    if (room.below >= WANTED_ROOM) return;
    const by = Math.min(room.above, WANTED_ROOM - room.below);
    if (by > 8) window.scrollBy({ top: by, behavior: reduced ? 'auto' : 'smooth' });
  }, [open, reduced]);

  // A new search starts with no option chosen (Enter then searches); a shorter list keeps the choice in range.
  useEffect(() => setActive(-1), [value]);
  useEffect(() => setActive((i) => (i >= options.length ? options.length - 1 : i)), [options.length]);
  useEffect(() => () => window.clearTimeout(blurTimer.current), []);
  // Another page: the list closes.
  useEffect(() => {
    setDismissed(true);
    setActive(-1);
  }, [pathname]);
  // A press anywhere outside the field and the list closes it.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      const target = e.target as Node | null;
      if (formRef.current?.contains(target) || popupRef.current?.contains(target)) return;
      setDismissed(true);
    };
    document.addEventListener('pointerdown', onDown, true);
    return () => document.removeEventListener('pointerdown', onDown, true);
  }, [open]);

  const runSearch = () => {
    const q = value.trim();
    if (onSearch) {
      onSearch(q);
      return;
    }
    navigate(q ? `${action}?${param}=${encodeURIComponent(q)}` : action);
  };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setDismissed(true);
    runSearch();
  };

  const choose = (option: SuggestOption) => {
    setDismissed(true);
    setActive(-1);
    if (!option.href) {
      runSearch();
      return;
    }
    // The phone keyboard goes away with the field's focus.
    inputRef.current?.blur();
    navigate(option.href);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!suggestOn) return;
    const n = options.length;
    switch (e.key) {
      case 'ArrowDown':
        if (!ready || (filtersInPlace && suggestionCount === 0)) return;
        e.preventDefault();
        if (!expanded) {
          setDismissed(false);
          setActive(0);
          return;
        }
        setActive((i) => (i + 1 >= n ? 0 : i + 1));
        return;
      case 'ArrowUp':
        if (!expanded) return;
        e.preventDefault();
        setActive((i) => (i <= 0 ? n - 1 : i - 1));
        return;
      case 'Enter':
        if (expanded && active >= 0 && options[active]) {
          e.preventDefault();
          choose(options[active]);
        }
        return;
      case 'Escape':
        if (expanded) {
          // The list closes; the text stays (a second Esc clears the field, as browsers do).
          e.preventDefault();
          setDismissed(true);
          setActive(-1);
        }
        return;
      case 'Tab':
        setDismissed(true);
        return;
      default:
    }
  };

  const onPhoto = tone === 'onPhoto';
  const md = size === 'md';

  return (
    <form ref={formRef} role="search" onSubmit={submit} className={cn('relative', className)}>
      <label htmlFor={id} className="sr-only">
        {label ?? t('brand.search.label', 'Search the directory')}
      </label>
      <div
        ref={pillRef}
        className={cn(
          'flex items-center gap-2 rounded-full pl-5 pr-1.5 transition-[border-color,box-shadow] duration-300 ease-out-smc',
          md ? 'h-12' : 'h-14',
          onPhoto
            // A gold ring on focus: visible against the navy hero.
            ? 'border-2 border-white bg-white text-navy focus-within:border-gold focus-within:shadow-[0_0_0_4px_rgba(215,166,71,.35)]'
            // #6b7588 edge: 4.6:1 against white and the page grey.
            : 'border border-checkbox bg-white text-navy focus-within:border-navy focus-within:shadow-focus',
        )}
      >
        <Compass className="h-5 w-5 shrink-0 text-gold-hover" aria-hidden="true" />
        <div className="relative min-w-0 flex-1">
          <input
            ref={inputRef}
            id={id}
            type="search"
            enterKeyHint="search"
            value={value}
            onChange={(e) => {
              setValue(e.target.value);
              if (e.target.value) setStopped(true);
              setDismissed(false);
            }}
            onFocus={() => {
              setFocused(true);
              setStopped(true);
              window.clearTimeout(blurTimer.current);
              setInUse(true);
              setDismissed(false);
            }}
            onBlur={() => {
              setFocused(false);
              window.clearTimeout(blurTimer.current);
              blurTimer.current = window.setTimeout(() => setInUse(false), 150);
            }}
            onKeyDown={onKeyDown}
            // A click in the field brings a closed list back (after Esc, a choice or a click elsewhere).
            onClick={() => {
              if (!suggestOn) return;
              window.clearTimeout(blurTimer.current);
              setInUse(true);
              setDismissed(false);
            }}
            role={suggestOn ? 'combobox' : undefined}
            aria-autocomplete={suggestOn ? 'list' : undefined}
            aria-expanded={suggestOn ? expanded : undefined}
            aria-controls={expanded ? listboxId : undefined}
            aria-activedescendant={expanded && active >= 0 ? optionId(active) : undefined}
            placeholder={typing ? '' : staticPlaceholder}
            autoComplete="off"
            className={cn(
              'w-full bg-transparent text-base text-ink outline-none [&::-webkit-search-cancel-button]:hidden',
              PLACEHOLDER_TONE,
              md ? 'h-10' : 'h-12',
            )}
          />
          {typing && (
            <span aria-hidden="true" className={cn('pointer-events-none absolute inset-y-0 left-0 flex items-center truncate text-base', TYPED_TONE)}>
              {typed}
              <span className="typed-caret ml-px inline-block h-5 w-px bg-meta/50" />
            </span>
          )}
        </div>
        {controlled && value !== '' && (
          <button
            type="button"
            onClick={() => {
              setValue('');
              inputRef.current?.focus();
            }}
            aria-label={t('brand.search.clear', 'Clear the search')}
            // 32 px to look at, 44 px to touch.
            className="relative grid h-8 w-8 shrink-0 place-items-center rounded-pill text-meta transition-colors before:absolute before:-inset-1.5 before:content-[''] hover:bg-chip hover:text-navy focus-visible:shadow-focus focus-visible:outline-none"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        )}
        <button
          type="submit"
          aria-label={t('brand.search.submit', 'Search')}
          title={t('brand.search.submit', 'Search')}
          className={cn(
            'grid shrink-0 place-items-center rounded-full bg-navy text-white transition-colors [transition-duration:0.4s] ease-out-smc hover:bg-gold hover:text-navy focus-visible:bg-gold focus-visible:text-navy focus-visible:shadow-focus focus-visible:outline-none',
            md ? 'h-9 w-9' : 'h-11 w-11',
          )}
        >
          <Search className="h-5 w-5" aria-hidden="true" />
        </button>
      </div>
      {suggestOn && (
        <>
          {/* Said once the list has settled: how many suggestions there are. */}
          <span className="sr-only" role="status" aria-live="polite" aria-atomic="true">
            {expanded && settled
              ? suggestionCount > 0
                ? t('brand.suggest.count', { count: suggestionCount, defaultValue_one: '{{count}} suggestion', defaultValue_other: '{{count}} suggestions' })
                : t('brand.suggest.noneShort', 'No suggestions')
              : ''}
          </span>
          <SuggestionPopup
            place={open ? place : null}
            popupRef={popupRef}
            listboxId={listboxId}
            optionId={optionId}
            sections={sections}
            seeAll={seeAll}
            query={value}
            activeIndex={active}
            loading={loading}
            settled={settled}
            label={t('brand.suggest.label', 'Suggestions')}
            onChoose={choose}
            onActivate={setActive}
          />
        </>
      )}
    </form>
  );
}
