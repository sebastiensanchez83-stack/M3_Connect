import { useState, useEffect, useMemo } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Seo } from '@/components/seo/Seo';
import type { LucideIcon } from 'lucide-react';
import {
  Anchor, Briefcase, HardHat, HeartHandshake, MapPin, Newspaper, TrendingUp, X,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { supabase } from '@/lib/supabase';
import { BookmarkButton } from '@/components/shortlist/BookmarkButton';
import { PageHero } from '@/components/ui/PageHero';
import { SITE_IMAGES } from '@/lib/siteMedia';
import { SPONSOR_TIERS, TIER_LABELS, type OrgTier } from '@/types/database';
import { cn } from '@/lib/utils';
import { withSiteSuffix } from '@/lib/seoText';
import { Reveal, RevealGroup } from '@/components/motion/Reveal';
import { LineReveal } from '@/components/motion/LineReveal';
import { BgRevealPanel } from '@/components/brand/BgRevealPanel';
import { CardShell, StretchedLink } from '@/components/brand/CardShell';
import { ContactCard } from '@/components/brand/ContactCard';
import { Eyebrow } from '@/components/brand/Eyebrow';
import { TYPE_RGB, orgTypeTone } from '@/components/brand/OrgCard';
import { SearchField } from '@/components/brand/SearchField';
import { UnderlineLink } from '@/components/brand/UnderlineLink';
import { registerOrgRefonteStrings } from '@/i18n/refonte-org';

registerOrgRefonteStrings();

/**
 * /partners — the companies that sponsor M3's events (refonte v2).
 *
 * Who is listed has not changed: every verified organization on a paying tier
 * (whatever its type), plus media outlets an admin has tagged as event media
 * partners. "Partners" are paying event sponsors and nobody else, so the page
 * reads like the sponsors band of the home page, in full:
 *
 *   - a compact banner with the search (?q=, replacing history while typing);
 *   - the sponsors grouped by tier, highest first (Main Sponsor down to
 *     Innovation Partner). A tier shows once at least one of its sponsors has a
 *     logo; each sponsor sits on a card of the same shape, its logo normalised
 *     in a fixed box (never stretched, never cropped), with the shortlist star,
 *     the type and place, and up to two sectors. A sponsor of a tier without a
 *     single logo yet is not listed here (same rule as the home page);
 *   - the media outlets that cover the events, then a band that sends everyone
 *     else to the directory, then the sponsorship panel and the M3 contact.
 *
 * Event sponsorship is sold by the M3 team: "Sponsor an event" opens the
 * contact form on that subject (/contact?subject=partnership).
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

/** Biggest packages first, as on the home page's sponsors band. */
const TIER_ORDER: OrgTier[] = ['main_sponsor', 'premium_sponsor', 'premium_partner', 'associate_partner', 'innovation_partner'];
const TIER_RANK: Record<string, number> = {
  main_sponsor: 0, premium_sponsor: 1, premium_partner: 2, associate_partner: 3, innovation_partner: 4, member: 5,
};

/** The media section: outlets an admin tagged as our event media partners. */
const isMediaPartner = (p: OrgCard) => p.organization_type === 'media_partner' && p.is_event_media_partner;

/** Card shape per tier: how many across, and the height of the logo box. */
const TIER_LOOK: Record<string, { grid: string; box: string; logo: string }> = {
  main_sponsor: { grid: 'sm:grid-cols-2 lg:grid-cols-3', box: 'h-[168px] md:h-[184px]', logo: 'max-h-[84px] md:max-h-24' },
  premium_sponsor: { grid: 'sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4', box: 'h-[148px] md:h-[156px]', logo: 'max-h-[72px] md:max-h-20' },
  premium_partner: { grid: 'sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4', box: 'h-[148px] md:h-[156px]', logo: 'max-h-[72px] md:max-h-20' },
  associate_partner: { grid: 'sm:grid-cols-2 lg:grid-cols-4', box: 'h-[132px] md:h-[140px]', logo: 'max-h-16 md:max-h-[68px]' },
  innovation_partner: { grid: 'sm:grid-cols-2 lg:grid-cols-4', box: 'h-[132px] md:h-[140px]', logo: 'max-h-16 md:max-h-[68px]' },
  media: { grid: 'sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4', box: 'h-[132px] md:h-[140px]', logo: 'max-h-16 md:max-h-[68px]' },
};

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

        cards.sort((a, b) => (TIER_RANK[a.tier] ?? 9) - (TIER_RANK[b.tier] ?? 9) || a.name.localeCompare(b.name));
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

  // Tiers with at least one logo (whatever the search): a tier without any is not shown, as on the home page.
  const logoTiers = useMemo(
    () => TIER_ORDER.filter((tier) => partners.some((p) => !isMediaPartner(p) && p.tier === tier && p.logo_url)),
    [partners],
  );
  const tierGroups = useMemo(
    () => logoTiers
      .map((tier) => ({ tier, items: filteredPartners.filter((p) => !isMediaPartner(p) && p.tier === tier) }))
      .filter((g) => g.items.length > 0),
    [logoTiers, filteredPartners],
  );
  const media = filteredPartners.filter(isMediaPartner);
  const shownCount = tierGroups.reduce((n, g) => n + g.items.length, 0) + media.length;
  const searching = search.trim().length > 0;

  const typeLinks = typeCounts
    ? TYPE_KEYS.filter((k) => (typeCounts[k] ?? 0) > 0).map((k) => ({ key: k, count: typeCounts[k], ...TYPE_META[k] }))
    : [];

  const seoTitle = withSiteSuffix(t('seo.partners.title', 'Event partners and sponsors'));
  const seoDescription = t('seo.partners.description', 'Main Sponsor, Premium Sponsor and the other partners of the industry events M3 Monaco organises in Monaco, Dubai and online.');

  const mediaNo = tierGroups.length > 0 ? '02' : '01';

  return (
    <div className="min-h-screen bg-page">
      <Seo title={seoTitle} description={seoDescription} path="/partners" />

      <PageHero
        image={SITE_IMAGES.partnersHero}
        seed="partners-hero"
        icon={HeartHandshake}
        eyebrow={t('partnersPage.eyebrow', 'Sponsors')}
        title={t('partners.title', 'Our event partners')}
        subtitle={t('partners.subtitle', 'The companies that sponsor the industry events M3 Monaco organises, listed by tier.')}
      >
        <div className="flex max-w-xl flex-col items-start gap-4">
          <SearchField
            className="w-full"
            value={search}
            onValueChange={setSearch}
            // Enter on a phone keyboard closes the keyboard; the list already follows the field.
            onSearch={() => (document.activeElement as HTMLElement | null)?.blur()}
            label={t('partnersPage.search', 'Search by name, country, sector…')}
            placeholder={t('partnersPage.search', 'Search by name, country, sector…')}
          />
          <UnderlineLink to="/contact?subject=partnership" tone="light">
            {t('partnersPage.becomeTitle', 'Sponsor an event')}
          </UnderlineLink>
        </div>
      </PageHero>

      <div className="mx-auto w-full max-w-7xl px-4 pb-16 pt-10 sm:px-6 md:pb-24 md:pt-14">
        {loading ? (
          <div aria-hidden="true" className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {[0, 1, 2].map((i) => <div key={i} className="h-[300px] animate-pulse rounded-card bg-chip/70" />)}
          </div>
        ) : shownCount === 0 ? (
          <div className="rounded-card border border-rule bg-white px-6 py-14 text-center md:py-16">
            <span aria-hidden="true" className="mx-auto grid h-14 w-14 place-items-center rounded-pill bg-foam text-teal">
              <HeartHandshake className="h-6 w-6" strokeWidth={1.75} />
            </span>
            <h2 className="mt-5 text-[20px] font-semibold leading-7 text-navy">
              {!searching
                ? t('partnersPage.noPartners', 'No partners yet. Check back soon!')
                : t('partnersPage.noMatch', 'No partners match your search.')}
            </h2>
            {!searching && (
              <p className="mx-auto mt-2 max-w-[460px] text-[15px] leading-6 text-meta">
                {t('partnersRefonte.emptyHint', 'Sponsors appear here, grouped by tier, as soon as they have a logo and a profile.')}
              </p>
            )}
            <div className="mt-6 flex flex-wrap items-center justify-center gap-x-5 gap-y-3">
              {searching ? (
                <Button variant="ctaNavy" size="sm" arrow={false} onClick={clearSearch}>
                  {t('partnersPage.clearSearch', 'Clear search')}
                </Button>
              ) : (
                <Button asChild variant="cta" size="sm">
                  <Link to="/contact?subject=partnership">{t('partnersPage.becomeTitle', 'Sponsor an event')}</Link>
                </Button>
              )}
            </div>
          </div>
        ) : (
          <>
            {/* Result count + the chip that undoes the search. */}
            <div className="mb-8 flex min-h-9 flex-wrap items-center gap-3">
              <span className="text-sm font-medium text-navy" aria-live="polite">
                {t('partnersPage.results', { count: shownCount, defaultValue: '{{count}} companies' })}
              </span>
              {searching && (
                <button
                  type="button"
                  onClick={clearSearch}
                  className="focus-ring inline-flex h-9 items-center gap-1.5 rounded-pill bg-navy px-3.5 text-sm font-medium text-white transition-colors duration-300 hover:bg-navy-deep"
                >
                  <span className="max-w-[14rem] truncate">“{search.trim()}”</span>
                  <X className="h-3.5 w-3.5" aria-hidden="true" />
                  <span className="sr-only">{t('partnersPage.clearSearch', 'Clear search')}</span>
                </button>
              )}
            </div>

            {tierGroups.length > 0 && (
              <section aria-labelledby="partners-featured-heading">
                <Reveal>
                  <Eyebrow number="01">{t('partnersRefonte.sponsorsEyebrow', 'Event sponsors')}</Eyebrow>
                </Reveal>
                <LineReveal as="h2" id="partners-featured-heading" className="mt-3 text-h2-sm text-navy md:text-h2">
                  {t('partnersPage.featuredTitle', 'Sponsors')}
                </LineReveal>
                <Reveal as="p" delay={120} className="mt-3 max-w-[640px] text-body text-ink">
                  {t('partnersPage.featuredSubtitle', "Companies that support M3's events through a sponsorship package.")}
                </Reveal>

                <div className="mt-10 space-y-12 md:space-y-14">
                  {tierGroups.map((g) => {
                    const look = TIER_LOOK[g.tier];
                    const tierName = t(`sharedUi.sponsorBadge.tiers.${g.tier}`, TIER_LABELS[g.tier]);
                    return (
                      <div key={g.tier} role="group" aria-labelledby={`tier-${g.tier}`}>
                        <Reveal>
                          <h3 id={`tier-${g.tier}`} className="flex items-center gap-3 text-[20px] font-semibold leading-7 tracking-[-0.01em] text-navy">
                            <span aria-hidden="true" className="h-6 w-0.5 bg-gold" />
                            {tierName}
                          </h3>
                        </Reveal>
                        <RevealGroup as="ul" className={cn('mt-5 grid grid-cols-1 gap-5 md:gap-6', look.grid)}>
                          {g.items.map((p) => (
                            <li key={p.id} className="flex">
                              <SponsorCard partner={p} look={look} sectorLabel={sectorLabel} />
                            </li>
                          ))}
                        </RevealGroup>
                      </div>
                    );
                  })}
                </div>
              </section>
            )}

            {media.length > 0 && (
              <section aria-labelledby="partners-media-heading" className={cn(tierGroups.length > 0 ? 'mt-16 md:mt-24' : '')}>
                <Reveal>
                  <Eyebrow number={mediaNo}>{t('partnersPage.mediaTitle', 'Media')}</Eyebrow>
                </Reveal>
                <LineReveal as="h2" id="partners-media-heading" className="mt-3 text-h2-sm text-navy md:text-h2">
                  {t('partnersPage.mediaTitle', 'Media')}
                </LineReveal>
                <Reveal as="p" delay={120} className="mt-3 max-w-[640px] text-body text-ink">
                  {t('partnersPage.mediaSubtitle', 'The publications that cover our events and the industry.')}
                </Reveal>
                <RevealGroup as="ul" className={cn('mt-8 grid grid-cols-1 gap-5 md:gap-6', TIER_LOOK.media.grid)}>
                  {media.map((p) => (
                    <li key={p.id} className="flex">
                      <SponsorCard partner={p} look={TIER_LOOK.media} sectorLabel={sectorLabel} />
                    </li>
                  ))}
                </RevealGroup>
              </section>
            )}
          </>
        )}

        {/* ── Everyone else lives in the directory ── */}
        <Reveal as="section" aria-labelledby="partners-directory-heading" className="mt-16 md:mt-24">
          <div className="rounded-card border border-rule bg-white p-6 md:p-8">
            <div className="flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between lg:gap-10">
              <div className="max-w-[680px]">
                <Eyebrow>{t('nav.directory', 'Directory')}</Eyebrow>
                <h2 id="partners-directory-heading" className="mt-3 text-h2-sm text-navy md:text-[28px] md:leading-9">
                  {t('partnersPage.directoryTitle', 'Looking for someone else?')}
                </h2>
                <p className="mt-3 text-body text-ink">
                  {typeCounts
                    ? t('partnersPage.directoryBody', {
                      count: typeCounts.all,
                      defaultValue: 'The directory lists all {{count}} organizations on Smart Marina Connect — marinas, service providers, investors and media.',
                    })
                    : t('partnersPage.directoryBodyNoCount', 'Every organization on Smart Marina Connect is listed in the directory.')}
                </p>
                {typeLinks.length > 0 && (
                  <ul className="mt-5 flex flex-wrap gap-2">
                    {typeLinks.map((tl) => (
                      <li key={tl.key}>
                        <Link
                          to={`/directory?type=${tl.key}`}
                          className="focus-ring inline-flex min-h-10 items-center gap-2 rounded-pill border border-rule bg-white px-3.5 text-[13px] font-medium text-navy transition-colors duration-300 hover:border-navy/40 md:min-h-9"
                        >
                          <span aria-hidden="true" className="h-2 w-2 shrink-0 rounded-pill" style={{ background: TYPE_RGB[orgTypeTone(tl.key)] }} />
                          {t(tl.manyKey, tl.manyFallback)}
                          <span className="tabular font-normal text-meta">{tl.count}</span>
                        </Link>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              <div className="shrink-0">
                <Button asChild variant="ctaNavy">
                  <Link to="/directory">{t('partnersPage.directoryCta', 'Open the directory')}</Link>
                </Button>
              </div>
            </div>
          </div>
        </Reveal>

        {/* ── Sponsor an event ── Event sponsorship is sold by the M3 team, so the
            button opens the contact form on that subject. */}
        <section aria-labelledby="partners-sponsor-heading" className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-12">
          <BgRevealPanel as="div" bathy bathySeed={9} className="mx-0 px-6 py-8 md:mx-0 md:px-10 md:py-10 lg:col-span-7">
            <Eyebrow tone="onDark">{t('partnersRefonte.closing.eyebrow', 'Sponsorship')}</Eyebrow>
            <h2 id="partners-sponsor-heading" className="mt-3 text-[26px] font-semibold leading-8 tracking-[-0.01em] md:text-[34px] md:leading-[42px]">
              {t('partnersRefonte.closing.title', 'Sponsor an M3 event')}
            </h2>
            <p className="mt-3 max-w-[520px] text-[15px] leading-6 text-white/85">
              {t('partnersPage.becomeBody', "Put your company in front of marinas at M3's events in Monaco, Dubai and online.")}
            </p>
            <div className="mt-7 flex flex-wrap items-center gap-x-6 gap-y-3">
              <Button asChild variant="ctaOnDark">
                <Link to="/contact?subject=partnership">{t('partnersPage.becomeTitle', 'Sponsor an event')}</Link>
              </Button>
              <UnderlineLink to="/contact?subject=media" tone="light">
                {t('partnersRefonte.closing.mediaLink', 'Are you a media outlet?')}
              </UnderlineLink>
            </div>
          </BgRevealPanel>
          <Reveal className="flex lg:col-span-5">
            <ContactCard className="w-full self-stretch" line={t('partnersRefonte.contactLine', 'Sponsorship is handled directly by the M3 team.')} />
          </Reveal>
        </section>
      </div>
    </div>
  );
}

/* ─── Pieces ─────────────────────────────────────────────────────── */

/** A sponsor's logo in its fixed box: contained, never stretched or cropped; the name when it has none (or it fails to load). */
function SponsorLogo({ src, name, logoClass }: { src: string | null; name: string; logoClass: string }) {
  const [failed, setFailed] = useState(false);
  if (src && !failed) {
    return (
      <img
        src={src}
        alt=""
        loading="lazy"
        onError={() => setFailed(true)}
        className={cn('w-auto max-w-[72%] object-contain', logoClass)}
      />
    );
  }
  return <span aria-hidden="true" className="line-clamp-2 max-w-[80%] text-center text-[17px] font-semibold leading-6 text-navy">{name}</span>;
}

/**
 * One sponsor, in the directory's card language: a logo box of the same size for
 * everyone, then the name (the link, stretched over the whole card, so the
 * shortlist star can sit inside it without nesting interactive elements in an
 * <a>), the type and place, and up to two sectors.
 */
function SponsorCard({
  partner, look, sectorLabel,
}: {
  partner: OrgCard;
  look: { box: string; logo: string };
  sectorLabel: (s: SectorRef) => string;
}) {
  const { t } = useTranslation();
  const meta = typeMeta(partner.organization_type);
  const tone = orgTypeTone(partner.organization_type);
  const location = [partner.city, partner.headquarters_country || partner.country].filter(Boolean).join(', ');

  return (
    <CardShell interactive className="h-full w-full min-w-0">
      <div className={cn('card-media relative grid place-items-center border-b border-rule bg-white px-6', look.box)}>
        <SponsorLogo src={partner.logo_url} name={partner.name} logoClass={look.logo} />
        {/* Above the stretched link, so the star toggles instead of navigating. */}
        <div className="absolute right-3 top-3 z-20">
          <BookmarkButton
            organizationId={partner.id}
            organizationName={partner.name}
            className="h-9 w-9 rounded-pill border border-rule bg-white text-navy hover:bg-chip"
          />
        </div>
      </div>

      <div className="flex flex-1 flex-col px-5 pb-5 pt-4">
        <h4 className="text-card-title text-navy">
          <StretchedLink to={`/organizations/${partner.slug}`} className="line-clamp-2 rounded-sm">{partner.name}</StretchedLink>
        </h4>

        <p className="mt-1.5 flex items-center gap-2 text-sm leading-5 text-meta">
          <span aria-hidden="true" className="h-2 w-2 shrink-0 rounded-pill" style={{ background: TYPE_RGB[tone] }} />
          <span className="flex min-w-0 items-center gap-1">
            <span className="shrink-0">{meta ? t(meta.oneKey, meta.oneFallback) : t('partnersPage.typeOne.organization', 'Organization')}</span>
            {location && (
              <>
                <span aria-hidden="true">·</span>
                <MapPin className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                <span className="truncate">{location}</span>
              </>
            )}
          </span>
        </p>

        {partner.description && (
          <p className="mt-3 line-clamp-2 text-sm leading-5 text-[#374151]">{partner.description}</p>
        )}

        {partner.sectors.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-1.5">
            {partner.sectors.slice(0, 2).map((s) => (
              <span key={s.id} className="inline-flex h-6 max-w-full items-center rounded-pill bg-chip px-2.5 text-[12px] font-medium text-navy">
                <span className="truncate">{sectorLabel(s)}</span>
              </span>
            ))}
            {partner.sectors.length > 2 && (
              <span className="inline-flex h-6 items-center rounded-pill bg-chip px-2 text-[12px] font-medium text-meta">
                +{partner.sectors.length - 2}
              </span>
            )}
          </div>
        )}
      </div>
    </CardShell>
  );
}
