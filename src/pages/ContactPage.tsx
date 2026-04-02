import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { toast } from '@/hooks/use-toast';
import { Mail, MapPin, Send, CheckCircle } from 'lucide-react';
import { supabase } from '@/lib/supabase';

interface ContactForm {
  name: string;
  email: string;
  subject: string;
  message: string;
}

const SUBJECT_OPTIONS = [
  { value: 'general', labelKey: 'contact.subjectGeneral', fallback: 'General Inquiry' },
  { value: 'partnership', labelKey: 'contact.subjectPartnership', fallback: 'Partnership' },
  { value: 'support', labelKey: 'contact.subjectSupport', fallback: 'Support' },
  { value: 'media', labelKey: 'contact.subjectMedia', fallback: 'Media' },
  { value: 'other', labelKey: 'contact.subjectOther', fallback: 'Other' },
];

export function ContactPage() {
  const { t } = useTranslation();
  const [form, setForm] = useState<ContactForm>({
    name: '',
    email: '',
    subject: '',
    message: '',
  });
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [errors, setErrors] = useState<Partial<Record<keyof ContactForm, string>>>({});

  function validate(): boolean {
    const newErrors: Partial<Record<keyof ContactForm, string>> = {};

    if (!form.name.trim()) {
      newErrors.name = t('contact.errorName', 'Please enter your name');
    }

    if (!form.email.trim()) {
      newErrors.email = t('contact.errorEmail', 'Please enter your email');
    } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email)) {
      newErrors.email = t('contact.errorEmailInvalid', 'Please enter a valid email address');
    }

    if (!form.subject) {
      newErrors.subject = t('contact.errorSubject', 'Please select a subject');
    }

    if (!form.message.trim()) {
      newErrors.message = t('contact.errorMessage', 'Please enter a message');
    } else if (form.message.trim().length < 10) {
      newErrors.message = t('contact.errorMessageShort', 'Message must be at least 10 characters');
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    if (!validate()) return;

    setSubmitting(true);

    try {
      // Try to insert into contact_submissions table
      const { error } = await supabase.from('contact_submissions').insert({
        name: form.name.trim(),
        email: form.email.trim(),
        subject: form.subject,
        message: form.message.trim(),
      });

      if (error) {
        // If table doesn't exist or insert fails, fall back to mailto
        console.warn('contact_submissions insert failed, falling back to mailto:', error.message);
        fallbackMailto();
        return;
      }

      setSubmitted(true);
      toast({
        title: t('contact.successTitle', 'Message Sent'),
        description: t(
          'contact.successDesc',
          'Thank you for reaching out. We will get back to you shortly.'
        ),
      });
    } catch (err) {
      console.error('Contact form error:', err);
      fallbackMailto();
    } finally {
      setSubmitting(false);
    }
  }

  function fallbackMailto() {
    const subjectLabel =
      SUBJECT_OPTIONS.find((s) => s.value === form.subject)?.fallback || form.subject;
    const mailtoSubject = encodeURIComponent(`[M3 Connect] ${subjectLabel}`);
    const mailtoBody = encodeURIComponent(
      `Name: ${form.name}\nEmail: ${form.email}\n\n${form.message}`
    );
    window.open(
      `mailto:contact@m3connect.mc?subject=${mailtoSubject}&body=${mailtoBody}`,
      '_self'
    );
    toast({
      title: t('contact.mailtoTitle', 'Opening Email Client'),
      description: t(
        'contact.mailtoDesc',
        'Your default email client will open with a pre-filled message.'
      ),
    });
    setSubmitted(true);
  }

  function handleChange(field: keyof ContactForm, value: string) {
    setForm((prev) => ({ ...prev, [field]: value }));
    if (errors[field]) {
      setErrors((prev) => ({ ...prev, [field]: undefined }));
    }
  }

  if (submitted) {
    return (
      <div className="container mx-auto px-4 py-16 max-w-3xl">
        <div className="text-center py-16">
          <CheckCircle className="h-16 w-16 text-green-500 mx-auto mb-6" />
          <h1 className="text-3xl font-bold text-gray-900 mb-4">
            {t('contact.thankYouTitle', 'Thank You!')}
          </h1>
          <p className="text-lg text-gray-600 mb-8">
            {t(
              'contact.thankYouDesc',
              'Your message has been sent successfully. Our team will review your inquiry and get back to you as soon as possible.'
            )}
          </p>
          <Button onClick={() => { setSubmitted(false); setForm({ name: '', email: '', subject: '', message: '' }); }}>
            {t('contact.sendAnother', 'Send Another Message')}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="container mx-auto px-4 py-16 max-w-5xl">
      <h1 className="text-3xl font-bold text-primary mb-2">
        {t('contact.title', 'Contact Us')}
      </h1>
      <p className="text-gray-600 mb-10">
        {t(
          'contact.subtitle',
          'Have a question or want to learn more about M3 Connect? We would love to hear from you.'
        )}
      </p>

      <div className="grid gap-8 lg:grid-cols-3">
        {/* Contact Form */}
        <div className="lg:col-span-2">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Send className="h-5 w-5 text-primary" />
                {t('contact.formTitle', 'Send Us a Message')}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleSubmit} className="space-y-5" noValidate>
                {/* Name */}
                <div className="space-y-2">
                  <Label htmlFor="contact-name">
                    {t('contact.nameLabel', 'Full Name')} <span className="text-red-500">*</span>
                  </Label>
                  <Input
                    id="contact-name"
                    type="text"
                    placeholder={t('contact.namePlaceholder', 'Your full name')}
                    value={form.name}
                    onChange={(e) => handleChange('name', e.target.value)}
                    className={errors.name ? 'border-red-500' : ''}
                  />
                  {errors.name && (
                    <p className="text-sm text-red-500">{errors.name}</p>
                  )}
                </div>

                {/* Email */}
                <div className="space-y-2">
                  <Label htmlFor="contact-email">
                    {t('contact.emailLabel', 'Email Address')} <span className="text-red-500">*</span>
                  </Label>
                  <Input
                    id="contact-email"
                    type="email"
                    placeholder={t('contact.emailPlaceholder', 'your.email@example.com')}
                    value={form.email}
                    onChange={(e) => handleChange('email', e.target.value)}
                    className={errors.email ? 'border-red-500' : ''}
                  />
                  {errors.email && (
                    <p className="text-sm text-red-500">{errors.email}</p>
                  )}
                </div>

                {/* Subject */}
                <div className="space-y-2">
                  <Label htmlFor="contact-subject">
                    {t('contact.subjectLabel', 'Subject')} <span className="text-red-500">*</span>
                  </Label>
                  <Select
                    value={form.subject}
                    onValueChange={(value) => handleChange('subject', value)}
                  >
                    <SelectTrigger
                      id="contact-subject"
                      className={errors.subject ? 'border-red-500' : ''}
                    >
                      <SelectValue
                        placeholder={t('contact.subjectPlaceholder', 'Select a subject')}
                      />
                    </SelectTrigger>
                    <SelectContent>
                      {SUBJECT_OPTIONS.map((opt) => (
                        <SelectItem key={opt.value} value={opt.value}>
                          {t(opt.labelKey, opt.fallback)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {errors.subject && (
                    <p className="text-sm text-red-500">{errors.subject}</p>
                  )}
                </div>

                {/* Message */}
                <div className="space-y-2">
                  <Label htmlFor="contact-message">
                    {t('contact.messageLabel', 'Message')} <span className="text-red-500">*</span>
                  </Label>
                  <Textarea
                    id="contact-message"
                    placeholder={t('contact.messagePlaceholder', 'Tell us how we can help...')}
                    value={form.message}
                    onChange={(e) => handleChange('message', e.target.value)}
                    rows={6}
                    className={errors.message ? 'border-red-500' : ''}
                  />
                  {errors.message && (
                    <p className="text-sm text-red-500">{errors.message}</p>
                  )}
                </div>

                <Button type="submit" disabled={submitting} className="w-full sm:w-auto">
                  {submitting ? (
                    <>
                      <span className="animate-spin mr-2">&#9696;</span>
                      {t('contact.sending', 'Sending...')}
                    </>
                  ) : (
                    <>
                      <Send className="mr-2 h-4 w-4" />
                      {t('contact.submitButton', 'Send Message')}
                    </>
                  )}
                </Button>
              </form>
            </CardContent>
          </Card>
        </div>

        {/* Contact Info Cards */}
        <div className="space-y-6">
          <h2 className="sr-only">{t('contact.infoTitle', 'Contact Information')}</h2>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Mail className="h-5 w-5 text-primary" />
                {t('contact.emailTitle', 'Email')}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <a
                href="mailto:contact@m3connect.mc"
                className="text-primary hover:underline"
              >
                contact@m3connect.mc
              </a>
              <p className="text-sm text-gray-500 mt-2">
                {t('contact.emailNote', 'We typically respond within 24-48 hours.')}
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <MapPin className="h-5 w-5 text-primary" />
                {t('contact.addressTitle', 'Address')}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-gray-600">Monaco Marina Management</p>
              <p className="text-gray-600">Principality of Monaco</p>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
