import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import * as AccordionPrimitive from '@radix-ui/react-accordion';
import { ChevronDown, HelpCircle, Link2, SearchX } from 'lucide-react';
import { Seo } from '@/components/seo/Seo';
import { PageHero } from '@/components/ui/PageHero';
import { Button } from '@/components/ui/button';
import { CardShell, StretchedLink } from '@/components/brand/CardShell';
import { ContactCard } from '@/components/brand/ContactCard';
import { SearchField } from '@/components/brand/SearchField';
import { UnderlineLink } from '@/components/brand/UnderlineLink';
import { SectionHead } from '@/components/content/ContentParts';
import { useMotion } from '@/components/motion/MotionProvider';
import { Reveal } from '@/components/motion/Reveal';
import { buildHelpSections, PERSONA_SECTION, type HelpItem, type HelpSection } from '@/components/help/helpContent';
import { buildHelpIndex, helpQueryWords, searchHelp } from '@/components/help/helpSearch';
import { setHelpButtonHidden, useHelpButtonHidden } from '@/components/help/helpPlaces';
import { Switch } from '@/components/ui/switch';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from '@/hooks/use-toast';
import { plainPageMeta } from '@/lib/seoMeta';
import { SITE_IMAGES } from '@/lib/siteMedia';
import { cn } from '@/lib/utils';

/**
 * /help, the help centre (Victor, 9 Oct 2026: "Centre d'aide / FAQ"). Public
 * and indexable.
 *
 *   hero: "How can we help?" and a search that filters the answers as you
 *         type (helpSearch.ts: small words dropped, "email" finds "e-mail",
 *         keywords; when no answer has every word, the closest ones; the
 *         sections whose questions hold the words first);
 *   start here: one card per profile (the reader's own is marked "Your
 *         profile"), then one per topic, each a jump to its section;
 *   the answers: per profile, then per topic, as accordions; from 1024 px a
 *         sticky list of the sections follows on the left;
 *   "Still stuck?": the contact card. Its button opens the site's contact
 *         form (/contact), which works on any computer (a mailto does nothing
 *         where no mail app is set up), and the line gives events@m3monaco.com.
 *
 * Every question has its own #anchor (/help#verification-time, the ids in
 * helpContent.ts): opening such a link opens that answer, scrolls to it and
 * marks it for a moment. Each answer has "Copy the link to this answer", so
 * the team can send it to someone. HelpTip's "Learn more" lands here too.
 *
 * Sticky-header trap: nothing above the sticky list may have overflow-hidden.
 */

