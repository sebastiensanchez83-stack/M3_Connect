import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Anchor, BadgeCheck, Building2, HardHat, MapPin, Newspaper, ShieldCheck, TrendingUp, Wrench, type LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';
import { BathyPattern } from '@/components/motion/BathyPattern';
import { CardShell, StretchedLink, type OrgTypeTone } from './CardShell';
import { ArrowDisc } from './ArrowDisc';

/**
 * The organisation card, one design for Home and the directory (v2 kit):
 *
 *  - A cover in the type's colours (a gradient picked from the id, so a card
 *    never changes between visits) with sounding lines that slide on hover and
 *    the type's icon watermarked in; the "Verified member" pill top left, the
 *    round arrow top right (the directory adds its shortlist star under it).
 *  - A bar in the type's colour under the cover, and the logo (or initials)
 *    straddling the two.
 *  - The name (the one link, stretched over the whole card), a coloured dot
 *    with the type and the place, a two-line blurb.
 *  - "View profile", underlined on hover.
 *
 * `OrgCover` is the shared top half; the directory's own card builds on it.
 */

/** Organisation type → colour family. Unknown or empty types read as "other". */
export function orgTypeTone(type: string | null | undefined): OrgTypeTone {
  switch (type) {
    case 'marina':
      return 'marina';
    case 'partner':
      return 'provider';
    case 'investor':
    case 'developer':
      return 'investor';
    default:
      return 'media';
  }
}

const TYPE_BG: Record<OrgTypeTone, string> = {
  marina: 'bg-org-marina',
  provider: 'bg-org-provider',
  investor: 'bg-org-investor',
  media: 'bg-org-media',
};

/** The type's colour (src/index.css --type-*): the dot next to the type and the bar under the cover. */
export const TYPE_RGB: Record<OrgTypeTone, string> = {
  marina: 'rgb(var(--type-marina))',
  provider: 'rgb(var(--type-provider))',
  investor: 'rgb(var(--type-investor))',
  media: 'rgb(var(--type-media))',
};

/** The type's icon, watermarked into the cover. */
const TYPE_ICON: Record<string, LucideIcon> = {
  marina: Anchor,
  partner: Wrench,
  investor: TrendingUp,
  developer: HardHat,
  media_partner: Newspaper,
};

/** Cover gradients per type family; a card picks one from its id. */
const COVER_GRADIENTS: Record<OrgTypeTone, [string, string][]> = {
  marina: [['#0b2653', '#1f7a8c'], ['#081d40', '#1f7a8c']],
  provider: [['#0b2653', '#1f7a8c'], ['#081d40', '#1f7a8c'], ['#0b2653', '#4a6fa5']],
  investor: [['#0b2653', '#4a6fa5'], ['#081d40', '#4a6fa5']],
  media: [['#1e293b', '#64748b']],
};

/** Small stable hash, for the cover's sounding-line drawing and gradient. */
export function seedOf(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0;
  return (Math.abs(h) % 97) + 1;
}

/** "Marina", "Service provider"… in the current language (directory.typeOne.* strings). */
export function useOrgTypeLabel() {
  const { t } = useTranslation();
  return (type: string | null | undefined) => {
    const key = type && ['marina', 'partner', 'investor', 'developer', 'media_partner'].includes(type) ? type : 'organization';
    const fallback: Record<string, string> = {
      marina: 'Marina',
      partner: 'Service provider',
      investor: 'Investor',
      developer: 'Developer',
      media_partner: 'Media',
      organization: 'Organization',
    };
    return t(`directory.typeOne.${key}`, fallback[key]);
  };
}

function initialsOf(name: string): string {
  const words = name
    .replace(/[^\p{L}\p{N}\s&-]/gu, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 0 && !/^(the|de|la|le|du|di|of|and|&|-)$/i.test(w));
  const first = words[0]?.[0] ?? name[0] ?? '?';
  const second = words[1]?.[0] ?? '';
  return `${first}${second}`.toUpperCase();
}

/** Logo tile (12 px radius). Falls back to initials on the type's colour. */
export function LogoTile({
  src,
  name,
  type,
  size = 56,
  className,
}: {
  src?: string | null;
  name: string;
  type?: string | null;
  size?: number;
  className?: string;
}) {
  const [failed, setFailed] = useState(false);
  const tone = orgTypeTone(type);
  const style = { width: size, height: size };
  if (src && !failed) {
    return (
      <span style={style} className={cn('grid shrink-0 place-items-center overflow-hidden rounded-field border border-rule bg-white p-1.5', className)}>
        <img src={src} alt="" loading="lazy" onError={() => setFailed(true)} className="max-h-full max-w-full object-contain" />
      </span>
    );
  }
  return (
    <span
      aria-hidden="true"
      style={style}
      className={cn('grid shrink-0 place-items-center rounded-field text-white', TYPE_BG[tone], className)}
    >
      <span className={cn('font-semibold tracking-[0.02em]', size < 52 ? 'text-[15px]' : 'text-[17px]')}>{initialsOf(name)}</span>
    </span>
  );
}

/**
 * The card's top half: the cover (its children are laid over it: badges, the
 * round arrow, a star), the bar in the type's colour, and the logo straddling
 * both. Must sit directly inside a `CardShell` (the logo is positioned against
 * it); follow it with a body that starts with `pt-9`.
 */
