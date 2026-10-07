import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ArrowRight, BookOpen, Lock, Tag, Users, type LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';
import { CoverImage } from '@/components/ui/CoverImage';
import { CardShell, CardMedia } from '@/components/brand/CardShell';
import { getTheme, type Theme, type ThemeKey } from '@/lib/themes';
import { readMinutes } from '@/lib/readTime';

/**
 * The pieces of the resource library (src/pages/ResourcesPage.tsx) and of the
 * "related resources" row of the article page, in the v2 card grammar: white
 * 16 px cards with a hairline, lift 4 px and picture 1.05 on hover, a gold line
 * growing under the title. No round arrow disc. The whole card is one link (the
 * title's ::after covers it).
 */

export interface ResourceCardData {
  id: string;
  title: string;
  summary: string | null;
  type: string;
  access_level: string;
  thumbnail_url: string | null;
  created_at: string;
  published_at: string | null;
  tags?: string[] | null;
  /** Only for the read time; the related row does not load the body. */
  content?: string | null;
  resource_speakers?: { id: string; full_name: string; display_order: number }[];
  themes?: ThemeKey[];
  sectorSlugs?: string[];
}

/** Speakers in display order: on a copy, never sorting the fetched array in place. */
export function speakerNames(r: Pick<ResourceCardData, 'resource_speakers'>): string {
  return [...(r.resource_speakers ?? [])]
    .sort((a, b) => a.display_order - b.display_order)
    .map((s) => s.full_name)
    .join(', ');
}

/* ─── Toolbar chip ───────────────────────────────────────────────── */

/**
 * A toggle in the library toolbar: a white pill with a hairline, navy when on
 * (aria-pressed), with the live count in a small chip. 40 px tall.
 */
export function FilterPill({
  active,
  onClick,
  icon: Icon,
  count,
  children,
}: {
  active: boolean;
  onClick: () => void;
  icon?: LucideIcon;
  count?: number;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        'inline-flex h-10 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-pill px-4 text-sm font-medium transition-colors duration-300 focus-visible:shadow-focus focus-visible:outline-none',
        active ? 'bg-navy text-white' : 'bg-white text-navy shadow-[inset_0_0_0_1px_rgb(var(--rule))] hover:bg-chip',
      )}
    >
      {Icon && <Icon className="h-3.5 w-3.5" aria-hidden="true" />}
      {children}
      {count !== undefined && (
        <span
          className={cn(
            'tabular inline-flex h-5 min-w-6 items-center justify-center rounded-pill px-1.5 text-[12px] font-semibold leading-5',
            active ? 'bg-white/20 text-white' : 'bg-chip text-navy',
          )}
        >
          {count}
        </span>
      )}
    </button>
  );
}

/* ─── Theme door ─────────────────────────────────────────────────── */

/**
 * A photo tile that opens a theme (a toggle: pressing the open theme closes it).
 * Same look as the directory's selections: navy veil rising from the bottom, the
 * title with a gold line and a small arrow, the count in a frosted pill; the open
 * tile keeps a gold ring inside its edge. A theme without a photo gets its icon
 * on the brand gradient.
 */
