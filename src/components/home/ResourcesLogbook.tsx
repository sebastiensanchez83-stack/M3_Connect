import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { FileText, Lock } from 'lucide-react';
import { cn } from '@/lib/utils';
import { boardDate } from '@/lib/boardDate';
import { AdBanner } from '@/components/ui/AdBanner';
import { StretchedLink } from '@/components/brand/CardShell';
import { CapArrow } from '@/components/brand/CapArrow';
import { ThemeFlag } from '@/components/brand/ThemeFlag';
import { RevealGroup } from '@/components/motion/Reveal';
import { WaveEdge } from '@/components/motion/WaveEdge';
import { THEMES, getTheme, type Theme, type ThemeKey } from '@/lib/themes';
import { HomeHeading } from './HomeHeading';

/**
 * Latest resources as a logbook ("journal de bord"), across the full width:
 * one ruled line per entry, with the date in the departures board's own caps,
 * the theme as a small signal flag, the title, and "Read" followed by the cap
 * needle. Above it, the six themes as flag chips with their counts; below it,
 * the sponsors' advert slot. The events are not repeated here: the pontoon tag,
 * the board and the route already carry them.
 */
export interface HomeResource {
  id: string;
  title: string;
  summary: string | null;
  type: string;
  access_level: string;
  thumbnail_url: string | null;
  created_at: string;
  published_at: string | null;
  themes: ThemeKey[];
}

const PAGE = 'rgb(246 247 249)';

export function ResourcesLogbook({
  resources,
  themeCounts,
  loading,
  lang,
  waveTop = false,
}: {
  resources: HomeResource[];
  themeCounts: Record<ThemeKey, number> | null;
  loading: boolean;
  lang: string;
  /** Start with a waterline rising out of the navy section above. */
  waveTop?: boolean;
}) {
  const { t } = useTranslation();
  // A door that opens on an empty list is worse than no door.
  const themes = themeCounts ? THEMES.filter((th) => themeCounts[th.key] > 0) : [];

  return (
    <section aria-labelledby="home-resources-heading" className="relative bg-page">
      {waveTop && <WaveEdge color={PAGE} className="relative z-10 -mt-10 h-10 md:-mt-14 md:h-14" />}
      <div className={cn('mx-auto max-w-7xl px-4 pb-16 sm:px-6 md:pb-24', waveTop ? 'pt-8 md:pt-10' : 'pt-16 md:pt-24')}>
        <HomeHeading
          id="home-resources-heading"
          eyebrow={t('homeSections.resourcesEyebrow', 'Knowledge library')}
          title={t('homePage.resources.title', 'Latest resources')}
          link={{ to: '/resources', label: t('homeSections.resourcesLink', 'Browse the library') }}
        />

        {themes.length > 1 && (
          <nav aria-label={t('resources.browseByTheme', 'Browse by theme')} className="mt-6">
            {/* Phones: one row that scrolls sideways; wider screens: the chips wrap. */}
            <ul className="no-scrollbar -mx-4 flex gap-2 overflow-x-auto px-4 py-1 sm:mx-0 sm:flex-wrap sm:overflow-visible sm:px-0">
              {themes.map((th) => (
                <li key={th.key} className="shrink-0">
                  <ThemeChip theme={th} count={themeCounts?.[th.key] ?? null} />
                </li>
              ))}
            </ul>
          </nav>
        )}

        <div className="mt-8">
          {loading ? (
            <div className="space-y-px overflow-hidden rounded-card border border-rule bg-white" aria-hidden="true">
              {[0, 1, 2, 3].map((i) => <div key={i} className="h-[76px] animate-pulse bg-chip/60" />)}
            </div>
          ) : resources.length === 0 ? (
            <div className="rounded-card border border-rule bg-white p-10 text-center">
              <FileText className="mx-auto mb-3 h-10 w-10 text-meta/40" aria-hidden="true" />
              <p className="text-meta">{t('homeSections.resourcesEmpty', 'The first articles are on their way.')}</p>
            </div>
          ) : (
            <div className="overflow-hidden rounded-card border border-rule bg-white">
              {/* Column heads of the log (sighted readers; each line says it all to a screen reader). */}
              <div
                aria-hidden="true"
                className="hidden grid-cols-[132px_220px_minmax(0,1fr)_auto] gap-6 border-b border-rule bg-chip/50 px-6 py-2.5 font-signage text-[12px] font-semibold uppercase tracking-[0.14em] text-meta md:grid"
              >
                <span>{t('homePage.resources.colDate', 'Date')}</span>
                <span>{t('homePage.resources.colTheme', 'Theme')}</span>
                <span>{t('homePage.resources.colEntry', 'Entry')}</span>
                <span className="text-right">{t('homePage.resources.colType', 'Type')}</span>
              </div>
              <RevealGroup as="ol" aria-label={t('homePage.resources.title', 'Latest resources')} step={60} y={12}>
                {resources.map((r) => (
                  <LogLine key={r.id} resource={r} lang={lang} />
                ))}
              </RevealGroup>
            </div>
          )}
        </div>

        {/* Sponsor adverts for this page (renders nothing when none is running). */}
        <AdBanner placement="homepage" className="mt-12" />
      </div>
    </section>
  );
}

