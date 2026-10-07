import { supabase } from '@/lib/supabase';

/**
 * Sends a message to the M3 team through the `contact-submit` edge function.
 * It stores the message and e-mails events@m3monaco.com.
 *
 * The contract (the function is built and deployed separately):
 *   POST { name (1-120), email, company? (<= 160), subject (one of ContactPage's
 *          SUBJECT_OPTIONS values), message (10-5000), source? (page path),
 *          website? (honeypot, must stay empty) }
 *   200 { ok: true } | 400 { error: 'invalid' } | 429 { error: 'rate_limited' }
 *   | 500 { error: 'server' }
 *
 * "Sent" is only ever `{ ok: true }`: every other outcome is an error the form
 * must say out loud (and offer the e-mail address for). There is no automatic
 * mailto and no silent success.
 */
export interface ContactPayload {
  name: string;
  email: string;
  company?: string;
  subject: string;
  message: string;
  /** The page the message was written on (a path, e.g. "/contact"). */
  source?: string;
  /** The honeypot: a field no person sees. Bots fill it. */
  website?: string;
}

export type ContactResult =
  | { ok: true }
  | { ok: false; reason: 'rate_limited' | 'invalid' | 'server' };

/** Where the visitor is writing from: the path of the current page, never a full URL. */
export function currentSource(): string {
  try {
    return window.location.pathname.slice(0, 200);
  } catch {
    return '';
  }
}

export async function submitContact(payload: ContactPayload): Promise<ContactResult> {
  const body: Record<string, string> = {
    name: payload.name.trim().slice(0, 120),
    email: payload.email.trim(),
    subject: payload.subject,
    message: payload.message.trim().slice(0, 5000),
    website: payload.website ?? '',
  };
  const company = payload.company?.trim();
  if (company) body.company = company.slice(0, 160);
  const source = payload.source ?? currentSource();
  if (source) body.source = source;

  try {
    const { data, error } = await supabase.functions.invoke('contact-submit', { body });
    if (error) {
      // supabase-js wraps a non-2xx answer in FunctionsHttpError, with the
      // Response in `context`: the status says which of the three it was.
      const response = (error as { context?: unknown }).context;
      const status = response instanceof Response ? response.status : 0;
      if (status === 429) return { ok: false, reason: 'rate_limited' };
      if (status === 400) return { ok: false, reason: 'invalid' };
      return { ok: false, reason: 'server' };
    }
    return (data as { ok?: unknown } | null)?.ok === true ? { ok: true } : { ok: false, reason: 'server' };
  } catch {
    return { ok: false, reason: 'server' };
  }
}
