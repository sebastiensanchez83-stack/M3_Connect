import { useId, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Clock } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { BgRevealPanel } from '@/components/brand/BgRevealPanel';
import { Eyebrow } from '@/components/brand/Eyebrow';
import { OrgCard } from '@/components/brand/OrgCard';
import { ScrollRow } from '@/components/brand/ScrollRow';
import { UnderlineLink } from '@/components/brand/UnderlineLink';
import { LineReveal } from '@/components/motion/LineReveal';
import { Reveal } from '@/components/motion/Reveal';
import { THEMES } from '@/lib/themes';

/**
 * "Run a marina? Describe your need": the navy panel that turns marinas into
 * publishers (BgRevealPanel: its background scales in, then the content rises).
 *
 *  - left: the pitch, the six themes as pill doors into the service-provider
 *    directory, "Publish a need" and a link to the M3 team;
 *  - right: "What the form asks" (about two minutes). The type of need is a
 *    real choice (tender, expert question, project) and "Publish a need" opens
 *    the matching form for a signed-in marina, or the sign-up for a visitor.
 *    What the form then asks for (it depends on the type, see ASKS) is a plain
 *    numbered list, not a mock form: no input-like boxes, nothing that looks
 *    like it can be typed into;
 *  - below: the service-provider members, as a row of cards that follows the
 *    scroll (ScrollRow).
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

/** One line of "What the form asks": `key` is the i18n key under homePage.need.asks. */
interface Ask { key: string; label: string; hint: string }

const ASK_TITLE: Ask = { key: 'title', label: 'A title', hint: 'A short name for your need.' };
const ASK_SECTOR: Ask = { key: 'sector', label: 'The sector', hint: 'The field it belongs to.' };

/**
 * What each form asks for, in order, as the forms themselves do (SubmitRFPPage,
 * SubmitConsultationPage, SubmitProjectPage): a tender has a title, sectors, a
 * description and a deadline; an expert question the same without the deadline;
 * a project has no title or sector, but a type, a budget range and a timeline.
 */
const ASKS: Record<NeedType, readonly Ask[]> = {
  rfp: [
    ASK_TITLE,
    ASK_SECTOR,
    { key: 'description', label: 'A description', hint: 'What you need, in a few lines. For example: replacing 40 power pedestals on pontoon B, with individual metering.' },
    { key: 'deadline', label: 'A deadline', hint: 'When answers are due.' },
  ],
  consultation: [
    ASK_TITLE,
    ASK_SECTOR,
    { key: 'questionDescription', label: 'A description', hint: 'Your question for the experts, in a few lines.' },
  ],
  project: [
    { key: 'projectType', label: 'A project type', hint: 'Energy, digital, infrastructure, services or other.' },
    { key: 'budgetRange', label: 'A budget range', hint: 'Pick the range that fits, from under €10,000 to over €500,000.' },
    { key: 'timeline', label: 'A timeline', hint: 'Within 12 months, in 12 to 24 months, or later.' },
    { key: 'projectDescription', label: 'A description', hint: 'Your needs, goals and any specific requirements.' },
  ],
};
const NEED_ROUTES: Record<NeedType, string> = {
  rfp: '/submit-rfp',
  consultation: '/submit-consultation',
  project: '/submit-project',
};

