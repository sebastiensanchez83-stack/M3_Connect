import { useEffect, useRef, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { BadgeCheck, Instagram, Linkedin } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { accountHref } from '@/lib/accountNav';
import { backgroundAbove } from '@/lib/backdropColor';
import { BathyPattern } from '@/components/motion/BathyPattern';
import { MotionPauseToggle } from '@/components/motion/MotionPauseToggle';
import { HarbourCoordinates, HorizonEdge, NewsletterField } from '@/components/brand/Horizon';

/**
 * The "horizon" footer. Its top edge is a waterline (two navy waves drifting
 * slowly in opposite directions) rising out of the last section of the page,
 * over faint sounding lines, with the coordinates of Monaco and Dubai. No
 * giant wordmark.
 *
 * The footer repeats the navigation's own names — Directory, Opportunities,
 * Resources, Events, Partners — so a visitor who scrolls to the bottom finds
 * the same map as at the top. The second column follows who is reading: a
 * member gets their own area, a visitor gets the way in.
 */
export function Footer() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const location = useLocation();
  const ref = useRef<HTMLElement>(null);
  const [above, setAbove] = useState<string | undefined>(undefined);

  // The band behind the wave crests takes the colour of the section above it.
  // Pages fill in after their data arrives, so look again a little later.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const read = () => setAbove(backgroundAbove(el));
    read();
    const timers = [400, 1500].map((ms) => window.setTimeout(read, ms));
    return () => timers.forEach((id) => window.clearTimeout(id));
  }, [location.pathname]);

  const linkClass = 'rounded-sm text-white/75 transition-colors hover:text-white focus-ring';

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
    <footer ref={ref} className="relative text-white">
      <HorizonEdge above={above} className="-mb-px" />
      <div className="relative overflow-hidden bg-navy-deep">
        <BathyPattern seed={5} className="absolute inset-0" drift />
        <div className="relative mx-auto max-w-7xl px-4 pb-8 pt-6 sm:px-6 md:pt-8">
          <div className="grid gap-10 lg:grid-cols-12">
            {/* Logo, tagline, social, coordinates */}
            <div className="lg:col-span-4">
              <div className="flex items-center gap-2.5">
                <img src="/logo-white.png" alt="" aria-hidden="true" className="h-11 w-auto" />
                <span className="font-wordmark text-xl font-semibold tracking-[-0.01em]">Smart Marina Connect</span>
              </div>
              <p className="mt-4 max-w-sm text-white/75">{t('footer.tagline')}</p>
              <div className="mt-4 flex items-center gap-2">
                {/* No Smart Marina Connect page on LinkedIn: the platform is M3's, so the link is M3's company page. */}
                <a
                  href="https://www.linkedin.com/company/monaco-marina-management"
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label="LinkedIn"
                  className="focus-ring grid h-10 w-10 place-items-center rounded-full text-white/80 ring-1 ring-inset ring-white/20 transition-colors hover:bg-white/10 hover:text-white"
                >
                  <Linkedin className="h-[18px] w-[18px]" aria-hidden="true" />
                </a>
                <a
                  href="https://www.instagram.com/monacomarinamanagement/"
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label="Instagram"
                  className="focus-ring grid h-10 w-10 place-items-center rounded-full text-white/80 ring-1 ring-inset ring-white/20 transition-colors hover:bg-white/10 hover:text-white"
                >
                  <Instagram className="h-[18px] w-[18px]" aria-hidden="true" />
                </a>
              </div>
              <HarbourCoordinates className="mt-6" />
            </div>

            {/* Link columns, as before */}
            <div className="grid grid-cols-2 gap-8 sm:grid-cols-4 lg:col-span-8">
              <FooterColumn title={t('footer.platform')} links={platform} linkClass={linkClass} />
              <FooterColumn
                title={user ? t('footer.yourSpace', 'Your space') : t('footer.join', 'Join')}
                links={yours}
                linkClass={linkClass}
              />
              <FooterColumn
                title={t('footer.company', 'Company')}
                links={[
                  { to: '/about', label: t('footer.about') },
                  { to: '/contact', label: t('footer.contact') },
                ]}
                linkClass={linkClass}
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
                linkClass={linkClass}
              />
            </div>
          </div>

          {/* Newsletter and the verification promise */}
          <div className="mt-10 grid gap-8 border-t border-white/10 pt-8 lg:grid-cols-12">
            <NewsletterField className="lg:col-span-5" />
            <div className="flex items-start gap-3 lg:col-span-6 lg:col-start-7 lg:justify-end">
              <BadgeCheck className="mt-0.5 h-5 w-5 shrink-0 text-[#7fc8d4]" aria-hidden="true" />
              <p className="max-w-sm text-sm text-white/80">
                <span className="font-semibold text-white">{t('brand.footer.verified', 'Every member checked by the M3 team.')}</span>{' '}
                {t('brand.footer.free', 'The platform is free for every member.')}
              </p>
            </div>
          </div>

          {/* footer-last-row: clears a page's fixed bottom action bar (smc-motion.css). */}
          <div className="footer-last-row mt-8 flex flex-col gap-4 border-t border-white/10 pt-6 text-sm text-white/65 sm:flex-row sm:items-center sm:justify-between">
            <p>{t('footer.copyright')}</p>
            <MotionPauseToggle withLabel tone="dark" className="self-start sm:self-auto" />
          </div>
        </div>
      </div>
    </footer>
  );
}

function FooterColumn({
  title,
  links,
  linkClass,
}: {
  title: string;
  links: { to: string; label: string }[];
  linkClass: string;
}) {
  return (
    <nav aria-label={title}>
      <h3 className="mb-4 text-[12px] font-semibold uppercase tracking-[0.08em] text-white/55">{title}</h3>
      <ul className="space-y-2.5 text-[15px]">
        {links.map((l) => (
          <li key={l.to}>
            <Link to={l.to} className={linkClass}>{l.label}</Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
