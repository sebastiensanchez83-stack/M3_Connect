import { useSyncExternalStore } from 'react';

/**
 * Where the floating Help button shows, which three questions it offers on
 * each page, and the reader's choice to hide it (Victor, 10 Oct 2026: "the
 * help centre must be more visible, but not on every page, and with a cross").
 *
 * Kept apart from the button (HelpLauncher.tsx) and its panel so that the
 * help page's "Show the help button again" switch can use it without loading
 * the button. This file loads with every page: it must not import
 * helpContent.ts (the words of the help centre load with the panel only).
 *
 * The question ids are the ones of helpContent.ts: never point at an id that
 * is not there (the panel and the card skip an unknown id silently).
 */

/* ------------------------------------------------------------ hidden for good */

/** localStorage: '1' once the reader pressed the cross next to the button. */
const HIDDEN_KEY = 'smc-help-button-hidden';
const CHANGE_EVENT = 'smc-help-button-change';

/** The choice made in this tab, when the browser refuses to store it (private window, blocked site data). */
let memory: boolean | null = null;

export function readHelpButtonHidden(): boolean {
  if (memory !== null) return memory;
  try {
    return window.localStorage.getItem(HIDDEN_KEY) === '1';
  } catch {
    return false;
  }
}

/** Hide the button for good in this browser (true), or bring it back (false). */
export function setHelpButtonHidden(hidden: boolean): void {
  memory = hidden;
  try {
    if (hidden) window.localStorage.setItem(HIDDEN_KEY, '1');
    else window.localStorage.removeItem(HIDDEN_KEY);
  } catch {
    /* Not stored: the choice holds in this tab only. */
  }
  try {
    window.dispatchEvent(new Event(CHANGE_EVENT));
  } catch {
    /* Very old browsers: the next render reads the new value anyway. */
  }
}

function subscribe(onChange: () => void): () => void {
  const onStorage = (e: StorageEvent) => {
    // Another tab changed it: the stored value is the truth again.
    if (e.key === HIDDEN_KEY || e.key === null) {
      memory = null;
      onChange();
    }
  };
  window.addEventListener(CHANGE_EVENT, onChange);
  window.addEventListener('storage', onStorage);
  return () => {
    window.removeEventListener(CHANGE_EVENT, onChange);
    window.removeEventListener('storage', onStorage);
  };
}

/** Whether the reader hid the Help button, kept in step across the page and the other tabs. */
export function useHelpButtonHidden(): boolean {
  return useSyncExternalStore(subscribe, readHelpButtonHidden, () => false);
}

/* ------------------------------------------------------------ the reader */

export interface HelpReader {
  signedIn: boolean;
  /** Sign-up not finished (onboarding_status 'draft'). */
  draft: boolean;
  pending: boolean;
  rejected: boolean;
  hasOrganization: boolean;
  /** The company is checked by M3. */
  orgVerified: boolean;
  /** The person is approved by M3. */
  verified: boolean;
  /** profiles.persona: marina, developer, partner (service provider), investor, media_partner… */
  persona: string | null;
  /** M3 staff (admin, moderator): every page opens for them. */
  staff: boolean;
}

/* ------------------------------------------------------------ per page */

export interface HelpPlace {
  /** A short name of the place, for tests and data-attributes. */
  key: string;
  /** The three questions offered first, most useful first. */
  ids: string[];
  /**
   * The page holds a form (or a reply being written): the panel's links open
   * in a new tab, so nothing typed is lost.
   */
  keepPage?: boolean;
}

// Signed out on a members' page: the page asks to sign in first.
const SIGN_IN: HelpPlace = { key: 'sign-in', ids: ['account-password', 'account-sign-up', 'emails-missing'] };
const SIGN_UP: HelpPlace = { key: 'sign-up', ids: ['verification-time', 'verification-what', 'developer-or-marina'], keepPage: true };
const MESSAGES: HelpPlace = { key: 'messages', ids: ['messages-files', 'messages-seen', 'messages-emails'], keepPage: true };

