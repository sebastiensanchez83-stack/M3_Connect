import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';
import { CapArrow } from '@/components/brand/CapArrow';
import { ContactCard } from '@/components/brand/ContactCard';
import { Eyebrow } from '@/components/brand/Eyebrow';
import { Reveal, RevealGroup } from '@/components/motion/Reveal';

/**
 * The end of the home page, in two harbour pieces:
 *
 *  - a pontoon signpost: finger boards on a post ("Directory · 180 marinas",
 *    "Resources · 30"), each a link that swings a few degrees about the post on
 *    hover or keyboard focus;
 *  - the harbour office strip ("Capitainerie M3"), across the full width on the
 *    light page: the question on the left, and on the right the harbour office
 *    plate of Victor Meyer, M3 Monaco (initials until a photo exists), whose
 *    tide button opens the contact page.
 */
export function EndSection({
  directoryLine,
  directorySign,
  resourcesSign,
  signedIn,
}: {
  /** "180 marinas and 66 service providers in 45 countries", or the plain sentence. */
  directoryLine: string;
  /** "180 marinas" (live) or null. */
  directorySign: string | null;
  /** "30 resources" (live) or null. */
  resourcesSign: string | null;
  signedIn: boolean;
}) {
  const { t } = useTranslation();
  const boards = [
    {
      to: '/directory',
      label: [t('homePage.end.directoryKicker', 'Directory'), directorySign].filter(Boolean).join(' · '),
      tone: 'navy' as const,
    },
    {
      to: '/resources',
      label: [t('homePage.end.resourcesKicker', 'Resources'), resourcesSign].filter(Boolean).join(' · '),
      tone: 'teal' as const,
    },
  ];

  return (
    <section aria-labelledby="home-end-heading" className="bg-page pb-16 pt-14 md:pb-24 md:pt-20">
      <div className="mx-auto max-w-7xl px-4 sm:px-6">
        {/* ── Signpost ── */}
        <div className="grid gap-8 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] md:items-center">
          <Reveal>
            <Eyebrow>{t('homePage.end.signEyebrow', 'Wayfinding')}</Eyebrow>
            <h2 id="home-end-heading" className="mt-3 text-h2-sm text-navy md:text-h2">
              {t('homePage.end.heading', 'Keep exploring')}
            </h2>
            <p className="mt-3 max-w-md text-body text-meta">{directoryLine}</p>
          </Reveal>
          <nav aria-labelledby="home-end-heading" className="relative pl-7 pt-4">
            {/* The post and its cap. */}
            <span aria-hidden="true" className="absolute bottom-[-18px] left-[12px] top-2 w-[7px] rounded-[2px] bg-navy" />
            <span aria-hidden="true" className="absolute left-[6px] top-0 h-3 w-[19px] rounded-[3px] bg-navy" />
            <RevealGroup as="ul" className="relative space-y-3">
              {boards.map((b) => (
                <li key={b.to}>
                  <Link
                    to={b.to}
                    className={cn(
                      'signpost-board group relative -ml-2 inline-flex min-h-[56px] items-center gap-3 py-2 pl-6 pr-12 font-signage text-[17px] font-semibold uppercase tracking-[0.12em] text-white outline-none sm:text-[19px]',
                      '[clip-path:polygon(0_0,calc(100%-24px)_0,100%_50%,calc(100%-24px)_100%,0_100%)]',
                      // Inset ring: the board's pointed shape would cut an outer one.
                      'focus-visible:shadow-[inset_0_0_0_3px_#ffffff,inset_0_0_0_5px_rgb(11_38_83)]',
                      b.tone === 'navy' ? 'bg-navy hover:bg-[#123170]' : 'bg-[#196a7a] hover:bg-[#1b7383]',
                    )}
                  >
                    {/* Bolt heads where the board meets the post. */}
                    <span aria-hidden="true" className="absolute left-2 top-1/2 h-1.5 w-1.5 -translate-y-1/2 rounded-full bg-white/40" />
                    <span>{b.label}</span>
                    <CapArrow size="sm" tone="dark" />
                  </Link>
                </li>
              ))}
            </RevealGroup>
          </nav>
        </div>

        {/* ── Harbour office strip ── */}
        <div className="mt-16 grid gap-8 border-y border-rule py-10 md:mt-20 md:py-12 lg:grid-cols-12 lg:items-center lg:gap-10">
          <Reveal className="lg:col-span-6">
            <Eyebrow>{t('homePage.end.contactEyebrow', 'Harbour office')}</Eyebrow>
            <h3 className="mt-3 text-h3 text-navy">
              {signedIn
                ? t('homePage.end.contactTitleMember', 'A question about the platform or our events?')
                : t('homePage.end.contactTitle', 'A question before you sign up?')}
            </h3>
            <p className="mt-2 max-w-xl text-body text-meta md:text-body-lg">
              {signedIn
                ? t('homePage.end.contactBodyMember', 'The M3 team answers every request.')
                : t('homePage.end.contactBody', 'The M3 team answers every request and helps you attach your company.')}
            </p>
          </Reveal>
          <Reveal delay={120} className="lg:col-span-5 lg:col-start-8">
            <ContactCard cta={{ label: t('homePage.end.contactCta', 'Write to the team'), to: '/contact' }} />
          </Reveal>
        </div>
      </div>
    </section>
  );
}
