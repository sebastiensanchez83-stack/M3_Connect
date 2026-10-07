import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Loader2, type LucideIcon } from 'lucide-react';
import { PageHero, type Crumb } from '@/components/ui/PageHero';
import { BathyPattern } from '@/components/motion/BathyPattern';
import { Eyebrow } from '@/components/brand/Eyebrow';
import { SITE_IMAGES } from '@/lib/siteMedia';
import { registerOrgRefonteStrings } from '@/i18n/refonte-org';
import { cn } from '@/lib/utils';

registerOrgRefonteStrings();

/**
 * The visual shell of the pages members use to publish something (a project, an
 * RFP, a consultation, a webinar proposal), refonte v2:
 *
 *   SubmitShell   the compact full-width banner (breadcrumb, line-revealed H1,
 *                 subtitle) and a 768 px column on the page grey for the form;
 *   FormCard      one white card (16 px radius, hairline border, no shadow) with
 *                 a title, a sentence and the fields; the form itself stays the
 *                 page's own <form>, wrapping one or several cards;
 *   SubmitGuard   the card shown instead of the form when the member may not
 *                 publish (not signed in, not verified, quota used);
 *   FormFooter    the row under the cards: a note on the left, the action on the right;
 *   PageLoader    the spinner while the account loads.
 *
 * Presentation only: nothing here reads or writes data, and the pages keep
 * their own validation, permission checks and notifications.
 */

export function SubmitShell({
  seed,
  icon,
  eyebrow,
  title,
  subtitle,
  trail,
  heroExtra,
  children,
}: {
  seed: string;
  icon: LucideIcon;
  eyebrow?: string;
  title: string;
  subtitle?: string;
  /** Breadcrumb between "Home" and the page's own title. */
  trail: Crumb[];
  /** Under the subtitle in the banner (e.g. a quota notice). */
  heroExtra?: ReactNode;
  children: ReactNode;
}) {
  const { t } = useTranslation();
  return (
    <div className="min-h-screen bg-page pb-16 md:pb-24">
      <PageHero
        image={SITE_IMAGES.opportunitiesHero}
        seed={seed}
        icon={icon}
        eyebrow={eyebrow}
        title={title}
        subtitle={subtitle}
        containerClassName="max-w-3xl"
        breadcrumbs={[{ label: t('nav.home', 'Home'), href: '/' }, ...trail, { label: title }]}
      >
        {heroExtra}
      </PageHero>
      <div className="mx-auto w-full max-w-3xl px-4 pt-8 sm:px-6 md:pt-10">{children}</div>
    </div>
  );
}

export function FormCard({
  title,
  description,
  eyebrow,
  children,
  className,
}: {
  title: string;
  description?: string;
  eyebrow?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={cn('rounded-card border border-rule bg-white p-5 text-ink sm:p-8', className)}>
      <header>
        {eyebrow && <Eyebrow>{eyebrow}</Eyebrow>}
        <h2 className={cn('text-[20px] font-semibold leading-7 tracking-[-0.01em] text-navy', eyebrow && 'mt-2')}>{title}</h2>
        {description && <p className="mt-1 text-sm leading-5 text-meta">{description}</p>}
      </header>
      <div className="mt-6 space-y-5">{children}</div>
    </section>
  );
}

/** The row under the cards: a note on the left, the action on the right (stacked on phones). */
export function FormFooter({ note, children }: { note?: ReactNode; children: ReactNode }) {
  return (
    <div className="flex flex-col-reverse gap-4 sm:flex-row sm:items-center sm:justify-between">
      {note ? <p className="max-w-[420px] text-sm leading-5 text-meta">{note}</p> : <span />}
      <div className="flex shrink-0 flex-wrap items-center gap-x-5 gap-y-3 sm:justify-end">{children}</div>
    </div>
  );
}

/** Shown instead of a form the member may not use. Same look as the lock panels elsewhere. */
export function SubmitGuard({
  icon: Icon,
  eyebrow,
  title,
  children,
  actions,
}: {
  icon: LucideIcon;
  eyebrow?: string;
  title: string;
  /** The explanation. */
  children?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="min-h-[70vh] bg-page px-4 py-14 sm:px-6 md:py-20">
      <div className="relative isolate mx-auto max-w-xl overflow-hidden rounded-[24px] bg-navy p-7 text-white sm:p-10">
        <BathyPattern seed={5} drift className="absolute inset-0 -z-10" />
        <span aria-hidden="true" className="grid h-12 w-12 place-items-center rounded-pill bg-white/10 text-gold ring-1 ring-inset ring-white/20">
          <Icon className="h-5 w-5" strokeWidth={1.75} />
        </span>
        {eyebrow && <Eyebrow tone="onDark" className="mt-6">{eyebrow}</Eyebrow>}
        <h1 className={cn('text-[24px] font-semibold leading-[30px] tracking-[-0.01em]', eyebrow ? 'mt-3' : 'mt-6')}>{title}</h1>
        {children && <div className="mt-3 text-[15px] leading-6 text-white/85">{children}</div>}
        {actions && <div className="mt-7 flex flex-wrap items-center gap-x-5 gap-y-3">{actions}</div>}
      </div>
    </div>
  );
}

export function PageLoader() {
  const { t } = useTranslation();
  return (
    <div className="grid min-h-[60vh] place-items-center bg-page" role="status" aria-busy="true">
      <Loader2 className="h-8 w-8 animate-spin text-navy" aria-hidden="true" />
      <span className="sr-only">{t('common.loading', 'Loading...')}</span>
    </div>
  );
}