export function HelpPage() {
  const { t } = useTranslation();
  const { hash, key: locationKey } = useLocation();
  const navigate = useNavigate();
  const { reduced } = useMotion();
  const { user, profile, hasOrganization } = useAuth();
  const sections = useMemo(() => buildHelpSections(t), [t]);
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState<string[]>([]);
  const [flash, setFlash] = useState<string | null>(null);
  const [activeSection, setActiveSection] = useState<string | null>(null);
  const resultsRef = useRef<HTMLDivElement>(null);
  /** A copied link puts its #anchor in the address: that one must not scroll the page again. */
  const quietHash = useRef<string | null>(null);

  // The reader's own profile section: no company yet, or the one of their profile.
  const persona = (profile?.persona as string | undefined) ?? '';
  const mine = !user ? null : !hasOrganization ? 'no-company' : PERSONA_SECTION[persona] ?? null;

  const index = useMemo(() => buildHelpIndex(sections), [sections]);
  const itemIds = useMemo(() => new Set(index.map((x) => x.item.id)), [index]);

  const words = helpQueryWords(query);
  const wordsKey = words.join(' ');
  const searching = words.length > 0;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const result = useMemo(() => searchHelp(index, words), [index, wordsKey]);
  const hits = result.ids;
  const hitCount = hits?.size ?? 0;
  const closest = result.mode === 'closest';

  // One answer open at a time (Victor, 10 Oct 2026): opening an answer closes the one
  // read before, so the page never fills up with open answers. Closing just closes.
  const openOne = (value: string[]) =>
    setOpen((prev) => {
      const added = value.filter((v) => !prev.includes(v));
      return added.length ? [added[added.length - 1]] : value;
    });

  // A few results: open them at once.
  useEffect(() => {
    if (hits && hits.size > 0 && hits.size <= 3) setOpen((o) => Array.from(new Set([...o, ...hits])));
  }, [hits]);

  // /help#<question> opens that answer and goes to it; /help#<section> goes to the section.
  useEffect(() => {
    let id = hash.replace(/^#/, '');
    // A malformed escape (a cut link, "%E0%A4%A") must not break the page.
    try { id = decodeURIComponent(id); } catch { /* keep it as it is */ }
    if (!id) return;
    if (quietHash.current === id) {
      quietHash.current = null;
      return;
    }
    const isItem = itemIds.has(id);
    if (isItem) {
      setQuery('');
      setOpen([id]);
      setFlash(id);
    }
    let f1 = 0;
    let f2 = 0;
    // Two frames: the search is cleared and the answer opened before measuring.
    f1 = requestAnimationFrame(() => {
      f2 = requestAnimationFrame(() => {
        const el = document.getElementById(id);
        if (!el) return;
        el.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block: 'start' });
        if (isItem) el.querySelector<HTMLElement>('[data-help-trigger]')?.focus({ preventScroll: true });
      });
    });
    return () => {
      cancelAnimationFrame(f1);
      cancelAnimationFrame(f2);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hash, locationKey]);

  useEffect(() => {
    if (!flash) return;
    const id = window.setTimeout(() => setFlash(null), 2400);
    return () => window.clearTimeout(id);
  }, [flash]);

  // The section being read, for the list on the left (from 1024 px).
  useEffect(() => {
    if (searching || typeof IntersectionObserver === 'undefined') return;
    const els = sections.map((s) => document.getElementById(s.id)).filter((el): el is HTMLElement => !!el);
    const seen = new Map<string, boolean>();
    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((e) => seen.set(e.target.id, e.isIntersecting));
        const first = sections.find((s) => seen.get(s.id));
        if (first) setActiveSection(first.id);
      },
      { rootMargin: '-20% 0px -65% 0px' },
    );
    els.forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, [sections, searching]);

  const copyLink = async (item: HelpItem) => {
    const url = `${window.location.origin}/help#${item.id}`;
    quietHash.current = item.id;
    navigate({ hash: item.id }, { replace: true, preventScrollReset: true });
    try {
      await navigator.clipboard.writeText(url);
      toast({ title: t('help.copied', 'Link copied'), description: t('help.copiedBody', 'Paste it in an e-mail or a message: it opens this answer.') });
    } catch {
      toast({ title: t('help.copyFallback', 'The link is in the address bar'), description: url });
    }
  };

  const shownSections = sections
    .map((s) => ({ ...s, items: hits ? s.items.filter((i) => hits.has(i.id)) : s.items }))
    .filter((s) => s.items.length > 0);
  // While searching, the sections whose questions or title hold the words come
  // first ("email": E-mails and unsubscribing before Service providers), and
  // the topics before the profiles when that is where they are.
  const strong = result.strong;
  const rank = (s: HelpSection) => (strong ? s.items.filter((i) => strong.has(i.id)).length : 0);
  if (searching) shownSections.sort((a, b) => rank(b) - rank(a));
  const profiles = shownSections.filter((s) => s.group === 'profile');
  const topics = shownSections.filter((s) => s.group === 'topic');
  const topicsFirst = searching && Math.max(0, ...topics.map(rank)) > Math.max(0, ...profiles.map(rank));
  const groups = [
    {
      id: 'help-profiles',
      toc: t('help.groupProfilesShort', 'Profiles'),
      eyebrow: t('help.groupProfilesEyebrow', 'By profile'),
      title: t('help.groupProfilesTitle', 'Help for your profile'),
      list: profiles,
    },
    {
      id: 'help-topics',
      toc: t('help.groupTopics', 'Topics'),
      eyebrow: t('help.groupTopicsEyebrow', 'By topic'),
      title: t('help.groupTopicsTitle', 'Help by topic'),
      list: topics,
    },
  ].filter((g) => g.list.length > 0);
  if (topicsFirst) groups.reverse();
  const allProfiles = sections.filter((s) => s.group === 'profile');
  const allTopics = sections.filter((s) => s.group === 'topic');

  const meta = plainPageMeta('/help');

  // Still stuck? A person at M3: the contact form, and the address in plain sight.
  const stuck = (
    <Reveal className="mt-16 md:mt-20">
      <ContactCard
        variant="panel"
        title={t('help.stuckTitle', 'Still stuck?')}
        line={t('help.stuckLineAddress', 'A person at M3 reads every message and answers you by e-mail. You can also write to events@m3monaco.com.')}
        cta={{ label: t('help.stuckCta', 'Write to the team'), to: '/contact' }}
      />
    </Reveal>
  );

  return (
    <div>
      {meta && <Seo {...meta} />}

      <PageHero
        image={SITE_IMAGES.contactHero}
        seed="help-hero"
        icon={HelpCircle}
        eyebrow={t('help.eyebrow', 'Help centre')}
        title={t('help.title', 'How can we help?')}
        subtitle={t('help.subtitle', 'Short answers about your account, the M3 checks, your company, messages, publishing a need and events.')}
        breadcrumbs={[{ label: t('nav.home', 'Home'), href: '/' }, { label: t('help.crumb', 'Help') }]}
      >
        <SearchField
          tone="onPhoto"
          size="lg"
          className="max-w-xl"
          value={query}
          onValueChange={setQuery}
          onSearch={() => resultsRef.current?.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block: 'start' })}
          label={t('help.searchLabel', 'Search the help centre')}
          placeholder={t('help.searchPlaceholderShort', 'For example: password')}
        />
      </PageHero>

      <div className="bg-page">
        <div ref={resultsRef} id="help-results" className="mx-auto max-w-7xl px-4 pb-16 pt-10 sm:px-6 md:pb-24 md:pt-14">
          {/* What the search found, said out loud once the typing settles. */}
          <p className="sr-only" role="status" aria-live="polite" aria-atomic="true">
            {!searching
              ? ''
              : result.mode === 'none'
                ? t('help.noneTitle', 'No answer has these words')
                : closest
                ? t('help.closestFound', { count: hitCount, defaultValue_one: 'No answer has all these words. The closest answer is below.', defaultValue_other: 'No answer has all these words. The {{count}} closest answers are below.' })
                : t('help.found', { count: hitCount, query: query.trim(), defaultValue_one: '{{count}} answer for “{{query}}”', defaultValue_other: '{{count}} answers for “{{query}}”' })}
          </p>

          {searching ? (
            <div className="mb-10 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div aria-hidden="true">
                <p className="text-body-lg text-navy">
                  {closest
                    ? t('help.closestTitle', { query: query.trim(), defaultValue: 'The closest answers for “{{query}}”' })
                    : t('help.found', { count: hitCount, query: query.trim(), defaultValue_one: '{{count}} answer for “{{query}}”', defaultValue_other: '{{count}} answers for “{{query}}”' })}
                </p>
                {closest && (
                  <p className="mt-1 text-body text-meta">{t('help.closestBody', 'No answer has all these words. Try fewer words, or write to the team below.')}</p>
                )}
              </div>
              {hitCount > 0 && (
                <UnderlineLink onClick={() => setQuery('')} arrow={false} className="min-h-11 !text-[15px]">
                  {t('help.showAll', 'Show all the questions')}
                </UnderlineLink>
              )}
            </div>
          ) : (
            <StartHere profiles={allProfiles} topics={allTopics} mine={mine} />
          )}

          {searching && hitCount === 0 ? (
            <>
            <CardShell className="items-start gap-4 p-6 sm:flex-row sm:items-center sm:p-8">
              <span aria-hidden="true" className="grid h-12 w-12 shrink-0 place-items-center rounded-field bg-chip text-navy">
                <SearchX className="h-6 w-6" />
              </span>
              <div className="min-w-0 flex-1">
                <h2 className="text-card-title text-navy">{t('help.noneTitle', 'No answer has these words')}</h2>
                <p className="mt-1 text-body text-meta">{t('help.noneBody', 'Try a shorter word, such as “password”, “verified” or “webinar”, or write to the team below.')}</p>
              </div>
              <Button type="button" variant="ctaOutline" size="sm" arrow={false} onClick={() => setQuery('')}>
                {t('help.showAll', 'Show all the questions')}
              </Button>
            </CardShell>
            {stuck}
            </>
          ) : (
            <div className="lg:grid lg:grid-cols-12 lg:gap-12">
              {/* The sections, following the reader (from 1024 px). No overflow-hidden above it. */}
              <aside className="hidden lg:col-span-3 lg:block">
                {/* Taller than a laptop screen (1366x768): it scrolls on its own. Overflow on the sticky element itself is fine. */}
                <nav
                  aria-label={t('help.tocLabel', 'Help sections')}
                  className="sticky -mx-1 overflow-y-auto overscroll-contain px-1 pb-2 transition-[top] duration-300"
                  style={{ top: 'calc(var(--header-h, 64px) + 24px)', maxHeight: 'calc(100vh - var(--header-h, 64px) - 48px)' }}
                >
                  {groups.map((g) => (
                    <div key={g.id} className="mb-6">
                      <p className="text-meta-caps mb-2">{g.toc}</p>
                      <ul className="space-y-0.5 border-l border-rule">
                        {g.list.map((s) => {
                          const on = !searching && activeSection === s.id;
                          return (
                            <li key={s.id}>
                              <Link
                                to={`#${s.id}`}
                                aria-current={on ? 'location' : undefined}
                                className={cn(
                                  'focus-ring -ml-px flex min-h-10 items-center border-l-2 py-1.5 pl-4 pr-2 text-[15px] leading-5 transition-colors',
                                  on ? 'border-gold font-semibold text-navy' : 'border-transparent text-meta hover:border-navy/30 hover:text-navy',
                                )}
                              >
                                {s.title}
                              </Link>
                            </li>
                          );
                        })}
                      </ul>
                    </div>
                  ))}
                </nav>
              </aside>

              <div className="min-w-0 lg:col-span-9">
                {groups.map((g, i) => (
                  <Group
                    key={g.id}
                    id={g.id}
                    number={`0${i + 2}`}
                    eyebrow={g.eyebrow}
                    title={g.title}
                    sections={g.list}
                    open={open}
                    onOpenChange={openOne}
                    flash={flash}
                    mine={mine}
                    member={!!user}
                    onCopy={copyLink}
                    className={i > 0 ? 'mt-16 md:mt-20' : undefined}
                  />
                ))}
                {stuck}
              </div>
            </div>
          )}

          <HelpButtonToggle />
        </div>
      </div>
    </div>
  );
}