export function ThemeDoor({
  label,
  hint,
  countLabel,
  active,
  icon: Icon,
  image,
  focusY = 0.5,
  onClick,
}: {
  label: string;
  hint: string;
  /** Empty while the library loads or when it could not be read: a pill saying "0 resources" would be a false answer. */
  countLabel: string;
  active: boolean;
  icon: LucideIcon;
  image: string | null;
  focusY?: number;
  onClick: () => void;
}) {
  const { t } = useTranslation();
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        'res-tile card-lift group has-ra relative isolate block h-[152px] w-full overflow-hidden rounded-card bg-navy text-left text-white outline-none focus-visible:shadow-focus sm:h-[180px] lg:h-[200px]',
        active && 'is-on',
      )}
    >
      <span aria-hidden="true" className="card-media absolute inset-0 -z-20 bg-[linear-gradient(135deg,#081d40,#1f7a8c)]">
        {image ? (
          <img
            src={image}
            alt=""
            loading="lazy"
            draggable={false}
            className="absolute inset-0 h-full w-full object-cover"
            style={{ objectPosition: `50% ${Math.round(focusY * 100)}%` }}
          />
        ) : (
          <Icon className="absolute right-5 top-5 h-14 w-14 text-white/20" strokeWidth={1.25} />
        )}
      </span>
      <span aria-hidden="true" className="absolute inset-0 -z-10 bg-[linear-gradient(180deg,rgba(8,29,64,.45)_0%,rgba(8,29,64,0)_34%,rgba(8,29,64,.2)_52%,rgba(8,29,64,.92)_100%)]" />
      {countLabel && (
        <span
          className={cn(
            'absolute left-3 top-3 inline-flex h-[26px] items-center rounded-pill px-2.5 text-[12px] font-semibold shadow-[inset_0_0_0_1px_rgba(255,255,255,.3)] backdrop-blur-md',
            active ? 'bg-gold text-navy' : 'bg-white/20 text-white',
          )}
        >
          {countLabel}
        </span>
      )}
      <span className="absolute inset-x-4 bottom-3.5 grid gap-[3px]">
        <span className="text-[16px] font-semibold leading-[21px] tracking-[-0.01em] md:text-[17px] md:leading-[22px]">
          <span className="card-ul">{label}</span>
          <ArrowRight className="card-arrow card-arrow--light" strokeWidth={2.25} aria-hidden="true" />
        </span>
        <span className="hidden truncate text-[13px] leading-[18px] text-white/85 sm:block">{hint}</span>
      </span>
      {active && <span className="sr-only">{t('contentPages.library.themeSelected', '(selected)')}</span>}
    </button>
  );
}

/* ─── Cards ──────────────────────────────────────────────────────── */

/** Over the picture of a card the reader may not open yet: a navy veil and a lock. */
export function LockOverlay({ level }: { level: string }) {
  const { t } = useTranslation();
  return (
    <div className="absolute inset-0 z-[1] flex items-center justify-center bg-navy-deep/60">
      <div className="px-4 text-center text-white">
        <Lock className="mx-auto mb-1.5 h-6 w-6" aria-hidden="true" />
        <p className="text-[13px] font-semibold leading-[18px]">
          {level === 'members' ? t('resources.signupToAccess') : t('resources.verifyMarinaToAccess')}
        </p>
      </div>
    </div>
  );
}

/**
 * What a card is about, in one frosted pill: its theme in the whole library;
 * inside an open theme every card would repeat the same name, so it names the
 * resource's sector within that theme instead.
 */
function ThemeBadge({
  resource, openTheme, activeSector, sectorLabel,
}: {
  resource: ResourceCardData;
  openTheme: Theme | null;
  activeSector: string | null;
  sectorLabel: (slug: string) => string;
}) {
  const { t } = useTranslation();
  let icon: Theme['icon'] | null = null;
  let text = '';
  if (openTheme) {
    // The chip the reader picked wins, so the card agrees with the filter.
    const sectors = resource.sectorSlugs ?? [];
    const slug = activeSector && sectors.includes(activeSector)
      ? activeSector
      : sectors.find((s) => openTheme.sectors.includes(s));
    if (slug) { icon = openTheme.icon; text = sectorLabel(slug); }
  } else {
    const th = getTheme(resource.themes?.[0]);
    if (th) { icon = th.icon; text = t(th.labelKey, th.fallback); }
  }
  if (!icon || !text) return null;
  const Icon = icon;
  return (
    <span className="absolute left-3 top-3 z-[2] inline-flex h-[26px] max-w-[85%] items-center gap-1.5 rounded-pill bg-white/90 px-2.5 text-[12px] font-semibold text-navy backdrop-blur-md">
      <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
      <span className="truncate">{text}</span>
    </span>
  );
}

