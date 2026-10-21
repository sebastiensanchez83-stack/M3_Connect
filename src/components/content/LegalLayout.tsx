import { createContext, useContext, useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import DOMPurify from 'dompurify';
import { Seo } from '@/components/seo/Seo';
import { plainPageMeta } from '@/lib/seoMeta';
import { Eyebrow } from '@/components/brand/Eyebrow';
import { UnderlineLink } from '@/components/brand/UnderlineLink';
import { subscribeScroll } from '@/components/motion/scrollLoop';
import { useSiteBlock } from '@/lib/siteContent/store';
import type { LegalBlock } from '@/lib/siteContent/blocks';
import '@/styles/refonte-content.css';

/**
 * The frame of the five legal documents (Privacy, Terms, Cookies, Legal notice,
 * Commercial terms): a readable article and nothing else, in the v2 look. The
 * documents keep their own markup and text (articles as <section> with an <h2>);
 * `.legal-body` (src/styles/refonte-content.css) restyles it into one column of
 * about 72 characters a line.
 *
 * From lg a sticky "On this page" list, built from the document's own <h2>s,
 * follows the reader and marks the current article. Below the article, links to
 * the other four documents.
 *
 * Editable (Admin > Site pages, Oct 2026): once M3 publishes a document's body
 * ('legal.<doc>' in site_content), that HTML, sanitized with DOMPurify, replaces
 * the page's own markup, and its "Version of ..." line replaces the code's.
 * Nothing published: the page's children, as before. The title (and the SEO
 * head, src/lib/seoMeta.ts) stays in the code.
 */

export const LEGAL_DOCS = [
  { to: '/privacy', key: 'privacy', fallback: 'Privacy Policy', cms: 'legal.privacy' },
  { to: '/terms', key: 'terms', fallback: 'Terms of Use', cms: 'legal.terms' },
  { to: '/cookies', key: 'cookies', fallback: 'Cookie Policy', cms: 'legal.cookies' },
  { to: '/mentions-legales', key: 'notice', fallback: 'Legal Notice', cms: 'legal.notice' },
  { to: '/conditions-commerciales', key: 'commercial', fallback: 'Commercial Terms', cms: 'legal.commercial' },
];
const DOCS = LEGAL_DOCS;

/**
 * Admin > Site pages reads a document's own body and version line (the starting
 * text of its editor) by rendering the page to a string inside this context:
 * the layout then renders those two only (no head tags, no layout).
 */
export const LegalBodyOnly = createContext(false);

/** "Article 3 — Data Subjects" becomes "3. Data Subjects" in the list. */
function shortLabel(text: string): string {
  const m = text.match(/^Article\s+(\d+)\s*[—–-]\s*(.+)$/);
  return m ? `${m[1]}. ${m[2]}` : text;
}

export function LegalLayout({
  title,
  version,
  path,
  children,
}: {
  title: string;
  /** "Version of March 6, 2026". */
  version: string;
  /** This document's path, left out of "other documents". */
  path: string;
  children: ReactNode;
}) {
  const { t } = useTranslation();
  const bodyOnly = useContext(LegalBodyOnly);
  const navigate = useNavigate();
  const bodyRef = useRef<HTMLDivElement>(null);
  const [toc, setToc] = useState<{ id: string; label: string }[]>([]);
  const [active, setActive] = useState('');

  // The body M3 published for this document, if any (sanitized: it is HTML).
  const block = useSiteBlock<LegalBlock>(DOCS.find((d) => d.to === path)?.cms ?? '');
  const cmsHtml = useMemo(
    () => (block && typeof block.html === 'string' && block.html.trim() ? DOMPurify.sanitize(block.html) : ''),
    [block],
  );
  const shownVersion = (cmsHtml && typeof block?.version === 'string' && block.version.trim()) || version;

  /** A link to a page of the site inside the published body opens in the app (no full reload). */
  const onBodyClick = (e: ReactMouseEvent<HTMLDivElement>) => {
    if (!cmsHtml || e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    const href = (e.target as Element | null)?.closest?.('a')?.getAttribute('href');
    if (href && href.startsWith('/') && !href.startsWith('//')) {
      e.preventDefault();
      navigate(href);
    }
  };

  // The list comes from the document itself: each <h2> gets an id the list can point to.
  useEffect(() => {
    const body = bodyRef.current;
    if (!body) return;
    const heads = [...body.querySelectorAll<HTMLHeadingElement>('h2')];
    setToc(
      heads.map((h, i) => {
        if (!h.id) h.id = `section-${i + 1}`;
        return { id: h.id, label: shortLabel(h.textContent?.trim() ?? '') };
      }),
    );
    return subscribeScroll(() => {
      let current = '';
      for (const h of heads) {
        if (h.getBoundingClientRect().top <= 140) current = h.id;
        else break;
      }
      setActive((prev) => (prev === current ? prev : current));
    });
  }, [cmsHtml]);

  // Title, description and canonical URL of the document: the table the edge function reads (src/lib/seoMeta.ts).
  if (bodyOnly) {
    return (
      <>
        <p data-legal-version>{version}</p>
        <div data-legal-body>{children}</div>
      </>
    );
  }
  const meta = plainPageMeta(path);
  return (
    <div className="min-h-screen bg-page">
      {meta && <Seo {...meta} />}
      <header className="mx-auto max-w-7xl px-4 pb-8 pt-8 sm:px-6 md:pb-10 md:pt-12">
        <nav aria-label={t('brand.breadcrumb', 'Breadcrumb')} className="text-[14px] leading-5 text-meta">
          <ol className="flex flex-wrap items-center gap-2">
            <li>
              <UnderlineLink to="/" plain arrow={false} className="!text-[14px] !font-normal">
                {t('nav.home', 'Home')}
              </UnderlineLink>
            </li>
            <li aria-hidden="true">/</li>
            <li aria-current="page" className="text-ink">{title}</li>
          </ol>
        </nav>
        <Eyebrow className="mt-8">{t('contentPages.legal.eyebrow', 'Legal')}</Eyebrow>
        <h1 className="mt-3 max-w-3xl text-balance text-h1-sm text-navy sm:text-h1">{title}</h1>
        <p className="mt-3 text-sm text-meta" data-legal-version>{shownVersion}</p>
      </header>

      <div className="mx-auto grid max-w-7xl gap-10 px-4 pb-16 sm:px-6 md:pb-24 lg:grid-cols-12 lg:gap-14">
        {toc.length > 1 && (
          <aside className="hidden lg:col-span-3 lg:block">
            <nav aria-label={t('contentPages.legal.onThisPage', 'On this page')} className="legal-toc lg:sticky lg:top-20">
              <p className="text-meta-caps">{t('contentPages.legal.onThisPage', 'On this page')}</p>
              <ul className="mt-4 border-l border-rule">
                {toc.map((item) => (
                  <li key={item.id}>
                    <a
                      href={`#${item.id}`}
                      aria-current={active === item.id ? 'true' : undefined}
                      className="focus-ring relative block py-1.5 pl-4 text-sm leading-5 text-meta transition-colors hover:text-navy"
                    >
                      {item.label}
                    </a>
                  </li>
                ))}
              </ul>
            </nav>
          </aside>
        )}

        <div className={toc.length > 1 ? 'lg:col-span-9' : 'lg:col-span-12'}>
          <article className="rounded-card border border-rule bg-white p-6 sm:p-10 md:p-12">
            {cmsHtml ? (
              <div
                key="cms"
                ref={bodyRef}
                className="legal-body legal-body--cms"
                data-legal-body
                onClick={onBodyClick}
                dangerouslySetInnerHTML={{ __html: cmsHtml }}
              />
            ) : (
              <div key="code" ref={bodyRef} className="legal-body" data-legal-body>
                {children}
              </div>
            )}
          </article>

          <nav aria-label={t('contentPages.legal.otherDocs', 'Other legal documents')} className="mt-10">
            <p className="text-meta-caps">{t('contentPages.legal.otherDocs', 'Other legal documents')}</p>
            <ul className="mt-4 flex flex-wrap gap-x-8 gap-y-3">
              {DOCS.filter((d) => d.to !== path).map((d) => (
                <li key={d.to}>
                  <UnderlineLink to={d.to} className="text-[15px]">
                    {t(`contentPages.legal.${d.key}`, d.fallback)}
                  </UnderlineLink>
                </li>
              ))}
            </ul>
          </nav>
        </div>
      </div>
    </div>
  );
}
