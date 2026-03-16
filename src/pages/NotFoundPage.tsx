import { Link } from 'react-router-dom';
import { Helmet } from 'react-helmet-async';
import { Button } from '@/components/ui/button';
import { Home, AlertCircle } from 'lucide-react';
import { useTranslation } from 'react-i18next';

export function NotFoundPage() {
  const { t } = useTranslation();

  return (
    <div className="container mx-auto px-4 py-24 text-center">
      <Helmet>
        <title>404 — M3 Connect</title>
      </Helmet>
      <AlertCircle className="h-16 w-16 text-gray-300 mx-auto mb-6" />
      <h1 className="text-4xl font-bold text-primary mb-3">404</h1>
      <p className="text-lg text-gray-600 mb-8">
        {t('errors.pageNotFound', 'The page you are looking for does not exist or has been moved.')}
      </p>
      <Button asChild>
        <Link to="/">
          <Home className="h-4 w-4 mr-2" />
          {t('common.backToHome', 'Back to Home')}
        </Link>
      </Button>
    </div>
  );
}