/**
 * "Show the help button again": only for a reader who hid the floating Help
 * button (HelpLauncher.tsx) in this browser. It stays after being switched on,
 * so the reader sees the change, and can switch it off again from here.
 * /help#help-button lands on it (the note shown when the button is hidden links here).
 */
function HelpButtonToggle() {
  const { t } = useTranslation();
  const hidden = useHelpButtonHidden();
  const [touched, setTouched] = useState(false);
  if (!hidden && !touched) return null;
  return (
    <div id="help-button" className="mt-10 flex items-center justify-between gap-4 rounded-card border border-rule bg-white p-5 sm:p-6 lg:ml-[calc(25%+0.75rem)]">
      <div className="min-w-0">
        <label htmlFor="help-button-toggle" className="block cursor-pointer text-[16px] font-semibold leading-6 text-navy">
          {t('help.buttonToggle', 'Show the help button again')}
        </label>
        <p id="help-button-toggle-hint" className="mt-1 text-[15px] leading-[22px] text-meta">
          {t('help.buttonToggleHint', 'A small Help button at the bottom left of the pages where members often have questions.')}
        </p>
        <p className="mt-1 text-[14px] font-medium leading-5 text-teal-text empty:hidden" role="status" aria-live="polite">
          {touched ? (hidden ? t('help.buttonToggleOff', 'The Help button is hidden.') : t('help.buttonToggleOn', 'The Help button is back.')) : ''}
        </p>
      </div>
      <Switch
        id="help-button-toggle"
        checked={!hidden}
        onCheckedChange={(on) => {
          setTouched(true);
          setHelpButtonHidden(!on);
        }}
        aria-describedby="help-button-toggle-hint"
        // 24 px to look at, 44 px to touch.
        className="relative before:absolute before:-inset-x-1 before:-inset-y-2.5 before:content-[''] focus-visible:shadow-focus focus-visible:ring-0 focus-visible:ring-offset-0 data-[state=checked]:bg-navy data-[state=unchecked]:bg-checkbox/40"
      />
    </div>
  );
}

