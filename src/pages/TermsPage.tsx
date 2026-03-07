import { useTranslation } from 'react-i18next';

export function TermsPage() {
  const { t } = useTranslation();

  return (
    <div className="container mx-auto px-4 py-16 max-w-3xl">
      <h1 className="text-3xl font-bold text-primary mb-8">{t('terms.title', 'Terms of Service')}</h1>
      <div className="prose prose-lg max-w-none text-gray-600 space-y-6">
        <section>
          <h2 className="text-xl font-semibold text-gray-800">{t('terms.acceptance', 'Acceptance of Terms')}</h2>
          <p>
            {t('terms.acceptanceDesc', 'By accessing and using M3 Connect, you agree to be bound by these Terms of Service. If you do not agree to these terms, please do not use the platform.')}
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold text-gray-800">{t('terms.accounts', 'User Accounts')}</h2>
          <p>
            {t('terms.accountsDesc', 'You are responsible for maintaining the security of your account credentials. Each account must represent a real individual associated with a legitimate organization in the marina industry.')}
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold text-gray-800">{t('terms.conduct', 'Acceptable Use')}</h2>
          <p>
            {t('terms.conductDesc', 'Users agree to use M3 Connect for legitimate B2B purposes related to the marina industry. Any misuse, including spam, harassment, or fraudulent activity, may result in account suspension.')}
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold text-gray-800">{t('terms.liability', 'Limitation of Liability')}</h2>
          <p>
            {t('terms.liabilityDesc', 'M3 Connect provides the platform as-is and does not guarantee the accuracy of information provided by users or organizations. We are not liable for any disputes between platform users.')}
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold text-gray-800">{t('terms.contact', 'Contact')}</h2>
          <p>
            {t('terms.contactDesc', 'For questions about these terms, please contact us at contact@m3connect.mc.')}
          </p>
        </section>
      </div>
    </div>
  );
}
