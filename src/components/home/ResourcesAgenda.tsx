import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ArrowRight, BookOpen, CalendarPlus, FileText, Lock } from 'lucide-react';
import { cn } from '@/lib/utils';
import { boardDate } from '@/lib/boardDate';
import { AdBanner } from '@/components/ui/AdBanner';
import { CoverImage } from '@/components/ui/CoverImage';
import { CardShell, StretchedLink } from '@/components/brand/CardShell';
import { Eyebrow } from '@/components/brand/Eyebrow';
import { UnderlineLink } from '@/components/brand/UnderlineLink';
import { LineReveal } from '@/components/motion/LineReveal';
import { Reveal, RevealGroup } from '@/components/motion/Reveal';
import { useMediaQuery } from '@/components/motion/useReducedMotion';
import { THEMES, getTheme, type ThemeKey } from '@/lib/themes';
import { useHomeAgenda, type AgendaEntry } from './useHomeAgenda';

/**
 * Latest resources and the agenda, side by side from lg (8 + 4 columns):
 *
 *  - left: the latest articles as cards (a 3:2 picture, the theme with a teal
 *    dot and the date, the title on three lines at most with a gold line and a small arrow,
 *    the type) in two columns; a row swiped by hand on phones. Above them, the
 *    themes as small pills with their counts. The sponsors' advert slot sits
 *    under the section (nothing renders when none is running);
 *  - right: the agenda, one ruled row per date (a date block, the title, place
 *    and status, a small arrow): the next published events, the World Yachting
 *    Summit while it is upcoming, the Rendezvous' 6th edition, then a line that
 *    sends the webinar dates to the newsletter.
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

export function ResourcesAgenda({
  resources,
  themeCounts,
  loading,
  lang,
  sectionNo,
}: {
  resources: HomeResource[];
  themeCounts: Record<ThemeKey, number> | null;
  loading: boolean;
  lang: string;
  /** Section number shown before the "Resources" eyebrow ("03"). */
  sectionNo?: string;
}) {
  const { t } = useTranslation();
  const swipe = useMediaQuery('(max-width: 767px)');
  // A door that opens on an empty list is worse than no door.
  const themes = themeCounts ? THEMES.filter((th) => themeCounts[th.key] > 0) : [];
  const shown = resources.slice(0, 4);

  return (
    <section aria-labelledby="home-resources-heading" className="bg-page py-16 md:py-[104px]">
      <div className="mx-auto grid max-w-7xl gap-14 px-4 sm:px-6 lg:grid-cols-12 lg:gap-8">
        {/* ── Latest articles ── */}
        <div className="min-w-0 lg:col-span-8">
          <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-2">
            <div>
              <Reveal>
                <Eyebrow number={sectionNo}>{t('homeSections.resourcesEyebrow', 'Resources')}</Eyebrow>
              </Reveal>
              <LineReveal as="h2" id="home-resources-heading" className="mt-2 text-[22px] font-semibold leading-7 tracking-[-0.01em] text-navy">
                {t('homePage.resources.title', 'Latest articles')}
              </LineReveal>
            </div>
            <Reveal delay={120} className="shrink-0">
              <UnderlineLink to="/resources">{t('homeSections.resourcesLink', 'All resources')}</UnderlineLink>
            </Reveal>
          </div>

          {themes.length > 1 && (
            <Reveal as="nav" delay={80} aria-label={t('resources.browseByTheme', 'Browse by theme')} className="mt-5">
              {/* Phones: one row that scrolls sideways; wider screens: the pills wrap. */}
              <ul className="no-scrollbar -mx-4 flex gap-2 overflow-x-auto px-4 py-1 sm:mx-0 sm:flex-wrap sm:overflow-visible sm:px-0">
                {themes.map((th) => (
                  <li key={th.key} className="shrink-0">
                    <Link
                      to={`/resources?theme=${th.key}`}
                      title={t(th.descKey, th.descFallback)}
                      className="focus-ring inline-flex min-h-11 items-center gap-2 whitespace-nowrap rounded-full border border-rule bg-white px-3.5 text-[13px] font-medium text-navy transition-colors duration-300 hover:border-navy/40 md:min-h-9"
                    >
                      {t(th.labelKey, th.fallback)}
                      {themeCounts && <span className="tabular font-normal text-meta">{themeCounts[th.key]}</span>}
                    </Link>
                  </li>
                ))}
              </ul>
            </Reveal>
          )}

          {loading ? (
            <div aria-hidden="true" className="mt-6 grid gap-6 md:grid-cols-2">
              {[0, 1].map((i) => <div key={i} className="h-[380px] animate-pulse rounded-card bg-chip/70" />)}
            </div>
          ) : shown.length === 0 ? (
            <div className="mt-6 rounded-card border border-rule bg-white p-10 text-center">
              <FileText className="mx-auto mb-3 h-10 w-10 text-meta/40" aria-hidden="true" />
              <p className="text-meta">{t('homeSections.resourcesEmpty', 'The first articles are on their way.')}</p>
            </div>
          ) : (
            <RevealGroup
              // A row swiped by hand on phones (so it is a focusable region there); a grid from md.
              role={swipe ? 'region' : undefined}
              aria-label={swipe ? t('homePage.resources.title', 'Latest articles') : undefined}
              tabIndex={swipe ? 0 : undefined}
              className="no-scrollbar focus-ring -mx-4 mt-6 flex snap-x snap-mandatory gap-4 overflow-x-auto overscroll-x-contain scroll-px-4 px-4 py-2 sm:-mx-6 sm:scroll-px-6 sm:px-6 md:mx-0 md:grid md:grid-cols-2 md:gap-6 md:overflow-visible md:p-0"
            >
              {shown.map((r, i) => (
                // Four cards on phones and tablets; two beside the agenda from lg.
                <ArticleCard key={r.id} resource={r} lang={lang} className={i >= 2 ? 'lg:hidden' : undefined} />
              ))}
            </RevealGroup>
          )}
        </div>

        {/* ── Agenda ── */}
        <div className="min-w-0 lg:col-span-4">
          <Agenda />
        </div>

        {/* Sponsor adverts for this page (renders nothing when none is running). */}
        <AdBanner placement="homepage" className="lg:col-span-12" />
      </div>
    </section>
  );
}