/** "12 Oct 2026 · 6 min read": the meta line of every card. */
function MetaLine({
  resource, formatDate, showFormat, className,
}: {
  resource: ResourceCardData;
  formatDate: (iso: string) => string;
  showFormat?: boolean;
  className?: string;
}) {
  const { t } = useTranslation();
  const iso = resource.published_at || resource.created_at;
  return (
    <p className={cn('flex flex-wrap items-center gap-x-2 text-[13px] leading-[18px] text-meta', className)}>
      <time dateTime={iso}>{formatDate(iso)}</time>
      {resource.content !== undefined && (
        <>
          <span aria-hidden="true">·</span>
          <span>{t('resources.minRead', { count: readMinutes(resource.content) })}</span>
        </>
      )}
      {showFormat && (
        <>
          <span aria-hidden="true">·</span>
          <span>{t(`resources.types.${resource.type}`, resource.type)}</span>
        </>
      )}
    </p>
  );
}

/** The card's one link: the title, its ::after covers the card. Carries `fromList` so Back returns to the filtered view. */
function CardLink({ id, fromList, className, children }: { id: string; fromList: boolean; className?: string; children: ReactNode }) {
  return (
    <Link
      to={`/resources/${id}`}
      state={fromList ? { fromList: true } : undefined}
      className={cn('stretched-link focus-visible:outline-none', className)}
    >
      {children}
    </Link>
  );
}

export function ResourceCard({
  resource, locked, formatDate, showFormat = false, openTheme = null, activeSector = null, sectorLabel, query = '', fromList = true,
}: {
  resource: ResourceCardData;
  locked: boolean;
  formatDate: (iso: string) => string;
  showFormat?: boolean;
  openTheme?: Theme | null;
  activeSector?: string | null;
  sectorLabel?: (slug: string) => string;
  query?: string;
  /** False in the article page's related row: Back there means the library itself. */
  fromList?: boolean;
}) {
  const { t } = useTranslation();
  const speakers = speakerNames(resource);
  // Tags are searched but not printed on every card. When a search hits one,
  // show it: otherwise the card is in the results with no visible reason.
  const q = query.trim().toLowerCase();
  const matchedTags = q ? (resource.tags ?? []).filter((tag) => tag.toLowerCase().includes(q)).slice(0, 3) : [];
  return (
    <CardShell interactive className="h-full w-full min-w-0">
      <CardMedia>
        <CoverImage
          src={resource.thumbnail_url}
          alt=""
          seed={resource.id}
          icon={getTheme(resource.themes?.[0])?.icon ?? BookOpen}
          aspect="wide"
          tone="sea"
        >
          {locked && <LockOverlay level={resource.access_level} />}
          {sectorLabel && (
            <ThemeBadge resource={resource} openTheme={openTheme} activeSector={activeSector} sectorLabel={sectorLabel} />
          )}
        </CoverImage>
      </CardMedia>
      <div className="flex flex-1 flex-col px-5 pb-5 pt-4">
        <MetaLine resource={resource} formatDate={formatDate} showFormat={showFormat} />
        <h3 className="mt-2 text-card-title text-navy">
          <CardLink id={resource.id} fromList={fromList} className="line-clamp-2">
            <span className="card-ul">{resource.title}</span>
          </CardLink>
        </h3>
        {resource.summary && <p className="mt-2 line-clamp-3 text-sm leading-5 text-[#374151]">{resource.summary}</p>}
        {speakers && (
          <p className="mt-3 flex items-center gap-1.5 text-[13px] leading-[18px] text-meta">
            <Users className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            <span className="truncate">{speakers}</span>
          </p>
        )}
        {matchedTags.length > 0 && (
          <ul className="mt-3 flex flex-wrap gap-1.5">
            {matchedTags.map((tag) => (
              <li key={tag} className="inline-flex h-6 items-center gap-1 rounded-pill bg-chip px-2.5 text-[12px] font-medium text-navy">
                <Tag className="h-3 w-3" aria-hidden="true" />
                {tag}
              </li>
            ))}
          </ul>
        )}
        <div className="mt-auto pt-4">
          <span aria-hidden="true" className="uline uline--plain text-sm">
            <span className="uline-t">{t('resources.readMore')}</span>
            <ArrowRight className="uline-a" strokeWidth={2.25} aria-hidden="true" />
          </span>
        </div>
      </div>
    </CardShell>
  );
}

