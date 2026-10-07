import { useId, useRef, useState, type CSSProperties } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ArrowRight, Check } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Eyebrow } from '@/components/brand/Eyebrow';
import { OrgCard } from '@/components/brand/OrgCard';
import { ThemeFlag } from '@/components/brand/ThemeFlag';
import { WavePanel } from '@/components/motion/WavePanel';
import { useMotion } from '@/components/motion/MotionProvider';
import { useInView } from '@/components/motion/useInView';
import { THEMES, getTheme, type ThemeKey } from '@/lib/themes';
import { TextLink } from './HomeHeading';

/**
 * "Run a marina? Describe your need": the navy panel that turns marinas into
 * publishers. A wave-edged navy reveal (WavePanel), the pitch with theme doors
 * into the service-provider directory, an example notice to service providers
 * (set like a harbour "notice to mariners": type, theme, region, deadline; the
 * type is a real choice and "Publish a need" opens the matching form, or the
 * sign-up for a visitor), and the service-provider members moored at a
 * pontoon: a walkway with six berths (3 × 2 from lg), each card docking once
 * as the pontoon comes into view, then staying still. Swiped by hand on phones
 * and tablets. Under reduced motion the berths are simply filled.
 */
export interface ProviderCardData {
  id: string;
  slug: string;
  name: string;
  organization_type: string | null;
  logo_url: string | null;
  city: string | null;
  country: string | null;
  description: string | null;
}

type NeedType = 'rfp' | 'consultation' | 'project';
const NEED_TYPES: NeedType[] = ['rfp', 'consultation', 'project'];
const NEED_ROUTES: Record<NeedType, string> = {
  rfp: '/submit-rfp',
  consultation: '/submit-consultation',
  project: '/submit-project',
};
/** The example notice's theme for each type. */
const NEED_THEME: Record<NeedType, ThemeKey> = {
  rfp: 'energy',
  consultation: 'digital',
  project: 'design',
};

export function NeedPanel({
  canSubmit,
  providers,
  providersLoading,
}: {
  /** A signed-in marina: "Publish a need" opens the real form. Otherwise it leads to the sign-up. */
  canSubmit: boolean;
  providers: ProviderCardData[];
  providersLoading: boolean;
}) {
  const { t } = useTranslation();
  return (
    <WavePanel as="section" aria-labelledby="home-need-heading" bathy bathySeed={4} className="py-16 md:py-24">
      <div className="mx-auto max-w-7xl px-4 sm:px-6">
        <div className="grid grid-cols-1 gap-10 lg:grid-cols-12 lg:items-start lg:gap-8">
          <div className="min-w-0 lg:col-span-6">
            <Eyebrow tone="onDark">{t('homePage.need.eyebrow', 'Opportunities')}</Eyebrow>
            <h2 id="home-need-heading" className="mt-4 max-w-[680px] text-h2-sm text-white md:text-h2">
              {t('homePage.need.title', 'Run a marina? Describe your need, and checked service providers come to you.')}
            </h2>
            <p className="mt-4 max-w-[600px] text-body text-white/80 md:text-body-lg">
              {t('homePage.need.body', 'A tender, a question for an expert or a project: a few lines are enough, and the answers arrive in your inbox. Prefer to write it with us? The M3 team can help.')}
            </p>
            <nav aria-labelledby="home-need-themes" className="mt-8">
              <p id="home-need-themes" className="font-signage text-[13px] font-semibold uppercase tracking-[0.1em] text-white/70">
                {t('homePage.need.themesLabel', 'Find service providers by theme')}
              </p>
              {/* Phones: one row that scrolls sideways; wider screens: the chips wrap. */}
              <ul className="no-scrollbar -mx-4 mt-3 flex gap-2 overflow-x-auto px-4 py-1 sm:mx-0 sm:flex-wrap sm:overflow-visible sm:px-0">
                {THEMES.map((th) => (
                  <li key={th.key} className="shrink-0">
                    <Link
                      to={`/directory?type=partner&theme=${th.key}`}
                      className="focus-ring inline-flex h-11 items-center gap-2 whitespace-nowrap rounded-field bg-white/[0.08] px-3.5 text-sm font-medium text-white ring-1 ring-inset ring-white/20 transition-colors hover:bg-white/[0.16] md:h-10"
                    >
                      <ThemeFlag theme={th.key} className="ring-white/40" />
                      {t(th.labelKey, th.fallback)}
                    </Link>
                  </li>
                ))}
              </ul>
            </nav>
            <div className="mt-8">
              <Button asChild variant="tideOutlineLight">
                <Link to="/contact">
                  {t('homePage.need.writeTeam', 'Write to the M3 team')}
                  <ArrowRight className="h-4 w-4" aria-hidden="true" />
                </Link>
              </Button>
            </div>
          </div>

          <div className="min-w-0 lg:col-span-5 lg:col-start-8">
            <NeedNotice canSubmit={canSubmit} />
          </div>
        </div>

        {(providersLoading || providers.length > 0) && (
          <ProviderBerths providers={providers} loading={providersLoading} />
        )}
      </div>
    </WavePanel>
  );
}