export function NeedPanel({
  canSubmit,
  signedIn = false,
  providers,
  providersLoading,
  sectionNo,
}: {
  /** A verified marina (organization verified too): "Publish a need" opens the real form. */
  canSubmit: boolean;
  /** Signed in but not yet allowed to publish (account or organization under review): the button leads to the dashboard, where the review status is explained. Visitors are led to the marina sign-up. */
  signedIn?: boolean;
  providers: ProviderCardData[];
  providersLoading: boolean;
  /** Section number shown before the eyebrow ("02"). */
  sectionNo?: string;
}) {
  const { t } = useTranslation();
  const [type, setType] = useState<NeedType>('rfp');
  const waiting = signedIn && !canSubmit;
  const href = canSubmit ? NEED_ROUTES[type] : waiting ? '/dashboard' : '/become-partner#marina';

  return (
    <BgRevealPanel as="section" aria-labelledby="home-need-heading" bathy bathySeed={4} className="py-16 md:py-[104px]">
      <div className="mx-auto max-w-7xl px-4 sm:px-6">
        <div className="grid grid-cols-1 gap-10 lg:grid-cols-12 lg:items-center lg:gap-12">
          <div className="min-w-0 lg:col-span-7">
            <Reveal>
              <Eyebrow tone="onDark" number={sectionNo}>{t('homePage.need.eyebrow', 'Opportunities')}</Eyebrow>
            </Reveal>
            <LineReveal
              as="h2"
              id="home-need-heading"
              className="mt-4 max-w-[680px] text-balance text-[26px] font-semibold leading-8 tracking-[-0.02em] text-white md:text-[40px] md:leading-[48px]"
            >
              {t('homePage.need.title', 'Run a marina? Describe your need, and service providers can answer.')}
            </LineReveal>
            <Reveal as="p" delay={120} className="mt-5 max-w-[600px] text-body text-white/80 md:text-body-lg">
              {t('homePage.need.body', 'A tender, a question for an expert or a project: a few lines are enough. M3 reviews each need and publishes it within one business day. Prefer to write it with us? The M3 team can help.')}
            </Reveal>
            <Reveal delay={160}>
              <p id="home-need-themes" className="mt-6 text-[13px] font-medium leading-4 text-white/70">
                {t('homePage.need.themesLabel', 'Find service providers by theme')}
              </p>
              <nav aria-labelledby="home-need-themes">
                <ul className="mt-3 flex flex-wrap gap-2 text-[14px] leading-5">
                  {THEMES.map((th) => (
                    <li key={th.key}>
                      <Link
                        to={`/directory?type=partner&theme=${th.key}`}
                        className="focus-ring inline-flex min-h-11 items-center rounded-full border border-white/25 bg-white/10 px-3.5 py-1.5 transition-colors duration-300 hover:bg-white/20 md:min-h-9"
                      >
                        {t(th.labelKey, th.fallback)}
                      </Link>
                    </li>
                  ))}
                </ul>
              </nav>
            </Reveal>
            <Reveal delay={200} className="mt-8 flex flex-wrap items-center gap-x-6 gap-y-4">
              <Button asChild variant="ctaOnDark" size="lg">
                <Link to={href}>{waiting ? t('homePage.need.ctaWaiting', 'Check my account status') : t('homePage.need.cta', 'Publish a need')}</Link>
              </Button>
              <UnderlineLink to="/contact" tone="light">
                {t('homePage.need.writeTeam', 'Write to the M3 team')}
              </UnderlineLink>
            </Reveal>
            {!canSubmit && (
              <p className="mt-4 max-w-[600px] text-[13px] leading-[18px] text-white/70">
                {waiting
                  ? t('homePage.need.noteWaiting', 'You can publish once your marina is verified. Your dashboard shows where the review stands.')
                  : t('homePage.need.noteVisitor', 'Signing up is free. A marina can publish once its account is verified.')}
              </p>
            )}
          </div>

          <Reveal delay={120} className="min-w-0 lg:col-span-5">
            <NeedPreview type={type} onType={setType} />
          </Reveal>
        </div>

        {(providersLoading || providers.length > 0) && <ProviderRow providers={providers} loading={providersLoading} />}
      </div>
    </BgRevealPanel>
  );
}

/**
 * What the form asks: the type of need is a real choice (it decides which form
 * "Publish a need" opens); what the form then asks for is a static numbered list.
 */
