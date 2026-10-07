import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Pause, Play } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useMotion } from '@/components/motion/MotionProvider';
import { useInView, useOnScreen } from '@/components/motion/useInView';

/**
 * The harbour "departures" board: a split-flap display of what is leaving the
 * quay next, fed by real data (useDepartureRows: upcoming M3 events with the
 * World Yachting Summit while it is upcoming, recent replays, the newest
 * verified members), set in the harbour-signage face.
 *
 * When the board first scrolls into view every character flips from blank (the
 * top half folds down, then the new bottom half drops; 20–31 ms between two
 * characters, sweeping left to right). Rows flip one after the other, each
 * starting when the previous one is three-quarters done, so only about one row
 * of flaps (≈ 70) is animating at any moment; characters that are blank on
 * both sets are not animated at all. Then it flips to the next set of rows,
 * each set staying fully shown for a few seconds (about 8–10 s per cycle).
 *
 * The rows are split into sets of DIFFERENT rows (6 rows on a 5-line board make
 * two sets of 3, padded with blank lines), never the same list shifted by one.
 *
 * The cycle runs only while the board is on screen and the tab is shown, and
 * stops on hover/focus, with its own pause button and with the global motion
 * pause; under reduced motion the text is static.
 *
 * Each row is a link from the moment the rows are loaded (before the first
 * flip too). Screen readers get one plain sentence per row (sr-only); the flap
 * glyphs are aria-hidden and the list is not a live region, so the cycle never
 * interrupts anyone.
 */
export interface BoardRow {
  id: string;
  /** "27 NOV" */
  date: string;
  title: string;
  place: string;
  status: string;
  href: string;
  kind?: 'event' | 'invitation' | 'replay' | 'member';
}

interface Slots {
  date: number;
  title: number;
  place: number;
  status: number;
}

type Col = keyof Slots;
const COLS: Col[] = ['date', 'title', 'place', 'status'];

const BLANK_ROW = { date: '', title: '', place: '', status: '' };
/** A blank flap keeps its height. */
const NBSP = String.fromCharCode(0xa0);
/** Between two flipping characters of a row. */
const CHAR_MS = 20;
/** One flap's own fold (top half 160 ms, then the bottom half 200 ms after 150 ms). */
const FOLD_MS = 380;
/** Each set stays fully shown at least this long before the next flip starts. */
const DWELL_MS = 3800;

/** Upper case, cut on a word boundary with an ellipsis, padded to `n` slots. */
export function fitBoardText(text: string, n: number): string {
  let s = (text || '').toLocaleUpperCase().replace(/\s+/g, ' ').trim();
  if (s.length > n) {
    const cut = s.slice(0, n - 1);
    const space = cut.lastIndexOf(' ');
    // No dangling "&", "-" or comma before the ellipsis.
    const head = (space > n * 0.5 ? cut.slice(0, space) : cut).replace(/[\s&+,;:·/–—-]+$/, '');
    s = `${head}…`;
  }
  return s.padEnd(n, ' ');
}

type Phase = 'old' | 'flip' | 'new';

/** One column of flaps. `delays[i]` is that character's fold delay, or -1 when it does not change. */
const Flaps = memo(function Flaps({
  text,
  prev,
  phase,
  delays,
  className,
}: {
  text: string;
  prev: string;
  phase: Phase;
  delays: number[];
  className?: string;
}) {
  const shown = phase === 'old' ? prev : text;
  return (
    <span className={cn('inline-flex whitespace-nowrap', className)}>
      {Array.from(shown).map((c, i) => {
        const glyph = c === ' ' ? NBSP : c;
        const d = delays[i] ?? -1;
        if (phase !== 'flip' || d < 0) {
          return (
            <span key={i} className="flap">
              {glyph}
            </span>
          );
        }
        const p = prev[i] ?? ' ';
        const old = p === ' ' ? NBSP : p;
        return (
          <span key={i} className="flap" style={{ '--d': `${d}ms` } as CSSProperties}>
            <span className="flap-half flap-top"><span>{glyph}</span></span>
            <span className="flap-half flap-bottom"><span>{old}</span></span>
            <span className="flap-half flap-fold-top"><span>{old}</span></span>
            <span className="flap-half flap-fold-bottom"><span>{glyph}</span></span>
          </span>
        );
      })}
    </span>
  );
});

