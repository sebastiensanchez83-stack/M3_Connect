import { useState, useEffect, useMemo, useRef, type MouseEvent as ReactMouseEvent } from 'react';
import { useParams, useNavigate, useLocation, Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { readMinutes } from '@/lib/readTime';
import { Helmet } from 'react-helmet-async';
import { Seo } from '@/components/seo/Seo';
import { useSeoTr } from '@/components/seo/useSeoTr';
import { isUuid, resourceMeta, resourcePath, type SlugRef } from '@/lib/seoMeta';
import { currentSlugFor, isMissingSlugColumn, noteMissingSlugColumn } from '@/lib/slugRoutes';
import DOMPurify from 'dompurify';
import { Button } from '@/components/ui/button';
import { AuthDialog } from '@/components/auth/AuthDialog';
import { LoginForm } from '@/components/auth/LoginForm';
import { SignupForm } from '@/components/auth/SignupForm';
import { ArrowLeft, Calendar, Clock, FileText, Lock, Share2 } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/lib/supabase';
import { LoadingSkeleton } from '@/components/LoadingSkeleton';
import { AdBanner } from '@/components/ui/AdBanner';
import { PageHero } from '@/components/ui/PageHero';
import { CardShell } from '@/components/brand/CardShell';
import { Eyebrow } from '@/components/brand/Eyebrow';
import { UnderlineLink } from '@/components/brand/UnderlineLink';
import { Reveal } from '@/components/motion/Reveal';
import { ResourceCard, type ResourceCardData } from '@/components/resources/ResourceParts';
import { getTheme, themesForSectors, type Theme } from '@/lib/themes';
import { cn } from '@/lib/utils';
import { companyHref, usePeopleOrgs } from '@/lib/personOrg';
import { displayCase } from '@/lib/displayCase';
import { LogoTile } from '@/components/brand/OrgCard';
import { linkFirstMentions, mentionHref, type MentionOrg } from '@/lib/companyMentions';
import '@/styles/refonte-content.css';

/**
 * One article, on the v2 kit: the compact PageHero banner (the article's own
 * picture, or the sea gradient) carrying the theme and type, the H1, the date,
 * the read time, the topic, the share button and the way back; then a reading
 * column of about 68 characters at 18/1.7 with the summary as a lead, the
 * speakers beside it (above it on phones), tags, and three related resources.
 *
 * Oct 2026 audit: the header has the breadcrumb of the other detail pages (Home /
 * Resources / title; one link back on phones), its theme comes from one source
 * (the article's sectors, primary theme first, as on the library's cards; the
 * free "topic" only when there is none), the people are "Authors" on an article
 * ("Speakers" on a replay or webinar), and each links to their company's page,
 * never to a personal one.
 *
 * Access is as before: public articles are open, "members" ones need an account,
 * "marina" ones a verified marina, developer or investor. Locked, the reader gets
 * a blurred beginning and a panel to sign up or sign in. The article's HTML is
 * sanitized (DOMPurify) and styled by `.smc-article` (src/styles/refonte-content.css).
 *
 * Companies mentioned (Victor, 20 Oct 2026): the companies M3 confirmed in the editor
 * (resource_organization_mention) are listed under the text, logo and name, each linking to its
 * page; the first time each name appears in the text it links there too. The links are added at
 * render time, after DOMPurify (src/lib/companyMentions.ts): the stored article never changes.
 *
 * Address (20 Oct 2026): /resources/<slug>. The page also opens /resources/<id> and any address
 * the article had before (resource_slug_lookup), then puts the current one in the address bar
 * (replace; query string, hash and state kept). Before the slug migration it reads by id as it
 * always did.
 */

interface Resource {
  id: string;
  /** The readable address (absent before the slug migration). */
  slug?: string | null;
  title: string;
  summary: string;
  content: string | null;
  type: string;
  topic: string;
  language: string;
  access_level: string;
  thumbnail_url: string | null;
  file_url: string | null;
  seo_keywords: string | null;
  published: boolean;
  created_at: string;
  published_at: string | null;
  updated_at?: string | null;
  tags: string[];
}

interface ResourceSpeaker {
  id: string;
  full_name: string;
  job_title: string | null;
  company_name: string | null;
  profile_id: string | null;
  display_order: number;
}

export function ResourceDetailPage() {
  // The article's slug, its id, or an address it had before.
  const { id: key } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  // Opened from the library list: going back returns to that exact filtered
  // view (theme, sector, search, scroll). Opened any other way (a shared link,
  // the dashboard), "Back to Resources" means the library itself.
  const cameFromList = (location.state as { fromList?: boolean } | null)?.fromList === true;
  // The latest location, for the address replacement made from inside the load.
  const locationRef = useRef(location);
  locationRef.current = location;
  // The article on screen: the replacement of its address must not load it again.
  const shownRef = useRef<{ id: string; slug: string | null } | null>(null);
  // A load still running when the reader has left the page, or moved on to another article,
  // must neither set state nor move the address bar (react-router's navigate still acts after
  // an unmount). Each load takes a number; only the latest one, page still mounted, goes on.
  // The replacement of the address by the load itself re-runs the effect without a new number
  // (the shownRef branch), so it never cancels the load that made it.
  const mountedRef = useRef(true);
  const loadSeq = useRef(0);
  const { t } = useTranslation();
  const seoTr = useSeoTr();
  const { user, profile, isVerified } = useAuth();
  const [resource, setResource] = useState<Resource | null>(null);
  const [relatedResources, setRelatedResources] = useState<Resource[]>([]);
  const [speakers, setSpeakers] = useState<ResourceSpeaker[]>([]);
  // The companies M3 confirmed this article mentions (only verified, listed ones are readable).
  const [mentions, setMentions] = useState<MentionOrg[]>([]);
  // People have no page of their own: an author links to their company's page.
  const speakerOrgs = usePeopleOrgs(speakers.map((sp) => sp.profile_id));
  const [themes, setThemes] = useState<Theme[]>([]);
  const [loading, setLoading] = useState(true);
  const [loginOpen, setLoginOpen] = useState(false);
  const [signupOpen, setSignupOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const copiedTimer = useRef<number | undefined>(undefined);

  useEffect(() => () => window.clearTimeout(copiedTimer.current), []);
  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  useEffect(() => {
    /** The article's own address in the address bar, query string, hash and state kept (no new history entry). */
    const showAddressOf = (ref: SlugRef) => {
      const loc = locationRef.current;
      navigate({ pathname: resourcePath(ref), search: loc.search, hash: loc.hash }, { replace: true, state: loc.state });
    };

    const fetchResource = async () => {
      if (!key) return;
      const shown = shownRef.current;
      if (shown && (shown.id === key || shown.slug === key)) {
        // The article already on screen, under another of its addresses: nothing to load again.
        if (shown.slug && key !== shown.slug) showAddressOf(shown);
        return;
      }
      const seq = ++loadSeq.current;
      const live = () => mountedRef.current && seq === loadSeq.current;
      // Another article from here on: coming back to the previous one's address while this load
      // runs must load that one again (which cancels this load), not take the shortcut above.
      shownRef.current = null;
      setLoading(true);
      window.scrollTo(0, 0);
      let moved = false;
      try {
        // An id (old links, e-mails, the RSS feeds) or a slug (every link since 20 Oct 2026).
        const byId = isUuid(key);
        const { data, error } = await supabase
          .from('resources')
          .select('*')
          .eq(byId ? 'id' : 'slug', byId ? key : key.toLowerCase())
          .eq('published', true)
          .maybeSingle();
        if (!live()) return;

        if (isMissingSlugColumn(error)) noteMissingSlugColumn('resources');
        if (!data && !byId && !error) {
          // An address the article had before: it leads to the current one, for ever.
          const current = await currentSlugFor('resources', key);
          if (!live()) return;
          if (current && current !== key) {
            moved = true;
            showAddressOf({ id: current, slug: current });
            return;
          }
        }
        if (error || !data) {
          navigate('/resources', { replace: true });
          return;
        }
        const article = data as Resource;
        const id = article.id;
        shownRef.current = { id, slug: article.slug ?? null };
        setResource(article);
        if (article.slug && key !== article.slug) showAddressOf(article);

        // Fetch speakers
        const { data: speakerData } = await supabase
          .from('resource_speakers')
          .select('id, full_name, job_title, company_name, profile_id, display_order')
          .eq('resource_id', id)
          .order('display_order');
        if (!live()) return;
        setSpeakers((speakerData || []) as ResourceSpeaker[]);

        // Companies mentioned. Best effort: without them the article reads as before. Readers
        // only get listed companies (the database's rule); M3 staff can read every mention, so
        // the unlisted ones (not verified, archived, merged) are dropped here too: staff see the
        // page as readers do.
        type MentionRow = MentionOrg & { access_status?: string | null; archived_at?: string | null; duplicate_of?: string | null };
        const { data: mentionRows } = await supabase
          .from('resource_organization_mention')
          .select('organization_id, organizations(id, name, slug, logo_url, organization_type, access_status, archived_at, duplicate_of)')
          .eq('resource_id', id);
        if (!live()) return;
        setMentions(
          ((mentionRows ?? []) as unknown as { organizations: MentionRow | MentionRow[] | null }[])
            .map((m) => (Array.isArray(m.organizations) ? m.organizations[0] : m.organizations))
            .filter((o): o is MentionRow => !!o && !!o.slug && o.access_status === 'verified' && !o.archived_at && !o.duplicate_of)
            .map((o): MentionOrg => ({ id: o.id, name: o.name, slug: o.slug, logo_url: o.logo_url, organization_type: o.organization_type }))
            .sort((a, b) => a.name.localeCompare(b.name)),
        );

        // The article's themes, from its sectors: for the header's eyebrow. Best
        // effort: without them the header shows the type alone.
        const { data: sectorRows } = await supabase
          .from('resource_sectors')
          .select('sectors(slug)')
          .eq('resource_id', id);
        if (!live()) return;
        const slugs = ((sectorRows ?? []) as unknown as { sectors: { slug: string } | { slug: string }[] | null }[])
          .flatMap((row) => (Array.isArray(row.sectors) ? row.sectors : row.sectors ? [row.sectors] : []))
          .map((s) => s.slug);
        setThemes(themesForSectors(slugs).map((k) => getTheme(k)).filter((th): th is Theme => !!th));

        // Fetch related resources
        const { data: related } = await supabase
          .from('resources')
          // The slug only when the database has it (select('*') above says so).
          .select(`id, title, summary, type, topic, thumbnail_url, access_level, created_at, published_at, tags${'slug' in article ? ', slug' : ''}`)
          .eq('published', true)
          .neq('id', id)
          .or(`type.eq.${article.type},topic.eq.${article.topic}`)
          .order('published_at', { ascending: false, nullsFirst: false })
          .order('created_at', { ascending: false })
          .limit(3);
        if (!live()) return;

        setRelatedResources((related || []) as unknown as Resource[]);
      } catch {
        if (live()) navigate('/resources', { replace: true });
      } finally {
        // Moved to the current address: that load keeps the skeleton up. A load overtaken by
        // another one (or by leaving the page) leaves the skeleton to it.
        if (!moved && live()) setLoading(false);
      }
    };

    fetchResource();
  }, [key, navigate]);

  // The article's HTML, sanitized, with the first occurrence of each mentioned company linked.
  const articleHtml = useMemo(
    () => (resource?.content ? linkFirstMentions(DOMPurify.sanitize(resource.content), mentions) : ''),
    [resource?.content, mentions],
  );

  /** A company link inside the article opens its page in the app (no full reload). */
  const onArticleClick = (e: ReactMouseEvent<HTMLDivElement>) => {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    const link = (e.target as Element | null)?.closest?.('a[data-org-mention]');
    const href = link?.getAttribute('href');
    if (!href || !href.startsWith('/organizations/')) return;
    e.preventDefault();
    navigate(href);
  };

  const canAccess = (level: string) => {
    if (level === 'public') return true;
    if (!user) return false;
    if (level === 'members') return true;
    if (level === 'marina') {
      const isInterestSide = profile?.persona === 'marina' || profile?.persona === 'developer' || profile?.persona === 'investor';
      return isInterestSide && isVerified;
    }
    return false;
  };

  const formatDate = (date: string) => {
    return new Date(date).toLocaleDateString('en-GB', {
      year: 'numeric', month: 'long', day: 'numeric',
    });
  };
  const formatShort = (date: string) =>
    new Date(date).toLocaleDateString('en-GB', { year: 'numeric', month: 'short', day: 'numeric' });

  // Same helper as the library cards, so both show the same duration.
  const estimateReadTime = readMinutes;

  const getInitials = (name: string) =>
    name.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase();

  const share = async () => {
    if (!resource) return;
    try {
      // The article's own address (its slug), without whatever query string brought the reader here.
      const url = `${window.location.origin}${resourcePath(resource)}`;
      if (navigator.share) {
        await navigator.share({ title: resource.title, url });
        return;
      }
      await navigator.clipboard.writeText(url);
      setCopied(true);
      window.clearTimeout(copiedTimer.current);
      copiedTimer.current = window.setTimeout(() => setCopied(false), 2200);
    } catch {
      // The reader closed the share sheet, or the clipboard is blocked: nothing to report.
    }
  };

  if (loading) {
    // A whole screen tall (same loader as the lazy routes): the footer stays below the fold, so the page arriving does not shift.
    return <LoadingSkeleton variant="screen" />;
  }

  if (!resource) return null;

  const hasAccess = canAccess(resource.access_level);
  const readTime = estimateReadTime(resource.content);
  const displayDate = resource.published_at || resource.created_at;
  // Title, description, canonical URL, share card and Article JSON-LD: the same builder as
  // the edge function that writes them into the HTML for share previews (src/lib/seoMeta.ts).
  const seo = resourceMeta(resource, seoTr);

  const typeLabel = t(`resources.types.${resource.type}`);
  // One source for the theme: the article's sectors, primary theme first (the
  // library's cards name the same one). The legacy free "topic" only stands in
  // when the article has no sector.
  const primaryTheme = themes[0] ? t(themes[0].labelKey, themes[0].fallback) : (resource.topic ? displayCase(resource.topic.charAt(0).toUpperCase() + resource.topic.slice(1)) : '');
  const eyebrow = [primaryTheme, typeLabel].filter(Boolean).join(' · ');
  // Replays and webinars have speakers; everything else is written by authors.
  const spoken = resource.type === 'replay' || resource.type === 'webinar';
  const peopleTitle = spoken ? t('resourceDetail.speakers', 'Speakers') : t('resourceDetail.authors', 'Authors');

  const speakersCard = speakers.length > 0 && (
    <CardShell className="p-5 sm:p-6">
      <h2 className="text-meta-caps">{peopleTitle}</h2>
      <ul className="mt-4 grid gap-4">
        {speakers.map((speaker) => {
          // Name, job title and company; the company links to its page.
          const org = speaker.profile_id ? speakerOrgs[speaker.profile_id] : undefined;
          const href = companyHref(org);
          const company = displayCase(speaker.company_name || org?.name || '');
          return (
            <li key={speaker.id} className="flex items-center gap-3">
              <span
                aria-hidden="true"
                className="grid h-11 w-11 shrink-0 place-items-center rounded-pill bg-teal text-sm font-semibold tracking-[0.02em] text-white"
              >
                {getInitials(speaker.full_name)}
              </span>
              <div className="min-w-0">
                <p className="text-[15px] font-semibold text-navy">{speaker.full_name}</p>
                {speaker.job_title && <p className="text-sm leading-5 text-meta">{speaker.job_title}</p>}
                {company && (href ? (
                  <Link to={href} className="uline uline--plain !text-sm !font-medium text-navy">
                    <span className="uline-t">{company}</span>
                  </Link>
                ) : (
                  <p className="text-sm leading-5 text-ink">{company}</p>
                ))}
              </div>
            </li>
          );
        })}
      </ul>
    </CardShell>
  );

  return (
    <div className="min-h-screen bg-white">
      <Seo {...seo} />
      {resource.seo_keywords && <Helmet><meta name="keywords" content={resource.seo_keywords} /></Helmet>}

      {/* Header: the sea gradient. The article's own picture is shown whole under it: thumbnails are often posters with their own text, which a veil would turn into noise behind the title. */}
      <PageHero
        image={null}
        seed={resource.id}
        icon={FileText}
        breadcrumbs={[
          { label: t('nav.home', 'Home'), href: '/' },
          { label: t('nav.resources', 'Resources'), href: '/resources' },
          { label: resource.title },
        ]}
        eyebrow={eyebrow}
        title={resource.title}
      >
        <div className="flex flex-wrap items-center gap-x-5 gap-y-3 text-[14px] leading-5 text-white/85">
          <span className="inline-flex items-center gap-1.5">
            <Calendar className="h-4 w-4" aria-hidden="true" />
            <span className="sr-only">{t('contentPages.article.published', 'Published')} </span>
            <time dateTime={displayDate}>{formatDate(displayDate)}</time>
          </span>
          <span className="inline-flex items-center gap-1.5">
            <Clock className="h-4 w-4" aria-hidden="true" />
            <span>{readTime} {t('resourceDetail.minRead')}</span>
          </span>
          {resource.access_level !== 'public' && (
            <span className="inline-flex h-6 items-center gap-1.5 rounded-pill bg-white/15 px-2.5 text-[12px] font-semibold text-white shadow-[inset_0_0_0_1px_rgba(255,255,255,.3)]">
              <Lock className="h-3 w-3" aria-hidden="true" />
              {t(`resources.accessLevels.${resource.access_level}`)}
            </span>
          )}
        </div>
        <div className="mt-5 flex flex-wrap items-center gap-x-6 gap-y-3">
          {/* Opened from the library: back to that exact filtered view (the breadcrumb
              above goes to the library itself). */}
          {cameFromList && (
            <button
              type="button"
              onClick={() => navigate(-1)}
              className="uline uline--light uline--plain !text-[14px] !font-normal"
            >
              <ArrowLeft className="h-4 w-4" aria-hidden="true" />
              <span className="uline-t">{t('resourceDetail.backToResults', 'Back to your results')}</span>
            </button>
          )}
          <Button
            type="button"
            variant="ctaLight"
            size="sm"
            arrow={false}
            roll={false}
            onClick={share}
            className="gap-2 px-4"
          >
            <Share2 className="h-4 w-4" aria-hidden="true" />
            <span aria-live="polite">{copied ? t('contentPages.article.linkCopied', 'Link copied') : t('resourceDetail.share')}</span>
          </Button>
        </div>
      </PageHero>

      {/* The reading column and, beside it, the speakers */}
      <div className="mx-auto w-full max-w-7xl px-4 py-10 sm:px-6 md:py-14">
        <div className="grid gap-8 lg:grid-cols-12 lg:gap-14">
          <div className="min-w-0 lg:col-span-8">
            {/* The article's own picture, at the card's 16:10 */}
            {resource.thumbnail_url && (
              <figure className="mb-8 max-w-[68ch] overflow-hidden rounded-card bg-chip md:mb-10">
                <img src={resource.thumbnail_url} alt={resource.title} className="aspect-[16/10] w-full object-cover" />
              </figure>
            )}

            {/* Summary: the lead of the article */}
            {resource.summary && (
              <p className="max-w-[68ch] text-[19px] font-medium leading-[30px] text-navy md:text-[20px] md:leading-8">
                {resource.summary}
              </p>
            )}

            {/* Speakers: here on phones, beside the article from lg */}
            {speakersCard && <div className="mt-8 max-w-[68ch] lg:hidden">{speakersCard}</div>}

            {/* Content or lock */}
            {hasAccess ? (
              <>
                {resource.content && (
                  <article className={cn(resource.summary && 'mt-8 border-t border-rule pt-8')}>
                    <div
                      className="smc-article"
                      onClick={onArticleClick}
                      dangerouslySetInnerHTML={{ __html: articleHtml }}
                    />
                  </article>
                )}
                {mentions.length > 0 && (
                  <section aria-labelledby="mentions-heading" className="mt-10 max-w-[68ch] border-t border-rule pt-6">
                    <h2 id="mentions-heading" className="text-meta-caps">{t('resourceDetail.mentionsTitle', 'Companies in this article')}</h2>
                    <ul className="mt-4 flex flex-wrap gap-3">
                      {mentions.map((o) => {
                        const label = displayCase(o.name) || o.name;
                        return (
                          <li key={o.id}>
                            <Link
                              to={mentionHref(o.slug)}
                              className="group inline-flex min-h-11 items-center gap-2.5 rounded-pill border border-rule bg-white py-1.5 pl-1.5 pr-4 text-[15px] font-semibold text-navy transition-colors hover:border-navy/40 focus:outline-none focus-visible:shadow-focus"
                            >
                              <LogoTile src={o.logo_url} name={label} type={o.organization_type ?? null} size={32} className="!rounded-pill !p-1" />
                              <span className="underline decoration-transparent underline-offset-4 transition-colors group-hover:decoration-gold">{label}</span>
                            </Link>
                          </li>
                        );
                      })}
                    </ul>
                  </section>
                )}
                {resource.file_url && (
                  <div className="mt-10">
                    <Button asChild variant="cta">
                      <a href={resource.file_url} target="_blank" rel="noopener noreferrer">
                        {resource.type === 'replay' ? t('resources.watchReplay') : t('resources.download')}
                        <span className="sr-only"> (opens in a new tab)</span>
                      </a>
                    </Button>
                  </div>
                )}
              </>
            ) : (
              <div className="relative mt-8">
                {/* Blurred preview of the beginning */}
                {resource.content && (
                  <div aria-hidden="true" className="relative max-h-64 overflow-hidden">
                    <div
                      className="smc-article select-none"
                      dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(resource.content) }}
                      style={{ filter: 'blur(5px)', pointerEvents: 'none' }}
                    />
                    <div className="absolute inset-0 bg-gradient-to-b from-transparent via-white/60 to-white" />
                  </div>
                )}
                {/* CTA panel */}
                <div className="relative rounded-card border border-rule bg-page px-6 py-10 text-center sm:px-10">
                  <span aria-hidden="true" className="mx-auto mb-4 grid h-14 w-14 place-items-center rounded-pill bg-chip text-navy">
                    <Lock className="h-6 w-6" />
                  </span>
                  <h2 className="text-h3 text-navy">
                    {!user
                      ? t('resourceDetail.signupToRead', 'Sign up to read the full article')
                      : t('resourceDetail.restrictedTitle')}
                  </h2>
                  <p className="mx-auto mt-2 max-w-md text-body text-meta">
                    {!user
                      ? t('resourceDetail.signupToReadDesc', 'Sign up or sign in to read this article and the other member-only resources.')
                      : resource.access_level === 'members'
                      ? t('resources.signupToAccess')
                      : t('resources.verifyMarinaToAccess')}
                  </p>
                  {!user ? (
                    <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
                      <Button variant="cta" onClick={() => setSignupOpen(true)}>
                        {t('auth.signup', 'Sign up')}
                      </Button>
                      <Button variant="ctaOutline" onClick={() => setLoginOpen(true)}>
                        {t('auth.login', 'Log In')}
                      </Button>
                    </div>
                  ) : (
                    <Button asChild variant="ctaNavy" className="mt-6">
                      <Link to="/dashboard">{t('resourceDetail.goToAccount')}</Link>
                    </Button>
                  )}
                </div>
              </div>
            )}

            {/* Sponsor Ad Banner */}
            <AdBanner placement="resources" className="my-8" />

            {/* Tags */}
            {resource.tags && resource.tags.length > 0 && (
              <div className="border-t border-rule pt-6">
                <h2 className="sr-only">{t('contentPages.article.tags', 'Tags')}</h2>
                <ul className="flex flex-wrap gap-2">
                  {resource.tags.map((tag) => (
                    <li key={tag} className="inline-flex h-8 items-center rounded-pill bg-chip px-3 text-sm font-medium text-navy">
                      #{tag}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>

          {/* Speakers beside the article from lg */}
          {speakersCard && (
            <aside className="hidden lg:col-span-4 lg:block">
              <div className="lg:sticky lg:top-20">{speakersCard}</div>
            </aside>
          )}
        </div>
      </div>

      {/* Related resources */}
      {relatedResources.length > 0 && (
        <section aria-labelledby="related-heading" className="bg-page py-14 md:py-20">
          <div className="mx-auto w-full max-w-7xl px-4 sm:px-6">
            <div className="flex flex-wrap items-end justify-between gap-x-8 gap-y-3">
              <div>
                <Reveal>
                  <Eyebrow>{t('resources.heroTag', 'Library')}</Eyebrow>
                </Reveal>
                <Reveal delay={80}>
                  <h2 id="related-heading" className="mt-3 text-h2-sm text-navy md:text-h2">{t('resourceDetail.relatedResources')}</h2>
                </Reveal>
              </div>
              <UnderlineLink to="/resources">{t('contentPages.article.backToLibrary', 'Browse the whole library')}</UnderlineLink>
            </div>
            <ul className="mt-8 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
              {relatedResources.map((rel, i) => (
                <Reveal as="li" key={rel.id} delay={i * 80} className="flex min-w-0">
                  <ResourceCard
                    resource={rel as ResourceCardData}
                    locked={!canAccess(rel.access_level)}
                    formatDate={formatShort}
                    fromList={false}
                  />
                </Reveal>
              ))}
            </ul>
          </div>
        </section>
      )}

      {/* Sign in / sign up without leaving the page: the shared window (AuthDialog). */}
      <AuthDialog
        mode="login"
        open={loginOpen}
        onOpenChange={setLoginOpen}
        switchTo={{ onClick: () => { setLoginOpen(false); setSignupOpen(true); } }}
      >
        <LoginForm onSuccess={() => setLoginOpen(false)} />
      </AuthDialog>
      <AuthDialog
        mode="signup"
        open={signupOpen}
        onOpenChange={setSignupOpen}
        switchTo={{ onClick: () => { setSignupOpen(false); setLoginOpen(true); } }}
      >
        <SignupForm onSuccess={() => { setSignupOpen(false); navigate('/onboarding'); }} />
      </AuthDialog>

    </div>
  );
}
