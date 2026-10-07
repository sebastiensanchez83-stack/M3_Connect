import { useTranslation } from 'react-i18next';
import { ArrowRight, Anchor, Building2, Compass, FileText, Mic2, ShieldCheck, TrendingUp, UserPlus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { SITE_IMAGES, PERSONA_IMAGES } from '@/lib/siteMedia';
import { useNetworkFigures } from '@/lib/networkStats';
import {
  Reveal, RevealGroup, LineReveal, Counter, LogoMarquee, BathyPattern, Graticule, WavePanel,
  ChannelSteps, PontoonTimeline, MotionPauseToggle, useMotion,
} from '@/components/motion';
import {
  WaterlineHero, PontoonTag, DepartureBoard, useDepartureRows, SearchField, CapArrow, CardShell, CardMedia,
  StretchedLink, OrgCard, VerifiedBadge, LogoTile, BuoyTabs, BuoyTabsList, BuoyTabsTrigger, BuoyTabsContent,
  EventRoute, Eyebrow, ContactCard, HarbourCoordinates, NewsletterField, pontoonTagItems, eventRouteStops,
} from '@/components/brand';

/**
 * DEV ONLY — /__brand. Every token, primitive and SMC device on one page, for
 * review on the dev server. Registered in App.tsx behind import.meta.env.DEV,
 * so it does not exist in production builds. Sample organisations and sponsors
 * below are placeholders, not real records; the departure board and the
 * figures read the real public data.
 */

const SWATCHES: { name: string; hex: string; cls: string; dark?: boolean }[] = [
  { name: 'navy', hex: '#0b2653', cls: 'bg-navy', dark: true },
  { name: 'navy-deep', hex: '#081d40', cls: 'bg-navy-deep', dark: true },
  { name: 'chip', hex: '#eef2f8', cls: 'bg-chip' },
  { name: 'gold (action)', hex: '#d7a647', cls: 'bg-gold' },
  { name: 'gold-text', hex: '#87681b', cls: 'bg-gold-text', dark: true },
  { name: 'teal', hex: '#1f7a8c', cls: 'bg-teal', dark: true },
  { name: 'foam', hex: '#eaf3f4', cls: 'bg-foam' },
  { name: 'page', hex: '#f6f7f9', cls: 'bg-page' },
  { name: 'rule', hex: '#e3e7ee', cls: 'bg-rule' },
  { name: 'ink', hex: '#1f2937', cls: 'bg-ink', dark: true },
  { name: 'meta', hex: '#5b6475', cls: 'bg-meta', dark: true },
  { name: 'marina', hex: '#0b2653', cls: 'bg-org-marina', dark: true },
  { name: 'service provider', hex: '#1f7a8c', cls: 'bg-org-provider', dark: true },
  { name: 'investor / developer', hex: '#4a6fa5', cls: 'bg-org-investor', dark: true },
  { name: 'media / other', hex: '#64748b', cls: 'bg-org-media', dark: true },
];

function Section({ id, title, note, children, className }: { id: string; title: string; note?: string; children: React.ReactNode; className?: string }) {
  return (
    <section id={id} className={className ?? 'mx-auto max-w-7xl px-4 py-16 sm:px-6'}>
      <p className="text-meta-caps">/__brand · {id}</p>
      <h2 className="mt-2 text-h2-sm text-navy md:text-h2">{title}</h2>
      {note && <p className="mt-2 max-w-3xl text-body text-meta">{note}</p>}
      <div className="mt-8">{children}</div>
    </section>
  );
}

export function BrandShowcasePage() {
  const { t } = useTranslation();
  const { reduced, paused } = useMotion();
  const { rows, loading } = useDepartureRows();
  const { figures } = useNetworkFigures();

  const examples = [t('brand.search.ex1'), t('brand.search.ex2'), t('brand.search.ex3'), t('brand.search.ex4')];

  return (
    <div className="bg-page">
      {/* 1 · Waterline hero with the pontoon tag */}
      <WaterlineHero
        image={SITE_IMAGES.homeHero}
        className="min-h-[600px] md:min-h-[min(88vh,820px)]"
        tag={<PontoonTag items={pontoonTagItems(t)} label={t('brand.tag.label', 'M3 events')} />}
      >
        <div className="max-w-2xl">
          <Eyebrow tone="onDark">Smart Marina Connect · /__brand</Eyebrow>
          <LineReveal as="h1" trigger="mount" delay={500} className="mt-4 text-display-sm text-white md:text-display">
            Marinas and the companies that serve them, in one network
          </LineReveal>
          <p className="mt-5 max-w-xl text-body text-white/85 md:text-body-lg">
            WaterlineHero: wave-edged reveal on load, slow zoom, living waterline, pontoon tag hanging at the bottom right.
          </p>
          <SearchField className="mt-8 max-w-xl" examples={examples} />
          <div className="mt-6 flex flex-wrap gap-3">
            <Button variant="tide">Sign up as a marina <ArrowRight className="h-4 w-4" aria-hidden="true" /></Button>
            <Button variant="tideOutlineLight">Explore the directory</Button>
          </div>
        </div>
      </WaterlineHero>

      {/* 2 · Departure board on the quay edge */}
      <div className="relative z-10 mx-auto max-w-7xl px-4 pt-10 sm:px-6 md:pt-6">
        <div className="md:mr-[360px]">
          <DepartureBoard
            rows={rows}
            loading={loading}
            title={t('brand.board.title', 'Departures')}
            subtitle={t('brand.board.subtitle')}
          />
        </div>
        <p className="mt-3 text-xs text-meta">
          Real data (anonymous read): {loading ? 'loading…' : `${rows.length} rows`}. Motion: {reduced ? 'reduced' : paused ? 'paused' : 'running'}.
        </p>
      </div>

      <Section id="tokens" title="Tokens" note="CSS variables on :root, wired into Tailwind. shadcn names (primary, secondary, muted, accent, border, ring) point at the same tokens.">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          {SWATCHES.map((s) => (
            <div key={s.name} className="overflow-hidden rounded-card border border-rule bg-white">
              <div className={`h-16 ${s.cls}`} />
              <div className="p-3">
                <p className="text-sm font-semibold text-ink">{s.name}</p>
                <p className="text-xs text-meta tabular">{s.hex}</p>
              </div>
            </div>
          ))}
        </div>
        <div className="mt-10 space-y-4 rounded-card border border-rule bg-white p-6">
          <p className="text-display-sm text-navy md:text-display">Display 52/58 · 34/40</p>
          <p className="text-h1-sm text-navy md:text-h1">H1 44/50 · 30/36</p>
          <p className="text-h2-sm text-navy md:text-h2">H2 32/40 · 24/30</p>
          <p className="text-h3 text-navy">H3 22/28</p>
          <p className="text-card-title text-navy">Card title 18/24 600</p>
          <p className="text-body text-ink md:text-body-lg">Body 17/28 · 16/26 — Inter Variable, self-hosted, font-display swap.</p>
          <p className="text-meta-caps">Meta 12/16 caps .06em 500</p>
          <p className="text-figure text-navy tabular">1,234</p>
          <p className="font-wordmark text-xl font-semibold text-navy">Smart Marina Connect (Outfit 600 wordmark)</p>
          <p className="text-gold-text text-sm font-semibold">Gold text #87681b on white</p>
        </div>
      </Section>

      <Section id="buttons" title="Tide buttons (marée) and the original variants" note="Hover or Tab onto them: the water rises with a wavy edge, the text turns as it passes, the arrow nudges 3 px. The shadcn variants below are untouched (admin screens).">
        <div className="flex flex-wrap items-center gap-3">
          <Button variant="tide">Main action <ArrowRight className="h-4 w-4" aria-hidden="true" /></Button>
          <Button variant="tideNavy">Secondary <ArrowRight className="h-4 w-4" aria-hidden="true" /></Button>
          <Button variant="tideOutline">Outline</Button>
          <Button variant="tide" size="sm">Small</Button>
          <Button variant="tide" size="lg">Large <ArrowRight className="h-5 w-5" aria-hidden="true" /></Button>
          <Button variant="tide" disabled>Disabled</Button>
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-3 rounded-card bg-navy p-6">
          <Button variant="tideLight">On navy / photo <ArrowRight className="h-4 w-4" aria-hidden="true" /></Button>
          <Button variant="tideOutlineLight">Outline on dark</Button>
          <Button variant="tide">Main action</Button>
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <Button>default</Button>
          <Button variant="secondary">secondary</Button>
          <Button variant="outline">outline</Button>
          <Button variant="ghost">ghost</Button>
          <Button variant="destructive">destructive</Button>
          <Button variant="link">link</Button>
          <Button size="sm">sm</Button>
          <Button size="lg">lg</Button>
        </div>
      </Section>

      <Section id="figures" title="Counters on a chart graticule" note="Live figures from networkStats; each counts once when it scrolls into view.">
        <div className="relative overflow-hidden rounded-card border border-rule bg-white">
          <Graticule className="absolute inset-0 h-full w-full" />
          <RevealGroup className="relative grid grid-cols-2 divide-rule md:grid-cols-4">
            {[
              { v: figures.marinas, l: 'marinas listed' },
              { v: figures.partners, l: 'service providers' },
              { v: figures.countries, l: 'countries' },
              { v: figures.resources, l: 'resources' },
            ].map((f) => (
              <div key={f.l} className="px-6 py-8">
                <Counter value={f.v} suffix={figures.manual ? '+' : ''} className="block text-figure text-navy" />
                <p className="mt-1 text-meta-caps">{f.l}</p>
              </div>
            ))}
          </RevealGroup>
        </div>
      </Section>

      <Section id="reveals" title="Reveals and heading lines">
        <LineReveal as="h3" className="max-w-3xl text-h2-sm text-navy md:text-h2">
          Heading lines rise one after the other out of their mask, then the blocks below fade up, 80 ms apart
        </LineReveal>
        <RevealGroup className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {['One', 'Two', 'Three', 'Four'].map((n) => (
            <div key={n} className="rounded-card border border-rule bg-white p-6 text-card-title text-navy">{n}</div>
          ))}
        </RevealGroup>
        <Reveal delay={200} className="mt-4 rounded-card bg-foam p-6 text-body text-ink">
          A single Reveal with a 200 ms delay.
        </Reveal>
      </Section>

      <Section id="cards" title="Card grammar, cap arrow and sonar ping" note="Hover a card or Tab to it: lift 3 px, image 1.04, the needle swings from north-east to east and a ping spreads. Sample organisations, not real records.">
        <RevealGroup className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <OrgCard name="Sample Marina Azzurra" href="/directory" type="marina" city="Portofino" country="Italy" verified description="A sample card: initials tile when there is no logo." />
          <OrgCard name="Sample Pontoon Works" href="/directory" type="partner" country="France" verified description="Service provider colour: teal." />
          <OrgCard name="Sample Harbour Capital" href="/directory" type="investor" country="United Arab Emirates" />
          <OrgCard name="Sample Marine Press" href="/directory" type="media_partner" country="Monaco" />
        </RevealGroup>
        <div className="mt-6 grid gap-4 md:grid-cols-2">
          <CardShell interactive>
            <CardMedia className="aspect-[16/9] bg-navy/10">
              <img src={PERSONA_IMAGES.marinas} alt="" className="h-full w-full object-cover" />
            </CardMedia>
            <div className="flex items-end justify-between gap-4 p-5">
              <div>
                <p className="text-meta-caps">Resource · Infrastructure</p>
                <h3 className="mt-1 text-card-title text-navy">
                  <StretchedLink to="/resources">A picture card on the same grammar</StretchedLink>
                </h3>
              </div>
              <CapArrow />
            </div>
          </CardShell>
          <div className="flex flex-col gap-4 rounded-card bg-navy p-6 text-white">
            <div className="flex items-center gap-4">
              <LogoTile name="Sample Marina" type="marina" />
              <LogoTile name="Sample Provider" type="partner" />
              <LogoTile name="Sample Investor" type="investor" />
              <LogoTile name="Sample Media" type="media_partner" />
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <VerifiedBadge />
              <VerifiedBadge tone="dark" />
              <span className="cap-hover inline-flex items-center gap-2 text-sm">
                <CapArrow tone="dark" /> cap-hover outside a card
              </span>
            </div>
          </div>
        </div>
      </Section>

      <Section id="tabs" title="Buoy tabs (bouées)" note="Arrow keys move between tabs. The buoy slides under the active one and bobs; the panel arrives with a wave wipe.">
        <BuoyTabs defaultValue="marinas">
          <BuoyTabsList aria-label="Profiles">
            <BuoyTabsTrigger value="marinas"><Anchor className="h-4 w-4" aria-hidden="true" />Marinas</BuoyTabsTrigger>
            <BuoyTabsTrigger value="providers"><Building2 className="h-4 w-4" aria-hidden="true" />Service providers</BuoyTabsTrigger>
            <BuoyTabsTrigger value="investors"><TrendingUp className="h-4 w-4" aria-hidden="true" />Investors & developers</BuoyTabsTrigger>
            <BuoyTabsTrigger value="media"><Mic2 className="h-4 w-4" aria-hidden="true" />Media</BuoyTabsTrigger>
          </BuoyTabsList>
          {[
            { v: 'marinas', img: PERSONA_IMAGES.marinas, title: 'Marinas', cta: 'Sign up as a marina' },
            { v: 'providers', img: PERSONA_IMAGES.suppliers, title: 'Service providers', cta: 'Sign up as a service provider' },
            { v: 'investors', img: SITE_IMAGES.dashboardBand.src ?? '', title: 'Investors & developers', cta: 'Sign up as an investor' },
            { v: 'media', img: PERSONA_IMAGES.media, title: 'Media', cta: 'Sign up as media' },
          ].map((p) => (
            <BuoyTabsContent key={p.v} value={p.v}>
              <div className="grid overflow-hidden rounded-card border border-rule bg-white md:grid-cols-2">
                <img src={p.img} alt="" className="h-56 w-full object-cover md:h-full" />
                <div className="p-6 md:p-8">
                  <h3 className="text-h3 text-navy">{p.title}</h3>
                  <p className="mt-2 text-body text-meta">Sample panel: what this profile can do comes from the rights grid on the home page.</p>
                  <Button variant="tide" className="mt-6">{p.cta} <ArrowRight className="h-4 w-4" aria-hidden="true" /></Button>
                </div>
              </div>
            </BuoyTabsContent>
          ))}
        </BuoyTabs>
      </Section>

      <Section id="chenal" title="Chenal (numbered buoy steps) and ponton timeline">
        <ChannelSteps
          steps={[
            { title: 'Create your account', body: 'Free, with your work e-mail.', icon: UserPlus },
            { title: 'Describe your organisation', body: 'Type, country, services.', icon: FileText },
            { title: 'M3 checks it', body: 'Every member checked by the M3 team.', icon: ShieldCheck },
            { title: 'Meet the network', body: 'Directory, opportunities, events.', icon: Compass },
          ]}
        />
        <div className="mt-14 max-w-2xl">
          <PontoonTimeline
            items={[
              { time: '09:00', title: 'Welcome coffee', meta: 'Sample session' },
              { time: '09:30', title: 'Opening keynote', meta: 'Main hall', href: '/events' },
              { time: '11:00', title: 'Workshops', meta: 'Rooms A–C' },
              { time: '13:00', title: 'Lunch on the terrace' },
            ]}
          />
        </div>
      </Section>

      <Section id="panel" title="Wave panel, sounding lines, contact card">
        <WavePanel bathy className="rounded-card px-6 py-12 md:px-12">
          <Eyebrow tone="onDark">Wave panel</Eyebrow>
          <p className="mt-3 max-w-2xl text-h3 text-white">The navy background rises with a wave edge when the panel enters the view, then its content fades up.</p>
          <ContactCard tone="dark" className="mt-8 max-w-2xl" />
        </WavePanel>
        <div className="mt-6 grid gap-4 md:grid-cols-2">
          <div className="relative h-56 overflow-hidden rounded-card bg-white ring-1 ring-rule">
            <BathyPattern tone="navy" opacity={0.12} drift seed={9} className="absolute inset-0" />
            <p className="relative p-6 text-sm text-meta">BathyPattern tone="navy" on light, drifting.</p>
          </div>
          <ContactCard />
        </div>
      </Section>

      <Section id="marquee" title="Sponsor marquee, by tier" note="Placeholders. Pauses on hover and focus; static wall under reduced motion.">
        <LogoMarquee
          label="Event partners (sample)"
          groups={[
            { tier: 'Platinum', logos: [{ name: 'Sponsor One' }, { name: 'Sponsor Two' }] },
            { tier: 'Gold', logos: [{ name: 'Sponsor Three' }, { name: 'Sponsor Four' }, { name: 'Sponsor Five' }] },
            { tier: 'Silver', logos: [{ name: 'Sponsor Six' }, { name: 'Sponsor Seven' }] },
          ]}
        />
      </Section>

      {/* 8 · The route */}
      <EventRoute
        headingId="route-heading"
        stops={eventRouteStops(t)}
        eyebrow={t('brand.route.eyebrow')}
        title={t('brand.route.title')}
        intro={t('brand.route.intro')}
      />

      <Section id="footer-pieces" title="Horizon pieces and motion control" note="The footer below is the real Horizon footer. The global pause stops every loop on the site (WCAG 2.2.2).">
        <div className="grid gap-6 md:grid-cols-2">
          <div className="rounded-card bg-navy-deep p-6">
            <HarbourCoordinates />
            <NewsletterField className="mt-6" />
          </div>
          <div className="flex items-center gap-4 rounded-card border border-rule bg-white p-6">
            <MotionPauseToggle tone="light" withLabel />
            <MotionPauseToggle tone="light" />
          </div>
        </div>
      </Section>
    </div>
  );
}
