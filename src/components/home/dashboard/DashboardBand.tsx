import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { CheckCircle2, Clock, ShieldCheck } from 'lucide-react';
import { Eyebrow } from '@/components/brand/Eyebrow';
import { cn } from '@/lib/utils';
import { ActionCue } from './DashboardKit';

/**
 * The top of the dashboard (Victor, 21 Oct 2026, direction A: "plus
 * attractive, et pas tout blanc"): a rounded navy band inside the page's
 * grid, so it stays apart from the navy hero above.
 *
 *  - "Your dashboard" in the accent, a greeting by the hour (the hero above
 *    already says "Welcome back"), the company acted for and its status (plain
 *    words with an icon: a status cannot be pressed, so it is never a pill),
 *    and "Switch company" for members of several;
 *  - how complete the profile is, as a ring, from what the To do list already
 *    knows is missing; at 100 % a plain "Profile complete";
 *  - four key figures, each ONE button or link that says in words what the
 *    number counts and where pressing it leads ("2 messages waiting for your
 *    answer · Answer →"). Never a bare number: Victor's second request the same
 *    day, many members are not at ease with technology.
 *
 * The numbers come from what the dashboard already loads (no query of its
 * own). Nothing moves on arrival (no count-up), so reduced motion has nothing
 * to stop.
 */

export interface BandFigure {
  key: string;
  /** Small words above the number: where it belongs ("Messages"). */
  kicker: string;
  /** The big number ("2", "D-37"); null while it loads. */
  value: string | null;
  /** The big value is a sign ("D-37") that `meta` says in words: not read out. */
  valueDecorative?: boolean;
  /** What the number counts, in words ("messages waiting for your answer"). */
  label: string;
  /** A second line ("in 37 days"). */
  meta?: string;
  /** What pressing it does ("Answer"). */
  action: string;
  /** A page (link) … */
  to?: string;
  /** … or something on this page (button). */
  onClick?: () => void;
  /** The whole text on hover, for a long label that is cut. */
  hoverTitle?: string;
}

export interface Completeness {
  done: number;
  total: number;
}

const ON_DARK_FOCUS = 'focus:outline-none focus-visible:ring-2 focus-visible:ring-gold focus-visible:ring-offset-2 focus-visible:ring-offset-navy';

/** The ring: the accent over a faint track. The words next to it say the same. */
function Ring({ pct }: { pct: number }) {
  const r = 26;
  const c = 2 * Math.PI * r;
  return (
    <span aria-hidden="true" className="relative grid h-[72px] w-[72px] shrink-0 place-items-center">
      <svg viewBox="0 0 64 64" className="absolute inset-0 h-full w-full -rotate-90">
        <circle cx="32" cy="32" r={r} fill="none" stroke="rgb(255 255 255 / 0.16)" strokeWidth="7" />
        {pct > 0 && (
          <circle
            cx="32" cy="32" r={r} fill="none" stroke="rgb(var(--gold))" strokeWidth="7" strokeLinecap="round"
            strokeDasharray={c} strokeDashoffset={c * (1 - pct / 100)}
          />
        )}
      </svg>
      <span className="relative font-signage text-[20px] font-semibold leading-none tabular-nums text-white">{pct}%</span>
    </span>
  );
}

