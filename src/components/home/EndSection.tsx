import { useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { CardShell, StretchedLink } from '@/components/brand/CardShell';
import { ContactCard } from '@/components/brand/ContactCard';
import { RevealGroup, Reveal } from '@/components/motion/Reveal';
import { useParallax } from '@/components/motion/useParallax';
import { SITE_IMAGES, type SiteImage } from '@/lib/siteMedia';

/**
 * The end of the home page: two photo tiles (the directory and the resource
 * library, each with its live figure, a title with a gold line and a small arrow, and a picture that drifts
 * slowly as the page scrolls) and, beside them, the closing panel with the
 * contact of Victor Meyer, M3 Monaco (initials until a photo exists), whose
 * rolling button opens the contact page.
 */
export function EndSection({
  directoryLine,
  resourcesLine,
  signedIn,
}: {
  /** "180 marinas and 66 service providers in 45 countries", or the plain sentence. */
  directoryLine: string;
  /** "30 resources in six themes", or the plain sentence. */
  resourcesLine: string;
  signedIn: boolean;
}) {
  const { t } = useTranslation();
  return (
    <section aria-label={t('homePage.end.label', 'Explore and contact us')} className="bg-page py-16 md:py-[104px]">
      <div className="mx-auto grid max-w-7xl gap-6 px-4 sm:px-6 lg:grid-cols-12">
        <RevealGroup className="grid gap-6 sm:grid-cols-2 lg:col-span-8">
          <EndTile to="/directory" image={SITE_IMAGES.joinHero} title={t('homePage.end.directoryKicker', 'Directory')} line={directoryLine} />
          <EndTile to="/resources" image={SITE_IMAGES.resourcesHero} title={t('homePage.end.resourcesKicker', 'Resources')} line={resourcesLine} />
        </RevealGroup>
        <Reveal delay={160} className="lg:col-span-4">
          <ContactCard
            variant="panel"
            className="h-full"
            title={signedIn
              ? t('homePage.end.contactTitleMember', 'A question about the platform or our events?')
              : t('homePage.end.contactTitle', 'A question before you sign up?')}
            line={signedIn
              ? t('homePage.end.contactBodyMember', 'The M3 team answers every request.')
              : t('homePage.end.contactBody', 'The M3 team answers every request and helps you attach your company.')}
            cta={{ label: t('homePage.end.contactCta', 'Write to the team'), to: '/contact' }}
          />
        </Reveal>
      </div>
    </section>
  );
}

function EndTile({ to, image, title, line }: { to: string; image: SiteImage; title: string; line: string }) {
  const pxRef = useRef<HTMLDivElement>(null);
  useParallax(pxRef, { max: 24 });
  return (
    <CardShell interactive tone="navy" className="h-60 lg:h-full lg:min-h-[280px]">
      <div aria-hidden="true" className="card-media absolute inset-0 overflow-hidden">
        <div ref={pxRef} className="absolute inset-x-0 -bottom-6 -top-6">
          {image.src && (
            <img
              src={image.src}
              alt=""
              loading="lazy"
              className="h-full w-full max-w-none object-cover"
              style={{ objectPosition: `50% ${Math.round(image.focusY * 100)}%` }}
            />
          )}
        </div>
      </div>
      <span aria-hidden="true" className="absolute inset-0 bg-[linear-gradient(to_top,rgba(11,38,83,.94)_0%,rgba(11,38,83,.6)_45%,rgba(11,38,83,0)_80%)]" />
      <div className="absolute inset-x-0 bottom-0 p-6 text-white">
        <h3 className="text-[22px] font-semibold leading-7">
          <StretchedLink to={to} tone="light">{title}</StretchedLink>
        </h3>
        <p className="mt-1 text-sm leading-5 text-white/85">{line}</p>
      </div>
    </CardShell>
  );
}
