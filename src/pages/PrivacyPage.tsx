import { useTranslation } from 'react-i18next';

export function PrivacyPage() {
  const { t } = useTranslation();

  return (
    <div className="container mx-auto px-4 py-16 max-w-3xl">
      <h1 className="text-3xl font-bold text-primary mb-8">{t('privacy.title', 'Privacy Policy')}</h1>
      <div className="prose prose-lg max-w-none text-gray-600 space-y-6">
        <section>
          <h2 className="text-xl font-semibold text-gray-800">{t('privacy.dataCollection', 'Data Collection')}</h2>
          <p>
            {t('privacy.dataCollectionDesc', 'M3 Connect collects personal information you provide during registration, including your name, email, job title, and organization details. This data is used to operate the platform and connect you with relevant industry contacts.')}
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold text-gray-800">{t('privacy.dataUse', 'Data Use')}</h2>
          <p>
            {t('privacy.dataUseDesc', 'Your data is used to personalize your experience, display your organization in the marketplace, facilitate B2B connections, and communicate platform updates. We do not sell your personal data to third parties.')}
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold text-gray-800">{t('privacy.dataProtection', 'Data Protection')}</h2>
          <p>
            {t('privacy.dataProtectionDesc', 'We implement industry-standard security measures to protect your information. Data is stored securely and access is restricted to authorized personnel only.')}
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold text-gray-800">{t('privacy.contact', 'Contact')}</h2>
          <p>
            {t('privacy.contactDesc', 'For questions about this privacy policy, please contact us at contact@m3connect.mc.')}
          </p>
        </section>
      </div>
    </div>
  );
}