export function OrgCover({
  id,
  type,
  name,
  logoUrl,
  children,
}: {
  /** Anything stable per organisation (its id): picks the gradient and the sounding lines. */
  id: string;
  type?: string | null;
  name: string;
  logoUrl?: string | null;
  children?: ReactNode;
}) {
  const tone = orgTypeTone(type);
  const seed = seedOf(id);
  const gradients = COVER_GRADIENTS[tone];
  const [from, to] = gradients[seed % gradients.length];
  const Icon = TYPE_ICON[type ?? ''] ?? Building2;
  return (
    <>
      <div className="relative h-32 shrink-0 overflow-hidden">
        <div className="dir-cover-art absolute inset-0" style={{ background: `linear-gradient(135deg, ${from}, ${to})` }}>
          <BathyPattern seed={seed} rings={6} opacity={0.1} className="dir-cover-lines absolute -inset-4" />
          <Icon aria-hidden="true" className="absolute bottom-4 right-16 h-14 w-14 text-white/[.12]" strokeWidth={1.5} />
        </div>
        {children}
      </div>
      <div className="dir-card-bar h-1 shrink-0" style={{ background: TYPE_RGB[tone] }} />
      <LogoTile src={logoUrl} name={name} type={type} size={56} className="pointer-events-none absolute left-5 top-[104px] z-[2]" />
    </>
  );
}

/** "Verified member": the white pill on a cover, with the shield. */
export function VerifiedPill({ className }: { className?: string }) {
  const { t } = useTranslation();
  return (
    <span
      title={t('brand.card.verifiedTitle', 'Checked by the M3 team')}
      className={cn(
        'inline-flex h-[22px] items-center gap-[5px] whitespace-nowrap rounded-badge bg-white px-2 text-[11px] font-semibold uppercase leading-none tracking-[0.05em] text-navy',
        className,
      )}
    >
      <ShieldCheck className="h-[13px] w-[13px] text-teal" strokeWidth={2.25} aria-hidden="true" />
      {t('brand.card.verified', 'Verified member')}
    </span>
  );
}

/** "Verified member" as a small badge (teal-text #196a7a on foam: 5.5:1). */
export function VerifiedBadge({ className, tone = 'light' }: { className?: string; tone?: 'light' | 'dark' }) {
  const { t } = useTranslation();
  return (
    <span
      title={t('brand.card.verifiedTitle', 'Checked by the M3 team')}
      className={cn(
        'inline-flex items-center gap-1 rounded-badge px-1.5 py-0.5 text-[12px] font-semibold leading-4',
        tone === 'dark' ? 'bg-white/10 text-white' : 'bg-foam text-teal-text',
        className,
      )}
    >
      <BadgeCheck className="h-3.5 w-3.5" aria-hidden="true" />
      {t('brand.card.verified', 'Verified member')}
    </span>
  );
}

export function OrgCard({
  id,
  name,
  href,
  type,
  logoUrl,
  city,
  country,
  description,
  verified = false,
  footerStart,
  className,
}: {
  /** The organisation's id: keeps its cover the same as in the directory. Falls back to the name. */
  id?: string;
  name: string;
  href: string;
  /** organizations.organization_type (marina, partner, investor, developer, media_partner…). */
  type?: string | null;
  logoUrl?: string | null;
  city?: string | null;
  country?: string | null;
  description?: string | null;
  verified?: boolean;
  /** Left of the footer row (e.g. a shortlist button). Give it `relative z-10`. */
  footerStart?: ReactNode;
  className?: string;
}) {
  const { t } = useTranslation();
  const typeLabel = useOrgTypeLabel();
  const tone = orgTypeTone(type);
  const place = [city, country].filter(Boolean).join(', ');
  return (
    <CardShell interactive className={cn('min-w-0', className)}>
      <OrgCover id={id ?? name} type={type} name={name} logoUrl={logoUrl}>
        {verified && (
          <div className="pointer-events-none absolute left-3 right-[60px] top-3 z-[2] flex flex-wrap gap-1.5">
            <VerifiedPill />
          </div>
        )}
        <span aria-hidden="true" className="pointer-events-none absolute right-3 top-3 z-[2]">
          <ArrowDisc tone="photo" size="sm" />
        </span>
      </OrgCover>

      <div className="flex flex-1 flex-col px-5 pb-5 pt-9">
        <h3 className="text-card-title text-navy">
          <StretchedLink to={href} className="line-clamp-2">{name}</StretchedLink>
        </h3>

        <p className="mt-1.5 flex items-center gap-2 text-sm leading-5 text-meta">
          <span aria-hidden="true" className="h-2 w-2 shrink-0 rounded-pill" style={{ background: TYPE_RGB[tone] }} />
          <span className="flex min-w-0 items-center gap-1">
            <span className="shrink-0">{typeLabel(type)}</span>
            {place && (
              <>
                <span aria-hidden="true">·</span>
                <MapPin className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                <span className="truncate">{place}</span>
              </>
            )}
          </span>
        </p>

        {description && <p className="mt-3 line-clamp-2 text-sm leading-5 text-[#374151]">{description}</p>}

        <div className="mt-auto flex items-end justify-between gap-3 pt-[18px]">
          {footerStart ?? <span />}
          <span aria-hidden="true" className="dir-see uline uline--plain shrink-0 text-sm">
            <span className="uline-t">{t('directory.viewProfile', 'View profile')}</span>
          </span>
        </div>
      </div>
    </CardShell>
  );
}