/** The newest article on the untouched library: a wide card, picture left. */
export function FeaturedResource({
  resource, locked, formatDate,
}: {
  resource: ResourceCardData;
  locked: boolean;
  formatDate: (iso: string) => string;
}) {
  const { t } = useTranslation();
  const speakers = speakerNames(resource);
  const themes = (resource.themes ?? []).map((k) => getTheme(k)).filter((th): th is Theme => !!th);
  return (
    <CardShell interactive className="grid lg:grid-cols-12">
      <CardMedia className="min-h-[240px] lg:col-span-7 lg:min-h-[380px]">
        <CoverImage
          src={resource.thumbnail_url}
          alt=""
          seed={resource.id}
          icon={themes[0]?.icon ?? BookOpen}
          aspect="fill"
          tone="sea"
          eager
          className="absolute inset-0"
        >
          {locked && <LockOverlay level={resource.access_level} />}
          <span className="absolute left-4 top-4 z-[2] inline-flex h-[26px] items-center rounded-pill bg-gold px-3 text-[12px] font-semibold uppercase tracking-[0.06em] text-navy">
            {t('resources.latest')}
          </span>
        </CoverImage>
      </CardMedia>
      <div className="flex flex-col justify-center p-6 lg:col-span-5 lg:p-10">
        {themes.length > 0 && (
          <p className="flex items-center gap-2 text-[13px] font-semibold uppercase leading-4 tracking-[0.08em] text-meta">
            <span aria-hidden="true" className="h-1.5 w-1.5 shrink-0 rounded-full bg-teal" />
            {themes.map((th) => t(th.labelKey, th.fallback)).join(' · ')}
          </p>
        )}
        <h2 className={cn('text-h2-sm text-navy xl:text-h2', themes.length > 0 && 'mt-3')}>
          <CardLink id={resource.id} fromList>
            <span className="card-ul">{resource.title}</span>
          </CardLink>
        </h2>
        {resource.summary && <p className="mt-3 line-clamp-4 text-body text-ink">{resource.summary}</p>}
        <MetaLine resource={resource} formatDate={formatDate} className="mt-4" />
        {speakers && (
          <p className="mt-2 flex items-center gap-1.5 text-[13px] leading-[18px] text-meta">
            <Users className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            <span>{speakers}</span>
          </p>
        )}
        <div className="mt-6">
          <span aria-hidden="true" className="uline uline--plain text-sm">
            <span className="uline-t">{t('resources.readMore')}</span>
            <ArrowRight className="uline-a" strokeWidth={2.25} aria-hidden="true" />
          </span>
        </div>
      </div>
    </CardShell>
  );
}

/** Loading placeholder with the card's proportions. */
export function ResourceSkeleton() {
  return (
    <li className="overflow-hidden rounded-card border border-rule bg-white">
      <div className="aspect-[3/2] animate-pulse bg-chip motion-reduce:animate-none" />
      <div className="space-y-3 px-5 pb-6 pt-4">
        <div className="h-3 w-1/3 animate-pulse rounded-pill bg-chip motion-reduce:animate-none" />
        <div className="h-5 w-3/4 animate-pulse rounded-pill bg-chip motion-reduce:animate-none" />
        <div className="h-3 w-full animate-pulse rounded-pill bg-chip motion-reduce:animate-none" />
        <div className="h-3 w-5/6 animate-pulse rounded-pill bg-chip motion-reduce:animate-none" />
      </div>
    </li>
  );
}
