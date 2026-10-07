import { Helmet } from 'react-helmet-async';
import { useTranslation } from 'react-i18next';
import { headTags, isPreviewHostname, type PageMeta } from '@/lib/seoMeta';

/**
 * A public page's head: title, description, canonical URL and og:url, share
 * card (og:*, twitter:*), robots and JSON-LD.
 *
 * The tag list comes from headTags() (src/lib/seoMeta.ts), the same function
 * the Netlify edge function uses to write these tags into the HTML for robots
 * that do not run JavaScript, so the two never disagree. react-helmet-async
 * marks every tag data-rh="true" and replaces the edge function's copies, and
 * the defaults in index.html, instead of adding second ones.
 *
 * On any host but the production site's (a deploy preview, a branch deploy, a
 * *.netlify.app address) every page says noindex, like the edge function does
 * in the HTML it serves: a preview must never be found through a search engine.
 *
 * `path` is the page's own path (with ?theme= when it matters, never another
 * query string): it becomes the absolute canonical URL. Leave it out on pages
 * that are not meant to be found on their own.
 */
export function Seo(props: PageMeta) {
  const { t } = useTranslation();
  const preview = typeof window !== 'undefined' && isPreviewHostname(window.location.hostname);
  const tags = headTags(preview ? { ...props, noindex: true } : props, t('seo.shareImageAlt', 'Smart Marina Connect, the marina industry network by M3 Monaco'));
  return (
    <Helmet>
      <title>{props.title}</title>
      {tags.map(({ tag, attrs, body }, i) => {
        const key = `${tag}-${attrs.name ?? attrs.property ?? attrs.rel ?? attrs.type}-${i}`;
        if (tag === 'meta') return <meta key={key} {...attrs} />;
        if (tag === 'link') return <link key={key} {...attrs} />;
        return <script key={key} {...attrs}>{body}</script>;
      })}
    </Helmet>
  );
}
