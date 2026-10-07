import { useRef, type CSSProperties, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Check } from 'lucide-react';
import { CoverImage } from '@/components/ui/CoverImage';
import { SITE_IMAGES, type SiteImage } from '@/lib/siteMedia';
import { BathyPattern } from '@/components/motion/BathyPattern';
import { LineReveal } from '@/components/motion/LineReveal';
import { useRegisterHeaderHero } from '@/components/layout/headerOverlay';
import { Eyebrow } from '@/components/brand/Eyebrow';
import { cn } from '@/lib/utils';
import { registerAuthRefonteStrings } from '@/i18n/refonte-auth';

registerAuthRefonteStrings();

/**
 * The split screen of every sign-in, sign-up, invitation, welcome, password and
 * onboarding step: a marine panel with a photo under a veil and faint sounding
 * lines, the short value line on the left (eyebrow, the page's H1, a sentence,
 * three points), and the form on a white card on the right. On phones the panel
 * is a short block and the card follows it. No cut-out corner, no round arrow disc.
 *
 * The header overlaps the panel (transparent, white logo) until the page is
 * scrolled, like on the home page and the section pages.
 *
 *   <AuthShell title="Reset your password" lead="…">
 *     <form>…</form>
 *   </AuthShell>
 *
 * `title` is the page's H1: keep it a short name for what the page does (the
 * card holds the form and, if needed, its own H2 through <AuthCardHeading>).
 * `step` (1 to 3) shows the onboarding progress under the sentence in place of
 * the three points. Nothing here moves on its own, so there is no pause control.
 */
