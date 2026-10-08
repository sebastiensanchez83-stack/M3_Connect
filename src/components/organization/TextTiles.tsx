import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ArrowLeft, ArrowRight, type LucideIcon } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { CardShell } from '@/components/brand/CardShell';
import { Eyebrow } from '@/components/brand/Eyebrow';
import { cn } from '@/lib/utils';

/**
 * Long free texts as a grid of tiles (company pages, Oct 2026). Victor: marinas such
 * as Ayla had page after page of text, "it should be split into blocks, more
 * attractive and consistent with the platform design".
 *
 * Each tile shows an icon, the title and the first three lines of its text (white
 * space folded, so a text that opens with a short line still fills them). When the
 * text is longer than that, the whole tile becomes one button (the card grammar of
 * the kit: lift, gold line under "Read more", small arrow) that opens the full text
 * in a dialog: focus trapped, Esc closes, the title is the dialog's heading, and
 * Previous / Next walk through the other texts of the same group without closing.
 * Paragraphs (blank lines) are kept in the dialog; an optional picture leads it.
 */
export interface TextTileItem {
  key: string;
  title: string;
  text: string;
  icon: LucideIcon;
  /** A picture shown at the top of the full text (e.g. an evidence photo). */
  image?: string | null;
  imageAlt?: string;
}

export function TextTiles({
  items,
  source,
  className,
}: {
  items: TextTileItem[];
  /** Small line above the title in the dialog ("Smart Marina 2026 submission"). */
  source?: string;
  className?: string;
}) {
  const [open, setOpen] = useState<number | null>(null);
  const visible = items.filter((it) => it.text.trim().length > 0);
  if (visible.length === 0) return null;
  const current = open !== null ? visible[open] ?? null : null;

  return (
    <>
      <ul className={cn('grid gap-4 sm:grid-cols-2 lg:grid-cols-3 md:gap-5', className)}>
        {visible.map((it, i) => (
          <li key={it.key} className="flex min-w-0">
            <Tile item={it} onOpen={() => setOpen(i)} />
          </li>
        ))}
      </ul>
      <TextDialog
        item={current}
        source={source}
        index={open ?? 0}
        total={visible.length}
        onIndex={setOpen}
        onClose={() => setOpen(null)}
        prevTitle={open !== null && open > 0 ? visible[open - 1].title : null}
        nextTitle={open !== null && open < visible.length - 1 ? visible[open + 1].title : null}
      />
    </>
  );
}

