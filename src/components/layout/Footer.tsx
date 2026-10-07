import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Instagram, Linkedin } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { accountHref } from '@/lib/accountNav';

/**
 * The footer repeats the navigation's own names — Directory, Opportunities,
 * Resources, Events, Partners — so a visitor who scrolls to the bottom finds
 * the same map as at the top. The second column follows who is reading: a
 * member gets their own area, a visitor gets the way in.
 */
export function Footer() {
  const { t } = useTranslation();
  const { user } = useAuth();

  const linkClass = 'text-gray-300 hover:text-white transition-colors';

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
    <footer className="bg-primary text-white">
      <div className="container mx-auto px-4 py-12">
        <div className="grid grid-cols-1 gap-8 sm:grid-cols-2 md:grid-cols-6">
          {/* Logo & Tagline */}
          <div className="col-span-1 sm:col-span-2">
            <div className="mb-4 flex items-center gap-2.5">
              <img src="/logo-white.png" alt="" aria-hidden="true" className="h-11 w-auto" />
              <span
                className="text-xl tracking-tight"
                style={{ fontFamily: "'Outfit', system-ui, sans-serif", fontWeight: 600, letterSpacing: '-0.01em' }}
              >
                Smart Marina Connect
              </span>
            </div>
            <p className="mb-4 text-gray-300">{t('footer.tagline')}</p>
            <div className="flex space-x-4">
              {/* No Smart Marina Connect page on LinkedIn: the platform is M3's, so the link is M3's company page. */}
              <a href="https://www.linkedin.com/company/monaco-marina-management" target="_blank" rel="noopener noreferrer" className={linkClass} aria-label="LinkedIn">
                <Linkedin className="h-5 w-5" />
              </a>
              <a href="https://www.instagram.com/monacomarinamanagement/" target="_blank" rel="noopener noreferrer" className={linkClass} aria-label="Instagram">
                <Instagram className="h-5 w-5" />
              </a>
            </div>
          </div>

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

        <div className="mt-8 border-t border-white/15 pt-8 text-center text-sm text-gray-300">
          {t('footer.copyright')}
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
      <h3 className="mb-4 font-semibold">{title}</h3>
      <ul className="space-y-2">
        {links.map((l) => (
          <li key={l.to}>
            <Link to={l.to} className={linkClass}>{l.label}</Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
