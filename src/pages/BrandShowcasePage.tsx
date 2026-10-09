import { useTranslation } from 'react-i18next';
import { Anchor, Compass, FileText, LifeBuoy, Radio, Search, ShieldCheck, UserPlus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { PageHero } from '@/components/ui/PageHero';
import { SITE_IMAGES, PERSONA_IMAGES } from '@/lib/siteMedia';
import { useNetworkFigures } from '@/lib/networkStats';
import {
  Reveal, RevealGroup, LineReveal, Counter, LogoMarquee, BathyPattern, Graticule,
  ChannelSteps, MotionPauseToggle, useMotion,
} from '@/components/motion';
import {
  SplitHero, HeroIn, EventCard, NewsBand, Carousel, AccordionCards, CaptionList,
  BgRevealPanel, UnderlineLink, SearchField, NewsletterField,
  CardShell, CardMedia, StretchedLink, OrgCard, VerifiedBadge, LogoTile, Eyebrow, ContactCard, featuredEventItems,
  type NewsItem,
} from '@/components/brand';

/**
 * DEV ONLY — /__brand. Every token, primitive and brand-kit piece on one page,
 * for review on the dev server. Registered in App.tsx behind import.meta.env.DEV,
 * so it does not exist in production builds. Sample organisations and sponsors
 * below are placeholders, not real records; the figures read the real public data.
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
  const { figures } = useNetworkFigures();

  const examples = [t('brand.search.ex1'), t('brand.search.ex2'), t('brand.search.ex3'), t('brand.search.ex4')];
  const events = featuredEventItems(t);
  const news: NewsItem[] = [
    { id: 'n1', kind: 'Event', text: 'World Yachting Summit · Dubai · 27 Nov 2026 (sample)', href: '/wys26' },
    { id: 'n2', kind: 'Article', text: 'A sample article title (sample)', href: '/resources' },
    { id: 'n3', kind: 'New member', text: 'Sample Marina Azzurra, Marina, Italy (sample)', href: '/directory' },
    { id: 'n4', kind: 'Webinar', text: 'A sample webinar · 12 Nov 2026 (sample)', href: '/events?type=webinar' },
  ];

  return (
    <div className="bg-page">
      {/* 1 · Split hero: marine text column, rounded photo frame, floating event card, pause control */}
      <SplitHero image={SITE_IMAGES.homeHero} card={<EventCard items={events} />} labelledBy="brand-hero-title">
        <div className="max-w-[600px]">
          <HeroIn>
            <Eyebrow tone="onDark">Smart Marina Connect · /__brand</Eyebrow>
          </HeroIn>
          <LineReveal
            as="h1"
            id="brand-hero-title"
            trigger="mount"
            delay={200}
            className="mt-5 text-[34px] font-semibold leading-[40px] tracking-[-0.025em] text-white sm:text-[42px] sm:leading-[48px] xl:text-[52px] xl:leading-[58px]"
          >
            Marinas and the companies that serve them, in one network
          </LineReveal>
          <HeroIn delay={260} className="mt-5 max-w-[560px] text-[17px] leading-[27px] text-white/85 md:text-[18px] md:leading-[29px]">
            <p>SplitHero: text on marine, a rounded photo frame (slow zoom, parallax) and the next-event card floating over its bottom left edge, with the countdown for an upcoming event. No cut-out corner.</p>
          </HeroIn>
          <HeroIn delay={340} className="mt-6 max-w-[520px]">
            <SearchField examples={examples} />
          </HeroIn>
          <HeroIn delay={420} className="mt-5 flex flex-wrap items-center gap-3">
            <Button variant="ctaOnDark">Sign up</Button>
            <Button variant="ctaLight">Explore the directory</Button>
          </HeroIn>
        </div>
      </SplitHero>
      <NewsBand items={news} />
      <p className="mx-auto max-w-7xl px-4 pt-4 text-xs text-meta sm:px-6">
        Motion: {reduced ? 'reduced (final states)' : paused ? 'paused' : 'running'}. The full-width header is transparent over the hero, turns white with a thin border once the page scrolls, shows a gold reading line along its bottom edge and hides on scroll down. The news ticker above slides sideways, pauses on hover, and stands still as a row that scrolls sideways under reduced motion, the global pause or keyboard focus (the site-wide one sits above the header: SiteTicker).
      </p>

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

      <Section
        id="buttons"
        title="Rolling CTA buttons and the original variants"
        note="Hover or Tab onto them: the label slides up while a copy rises from below, the disc turns gold while its arrow leaves to the right and a copy enters from the left (.525 s). The shadcn variants below are untouched (admin screens)."
      >
        <div className="flex flex-wrap items-center gap-3">
          <Button variant="cta">Main action</Button>
          <Button variant="ctaNavy">Secondary</Button>
          <Button variant="ctaOutline">Outline</Button>
          <Button variant="cta" size="sm">Small</Button>
          <Button variant="cta" size="lg">Large</Button>
          <Button variant="cta" arrow={false}>No disc</Button>
          <Button variant="cta" disabled>Disabled</Button>
          <Button variant="ctaOutline" size="icon" aria-label="Previous"><Search className="h-[18px] w-[18px]" aria-hidden="true" /></Button>
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-3 rounded-card bg-navy p-6">
          <Button variant="ctaOnDark">Main action on navy</Button>
          <Button variant="ctaWhite">White</Button>
          <Button variant="ctaLight">Outline on dark</Button>
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

      <Section id="links" title="Underline links" note="A 1 px rule at 30 %; on hover or focus a 2 px gold line grows from the left (.4 s) and the arrow nudges to the right.">
        <div className="flex flex-wrap items-center gap-8">
          <UnderlineLink to="/events">All events</UnderlineLink>
          <UnderlineLink to="/resources" arrow={false}>No arrow</UnderlineLink>
          <UnderlineLink href="https://www.m3monaco.com" external>External link</UnderlineLink>
          <span className="rounded-card bg-navy px-6 py-4">
            <UnderlineLink to="/events" tone="light">On navy</UnderlineLink>
          </span>
        </div>
      </Section>

      <Section id="figures" title="Counters on a chart graticule" note="Live figures from networkStats; each counts once (900 ms) when it scrolls into view.">
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

      <Section id="reveals" title="Reveals and heading lines" note="Section eyebrows carry a small gold number (01, 02…): #87681b on light, #d7a647 on navy, tabular figures, hidden from screen readers.">
        <div className="mb-8 flex flex-wrap items-center gap-x-10 gap-y-4">
          <Eyebrow number="01">Section eyebrow, light</Eyebrow>
          <div className="rounded-pill bg-navy px-5 py-3">
            <Eyebrow tone="onDark" number="02">Section eyebrow, navy</Eyebrow>
          </div>
        </div>
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

      <Section id="cards" title="Cards" note="Hover a card or Tab to it: it lifts 4 px, its picture scales to 1.05 (.8 s), the gold line under the title grows from the left and the small arrow after it slides 4 px. No round arrow disc on cards: that stays inside the rolling CTA buttons. Sample organisations, not real records.">
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
            <div className="p-5">
              <p className="text-meta-caps">Resource · Infrastructure</p>
              <h3 className="mt-1 text-card-title text-navy">
                <StretchedLink to="/resources">A picture card: lift, zoom, gold line and a small arrow</StretchedLink>
              </h3>
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
            </div>
          </div>
        </div>
      </Section>

      <Section id="accordion" title="Accordion cards" note="From 1024 px: collapsed to about 220 px with the title written vertically under a maritime pictogram, the hovered or focused card grows to about 550 px (.6 s) and its caption fades up. Stacked with captions visible below 1024 px; the first tap opens on a touch screen.">
        <AccordionCards
          items={[
            { id: 'marinas', title: 'Marinas', icon: Anchor, image: PERSONA_IMAGES.marinas, dotColor: 'rgb(var(--type-marina))', caption: <CaptionList items={['Publish your needs and consultations', 'Compare service providers', 'Ask for introductions']} />, cta: { label: 'Sign up as a marina', to: '/become-partner' } },
            { id: 'providers', title: 'Service providers', icon: LifeBuoy, image: PERSONA_IMAGES.suppliers, dotColor: 'rgb(var(--type-provider))', caption: <CaptionList items={['Read the needs marinas publish', 'Present your company in the directory', 'Ask for introductions']} />, cta: { label: 'Sign up as a service provider', to: '/become-partner' } },
            { id: 'investors', title: 'Investors & developers', icon: Compass, image: SITE_IMAGES.dashboardBand.src, dotColor: 'rgb(var(--type-investor))', caption: <CaptionList items={['Follow marina projects', 'Shortlist organisations', 'Meet them at M3 events']} />, cta: { label: 'Sign up as an investor', to: '/become-partner' } },
            { id: 'media', title: 'Media', icon: Radio, image: PERSONA_IMAGES.media, dotColor: 'rgb(var(--type-media))', caption: <CaptionList items={['Access resources and replays', 'Follow M3 events', 'Contact the M3 team']} />, cta: { label: 'Sign up as media', to: '/become-partner' } },
          ]}
        />
      </Section>

      <BgRevealPanel bathy className="py-14 md:py-20">
        <div className="mx-auto max-w-7xl px-4 sm:px-6">
          <Eyebrow tone="onDark">BgRevealPanel</Eyebrow>
          <p className="mt-3 max-w-2xl text-h3 text-white">The navy background scales from .94 to 1 while it fades in (.9 s), then its content rises (+220 ms).</p>
          <ContactCard tone="dark" className="mt-8 max-w-2xl" />
        </div>
      </BgRevealPanel>

      <Section id="carousel" title="Carousel" note="A CSS scroll-snap row: mouse drag, previous and next buttons, one dot per stop, arrow keys when the row has focus, touch swipe. Cards reveal on view and lift on hover. Buttons and dots disappear when every card fits.">
        <Carousel label="Sample events" slideClassName="w-[88%] sm:w-[62%] lg:w-[46%]">
          {[
            { id: 's1', title: 'Monaco Smart & Sustainable Marina Rendezvous', kicker: 'Monaco', image: SITE_IMAGES.partnersHero },
            { id: 's2', title: 'World Yachting Summit', kicker: 'Dubai · by invitation', image: SITE_IMAGES.eventsHero },
            { id: 's3', title: 'Webinars & replays', kicker: 'Online', image: SITE_IMAGES.resourcesHero },
          ].map((c) => (
            <Reveal key={c.id} className="flex w-full min-w-0">
              <CardShell as="article" interactive tone="navy" className="min-h-[420px] flex-1 rounded-[24px]">
                <CardMedia className="absolute inset-0">
                  {c.image.src && <img src={c.image.src} alt="" draggable={false} className="h-full w-full object-cover" />}
                </CardMedia>
                <span aria-hidden="true" className="absolute inset-0 bg-[linear-gradient(180deg,rgba(8,29,64,.7)_0%,rgba(8,29,64,.5)_35%,rgba(8,29,64,.92)_100%)]" />
                <div className="relative flex flex-1 flex-col justify-between gap-6 p-6 md:p-8">
                  <div>
                    <p className="inline-flex items-center gap-2 rounded-pill bg-white/15 px-3.5 py-1.5 text-[13px] font-semibold ring-1 ring-inset ring-white/30">
                      <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-gold" />
                      {c.kicker}
                    </p>
                    <h3 className="mt-4 text-[28px] font-semibold leading-[34px] tracking-[-0.02em] md:text-[34px] md:leading-[40px]">
                      <StretchedLink to="/events" tone="light">{c.title}</StretchedLink>
                    </h3>
                  </div>
                  <div className="relative z-10">
                    <Button asChild variant="ctaLight">
                      <a href="/events">See the event</a>
                    </Button>
                  </div>
                </div>
              </CardShell>
            </Reveal>
          ))}
        </Carousel>
      </Section>

      <Section id="pagehero" title="Page header" note="Compact full-width banner (no inset, no rounded corners, no cut-out). A small card can overlap its bottom edge from xl.">
        <PageHero
          image={SITE_IMAGES.directoryHero}
          seed="brand-showcase"
          icon={Search}
          title="Directory of marinas and their service providers"
          subtitle="Compact banner used by every section page: photo, marine veil, sounding lines, breadcrumb, an optional floating card from xl."
          breadcrumbs={[{ label: 'Home', href: '/' }, { label: 'Directory' }]}
          overlayHeader={false}
          floating={
            <a href="/directory" className="card-lift group has-ra flex w-[400px] items-stretch overflow-hidden rounded-card bg-white text-navy shadow-[0_18px_40px_rgba(4,13,31,.28)] ring-1 ring-rule">
              <span aria-hidden="true" className="card-media relative block w-[92px] shrink-0 overflow-hidden bg-navy">
                <img src={PERSONA_IMAGES.marinas} alt="" className="absolute inset-0 h-full w-full object-cover" />
              </span>
              <span className="grid content-center gap-0.5 px-4 py-3.5">
                <span className="text-[12px] font-semibold leading-4 text-gold-text">For marinas</span>
                <span className="text-[16px] font-semibold leading-[21px]"><span className="card-ul">Is your marina already listed?</span></span>
                <span className="text-[13px] leading-[18px] text-meta">Claim its page and complete it</span>
              </span>
            </a>
          }
        />
        <div className="hidden h-12 xl:block" />
      </Section>

      <Section id="chenal" title="Numbered steps">
        <ChannelSteps
          steps={[
            { title: 'Create your account', body: 'Free, with your work e-mail.', icon: UserPlus },
            { title: 'Describe your organisation', body: 'Type, country, services.', icon: FileText },
            { title: 'M3 checks it', body: 'Every member checked by the M3 team.', icon: ShieldCheck },
            { title: 'Meet the network', body: 'Directory, opportunities, events.', icon: Compass },
          ]}
        />
      </Section>

      <Section id="marquee" title="Logo marquee" note="Sponsor logos: placeholders, pause on hover and focus; a static wall under reduced motion.">
        <LogoMarquee
          className="mt-8"
          label="Event partners (sample)"
          groups={[
            { tier: 'Platinum', logos: [{ name: 'Sponsor One' }, { name: 'Sponsor Two' }] },
            { tier: 'Gold', logos: [{ name: 'Sponsor Three' }, { name: 'Sponsor Four' }, { name: 'Sponsor Five' }] },
            { tier: 'Silver', logos: [{ name: 'Sponsor Six' }, { name: 'Sponsor Seven' }] },
          ]}
        />
      </Section>

      <Section id="inputs" title="Search pill, newsletter and motion control" note="The footer below is the real footer: the 'Join the marina network' band (hidden for signed-in members), drifting sounding lines, newsletter. The global pause stops every loop on the site (WCAG 2.2.2).">
        <div className="grid gap-6 md:grid-cols-2">
          <div className="space-y-4 rounded-card border border-rule bg-white p-6">
            <SearchField tone="light" examples={examples} />
            <SearchField tone="light" size="md" placeholder="Toolbar size (48 px)" />
            <div className="relative h-40 overflow-hidden rounded-card bg-navy-deep">
              <BathyPattern seed={9} drift className="absolute inset-0" />
              <p className="relative p-6 text-sm text-white/80">BathyPattern drifting, on navy.</p>
            </div>
          </div>
          <div className="space-y-6">
            <div className="rounded-card bg-navy-deep p-6">
              <NewsletterField hideLabel />
            </div>
            <div className="flex items-center gap-4 rounded-card border border-rule bg-white p-6">
              <MotionPauseToggle tone="light" withLabel />
              <MotionPauseToggle tone="light" />
            </div>
          </div>
        </div>
      </Section>
    </div>
  );
}
