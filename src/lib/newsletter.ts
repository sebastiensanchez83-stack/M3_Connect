import { supabase } from '@/lib/supabase';

/**
 * Subscribes an address to the Smart Marina Connect newsletter through the
 * `newsletter-subscribe` edge function (Mailchimp, single opt-in: the ticked
 * consent box subscribes the address at once).
 *
 *   POST { email, consent: true, source, website, captcha? }
 *   (captcha: the Cloudflare Turnstile token, sent only when the widget ran)
 *   200 { ok: true } | 400 { error: 'invalid' } | 429 { error: 'rate_limited' } | 500 { error: 'server' }
 *
 * Resolves only on { ok: true }; any other answer throws, and the form says
 * "Subscription failed — please try again later". Nothing is sent by e-mail
 * client and nothing is stored by the site.
 */
export type NewsletterSource = 'footer' | 'home' | 'events' | 'resources' | 'other';

export async function subscribeToNewsletter(
  email: string,
  source: NewsletterSource,
  website = '',
  captcha?: string | null,
): Promise<void> {
  const { data, error } = await supabase.functions.invoke('newsletter-subscribe', {
    body: { email: email.trim(), consent: true, source, website, ...(captcha ? { captcha } : {}) },
  });
  if (error || (data as { ok?: unknown } | null)?.ok !== true) throw new Error('newsletter-subscribe failed');
}