function ThemeChip({ theme, count }: { theme: Theme; count: number | null }) {
  const { t } = useTranslation();
  return (
    <Link
      to={`/resources?theme=${theme.key}`}
      title={t(theme.descKey, theme.descFallback)}
      className="focus-ring inline-flex h-11 items-center gap-2 whitespace-nowrap rounded-field border border-rule bg-white px-3.5 text-sm font-medium text-navy transition-colors hover:border-navy/40 md:h-10"
    >
      <ThemeFlag theme={theme.key} />
      {t(theme.labelKey, theme.fallback)}
      {count !== null && <span className="tabular text-[13px] font-normal text-meta">{count}</span>}
    </Link>
  );
}

function LogLine({ resource: r, lang }: { resource: HomeResource; lang: string }) {
  const { t } = useTranslation();
  const theme = getTheme(r.themes[0]);
  const date = boardDate(r.published_at || r.created_at, lang);
  const locked = r.access_level && r.access_level !== 'public';
  const accessLabel = locked ? t(`resources.accessLevels.${r.access_level}`, r.access_level) : null;

  return (
    <li className="group relative grid grid-cols-[minmax(0,1fr)_auto] gap-x-4 gap-y-1.5 border-t border-rule px-5 py-4 transition-colors first:border-t-0 hover:bg-chip/40 md:grid-cols-[132px_220px_minmax(0,1fr)_auto] md:items-center md:gap-6 md:px-6">
      <span className="col-span-2 flex items-center gap-3 md:contents">
        <span className="font-signage text-[14px] font-semibold uppercase tabular tracking-[0.1em] text-navy">{date}</span>
        {theme && (
          <span className="inline-flex min-w-0 items-center gap-2 text-[13px] text-meta">
            <ThemeFlag theme={theme.key} />
            <span className="truncate">{t(theme.labelKey, theme.fallback)}</span>
          </span>
        )}
      </span>
      <h3 className="min-w-0 text-[16px] font-semibold leading-[22px] text-navy md:text-card-title">
        <StretchedLink to={`/resources/${r.id}`} className="line-clamp-2 group-hover:underline group-hover:underline-offset-4">
          {r.title}
        </StretchedLink>
      </h3>
      <span className="flex items-center justify-end gap-3 self-end text-sm text-meta md:self-center">
        <span className="hidden whitespace-nowrap sm:inline">{t(`resources.types.${r.type}`, r.type)}</span>
        {accessLabel && (
          <span className="inline-flex items-center gap-1 whitespace-nowrap text-[12px] font-medium text-ink">
            <Lock className="h-3 w-3" aria-hidden="true" />
            {accessLabel}
          </span>
        )}
        <span aria-hidden="true" className="inline-flex items-center gap-1.5 font-semibold text-navy">
          {t('homePage.resources.read', 'Read')}
          <CapArrow size="sm" />
        </span>
      </span>
    </li>
  );
}
