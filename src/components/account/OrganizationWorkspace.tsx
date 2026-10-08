import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import type { LucideIcon } from 'lucide-react';
import { Building2, FileText, ImageIcon, Palette, TrendingUp, Users } from 'lucide-react';
import { OrganizationTab } from '@/components/organization/OrganizationTab';
import { scrollTopUnderBars } from '@/lib/scrollTarget';
import { cn } from '@/lib/utils';

/**
 * The organisation editor (OrganizationTab, one long component with no anchors
 * of its own) with a jump bar: logo & cover, product images, company details,
 * team & invitations (where the domain auto-join setting lives), documents, and
 * capital raise / investment thesis. Moved from the old /account?tab=organization.
 *
 * Nothing is hidden or reordered — the bar only scrolls — so every control
 * stays where it was. Sections are found by the `data-org-section="<key>"`
 * markers of OrganizationTab, and otherwise by its headings; a section that
 * can't be found simply gets no chip. `section=<key>` in the address deep-links
 * to one (/?open=organization&section=team, the dashboard's nudges); an unknown
 * value is ignored.
 *
 * The bar sticks under the site header, which tucks away on scroll down
 * (`.sticky.top-16` follows --header-h, smc-motion.css). None of its ancestors
 * may clip (no overflow-hidden), or it stops sticking.
 */
type OrgSectionKey = 'branding' | 'gallery' | 'details' | 'team' | 'documents' | 'capital' | 'thesis';
const ORG_SECTION_ORDER: OrgSectionKey[] = ['branding', 'gallery', 'details', 'team', 'documents', 'capital', 'thesis'];

/** Where the header's lower edge is right now: 64 or 72 px, 0 while it is tucked away (--header-h). */
function headerBottom(): number {
  if (typeof document === 'undefined') return 64;
  const v = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--header-h'));
  return Number.isFinite(v) && v >= 0 ? v : 64;
}

function findOrgSections(host: HTMLElement, labels: { members: string[]; details: string[] }): Map<OrgSectionKey, HTMLElement> {
  const found = new Map<OrgSectionKey, HTMLElement>();

  // 1. Explicit markers win.
  host.querySelectorAll<HTMLElement>('[data-org-section]').forEach((el) => {
    const key = el.dataset.orgSection as OrgSectionKey;
    if (ORG_SECTION_ORDER.includes(key) && !found.has(key)) found.set(key, el);
  });
  if (found.size > 0) {
    // The gallery and the details sit inside the branding card, without markers of their own.
    const branding = found.get('branding');
    if (branding) addInnerSections(branding, labels, found);
    return found;
  }

  // 2. OrganizationTab's markup without markers: a stack of cards.
  const stack = host.firstElementChild;
  if (!stack) return found;
  const blocks = Array.from(stack.children).filter((el): el is HTMLElement => el instanceof HTMLElement);
  const blockTitled = (titles: string[]) =>
    blocks.find((b) => Array.from(b.querySelectorAll('h3')).some((h) => titles.includes(textOf(h))));

  // The team card only exists once there is an organisation; without it the
  // tab shows the creation form and there is nothing to navigate.
  const team = blockTitled(labels.members);
  if (!team) return found;

  const profileCard = blocks[0];
  if (profileCard && profileCard !== team) {
    found.set('branding', profileCard);
    addInnerSections(profileCard, labels, found);
  }
  found.set('team', team);
  const docs = blockTitled(['Documents']);
  if (docs) found.set('documents', docs);
  const capital = blockTitled(['Capital raise']);
  if (capital) found.set('capital', capital);
  const thesis = blockTitled(['Investment thesis']);
  if (thesis) found.set('thesis', thesis);
  return found;
}

function textOf(el: Element) {
  return (el.textContent ?? '').replace(/\s+/g, ' ').trim();
}

function addInnerSections(profileCard: HTMLElement, labels: { details: string[] }, found: Map<OrgSectionKey, HTMLElement>) {
  const h4s = Array.from(profileCard.querySelectorAll('h4'));
  const galleryHeading = h4s.find((h) => textOf(h) === 'Product images');
  const gallery = galleryHeading?.parentElement?.parentElement ?? null;
  if (gallery && gallery !== profileCard && profileCard.contains(gallery) && !found.has('gallery')) found.set('gallery', gallery);
  // Read-only details or the edit form, whichever is open, follow the gallery.
  const detailsHeading = h4s.find((h) => labels.details.includes(textOf(h)));
  const details = (gallery?.nextElementSibling as HTMLElement | null) ?? detailsHeading?.parentElement ?? null;
  if (details && profileCard.contains(details) && !found.has('details')) found.set('details', details);
}