/** "Start here": the profiles, then the topics, each card a jump to its section. */
function StartHere({ profiles, topics, mine }: { profiles: HelpSection[]; topics: HelpSection[]; mine: string | null }) {
  const { t } = useTranslation();
  return (
    <section aria-labelledby="help-start" className="mb-16 md:mb-20">
      <SectionHead
        id="help-start"
        number="01"
        eyebrow={t('help.startEyebrow', 'Start here')}
        title={t('help.startTitle', 'Which profile are you?')}
        intro={t('help.startIntro', 'Choose your profile for what you can do on the platform, or a topic below.')}
      />
      <ul className="mt-8 grid grid-cols-2 gap-2 sm:gap-3 md:grid-cols-3 xl:grid-cols-6">
        {profiles.map((s) => (
          <li key={s.id} className="flex">
            <JumpCard section={s} mine={s.id === mine} />
          </li>
        ))}
      </ul>
      <h3 className="text-meta-caps mt-10">{t('help.orTopic', 'Or choose a topic')}</h3>
      <ul className="mt-4 grid grid-cols-2 gap-2 sm:gap-3 lg:grid-cols-4">
        {topics.map((s) => (
          <li key={s.id} className="flex">
            <JumpCard section={s} />
          </li>
        ))}
      </ul>
    </section>
  );
}

