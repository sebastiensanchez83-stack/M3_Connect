import { useTranslation } from 'react-i18next';
import { Anchor } from 'lucide-react';

export function AboutPage() {
  const { t } = useTranslation();

  return (
    <div className="container mx-auto px-4 py-16 max-w-3xl">
      <div className="flex items-center space-x-3 mb-8">
        <Anchor className="h-10 w-10 text-primary" />
        <h1 className="text-3xl font-bold text-primary">{t('about.title', 'About M3 Connect')}</h1>
      </div>
      <div className="prose prose-lg max-w-none">
        <p className="text-gray-600 text-lg leading-relaxed">
          {t('about.intro', 'M3 Connect is the B2B platform dedicated to the marina industry, connecting marinas, partners, and media professionals worldwide.')}
        </p>
        <p className="text-gray-600 leading-relaxed mt-4">
          {t('about.mission', 'Our mission is to foster innovation, collaboration, and sustainable growth across the global marina ecosystem by providing a centralized platform for knowledge sharing, networking, and business development.')}
        </p>
        <p className="text-gray-600 leading-relaxed mt-4">
          {t('about.based', 'Based in Monaco, M3 Connect is operated by Monaco Marina Management (M3).')}
        </p>
      </div>
    </div>
  );
}