/** The home dashboard with no panel open: getting started, or what the account waits for. */
function homePlace(r: HelpReader): HelpPlace {
  if (r.draft) return { key: 'home-draft', ids: ['account-sign-up', 'verification-time', 'developer-or-marina'] };
  if (r.rejected) return { key: 'home-rejected', ids: ['verification-rejected', 'verification-what', 'verification-why'] };
  if (r.pending) return { key: 'home-pending', ids: ['verification-time', 'verification-meanwhile', 'verification-why'] };
  if (!r.hasOrganization) return { key: 'home-no-company', ids: ['no-company-add', 'no-company-can', 'account-dashboard'] };
  if (!r.orgVerified) return { key: 'home-company-checked', ids: ['verification-company', 'company-edit', 'account-dashboard'] };
  return { key: 'home', ids: ['account-dashboard', 'company-edit', 'messages-where'] };
}

/** A tile's panel open on the home dashboard (/?open=<panel>). */
function homePanelPlace(panel: string, r: HelpReader): HelpPlace | null {
  switch (panel) {
    case 'profile': return { key: 'home-profile', ids: ['account-details', 'account-password-rules', 'emails-choose'] };
    case 'company':
      return r.hasOrganization
        ? { key: 'home-company', ids: ['company-edit', 'company-sectors', 'company-owner'] }
        : { key: 'home-company-add', ids: ['no-company-add', 'verification-what', 'no-company-can'] };
    case 'team': return { key: 'home-team', ids: ['company-invite', 'company-places', 'company-join-requests'] };
    case 'registrations': return { key: 'home-events', ids: ['events-join', 'events-cancel', 'events-replay'] };
    case 'inbox': return MESSAGES;
    case 'requests': return { key: 'home-requests', ids: ['publishing-kinds', 'publishing-review', 'publishing-answers'] };
    case 'references': return { key: 'home-references', ids: ['provider-references', 'provider-visibility', 'company-edit'] };
    case 'press': return { key: 'home-press', ids: ['media-press-room', 'media-accreditation', 'events-propose'] };
    case 'shortlist': return { key: 'home-shortlist', ids: ['messages-who', 'messages-connected', 'account-dashboard'] };
    default: return null;
  }
}

/** Only these profiles may publish a tender, an expert question or a project (App.tsx: requirePersona). */
const PUBLISHERS = new Set(['marina', 'developer']);

/** "What can a … do here?" for the reader's profile. */
function canId(persona: string | null): string {
  switch (persona) {
    case 'marina': return 'marina-can';
    case 'developer': return 'developer-can';
    case 'partner': return 'provider-can';
    case 'investor': return 'investor-can';
    case 'media_partner': return 'media-can';
    default: return 'account-dashboard';
  }
}

/**
 * A need being published: the page's questions or, while the page is closed to
 * the reader, who may publish and why not yet. The same locks as the pages:
 * submit-* needs a marina or developer profile (App.tsx requirePersona), a
 * verified person and a verified company (SubmitRFPPage…); proposing a webinar
 * a verified person and company (WebinarRequestPage).
 */
function publishPlace(key: string, ids: string[], r: HelpReader): HelpPlace {
  const webinar = key === 'request-webinar';
  const who = webinar ? 'events-propose' : 'publishing-who';
  // Another profile: being verified would not open this page. Who may, and what this profile can do.
  if (!webinar && !r.staff && !PUBLISHERS.has(r.persona ?? '')) {
    return { key: `${key}-locked`, ids: [who, 'publishing-visible', canId(r.persona)], keepPage: true };
  }
  if (!r.staff && (!r.verified || !r.orgVerified)) {
    const waits = r.verified ? ['verification-company', 'verification-time'] : ['verification-time', 'verification-company'];
    return { key: `${key}-locked`, ids: [who, ...waits], keepPage: true };
  }
  return { key, ids, keepPage: true };
}