function JumpCard({ section, mine = false }: { section: HelpSection; mine?: boolean }) {
  const { t } = useTranslation();
  const Icon = section.icon;
  // Phones: two cards a row, the icon above the title so whole words fit ("connections", "unsubscribing").
  return (
    <CardShell as="div" interactive className={cn('w-full flex-col items-start gap-2 p-3 min-[480px]:flex-row min-[480px]:items-center sm:gap-3 sm:p-4', mine && 'border-gold ring-1 ring-inset ring-gold')}>
      <span aria-hidden="true" className="grid h-8 w-8 shrink-0 place-items-center rounded-field bg-chip text-navy sm:h-11 sm:w-11">
        <Icon className="h-4 w-4 sm:h-5 sm:w-5" />
      </span>
      <span className="min-w-0 flex-1 self-stretch min-[480px]:self-auto">
        <StretchedLink to={`#${section.id}`} className="text-[15px] font-semibold leading-5 text-navy [overflow-wrap:break-word] sm:text-[16px] sm:leading-6">
          {section.title}
        </StretchedLink>
        {mine && (
          <span className="mt-1 block text-[13px] font-semibold leading-4 text-gold-text">{t('help.yourProfile', 'Your profile')}</span>
        )}
      </span>
    </CardShell>
  );
}

/** A group (profiles, topics): its heading, then its sections. */
function Group({
  id,
  number,
  eyebrow,
  title,
  sections,
  open,
  onOpenChange,
  flash,
  mine,
  member,
  onCopy,
  className,
}: {
  id: string;
  number: string;
  eyebrow: string;
  title: string;
  sections: HelpSection[];
  open: string[];
  onOpenChange: (value: string[]) => void;
  flash: string | null;
  mine: string | null;
  member: boolean;
  onCopy: (item: HelpItem) => void;
  className?: string;
}) {
  const { t } = useTranslation();
  return (
    <section aria-labelledby={id} className={className}>
      <SectionHead id={id} number={number} eyebrow={eyebrow} title={title} />
      <div className="mt-10 space-y-12 md:space-y-14">
        {sections.map((s) => {
          const Icon = s.icon;
          return (
            <section key={s.id} id={s.id} aria-labelledby={`${s.id}-title`}>
              <div className="flex items-start gap-4">
                <span aria-hidden="true" className="grid h-12 w-12 shrink-0 place-items-center rounded-field bg-white text-navy ring-1 ring-inset ring-rule">
                  <Icon className="h-6 w-6" />
                </span>
                <div className="min-w-0">
                  <h3 id={`${s.id}-title`} className="flex flex-wrap items-center gap-x-3 gap-y-1 text-h3 text-navy">
                    {s.title}
                    {s.id === mine && (
                      <span className="rounded-pill bg-gold/20 px-2.5 py-0.5 text-[13px] font-semibold leading-5 text-navy">
                        {t('help.yourProfile', 'Your profile')}
                      </span>
                    )}
                  </h3>
                  <p className="mt-1 text-body text-meta">{s.intro}</p>
                </div>
              </div>
              <AccordionPrimitive.Root type="multiple" value={open} onValueChange={onOpenChange} className="mt-5 space-y-3">
                {s.items.map((item) => (
                  <Question key={item.id} item={item} flash={flash === item.id} member={member} onCopy={onCopy} />
                ))}
              </AccordionPrimitive.Root>
            </section>
          );
        })}
      </div>
    </section>
  );
}