function ArticleCard({ resource: r, lang, className }: { resource: HomeResource; lang: string; className?: string }) {
  const { t } = useTranslation();
  const theme = getTheme(r.themes[0]);
  const locked = r.access_level && r.access_level !== 'public';
  const accessLabel = locked ? t(`resources.accessLevels.${r.access_level}`, r.access_level) : null;
  return (
    <CardShell interactive className={cn('w-[88%] shrink-0 snap-start p-4 md:w-auto', className)}>
      <div className="card-media relative aspect-[3/2] overflow-hidden rounded-[12px]">
        <CoverImage
          src={r.thumbnail_url || theme?.image || null}
          focusY={r.thumbnail_url ? 0.5 : theme?.imageFocusY ?? 0.5}
          alt=""
          seed={r.id}
          icon={theme?.icon ?? BookOpen}
          aspect="fill"
          tone="sea"
        />
      </div>
      <div className="mt-4 flex items-center justify-between gap-3 text-[12px] font-medium uppercase leading-4 tracking-[0.06em] text-meta">
        {theme ? (
          <span className="flex min-w-0 items-center gap-2">
            <span aria-hidden="true" className="h-1.5 w-1.5 shrink-0 rounded-full bg-teal" />
            <span className="truncate">{t(theme.labelKey, theme.fallback)}</span>
          </span>
        ) : (
          <span />
        )}
        <span className="tabular shrink-0">{boardDate(r.published_at || r.created_at, lang)}</span>
      </div>
      <h3 lang="en" className="mt-2 text-[18px] font-semibold leading-[26px] text-navy">
        <StretchedLink to={`/resources/${r.id}`} className="line-clamp-3 rounded-sm">
          {r.title}
        </StretchedLink>
      </h3>
      <div className="mt-auto flex flex-wrap gap-2 pt-4">
        <span className="inline-flex h-6 items-center rounded-full bg-chip px-2.5 text-[12px] font-semibold uppercase tracking-[0.04em] text-navy">
          {t(`resources.types.${r.type}`, r.type)}
        </span>
        {accessLabel && (
          <span className="inline-flex h-6 items-center gap-1 rounded-full bg-chip px-2.5 text-[12px] font-semibold uppercase tracking-[0.04em] text-navy">
            <Lock className="h-3 w-3" aria-hidden="true" />
            {accessLabel}
          </span>
        )}
      </div>
    </CardShell>
  );
}

