import { useId } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Mail } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { BathyPattern } from '@/components/motion/BathyPattern';
import { Eyebrow } from './Eyebrow';
import { UnderlineLink } from './UnderlineLink';

/**
 * The contact card: a real person at the end of every journey, Victor Meyer,
 * M3 Monaco. A round teal monogram (VM, until a photo is supplied through
 * `photoSrc`), the name, events@m3monaco.com (the only public e-mail address)
 * and a rolling gold button.
 *
 * By default the button writes to that address (mailto). `cta` replaces it with
 * a link inside the site (the home page sends visitors to /contact), and `line`
 * adds a sentence under the name.
 *
 * `variant="panel"` is the home page's closing panel: navy, drifting sounding
 * lines, an eyebrow, a question (`title`), a sentence (`line`), the monogram
 * with the name on two lines and a rolling white button.
 *
 * `action="link"` turns that button into a plain text link (underline link),
 * for a page whose main action is a form next to the card (/contact, the
 * sponsorship deck): the e-mail must not compete with the form (design audit,
 * 8 Oct 2026).
 */
export const M3_PUBLIC_EMAIL = 'events@m3monaco.com';

export function ContactCard({
  photoSrc,
  tone = 'light',
  variant = 'card',
  title,
  cta,
  line,
  action = 'button',
  className,
}: {
  /** 'button' (default): a rolling button; 'link': a quiet text link, when a form is the page's main action. */
  action?: 'button' | 'link';
  photoSrc?: string | null;
  /** 'light' card on a light page (default); 'dark' card on navy. */
  tone?: 'light' | 'dark';
  /** 'card' (default) or 'panel' (the home page's navy closing panel). */
  variant?: 'card' | 'panel';
  /** Panel only: the question above the sentence. */
  title?: string;
  /** An in-site action instead of the e-mail button, e.g. { label: 'Write to the team', to: '/contact' }. */
  cta?: { label: string; to: string };
  /** A sentence under the name (under the title in the panel); null or omitted shows none. */
  line?: string | null;
  className?: string;
}) {
  const { t } = useTranslation();
  const titleId = useId();
  const dark = tone === 'dark';
  const variantName = dark ? 'ctaOnDark' : 'cta';
  /** `action="link"`: the same destination as the button, as a text link. */
  const quietLink = (onDark: boolean) =>
    cta ? (
      <UnderlineLink to={cta.to} tone={onDark ? 'light' : 'dark'}>{cta.label}</UnderlineLink>
    ) : (
      <UnderlineLink href={`mailto:${M3_PUBLIC_EMAIL}`} tone={onDark ? 'light' : 'dark'}>
        {t('brand.contact.write', 'Write to the team')}
      </UnderlineLink>
    );

  if (variant === 'panel') {
    return (
      <aside
        aria-labelledby={titleId}
        className={cn('relative overflow-hidden rounded-card bg-navy p-6 text-white sm:p-8', className)}
      >
        <BathyPattern seed={6} drift className="absolute inset-0" />
        <div className="relative">
          <Eyebrow tone="onDark">{t('brand.contact.eyebrow', 'Contact')}</Eyebrow>
          <h2 id={titleId} className="mt-3 text-[22px] font-semibold leading-7">
            {title ?? t('brand.contact.label', 'Your contact at M3')}
          </h2>
          {line && <p className="mt-3 text-[15px] leading-6 text-white/80">{line}</p>}
          <div className="mt-6 flex items-center gap-4">
            {photoSrc ? (
              <img src={photoSrc} alt="" className="h-[88px] w-[88px] shrink-0 rounded-full object-cover ring-4 ring-white/15" />
            ) : (
              <span
                aria-hidden="true"
                className="grid h-[88px] w-[88px] shrink-0 place-items-center rounded-full bg-teal text-[26px] font-semibold tracking-[0.02em] text-white ring-4 ring-white/15"
              >
                VM
              </span>
            )}
            <div>
              <p className="text-[17px] font-semibold leading-[22px]">Victor Meyer</p>
              <p className="mt-0.5 text-sm leading-5 text-white/80">M3 Monaco</p>
            </div>
          </div>
          <div className="mt-6">
            {action === 'link' ? (
              quietLink(true)
            ) : cta ? (
              <Button asChild variant="ctaWhite">
                <Link to={cta.to}>{cta.label}</Link>
              </Button>
            ) : (
              <Button asChild variant="ctaWhite">
                <a href={`mailto:${M3_PUBLIC_EMAIL}`}>{t('brand.contact.write', 'Write to the team')}</a>
              </Button>
            )}
          </div>
        </div>
      </aside>
    );
  }

  return (
    <aside
      aria-label={t('brand.contact.label', 'Your contact at M3')}
      className={cn(
        'relative rounded-card p-5 sm:p-6',
        dark ? 'bg-navy-deep text-white ring-1 ring-inset ring-white/15' : 'bg-white text-ink ring-1 ring-inset ring-rule',
        className,
      )}
    >
      <p className={cn('text-meta-caps', dark && '!text-white/70')}>{t('brand.contact.label', 'Your contact at M3')}</p>
      <div className="mt-4 flex items-center gap-4">
        {photoSrc ? (
          <img src={photoSrc} alt="" className="h-[72px] w-[72px] shrink-0 rounded-full object-cover ring-4 ring-white/15" />
        ) : (
          <span
            aria-hidden="true"
            className="grid h-[72px] w-[72px] shrink-0 place-items-center rounded-full bg-teal text-[24px] font-semibold tracking-[0.02em] text-white ring-4 ring-white/15"
          >
            VM
          </span>
        )}
        <div className="min-w-0">
          <p className={cn('text-card-title', dark ? 'text-white' : 'text-navy')}>Victor Meyer · M3 Monaco</p>
          <a
            href={`mailto:${M3_PUBLIC_EMAIL}`}
            className={cn('focus-ring rounded-badge text-sm underline underline-offset-2', dark ? 'text-white/85 hover:text-white' : 'text-navy hover:text-teal-text')}
          >
            {M3_PUBLIC_EMAIL}
          </a>
        </div>
      </div>
      {line && <p className={cn('mt-3 text-sm', dark ? 'text-white/85' : 'text-ink/80')}>{line}</p>}
      <div className={action === 'link' ? 'mt-4' : 'mt-5'}>
        {action === 'link' ? (
          quietLink(dark)
        ) : cta ? (
          <Button asChild variant={variantName} size="sm">
            <Link to={cta.to}>{cta.label}</Link>
          </Button>
        ) : (
          <Button asChild variant={variantName} size="sm">
            <a href={`mailto:${M3_PUBLIC_EMAIL}`}>
              <Mail className="h-4 w-4" aria-hidden="true" />
              {t('brand.contact.write', 'Write to the team')}
            </a>
          </Button>
        )}
      </div>
    </aside>
  );
}
