import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { Trans, useTranslation } from 'react-i18next';

const STORAGE_KEY = 'cookie_consent';

export function CookieBanner() {
  const { t } = useTranslation();
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const consent = localStorage.getItem(STORAGE_KEY);
    if (!consent) {
      setVisible(true);
    }
  }, []);

  const handleAccept = () => {
    localStorage.setItem(STORAGE_KEY, 'accepted');
    setVisible(false);
  };

  const handleDecline = () => {
    localStorage.setItem(STORAGE_KEY, 'declined');
    setVisible(false);
  };

  if (!visible) return null;

  return (
    <div
      // Read by the search suggestions (SearchSuggestions.tsx), which keep clear of the banner.
      data-cookie-banner=""
      className="fixed bottom-0 inset-x-0 z-50 animate-slide-up"
      role="banner"
      aria-label={t('cookieBanner.ariaLabel', 'Cookie consent')}
    >
      <div className="bg-gray-900/95 backdrop-blur-sm border-t border-gray-700 px-4 py-4 sm:px-6">
        <div className="container mx-auto flex flex-col sm:flex-row items-center justify-between gap-4">
          <p className="text-sm text-gray-200 text-center sm:text-left">
            <Trans
              i18nKey="cookieBanner.text"
              defaults="We use cookies to improve your experience. See our <policyLink>Cookie Policy</policyLink> for details."
              components={{
                policyLink: (
                  <Link
                    to="/cookies"
                    className="underline text-white hover:text-gray-300 transition-colors"
                  />
                ),
              }}
            />
          </p>
          <div className="flex items-center gap-3 shrink-0">
            <button
              onClick={handleDecline}
              className="rounded-lg border border-gray-500 px-4 py-2 text-sm font-medium text-gray-300 hover:bg-gray-800 hover:text-white transition-colors"
            >
              {t('cookieBanner.decline', 'Decline')}
            </button>
            <button
              onClick={handleAccept}
              className="rounded-lg bg-white px-4 py-2 text-sm font-medium text-gray-900 hover:bg-gray-200 transition-colors"
            >
              {t('cookieBanner.accept', 'Accept')}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
