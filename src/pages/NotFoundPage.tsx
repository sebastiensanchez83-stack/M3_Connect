import { Link } from 'react-router-dom';
import { Seo } from '@/components/seo/Seo';
import { Button } from '@/components/ui/button';
import { useTranslation } from 'react-i18next';
import { BathyPattern } from '@/components/motion/BathyPattern';
import { Eyebrow } from '@/components/brand/Eyebrow';
import { SearchField, ALL_SUGGESTIONS } from '@/components/brand/SearchField';

/**
 * The 404, on the v2 kit: a marine panel with sounding lines drifting very
 * slowly, the status in light weight, one sentence, the directory search (a wrong
 * link is often someone looking for a company) and the two ways out. This page is
 * in the entry bundle: it only uses pieces the header and footer already load.
 */
export function NotFoundPage() {
  const { t } = useTranslation();

  return (
    <div className="relative isolate overflow-hidden bg-navy-deep text-white">
      {/* No canonical, and out of the index: the URL is wrong, not the page. */}
      <Seo title={`${t('seo.notFound.title', 'Page not found')} | Smart Marina Connect`} noindex />
      <BathyPattern seed={9} drift className="absolute inset-0 -z-10" />
      <div className="mx-auto flex min-h-[70vh] max-w-7xl flex-col justify-center px-4 py-20 sm:px-6 md:py-28">
        <Eyebrow tone="onDark">{t('contentPages.notFound.eyebrow', 'Error 404')}</Eyebrow>
        <p aria-hidden="true" className="mt-6 text-[88px] font-light leading-[0.9] tracking-[-0.04em] text-white/90 md:text-[136px]">
          404
        </p>
        <h1 className="mt-6 text-h1-sm text-white sm:text-h1">{t('seo.notFound.title', 'Page not found')}</h1>
        <p className="mt-3 max-w-xl text-body md:text-body-lg text-white/85">
          {t('errors.pageNotFound', 'The page you are looking for does not exist or has moved.')}
        </p>
        <SearchField
          className="mt-8 max-w-lg"
          label={t('contentPages.notFound.searchLabel', 'Search the directory')}
          suggest={ALL_SUGGESTIONS}
        />
        <div className="mt-8 flex flex-wrap gap-3">
          <Button asChild variant="ctaOnDark">
            <Link to="/">{t('common.backToHome', 'Back to home')}</Link>
          </Button>
          <Button asChild variant="ctaLight">
            <Link to="/directory">{t('contentPages.notFound.browseDirectory', 'Browse the directory')}</Link>
          </Button>
        </div>
      </div>
    </div>
  );
}
