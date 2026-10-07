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
import { Helmet } from 'react-helmet-async';
import { supabase } from '@/lib/supabase';
import { PageHero } from '@/components/ui/PageHero';
import { SITE_IMAGES } from '@/lib/siteMedia';

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
  // Honeypot: people never see this field; a value means a bot (the function then
  // answers ok without storing or sending anything).
  const [honeypot, setHoneypot] = useState('');
  // Why the last send did not go through: shown above the button. 'invalid' = the
  // server refused the fields (400): retrying the same input will not help.
  const [submitError, setSubmitError] = useState<'invalid' | 'rate_limited' | 'failed' | null>(null);

  function validate(): boolean {
    const newErrors: Partial<Record<keyof ContactForm, string>> = {};

    if (!form.name.trim()) {
      newErrors.name = t('contact.errorName', 'Please enter your name');
    }

    if (!form.email.trim()) {
      newErrors.email = t('contact.errorEmail', 'Please enter your email');
    } else if (!/^[^\s@]+@[^\s@]+\.[^\s@.]{2,}$/.test(form.email.trim())) {
      newErrors.email = t('contact.errorEmailInvalid', 'Please enter a valid email address');
    }

    if (!form.subject) {
      newErrors.subject = t('contact.errorSubject', 'Please select a subject');
    }

    if (!form.message.trim()) {
      newErrors.message = t('contact.errorMessage', 'Please enter a message');
    } else if (Array.from(form.message.trim()).length < 10) {
      // Characters as the server counts them (code points: an emoji is one).
      newErrors.message = t('contact.errorMessageShort', 'Message must be at least 10 characters');
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  }

  // The edge function contact-submit stores the message and e-mails it to
  // events@m3monaco.com. The thank-you screen is shown only on { ok: true }.
  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (submitting) return;

    if (!validate()) return;

    setSubmitting(true);
    setSubmitError(null);

    try {
      const { data, error } = await supabase.functions.invoke<{ ok?: boolean }>('contact-submit', {
        body: {
          name: form.name.trim(),
          email: form.email.trim(),
          subject: form.subject,
          message: form.message.trim(),
          source: window.location.pathname.slice(0, 200),
          website: honeypot,
        },
      });

      if (error) {
        // supabase-js wraps any non-2xx answer; the status is on error.context.
        const status = (error as { context?: { status?: number } }).context?.status;
        setSubmitError(status === 400 ? 'invalid' : status === 429 ? 'rate_limited' : 'failed');
        return;
      }
      if (data?.ok !== true) {
        setSubmitError('failed');
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
      setSubmitError('failed');
    } finally {
      setSubmitting(false);
    }
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
          <Button onClick={() => { setSubmitted(false); setSubmitError(null); setHoneypot(''); setForm({ name: '', email: '', subject: '', message: '' }); }}>
            {t('contact.sendAnother', 'Send Another Message')}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <>
      <Helmet>
        <title>Contact Us — Smart Marina Connect</title>
        <meta name="description" content="Get in touch with the Smart Marina Connect team. We're here to answer questions about the platform, partnerships and onboarding." />
      </Helmet>
      {/* A round-table workshop from SM26: people talking things through. */}
      <PageHero
        image={SITE_IMAGES.contactHero}
        seed="contact-hero"
        containerClassName="max-w-5xl"
        icon={Mail}
        title={t('contact.title', 'Contact Us')}
        subtitle={t(
          'contact.subtitle',
          'Have a question or want to learn more about Smart Marina Connect? We would love to hear from you.'
        )}
      />
    <div className="container mx-auto px-4 py-12 max-w-5xl">

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
                    maxLength={120}
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
                    maxLength={254}
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
                    maxLength={5000}
                    value={form.message}
                    onChange={(e) => handleChange('message', e.target.value)}
                    rows={6}
                    className={errors.message ? 'border-red-500' : ''}
                  />
                  {errors.message && (
                    <p className="text-sm text-red-500">{errors.message}</p>
                  )}
                </div>

                {/* Honeypot (sent as "website"): off-screen, hidden from assistive
                    tech, out of the tab order. Its name and label avoid the words
                    browsers autofill (website, url, company...), so a real visitor's
                    autofill never fills it and gets their message silently dropped. */}
                <div
                  aria-hidden="true"
                  style={{ position: 'absolute', left: '-10000px', top: 'auto', width: '1px', height: '1px', overflow: 'hidden' }}
                >
                  <label htmlFor="contact-hp-field">Leave this field empty</label>
                  <input
                    id="contact-hp-field"
                    name="contact_hp_field"
                    type="text"
                    tabIndex={-1}
                    autoComplete="off"
                    aria-hidden="true"
                    value={honeypot}
                    onChange={(e) => setHoneypot(e.target.value)}
                  />
                </div>

                {submitError && (
                  <div
                    role="alert"
                    className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
                  >
                    {submitError === 'invalid'
                      ? t('contact.errorInvalid', 'Please check your e-mail address and message. If it still does not go through, write to us at')
                      : submitError === 'rate_limited'
                        ? t('contact.errorRateLimited', 'Too many messages, please try again later or write to')
                        : t('contact.errorSendFailed', 'Your message could not be sent. Please try again in a moment, or write to us at')}{' '}
                    <a href="mailto:events@m3monaco.com" className="font-medium underline">
                      events@m3monaco.com
                    </a>
                  </div>
                )}

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
                href="mailto:events@m3monaco.com"
                className="text-primary hover:underline"
              >
                events@m3monaco.com
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
              <p className="text-gray-600">M3 Monaco</p>
              <p className="text-gray-600">Principality of Monaco</p>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
    </>
  );
}
