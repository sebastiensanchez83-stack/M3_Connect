import { useRef } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';
import { Counter } from '@/components/motion/Counter';
import { Graticule } from '@/components/motion/Graticule';
import { useMotion } from '@/components/motion/MotionProvider';
import { useInView } from '@/components/motion/useInView';

/**
 * The network's live figures, right under the hero: a white card on a chart
 * graticule (24 px grid) with a ruler along its top edge that draws itself from
 * left to right (1.2 s) while the four figures count up (0.9 s), once, when the
 * band scrolls into view. Two columns on phones, four from md.
 *
 * Figures are the live counts of networkStats (or the admin's typed figures,
 * shown "N+"); the marinas line adds how many of them are members (an owner on
 * the platform), when that count is known. Each cell leads to its list.
 */
export interface HomeFigures {
  marinas: number | null;
  suppliers: number | null;
  countries: number | null;
  resources: number | null;
  /** Verified marinas that have an owner on the platform (null: unknown). */
  memberMarinas: number | null;
  manual: boolean;
}

const RULER =
  'repeating-linear-gradient(90deg,#b3bdcd 0 1px,transparent 1px 24px) 0 0/100% 6px no-repeat,' +
  'repeating-linear-gradient(90deg,#8792a7 0 1px,transparent 1px 96px) 0 0/100% 11px no-repeat';

export function FiguresBand({ figures, loading, className }: { figures: HomeFigures; loading: boolean; className?: string }) {
  const { t } = useTranslation();
  const { reduced } = useMotion();
  const ref = useRef<HTMLElement>(null);
  const inView = useInView(ref, { disabled: reduced, threshold: 0.25 });
  const suffix = figures.manual ? '+' : '';

  const items: { key: string; to: string; value: number | null; label: string; sub: string }[] = [
    {
      key: 'marinas',
      to: '/directory?type=marina',
      value: figures.marinas,
      label: t('homePage.figures.marinas', 'Marinas'),
      sub:
        figures.memberMarinas !== null && !figures.manual && figures.memberMarinas > 0
          ? t('homePage.figures.marinasSub', { count: figures.memberMarinas, defaultValue: 'listed, including {{count}} members' })
          : t('homePage.quay.marinasSubPlain', 'in the directory'),
    },
    {
      key: 'suppliers',
      to: '/directory?type=partner',
      value: figures.suppliers,
      label: t('homePage.figures.suppliers', 'Service providers'),
      sub: t('homePage.quay.providersSub', 'in the directory'),
    },
    {
      key: 'countries',
      to: '/directory',
      value: figures.countries,
      label: t('homePage.figures.countries', 'Countries'),
      sub: t('homePage.quay.countriesSub', 'represented'),
    },
    {
      key: 'resources',
      to: '/resources',
      value: figures.resources,
      label: t('homePage.figures.resources', 'Resources'),
      sub: t('homePage.quay.resourcesSub', 'in the library'),
    },
  ];

  return (
    <div className={cn('mx-auto mt-4 w-full max-w-7xl px-4 sm:px-6 md:mt-6', className)}>
      <section ref={ref} aria-label={t('homePage.figures.label', 'Smart Marina Connect in figures')} className="relative overflow-hidden rounded-card border border-rule bg-white">
        <Graticule cell={24} graduations={false} opacity={0.06} className="absolute inset-0 h-full w-full" />
        {/* The ruler along the top edge draws itself from the left. */}
        <span
          aria-hidden="true"
          className={cn(
            'pointer-events-none absolute inset-x-0 top-0 h-3 origin-left',
            !reduced && '[transition:transform_1200ms_cubic-bezier(.215,.61,.355,1)_150ms]',
            !inView && 'scale-x-0',
          )}
          style={{ background: RULER }}
        />
        <ul className="relative grid grid-cols-2 md:grid-cols-4">
          {items.map((item, i) => (
            <li
              key={item.key}
              className={cn(
                'min-w-0 border-rule',
                i % 2 === 0 && 'border-r',
                i < 2 && 'border-b md:border-b-0',
                i === 1 && 'md:border-r',
                i === 2 && 'md:border-r',
              )}
            >
              <Link
                to={item.to}
                // Inset ring: the band clips anything drawn outside its cells.
                className="block h-full px-4 pb-5 pt-[26px] outline-none transition-colors duration-300 hover:bg-page/70 focus-visible:shadow-[inset_0_0_0_2px_rgb(11_38_83),inset_0_0_0_4px_#ffffff] md:px-7 md:pb-[26px] md:pt-8"
              >
                <span className="block text-[12px] font-medium uppercase leading-4 tracking-[0.06em] text-meta">{item.label}</span>
                <span className="mt-2 block">
                  {loading && item.value === null ? (
                    <span aria-hidden="true" className="block h-[52px] w-24 animate-pulse rounded bg-chip md:h-[60px]" />
                  ) : (
                    <>
                      <span aria-hidden="true" className="block text-[48px] font-light leading-[52px] tracking-[-0.02em] text-navy md:text-[56px] md:leading-[60px]">
                        <Counter value={item.value} suffix={suffix} />
                      </span>
                      <span className="sr-only">
                        {item.value === null ? '' : `${item.value}${suffix}`}
                      </span>
                    </>
                  )}
                </span>
                <span className="mt-1 block text-[14px] leading-5 text-meta">{item.sub}</span>
              </Link>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
