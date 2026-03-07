import { useTranslation } from 'react-i18next';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Mail, MapPin } from 'lucide-react';

export function ContactPage() {
  const { t } = useTranslation();

  return (
    <div className="container mx-auto px-4 py-16 max-w-3xl">
      <h1 className="text-3xl font-bold text-primary mb-8">{t('contact.title', 'Contact Us')}</h1>

      <div className="grid gap-6 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Mail className="h-5 w-5 text-primary" />
              {t('contact.emailTitle', 'Email')}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <a href="mailto:contact@m3connect.mc" className="text-primary hover:underline">
              contact@m3connect.mc
            </a>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <MapPin className="h-5 w-5 text-primary" />
              {t('contact.addressTitle', 'Address')}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-gray-600">Monaco Marina Management</p>
            <p className="text-gray-600">Monaco</p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
