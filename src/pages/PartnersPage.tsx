import { useState, useEffect, useMemo } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Seo } from '@/components/seo/Seo';
import type { LucideIcon } from 'lucide-react';
import {
  Anchor, ArrowRight, Briefcase, Building2, Compass, HardHat, HeartHandshake, MapPin, Mail,
  Newspaper, Search, TrendingUp, X,
} from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { supabase } from '@/lib/supabase';
import { LoadingSkeleton } from '@/components/LoadingSkeleton';
import { BookmarkButton } from '@/components/shortlist/BookmarkButton';
import { PageHero } from '@/components/ui/PageHero';
import { CoverImage, LogoBadge } from '@/components/ui/CoverImage';
import { SponsorBadge } from '@/components/ui/SponsorBadge';
import { SITE_IMAGES } from '@/lib/siteMedia';
import { SPONSOR_TIERS, type OrgTier } from '@/types/database';
import { cn } from '@/lib/utils';
import { withSiteSuffix } from '@/lib/seoText';

/**
 * /partners — the companies backing the ecosystem.
 *
 * Who is listed has not changed: every verified organization on a paying tier
 * (whatever its type), plus media outlets an admin has tagged as event media
 * partners. What changed is the presentation: a header band, the paying
 * partners first, then the media partners, as cards matching the directory's,
 * and a clear way to the directory for every other organization — this page
 * was a dead end for anyone looking for a marina or a free member.
 *
 * The search lives in the URL (?q=), replacing history while typing.
 */

interface SectorRef {
  id: string;
  slug: string;
  label: string;
}

interface OrgCard {
  id: string;
  slug: string;
  name: string;
  organization_type: string;
  description: string | null;
  website: string | null;
  country: string | null;
  city: string | null;
  headquarters_country: string | null;
  logo_url: string | null;
  /** banner_url, else the first gallery picture, else null (gradient). */
  cover_url: string | null;
  tier: OrgTier;
  is_event_media_partner: boolean;
  sectors: SectorRef[];
}

type TypeKey = 'marina' | 'partner' | 'investor' | 'developer' | 'media_partner';

const TYPE_META: Record<TypeKey, { icon: LucideIcon; oneKey: string; oneFallback: string; manyKey: string; manyFallback: string }> = {
  marina: { icon: Anchor, oneKey: 'partnersPage.typeOne.marina', oneFallback: 'Marina', manyKey: 'partnersPage.types.marina', manyFallback: 'Marinas' },
  partner: { icon: Briefcase, oneKey: 'partnersPage.typeOne.partner', oneFallback: 'Service provider', manyKey: 'partnersPage.types.partner', manyFallback: 'Service providers' },
  investor: { icon: TrendingUp, oneKey: 'partnersPage.typeOne.investor', oneFallback: 'Investor', manyKey: 'partnersPage.types.investor', manyFallback: 'Investors' },
  developer: { icon: HardHat, oneKey: 'partnersPage.typeOne.developer', oneFallback: 'Developer', manyKey: 'partnersPage.types.developer', manyFallback: 'Developers' },
  media_partner: { icon: Newspaper, oneKey: 'partnersPage.typeOne.media_partner', oneFallback: 'Media', manyKey: 'partnersPage.types.media_partner', manyFallback: 'Media' },
};
const TYPE_KEYS = Object.keys(TYPE_META) as TypeKey[];
const typeMeta = (type: string | null | undefined) => (type && type in TYPE_META ? TYPE_META[type as TypeKey] : null);

/** Biggest packages first. */
const TIER_ORDER: Record<string, number> = {
  main_sponsor: 0, premium_sponsor: 1, premium_partner: 2, associate_partner: 3, innovation_partner: 4, member: 5,
};

/** The media section: outlets an admin tagged as our event media partners. */
const isMediaPartner = (p: OrgCard) => p.organization_type === 'media_partner' && p.is_event_media_partner;

const focusRing = 'focus:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2';