export function OrganizationWorkspace() {
  const { t } = useTranslation();
  const [searchParams, setSearchParams] = useSearchParams();
  const hostRef = useRef<HTMLDivElement>(null);
  const targetsRef = useRef<Map<OrgSectionKey, HTMLElement>>(new Map());
  const appliedRef = useRef<string | null>(null);
  const [keys, setKeys] = useState<OrgSectionKey[]>([]);
  const [active, setActive] = useState<OrgSectionKey | null>(null);
  const requested = searchParams.get('section');
  const navRef = useRef<HTMLElement>(null);
  const barHeight = useCallback(() => navRef.current?.offsetHeight ?? 56, []);

  const membersLabel = t('org.members', 'Members');
  const detailsLabel = t('org.generalDetails', 'General Details');

  // The same element across renders, so a scroll-spy update never re-renders
  // the (large) organisation form.
  const organizationTab = useMemo(() => <OrganizationTab />, []);

  // Find the sections, and find them again whenever the tab's DOM changes
  // (it loads, the edit form opens, a section appears).
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    let frame = 0;
    const detect = () => {
      frame = 0;
      const found = findOrgSections(host, {
        members: Array.from(new Set([membersLabel, 'Members'])),
        details: Array.from(new Set([detailsLabel, 'General Details'])),
      });
      targetsRef.current = found;
      const next = ORG_SECTION_ORDER.filter((k) => found.has(k));
      setKeys((prev) => (prev.join() === next.join() ? prev : next));
    };
    detect();
    const observer = new MutationObserver(() => { if (!frame) frame = requestAnimationFrame(detect); });
    observer.observe(host, { childList: true, subtree: true });
    return () => {
      observer.disconnect();
      if (frame) cancelAnimationFrame(frame);
    };
  }, [membersLabel, detailsLabel]);

  // Scroll-spy: the chip of the section under the bar is the current one.
  useEffect(() => {
    if (keys.length === 0) return;
    let frame = 0;
    const update = () => {
      frame = 0;
      const host = hostRef.current;
      // Only while the workspace is on screen: elsewhere on the home page the bar is not stuck.
      if (!host) return;
      let current: OrgSectionKey = keys[0];
      const line = headerBottom() + barHeight() + 20;
      const hostBottom = host.getBoundingClientRect().bottom;
      if (hostBottom <= window.innerHeight + 2 && hostBottom > line) {
        current = keys[keys.length - 1];
      } else {
        for (const k of keys) {
          const el = targetsRef.current.get(k);
          if (el && el.getBoundingClientRect().top <= line) current = k;
        }
      }
      setActive(current);
    };
    const onScroll = () => { if (!frame) frame = requestAnimationFrame(update); };
    update();
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);
    return () => {
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
      if (frame) cancelAnimationFrame(frame);
    };
  }, [keys, barHeight]);

  // On a phone the bar scrolls sideways: keep the current chip in view.
  const chipsRef = useRef<HTMLUListElement>(null);
  useEffect(() => {
    const list = chipsRef.current;
    if (!list || !active || list.scrollWidth <= list.clientWidth) return;
    const chip = list.querySelector<HTMLElement>(`[data-org-chip="${active}"]`);
    if (!chip) return;
    // The list is `relative`, so offsetLeft is measured from its own edge.
    const left = chip.offsetLeft;
    if (left < list.scrollLeft || left + chip.offsetWidth > list.scrollLeft + list.clientWidth) {
      list.scrollTo({ left: Math.max(0, left - 16) });
    }
  }, [active]);

  const jumpTo = useCallback((key: OrgSectionKey, behavior: ScrollBehavior) => {
    const el = targetsRef.current.get(key);
    if (!el) return;
    const reduce = typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    window.scrollTo({ top: scrollTopUnderBars(el, barHeight(), 12), behavior: reduce ? 'auto' : behavior });
    setActive(key);
  }, [barHeight]);

  // A deep link (section=team) is honoured once its section exists.
  useEffect(() => {
    if (!requested || appliedRef.current === requested) return;
    if (!keys.includes(requested as OrgSectionKey)) return;
    appliedRef.current = requested;
    jumpTo(requested as OrgSectionKey, 'smooth');
  }, [requested, keys, jumpTo]);

  const pick = (key: OrgSectionKey) => {
    appliedRef.current = key;
    jumpTo(key, 'smooth');
    // Shareable, but a scroll position is not worth a history entry.
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.set('section', key);
      return next;
    }, { replace: true });
  };

  const meta: Record<OrgSectionKey, { label: string; icon: LucideIcon }> = {
    branding: { label: t('accountArea.org.branding', 'Logo & cover'), icon: Palette },
    gallery: { label: t('accountArea.org.gallery', 'Product images'), icon: ImageIcon },
    details: { label: t('accountArea.org.details', 'Company details'), icon: Building2 },
    team: { label: t('accountArea.org.team', 'Team & invitations'), icon: Users },
    documents: { label: t('accountArea.org.documents', 'Documents'), icon: FileText },
    capital: { label: t('accountArea.org.capital', 'Capital raise'), icon: TrendingUp },
    thesis: { label: t('accountArea.org.thesis', 'Investment thesis'), icon: TrendingUp },
  };

  return (
    <div>
      {keys.length > 1 && (
        <nav
          ref={navRef}
          aria-label={t('accountArea.org.subnavLabel', 'Organisation sections')}
          className="sticky top-16 z-20 -mx-4 mb-4 border-b border-rule bg-page/95 px-3 py-1 backdrop-blur-sm sm:mx-0 sm:rounded-card sm:border sm:bg-white/95 sm:px-1"
        >
          {/* One scrolling row on touch screens; wraps from lg. The padding keeps
              focus rings from being clipped by the scroll box. */}
          <ul ref={chipsRef} className="no-scrollbar relative flex gap-2 overflow-x-auto p-1 lg:flex-wrap lg:overflow-visible">
            {keys.map((k) => {
              const Icon = meta[k].icon;
              const isActive = active === k;
              return (
                <li key={k} data-org-chip={k} className="shrink-0">
                  <button
                    type="button"
                    onClick={() => pick(k)}
                    aria-current={isActive ? 'true' : undefined}
                    className={cn(
                      'inline-flex min-h-10 items-center gap-1.5 whitespace-nowrap rounded-pill px-3.5 text-[14px] font-medium transition-colors',
                      'focus:outline-none focus-visible:shadow-focus',
                      isActive ? 'bg-navy text-white' : 'bg-white text-ink ring-1 ring-rule hover:bg-chip sm:bg-chip sm:ring-0 sm:hover:bg-rule',
                    )}
                  >
                    <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                    {meta[k].label}
                  </button>
                </li>
              );
            })}
          </ul>
        </nav>
      )}
      <div ref={hostRef}>{organizationTab}</div>
    </div>
  );
}