/**
 * The Help button's place on this page, or null where it does not show.
 *
 * It shows only where people get stuck (Victor, 10 Oct 2026): the signed-in
 * member home and its panels, sign-up and onboarding, publishing a need or
 * proposing a webinar, messages, /opportunities and an event's page (its
 * registration). Nowhere else: not on the marketing pages, the articles, the
 * company pages, /help itself, admin, /sm26/*, /wys26* or /unsubscribe.
 */
export function helpPlaceFor(pathname: string, search: string, r: HelpReader): HelpPlace | null {
  const path = (pathname.toLowerCase().replace(/\/+$/, '') || '/');
  const params = new URLSearchParams(search);

  // The signed-in member home and the panels it opens in place.
  if (path === '/') {
    if (!r.signedIn) return null;
    const panel = params.get('open');
    return (panel && homePanelPlace(panel, r)) || homePlace(r);
  }

  // Sign-up and onboarding.
  if (path === '/onboarding') return r.signedIn ? SIGN_UP : SIGN_IN;
  if (path === '/account') {
    if (!r.signedIn) return SIGN_IN;
    if (params.get('tab') === 'complete-registration' || r.draft) return SIGN_UP;
    return { key: 'account', ids: ['account-details', 'account-password-rules', 'company-edit'] };
  }
  // A colleague's invitation (/join/<invite id>; /join alone is the presentation page).
  if (/^\/join\/[^/]+$/.test(path)) return { key: 'invitation', ids: ['verification-invited', 'account-password-rules', 'account-several-companies'], keepPage: true };
  // Choosing a password: the e-mailed links (/welcome) and "Forgot password?".
  if (path === '/welcome') return { key: 'welcome', ids: ['account-password-rules', 'verification-time', 'emails-missing'], keepPage: true };
  if (path === '/reset-password') return { key: 'password', ids: ['account-password', 'account-password-rules', 'emails-missing'], keepPage: true };

  // Publishing a need (with or without the id of a draft), proposing a webinar
  // (App.tsx has no /request-webinar/<id>: that address is "Page not found").
  const publish = /^\/(submit-project|submit-rfp|submit-consultation)(\/[^/]+)?$/.exec(path);
  if (publish || path === '/request-webinar') {
    if (!r.signedIn) return SIGN_IN;
    switch (publish?.[1]) {
      case 'submit-project': return publishPlace('submit-project', ['publishing-project', 'publishing-review', 'publishing-who'], r);
      case 'submit-rfp': return publishPlace('submit-rfp', ['publishing-kinds', 'publishing-review', 'publishing-answers'], r);
      case 'submit-consultation': return publishPlace('submit-consultation', ['publishing-kinds', 'publishing-review', 'publishing-visible'], r);
      default: return publishPlace('request-webinar', ['events-propose', 'events-paid', 'events-replay'], r);
    }
  }

  // Messages.
  if (path === '/inbox') return r.signedIn ? MESSAGES : SIGN_IN;

  // The tenders and expert questions: the side that publishes them, the side that answers.
  if (path === '/opportunities') {
    if (!r.signedIn) return { key: 'opportunities-visitor', ids: ['publishing-visible', 'account-sign-up', 'provider-can'] };
    if (PUBLISHERS.has(r.persona ?? '')) return { key: 'opportunities-publisher', ids: ['publishing-answers', 'publishing-visible', 'publishing-change'] };
    // Investors do not see the tenders (database rules): who sees what, and their own Deal flow.
    if (r.persona === 'investor') return { key: 'opportunities-investor', ids: ['publishing-visible', 'investor-deal-flow', 'investor-can'] };
    return { key: 'opportunities', ids: ['provider-answer', 'publishing-visible', 'publishing-kinds'] };
  }

  // An event's page: registering, events by invitation, cancelling. True of a webinar
  // and of an event on site alike (the page does not tell the button which it is).
  if (/^\/events\/[^/]+$/.test(path)) return { key: 'event', ids: ['events-webinar', 'events-invitation', 'events-cancel'] };

  return null;
}