export function PartnersPage() {
  const { t } = useTranslation();
  const [params, setParams] = useSearchParams();
  const [partners, setPartners] = useState<OrgCard[]>([]);
  const [typeCounts, setTypeCounts] = useState<Record<string, number> | null>(null);
  const [loading, setLoading] = useState(true);

  const search = params.get('q') ?? '';
  const setSearch = (value: string) => {
    const next = new URLSearchParams(params);
    if (value) next.set('q', value);
    else next.delete('q');
    // Typing replaces history; the back button should not replay each keystroke.
    setParams(next, { replace: true });
  };
  const clearSearch = () => {
    const next = new URLSearchParams(params);
    next.delete('q');
    setParams(next);
  };

  useEffect(() => {
    let alive = true;
    const fetchPartners = async () => {
      setLoading(true);
      try {
        // Every verified organisation on a paying tier (innovation_partner and
        // up), whatever kind of company it is. The tier is what makes someone a
        // partner here, not their type: this used to require organization_type
        // 'partner', which quietly hid a marina, a destination or a port
        // authority that had bought a tier — and those are exactly the sponsors
        // this event attracts. Free Member-tier orgs stay out of the directory.
        const COLS = 'id, slug, name, organization_type, website, country, city, headquarters_country, description, logo_url, banner_url, gallery, access_status, tier, is_event_media_partner';
        // A media outlet is only shown HERE once an admin has tagged it as one of
        // our media partners. Accredited press that isn't a partner keeps a normal
        // company profile and lives in the network directory, not on this page.
        const [partnerRes, mediaRes, typeRes] = await Promise.all([
          supabase.from('organizations').select(COLS)
            .eq('access_status', 'verified').in('tier', SPONSOR_TIERS),
          supabase.from('organizations').select(COLS)
            .eq('access_status', 'verified').eq('organization_type', 'media_partner')
            .eq('is_event_media_partner', true),
          // For the "everyone else is in the directory" band: one light row per org.
          supabase.from('organizations').select('organization_type').eq('access_status', 'verified'),
        ]);
        if (!alive) return;

        if (!typeRes.error && typeRes.data) {
          const counts: Record<string, number> = { all: typeRes.data.length };
          for (const row of typeRes.data as { organization_type: string | null }[]) {
            const k = row.organization_type ?? '';
            counts[k] = (counts[k] || 0) + 1;
          }
          setTypeCounts(counts);
        }

        if (partnerRes.error) throw partnerRes.error;
        // A media partner on a paying tier matches both queries; keep one card.
        type OrgRow = {
          id: string; slug: string; name: string; organization_type: string; website: string | null;
          country: string | null; city: string | null; headquarters_country: string | null;
          description: string | null; logo_url: string | null; banner_url: string | null; gallery: unknown;
          tier: string | null; is_event_media_partner: boolean | null;
        };
        const byId = new Map<string, OrgRow>();
        for (const o of [...((partnerRes.data || []) as OrgRow[]), ...((mediaRes.data || []) as OrgRow[])]) byId.set(o.id, o);
        const orgRows = [...byId.values()];
        if (orgRows.length === 0) {
          setPartners([]);
          return;
        }

        // Get sector mappings from organization_service_sectors
        const orgIds = orgRows.map((o) => o.id);
        const { data: sectorLinks } = await supabase
          .from('organization_service_sectors')
          .select('organization_id, sector_id, sectors(id, slug, label)')
          .in('organization_id', orgIds);
        if (!alive) return;

        const sectorMap: Record<string, SectorRef[]> = {};
        if (sectorLinks) {
          for (const link of sectorLinks as unknown as { organization_id: string; sector_id: string; sectors: SectorRef | null }[]) {
            const oid = link.organization_id;
            if (!sectorMap[oid]) sectorMap[oid] = [];
            if (link.sectors) {
              sectorMap[oid].push({ id: link.sectors.id, slug: link.sectors.slug, label: link.sectors.label });
            }
          }
        }

        const cards: OrgCard[] = orgRows.map((o) => {
          const gallery = Array.isArray(o.gallery)
            ? (o.gallery as unknown[]).filter((u): u is string => typeof u === 'string' && u.length > 0)
            : [];
          return {
            id: o.id,
            slug: o.slug,
            name: o.name,
            organization_type: o.organization_type,
            website: o.website,
            country: o.country,
            city: o.city,
            headquarters_country: o.headquarters_country,
            description: o.description,
            logo_url: o.logo_url || null,
            cover_url: o.banner_url || gallery[0] || null,
            tier: (o.tier || 'member') as OrgTier,
            is_event_media_partner: !!o.is_event_media_partner,
            sectors: sectorMap[o.id] || [],
          };
        });

        cards.sort((a, b) => (TIER_ORDER[a.tier] ?? 9) - (TIER_ORDER[b.tier] ?? 9) || a.name.localeCompare(b.name));
        setPartners(cards);
      } catch (err) {
        if (import.meta.env.DEV) console.error('Error fetching partners:', err);
      } finally {
        if (alive) setLoading(false);
      }
    };

    fetchPartners();
    return () => { alive = false; };
  }, []);

  const sectorLabel = (s: SectorRef) => t(`sectorNames.${s.slug}`, s.label);

  const filteredPartners = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return partners;
    return partners.filter((p) =>
      p.name.toLowerCase().includes(q) ||
      (p.headquarters_country || '').toLowerCase().includes(q) ||
      (p.country || '').toLowerCase().includes(q) ||
      (p.city || '').toLowerCase().includes(q) ||
      (p.description || '').toLowerCase().includes(q) ||
      // Both the database label and the translated name, so a French search finds it too.
      p.sectors.some((s) => s.label.toLowerCase().includes(q) || t(`sectorNames.${s.slug}`, s.label).toLowerCase().includes(q)),
    );
  }, [partners, search, t]);

  const featured = filteredPartners.filter((p) => !isMediaPartner(p));
  const media = filteredPartners.filter(isMediaPartner);
  const searching = search.trim().length > 0;

  const typeLinks = typeCounts
    ? TYPE_KEYS.filter((k) => (typeCounts[k] ?? 0) > 0).map((k) => ({ key: k, count: typeCounts[k], ...TYPE_META[k] }))
    : [];

  const seoTitle = withSiteSuffix(t('seo.partners.title', 'Event partners and sponsors'));
  const seoDescription = t('seo.partners.description', 'Main Sponsor, Premium Sponsor and the other partners of the industry events M3 Monaco organises in Monaco, Dubai and online.');

  return (
    <div className="min-h-screen bg-gray-50 pb-16">
      <Seo title={seoTitle} description={seoDescription} path="/partners" />

      <PageHero
        image={SITE_IMAGES.partnersHero}
        seed="partners-hero"
        icon={HeartHandshake}
        eyebrow={t('partnersPage.eyebrow', 'Sponsors')}
        title={t('partners.title', 'Our event partners')}
        subtitle={t('partners.subtitle', 'The companies that sponsor the industry events M3 Monaco organises, listed by tier.')}
      >
        {/* A real form, so Enter on a phone keyboard closes it. */}
        <form
          role="search"
          className="relative max-w-xl"
          onSubmit={(e) => {
            e.preventDefault();
            (document.activeElement as HTMLElement | null)?.blur();
          }}
        >
          <Search className="absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-gray-400" aria-hidden="true" />
          <Input
            type="search"
            enterKeyHint="search"
            aria-label={t('partnersPage.search', 'Search by name, country, sector…')}
            placeholder={t('partnersPage.search', 'Search by name, country, sector…')}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="h-12 rounded-full border-0 bg-white pl-12 pr-4 text-base text-gray-800 shadow-lg placeholder:text-gray-500"
          />
        </form>
      </PageHero>

      <div className="mx-auto w-full max-w-7xl px-4 sm:px-6 pt-8">
        {/* Result count + the chip that undoes the search. */}
        {!loading && partners.length > 0 && (
          <div className="mb-6 flex flex-wrap items-center gap-2">
            <span className="text-sm font-medium text-gray-900" aria-live="polite">
              {t('partnersPage.results', { count: filteredPartners.length, defaultValue: '{{count}} companies' })}
            </span>
            {searching && (
              <button
                type="button"
                onClick={clearSearch}
                className={cn('inline-flex min-h-10 items-center gap-1.5 rounded-full bg-primary px-3.5 text-sm font-medium text-white shadow-sm hover:bg-primary/90', focusRing)}
              >
                <span className="max-w-[14rem] truncate">“{search.trim()}”</span>
                <X className="h-3.5 w-3.5" aria-hidden="true" />
                <span className="sr-only">{t('partnersPage.clearSearch', 'Clear search')}</span>
              </button>
            )}
          </div>
        )}

        {loading ? (
          <LoadingSkeleton variant="card" count={3} />
        ) : filteredPartners.length === 0 ? (
          <div className="rounded-2xl bg-white px-6 py-16 text-center shadow-sm ring-1 ring-gray-100">
            <div className="mb-4 inline-flex h-16 w-16 items-center justify-center rounded-full bg-gray-100">
              <Building2 className="h-8 w-8 text-gray-400" aria-hidden="true" />
            </div>
            <p className="text-lg text-gray-600">
              {partners.length === 0
                ? t('partnersPage.noPartners', 'No partners yet. Check back soon!')
                : t('partnersPage.noMatch', 'No partners match your search.')}
            </p>
            {partners.length > 0 && (
              <Button variant="outline" className="mt-4 min-h-10" onClick={clearSearch}>
                {t('partnersPage.clearSearch', 'Clear search')}
              </Button>
            )}
          </div>
        ) : (
          <>
            {featured.length > 0 && (
              <section aria-labelledby="partners-featured-heading">
                <SectionTitle
                  id="partners-featured-heading"
                  icon={HeartHandshake}
                  title={t('partnersPage.featuredTitle', 'Sponsors')}
                  subtitle={t('partnersPage.featuredSubtitle', "Companies that support M3's events through a sponsorship package.")}
                />
                <ul className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
                  {featured.map((p) => (
                    <li key={p.id}><PartnerCard partner={p} featured sectorLabel={sectorLabel} /></li>
                  ))}
                </ul>
              </section>
            )}

            {media.length > 0 && (
              <section aria-labelledby="partners-media-heading" className={cn(featured.length > 0 && 'mt-12')}>
                <SectionTitle
                  id="partners-media-heading"
                  icon={Newspaper}
                  title={t('partnersPage.mediaTitle', 'Media')}
                  subtitle={t('partnersPage.mediaSubtitle', 'The publications that cover our events and the industry.')}
                />
                <ul className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
                  {media.map((p) => (
                    <li key={p.id}><PartnerCard partner={p} sectorLabel={sectorLabel} /></li>
                  ))}
                </ul>
              </section>
            )}
          </>
        )}

        {/* ── Everyone else lives in the directory ── */}
        <section
          aria-labelledby="partners-directory-heading"
          className="relative mt-12 overflow-hidden rounded-2xl text-white shadow-sm"
        >
          <CoverImage
            src={SITE_IMAGES.directoryHero.src}
            focusY={SITE_IMAGES.directoryHero.focusY}
            alt=""
            seed="partners-directory"
            icon={Compass}
            aspect="fill"
            tone="sea"
            className="absolute inset-0"
          />
          <div aria-hidden="true" className="absolute inset-0 bg-gradient-to-r from-[#0b2653]/95 via-[#0b2653]/85 to-[#0b2653]/60" />
          <div className="relative p-6 sm:p-8 lg:p-10">
            <div className="max-w-2xl">
              <h2 id="partners-directory-heading" className="text-2xl font-bold tracking-tight">
                {t('partnersPage.directoryTitle', 'Looking for someone else?')}
              </h2>
              <p className="mt-2 text-white/85">
                {typeCounts
                  ? t('partnersPage.directoryBody', {
                    count: typeCounts.all,
                    defaultValue: 'The directory lists all {{count}} organizations on Smart Marina Connect — marinas, service providers, investors and media.',
                  })
                  : t('partnersPage.directoryBodyNoCount', 'Every organization on Smart Marina Connect is listed in the directory.')}
              </p>
            </div>
            {typeLinks.length > 0 && (
              <ul className="mt-5 flex flex-wrap gap-2">
                {typeLinks.map((tl) => (
                  <li key={tl.key}>
                    <Link
                      to={`/directory?type=${tl.key}`}
                      className="inline-flex min-h-10 items-center gap-1.5 rounded-full bg-white/15 px-3.5 text-sm font-medium text-white backdrop-blur-sm transition hover:bg-white/25 focus:outline-none focus-visible:ring-2 focus-visible:ring-white"
                    >
                      <tl.icon className="h-4 w-4" aria-hidden="true" />
                      {t(tl.manyKey, tl.manyFallback)}
                      <span className="tabular-nums text-white/80">{tl.count}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
            <Button asChild variant="secondary" className="mt-6 h-auto min-h-11 whitespace-normal rounded-full px-5 font-semibold">
              <Link to="/directory">
                {t('partnersPage.directoryCta', 'Open the directory')}
                <ArrowRight className="ml-2 h-4 w-4 shrink-0" aria-hidden="true" />
              </Link>
            </Button>
          </div>
        </section>

        {/* ── Join the partners ── Event sponsorship is sold by the M3 team, so the
            card opens the contact form on that subject. */}
        <div className="mt-6 grid gap-6 md:grid-cols-2">
          <CtaCard
            icon={HeartHandshake}
            title={t('partnersPage.becomeTitle', 'Sponsor an event')}
            body={t('partnersPage.becomeBody', "Put your company in front of marinas at M3's events in Monaco, Dubai and online.")}
            to="/contact?subject=partnership"
            cta={t('partnersPage.becomeCta', 'Contact the M3 team')}
          />
          <CtaCard
            icon={Mail}
            title={t('partnersPage.mediaCtaTitle', 'Are you a media outlet?')}
            body={t('partnersPage.mediaCtaBody', 'Talk to us about covering our events and getting press accreditation.')}
            to="/contact?subject=media"
            cta={t('partnersPage.mediaCtaCta', 'Contact us')}
          />
        </div>
      </div>
    </div>
  );
}

/* ─── Pieces ─────────────────────────────────────────────────────── */

function SectionTitle({ id, icon: Icon, title, subtitle }: { id: string; icon: LucideIcon; title: string; subtitle: string }) {
  return (
    <div className="mb-5 flex items-start gap-3">
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/5 text-primary">
        <Icon className="h-5 w-5" aria-hidden="true" />
      </span>
      <div>
        <h2 id={id} className="text-xl font-bold text-gray-900">{title}</h2>
        <p className="mt-0.5 text-sm text-gray-600">{subtitle}</p>
      </div>
    </div>
  );
}

/**
 * One partner, in the directory's card language. The name is the link and
 * stretches over the whole card, so the shortlist star can sit inside it
 * without nesting interactive elements in an <a>.
 */
function PartnerCard({
  partner, featured = false, sectorLabel,
}: {
  partner: OrgCard;
  featured?: boolean;
  sectorLabel: (s: SectorRef) => string;
}) {
  const { t } = useTranslation();
  const meta = typeMeta(partner.organization_type);
  const TypeIcon = meta?.icon ?? Building2;
  const location = [partner.city, partner.headquarters_country || partner.country].filter(Boolean).join(', ');
  const isPress = partner.organization_type === 'media_partner';

  return (
    <article
      className={cn(
        'group relative flex h-full flex-col overflow-hidden rounded-2xl bg-white shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md',
        featured ? 'ring-2 ring-secondary/60' : 'ring-1 ring-gray-100',
        'has-[a:focus-visible]:ring-2 has-[a:focus-visible]:ring-primary',
      )}
    >
      <CoverImage
        src={partner.cover_url}
        alt=""
        seed={partner.id}
        icon={TypeIcon}
        aspect="banner"
        imageClassName="group-hover:scale-105"
      >
        {/* Above the stretched link, so the star toggles instead of navigating. */}
        <div className="absolute right-2 top-2 z-20">
          <BookmarkButton
            organizationId={partner.id}
            organizationName={partner.name}
            className="h-10 w-10 bg-white/95 shadow-sm hover:bg-white"
          />
        </div>
      </CoverImage>

      <div className="flex flex-1 flex-col px-4 pb-4">
        {/* Positioned, so it paints over the cover it overlaps. */}
        <div className="relative -mt-8 mb-2 w-fit">
          <LogoBadge src={partner.logo_url} name={partner.name} size="lg" className="shadow-sm ring-4 ring-white" />
        </div>

        <h3 className="font-semibold leading-snug text-gray-900">
          <Link
            to={`/organizations/${partner.slug}`}
            className="after:absolute after:inset-0 after:content-[''] focus:outline-none group-hover:text-primary"
          >
            {partner.name}
          </Link>
        </h3>

        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
          {/* Media outlets are listed as press, not as a sponsor tier. */}
          {isPress ? (
            <span className="inline-flex items-center gap-1 rounded-full border border-gray-300 px-2 py-0.5 text-[11px] font-semibold text-gray-700">
              <Newspaper className="h-3 w-3" aria-hidden="true" />
              {t('partnersPage.press', 'Press')}
            </span>
          ) : (
            <SponsorBadge tier={partner.tier} size="sm" />
          )}
          {partner.is_event_media_partner && (
            <span className="inline-flex items-center rounded-full border border-indigo-200 bg-indigo-50 px-2 py-0.5 text-[11px] font-semibold text-indigo-700">
              {t('partnersPage.mediaPartner', 'Media')}
            </span>
          )}
        </div>

        <p className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-gray-600">
          <span className="inline-flex items-center gap-1">
            <TypeIcon className="h-3.5 w-3.5" aria-hidden="true" />
            {meta ? t(meta.oneKey, meta.oneFallback) : t('partnersPage.typeOne.organization', 'Organization')}
          </span>
          {location && (
            <span className="inline-flex min-w-0 items-center gap-1">
              <MapPin className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              <span className="truncate">{location}</span>
            </span>
          )}
        </p>

        {partner.sectors.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-1.5">
            {partner.sectors.slice(0, 2).map((s) => (
              <span key={s.id} className="inline-flex max-w-full items-center rounded-full bg-primary/5 px-2.5 py-1 text-xs font-medium text-primary">
                <span className="truncate">{sectorLabel(s)}</span>
              </span>
            ))}
            {partner.sectors.length > 2 && (
              <span className="inline-flex items-center rounded-full bg-gray-100 px-2 py-1 text-xs font-medium text-gray-600">
                +{partner.sectors.length - 2}
              </span>
            )}
          </div>
        )}

        {partner.description && (
          <p className="mt-3 line-clamp-2 text-sm leading-relaxed text-gray-600">{partner.description}</p>
        )}

        <div className="mt-auto pt-4">
          <div className="flex items-center justify-end border-t border-gray-100 pt-3">
            <span className="inline-flex items-center gap-1 text-sm font-medium text-primary">
              {t('partnersPage.viewProfile', 'View profile')}
              <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" aria-hidden="true" />
            </span>
          </div>
        </div>
      </div>
    </article>
  );
}

function CtaCard({
  icon: Icon, title, body, to, cta,
}: {
  icon: LucideIcon;
  title: string;
  body: string;
  to: string;
  cta: string;
}) {
  return (
    <Link
      to={to}
      className={cn('group flex gap-4 rounded-2xl bg-white p-5 shadow-sm ring-1 ring-gray-100 transition hover:-translate-y-0.5 hover:shadow-md sm:p-6', focusRing)}
    >
      <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-secondary/15 text-secondary-dark">
        <Icon className="h-5 w-5" aria-hidden="true" />
      </span>
      <span className="min-w-0">
        <span className="block font-semibold text-gray-900">{title}</span>
        <span className="mt-1 block text-sm text-gray-600">{body}</span>
        <span className="mt-3 inline-flex items-center gap-1 text-sm font-semibold text-primary transition-all group-hover:gap-2">
          {cta}
          <ArrowRight className="h-4 w-4" aria-hidden="true" />
        </span>
      </span>
    </Link>
  );
}
