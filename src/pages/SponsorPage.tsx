import { useMemo, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { BadgeCheck, CalendarDays, CheckCircle, HeartHandshake, Home, LayoutGrid } from 'lucide-react';
import { Seo } from '@/components/seo/Seo';
import { PageHero } from '@/components/ui/PageHero';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { SponsorBadge } from '@/components/ui/SponsorBadge';
import { Eyebrow } from '@/components/brand/Eyebrow';
import { UnderlineLink } from '@/components/brand/UnderlineLink';
import { ContactCard } from '@/components/brand/ContactCard';
import { RENDEZVOUS_2026_PATH } from '@/components/brand/m3Events';
import { LogoMarquee, type MarqueeGroup } from '@/components/motion/LogoMarquee';
import { Counter } from '@/components/motion/Counter';
import { useNetworkFigures } from '@/lib/networkStats';
import { Reveal, RevealGroup } from '@/components/motion/Reveal';
import { PhotoFrame, SectionHead } from '@/components/content/ContentParts';
import { ContactFailure, Honeypot } from '@/components/contact/ContactParts';
import { Turnstile, useTurnstile } from '@/components/security/Turnstile';
import { useEventSponsors } from '@/components/events/EventDetailParts';
import { SITE_IMAGES, SM26_MOMENTS } from '@/lib/siteMedia';
import { submitContact, type ContactResult } from '@/lib/contactSubmit';
import { withSiteSuffix } from '@/lib/seoText';
import { TIER_LABELS, type OrgTier } from '@/types/database';
import { registerFlowsStrings } from '@/i18n/refonte-flows';
import { cn } from '@/lib/utils';

registerFlowsStrings();

/**
 * /sponsor — "Sponsor an M3 event" (refonte, Oct 2026). Where every "Sponsor an
 * event" button lands. No price: the page says who sponsors and why, which M3
 * events there are, what a sponsor gets in VISIBILITY by tier (read from how
 * the site already shows sponsors: tiers highest first, the size of the card on
 * /partners, the badge on the company page), where sponsors appear today, and
 * who sponsors now (the same read as the home page's band). It ends with the
 * form that requests the sponsorship deck: it goes to the M3 team through the
 * contact-submit function with the subject "partnership".
 *
 * The only numbers: the one Victor confirmed ("250+ participants" at the 6th
 * Rendezvous) and two live counts of the network (marinas listed, countries),
 * the same reads as the home page. "Partners" are paying event sponsors.
 * No strip of past sponsors: the database holds no record of who sponsored a
 * past edition (only today's tiers), so there is nothing true to show yet.
 */

/** Biggest package first, as on the home page's band and the Partners page. */
const TIER_ORDER: OrgTier[] = ['main_sponsor', 'premium_sponsor', 'premium_partner', 'associate_partner', 'innovation_partner'];

const FIELD = 'h-12 md:h-12 rounded-field border-checkbox bg-white px-4 text-base';
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const MOMENT = (key: string) => SM26_MOMENTS.find((m) => m.key === key)?.src ?? null;

export function SponsorPage() {
  const { t } = useTranslation();
  const { sponsors, loading } = useEventSponsors(true);

  // Tiers that have at least one logo; a sponsor of such a tier without a logo yet is written out by name.
  const groups: MarqueeGroup[] = useMemo(
    () =>
      TIER_ORDER.map((tier) => {
        const ofTier = sponsors.filter((s) => s.tier === tier);
        return {
          tier: TIER_LABELS[tier],
          logos: ofTier.some((s) => s.logo_url)
            ? [...ofTier]
                .sort((a, b) => Number(!!b.logo_url) - Number(!!a.logo_url))
                .map((s) => ({ name: s.name, src: s.logo_url, href: `/organizations/${s.slug}` }))
            : [],
        };
      }).filter((g) => g.logos.length > 0),
    [sponsors],
  );
  const showSponsors = loading || groups.length > 0;

  // Three key figures (design audit, 8 Oct 2026): the Rendezvous' audience, the
  // one figure Victor confirmed ("250+ participants"), then two live counts read
  // exactly as on the home and About pages (networkStats: verified marinas and
  // countries; "N+" when an admin has typed them).
  const { figures } = useNetworkFigures();
  const live = figures.manual ? '+' : '';
  const keyFigures: { key: string; value: number | null; suffix: string; label: string }[] = [
    { key: 'participants', value: 250, suffix: '+', label: t('flows.sponsor.figures.participants', 'participants at the 6th Rendezvous, Monaco 2026') },
    { key: 'marinas', value: figures.marinas, suffix: live, label: t('flows.sponsor.figures.marinas', 'marinas listed in the directory') },
    { key: 'countries', value: figures.countries, suffix: live, label: t('flows.sponsor.figures.countries', 'countries in the network') },
  ];

  const seoTitle = withSiteSuffix(t('seo.sponsor.title', 'Sponsor an M3 event in Monaco and Dubai'));
  const seoDescription = t(
    'seo.sponsor.description',
    'Sponsor the Monaco Smart & Sustainable Marina Rendezvous or the World Yachting Summit in Dubai. See what sponsors get and request the sponsorship deck.',
  );

  const placements = [
    { key: 'event', icon: CalendarDays, to: RENDEZVOUS_2026_PATH },
    { key: 'partners', icon: HeartHandshake, to: '/partners' },
    { key: 'directory', icon: LayoutGrid, to: '/directory' },
    { key: 'home', icon: Home, to: '/' },
    { key: 'badge', icon: BadgeCheck, to: null },
  ] as const;

  return (
    <div className="min-h-screen bg-page">
      <Seo title={seoTitle} description={seoDescription} path="/sponsor" />

      <PageHero
        image={SITE_IMAGES.eventsHero}
        seed="sponsor-hero"
        icon={HeartHandshake}
        eyebrow={t('flows.sponsor.hero.eyebrow')}
        title={t('flows.sponsor.hero.title')}
        subtitle={t('flows.sponsor.hero.subtitle')}
        breadcrumbs={[
          { label: t('nav.home', 'Home'), href: '/' },
          { label: t('nav.partners', 'Partners'), href: '/partners' },
          { label: t('flows.sponsor.crumb') },
        ]}
      >
        <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
          <Button asChild variant="ctaOnDark">
            <a href="#deck">{t('flows.sponsor.hero.ctaDeck')}</a>
          </Button>
          {showSponsors && (
            <UnderlineLink href="#sponsors" tone="light">
              {t('flows.sponsor.hero.ctaSponsors')}
            </UnderlineLink>
          )}
        </div>
      </PageHero>

      {/* ── Who sponsors, and why: three key figures first ── */}
      <section aria-labelledby="sponsor-why" className="mx-auto w-full max-w-7xl px-4 py-14 sm:px-6 md:py-20">
        <Reveal>
          <dl
            aria-label={t('flows.sponsor.figures.label', 'Key figures')}
            className="mb-12 flex flex-wrap gap-y-6 border-b border-rule pb-8 md:mb-16"
          >
            {keyFigures.map(({ key, value, suffix, label }, i) => (
              <div key={key} className={cn('flex min-w-0 flex-col-reverse pr-6 md:pr-12', i > 0 && 'border-l border-rule pl-6 md:pl-12')}>
                <dt className="mt-1 max-w-[220px] text-[13px] leading-[18px] text-meta">{label}</dt>
                <dd className="text-[34px] font-light leading-[38px] tracking-[-0.02em] text-navy md:text-[48px] md:leading-[52px]">
                  <Counter value={value} suffix={suffix} />
                </dd>
              </div>
            ))}
          </dl>
        </Reveal>
        <div className="grid gap-10 lg:grid-cols-12 lg:gap-14">
          <div className="lg:col-span-7">
            <SectionHead
              id="sponsor-why"
              number="01"
              eyebrow={t('flows.sponsor.why.eyebrow')}
              title={t('flows.sponsor.why.title')}
              intro={t('flows.sponsor.why.intro')}
            />
            <RevealGroup as="ol" className="mt-8 divide-y divide-rule border-y border-rule">
              {(['people', 'year', 'team'] as const).map((key, i) => (
                <li key={key} className="flex gap-5 py-5 md:gap-6 md:py-6">
                  <span aria-hidden="true" className="mt-0.5 w-8 shrink-0 text-[15px] font-semibold tabular-nums text-gold-text">
                    {String(i + 1).padStart(2, '0')}
                  </span>
                  <div>
                    <h3 className="text-card-title text-navy">{t(`flows.sponsor.why.reasons.${key}.title`)}</h3>
                    <p className="mt-1.5 text-body text-ink">{t(`flows.sponsor.why.reasons.${key}.body`)}</p>
                  </div>
                </li>
              ))}
            </RevealGroup>
          </div>
          <Reveal delay={120} className="grid content-start gap-4 sm:grid-cols-2 lg:col-span-5 lg:grid-cols-1">
            <PhotoFrame src={MOMENT('community')} focusY={0.5} aspect="aspect-[3/2]" />
            <PhotoFrame src={MOMENT('trophies')} focusY={0.5} aspect="aspect-[3/2]" className="hidden sm:block lg:block" />
          </Reveal>
        </div>
      </section>

      {/* ── The events ── */}
      <section aria-labelledby="sponsor-events" className="bg-white py-14 md:py-20">
        <div className="mx-auto w-full max-w-7xl px-4 sm:px-6">
          <SectionHead
            id="sponsor-events"
            number="02"
            eyebrow={t('flows.sponsor.events.eyebrow')}
            title={t('flows.sponsor.events.title')}
          />
          <RevealGroup className="mt-10 grid gap-6 md:grid-cols-2">
            <article className="flex flex-col overflow-hidden rounded-card border border-rule bg-page">
              <PhotoFrame src={SITE_IMAGES.homeHero.src} focusY={SITE_IMAGES.homeHero.focusY} aspect="aspect-[16/9]" className="rounded-none" />
              <div className="flex flex-1 flex-col p-6 md:p-8">
                <Eyebrow>{t('flows.sponsor.events.rendezvous.kicker')}</Eyebrow>
                <h3 className="mt-3 text-[22px] font-semibold leading-7 tracking-[-0.01em] text-navy">
                  {t('flows.sponsor.events.rendezvous.title')}
                </h3>
                <p className="mt-3 flex-1 text-body text-ink">{t('flows.sponsor.events.rendezvous.body')}</p>
                <div className="mt-5">
                  <UnderlineLink to={RENDEZVOUS_2026_PATH}>{t('flows.sponsor.events.rendezvous.link')}</UnderlineLink>
                </div>
              </div>
            </article>
            <article className="flex flex-col overflow-hidden rounded-card border border-rule bg-page">
              {/* The Summit has no photo of its own yet: the same provisional conference picture as its card on
                  /events and the home page (SITE_IMAGES.eventsHero), with the "By invitation" label, rather than
                  a gradient with a giant date next to the Rendezvous' photo (design audit, 8 Oct 2026). */}
              <PhotoFrame src={SITE_IMAGES.eventsHero.src} focusY={SITE_IMAGES.eventsHero.focusY} aspect="aspect-[16/9]" className="rounded-none">
                <span className="absolute left-4 top-4 inline-flex items-center gap-1.5 rounded-pill bg-white px-3 py-1 text-[12px] font-semibold text-navy">
                  <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-teal" />
                  {t('eventsPage.wys.badge', 'By invitation')}
                </span>
              </PhotoFrame>
              <div className="flex flex-1 flex-col p-6 md:p-8">
                <Eyebrow>{t('flows.sponsor.events.wys.kicker')}</Eyebrow>
                <h3 className="mt-3 text-[22px] font-semibold leading-7 tracking-[-0.01em] text-navy">
                  {t('flows.sponsor.events.wys.title')}
                </h3>
                <p className="mt-3 flex-1 text-body text-ink">{t('flows.sponsor.events.wys.body')}</p>
                <div className="mt-5">
                  <UnderlineLink to="/wys26">{t('flows.sponsor.events.wys.link')}</UnderlineLink>
                </div>
              </div>
            </article>
          </RevealGroup>
          <Reveal as="p" delay={120} className="mt-6 text-body text-meta">
            {t('flows.sponsor.events.online')}
          </Reveal>
        </div>
      </section>

      {/* ── What sponsors get, by tier: visibility only ── */}
      <section aria-labelledby="sponsor-tiers" className="mx-auto w-full max-w-7xl px-4 py-14 sm:px-6 md:py-20">
        <div className="grid gap-10 lg:grid-cols-12 lg:gap-14">
          <div className="lg:col-span-5">
            <SectionHead
              id="sponsor-tiers"
              number="03"
              eyebrow={t('flows.sponsor.tiers.eyebrow')}
              title={t('flows.sponsor.tiers.title')}
              intro={t('flows.sponsor.tiers.intro')}
            />
            <Reveal as="p" delay={160} className="mt-5 max-w-xl text-[15px] leading-6 text-meta">
              {t('flows.sponsor.tiers.note')}
            </Reveal>
          </div>
          <RevealGroup as="ol" aria-label={t('flows.sponsor.tiers.listLabel')} className="divide-y divide-rule rounded-card border border-rule bg-white lg:col-span-7">
            {TIER_ORDER.map((tier) => (
              <li key={tier} className="flex flex-col gap-3 p-5 sm:flex-row sm:items-center sm:gap-6 md:p-6">
                <span className="sm:w-48 sm:shrink-0">
                  <SponsorBadge tier={tier} size="lg" />
                </span>
                <p className="text-body text-ink">{t(`flows.sponsor.tiers.${tier}`)}</p>
              </li>
            ))}
          </RevealGroup>
        </div>

        {/* Where sponsors appear today */}
        <div className="mt-14 md:mt-20">
          <Reveal>
            <h3 className="text-[22px] font-semibold leading-7 tracking-[-0.01em] text-navy">{t('flows.sponsor.where.title')}</h3>
          </Reveal>
          <Reveal as="p" delay={80} className="mt-2 max-w-2xl text-body text-ink">{t('flows.sponsor.where.intro')}</Reveal>
          <RevealGroup as="ul" className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {placements.map(({ key, icon: Icon, to }) => (
              <li key={key} className="flex gap-4 rounded-card border border-rule bg-white p-5">
                <span aria-hidden="true" className="grid h-10 w-10 shrink-0 place-items-center rounded-pill bg-foam text-teal-text">
                  <Icon className="h-5 w-5" strokeWidth={1.75} />
                </span>
                <div className="min-w-0">
                  <h4 className="text-[16px] font-semibold leading-6 text-navy">
                    {to ? (
                      <Link to={to} className="focus-ring rounded-sm underline decoration-rule underline-offset-4 hover:decoration-navy">
                        {t(`flows.sponsor.where.${key}.title`)}
                      </Link>
                    ) : (
                      t(`flows.sponsor.where.${key}.title`)
                    )}
                  </h4>
                  <p className="mt-1 text-[15px] leading-6 text-ink">{t(`flows.sponsor.where.${key}.body`)}</p>
                </div>
              </li>
            ))}
          </RevealGroup>
        </div>
      </section>

      {/* ── Current sponsors ── */}
      {showSponsors && (
        <section id="sponsors" aria-labelledby="sponsor-current" className="scroll-mt-24 bg-white py-14 md:py-20">
          <div className="mx-auto w-full max-w-7xl px-4 sm:px-6">
            <div className="flex flex-wrap items-end justify-between gap-x-8 gap-y-4">
              <SectionHead
                id="sponsor-current"
                number="04"
                eyebrow={t('flows.sponsor.current.eyebrow')}
                title={t('flows.sponsor.current.title')}
                intro={t('flows.sponsor.current.intro')}
              />
              <Reveal>
                <UnderlineLink to="/partners">{t('flows.sponsor.current.all')}</UnderlineLink>
              </Reveal>
            </div>
            {loading ? (
              <div aria-hidden="true" className="mt-10 flex gap-3 overflow-hidden">
                {[0, 1, 2, 3, 4].map((i) => <div key={i} className="h-[100px] w-[168px] shrink-0 animate-pulse rounded-[12px] bg-chip md:h-28 md:w-[200px]" />)}
              </div>
            ) : (
              <Reveal className="mt-10">
                <LogoMarquee look="tiles" still label={t('flows.sponsor.current.label')} groups={groups} />
              </Reveal>
            )}
          </div>
        </section>
      )}

      {/* ── The deck request ── */}
      <section id="deck" aria-labelledby="sponsor-deck" className="mx-auto w-full max-w-7xl scroll-mt-24 px-4 py-14 sm:px-6 md:py-20">
        <div className="grid gap-10 lg:grid-cols-12 lg:gap-14">
          <div className="lg:col-span-5">
            <SectionHead
              id="sponsor-deck"
              number={showSponsors ? '05' : '04'}
              eyebrow={t('flows.sponsor.deck.eyebrow')}
              title={t('flows.sponsor.deck.title')}
              intro={t('flows.sponsor.deck.intro')}
            />
            <Reveal delay={160} className="mt-8 hidden lg:block">
              <PhotoFrame src={MOMENT('workshop')} focusY={0.5} aspect="aspect-[3/2]" />
            </Reveal>
            <Reveal delay={200} className="mt-6">
              {/* The deck form is the action here: the e-mail address is a plain link, not a second button. */}
              <ContactCard line={t('flows.sponsor.contactLine')} action="link" />
            </Reveal>
          </div>
          <Reveal className="lg:col-span-7">
            <DeckForm />
          </Reveal>
        </div>
      </section>
    </div>
  );
}

/* ─── The sponsorship deck request ─────────────────────────────────── */

function DeckForm() {
  const { t } = useTranslation();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [company, setCompany] = useState('');
  const [events, setEvents] = useState<string[]>([]);
  const [note, setNote] = useState('');
  const [website, setWebsite] = useState('');
  // Cloudflare Turnstile: invisible unless a challenge is needed; off without a site key.
  const captcha = useTurnstile();
  const [errors, setErrors] = useState<{ name?: string; email?: string; company?: string }>({});
  const [failure, setFailure] = useState<Exclude<ContactResult, { ok: true }>['reason'] | null>(null);
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);

  const eventOptions = [
    { key: 'rendezvous', label: t('flows.sponsor.deck.eventRendezvous') },
    { key: 'wys', label: t('flows.sponsor.deck.eventWys') },
    { key: 'notSure', label: t('flows.sponsor.deck.eventNotSure') },
  ];
  const toggleEvent = (label: string) =>
    setEvents((list) => (list.includes(label) ? list.filter((l) => l !== label) : [...list, label]));

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (sending) return;
    const next: typeof errors = {};
    if (!name.trim()) next.name = t('flows.sponsor.deck.errorName');
    if (!EMAIL_PATTERN.test(email.trim())) next.email = t('flows.sponsor.deck.errorEmail');
    if (!company.trim()) next.company = t('flows.sponsor.deck.errorCompany');
    setErrors(next);
    if (Object.keys(next).length > 0) return;

    setSending(true);
    setFailure(null);
    const message = [
      t('flows.sponsor.deck.messageIntro'),
      events.length > 0 ? t('flows.sponsor.deck.messageEvents', { events: events.join(', ') }) : '',
      note.trim(),
    ].filter(Boolean).join('\n\n');
    const result = await submitContact({
      name,
      email,
      company,
      subject: 'partnership',
      message,
      source: '/sponsor',
      website,
      captcha: captcha.token,
    });
    setSending(false);
    captcha.reset(); // a token works once
    if (!result.ok) { setFailure(result.reason); return; }
    setSent(true);
  };

  const errorProps = (field: keyof typeof errors) => ({
    'aria-invalid': errors[field] ? (true as const) : undefined,
    'aria-describedby': errors[field] ? `deck-${field}-error` : undefined,
  });
  const fieldError = (field: keyof typeof errors) =>
    errors[field] ? <p id={`deck-${field}-error`} role="alert" className="text-sm font-medium text-red-700">{errors[field]}</p> : null;
  const required = <span aria-hidden="true" className="text-red-700">*</span>;

  if (sent) {
    return (
      <div role="status" className="rounded-card border border-rule bg-white p-8 text-center md:p-12">
        <span aria-hidden="true" className="mx-auto mb-5 grid h-16 w-16 place-items-center rounded-pill bg-foam text-teal-text">
          <CheckCircle className="h-8 w-8" />
        </span>
        <h3 className="text-h2-sm text-navy md:text-h2">{t('flows.sponsor.deck.successTitle')}</h3>
        <p className="mx-auto mt-3 max-w-md text-body md:text-body-lg text-ink">{t('flows.sponsor.deck.successBody')}</p>
        <Button
          type="button"
          variant="ctaOutline"
          className="mt-8"
          onClick={() => {
            setSent(false); setFailure(null); setWebsite('');
            setName(''); setEmail(''); setCompany(''); setEvents([]); setNote('');
          }}
        >
          {t('flows.sponsor.deck.again')}
        </Button>
      </div>
    );
  }

  return (
    <form onSubmit={submit} noValidate className="relative space-y-5 rounded-card border border-rule bg-white p-6 sm:p-8 md:p-10">
      <p className="text-sm text-meta">{t('flows.sponsor.deck.required')}</p>
      <div className="grid gap-5 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="deck-name" className="text-sm font-semibold text-navy">{t('flows.sponsor.deck.name')} {required}</Label>
          <Input id="deck-name" className={cn(FIELD, errors.name && 'border-red-700')} maxLength={120} autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} {...errorProps('name')} />
          {fieldError('name')}
        </div>
        <div className="space-y-2">
          <Label htmlFor="deck-email" className="text-sm font-semibold text-navy">{t('flows.sponsor.deck.email')} {required}</Label>
          <Input id="deck-email" type="email" className={cn(FIELD, errors.email && 'border-red-700')} autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} {...errorProps('email')} />
          {fieldError('email')}
        </div>
      </div>
      <div className="space-y-2">
        <Label htmlFor="deck-company" className="text-sm font-semibold text-navy">{t('flows.sponsor.deck.company')} {required}</Label>
        <Input id="deck-company" className={cn(FIELD, errors.company && 'border-red-700')} maxLength={160} autoComplete="organization" value={company} onChange={(e) => setCompany(e.target.value)} {...errorProps('company')} />
        {fieldError('company')}
      </div>

      <fieldset className="space-y-3">
        <legend className="text-sm font-semibold text-navy">
          {t('flows.sponsor.deck.events')} <span className="font-normal text-meta">({t('flows.contact.optional')})</span>
        </legend>
        <div className="grid gap-2.5">
          {eventOptions.map((opt) => (
            <label key={opt.key} className="flex cursor-pointer items-start gap-3 text-[15px] leading-6 text-ink">
              <input
                type="checkbox"
                checked={events.includes(opt.label)}
                onChange={() => toggleEvent(opt.label)}
                className="mt-1 h-5 w-5 shrink-0 accent-navy"
              />
              <span>{opt.label}</span>
            </label>
          ))}
        </div>
      </fieldset>

      <div className="space-y-2">
        <Label htmlFor="deck-note" className="text-sm font-semibold text-navy">
          {t('flows.sponsor.deck.message')} <span className="font-normal text-meta">({t('flows.contact.optional')})</span>
        </Label>
        <Textarea
          id="deck-note"
          rows={4}
          maxLength={3000}
          placeholder={t('flows.sponsor.deck.messagePlaceholder')}
          className="rounded-field border-checkbox bg-white px-4 py-3 text-base"
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />
      </div>

      <Honeypot value={website} onChange={setWebsite} />
      <Turnstile captcha={captcha} action="sponsor-deck" />
      {failure && <ContactFailure reason={failure} />}

      <div className="pt-1">
        <Button type="submit" variant="cta" disabled={sending || captcha.waiting} arrow={!sending} roll={!sending} className="w-full justify-between sm:w-auto">
          {sending ? t('flows.sponsor.deck.sending') : t('flows.sponsor.deck.submit')}
        </Button>
      </div>
    </form>
  );
}