export function AuthShell({
  title,
  lead,
  eyebrow,
  points = true,
  step,
  layout = 'split',
  icon,
  image = SITE_IMAGES.joinHero,
  seed = 'auth-shell',
  children,
  cardClassName,
}: {
  title: string;
  /** The sentence under the title (default: what the network is). `null` for none. */
  lead?: ReactNode | null;
  /** Above the title (default: Smart Marina Connect). */
  eyebrow?: string;
  /** The three points under the sentence, large screens only. */
  points?: boolean;
  /** Onboarding progress, 1 to 3: replaces the points. */
  step?: 1 | 2 | 3;
  /** 'split' (default): value line and a white card. 'centered': title, sentence and the actions in `children` (a gate, no form). */
  layout?: 'split' | 'centered';
  /** Centered layout only: a round icon above the title. */
  icon?: ReactNode;
  image?: SiteImage | null;
  seed?: string;
  /** The card's content (split) or the actions under the sentence (centered). */
  children?: ReactNode;
  cardClassName?: string;
}) {
  const { t } = useTranslation();
  const ref = useRef<HTMLElement>(null);
  const overlaid = useRegisterHeaderHero(ref);
  const sentence = lead === undefined ? t('authRefonte.shell.lead', "Marinas publish their needs, service providers answer them, and everyone meets at M3's events.") : lead;
  const enter = (delay: number) => ({ '--enter-delay': `${delay}s` }) as CSSProperties;

  return (
    <section ref={ref} className="relative isolate flex flex-col justify-center overflow-hidden bg-navy text-white lg:min-h-[min(100svh,860px)]">
      <div aria-hidden="true" className="absolute inset-0 -z-30">
        <CoverImage
          src={image?.src ?? null}
          focusY={image?.focusY ?? 0.5}
          alt=""
          seed={seed}
          aspect="fill"
          tone="sea"
          eager
          className="absolute inset-0"
          imageClassName="hero-settle"
        />
      </div>
      {/* The veil is deepest behind the text, so the white card is the one bright thing on the screen. */}
      <div
        aria-hidden="true"
        className="absolute inset-0 -z-20 bg-[linear-gradient(180deg,rgba(8,29,64,.95)_0%,rgba(11,38,83,.92)_100%)] lg:bg-[linear-gradient(90deg,rgba(8,29,64,.98)_0%,rgba(11,38,83,.93)_50%,rgba(11,38,83,.82)_100%)]"
      />
      <BathyPattern seed={5} className="absolute inset-0 -z-10" />

      {layout === 'centered' ? (
        <div className={cn('mx-auto w-full max-w-3xl px-4 pb-16 text-center sm:px-6 lg:pb-20', overlaid ? 'pt-[104px] md:pt-[128px]' : 'pt-14 sm:pt-20')}>
          {icon && (
            <span aria-hidden="true" className="enter-up mx-auto mb-5 grid h-14 w-14 place-items-center rounded-full bg-white/10 text-gold" style={enter(0.1)}>
              {icon}
            </span>
          )}
          <Eyebrow tone="onDark" className="justify-center">{eyebrow ?? t('authRefonte.shell.brand', 'Smart Marina Connect')}</Eyebrow>
          <LineReveal as="h1" trigger="mount" delay={120} className="mt-4 text-h1-sm text-white sm:text-h1 [text-wrap:balance]">
            {title}
          </LineReveal>
          {sentence && (
            <p className="enter-up mx-auto mt-4 max-w-[560px] text-body text-white/85 md:text-[18px] md:leading-7" style={enter(0.35)}>
              {sentence}
            </p>
          )}
          {children && (
            <div className="enter-up mt-8 flex flex-wrap justify-center gap-3" style={enter(0.5)}>
              {children}
            </div>
          )}
        </div>
      ) : (
        <div
          className={cn(
            'mx-auto grid w-full max-w-7xl gap-8 px-4 pb-12 sm:px-6 lg:grid-cols-12 lg:items-center lg:gap-10 lg:pb-16 xl:gap-14',
            overlaid ? 'pt-[88px] md:pt-[104px] lg:pt-[112px]' : 'pt-10 sm:pt-14',
          )}
        >
          <div className="min-w-0 lg:col-span-5">
            <Eyebrow tone="onDark">{eyebrow ?? t('authRefonte.shell.brand', 'Smart Marina Connect')}</Eyebrow>
            <LineReveal as="h1" trigger="mount" delay={120} className="mt-4 text-h1-sm text-white sm:text-h1 [text-wrap:balance]">
              {title}
            </LineReveal>
            {sentence && (
              <p className="enter-up mt-4 max-w-[480px] text-body text-white/85 md:text-[18px] md:leading-7" style={enter(0.35)}>
                {sentence}
              </p>
            )}
            {step && (
              <div className="enter-up mt-6 md:mt-8" style={enter(0.45)}>
                <AuthSteps current={step} vertical />
              </div>
            )}
            {!step && points && (
              <ul aria-label={t('authRefonte.shell.pointsLabel', 'What the network offers')} className="enter-up mt-8 hidden space-y-3 lg:block" style={enter(0.5)}>
                {(['network', 'free', 'events'] as const).map((key) => (
                  <li key={key} className="flex items-start gap-3 text-[15px] leading-6 text-white/90">
                    <span aria-hidden="true" className="mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full bg-white/10 text-gold">
                      <Check className="h-3.5 w-3.5" strokeWidth={2.5} />
                    </span>
                    {t(`authRefonte.shell.points.${key}`)}
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="enter-up min-w-0 lg:col-span-6 lg:col-start-7" style={enter(0.3)}>
            <div className={cn('rounded-card bg-white p-6 text-ink shadow-drawer sm:p-8', cardClassName)}>{children}</div>
          </div>
        </div>
      )}
    </section>
  );
}

/** The H2 of a card, when the card hosts more than one mode (log in / sign up). */
export function AuthCardHeading({ title, description, className }: { title: string; description?: ReactNode; className?: string }) {
  return (
    <div className={cn('mb-6', className)}>
      <h2 className="text-h2-sm text-navy">{title}</h2>
      {description && <p className="mt-2 text-sm leading-6 text-meta">{description}</p>}
    </div>
  );
}

/**
 * The content of a card that reports a state (error, check your inbox, done):
 * a round icon, a title, the words. `tone="warning"` for what went wrong.
 */
export function AuthStatus({
  icon,
  tone = 'default',
  title,
  children,
  className,
}: {
  icon: ReactNode;
  tone?: 'default' | 'warning';
  title: string;
  children?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('space-y-4', className)}>
      <span
        aria-hidden="true"
        className={cn('grid h-14 w-14 place-items-center rounded-full', tone === 'warning' ? 'bg-amber-50 text-amber-700' : 'bg-foam text-teal-text')}
      >
        {icon}
      </span>
      <h2 className="text-h2-sm text-navy">{title}</h2>
      {children}
    </div>
  );
}

/** A centred spinner for a screen that is waiting on the session or a lookup. */
export function AuthLoading({ label, className, children }: { label?: string; className?: string; children?: ReactNode }) {
  const { t } = useTranslation();
  return (
    <div role="status" className={cn('flex min-h-[60vh] flex-col items-center justify-center gap-4 px-4', className)}>
      <span aria-hidden="true" className="h-10 w-10 animate-spin rounded-full border-4 border-rule border-t-navy motion-reduce:animate-none" />
      <p className="text-sm text-meta">{label ?? t('common.loading', 'Loading...')}</p>
      {children}
    </div>
  );
}

/**
 * Where a new member stands: profile, organization, review by M3. The current
 * step is gold (a selected state, navy figure), the done ones carry a tick.
 * Phones show the name of the current step only. Written for navy panels.
 */
export function AuthSteps({ current, vertical = false, className }: { current: 1 | 2 | 3; /** A column with every name shown (a narrow panel); default a row. */ vertical?: boolean; className?: string }) {
  const { t } = useTranslation();
  const steps = [
    t('authRefonte.steps.profile', 'Your profile'),
    t('authRefonte.steps.organization', 'Your organisation'),
    t('authRefonte.steps.review', 'Review by M3'),
  ];
  return (
    <ol aria-label={t('authRefonte.steps.label', 'Your progress')} className={cn(vertical ? 'flex flex-col items-start gap-3' : 'flex items-center gap-2 sm:gap-3', className)}>
      {steps.map((label, i) => {
        const n = i + 1;
        const done = n < current;
        const active = n === current;
        return (
          <li key={label} aria-current={active ? 'step' : undefined} className="flex items-center gap-2 sm:gap-3">
            <span
              aria-hidden="true"
              className={cn(
                'grid h-8 w-8 shrink-0 place-items-center rounded-full text-[13px] font-semibold tabular-nums',
                active && 'bg-gold text-navy',
                done && 'bg-white/15 text-white',
                !active && !done && 'text-white/75 ring-1 ring-inset ring-white/40',
              )}
            >
              {done ? <Check className="h-4 w-4" strokeWidth={2.5} /> : n}
            </span>
            <span className={cn('text-sm font-semibold', active ? 'text-white' : cn('text-white/75', !vertical && 'hidden sm:inline'))}>
              {label}
              {(done || active) && (
                <span className="sr-only"> ({done ? t('authRefonte.steps.done', 'done') : t('authRefonte.steps.current', 'current step')})</span>
              )}
            </span>
            {!vertical && n < steps.length && <span aria-hidden="true" className="h-px w-5 bg-white/30 sm:w-9" />}
          </li>
        );
      })}
    </ol>
  );
}
