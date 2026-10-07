import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ArrowRight, Mail } from 'lucide-react';
import { cn } from '@/lib/utils';
import { buttonVariants } from '@/components/ui/button';

/**
 * The harbour office plate ("Capitainerie M3"): a real person at the end of
 * every journey, Victor Meyer, M3 Monaco. A plaque, not a profile card: a thin
 * brass rule inset on a light plate, the caps line "HARBOUR OFFICE · M3
 * MONACO" in the signage face, a square engraved monogram (VM, until a photo
 * is supplied through `photoSrc`), the name, events@m3monaco.com (the only
 * public e-mail address) and a tide button.
 *
 * By default the button writes to that address (mailto). `cta` replaces it with
 * a link inside the site (the home page sends visitors to /contact), and `line`
 * adds a sentence under the name.
 */
export const M3_PUBLIC_EMAIL = 'events@m3monaco.com';

export function ContactCard({
  photoSrc,
  tone = 'light',
  cta,
  line,
  className,
}: {
  photoSrc?: string | null;
  /** 'light' plate on a light page (default); 'dark' plate on navy. */
  tone?: 'light' | 'dark';
  /** An in-site action instead of the e-mail button, e.g. { label: 'Write to the team', to: '/contact' }. */
  cta?: { label: string; to: string };
  /** A sentence under the name; null or omitted shows none. */
  line?: string | null;
  className?: string;
}) {
  const { t } = useTranslation();
  const dark = tone === 'dark';
  const actionClass = cn(buttonVariants({ variant: dark ? 'tideOnDark' : 'tide', size: 'sm' }), 'shrink-0');
  return (
    <aside
      aria-label={t('brand.contact.label', 'Your contact at M3')}
      className={cn(
        'relative rounded-field p-5 sm:p-6',
        dark ? 'bg-navy-deep text-white ring-1 ring-inset ring-white/15' : 'bg-white text-ink ring-1 ring-inset ring-rule',
        className,
      )}
    >
      {/* The plate's brass rule. */}
      <span aria-hidden="true" className="pointer-events-none absolute inset-1.5 rounded-[8px] border border-[#c9a24f]/70" />
      <p className={cn('relative font-signage text-[13px] font-semibold uppercase tracking-[0.16em]', dark ? 'text-[#e3c17a]' : 'text-gold-text')}>
        {t('brand.contact.office', 'Harbour office · M3 Monaco')}
      </p>
      <div className="relative mt-4 flex items-center gap-4">
        {photoSrc ? (
          <img src={photoSrc} alt="" className="h-14 w-14 shrink-0 rounded-[6px] object-cover ring-2 ring-[#c9a24f]" />
        ) : (
          <span
            aria-hidden="true"
            className={cn(
              'grid h-14 w-14 shrink-0 place-items-center rounded-[6px] border-2 border-[#c9a24f] font-signage text-[22px] font-semibold tracking-[0.06em] [text-shadow:0_1px_0_rgba(255,255,255,.6)]',
              dark ? 'bg-white/10 text-white [text-shadow:none]' : 'bg-page text-navy',
            )}
          >
            VM
          </span>
        )}
        <div className="min-w-0">
          <p className={cn('text-card-title', dark ? 'text-white' : 'text-navy')}>Victor Meyer</p>
          <a
            href={`mailto:${M3_PUBLIC_EMAIL}`}
            className={cn('focus-ring rounded-badge text-sm underline underline-offset-2', dark ? 'text-white/85 hover:text-white' : 'text-navy hover:text-teal-text')}
          >
            {M3_PUBLIC_EMAIL}
          </a>
        </div>
      </div>
      {line && <p className={cn('relative mt-3 text-sm', dark ? 'text-white/85' : 'text-ink/80')}>{line}</p>}
      <div className="relative mt-5">
        {cta ? (
          <Link to={cta.to} className={actionClass}>
            {cta.label}
            <ArrowRight className="h-4 w-4" aria-hidden="true" />
          </Link>
        ) : (
          <a href={`mailto:${M3_PUBLIC_EMAIL}`} className={actionClass}>
            <Mail className="h-4 w-4" aria-hidden="true" />
            {t('brand.contact.write', 'Write to the harbour office')}
          </a>
        )}
      </div>
    </aside>
  );
}
