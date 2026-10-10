import { supabase } from '@/lib/supabase';

/**
 * Rights per company type (Victor, 6-9 Oct 2026; spec regspec-en.md §9).
 *
 * A verified person gets the rights of every validated, typed company they belong
 * to, plus the "participant" set (propose a webinar). A suspended, pending or
 * untyped company counts as none. M3 staff keep everything. The table lives in the
 * database (org_type_capability); my_capabilities() says what the signed-in person
 * has, for them as a whole and through each of their companies:
 *
 *   type            publish  see opps   answer  message    propose  deal
 *                    needs               needs   companies  webinar  flow
 *   marina          yes      read-only  no      yes        yes      no
 *   partner         no       yes        yes     yes        yes      no
 *   investor        no       yes        yes     yes        yes      yes
 *   developer       yes      yes        yes     yes        yes      no
 *   media_partner   no       yes        yes     yes        yes      no
 *   participant     no       no         no      no         yes      no
 *
 * SHADOW MODE. The switch platform_settings.registration_flags.capabilities_enforced
 * is off: every screen keeps today's checks (persona, active company) and nothing
 * here is read. When M3 applies the held migration
 * (supabase/migrations/held/capabilities_enforce.sql), the database enforces the
 * table and turns the switch on in the same step; the screens then ask can().
 *
 * One exception is live already: proposing a webinar is open to every person M3
 * verified, company or not (Victor, 9 Oct 2026; the database allows it since then).
 *
 * The flag is read here rather than in src/lib/flags.ts, which the registration
 * work adds on its own branch: same row, same reading (only a literal true turns it
 * on; a missing row, a failed read or another value means off).
 */

export const CAPABILITIES = [
  'publish_needs',
  'see_opportunities',
  'answer_needs',
  'message_companies',
  'propose_webinar',
  'see_dealflow',
] as const;

export type Capability = typeof CAPABILITIES[number];

/** What each capability means, in the words of the admin Rights page. */
export const CAPABILITY_LABELS: Record<Capability, { label: string; hint: string }> = {
  publish_needs: { label: 'Publish needs', hint: 'RFPs, consultations and projects' },
  see_opportunities: { label: 'See opportunities', hint: 'The needs other companies publish' },
  answer_needs: { label: 'Answer needs', hint: 'Express interest in an RFP or a consultation' },
  message_companies: { label: 'Message companies', hint: 'A first message or a connection request' },
  propose_webinar: { label: 'Propose a webinar', hint: 'Any person M3 verified' },
  see_dealflow: { label: 'Deal flow', hint: 'Companies looking for capital' },
};

/** The org_type values of org_type_capability, in the order the admin page shows them. */
export const CAPABILITY_ORG_TYPES = ['marina', 'partner', 'investor', 'developer', 'media_partner', 'participant', 'pending'] as const;
export type CapabilityOrgType = typeof CAPABILITY_ORG_TYPES[number];

export const CAPABILITY_ORG_TYPE_LABELS: Record<CapabilityOrgType, string> = {
  marina: 'Marina',
  partner: 'Service provider',
  investor: 'Investor',
  developer: 'Developer',
  media_partner: 'Media',
  participant: 'Participant',
  pending: 'Not verified yet',
};

export interface CapabilityCompany {
  id: string;
  name: string | null;
  type: string | null;
  status: string | null;
  /** What this company gives the person (empty when it is not validated or has no type). */
  caps: string[];
}

export interface CapabilitySnapshot {
  personStatus: string | null;
  isStaff: boolean;
  companies: CapabilityCompany[];
  /** The person as a whole: every company's rights plus the participant set. */
  caps: string[];
}

const asStrings = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];

/** Reads my_capabilities()'s JSON; anything unexpected gives null (no right). */
export function parseCapabilities(raw: unknown): CapabilitySnapshot | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  const companies = Array.isArray(o.companies)
    ? o.companies
      .filter((c): c is Record<string, unknown> => !!c && typeof c === 'object' && typeof (c as Record<string, unknown>).id === 'string')
      .map((c) => ({
        id: c.id as string,
        name: typeof c.name === 'string' ? c.name : null,
        type: typeof c.type === 'string' ? c.type : null,
        status: typeof c.status === 'string' ? c.status : null,
        caps: asStrings(c.caps),
      }))
    : [];
  return {
    personStatus: typeof o.person_status === 'string' ? o.person_status : null,
    isStaff: o.is_staff === true,
    companies,
    caps: asStrings(o.caps),
  };
}