/**
 * An example notice to service providers, set like a harbour notice. The type
 * of need is a real choice (three radio options); the rest of the notice shows
 * what a published one looks like, and says it is an example.
 */
function NeedNotice({ canSubmit }: { canSubmit: boolean }) {
  const { t } = useTranslation();
  const name = useId();
  const [type, setType] = useState<NeedType>('rfp');

  const typeLabel: Record<NeedType, string> = {
    rfp: t('homePage.need.types.rfp', 'Tender'),
    consultation: t('homePage.need.types.consultation', 'Expert question'),
    project: t('homePage.need.types.project', 'Project'),
  };
  const example: Record<NeedType, { region: string; deadline: string; text: string }> = {
    rfp: {
      region: t('homePage.need.notice.rfp.region', 'Western Mediterranean'),
      deadline: t('homePage.need.notice.rfp.deadline', '4 weeks after publication'),
      text: t('homePage.need.notice.rfp.text', 'Replacing 40 power pedestals on pontoon B, with individual metering.'),
    },
    consultation: {
      region: t('homePage.need.notice.consultation.region', 'Adriatic'),
      deadline: t('homePage.need.notice.consultation.deadline', '2 weeks after publication'),
      text: t('homePage.need.notice.consultation.text', 'Which berth-occupancy sensors still work after five years in salt water?'),
    },
    project: {
      region: t('homePage.need.notice.project.region', 'Arabian Gulf'),
      deadline: t('homePage.need.notice.project.deadline', 'Second quarter of 2027'),
      text: t('homePage.need.notice.project.text', 'Extending the marina by 120 berths for yachts up to 40 m.'),
    },
  };
  const theme = getTheme(NEED_THEME[type]);
  const href = canSubmit ? NEED_ROUTES[type] : '/become-partner';
  const ex = example[type];

  return (
    <div className="relative rounded-field bg-white p-5 text-ink shadow-drawer sm:p-7">
      {/* A notice's double rule. */}
      <span aria-hidden="true" className="pointer-events-none absolute inset-1.5 rounded-[8px] border border-navy/15" />
      <div className="relative flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-b-2 border-double border-navy/40 pb-3">
        <p className="font-signage text-[15px] font-semibold uppercase tracking-[0.14em] text-navy">
          {t('homePage.need.notice.title', 'Notice to service providers')}
        </p>
        <p className="font-signage text-[13px] font-medium uppercase tracking-[0.12em] text-meta">
          {t('homePage.need.notice.example', 'Example')}
        </p>
      </div>

      <fieldset className="relative mt-5">
        <legend className="text-sm font-semibold text-navy">{t('homePage.need.typeLegend', 'Type of need')}</legend>
        <div className="mt-2 grid grid-cols-3 gap-2">
          {NEED_TYPES.map((k) => (
            <label key={k} className="relative min-w-0">
              <input
                type="radio"
                name={name}
                value={k}
                checked={type === k}
                onChange={() => setType(k)}
                className="peer sr-only"
              />
              <span
                className={cn(
                  'flex min-h-11 cursor-pointer items-center justify-center gap-1.5 rounded-field border border-checkbox bg-white px-2 py-2 text-center text-[13px] font-semibold leading-tight text-meta transition-colors sm:text-sm',
                  'hover:border-navy hover:text-navy peer-checked:border-navy peer-checked:bg-foam peer-checked:text-navy peer-focus-visible:shadow-focus',
                  '[&>svg]:hidden peer-checked:[&>svg]:block',
                )}
              >
                <Check className="h-3.5 w-3.5 shrink-0 text-teal" strokeWidth={3} aria-hidden="true" />
                {typeLabel[k]}
              </span>
            </label>
          ))}
        </div>
      </fieldset>

      {/* The example notice itself: aria-live so a change of type is heard. */}
      <dl aria-live="polite" className="relative mt-5 grid grid-cols-[auto_minmax(0,1fr)] gap-x-5 gap-y-2 text-sm">
        <dt className="font-signage text-[13px] font-semibold uppercase tracking-[0.12em] text-meta">{t('homePage.need.notice.type', 'Type')}</dt>
        <dd className="font-semibold text-navy">{typeLabel[type]}</dd>
        <dt className="font-signage text-[13px] font-semibold uppercase tracking-[0.12em] text-meta">{t('homePage.need.fields.theme', 'Theme')}</dt>
        <dd className="flex items-center gap-2 text-ink">
          {theme && <ThemeFlag theme={theme.key} />}
          {theme ? t(theme.labelKey, theme.fallback) : ''}
        </dd>
        <dt className="font-signage text-[13px] font-semibold uppercase tracking-[0.12em] text-meta">{t('homePage.need.notice.region', 'Region')}</dt>
        <dd className="text-ink">{ex.region}</dd>
        <dt className="font-signage text-[13px] font-semibold uppercase tracking-[0.12em] text-meta">{t('homePage.need.fields.deadline', 'Deadline')}</dt>
        <dd className="text-ink">{ex.deadline}</dd>
        <dd className="col-span-2 mt-1 border-l-2 border-teal pl-3 italic text-ink/85">{ex.text}</dd>
      </dl>
      <p className="relative mt-3 text-[13px] leading-[18px] text-meta">
        {t('homePage.need.notice.issuer', 'Issued by a member marina. Its name is shown to checked members only.')}
      </p>

      <Button asChild variant="tide" className="relative mt-6 w-full">
        <Link to={href}>
          {t('homePage.need.cta', 'Publish a need')}
          <ArrowRight className="h-4 w-4" aria-hidden="true" />
        </Link>
      </Button>
      {!canSubmit && (
        <p className="relative mt-3 text-center text-[13px] leading-[18px] text-meta">
          {t('homePage.need.noteVisitor', 'Signing up is free. The M3 team checks every marina before it can publish.')}
        </p>
      )}
    </div>
  );
}