interface LineModel {
  cols: Record<Col, string>;
  was: Record<Col, string>;
  delays: Record<Col, number[]>;
  /** ms from the row's own start to its last fold landing (0: nothing changes). */
  duration: number;
  start: number;
}

/**
 * One board line: shows the previous set's text until its turn comes, flips
 * (fold halves mounted only for that window), then rests on the new text.
 */
const BoardLine = memo(function BoardLine({
  model,
  flipId,
  animate,
  slots,
}: {
  model: LineModel;
  flipId: number;
  animate: boolean;
  slots: Slots;
}) {
  const [state, setState] = useState<{ id: number; phase: Phase }>({ id: flipId, phase: 'new' });
  // A flip this line has not started yet still shows the old text (no flash of the new one).
  const phase: Phase = state.id === flipId ? state.phase : animate && model.duration > 0 ? 'old' : 'new';

  useEffect(() => {
    if (!animate || model.duration === 0) {
      setState({ id: flipId, phase: 'new' });
      return;
    }
    setState({ id: flipId, phase: 'old' });
    const t1 = window.setTimeout(() => setState({ id: flipId, phase: 'flip' }), model.start);
    const t2 = window.setTimeout(() => setState({ id: flipId, phase: 'new' }), model.start + model.duration + 40);
    return () => {
      window.clearTimeout(t1);
      window.clearTimeout(t2);
    };
    // The model belongs to this flip: it is read once, when the flip starts.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flipId, animate]);

  return (
    <span className="flex gap-[1.1em]" aria-hidden="true">
      {COLS.map((col) =>
        slots[col] > 0 ? (
          <Flaps
            key={col}
            text={model.cols[col]}
            prev={model.was[col]}
            phase={phase}
            delays={model.delays[col]}
            className={col === 'status' ? '[&_.flap]:text-[#bfe4ea]' : undefined}
          />
        ) : null,
      )}
    </span>
  );
});

export function DepartureBoard({
  rows,
  loading = false,
  pageSize = 5,
  interval = 8000,
  title,
  subtitle,
  footer,
  className,
}: {
  rows: BoardRow[];
  loading?: boolean;
  pageSize?: number;
  /** Minimum time between two flips (each set also stays fully shown for at least ~4 s). */
  interval?: number;
  /** Board heading, e.g. "Departures". */
  title?: string;
  subtitle?: string;
  /** A small line under the rows, e.g. "Updated live · Monaco 43°44′ N". */
  footer?: string;
  className?: string;
}) {
  const { t } = useTranslation();
  const { reduced, still } = useMotion();
  const ref = useRef<HTMLElement>(null);
  // First sight: 30 % of the board in view. Cycle: any part of it on screen, tab shown.
  const seen = useInView(ref, { disabled: reduced, threshold: 0.3 });
  const onScreen = useOnScreen(ref, reduced);
  // Character slots per column, fitted to the board's own width (and font size):
  // the event column takes what the date, place and status leave; under 560 px
  // the place and status move to a plain line under each row.
  const boxRef = useRef<HTMLDivElement>(null);
  const [slots, setSlots] = useState<Slots>({ date: 7, title: 18, place: 0, status: 0 });
  useLayoutEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const compute = () => {
      const cs = getComputedStyle(el);
      const fontSize = parseFloat(cs.fontSize) || 15;
      const cell = fontSize * 0.86; // one flap and its margin
      const gap = fontSize * 1.1;
      const inner = el.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight) - 16; // row padding
      const wide = inner >= 560;
      const next: Slots = { date: 7, title: 0, place: wide ? 11 : 0, status: wide ? 14 : 0 };
      const fixed = (next.date + next.place + next.status) * cell + (wide ? 3 : 1) * gap;
      next.title = Math.max(10, Math.min(40, Math.floor((inner - fixed) / cell)));
      setSlots((prev) =>
        prev.date === next.date && prev.title === next.title && prev.place === next.place && prev.status === next.status ? prev : next,
      );
    };
    compute();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(compute);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Sets of distinct rows, as even as possible: 6 rows on a 5-line board make
  // 3 + 3, 9 rows make 5 + 4. Short sets are padded with blank lines.
  const pages = useMemo(() => {
    const n = rows.length;
    if (n === 0) return [] as BoardRow[][];
    if (n <= pageSize) return [rows];
    const count = Math.ceil(n / pageSize);
    const per = Math.ceil(n / count);
    const out: BoardRow[][] = [];
    for (let p = 0; p < count; p++) out.push(rows.slice(p * per, (p + 1) * per));
    return out.filter((p) => p.length > 0);
  }, [rows, pageSize]);

  // -1 = blank board (before it is seen, or while loading).
  const [page, setPage] = useState(-1);
  const [prevPage, setPrevPage] = useState(-1);
  const [flipId, setFlipId] = useState(0);
  const [userPaused, setUserPaused] = useState(false);
  const [hover, setHover] = useState(false);

  const pageRef = useRef(page);
  pageRef.current = page;
  const show = (next: number) => {
    setPrevPage(pageRef.current);
    setPage(next);
    setFlipId((n) => n + 1);
  };
  const showRef = useRef(show);
  showRef.current = show;

  // First sight (or data arriving while in view): flip from blank to the first set.
  useEffect(() => {
    if (loading || pages.length === 0) return;
    if (reduced) {
      setPage((p) => (p < 0 ? 0 : Math.min(p, pages.length - 1)));
      return;
    }
    if (seen && page < 0) show(0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seen, loading, pages.length, reduced]);

  const current = page >= 0 ? pages[page] ?? [] : [];
  const previous = prevPage >= 0 ? pages[prevPage] ?? [] : [];
  const lines = Array.from({ length: pageSize }, (_, i) => current[i] ?? null);

  // Each line's text, what it replaces, which characters fold (and when), and
  // when its turn comes: row r starts when row r - 1 is three-quarters done.
  const { models, sweep } = useMemo(() => {
    let start = 0;
    let end = 0;
    const out: LineModel[] = lines.map((row, r) => {
      const after = row ?? BLANK_ROW;
      const before = previous[r] ?? BLANK_ROW;
      const cols = {} as Record<Col, string>;
      const was = {} as Record<Col, string>;
      const delays = {} as Record<Col, number[]>;
      let k = 0;
      for (const col of COLS) {
        cols[col] = fitBoardText(after[col], slots[col]);
        was[col] = fitBoardText(before[col], slots[col]);
        delays[col] = Array.from(cols[col]).map((c, i) => {
          if ((was[col][i] ?? ' ') === c) return -1;
          // A steady sweep with a little mechanical jitter (20–31 ms apart).
          const d = k * CHAR_MS + ((k * 7) % 11);
          k += 1;
          return d;
        });
      }
      const duration = k > 0 ? (k - 1) * CHAR_MS + 11 + FOLD_MS : 0;
      const model: LineModel = { cols, was, delays, duration, start };
      end = Math.max(end, start + duration);
      start += Math.round(duration * 0.75);
      return model;
    });
    return { models: out, sweep: end };
    // `lines` and `previous` derive from page / prevPage / pages.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, prevPage, pages, slots, pageSize]);

  // The cycle: the next flip comes once this one is done and has been read.
  const cycling = !still && !userPaused && !hover && onScreen && pages.length > 1 && page >= 0;
  const sweepRef = useRef(sweep);
  sweepRef.current = sweep;
  useEffect(() => {
    if (!cycling) return;
    const wait = Math.max(interval, sweepRef.current + DWELL_MS);
    const timer = window.setTimeout(() => showRef.current((pageRef.current + 1) % pages.length), wait);
    return () => window.clearTimeout(timer);
  }, [cycling, interval, pages.length, flipId]);

  // What links and screen readers get: the rows as soon as they are loaded,
  // even before the first flip has drawn them.
  const linked = page >= 0 ? current : pages[0] ?? [];

  const heads = {
    date: t('brand.board.colDate', 'Date'),
    title: t('brand.board.colTitle', 'Event / member'),
    place: t('brand.board.colPlace', 'Place'),
    status: t('brand.board.colStatus', 'Status'),
  };
  const boardTitle = title ?? t('brand.board.title', 'Departures');

  return (
    <section
      ref={ref}
      aria-label={boardTitle}
      className={cn('flex flex-col overflow-hidden rounded-card bg-navy-deep text-[#f3efe2] shadow-drawer', className)}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      onFocus={() => setHover(true)}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setHover(false);
      }}
    >
      <header className="flex items-center justify-between gap-3 border-b border-white/10 px-4 py-3 sm:px-6">
        <div className="min-w-0">
          <h2 className="font-signage text-[15px] font-semibold uppercase tracking-[0.16em] text-white">{boardTitle}</h2>
          {subtitle && <p className="line-clamp-2 text-xs text-white/65">{subtitle}</p>}
        </div>
        {pages.length > 1 && !still && (
          <button
            type="button"
            onClick={() => setUserPaused((p) => !p)}
            aria-label={userPaused ? t('brand.board.play', 'Resume the board') : t('brand.board.pause', 'Pause the board')}
            title={userPaused ? t('brand.board.play', 'Resume the board') : t('brand.board.pause', 'Pause the board')}
            className="focus-ring grid h-11 w-11 shrink-0 place-items-center rounded-full text-white/80 ring-1 ring-inset ring-white/20 hover:bg-white/10 md:h-9 md:w-9"
          >
            {userPaused ? <Play className="h-4 w-4" aria-hidden="true" /> : <Pause className="h-4 w-4" aria-hidden="true" />}
          </button>
        )}
      </header>

      <div ref={boxRef} className="overflow-hidden px-2 pb-3 pt-2 font-signage text-[13px] font-medium sm:px-4 sm:text-[14px] lg:text-[16px]">
        {/* Column heads: widths in the flaps' own em, small text inside. */}
        <div aria-hidden="true" className="flex gap-[1.1em] px-2 pb-1.5 pt-1">
          {COLS.map((col) =>
            slots[col] > 0 ? (
              <span key={col} style={{ width: slots[col] * 0.86 + 'em' }} className="shrink-0">
                <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-white/55 sm:text-[11px]">{heads[col]}</span>
              </span>
            ) : null,
          )}
        </div>

        <ul aria-live="off">
          {lines.map((row, r) => {
            const target = linked[r] ?? null;
            const body = (
              <>
                {/* Keyed by board width: a new slot count rebuilds the line's flaps. */}
                <BoardLine
                  key={`${slots.title}-${slots.place}`}
                  model={models[r]}
                  flipId={flipId}
                  animate={!reduced}
                  slots={slots}
                />
                {/* Phones: place and status as a plain line under the flaps. */}
                {slots.place === 0 && (
                  <span aria-hidden="true" className="mt-1 block min-h-[16px] pl-[0.2em] font-sans text-[11px] uppercase tracking-[0.08em] text-white/65">
                    {row ? [row.place, row.status].filter(Boolean).join(' · ') : ''}
                  </span>
                )}
              </>
            );
            return (
              <li key={r} className="border-t border-white/[0.07] first:border-t-0">
                {target ? (
                  <Link to={target.href} className="focus-ring block rounded-field px-2 py-1.5 transition-colors hover:bg-white/[0.06]">
                    <span className="sr-only">
                      {[target.date, target.title, target.place, target.status].filter(Boolean).join(' – ')}
                    </span>
                    {body}
                  </Link>
                ) : (
                  <div className="px-2 py-1.5">{body}</div>
                )}
              </li>
            );
          })}
        </ul>
        {!loading && rows.length === 0 && (
          <p className="px-2 pt-2 font-sans text-sm text-white/70">{t('brand.board.empty', 'Nothing announced yet.')}</p>
        )}
      </div>
      {footer && (
        <p className="mt-auto border-t border-white/10 px-4 py-2.5 font-signage text-[12px] font-medium uppercase tracking-[0.12em] text-white/60 sm:px-6">
          <span aria-hidden="true" className="mr-2 inline-block h-1.5 w-1.5 rounded-full bg-[#7fc8d4] align-middle" />
          {footer}
        </p>
      )}
    </section>
  );
}
