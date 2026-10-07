import { Helmet } from 'react-helmet-async';
import { useTranslation } from 'react-i18next';
import { headTags, type PageMeta } from '@/lib/seoMeta';

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
 * `path` is the page's own path (with ?theme= when it matters, never another
 * query string): it becomes the absolute canonical URL. Leave it out on pages
 * that are not meant to be found on their own.
 */
export function Seo(props: PageMeta) {
  const { t } = useTranslation();
  const tags = headTags(props, t('seo.shareImageAlt', 'Smart Marina Connect, the marina industry network by M3 Monaco'));
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
