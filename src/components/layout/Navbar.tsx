import { useState, useEffect, useLayoutEffect, useRef } from 'react';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import * as SheetPrimitive from '@radix-ui/react-dialog';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  DropdownMenuLabel,
  DropdownMenuGroup,
} from '@/components/ui/dropdown-menu';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { LoginForm } from '@/components/auth/LoginForm';
import { SignupForm } from '@/components/auth/SignupForm';
import { readAuthLanding, type AuthLanding } from '@/components/auth/AuthRedirector';
import {
  Menu, X, ChevronDown, Plus, Inbox,
  Building2, UserPlus, LogOut, Settings, Shield, Check, LayoutDashboard,
} from 'lucide-react';
import { toast } from '@/hooks/use-toast';
import { useEntitlements } from '@/hooks/useEntitlements';
import {
  PUBLIC_NAV, MEMBER_NAV, DEAL_FLOW_ITEM, JOIN_ITEM, CREATE_ACTIONS,
  isNavItemActive, canCreate, type NavItem,
} from '@/lib/nav';
import { ACCOUNT_SECTIONS, accountHref, type AccountTab } from '@/lib/accountNav';
import { SITE_IMAGES } from '@/lib/siteMedia';
import { cn } from '@/lib/utils';
import { useMotion } from '@/components/motion/MotionProvider';
import { useHeaderHero } from './headerOverlay';
import { ReadingProgress } from './ReadingProgress';
import { UnderlineLink } from '@/components/brand/UnderlineLink';

/** The avatar menu's shortcuts into the member area — the everyday ones only; the full map is the account menu. */
const AVATAR_TABS: AccountTab[] = ['registrations', 'organization', 'profile', 'notifications'];
const AVATAR_SECTIONS = AVATAR_TABS
  .map((tab) => ACCOUNT_SECTIONS.find((s) => s.value === tab))
  .filter((s): s is (typeof ACCOUNT_SECTIONS)[number] => !!s);

/**
 * Working screens keep the header in place: consoles, the account area, event
 * operations (SM26 is frozen), token links and pages whose own scroll-spy
 * assumes a 64 px header. Everywhere else it tucks away on scroll down.
 */
const PINNED_HEADER_ROUTES = /^\/(admin|sm26|wys26|sponsorship|account|inbox|dashboard|onboarding|organizations|users|investments|submit-|request-webinar|join\/|reset-password|welcome|reference)/;

/** True when the element got focus from the keyboard (not a click, not Radix handing focus back). */
function focusIsVisible(el: EventTarget | null): boolean {
  if (!(el instanceof HTMLElement)) return false;
  try {
    return el.matches(':focus-visible');
  } catch {
    return true; // a browser without :focus-visible: keep the header put, as before
  }
}

/**
 * The site header: a full-width bar fixed at the top of the page (no inset, no
 * rounded corners): 64 px high, 72 px from md.
 *
 *  - Over a registered hero (SplitHero, PageHero at the top of the page) the bar
 *    is transparent with the white logo, wordmark and links at the very top of the
 *    page; the hero is not pushed down. As soon as the page scrolls it turns solid
 *    white with a thin bottom border and a subtle shadow (colour logo). Elsewhere
 *    it is white from the start. The first state of a page is never animated (no
 *    white bar fading out over the hero on load).
 *  - A thin gold reading line runs along its bottom edge (ReadingProgress).
 *  - It tucks away when the reader scrolls down and comes back on scroll up
 *    (translateY, .35 s), but never while KEYBOARD focus is inside it or one of its
 *    menus or dialogs is open, and never under reduced motion. (A mouse click on a
 *    header link leaves that link focused: that must not pin it for the rest of the
 *    visit.) While it is away, --header-h is 0 so the pages' own sticky bars rise
 *    with it.
 *  - Working screens (PINNED_HEADER_ROUTES: consoles, account, SM26…) keep it in
 *    place at 64 px (html[data-header-compact]), because those pages compute their
 *    own offsets from a 64 px header; they have no reading line.
 *  - Visitors get the rolling "Sign up" button: white over the hero (the hero has
 *    its own gold one: one gold action per screen), gold once the bar is white.
 *    Members get Create, Inbox and their avatar menu; admins and moderators
 *    their panel. Under lg the links move to a full-height sheet (focus
 *    trapped, Esc closes, links cascading in 40 ms apart).
 */