/**
 * The signed-in person's rights, or null (signed out, offline, before the
 * migration, or no answer within six seconds: a page never waits longer).
 */
export async function fetchMyCapabilities(): Promise<CapabilitySnapshot | null> {
  const read = (async () => {
    try {
      const { data, error } = await supabase.rpc('my_capabilities');
      if (error) return null;
      return parseCapabilities(data);
    } catch {
      return null;
    }
  })();
  return withTimeout(read, 6000, null);
}

/**
 * Whether a snapshot allows a capability: for the person as a whole, or through
 * one company of theirs when `orgId` is given (the company a need is published
 * for, the company a message is sent from).
 */
export function capabilityAllows(snapshot: CapabilitySnapshot | null, cap: Capability, orgId?: string | null): boolean {
  if (!snapshot) return false;
  if (snapshot.isStaff) return true;
  if (orgId) {
    const company = snapshot.companies.find((c) => c.id === orgId);
    return !!company && company.caps.includes(cap);
  }
  return snapshot.caps.includes(cap);
}

/* ------------------------------------------------------------------ the switch */

const FLAG_TTL_MS = 5 * 60 * 1000;
/**
 * How long a page waits for the switch before deciding it is off. A read that
 * hangs (the auth lock after a tab comes back, a bad connection) must never keep
 * a page on its loader: while the switch is off, nothing depends on it.
 */
const FLAG_TIMEOUT_MS = 4000;
let flagCache: { at: number; value: boolean } | null = null;
let flagInflight: Promise<boolean | null> | null = null;

/** `p`, or `fallback` once `ms` have passed or when it fails. Never rejects. */
function withTimeout<T>(p: PromiseLike<T>, ms: number, fallback: T): Promise<T> {
  return new Promise<T>((resolve) => {
    const timer = setTimeout(() => resolve(fallback), ms);
    Promise.resolve(p).then(
      (v) => { clearTimeout(timer); resolve(v); },
      () => { clearTimeout(timer); resolve(fallback); },
    );
  });
}

/**
 * registration_flags.capabilities_enforced: true or false, or null when it could
 * not be read (error, or no answer within four seconds). Only a successful read
 * is kept, five minutes (as src/lib/flags.ts of the registration work): after a
 * failure the next caller asks again. Only a literal true is on; a missing row
 * or any other value is off.
 */
export function readCapabilitiesEnforced(force = false): Promise<boolean | null> {
  if (!force && flagCache && Date.now() - flagCache.at < FLAG_TTL_MS) return Promise.resolve(flagCache.value);
  if (flagInflight) return flagInflight;
  const read = (async (): Promise<boolean | null> => {
    try {
      const { data, error } = await supabase
        .from('platform_settings')
        .select('value')
        .eq('key', 'registration_flags')
        .maybeSingle();
      if (error) return null;
      const v = (data as { value?: unknown } | null)?.value;
      const on = !!v && typeof v === 'object' && !Array.isArray(v)
        && (v as Record<string, unknown>).capabilities_enforced === true;
      flagCache = { at: Date.now(), value: on };
      return on;
    } catch {
      return null;
    }
  })();
  const inflight = withTimeout(read, FLAG_TIMEOUT_MS, null).finally(() => {
    if (flagInflight === inflight) flagInflight = null;
  });
  flagInflight = inflight;
  return inflight;
}

/** The switch, a failed read counting as off. Never rejects. */
export async function loadCapabilitiesEnforced(force = false): Promise<boolean> {
  return (await readCapabilitiesEnforced(force)) === true;
}

/* ------------------------------------------------------------------ outside React */

export interface CapabilityGate {
  /** The switch is on: screens gate with can() instead of today's checks. */
  enforced: boolean;
  /** The switch and (when it is on) the person's rights are known. */
  ready: boolean;
  can: (cap: Capability, orgId?: string | null) => boolean;
}

let currentGate: CapabilityGate = { enforced: false, ready: false, can: () => false };

/**
 * Kept up to date by AuthProvider while it renders, so helpers that are not hooks
 * (canCreate in src/lib/nav.ts) see the same answer as useAuth().can in the same
 * render: every caller of those helpers reads useAuth() and re-renders with it.
 */
export function setCapabilityGate(gate: CapabilityGate): void {
  currentGate = gate;
}

export function capabilityGate(): CapabilityGate {
  return currentGate;
}
