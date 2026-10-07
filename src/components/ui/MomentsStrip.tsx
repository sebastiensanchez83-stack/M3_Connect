import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ArrowRight } from 'lucide-react';
import { SM26_MOMENTS } from '@/lib/siteMedia';
import { cn } from '@/lib/utils';

/**
 * "Relive SM26": six moments from Smart & Sustainable Marina Rendezvous 2026,
 * shown as a mosaic on desktop (the first picture twice as large) and a
 * sideways scroller on phones.
 *
 * It exists to make the platform feel inhabited: the people, the stands, the
 * workshops and the prize-giving are the network the site is selling. The
 * pictures are web-sized copies of the official event photos (mesi, Liam).
 */
export function MomentsStrip({ className }: { className?: string }) {
  const { t } = useTranslation();
  return (
    <section className={cn('py-16', className)} aria-labelledby="sm26-moments-heading">
      <div className="container mx-auto px-4">
        <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-secondary-dark">
              {t('sm26Moments.eyebrow', '20–21 September 2026 · Yacht Club de Monaco')}
            </p>
            <h2 id="sm26-moments-heading" className="mt-1 text-2xl font-bold text-primary sm:text-3xl">
              {t('sm26Moments.title', 'Relive the Monaco Smart & Sustainable Marina Rendezvous')}
            </h2>
          </div>
          <Link
            to="/events"
            className="inline-flex min-h-10 items-center gap-1 text-sm font-medium text-primary hover:underline underline-offset-2"
          >
            {t('sm26Moments.cta', 'See upcoming events')}
            <ArrowRight className="h-4 w-4" aria-hidden="true" />
          </Link>
        </div>

        {/* Phones: a sideways scroller. md+: a mosaic, first picture 2×2. */}
        <ul className="no-scrollbar -mx-4 flex snap-x scroll-px-4 gap-3 overflow-x-auto px-4 md:mx-0 md:grid md:grid-cols-4 md:grid-rows-2 md:overflow-visible md:px-0">
          {SM26_MOMENTS.map((m, i) => (
            <li
              key={m.key}
              className={cn(
                'relative w-64 shrink-0 snap-start overflow-hidden rounded-xl bg-primary/5 md:w-auto',
                i === 0 ? 'aspect-[3/2] md:col-span-2 md:row-span-2 md:aspect-auto' : 'aspect-[3/2]',
                // The mosaic holds one 2×2 + four singles; the sixth stays in the phone scroller.
                i > 4 && 'md:hidden',
              )}
            >
              <img
                src={m.src}
                alt={t(`sm26Moments.alt.${m.key}`, m.altFallback)}
                loading="lazy"
                decoding="async"
                className="h-full w-full object-cover transition-transform duration-500 hover:scale-105"
              />
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