export function Navbar() {
  const { t } = useTranslation();
  const { user, profile, signOut, isVerified, isAdmin, isModerator, organization, organizations, setActiveOrganization } = useAuth();
  const { isFeatureEnabled } = useEntitlements();
  const navigate = useNavigate();
  const location = useLocation();
  const { reduced } = useMotion();
  const hero = useHeaderHero();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [loginOpen, setLoginOpen] = useState(false);
  const [signupOpen, setSignupOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const [focusInside, setFocusInside] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const [hidden, setHidden] = useState(false);
  // The home page always opens on its photo hero: start transparent there, so
  // the very first paint is not a white bar that the hero then turns transparent.
  const [heroHint, setHeroHint] = useState(() => location.pathname === '/');
  // Transitions only once a page's first state is painted (two frames after the
  // registered hero last changed): switching pages or registering a hero is instant.
  const [settledFor, setSettledFor] = useState<HTMLElement | null | undefined>(undefined);
  const settled = settledFor === hero;
  const [emailFromConfirmation] = useState('');
  const [confirmationLanding, setConfirmationLanding] = useState<AuthLanding | null>(null);

  // The header must stay put while the reader is using it.
  const pinned = mobileMenuOpen || createOpen || userMenuOpen || loginOpen || signupOpen || focusInside;
  const pinnedRef = useRef(pinned);
  pinnedRef.current = pinned;

  const keepPut = PINNED_HEADER_ROUTES.test(location.pathname);

  // One passive scroll listener, read once per frame: solid/transparent and tuck away/return.
  useEffect(() => {
    let frame = 0;
    let lastY = window.scrollY;
    let travel = 0;
    let hiddenNow = false;
    const update = () => {
      frame = 0;
      const y = window.scrollY;
      setScrolled(y > 8);
      const dy = y - lastY;
      lastY = y;
      if (dy > 0) travel = Math.max(0, travel) + dy;
      else if (dy < 0) travel = Math.min(0, travel) + dy;
      let hide = hiddenNow;
      if (reduced || keepPut || pinnedRef.current || y < 160) hide = false;
      else if (travel > 24) hide = true;
      else if (travel < -24) hide = false;
      if (hide !== hiddenNow) {
        hiddenNow = hide;
        setHidden(hide);
      }
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };
    update();
    window.addEventListener('scroll', schedule, { passive: true });
    window.addEventListener('resize', schedule, { passive: true });
    return () => {
      if (frame) cancelAnimationFrame(frame);
      window.removeEventListener('scroll', schedule);
      window.removeEventListener('resize', schedule);
    };
  }, [reduced, keepPut]);

  useEffect(() => {
    if (pinned) setHidden(false);
  }, [pinned]);

  useEffect(() => {
    let second = 0;
    const first = requestAnimationFrame(() => {
      second = requestAnimationFrame(() => setSettledFor(hero));
    });
    return () => {
      cancelAnimationFrame(first);
      cancelAnimationFrame(second);
    };
  }, [hero]);

  // The hint has done its job once a hero registers; if none does, drop it.
  useEffect(() => {
    if (!heroHint) return;
    if (hero) {
      setHeroHint(false);
      return;
    }
    const timer = window.setTimeout(() => setHeroHint(false), 1500);
    return () => window.clearTimeout(timer);
  }, [hero, heroHint]);

  // Working screens keep a 64 px band (see --header-full in index.css).
  useLayoutEffect(() => {
    const root = document.documentElement;
    if (keepPut) root.setAttribute('data-header-compact', '');
    else root.removeAttribute('data-header-compact');
    return () => root.removeAttribute('data-header-compact');
  }, [keepPut]);

  // Pages' sticky bars follow the header (see .sticky.top-16 in smc-motion.css).
  useEffect(() => {
    const root = document.documentElement;
    if (hidden) root.setAttribute('data-header-hidden', '');
    else root.removeAttribute('data-header-hidden');
    return () => root.removeAttribute('data-header-hidden');
  }, [hidden]);

  // A new page starts with the header in view, and unpinned: a link clicked in
  // the header (or the menu button Radix gives focus back to) keeps focus.
  useEffect(() => {
    setHidden(false);
    setFocusInside(false);
  }, [location.pathname]);

  // Auto-open signup modal when arriving via ?signup=true (e.g. from org_claim_code email link)
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('signup') === 'true') {
      setSignupOpen(true);
    }
  }, [location.search]);

  // Detect email confirmation redirect (only on homepage — /onboarding and
  // /join/:id handle their own), including a failed link (expired / already used)
  useEffect(() => {
    const landing = readAuthLanding();
    if (landing && window.location.pathname === '/') {
      setConfirmationLanding(landing);
      setLoginOpen(true);
      // Clean URL
      window.history.replaceState({}, '', window.location.pathname);
    }
  }, []);

  // Close mobile menu on route change
  useEffect(() => {
    setMobileMenuOpen(false);
  }, [location.pathname]);

  const handleLogout = async () => {
    await signOut();
    toast({ title: t('auth.logoutSuccess') });
    navigate('/', { replace: true });
  };

  // ---------------------------------------------------------------- capabilities
  const isInvestor = profile?.persona === 'investor';
  const createCtx = {
    isVerified,
    orgVerified: organization?.access_status === 'verified',
    persona: profile?.persona,
    isFeatureEnabled,
  };
  const createActions = CREATE_ACTIONS.filter((a) => canCreate(a.capability, createCtx));

  // ---------------------------------------------------------------- nav model
  const navItems: NavItem[] = user
    ? [...MEMBER_NAV, ...(isInvestor ? [DEAL_FLOW_ITEM] : [])]
    : PUBLIC_NAV;

  const displayName = profile?.first_name && profile?.last_name
    ? `${profile.first_name} ${profile.last_name}`
    : user?.email?.split('@')[0] || '';

  const userInitials = profile?.first_name && profile?.last_name
    ? `${profile.first_name[0]}${profile.last_name[0]}`.toUpperCase()
    : displayName.slice(0, 2).toUpperCase();

  const active = (href: string) => isNavItemActive(href, location.pathname);

  // ---------------------------------------------------------------- look
  const overlay = !!hero || heroHint;
  /** White logo and links, no background: over the hero, at the very top of the page. */
  const transparent = overlay && !scrolled && !mobileMenuOpen;
  /** Transitions only once the page's first state is painted. */
  const fade = settled ? 'transition-opacity [transition-duration:0.35s] ease-out-smc' : '';
  const iconBtn = cn(
    'h-10 w-10 p-0 rounded-full transition-colors',
    transparent ? 'text-white/85 hover:bg-white/15 hover:text-white' : 'text-meta hover:bg-chip hover:text-navy',
  );
  /** Under lg the sign-up button loses its round arrow (not enough room). */
  const compactCta = 'max-lg:gap-0 max-lg:pr-4 max-lg:[&_.cta-d]:hidden';

  return (
    <header
      onFocus={(e) => setFocusInside(focusIsVisible(e.target))}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setFocusInside(false);
      }}
      // A zero-height band over a hero (the bar sits on top of it), else the band the bar occupies (64 px on
      // phones and working screens, 72 px from md): only the bar itself takes pointer events.
      className={cn(
        'pointer-events-none sticky top-0 z-50 w-full',
        overlay ? 'h-0' : keepPut ? 'h-16' : 'h-16 md:h-[72px]',
      )}
    >
      <div
        className={cn(
          'pointer-events-auto absolute inset-x-0 top-0',
          keepPut ? 'h-16' : 'h-16 md:h-[72px]',
          settled && 'transition-[transform,color] [transition-duration:0.35s] ease-out-smc',
          transparent ? 'text-white' : 'text-navy',
          hidden && '-translate-y-[150%]',
        )}
      >
        {/* The bar's background fades in and out: white with a thin bottom border and a subtle shadow once the page has scrolled. */}
        <span
          aria-hidden="true"
          className={cn(
            'absolute inset-0 border-b border-rule bg-white shadow-[0_6px_20px_rgba(11,38,83,.07)]',
            fade,
            transparent ? 'opacity-0' : 'opacity-100',
          )}
        />
        {/* The gold reading line along the bar's bottom edge (not on working screens, where the header is pinned). */}
        {!keepPut && <ReadingProgress />}
      <nav aria-label="Main navigation" className="relative h-full">
      <div className="mx-auto h-full max-w-7xl px-4 sm:px-6">
        <div className="flex h-full items-center justify-between gap-2">
          {/* Logo — signed-in members land on their dashboard, visitors on the
              marketing homepage. White over a hero, colour on white. */}
          <Link
            to={user ? '/dashboard' : '/'}
            className="focus-ring flex shrink-0 items-center gap-2.5 rounded-field"
            aria-label="Smart Marina Connect — home"
          >
            <span className="grid h-10 w-[30px] place-items-center [&>img]:col-start-1 [&>img]:row-start-1" aria-hidden="true">
              <img
                src="/logo-color.png"
                alt=""
                className={cn('h-10 w-auto', fade, transparent ? 'opacity-0' : 'opacity-100')}
              />
              <img
                src="/logo-white.png"
                alt=""
                className={cn('h-[34px] w-auto', fade, transparent ? 'opacity-100' : 'opacity-0')}
              />
            </span>
            <span
              className={cn(
                'inline font-wordmark text-[18px] font-semibold tracking-[-0.01em] sm:text-xl',
                settled && 'transition-colors [transition-duration:0.35s]',
                transparent ? 'text-white' : 'text-navy',
              )}
            >
              Smart Marina Connect
            </span>
          </Link>

          {/* Desktop navigation: a gold line grows under the label on hover and focus (and stays under the current page). */}
          <div className="hidden lg:flex lg:items-center lg:gap-7">
            {navItems.map((link) => {
              const on = active(link.href);
              return (
                <UnderlineLink
                  key={link.href}
                  to={link.href}
                  nav
                  aria-current={on ? 'page' : undefined}
                  className={cn(transparent ? (on ? 'text-white' : 'text-white/85 hover:text-white') : on ? 'text-navy' : 'text-ink/75 hover:text-navy')}
                >
                  {t(link.labelKey, link.fallback)}
                </UnderlineLink>
              );
            })}
          </div>

          {/* Right side */}
          <div className="flex shrink-0 items-center gap-1.5">
            {/* Create — the submissions that used to hide under "Actions" in the
                avatar menu. Only drawn when the member can actually do one. */}
            {user && createActions.length > 0 && (
              <DropdownMenu open={createOpen} onOpenChange={setCreateOpen}>
                <DropdownMenuTrigger asChild>
                  <Button variant="ctaNavy" size="sm" arrow={false} roll={false} className="hidden px-4 md:inline-flex">
                    <Plus className="h-4 w-4" aria-hidden="true" />
                    <span>{t('nav.create', 'Create')}</span>
                    <ChevronDown className="h-3.5 w-3.5 opacity-70" aria-hidden="true" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-72 rounded-card border border-rule p-1 shadow-drawer">
                  {createActions.map((a) => {
                    const Icon = a.icon;
                    return (
                      <DropdownMenuItem key={a.href} asChild className="cursor-pointer rounded-field">
                        <Link to={a.href} className="flex items-start gap-3 py-2">
                          <Icon className="mt-0.5 h-4 w-4 shrink-0 text-navy" aria-hidden="true" />
                          <span className="flex flex-col">
                            <span className="text-sm font-medium text-ink">{t(a.labelKey, a.fallback)}</span>
                            <span className="text-xs text-meta">{t(a.descKey, a.descFallback)}</span>
                          </span>
                        </Link>
                      </DropdownMenuItem>
                    );
                  })}
                </DropdownMenuContent>
              </DropdownMenu>
            )}

            {/* Inbox — a first-class destination now, not tab 14 of the account page. */}
            {user && (
              <Button
                variant="ghost"
                size="sm"
                asChild
                className={cn('hidden sm:flex', iconBtn, active('/inbox') && !transparent && 'bg-chip text-navy')}
              >
                <Link to="/inbox" aria-label={t('nav.inbox', 'Inbox')}>
                  <Inbox className="h-[18px] w-[18px]" aria-hidden="true" />
                </Link>
              </Button>
            )}

            {/* Auth buttons / User menu */}
            {user ? (
              <DropdownMenu open={userMenuOpen} onOpenChange={setUserMenuOpen}>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="ghost"
                    className={cn(
                      'flex h-10 items-center gap-2 rounded-full pl-1 pr-2.5',
                      transparent ? 'text-white hover:bg-white/15 hover:text-white' : 'hover:bg-chip',
                    )}
                  >
                    {profile?.avatar_url ? (
                      <img src={profile.avatar_url} alt="" className="h-8 w-8 rounded-full object-cover" />
                    ) : (
                      <div className="flex h-8 w-8 items-center justify-center rounded-full bg-navy text-xs font-bold text-white ring-2 ring-white/70">
                        {userInitials}
                      </div>
                    )}
                    <span className={cn('hidden max-w-[120px] truncate text-sm font-medium xl:inline', transparent ? 'text-white' : 'text-ink')}>{displayName}</span>
                    <ChevronDown className={cn('h-3.5 w-3.5', transparent ? 'text-white/70' : 'text-meta')} aria-hidden="true" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-60 rounded-card border border-rule p-1 shadow-drawer">
                  {/* User info header */}
                  <div className="mb-1 px-3 py-2.5">
                    <p className="truncate text-sm font-semibold text-ink">{displayName}</p>
                    <p className="truncate text-xs text-meta">{user.email}</p>
                  </div>
                  <DropdownMenuSeparator />

                  {/* Active-company switcher — only when the user belongs to more than one */}
                  {organizations.length > 1 && (
                    <>
                      <DropdownMenuLabel className="flex items-center gap-1.5 px-3 text-xs font-normal uppercase tracking-wider text-meta">
                        <Building2 className="h-3 w-3" /> {t('nav.company', 'Company')}
                      </DropdownMenuLabel>
                      <DropdownMenuGroup>
                        {organizations.map(m => (
                          <DropdownMenuItem key={m.organization.id} onClick={() => setActiveOrganization(m.organization.id)} className="cursor-pointer rounded-field">
                            <Check className={`h-4 w-4 mr-2 shrink-0 ${organization?.id === m.organization.id ? 'opacity-100 text-primary' : 'opacity-0'}`} />
                            <span className="truncate">{m.organization.name}</span>
                          </DropdownMenuItem>
                        ))}
                      </DropdownMenuGroup>
                      <DropdownMenuSeparator />
                    </>
                  )}

                  {/* The same names and icons as the account menu (src/lib/accountNav.ts),
                      so "My events" is "My events" everywhere. */}
                  <DropdownMenuGroup>
                    <DropdownMenuItem asChild className="cursor-pointer rounded-field">
                      <Link to={accountHref('dashboard')} className="flex items-center gap-2.5">
                        <LayoutDashboard className="h-4 w-4 text-meta" />
                        {t('nav.dashboard', 'Dashboard')}
                      </Link>
                    </DropdownMenuItem>
                    {AVATAR_SECTIONS.map((s) => (
                      <DropdownMenuItem key={s.value} asChild className="cursor-pointer rounded-field">
                        <Link to={accountHref(s.value)} className="flex items-center gap-2.5">
                          <s.icon className="h-4 w-4 text-meta" />
                          {t(s.labelKey, s.fallback)}
                        </Link>
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuGroup>

                  {/* Admin / Moderator Panel */}
                  {isModerator && (
                    <>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem asChild className="cursor-pointer rounded-field">
                        <Link to="/admin" className="flex items-center gap-2.5">
                          <Shield className="h-4 w-4 text-meta" />
                          {isAdmin ? t('nav.adminPanel') : 'Moderator Panel'}
                        </Link>
                      </DropdownMenuItem>
                    </>
                  )}

                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={handleLogout} className="cursor-pointer rounded-field text-red-600 focus:bg-red-50 focus:text-red-700">
                    <LogOut className="h-4 w-4 mr-2.5" />
                    {t('nav.logout')}
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            ) : (
              <div className="flex items-center gap-1.5 sm:gap-2">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setLoginOpen(true)}
                  className={cn(
                    'hidden h-10 rounded-full px-3.5 text-[15px] font-medium sm:inline-flex',
                    transparent ? 'text-white hover:bg-white/15 hover:text-white' : 'text-ink/80 hover:bg-chip hover:text-navy',
                  )}
                >
                  {t('nav.login')}
                </Button>
                <Button
                  // White over the hero (whose own Sign up is the gold one), gold once the bar is white.
                  variant={transparent ? 'ctaWhite' : 'cta'}
                  size="sm"
                  onClick={() => setSignupOpen(true)}
                  className={compactCta}
                >
                  {t('nav.signup')}
                </Button>
              </div>
            )}

            {/* Mobile menu: a full-height sheet */}
            <SheetPrimitive.Root open={mobileMenuOpen} onOpenChange={setMobileMenuOpen}>
              <SheetPrimitive.Trigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className={cn('h-11 w-11 rounded-full lg:hidden', transparent ? 'text-white hover:bg-white/15 hover:text-white' : 'text-navy hover:bg-chip')}
                  aria-label={mobileMenuOpen ? t('brand.header.closeMenu', 'Close menu') : t('brand.header.openMenu', 'Open menu')}
                >
                  <Menu className="h-5 w-5" aria-hidden="true" />
                </Button>
              </SheetPrimitive.Trigger>
              <SheetPrimitive.Portal>
                <SheetPrimitive.Overlay className="fixed inset-0 z-[60] bg-navy-deep/45 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:animate-in data-[state=open]:fade-in-0 lg:hidden" />
                <SheetPrimitive.Content
                  id="mobile-menu"
                  aria-describedby={undefined}
                  className="fixed inset-y-0 right-0 z-[61] flex w-full max-w-sm flex-col bg-white shadow-drawer duration-300 data-[state=closed]:animate-out data-[state=closed]:slide-out-to-right data-[state=open]:animate-in data-[state=open]:slide-in-from-right motion-reduce:!animate-none lg:hidden"
                >
                  <div className="flex h-16 shrink-0 items-center justify-between border-b border-rule px-4">
                    <SheetPrimitive.Title className="flex items-center gap-2.5">
                      <img src="/logo-color.png" alt="" aria-hidden="true" className="h-9 w-auto" />
                      <span className="font-wordmark text-lg font-semibold text-navy">Smart Marina Connect</span>
                    </SheetPrimitive.Title>
                    <SheetPrimitive.Close asChild>
                      <Button variant="ghost" size="icon" className="h-11 w-11 rounded-full text-navy hover:bg-chip" aria-label={t('brand.header.closeMenu', 'Close menu')}>
                        <X className="h-5 w-5" aria-hidden="true" />
                      </Button>
                    </SheetPrimitive.Close>
                  </div>

                  {/* Every entry carries a one-line description, because on a phone
                      the label alone is what made people guess wrong between
                      Partners, Network and Become a Member. */}
                  <nav aria-label={t('brand.header.mobileNav', 'Menu')} className="flex-1 overflow-y-auto px-3 pb-8 pt-3">
                    <div className="space-y-1">
                      {navItems.map((link, i) => {
                        const Icon = link.icon;
                        const on = active(link.href);
                        return (
                          <Link
                            key={link.href}
                            to={link.href}
                            aria-current={on ? 'page' : undefined}
                            style={{ '--i': i } as React.CSSProperties}
                            className={cn(
                              'sheet-link-in focus-ring flex items-start gap-3 rounded-field px-3 py-2.5 transition-colors',
                              on ? 'bg-chip text-navy' : 'text-ink hover:bg-page',
                            )}
                            onClick={() => setMobileMenuOpen(false)}
                          >
                            <Icon className="mt-0.5 h-5 w-5 shrink-0 text-navy/80" aria-hidden="true" />
                            <span className="flex flex-col">
                              <span className="text-[15px] font-semibold">{t(link.labelKey, link.fallback)}</span>
                              <span className="text-xs text-meta">{t(link.descKey, link.descFallback)}</span>
                            </span>
                          </Link>
                        );
                      })}

                      {/* Signed out: the way in. */}
                      {!user && (
                        <Link
                          to={JOIN_ITEM.href}
                          style={{ '--i': navItems.length } as React.CSSProperties}
                          className="sheet-link-in focus-ring flex items-start gap-3 rounded-field px-3 py-2.5 text-ink hover:bg-page"
                          onClick={() => setMobileMenuOpen(false)}
                        >
                          <UserPlus className="mt-0.5 h-5 w-5 shrink-0 text-navy/80" aria-hidden="true" />
                          <span className="flex flex-col">
                            <span className="text-[15px] font-semibold">{t(JOIN_ITEM.labelKey, JOIN_ITEM.fallback)}</span>
                            <span className="text-xs text-meta">{t(JOIN_ITEM.descKey, JOIN_ITEM.descFallback)}</span>
                          </span>
                        </Link>
                      )}
                    </div>

                    {/* Create actions */}
                    {user && createActions.length > 0 && (
                      <div className="mt-3 border-t border-rule pt-3">
                        <p className="text-meta-caps mb-2 px-3">{t('nav.create', 'Create')}</p>
                        {createActions.map((a) => {
                          const Icon = a.icon;
                          return (
                            <Link
                              key={a.href}
                              to={a.href}
                              className="focus-ring flex items-center gap-3 rounded-field px-3 py-2.5 text-sm text-ink hover:bg-page"
                              onClick={() => setMobileMenuOpen(false)}
                            >
                              <Icon className="h-4 w-4 shrink-0 text-navy" aria-hidden="true" />
                              {t(a.labelKey, a.fallback)}
                            </Link>
                          );
                        })}
                      </div>
                    )}

                    {/* Account & settings */}
                    <div className="mt-3 space-y-1 border-t border-rule pt-3">
                      {user ? (
                        <>
                          <Link to="/inbox" className="focus-ring flex items-center gap-3 rounded-field px-3 py-2.5 text-sm text-ink hover:bg-page" onClick={() => setMobileMenuOpen(false)}>
                            <Inbox className="h-4 w-4 text-meta" />
                            {t('nav.inbox', 'Inbox')}
                          </Link>
                          <Link to="/account?tab=profile" className="focus-ring flex items-center gap-3 rounded-field px-3 py-2.5 text-sm text-ink hover:bg-page" onClick={() => setMobileMenuOpen(false)}>
                            <Settings className="h-4 w-4 text-meta" />
                            {t('nav.myAccount')}
                          </Link>
                          {isModerator && (
                            <Link to="/admin" className="focus-ring flex items-center gap-3 rounded-field px-3 py-2.5 text-sm text-ink hover:bg-page" onClick={() => setMobileMenuOpen(false)}>
                              <Shield className="h-4 w-4 text-meta" />
                              {isAdmin ? t('nav.adminPanel') : 'Moderator Panel'}
                            </Link>
                          )}
                          <button onClick={() => { handleLogout(); setMobileMenuOpen(false); }} className="focus-ring flex w-full items-center gap-3 rounded-field px-3 py-2.5 text-left text-sm text-red-600 hover:bg-red-50">
                            <LogOut className="h-4 w-4" />
                            {t('nav.logout')}
                          </button>
                        </>
                      ) : (
                        <div className="flex gap-2 px-1 pt-3">
                          <Button variant="ctaOutline" size="sm" arrow={false} className="flex-1" onClick={() => { setLoginOpen(true); setMobileMenuOpen(false); }}>
                            {t('nav.login')}
                          </Button>
                          <Button variant="cta" size="sm" arrow={false} className="flex-1" onClick={() => { setSignupOpen(true); setMobileMenuOpen(false); }}>
                            {t('nav.signup')}
                          </Button>
                        </div>
                      )}
                    </div>
                  </nav>
                </SheetPrimitive.Content>
              </SheetPrimitive.Portal>
            </SheetPrimitive.Root>
          </div>
        </div>
      </div>
      </nav>
      </div>

      {/* Login Dialog */}
      <Dialog open={loginOpen} onOpenChange={setLoginOpen}>
        <DialogContent className="rounded-2xl">
          <DialogPhoto src={SITE_IMAGES.homeHero.src} focusY={SITE_IMAGES.homeHero.focusY} />
          <DialogHeader>
            <DialogTitle>{t('auth.login')}</DialogTitle>
            <DialogDescription>
              {t('auth.noAccount')}{' '}
              <button className="text-primary hover:underline font-medium" onClick={() => { setLoginOpen(false); setSignupOpen(true); }}>
                {t('auth.signup')}
              </button>
            </DialogDescription>
          </DialogHeader>
          <LoginForm
            onSuccess={() => setLoginOpen(false)}
            defaultEmail={emailFromConfirmation}
            showConfirmedBanner={confirmationLanding === 'confirmed'}
            linkError={confirmationLanding === 'link-error'}
          />
        </DialogContent>
      </Dialog>

      {/* Signup Dialog */}
      <Dialog open={signupOpen} onOpenChange={setSignupOpen}>
        <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto rounded-2xl">
          <DialogPhoto src={SITE_IMAGES.joinHero.src} focusY={SITE_IMAGES.joinHero.focusY} />
          <DialogHeader>
            <DialogTitle>{t('auth.signup')}</DialogTitle>
            <DialogDescription>
              {t('auth.haveAccount')}{' '}
              <button className="text-primary hover:underline font-medium" onClick={() => { setSignupOpen(false); setLoginOpen(true); }}>
                {t('auth.login')}
              </button>
            </DialogDescription>
          </DialogHeader>
          <SignupForm onSuccess={() => { setSignupOpen(false); navigate('/onboarding'); }} />
        </DialogContent>
      </Dialog>
    </header>
  );
}

/**
 * A photo band across the top of the sign-in and sign-up dialogs: the SM26
 * hall for coming back, a stand conversation for joining. It bleeds to the
 * dialog's edges (the content has 24 px padding) and is purely decorative.
 */
function DialogPhoto({ src, focusY }: { src: string | null; focusY: number }) {
  if (!src) return null;
  return (
    <div aria-hidden="true" className="relative -mx-6 -mt-6 mb-1 h-28 overflow-hidden rounded-t-2xl bg-primary/10">
      <img
        src={src}
        alt=""
        className="h-full w-full object-cover"
        style={{ objectPosition: `50% ${Math.round(focusY * 100)}%` }}
      />
      {/* Lightens the top-right corner so the dialog's dark close (×) stays visible on the photo. */}
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_100%_0%,rgba(255,255,255,0.9)_0,rgba(255,255,255,0)_70px)]" />
    </div>
  );
}
