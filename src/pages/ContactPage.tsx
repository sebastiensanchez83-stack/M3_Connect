import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
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
import { Mail, MapPin, CheckCircle } from 'lucide-react';
import { Seo } from '@/components/seo/Seo';
import { submitContact, currentSource } from '@/lib/contactSubmit';
import { ContactFailure, Honeypot } from '@/components/contact/ContactParts';
import { Turnstile, useTurnstile } from '@/components/security/Turnstile';
import { PageHero } from '@/components/ui/PageHero';
import { ContactCard } from '@/components/brand/ContactCard';
import { Eyebrow } from '@/components/brand/Eyebrow';
import { Reveal } from '@/components/motion/Reveal';
import { CheckList } from '@/components/content/ContentParts';
import { SITE_IMAGES } from '@/lib/siteMedia';
import { withSiteSuffix } from '@/lib/seoText';
import { registerCopyStrings } from '@/i18n/refonte-copy';
import { registerFlowsStrings } from '@/i18n/refonte-flows';
import { cn } from '@/lib/utils';

registerCopyStrings();
registerFlowsStrings();

interface ContactForm {
  name: string;
  email: string;
  company: string;
  subject: string;
  message: string;
}

const SUBJECT_OPTIONS = [
  { value: 'general', labelKey: 'contact.subjectGeneral', fallback: 'General question' },
  // The value stays 'partnership' (stored with each message); the label says what it is.
  { value: 'partnership', labelKey: 'contact.subjectPartnership', fallback: 'Event sponsorship' },
  { value: 'support', labelKey: 'contact.subjectSupport', fallback: 'Support' },
  { value: 'media', labelKey: 'contact.subjectMedia', fallback: 'Media and press' },
  { value: 'other', labelKey: 'contact.subjectOther', fallback: 'Other' },
];

/** A field: 48 px, 12 px radius, a #6b7588 edge (3:1 on white); an error turns it red and is read with the field. */
const FIELD = 'h-12 md:h-12 rounded-field border-checkbox bg-white px-4 text-base';
const FIELD_ERROR = 'border-red-700';

