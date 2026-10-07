import { useId, useRef, useState, type CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';
import { BadgeCheck, ChevronDown, Instagram, Linkedin } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { accountHref } from '@/lib/accountNav';
import { cn } from '@/lib/utils';
import { BathyPattern } from '@/components/motion/BathyPattern';
import { MotionPauseToggle } from '@/components/motion/MotionPauseToggle';
import { useMotion } from '@/components/motion/MotionProvider';
import { useInView } from '@/components/motion/useInView';
import { NewsletterField } from '@/components/brand/NewsletterField';
import { UnderlineLink } from '@/components/brand/UnderlineLink';

/**
 * The site footer: navy, with two layers of faint sounding lines drifting in
 * opposite directions, the newsletter pill, the brand and its columns, a small
 * bottom bar (copyright, the coordinates of Monaco, the animation pause), and
 * the giant "Smart Marina Connect" signature at 13 vw, low contrast, its two
 * lines rising out of a mask when it scrolls into view.
 *
 * The footer repeats the navigation's own names — Directory, Opportunities,
 * Resources, Events, Partners — so a visitor who scrolls to the bottom finds
 * the same map as at the top. The second column follows who is reading: a
 * member gets their own area, a visitor gets the way in. Under md the columns
 * fold into accordions.
 */
export function Footer() {
  const { t } = useTranslation();
  const { user } = useAuth();

  const platform = [
    { to: '/directory', label: t('nav.directory', 'Directory') },
    { to: '/opportunities', label: t('nav.opportunities', 'Opportunities') },
    { to: '/resources', label: t('nav.resources') },
    { to: '/events', label: t('nav.events') },
    { to: '/partners', label: t('nav.partners') },
  ];

  const yours = user
    ? [
        { to: accountHref('dashboard'), label: t('nav.dashboard', 'Dashboard') },
        { to: accountHref('registrations'), label: t('accountNav.registrations', 'My events') },
        { to: accountHref('organization'), label: t('accountNav.organization', 'Organization & team') },
        { to: accountHref('inbox'), label: t('accountNav.inbox', 'Inbox') },
      ]
    : [
        { to: '/become-partner', label: t('nav.becomePartner') },
        // Event sponsorship is sold by the M3 team: the contact form, opened on that subject.
        { to: '/contact?subject=partnership', label: t('footer.sponsorEvent', 'Sponsor an event') },
      ];

  return (
    <footer className="relative overflow-hidden bg-navy-deep text-white">
      <BathyPattern seed={5} opacity={0.05} drift className="absolute inset-0" />
      <BathyPattern seed={8} opacity={0.05} driftReverse className="absolute inset-0" />

      <div className="relative mx-auto max-w-7xl px-4 sm:px-6">
        {/* Row 1: the newsletter */}
        <div id="newsletter" className="grid gap-6 border-b border-white/15 pb-12 pt-14 md:pt-[72px] lg:grid-cols-12 lg:gap-12">
          <div className="lg:col-span-5">
            <h2 className="text-[22px] font-semibold leading-7">{t('brand.footer.newsletterTitle', 'The Smart Marina Connect newsletter')}</h2>
            <p className="mt-2 text-[15px] leading-6 text-white/80">
              {t('brand.footer.newsletterBody', 'New articles, dates of our events and news from the platform.')}
            </p>
          </div>
          <NewsletterField hideLabel className="lg:col-span-7" />
        </div>

        {/* Row 2: brand and columns */}
        <div className="grid gap-10 border-b border-white/15 py-12 lg:grid-cols-12">
          <div className="lg:col-span-4">
            <div className="flex items-center gap-2.5">
              <img src="/logo-white.png" alt="" aria-hidden="true" className="h-[34px] w-auto" />
              <span className="font-wordmark text-xl font-semibold tracking-[-0.01em]">Smart Marina Connect</span>
            </div>
            <p className="mt-4 max-w-sm text-[15px] leading-6 text-white/80">{t('footer.tagline')}</p>
            <p className="mt-3 flex max-w-sm items-start gap-2.5 text-sm leading-[22px] text-white/80">
              <BadgeCheck className="mt-0.5 h-[18px] w-[18px] shrink-0 text-gold" aria-hidden="true" />
              <span>
                <span className="font-semibold text-white">{t('brand.footer.verified', 'Every member checked by the M3 team.')}</span>{' '}
                {t('brand.footer.free', 'The platform is free for every member.')}
              </span>
            </p>
            <div className="mt-5 flex gap-3">
              {/* No Smart Marina Connect page on LinkedIn: the platform is M3's, so the link is M3's company page. */}
              <a
                href="https://www.linkedin.com/company/monaco-marina-management"
                target="_blank"
                rel="noopener noreferrer"
                aria-label={t('brand.footer.linkedin', 'M3 Monaco on LinkedIn (opens in a new tab)')}
                className="social-disc focus-ring"
              >
                <Linkedin className="h-5 w-5" aria-hidden="true" />
              </a>
              <a
                href="https://www.instagram.com/monacomarinamanagement/"
                target="_blank"
                rel="noopener noreferrer"
                aria-label={t('brand.footer.instagram', 'M3 Monaco on Instagram (opens in a new tab)')}
                className="social-disc focus-ring"
              >
                <Instagram className="h-5 w-5" aria-hidden="true" />
              </a>
            </div>
          </div>

          <div className="grid border-t border-white/15 md:grid-cols-4 md:gap-8 md:border-t-0 lg:col-span-8">
            <FooterColumn title={t('footer.platform')} links={platform} />
            <FooterColumn title={user ? t('footer.yourSpace', 'Your space') : t('footer.join', 'Join')} links={yours} />
            <FooterColumn
              title={t('footer.company', 'Company')}
              links={[
                { to: '/about', label: t('footer.about') },
                { to: '/contact', label: t('footer.contact') },
              ]}
            />
            <FooterColumn
              title={t('footer.legal')}
              links={[
                { to: '/terms', label: t('footer.terms') },
                { to: '/privacy', label: t('footer.privacy') },
                { to: '/mentions-legales', label: t('footer.legalNotice') },
                { to: '/conditions-commerciales', label: t('footer.commercialTerms') },
                { to: '/cookies', label: t('footer.cookiePolicy') },
              ]}
            />
          </div>
        </div>

        {/* Row 3. footer-last-row: clears a page's fixed bottom action bar (smc-motion.css). */}
        <div className="footer-last-row flex flex-col gap-3 py-6 text-[13px] leading-5 text-white/70 sm:flex-row sm:items-center sm:justify-between">
          <p>{t('footer.copyright')}</p>
          <div className="flex flex-wrap items-center gap-x-5 gap-y-3">
            <p className="tabular text-[12px] leading-4 text-white/60">43°44′&nbsp;N · 7°25′&nbsp;E — Monaco</p>
            <MotionPauseToggle withLabel tone="dark" />
          </div>
        </div>
      </div>

      <Signature />
    </footer>
  );
}

/** "Smart Marina / Connect": 13 vw, low contrast, two lines rising out of a mask on entry. */
function Signature() {
  const ref = useRef<HTMLParagraphElement>(null);
  const { reduced } = useMotion();
  const inView = useInView(ref, { disabled: reduced, threshold: 0.2 });
  return (
    <p
      ref={ref}
      aria-hidden="true"
      className={cn(
        'relative -mt-[1vw] select-none whitespace-nowrap px-[2vw] pb-[1.5vw] font-wordmark text-[13vw] leading-[.9] tracking-[-0.045em]',
        inView && 'is-in',
      )}
    >
      <span className="rise-line font-light text-white/10">
        <span style={{ '--li': 0 } as CSSProperties}>Smart Marina</span>
      </span>
      <span className="rise-line text-right font-bold text-white/[.15]">
        <span style={{ '--li': 1 } as CSSProperties}>Connect</span>
      </span>
    </p>
  );
}

function FooterColumn({ title, links }: { title: string; links: { to: string; label: string }[] }) {
  const [open, setOpen] = useState(false);
  const listId = useId();
  return (
    <nav aria-label={title} className="border-b border-white/15 md:border-b-0">
      <h3 className="text-[12px] font-semibold uppercase leading-4 tracking-[0.08em] text-white/70">
        {/* Under md the title is the accordion button. */}
        <button
          type="button"
          aria-expanded={open}
          aria-controls={listId}
          onClick={() => setOpen((v) => !v)}
          className="focus-ring flex w-full items-center justify-between rounded-md py-4 uppercase md:hidden"
        >
          {title}
          <ChevronDown className={cn('h-4 w-4 transition-transform duration-300', open && 'rotate-180')} aria-hidden="true" />
        </button>
        <span className="hidden md:block">{title}</span>
      </h3>
      <ul id={listId} className={cn('space-y-3 pb-4 md:mt-4 md:block md:pb-0', open ? 'block' : 'hidden')}>
        {links.map((l) => (
          <li key={l.to}>
            <UnderlineLink to={l.to} tone="footer" arrow={false}>
              {l.label}
            </UnderlineLink>
          </li>
        ))}
      </ul>
    </nav>
  );
}