function Tile({ item, onOpen }: { item: TextTileItem; onOpen: () => void }) {
  const { t } = useTranslation();
  const textRef = useRef<HTMLParagraphElement>(null);
  const [clamped, setClamped] = useState(false);
  const preview = item.text.replace(/\s+/g, ' ').trim();

  // "Read more" only when the three lines really cut the text: measured, and again
  // whenever the tile's width changes.
  useLayoutEffect(() => {
    const el = textRef.current;
    if (!el) return;
    const measure = () => setClamped(el.scrollHeight > el.clientHeight + 1 || item.text.includes('\n\n'));
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [item.text]);

  const Icon = item.icon;
  return (
    <CardShell interactive={clamped} className="w-full p-6">
      <span aria-hidden="true" className="grid h-11 w-11 shrink-0 place-items-center rounded-field bg-foam text-teal">
        <Icon className="h-5 w-5" strokeWidth={1.75} />
      </span>
      <h3 className="mt-4 text-card-title text-navy">{item.title}</h3>
      <p ref={textRef} className="mt-2 line-clamp-3 text-[15px] leading-6 text-ink">{preview}</p>
      {clamped && (
        <div className="mt-auto pt-4">
          <button
            type="button"
            onClick={onOpen}
            aria-haspopup="dialog"
            className="stretched-link inline-flex items-center rounded-sm text-[14px] font-semibold leading-5 text-navy focus-visible:outline-none"
          >
            <span className="card-ul">{t('orgProfile.tiles.readMore', 'Read more')}</span>
            <span className="sr-only">: {item.title}</span>
            <ArrowRight className="card-arrow" strokeWidth={2.25} aria-hidden="true" />
          </button>
        </div>
      )}
    </CardShell>
  );
}

function TextDialog({
  item, source, index, total, onIndex, onClose, prevTitle, nextTitle,
}: {
  item: TextTileItem | null;
  source?: string;
  index: number;
  total: number;
  onIndex: (i: number) => void;
  onClose: () => void;
  prevTitle: string | null;
  nextTitle: string | null;
}) {
  const { t } = useTranslation();
  const bodyRef = useRef<HTMLDivElement>(null);
  // Back to the top of the text when walking to the next one.
  useEffect(() => { bodyRef.current?.scrollTo({ top: 0 }); }, [index]);
  const go = useCallback((delta: number) => {
    const next = index + delta;
    if (next >= 0 && next < total) onIndex(next);
  }, [index, total, onIndex]);

  const paragraphs = item ? item.text.trim().split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean) : [];
  const Icon = item?.icon;

  return (
    <Dialog open={!!item} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="flex max-h-[88vh] w-[calc(100vw-1.5rem)] max-w-2xl flex-col gap-0 overflow-hidden rounded-card border-rule p-0 sm:rounded-card">
        {item && (
          <>
            <div ref={bodyRef} className="min-h-0 flex-1 overflow-y-auto px-6 pb-6 pt-7 sm:px-8 sm:pt-8">
              <div className="flex items-center gap-3 pr-8">
                {Icon && (
                  <span aria-hidden="true" className="grid h-10 w-10 shrink-0 place-items-center rounded-field bg-foam text-teal">
                    <Icon className="h-5 w-5" strokeWidth={1.75} />
                  </span>
                )}
                {source && <Eyebrow>{source}</Eyebrow>}
              </div>
              <DialogTitle className="mt-4 text-h3 text-navy">{item.title}</DialogTitle>
              <DialogDescription className="sr-only">
                {t('orgProfile.tiles.position', '{{n}} of {{total}}', { n: index + 1, total })}
              </DialogDescription>
              {item.image && (
                <figure className="mt-5 overflow-hidden rounded-[12px] bg-chip">
                  <img src={item.image} alt={item.imageAlt ?? ''} className="max-h-[320px] w-full object-cover" />
                </figure>
              )}
              <div className="mt-5 space-y-4 text-body text-ink">
                {paragraphs.map((p, i) => (
                  <p key={i} className="whitespace-pre-line">{p}</p>
                ))}
              </div>
            </div>
            {total > 1 && (
              <div className="flex items-center justify-between gap-3 border-t border-rule bg-page px-4 py-3 sm:px-6">
                <button
                  type="button"
                  onClick={() => go(-1)}
                  disabled={!prevTitle}
                  className="uline uline--plain min-w-0 !text-[14px] disabled:pointer-events-none disabled:opacity-0"
                >
                  <ArrowLeft className="h-4 w-4 shrink-0" aria-hidden="true" />
                  <span className="sr-only">{t('orgProfile.tiles.previous', 'Previous')}: </span>
                  <span className="uline-t truncate">{prevTitle ?? ''}</span>
                </button>
                <span className="tabular shrink-0 text-[13px] text-meta" aria-hidden="true">{index + 1} / {total}</span>
                <button
                  type="button"
                  onClick={() => go(1)}
                  disabled={!nextTitle}
                  className="uline uline--plain min-w-0 justify-end !text-[14px] disabled:pointer-events-none disabled:opacity-0"
                >
                  <span className="sr-only">{t('orgProfile.tiles.next', 'Next')}: </span>
                  <span className="uline-t truncate">{nextTitle ?? ''}</span>
                  <ArrowRight className="h-4 w-4 shrink-0" aria-hidden="true" />
                </button>
              </div>
            )}
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
