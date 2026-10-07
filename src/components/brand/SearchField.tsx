import { useEffect, useId, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Search, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useMotion } from '@/components/motion/MotionProvider';
import { useOnScreen } from '@/components/motion/useInView';

/**
 * The directory search, with a plain magnifier (no sparkle: there is no AI
 * behind it) and an optional typed placeholder: example searches appear
 * letter by letter, pause, and give way to the next one. The typing stops for
 * good as soon as the field gets focus or holds text, and never runs under
 * reduced motion or while motion is paused (the static placeholder shows).
 *
 * Submitting goes to the directory search (/directory?q=…) unless `onSearch`
 * is given. A real <form role="search">, so Enter on a phone keyboard works.
 * A field, not a pill: 12 px corners. In the hero (size lg) the submit is a
 * labelled tide button ("Search"); in a toolbar (size md) the magnifier itself
 * is the submit button. The typing runs only while the field is on screen.
 *
 * Pages that filter as you type (the directory itself) pass `value` and
 * `onValueChange`: the field is then controlled and gets a clear button.
 * `size="md"` (48 px) fits a toolbar. Both are optional; without them the
 * field behaves as before.
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
}: {
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
  /** 'onPhoto' = white pill over a hero; 'light' = bordered field on white. */
  tone?: 'onPhoto' | 'light';
  className?: string;
}) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { still, reduced } = useMotion();
  const generatedId = useId();
  const id = inputId ?? generatedId;
  const inputRef = useRef<HTMLInputElement>(null);
  const formRef = useRef<HTMLFormElement>(null);
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

  const staticPlaceholder = placeholder ?? t('brand.search.placeholder', 'Search marinas and service providers');
  const typing = !!examples?.length && !still && !stopped && !focused && onScreen && value === '';

  useEffect(() => {
    if (!typing || !examples?.length) return;
    let alive = true;
    let timer = 0;
    let ex = 0;
    let pos = 0;
    let deleting = false;
    const step = () => {
      if (!alive) return;
      const word = examples[ex % examples.length];
      if (!deleting) {
        pos += 1;
        setTyped(word.slice(0, pos));
        if (pos >= word.length) {
          deleting = true;
          timer = window.setTimeout(step, 1700);
          return;
        }
        timer = window.setTimeout(step, 55 + ((pos * 13) % 40));
      } else {
        pos -= 1;
        setTyped(word.slice(0, pos));
        if (pos <= 0) {
          deleting = false;
          ex += 1;
          timer = window.setTimeout(step, 420);
          return;
        }
        timer = window.setTimeout(step, 28);
      }
    };
    timer = window.setTimeout(step, 900);
    return () => {
      alive = false;
      window.clearTimeout(timer);
    };
  }, [typing, examples]);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const q = value.trim();
    if (onSearch) {
      onSearch(q);
      return;
    }
    navigate(q ? `${action}?${param}=${encodeURIComponent(q)}` : action);
  };

  const onPhoto = tone === 'onPhoto';
  const md = size === 'md';

  return (
    <form ref={formRef} role="search" onSubmit={submit} className={cn('relative', className)}>
      <label htmlFor={id} className="sr-only">
        {label ?? t('brand.search.label', 'Search the directory')}
      </label>
      <div
        className={cn(
          'flex items-center gap-2 rounded-field transition-shadow',
          md ? 'h-12 pl-1 pr-1.5' : 'h-14 pl-4 pr-1.5',
          onPhoto
            // A solid gold ring on focus: 7:1 against the navy hero.
            ? 'bg-white text-navy focus-within:shadow-[0_0_0_3px_#d7a647]'
            // #6b7588 edge: 4.6:1 against white and the page grey.
            : 'border border-checkbox bg-white text-navy focus-within:border-navy focus-within:shadow-focus',
        )}
      >
        {md ? (
          // In a toolbar the magnifier is the submit button.
          <button
            type="submit"
            aria-label={t('brand.search.submit', 'Search')}
            title={t('brand.search.submit', 'Search')}
            className="grid h-11 w-11 shrink-0 place-items-center rounded-[10px] text-navy transition-colors hover:bg-chip focus-visible:shadow-focus focus-visible:outline-none md:h-10 md:w-10"
          >
            <Search className="h-5 w-5" aria-hidden="true" />
          </button>
        ) : (
          <Search className="h-5 w-5 shrink-0 text-meta" aria-hidden="true" />
        )}
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
            }}
            onFocus={() => {
              setFocused(true);
              setStopped(true);
            }}
            onBlur={() => setFocused(false)}
            placeholder={typing ? '' : staticPlaceholder}
            autoComplete="off"
            className={cn(
              'w-full bg-transparent text-base text-ink outline-none placeholder:text-meta [&::-webkit-search-cancel-button]:hidden',
              md ? 'h-10' : 'h-12',
            )}
          />
          {typing && (
            <span aria-hidden="true" className="pointer-events-none absolute inset-y-0 left-0 flex items-center truncate text-base text-meta">
              {typed}
              <span className="typed-caret ml-px inline-block h-5 w-px bg-navy/70" />
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
        {!md && (
          <button
            type="submit"
            className="tide inline-flex h-11 shrink-0 items-center gap-2 rounded-[10px] bg-navy px-4 text-[15px] font-semibold text-white [--tide-fg-hover:rgb(11_38_83)] [--tide-fill:rgb(215_166_71)] focus-visible:shadow-focus focus-visible:outline-none sm:px-5"
          >
            {t('brand.search.submit', 'Search')}
          </button>
        )}
      </div>
    </form>
  );
}