export function DashboardBand({
  firstName,
  orgName,
  hasOrganization,
  orgVerified,
  onSwitchCompany,
  completeness,
  onSeeMissing,
  figures,
}: {
  firstName: string | null;
  orgName: string;
  hasOrganization: boolean;
  orgVerified: boolean;
  /** Members of several companies: "Switch company" (the dialog of My company). */
  onSwitchCompany?: () => void;
  /** null while it is not known yet (no ring that jumps). */
  completeness: Completeness | null;
  /** "See what is missing": the To do list, right below. */
  onSeeMissing: () => void;
  figures: BandFigure[];
}) {
  const { t } = useTranslation();
  const hour = new Date().getHours();
  const hello = hour < 12
    ? t('dash.band.morning', 'Good morning')
    : hour < 18 ? t('dash.band.afternoon', 'Good afternoon') : t('dash.band.evening', 'Good evening');
  const pct = completeness && completeness.total > 0 ? Math.round((completeness.done / completeness.total) * 100) : null;
  const left = completeness ? completeness.total - completeness.done : 0;

  return (
    <div className="relative overflow-hidden rounded-[24px] bg-navy px-4 py-6 text-white sm:px-8 sm:py-8">
      {/* A soft glow of the accent, top right: decoration only. */}
      <div aria-hidden="true" className="pointer-events-none absolute -right-24 -top-28 h-80 w-80 rounded-full bg-gold/15 blur-3xl" />

      <div className="relative flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between">
        <div className="min-w-0">
          <Eyebrow as="h2" tone="onDark" className="text-gold">
            <span id="dashboard-title">{t('memberHome.title', 'Your dashboard')}</span>
          </Eyebrow>
          <p className="mt-3 text-[28px] font-semibold leading-[34px] tracking-[-0.02em] [overflow-wrap:anywhere] sm:text-[34px] sm:leading-[40px]">
            {firstName ? t('dash.band.hello', { hello, name: firstName, defaultValue: '{{hello}}, {{name}}' }) : hello}
          </p>
          {hasOrganization && (
            <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-[15px] leading-6 text-white/85">
              <span className="[overflow-wrap:anywhere]">{t('dashboard.actingFor', { org: orgName, defaultValue: 'You are acting for {{org}}' })}</span>
              {orgVerified ? (
                <span className="inline-flex items-center gap-1.5 font-semibold text-emerald-300">
                  <ShieldCheck className="h-4 w-4 shrink-0" aria-hidden="true" />
                  {t('dashboard.verified', 'Verified')}
                </span>
              ) : (
                <span className="inline-flex items-center gap-1.5 font-semibold text-amber-200">
                  <Clock className="h-4 w-4 shrink-0" aria-hidden="true" />
                  {t('dashboard.underReview', 'Under review')}
                </span>
              )}
              {onSwitchCompany && (
                <button type="button" onClick={onSwitchCompany} className={cn('group -my-1 inline-flex min-h-11 cursor-pointer items-center rounded-pill', ON_DARK_FOCUS)}>
                  <ActionCue tone="dark" size="sm">{t('dash.switchCompany', 'Switch company')}</ActionCue>
                </button>
              )}
            </div>
          )}
        </div>

        {pct !== null && (
          pct >= 100 ? (
            <p className="inline-flex items-center gap-2 self-start text-[16px] font-semibold text-white lg:self-center">
              <CheckCircle2 className="h-5 w-5 shrink-0 text-gold" aria-hidden="true" />
              {t('dash.band.profileComplete', 'Profile complete')}
            </p>
          ) : (
            <button
              type="button"
              onClick={onSeeMissing}
              className={cn(
                'group flex w-full cursor-pointer items-center gap-4 rounded-[18px] bg-white/[0.07] p-4 text-left border border-white/15 sm:w-auto sm:min-w-[360px]',
                'transition-colors duration-200 hover:bg-white/[0.12] hover:border-white/35 active:bg-white/[0.16] motion-reduce:transition-none',
                ON_DARK_FOCUS,
              )}
            >
              <Ring pct={pct} />
              <span className="min-w-0">
                <span className="block text-[16px] font-semibold leading-6">
                  {t('dash.band.profilePct', { pct, defaultValue: 'Profile {{pct}}% complete' })}
                </span>
                <span className="block text-[14px] leading-5 text-white/75">
                  {t('dash.band.toAdd', { count: left, defaultValue_one: '{{count}} thing to add', defaultValue_other: '{{count}} things to add' })}
                </span>
                <span className="mt-2.5 flex">
                  <ActionCue tone="dark" size="sm" icon="down">{t('dash.band.seeMissing', 'See what is missing')}</ActionCue>
                </span>
              </span>
            </button>
          )
        )}
      </div>

      <ul className="relative mt-6 grid grid-cols-2 gap-3 lg:mt-8 lg:grid-cols-4 lg:gap-4">
        {figures.map((f) => {
          const cls = cn(
            'group flex h-full min-h-[188px] w-full cursor-pointer flex-col items-start rounded-[18px] bg-white/[0.07] border border-white/15 p-3.5 text-left sm:p-5',
            'transition-colors duration-200 hover:bg-white/[0.12] hover:border-white/35 active:bg-white/[0.16] motion-reduce:transition-none',
            ON_DARK_FOCUS,
          );
          const inner = (
            <>
              <span className="block text-[12px] font-semibold uppercase leading-4 tracking-[0.08em] text-white/75">{f.kicker}</span>
              {f.value === null ? (
                <>
                  <span aria-hidden="true" className="mt-2.5 block h-10 w-14 animate-pulse rounded-field bg-white/15 motion-reduce:animate-none" />
                  <span className="sr-only">{t('dash.loadingShort', 'Loading…')}</span>
                </>
              ) : (
                <span
                  aria-hidden={f.valueDecorative || undefined}
                  className="mt-2 block font-signage text-[40px] font-semibold leading-[44px] tabular-nums text-gold sm:text-[48px] sm:leading-[52px]"
                >
                  {f.value}
                </span>
              )}
              <span className="mt-1.5 line-clamp-3 text-[15px] leading-5 text-white [overflow-wrap:anywhere]">{f.label}</span>
              {f.meta && <span className="mt-1 block text-[13px] leading-[18px] text-white/75">{f.meta}</span>}
              <span className="mt-auto flex max-w-full pt-4">
                {/* Phones: a little less padding, so "View event" stays on one line in a half-width tile. */}
                <ActionCue tone="dark" size="sm" className="gap-1 px-2.5 sm:gap-1.5 sm:px-3">{f.action}</ActionCue>
              </span>
            </>
          );
          return (
            <li key={f.key} className="min-w-0">
              {f.to
                ? <Link to={f.to} title={f.hoverTitle} className={cls}>{inner}</Link>
                : <button type="button" title={f.hoverTitle} onClick={f.onClick} className={cls}>{inner}</button>}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