function NeedPreview({ type, onType }: { type: NeedType; onType: (t: NeedType) => void }) {
  const { t } = useTranslation();
  const name = useId();
  const typeLabel: Record<NeedType, string> = {
    rfp: t('homePage.need.types.rfp', 'Tender'),
    consultation: t('homePage.need.types.consultation', 'Expert question'),
    project: t('homePage.need.types.project', 'Project'),
  };

  return (
    <figure className="rounded-card bg-white p-6 text-ink">
      <figcaption className="flex items-center justify-between gap-3">
        <span className="text-base font-semibold leading-[22px] text-navy">{t('homePage.need.previewLabel', 'What the form asks')}</span>
        <span className="inline-flex h-6 shrink-0 items-center gap-1.5 rounded-full bg-chip px-2.5 text-[12px] font-semibold uppercase tracking-[0.04em] text-navy">
          <Clock className="h-3.5 w-3.5" aria-hidden="true" />
          {t('homePage.need.duration', 'About 2 minutes')}
        </span>
      </figcaption>

      <fieldset className="mt-5">
        <legend className="text-[13px] font-medium leading-[18px] text-meta">{t('homePage.need.typeLegend', 'Type of need')}</legend>
        <div className="mt-1.5 grid grid-cols-3 gap-2">
          {NEED_TYPES.map((k) => (
            <label key={k} className="relative min-w-0">
              <input
                type="radio"
                name={name}
                value={k}
                checked={type === k}
                onChange={() => onType(k)}
                className="peer sr-only"
              />
              <span
                className={cn(
                  'flex min-h-11 cursor-pointer items-center justify-center rounded-field border border-checkbox bg-white px-2 py-2 text-center text-[13px] font-semibold leading-tight text-meta transition-colors duration-300 sm:text-sm',
                  'hover:border-navy hover:text-navy peer-checked:border-navy peer-checked:bg-navy peer-checked:text-white peer-focus-visible:shadow-focus',
                )}
              >
                {typeLabel[k]}
              </span>
            </label>
          ))}
        </div>
      </fieldset>

      <p className="mt-5 text-[13px] font-medium leading-[18px] text-meta">{t('homePage.need.fieldsIntro', 'The form then asks for:')}</p>
      <ol className="mt-2 divide-y divide-rule border-t border-rule">
        {ASKS[type].map((a, i) => (
          <li key={a.key} className="flex items-start gap-3 py-3">
            <span aria-hidden="true" className="tabular mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full bg-chip text-[12px] font-semibold text-navy">
              {i + 1}
            </span>
            <div className="min-w-0">
              <p className="text-[15px] font-semibold leading-6 text-navy">{t(`homePage.need.asks.${a.key}.label`, a.label)}</p>
              <p className="text-[14px] leading-5 text-meta">{t(`homePage.need.asks.${a.key}.hint`, a.hint)}</p>
            </div>
          </li>
        ))}
      </ol>
    </figure>
  );
}

/** The service-provider members, as a row that follows the scroll (a swiped row on phones and tablets). */
function ProviderRow({ providers, loading }: { providers: ProviderCardData[]; loading: boolean }) {
  const { t } = useTranslation();
  return (
    <div className="mt-14 md:mt-20">
      <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
        <Reveal as="h3" className="max-w-3xl text-[20px] font-semibold leading-[26px] text-white md:text-[24px] md:leading-[30px]">
          {t('homePage.need.providersTitle', 'Service providers in the network')}
        </Reveal>
        <Reveal>
          <UnderlineLink to="/directory?type=partner" tone="light">
            {t('homePage.need.providersLink', 'See all service providers')}
          </UnderlineLink>
        </Reveal>
      </div>

      {loading ? (
        <div aria-hidden="true" className="mt-6 flex gap-4 overflow-hidden lg:gap-5">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="h-[330px] w-[78%] shrink-0 animate-pulse rounded-card bg-white/10 sm:w-[300px]" />
          ))}
        </div>
      ) : (
        <ScrollRow label={t('homePage.need.providersLabel', 'Service provider members')} className="mt-6">
          {providers.map((o) => (
            <OrgCard
              key={o.id}
              id={o.id}
              name={o.name}
              href={`/organizations/${o.slug}`}
              type={o.organization_type}
              logoUrl={o.logo_url}
              city={o.city}
              country={o.country}
              description={o.description}
              verified
              className="h-full"
            />
          ))}
        </ScrollRow>
      )}
    </div>
  );
}
