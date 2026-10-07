import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { BadgeCheck, Check, MapPin } from 'lucide-react';
import { cn } from '@/lib/utils';
import { BathyPattern } from '@/components/motion/BathyPattern';
import { CardShell, StretchedLink, type OrgTypeTone } from './CardShell';
import { CapArrow } from './CapArrow';

/**
 * The organisation card of the directory and the home page: a "berth card"
 * (fiche d'amarrage), on the shared card grammar.
 *
 *  - A short band of sounding lines across the top, with nothing laid over it.
 *  - The type flown as a small burgee in the type's colour, flush with the
 *    card's left edge, with the type written next to it.
 *  - The logo (or initials) beside the name, in the body.
 *  - A meta row: place, "Verified member" as words with a check, and any extra
 *    facts the page adds (members, sponsor tier).
 *  - A footer row: the page's own action on the left (the shortlist), and
 *    "View profile" followed by the cap needle on the right.
 *
 * The name is the one link and stretches over the whole card.
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

const TYPE_TEXT: Record<OrgTypeTone, string> = {
  marina: 'text-org-marina',
  provider: 'text-org-provider',
  investor: 'text-org-investor',
  media: 'text-org-media',
};
const TYPE_FILL: Record<OrgTypeTone, string> = {
  marina: 'rgb(var(--type-marina))',
  provider: 'rgb(var(--type-provider))',
  investor: 'rgb(var(--type-investor))',
  media: 'rgb(var(--type-media))',
};
const TYPE_BG: Record<OrgTypeTone, string> = {
  marina: 'bg-org-marina',
  provider: 'bg-org-provider',
  investor: 'bg-org-investor',
  media: 'bg-org-media',
};

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

/** A stable number from a string, for the sounding lines' seed. */
export function seedFrom(text: string): number {
  let h = 0;
  for (let i = 0; i < text.length; i++) h = (h * 31 + text.charCodeAt(i)) | 0;
  return Math.abs(h) % 997;
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

/** The berth card's top band: faint sounding lines, nothing laid over them. */
export function BerthBand({ seed, className }: { seed: string; className?: string }) {
  return (
    <div aria-hidden="true" className={cn('relative h-14 shrink-0 overflow-hidden bg-chip', className)}>
      <BathyPattern seed={seedFrom(seed)} rings={6} tone="navy" opacity={0.16} className="absolute inset-0" />
    </div>
  );
}

/** A burgee (swallow-tailed pennant) in the type's colour. */
export function TypePennant({ type, className }: { type?: string | null; className?: string }) {
  const tone = orgTypeTone(type);
  return (
    <svg aria-hidden="true" viewBox="0 0 24 14" className={cn('h-3.5 w-6 shrink-0', className)}>
      <path d="M0 0H24L15 7L24 14H0Z" fill={TYPE_FILL[tone]} />
      <path d="M0 0V14" stroke="rgb(11 38 83)" strokeOpacity="0.5" strokeWidth="1.5" />
    </svg>
  );
}

/** The type line: the pennant flies from the card's left edge (pass the card's padding as `bleed`). */
export function TypeFlagLabel({ type, bleed = 'ml-[-20px]', className }: { type?: string | null; bleed?: string; className?: string }) {
  const typeLabel = useOrgTypeLabel();
  const tone = orgTypeTone(type);
  return (
    <p className={cn('flex items-center gap-2 font-signage text-[13px] font-semibold uppercase leading-4 tracking-[0.1em]', TYPE_TEXT[tone], className)}>
      <TypePennant type={type} className={bleed} />
      {typeLabel(type)}
    </p>
  );
}

/** "Verified member" with the teal check, as words in a meta row. */
export function VerifiedMark({ className, tone = 'light' }: { className?: string; tone?: 'light' | 'dark' }) {
  const { t } = useTranslation();
  return (
    <span
      title={t('brand.card.verifiedTitle', 'Checked by the M3 team')}
      className={cn('inline-flex items-center gap-1 text-[13px] font-medium', tone === 'dark' ? 'text-white/85' : 'text-teal-text', className)}
    >
      <Check className="h-3.5 w-3.5 shrink-0" strokeWidth={2.75} aria-hidden="true" />
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

/** "View profile" and the cap needle: the words of the card's link, repeated in its footer. */
export function ViewProfileCue({ className }: { className?: string }) {
  const { t } = useTranslation();
  return (
    <span aria-hidden="true" className={cn('inline-flex items-center gap-1.5 whitespace-nowrap text-sm font-semibold text-navy', className)}>
      {t('directory.viewProfile', 'View profile')}
      <CapArrow size="sm" />
    </span>
  );
}

export function OrgCard({
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
  const place = [city, country].filter(Boolean).join(', ');
  return (
    <CardShell interactive className={className}>
      <BerthBand seed={name} />
      <div className="flex flex-1 flex-col px-5 pb-4 pt-4">
        <TypeFlagLabel type={type} />
        <div className="mt-3 flex items-start gap-3">
          <LogoTile src={logoUrl} name={name} type={type} size={48} />
          <h3 className="min-w-0 pt-0.5 text-card-title text-navy">
            <StretchedLink to={href} className="line-clamp-2">{name}</StretchedLink>
          </h3>
        </div>
        {(place || verified) && (
          <p className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px] text-meta">
            {place && (
              <span className="inline-flex min-w-0 items-center gap-1">
                <MapPin className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                <span className="truncate">{place}</span>
              </span>
            )}
            {verified && <VerifiedMark />}
          </p>
        )}
        {description && <p className="mt-3 line-clamp-2 text-sm leading-5 text-ink/80">{description}</p>}
        <div className="mt-auto pt-4">
          <div className="flex items-center justify-between gap-3 border-t border-rule pt-3">
            {footerStart ?? <span />}
            <ViewProfileCue />
          </div>
        </div>
      </div>
    </CardShell>
  );
}