/**
 * The service-provider members moored at a pontoon. From lg: a walkway with a
 * catway per berth (3 × 2); each card docks once (rises from below its short
 * waterline, a small wake under it, 80 ms apart), then stays still. Phones and
 * tablets: a row swiped by hand, the cards docking the same way.
 */
function ProviderBerths({ providers, loading }: { providers: ProviderCardData[]; loading: boolean }) {
  const { t } = useTranslation();
  const { reduced } = useMotion();
  const listRef = useRef<HTMLUListElement>(null);
  const inView = useInView(listRef, { disabled: reduced, threshold: 0.15 });

  return (
    <div className="mt-16 border-t border-white/15 pt-10 md:mt-20">
      <div className="flex flex-wrap items-end justify-between gap-x-8 gap-y-3">
        <h3 className="max-w-3xl text-[20px] font-semibold leading-[26px] text-white md:text-h2-sm">
          {t('homePage.need.providersTitle', 'Service providers in the network, checked by the M3 team')}
        </h3>
        <TextLink to="/directory?type=partner" tone="dark">
          {t('homePage.need.providersLink', 'See all service providers')}
        </TextLink>
      </div>

      {loading ? (
        <div aria-hidden="true" className="mt-8 flex gap-4 overflow-hidden lg:grid lg:grid-cols-3 lg:gap-6">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-[248px] w-[280px] shrink-0 animate-pulse rounded-card bg-white/10 lg:w-auto" />
          ))}
        </div>
      ) : (
        <ul
          ref={listRef}
          aria-label={t('homePage.need.providersLabel', 'Service provider members')}
          className={cn(
            'berths no-scrollbar -mx-4 mt-8 flex snap-x snap-mandatory scroll-px-4 gap-4 overflow-x-auto px-4 pb-6 pt-1 sm:-mx-6 sm:scroll-px-6 sm:px-6',
            'lg:mx-0 lg:grid lg:grid-cols-3 lg:gap-x-6 lg:gap-y-10 lg:overflow-visible lg:px-0 lg:pb-4',
            inView && 'is-in',
          )}
        >
          {providers.map((o, i) => (
            <li
              key={o.id}
              style={{ '--i': i } as CSSProperties}
              className={cn(
                'relative flex w-[280px] shrink-0 snap-start flex-col sm:w-[300px] lg:w-auto lg:pt-7',
                // The walkway (planks) across the top of each row of berths, and this berth's catway.
                'lg:before:absolute lg:before:-left-3 lg:before:-right-3 lg:before:top-0 lg:before:h-[5px] lg:before:rounded-[1px] lg:before:bg-[repeating-linear-gradient(90deg,rgba(255,255,255,.34)_0_22px,rgba(255,255,255,.12)_22px_24px)] lg:before:content-[""]',
                'lg:after:absolute lg:after:left-1/2 lg:after:top-[5px] lg:after:h-[22px] lg:after:w-[3px] lg:after:-translate-x-1/2 lg:after:bg-white/30 lg:after:content-[""]',
              )}
            >
              <div className="berth-card flex flex-1">
                <OrgCard
                  name={o.name}
                  href={`/organizations/${o.slug}`}
                  type={o.organization_type}
                  logoUrl={o.logo_url}
                  city={o.city}
                  country={o.country}
                  description={o.description}
                  verified
                  className="w-full"
                />
              </div>
              {/* The wake under the card as it docks. */}
              <span aria-hidden="true" className="pointer-events-none absolute -bottom-4 left-1/2 block w-28 -translate-x-1/2">
                <svg viewBox="0 0 112 10" className="berth-wake block h-2.5 w-28" fill="none" stroke="#ffffff" strokeOpacity="0.6" strokeWidth="1.5" strokeLinecap="round">
                  <path d="M4 5Q18 1 32 5T60 5T88 5T108 5" />
                </svg>
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