export function ContactPage() {
  const { t } = useTranslation();
  // "Sponsor an event" and "Are you a media outlet?" links arrive with ?subject=partnership / media.
  const [params] = useSearchParams();
  const presetSubject = SUBJECT_OPTIONS.some((s) => s.value === params.get('subject')) ? params.get('subject')! : '';
  const [form, setForm] = useState<ContactForm>({
    name: '',
    email: '',
    company: '',
    subject: presetSubject,
    message: '',
  });
  // The honeypot of the contact function: a field no person sees (see ContactParts).
  const [website, setWebsite] = useState('');
  // Cloudflare Turnstile: invisible unless a challenge is needed; off without a site key.
  const captcha = useTurnstile();
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  // Why the last attempt did not go, or null. Never a silent success: the form
  // stays filled and the e-mail address is offered next to the message.
  const [failure, setFailure] = useState<Exclude<Awaited<ReturnType<typeof submitContact>>, { ok: true }>['reason'] | null>(null);
  const [errors, setErrors] = useState<Partial<Record<keyof ContactForm, string>>>({});

  // Following such a link while already on /contact (the footer is on every
  // page) keeps this page mounted: the subject follows the new link.
  useEffect(() => {
    if (presetSubject) setForm((f) => ({ ...f, subject: presetSubject }));
  }, [presetSubject]);

  function validate(): boolean {
    const newErrors: Partial<Record<keyof ContactForm, string>> = {};

    if (!form.name.trim()) {
      newErrors.name = t('contact.errorName', 'Please enter your name');
    } else if (form.name.trim().length > 120) {
      newErrors.name = t('contact.errorNameLong', 'Your name is too long (120 characters at most)');
    }

    if (!form.email.trim()) {
      newErrors.email = t('contact.errorEmail', 'Please enter your e-mail');
    } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email)) {
      newErrors.email = t('contact.errorEmailInvalid', 'Please enter a valid e-mail address');
    }

    if (!form.subject) {
      newErrors.subject = t('contact.errorSubject', 'Please select a subject');
    }

    if (!form.message.trim()) {
      newErrors.message = t('contact.errorMessage', 'Please enter a message');
    } else if (form.message.trim().length < 10) {
      newErrors.message = t('contact.errorMessageShort', 'Your message must be at least 10 characters long');
    } else if (form.message.trim().length > 5000) {
      newErrors.message = t('contact.errorMessageLong', 'Your message is too long (5,000 characters at most)');
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (submitting) return;

    if (!validate()) return;

    setSubmitting(true);
    setFailure(null);

    // The contact-submit function stores the message and e-mails the M3 team.
    // "Sent" is shown only when it answers { ok: true }.
    const result = await submitContact({
      name: form.name,
      email: form.email,
      company: form.company,
      subject: form.subject,
      message: form.message,
      source: currentSource(),
      website,
      captcha: captcha.token,
    });
    setSubmitting(false);
    // A token works once: ask for a new one whatever the answer.
    captcha.reset();

    if (!result.ok) {
      setFailure(result.reason);
      return;
    }

    setSubmitted(true);
    toast({
      title: t('contact.successTitle', 'Message sent'),
      description: t(
        'contact.successDesc',
        'Thank you. The M3 team will get back to you shortly.'
      ),
    });
  }

  function handleChange(field: keyof ContactForm, value: string) {
    setForm((prev) => ({ ...prev, [field]: value }));
    if (errors[field]) {
      setErrors((prev) => ({ ...prev, [field]: undefined }));
    }
  }

  const seoTitle = withSiteSuffix(t('seo.contact.title', 'Contact the Smart Marina Connect team'));
  const seoDescription = t('seo.contact.description', 'A question about the platform, your company page or sponsoring an event? Write to the M3 Monaco team behind Smart Marina Connect.');

  /** The message under a field: red text, tied to the field for screen readers. */
  const fieldError = (field: keyof ContactForm) =>
    errors[field] ? (
      <p id={`contact-${field}-error`} role="alert" className="text-sm font-medium text-red-700">
        {errors[field]}
      </p>
    ) : null;
  const fieldA11y = (field: keyof ContactForm) => ({
    'aria-invalid': errors[field] ? (true as const) : undefined,
    'aria-describedby': errors[field] ? `contact-${field}-error` : undefined,
  });
  const required = <span aria-hidden="true" className="text-red-700">*</span>;

  return (
    <div className="min-h-screen bg-page">
      <Seo title={seoTitle} description={seoDescription} path="/contact" />
      {/* A round-table workshop from SM26: people talking things through. */}
      <PageHero
        image={SITE_IMAGES.contactHero}
        seed="contact-hero"
        icon={Mail}
        eyebrow={t('contentPages.contact.eyebrow', 'Contact')}
        title={t('contact.title', 'Contact us')}
        subtitle={t('staticPages.contact.subtitle')}
      />

      <div className="mx-auto w-full max-w-7xl px-4 py-10 sm:px-6 md:py-14">
        <div className="grid gap-8 lg:grid-cols-12 lg:gap-10">
          {/* Contact form */}
          <Reveal className="lg:col-span-7 xl:col-span-8">
            <section aria-labelledby="contact-form-title" className="rounded-card border border-rule bg-white p-6 sm:p-8 md:p-10">
              {submitted ? (
                <div role="status" className="py-6 text-center md:py-10">
                  <span aria-hidden="true" className="mx-auto mb-5 grid h-16 w-16 place-items-center rounded-pill bg-foam text-teal-text">
                    <CheckCircle className="h-8 w-8" />
                  </span>
                  <h2 id="contact-form-title" className="text-h2-sm text-navy md:text-h2">
                    {t('staticPages.contact.thankYouTitle')}
                  </h2>
                  <p className="mx-auto mt-3 max-w-md text-body md:text-body-lg text-ink">
                    {t('staticPages.contact.thankYouDesc')}
                  </p>
                  <Button
                    variant="ctaOutline"
                    className="mt-8"
                    onClick={() => { setSubmitted(false); setFailure(null); setWebsite(''); setForm({ name: '', email: '', company: '', subject: '', message: '' }); }}
                  >
                    {t('contact.sendAnother', 'Send another message')}
                  </Button>
                </div>
              ) : (
                <>
                  <Eyebrow>{t('staticPages.contact.formEyebrow')}</Eyebrow>
                  <h2 id="contact-form-title" className="mt-3 text-h2-sm text-navy md:text-h2">
                    {t('staticPages.contact.formTitle')}
                  </h2>
                  <p className="mt-3 max-w-xl text-body text-ink">{t('staticPages.contact.formIntro')}</p>
                  <p className="mt-2 text-sm text-meta">{t('contentPages.contact.required', 'Fields marked * are required.')}</p>

                  <form onSubmit={handleSubmit} className="mt-8 space-y-5" noValidate>
                    <div className="grid gap-5 sm:grid-cols-2">
                      {/* Name */}
                      <div className="space-y-2">
                        <Label htmlFor="contact-name" className="text-sm font-semibold text-navy">
                          {t('contact.nameLabel', 'Full name')} {required}
                        </Label>
                        <Input
                          id="contact-name"
                          type="text"
                          autoComplete="name"
                          placeholder={t('contact.namePlaceholder', 'Your full name')}
                          value={form.name}
                          onChange={(e) => handleChange('name', e.target.value)}
                          className={cn(FIELD, errors.name && FIELD_ERROR)}
                          {...fieldA11y('name')}
                        />
                        {fieldError('name')}
                      </div>

                      {/* Email */}
                      <div className="space-y-2">
                        <Label htmlFor="contact-email" className="text-sm font-semibold text-navy">
                          {t('contact.emailLabel', 'E-mail address')} {required}
                        </Label>
                        <Input
                          id="contact-email"
                          type="email"
                          autoComplete="email"
                          placeholder={t('contact.emailPlaceholder', 'your.email@example.com')}
                          value={form.email}
                          onChange={(e) => handleChange('email', e.target.value)}
                          className={cn(FIELD, errors.email && FIELD_ERROR)}
                          {...fieldA11y('email')}
                        />
                        {fieldError('email')}
                      </div>
                    </div>

                    <div className="grid gap-5 sm:grid-cols-2">
                    {/* Subject */}
                    <div className="space-y-2">
                      <Label htmlFor="contact-subject" className="text-sm font-semibold text-navy">
                        {t('contact.subjectLabel', 'Subject')} {required}
                      </Label>
                      <Select
                        value={form.subject}
                        onValueChange={(value) => handleChange('subject', value)}
                      >
                        <SelectTrigger
                          id="contact-subject"
                          className={cn(FIELD, 'text-base', errors.subject && FIELD_ERROR)}
                          {...fieldA11y('subject')}
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
                      {fieldError('subject')}
                    </div>

                    {/* Company (optional) */}
                    <div className="space-y-2">
                      <Label htmlFor="contact-company" className="text-sm font-semibold text-navy">
                        {t('flows.contact.company')} <span className="font-normal text-meta">({t('flows.contact.optional')})</span>
                      </Label>
                      <Input
                        id="contact-company"
                        type="text"
                        autoComplete="organization"
                        maxLength={160}
                        placeholder={t('flows.contact.companyPlaceholder')}
                        value={form.company}
                        onChange={(e) => handleChange('company', e.target.value)}
                        className={FIELD}
                      />
                    </div>
                    </div>

                    {/* Message */}
                    <div className="space-y-2">
                      <Label htmlFor="contact-message" className="text-sm font-semibold text-navy">
                        {t('contact.messageLabel', 'Message')} {required}
                      </Label>
                      <Textarea
                        id="contact-message"
                        placeholder={t('staticPages.contact.messagePlaceholder')}
                        value={form.message}
                        onChange={(e) => handleChange('message', e.target.value)}
                        rows={6}
                        className={cn('rounded-field border-checkbox bg-white px-4 py-3 text-base', errors.message && FIELD_ERROR)}
                        {...fieldA11y('message')}
                      />
                      {fieldError('message')}
                    </div>

                    <Honeypot value={website} onChange={setWebsite} />
                    <Turnstile captcha={captcha} action="contact" />

                    {failure && <ContactFailure id="contact-failure" reason={failure} />}

                    <div className="pt-2">
                      <Button
                        type="submit"
                        variant="cta"
                        disabled={submitting || captcha.waiting}
                        arrow={!submitting}
                        roll={!submitting}
                        className="w-full justify-between sm:w-auto"
                      >
                        {submitting ? t('contact.sending', 'Sending…') : t('contact.submitButton', 'Send message')}
                      </Button>
                    </div>
                  </form>
                </>
              )}
            </section>
          </Reveal>

          {/* Who to write to */}
          <aside aria-label={t('contact.infoTitle', 'Contact information')} className="grid content-start gap-6 lg:col-span-5 xl:col-span-4">
            <Reveal delay={120}>
              <ContactCard line={t('contact.emailNote', 'We usually reply within 24 to 48 hours.')} />
            </Reveal>
            <Reveal delay={160}>
              <div className="rounded-card bg-white p-5 ring-1 ring-inset ring-rule sm:p-6">
                <h2 className="text-meta-caps">{t('staticPages.contact.helpTitle')}</h2>
                <CheckList
                  className="mt-4 gap-2.5"
                  items={[
                    t('staticPages.contact.help1'),
                    t('staticPages.contact.help2'),
                    t('staticPages.contact.help3'),
                    t('staticPages.contact.help4'),
                  ]}
                />
              </div>
            </Reveal>
            <Reveal delay={200}>
              <div className="rounded-card bg-white p-5 ring-1 ring-inset ring-rule sm:p-6">
                <p className="text-meta-caps flex items-center gap-2">
                  <MapPin className="h-4 w-4" aria-hidden="true" />
                  {t('contact.addressTitle', 'Address')}
                </p>
                <p className="mt-3 text-card-title text-navy">M3 Monaco</p>
                <p className="text-body text-ink">{t('contact.principality', 'Principality of Monaco')}</p>
              </div>
            </Reveal>
          </aside>
        </div>
      </div>
    </div>
  );
}