function Agenda() {
  const { t } = useTranslation();
  const { entries, loading } = useHomeAgenda();
  return (
    <>
      <div>
        <Reveal>
          <Eyebrow>{t('homePage.agenda.eyebrow', 'Agenda')}</Eyebrow>
        </Reveal>
        <LineReveal as="h2" className="mt-2 text-[22px] font-semibold leading-7 tracking-[-0.01em] text-navy">
          {t('homePage.agenda.title', 'Where to meet us')}
        </LineReveal>
      </div>
      <Reveal as="ul" delay={80} className="mt-6 divide-y divide-rule overflow-hidden rounded-card border border-rule bg-white">
        {loading
          ? [0, 1].map((i) => <li key={i} aria-hidden="true" className="h-[104px] animate-pulse bg-chip/50" />)
          : entries.map((e) => (
              <li key={e.id}>
                <AgendaRow entry={e} />
              </li>
            ))}
        <li className="grid grid-cols-[72px_minmax(0,1fr)] items-center gap-4 p-5">
          <span aria-hidden="true" className="grid w-[72px] place-items-center text-teal">
            <CalendarPlus className="h-7 w-7" />
          </span>
          <p className="text-[15px] leading-[22px] text-ink">
            {t('homePage.agenda.webinarsBefore', 'Next webinars: get the dates through')}{' '}
            <a href="#newsletter" className="focus-ring rounded-[3px] font-semibold text-navy underline underline-offset-[3px]">
              {t('homePage.agenda.newsletterLink', 'the Smart Marina Connect newsletter')}
            </a>
          </p>
        </li>
      </Reveal>
    </>
  );
}

function AgendaRow({ entry }: { entry: AgendaEntry }) {
  return (
    <Link
      to={entry.href}
      className={cn(
        'group has-ra relative grid grid-cols-[72px_minmax(0,1fr)_20px] items-center gap-4 p-5 outline-none transition-colors [transition-duration:400ms] hover:bg-page',
        'focus-visible:shadow-[inset_0_0_0_2px_rgb(11_38_83),inset_0_0_0_4px_#ffffff]',
      )}
    >
      <span aria-hidden="true" className="flex w-[72px] flex-col items-center justify-center rounded-[12px] bg-chip py-2">
        <span className="text-[12px] font-semibold uppercase leading-4 tracking-[0.06em] text-meta">{entry.month}</span>
        <span className="tabular my-0.5 text-[40px] font-bold leading-10 tracking-[-0.02em] text-navy">{entry.day}</span>
        <span className="text-[12px] font-semibold uppercase leading-4 tracking-[0.06em] text-meta">{entry.year}</span>
      </span>
      <span className="min-w-0">
        <span className="sr-only">{entry.spoken}: </span>
        <span className="block text-base font-semibold leading-[22px] text-navy"><span className="card-ul">{entry.title}</span></span>
        {entry.sub && <span className="mt-1 block text-[14px] leading-5 text-meta">{entry.sub}</span>}
      </span>
      <ArrowRight aria-hidden="true" strokeWidth={2.25} className="card-arrow !ml-0" />
    </Link>
  );
}
