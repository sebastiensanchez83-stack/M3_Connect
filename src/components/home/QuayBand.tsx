import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';
import { DepartureBoard } from '@/components/brand/DepartureBoard';
import { useDepartureRows } from '@/components/brand/useDepartureRows';
import { FlapFigure } from '@/components/brand/FlapFigure';
import { Eyebrow } from '@/components/brand/Eyebrow';
import { Graticule } from '@/components/motion/Graticule';
import { Reveal, RevealGroup } from '@/components/motion/Reveal';

/**
 * "Bord de quai": right under the waterline hero, the harbour departures board
 * (upcoming M3 events, replays, new members — real data) and, beside it, the
 * network's live figures on a chart graticule, set on split-flap tiles like the
 * board. From md up the hero's pontoon tag hangs over the top of the figures
 * column, so that column starts lower; the two columns share their bottom
 * edge, so the board sits on the same line as the figures.
 *
 * Figures are the live counts of networkStats (or the admin's typed figures,
 * shown "N+"); the marinas line adds how many of them are members (an owner
 * on the platform), when that count is known.
 */
export interface QuayFigures {
  marinas: number | null;
  suppliers: number | null;
  countries: number | null;
  resources: number | null;
  /** Verified marinas that have an owner on the platform (null: unknown). */
  memberMarinas: number | null;
  manual: boolean;
}

export function QuayBand({ figures, loading, className }: { figures: QuayFigures; loading: boolean; className?: string }) {
  const { t } = useTranslation();
  const { rows, loading: rowsLoading } = useDepartureRows();
  const suffix = figures.manual ? '+' : '';

  const items: { key: string; to: string; value: number | null; label: string; sub: string }[] = [
    {
      key: 'marinas',
      to: '/directory?type=marina',
      value: figures.marinas,
      label: t('homeSections.stats.marinas', 'Marinas listed'),
      sub:
        figures.memberMarinas !== null && !figures.manual && figures.memberMarinas > 0
          ? t('homePage.quay.marinasSub', { count: figures.memberMarinas, defaultValue: 'including {{count}} members' })
          : t('homePage.quay.marinasSubPlain', 'in the directory'),
    },
    {
      key: 'suppliers',
      to: '/directory?type=partner',
      value: figures.suppliers,
      label: t('homeSections.stats.suppliers', 'Service providers'),
      sub: t('homePage.quay.providersSub', 'checked by the M3 team'),
    },
    {
      key: 'countries',
      to: '/directory',
      value: figures.countries,
      label: t('homeSections.stats.countries', 'Countries'),
      sub: t('homePage.quay.countriesSub', 'represented'),
    },
    {
      key: 'resources',
      to: '/resources',
      value: figures.resources,
      label: t('homeSections.stats.resources', 'Articles & resources'),
      sub: t('homePage.quay.resourcesSub', 'in the library'),
    },
  ];

  return (
    <div className={cn('relative bg-page pb-10 md:pb-12', className)}>
      <div className="mx-auto grid max-w-7xl gap-6 px-4 pt-8 sm:px-6 md:grid-cols-[minmax(0,1fr)_312px] md:items-end md:pt-6 lg:grid-cols-[minmax(0,1fr)_340px] lg:gap-8">
        <div className="min-w-0">
          <Reveal>
            <Eyebrow>{t('homePage.quay.eyebrow', 'On the quay')}</Eyebrow>
            <p className="mt-2 max-w-xl text-body text-meta">
              {t('homePage.quay.intro', 'What leaves the M3 quay next: our events, the latest replays and the newest members.')}
            </p>
          </Reveal>
          <Reveal delay={80} className="mt-5">
            <DepartureBoard
              rows={rows}
              loading={rowsLoading}
              pageSize={6}
              title={t('brand.board.title', 'Departures')}
              footer={t('brand.board.footer', 'Updated live · Monaco 43°44′ N')}
            />
          </Reveal>
        </div>

        {/* The pontoon tag hangs over the top of this column from md up. */}
        <section aria-labelledby="home-figures-heading" className="min-w-0 md:pt-[196px]">
          <h2 id="home-figures-heading">
            <Eyebrow as="span">{t('homePage.quay.figuresTitle', 'The network, live')}</Eyebrow>
          </h2>
          <div className="relative mt-3 overflow-hidden rounded-card border border-rule bg-white">
            <Graticule cell={40} className="absolute inset-0 h-full w-full" />
            <RevealGroup as="ul" className="relative grid grid-cols-2">
              {items.map((item, i) => (
                <li
                  key={item.key}
                  className={cn('min-w-0', i % 2 === 0 && 'border-r border-rule', i < 2 && 'border-b border-rule')}
                >
                  <Link
                    to={item.to}
                    // Inset ring: the panel clips anything drawn outside its cells.
                    className="group block h-full px-4 py-4 outline-none transition-colors hover:bg-chip/60 focus-visible:shadow-[inset_0_0_0_2px_rgb(11_38_83),inset_0_0_0_4px_#ffffff] sm:px-5 sm:py-5"
                  >
                    {loading && item.value === null ? (
                      <span aria-hidden="true" className="block h-[42px] w-20 animate-pulse rounded bg-chip" />
                    ) : (
                      <FlapFigure value={item.value} suffix={suffix} className="text-[30px] sm:text-[34px]" />
                    )}
                    <span className="mt-2 block font-signage text-[13px] font-semibold uppercase leading-4 tracking-[0.1em] text-navy">{item.label}</span>
                    <span className="mt-0.5 block text-[13px] leading-[18px] text-meta">{item.sub}</span>
                  </Link>
                </li>
              ))}
            </RevealGroup>
          </div>
        </section>
      </div>
    </div>
  );
}