function Question({ item, flash, member, onCopy }: { item: HelpItem; flash: boolean; member: boolean; onCopy: (item: HelpItem) => void }) {
  const { t } = useTranslation();
  const links = (item.links ?? []).filter((l) => member || !l.members);
  return (
    <AccordionPrimitive.Item
      value={item.id}
      id={item.id}
      className={cn(
        'rounded-card border bg-white px-5 transition-[box-shadow,border-color] duration-500 data-[state=open]:shadow-hover',
        flash ? 'border-gold ring-2 ring-gold/60' : 'border-rule',
      )}
    >
      <AccordionPrimitive.Header asChild>
        <h4 className="flex">
          <AccordionPrimitive.Trigger
            data-help-trigger=""
            className="group -mx-5 flex min-h-[64px] flex-1 items-center justify-between gap-4 rounded-card px-5 py-4 text-left text-[17px] font-semibold leading-6 text-navy focus-visible:shadow-focus focus-visible:outline-none"
          >
            <span className="min-w-0 [overflow-wrap:anywhere]">{item.q}</span>
            <span aria-hidden="true" className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-chip text-navy transition-colors group-hover:bg-navy group-hover:text-white">
              <ChevronDown className="h-4 w-4 transition-transform duration-200 group-data-[state=open]:rotate-180 motion-reduce:transition-none" />
            </span>
          </AccordionPrimitive.Trigger>
        </h4>
      </AccordionPrimitive.Header>
      <AccordionPrimitive.Content className="overflow-hidden data-[state=closed]:animate-accordion-up data-[state=open]:animate-accordion-down motion-reduce:!animate-none">
        <div className="max-w-3xl space-y-3 pb-5 text-body text-ink">
          {/* The how-to first, then what follows from it. */}
          {item.steps && (
            <ol className="space-y-2">
              {item.steps.map((s, i) => (
                <li key={s} className="flex items-start gap-3">
                  <span aria-hidden="true" className="mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full bg-foam text-[13px] font-semibold text-teal-text">
                    {i + 1}
                  </span>
                  <span className="min-w-0">
                    <span className="sr-only">{t('help.step', { n: i + 1, defaultValue: 'Step {{n}}:' })} </span>
                    {s}
                  </span>
                </li>
              ))}
            </ol>
          )}
          {item.a.map((p) => <p key={p}>{p}</p>)}
          {links.length > 0 && (
            <div className="flex flex-wrap gap-x-6 gap-y-2 pt-1">
              {links.map((l) => (
                <UnderlineLink key={l.to} to={l.to} className="min-h-11 !text-[15px]">
                  {l.label}
                </UnderlineLink>
              ))}
            </div>
          )}
          <div className="border-t border-rule pt-3">
            <button
              type="button"
              onClick={() => onCopy(item)}
              className="focus-ring inline-flex min-h-11 items-center gap-2 rounded-field px-1 text-[14px] font-medium text-meta transition-colors hover:text-navy"
            >
              <Link2 className="h-4 w-4" aria-hidden="true" />
              {t('help.copyLink', 'Copy the link to this answer')}
            </button>
          </div>
        </div>
      </AccordionPrimitive.Content>
    </AccordionPrimitive.Item>
  );
}
