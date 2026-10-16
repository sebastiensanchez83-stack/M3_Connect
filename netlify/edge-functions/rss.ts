/**
 * Netlify edge function: the article feeds that partner WordPress sites import.
 *   /rss.xml     → m3monaco.com, articles ticked "Also publish on m3monaco.com" (resources.share_to_m3)
 *   /rss-s3.xml  → s3monaco.com, articles ticked "Also publish on s3monaco.com" (resources.share_to_s3)
 *
 * Each feed lists its ticked resources that are published and public, newest
 * first, at most 50. Each item carries the title, the summary as an excerpt
 * followed by a "Read the full article" link, the cover image and the topic:
 * /rss-s3.xml also supplies the public article body in content:encoded.
 * Its description stays an excerpt; /rss.xml remains excerpt-only.
 *
 * Read with the public anon key (netlify/lib/supabase-rest.ts), under the same
 * row-level security as an anonymous visitor: members-only articles can never
 * leave through here. A complete feed is kept 15 minutes on Netlify's CDN; if
 * Supabase does not answer, the reply is a 503 that is not kept, so the
 * importer simply tries again later rather than reading an empty feed.
 *
 * The response header X-SMC-Feed says which: live or unavailable.
 * Check it with: curl -s -D - -o /dev/null <site>/rss.xml
 * Declared in netlify.toml.
 */
import { selectRows, supabaseEnv } from '../lib/supabase-rest.ts';

const SITE_URL = 'https://smartmarinaconnect.com';
const LOOKUP_TIMEOUT_MS = 3000;
const MAX_ITEMS = 50;

interface Feed {
  path: string;
  /** The resources column an admin ticks for this site. */
  column: 'share_to_m3' | 'share_to_s3';
  /** Marks the visits that come from that site in Google Analytics. */
  tracking: string;
  /** Opt-in full HTML, leaving existing excerpt consumers unchanged. */
  fullContent?: boolean;
}

/** Keep the paths in step with the [[edge_functions]] entries in netlify.toml. */
const FEEDS: Feed[] = [
  { path: '/rss.xml', column: 'share_to_m3', tracking: 'utm_source=m3monaco.com&utm_medium=rss&utm_campaign=article_feed' },
  { path: '/rss-s3.xml', column: 'share_to_s3', tracking: 'utm_source=s3monaco.com&utm_medium=rss&utm_campaign=article_feed', fullContent: true },
];

interface Article {
  id: string;
  title: string | null;
  summary: string | null;
  content?: string | null;
  thumbnail_url: string | null;
  topic: string | null;
  published_at: string | null;
  created_at: string | null;
}

const xmlEscape = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');

/** Text inside CDATA: only "]]>" needs splitting. */
const cdata = (s: string) => `<![CDATA[${s.replace(/]]>/g, ']]]]><![CDATA[>')}]]>`;

const htmlEscape = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function imageType(url: string): string {
  const ext = url.split('?')[0].split('.').pop()?.toLowerCase();
  if (ext === 'png') return 'image/png';
  if (ext === 'webp') return 'image/webp';
  if (ext === 'gif') return 'image/gif';
  return 'image/jpeg';
}

function rfc822(value: string | null): string | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toUTCString();
}

export function renderFeed(articles: Article[], feed: Feed = FEEDS[0]): string {
  const items = articles.map((a) => {
    const url = `${SITE_URL}/resources/${a.id}`;
    const tracked = `${url}?${feed.tracking}`;
    const title = (a.title || 'Article').trim();
    const paragraphs = (a.summary || '').split(/\n+/).map((p) => p.trim()).filter(Boolean);
    const excerpt = `${paragraphs.map((p) => `<p>${htmlEscape(p)}</p>`).join('')}<p><a href="${htmlEscape(tracked)}">Read the full article on Smart Marina Connect</a></p>`;
    const body = (a.content || '').trim();
    const hasBody = body.replace(/<[^>]*>/g, '').replace(/&nbsp;|&#160;|&#xA0;/gi, ' ').trim().length > 0;
    const date = rfc822(a.published_at) ?? rfc822(a.created_at);
    const image = a.thumbnail_url && /^https:\/\//i.test(a.thumbnail_url) ? a.thumbnail_url : null;
    return [
      '    <item>',
      `      <title>${xmlEscape(title)}</title>`,
      `      <link>${xmlEscape(tracked)}</link>`,
      `      <guid isPermaLink="true">${xmlEscape(url)}</guid>`,
      date ? `      <pubDate>${date}</pubDate>` : '',
      a.topic ? `      <category>${xmlEscape(a.topic)}</category>` : '',
      `      <description>${cdata(excerpt)}</description>`,
      feed.fullContent && hasBody ? `      <content:encoded>${cdata(body)}</content:encoded>` : '',
      image ? `      <enclosure url="${xmlEscape(image)}" length="0" type="${imageType(image)}" />` : '',
      image ? `      <media:content url="${xmlEscape(image)}" medium="image" type="${imageType(image)}" />` : '',
      '    </item>',
    ].filter(Boolean).join('\n');
  });
  const newest = articles.length ? rfc822(articles[0].published_at) ?? rfc822(articles[0].created_at) : null;
  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom" xmlns:media="http://search.yahoo.com/mrss/"${feed.fullContent ? ' xmlns:content="http://purl.org/rss/1.0/modules/content/"' : ''}>
  <channel>
    <title>Smart Marina Connect — Articles</title>
    <link>${SITE_URL}/resources</link>
    <atom:link href="${SITE_URL}${feed.path}" rel="self" type="application/rss+xml" />
    <description>Articles from Smart Marina Connect, the B2B network of the marina industry.</description>
    <language>en</language>
${newest ? `    <lastBuildDate>${newest}</lastBuildDate>\n` : ''}${items.join('\n')}
  </channel>
</rss>
`;
}

export default async function rss(request: Request): Promise<Response> {
  const path = new URL(request.url).pathname;
  const feed = FEEDS.find((f) => f.path === path) ?? FEEDS[0];
  const env = supabaseEnv();
  const articles = env
    ? await selectRows<Article>(
      env,
      'resources',
      `select=id,title,summary,${feed.fullContent ? 'content,' : ''}thumbnail_url,topic,published_at,created_at&${feed.column}=eq.true&published=eq.true&access_level=eq.public&order=published_at.desc.nullslast&limit=${MAX_ITEMS}`,
      LOOKUP_TIMEOUT_MS,
    )
    : null;

  if (articles === null) {
    return new Response('Feed temporarily unavailable', {
      status: 503,
      headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store', 'Retry-After': '600', 'X-SMC-Feed': 'unavailable' },
    });
  }
  const headers = new Headers({
    'Content-Type': 'application/rss+xml; charset=utf-8',
    'Cache-Control': 'public, max-age=0, must-revalidate',
    'Netlify-CDN-Cache-Control': 'public, s-maxage=900, stale-while-revalidate=3600',
    'X-SMC-Feed': 'live',
  });
  return new Response(request.method === 'HEAD' ? null : renderFeed(articles, feed), { status: 200, headers });
}
