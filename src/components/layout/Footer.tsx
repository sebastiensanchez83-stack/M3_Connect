import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Instagram } from 'lucide-react';

export function Footer() {
  const { t } = useTranslation();

  return (
    <footer className="bg-primary text-white">
      <div className="container mx-auto px-4 py-12">
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-5 gap-8">
          {/* Logo & Tagline */}
          <div className="col-span-1 sm:col-span-2">
            <div className="flex items-center gap-2.5 mb-4">
              <img src="/logo-white.png" alt="" aria-hidden="true" className="h-11 w-auto" />
              <span
                className="text-xl tracking-tight"
                style={{ fontFamily: "'Outfit', system-ui, sans-serif", fontWeight: 600, letterSpacing: '-0.01em' }}
              >
                Smart Marina Connect
              </span>
            </div>
            <p className="text-gray-300 mb-4">{t('footer.tagline')}</p>
            <div className="flex space-x-4">
              {/* LinkedIn link removed pre-launch — pending correct Smart Marina Connect company page URL */}
              <a href="https://www.instagram.com/monacomarinamanagement/" target="_blank" rel="noopener noreferrer" className="text-gray-300 hover:text-white transition-colors" aria-label="Instagram">
                <Instagram className="h-5 w-5" />
              </a>
            </div>
          </div>

          {/* Links */}
          <div>
            <h3 className="font-semibold mb-4">{t('footer.platform')}</h3>
            <ul className="space-y-2">
              <li>
                <Link to="/resources" className="text-gray-300 hover:text-white transition-colors">
                  {t('nav.resources')}
                </Link>
              </li>
              <li>
                <Link to="/events" className="text-gray-300 hover:text-white transition-colors">
                  {t('nav.events')}
                </Link>
              </li>
              <li>
                <Link to="/partners" className="text-gray-300 hover:text-white transition-colors">
                  {t('nav.partners')}
                </Link>
              </li>
              <li>
                <Link to="/become-partner" className="text-gray-300 hover:text-white transition-colors">
                  {t('nav.becomePartner')}
                </Link>
              </li>
            </ul>
          </div>

          {/* Company */}
          <div>
            <h3 className="font-semibold mb-4">{t('footer.company', 'Company')}</h3>
            <ul className="space-y-2">
              <li>
                <Link to="/about" className="text-gray-300 hover:text-white transition-colors">
                  {t('footer.about')}
                </Link>
              </li>
              <li>
                <Link to="/contact" className="text-gray-300 hover:text-white transition-colors">
                  {t('footer.contact')}
                </Link>
              </li>
            </ul>
          </div>

          {/* Legal */}
          <div>
            <h3 className="font-semibold mb-4">{t('footer.legal')}</h3>
            <ul className="space-y-2">
              <li>
                <Link to="/terms" className="text-gray-300 hover:text-white transition-colors">
                  {t('footer.terms')}
                </Link>
              </li>
              <li>
                <Link to="/privacy" className="text-gray-300 hover:text-white transition-colors">
                  {t('footer.privacy')}
                </Link>
              </li>
              <li>
                <Link to="/mentions-legales" className="text-gray-300 hover:text-white transition-colors">
                  {t('footer.legalNotice')}
                </Link>
              </li>
              <li>
                <Link to="/conditions-commerciales" className="text-gray-300 hover:text-white transition-colors">
                  {t('footer.commercialTerms')}
                </Link>
              </li>
              <li>
                <Link to="/cookies" className="text-gray-300 hover:text-white transition-colors">
                  {t('footer.cookiePolicy')}
                </Link>
              </li>
            </ul>
          </div>
        </div>

        <div className="border-t border-gray-700 mt-8 pt-8 text-center text-gray-400 text-sm">
          {t('footer.copyright')}
        </div>
      </div>
    </footer>
  );
}
