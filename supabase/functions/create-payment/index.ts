/**
 * create-payment -- Supabase Edge Function. verify_jwt = false (the caller is checked below).
 * Creates a payments row and a SogeCommerce (Lyra) payment form token for it.
 *
 * STAFF ONLY (9 Oct 2026, spec task 0.8). Nothing on the platform calls this function
 * any more: paid membership is gone (the platform is free) and event participation will
 * be paid through its own function, which computes the amount server-side. Before this
 * change ANY caller holding the public anon key could create a payment row for any user,
 * with any amount and any type, which payment-ipn then trusted. Now:
 *   - the caller must be the service role, or a signed-in VERIFIED admin or moderator
 *     (the same test as send-notification and sm_is_staff()); anyone else gets 403;
 *   - the Lyra credentials must be configured: no fallback to Lyra's public demo shop
 *     and key any more (503 "Payments are not configured" and a clear log line);
 *   - the input is checked (type, amount, ids).
 */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const LYRA_API_URL = Deno.env.get('LYRA_API_URL') || 'https://api-sogecommerce.societegenerale.eu/api-payment/V4/Charge/CreatePayment';
const LYRA_SHOP_ID = (Deno.env.get('LYRA_SHOP_ID') || '').trim();
const LYRA_API_PASSWORD = (Deno.env.get('LYRA_API_PASSWORD') || '').trim();

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || '';
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Lyra's documentation keys ("...DEMOPRIVATEKEY..."): public, so never a valid secret. */
const PUBLIC_DEMO_KEY_RE = /DEMOPRIVATEKEY/i;
const PAYMENT_TYPES = new Set(['membership', 'additional_seats', 'event_participation']);
/** 100 000.00 in cents: far above any participation fee, low enough to catch a typo. */
const MAX_AMOUNT_CENTS = 10_000_000;
const MAX_METADATA_CHARS = 4000;

function reply(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } });
}

function sameSecret(a: string, b: string): boolean {
  if (!a || !b) return false;
  const enc = new TextEncoder();
  const x = enc.encode(a);
  const y = enc.encode(b);
  if (x.length !== y.length) return false;
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x[i] ^ y[i];
  return diff === 0;
}

// deno-lint-ignore no-explicit-any
type Db = any;

/** 'service' | 'staff' for the callers allowed here, null for everyone else. */
async function callerKind(req: Request, db: Db): Promise<'service' | 'staff' | null> {
  const bearer = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '').trim();
  if (!bearer) return null;
  if (sameSecret(bearer, SUPABASE_SERVICE_KEY)) return 'service';
  const { data } = await db.auth.getUser(bearer);
  const uid = data?.user?.id;
  if (!uid) return null;
  const { data: profile } = await db
    .from('profiles')
    .select('persona, access_status')
    .eq('user_id', uid)
    .maybeSingle();
  const staff = !!profile && ['admin', 'moderator'].includes(profile.persona || '') && profile.access_status === 'verified';
  return staff ? 'staff' : null;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS_HEADERS });
  }
  if (req.method !== 'POST') return reply({ error: 'Method not allowed' }, 405);

  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    console.error('create-payment: SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY is not set');
    return reply({ error: 'Server not configured' }, 503);
  }

  try {
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, { auth: { persistSession: false } });

    const kind = await callerKind(req, supabase);
    if (!kind) {
      return reply({ error: 'Payments are handled by the M3 team. Please contact events@m3monaco.com.' }, 403);
    }

    if (!LYRA_SHOP_ID || !LYRA_API_PASSWORD || PUBLIC_DEMO_KEY_RE.test(LYRA_API_PASSWORD)) {
      console.error('create-payment REFUSED: LYRA_SHOP_ID / LYRA_API_PASSWORD are not set (or are public demo values). Set them in the Supabase dashboard (Edge Functions > Secrets).');
      return reply({ error: 'Payments are not configured' }, 503);
    }

    const body = await req.json().catch(() => null);
    if (!body || typeof body !== 'object') return reply({ error: 'Invalid JSON body' }, 400);

    const amountCents = Number(body.amount_cents);
    const paymentType = typeof body.payment_type === 'string' ? body.payment_type : '';
    const userId = typeof body.user_id === 'string' ? body.user_id.trim() : '';
    const organizationId = typeof body.organization_id === 'string' && body.organization_id.trim() ? body.organization_id.trim() : null;
    const referenceId = typeof body.reference_id === 'string' && body.reference_id.trim() ? body.reference_id.trim() : null;
    const currency = typeof body.currency === 'string' && body.currency.trim() ? body.currency.trim().toUpperCase() : 'EUR';
    const metadata = body.metadata && typeof body.metadata === 'object' && !Array.isArray(body.metadata) ? body.metadata : {};

    if (!Number.isInteger(amountCents) || amountCents <= 0 || amountCents > MAX_AMOUNT_CENTS) {
      return reply({ error: 'amount_cents must be a whole number of cents, above 0' }, 400);
    }
    if (!PAYMENT_TYPES.has(paymentType)) return reply({ error: 'Unknown payment_type' }, 400);
    if (!UUID_RE.test(userId)) return reply({ error: 'user_id is required' }, 400);
    if (organizationId && !UUID_RE.test(organizationId)) return reply({ error: 'Invalid organization_id' }, 400);
    if (referenceId && !UUID_RE.test(referenceId)) return reply({ error: 'Invalid reference_id' }, 400);
    if (!/^[A-Z]{3}$/.test(currency)) return reply({ error: 'Invalid currency' }, 400);
    if (JSON.stringify(metadata).length > MAX_METADATA_CHARS) return reply({ error: 'metadata is too large' }, 400);

    const { data: paymentRow, error: dbError } = await supabase
      .from('payments')
      .insert({
        user_id: userId,
        organization_id: organizationId,
        payment_type: paymentType,
        amount_cents: amountCents,
        currency,
        status: 'pending',
        reference_type: paymentType,
        reference_id: referenceId,
        metadata: { ...metadata, created_by: kind },
      })
      .select('id')
      .single();

    if (dbError || !paymentRow) {
      console.error('create-payment: DB insert error:', dbError?.message);
      return reply({ error: 'Failed to create payment record' }, 500);
    }

    const credentials = btoa(`${LYRA_SHOP_ID}:${LYRA_API_PASSWORD}`);
    // The orderId IS the payment id: payment-ipn finds the payment from it (and from
    // the metadata). A caller-chosen order id is no longer accepted.
    const lyraPayload = {
      amount: amountCents,
      currency,
      orderId: paymentRow.id,
      formAction: 'PAYMENT',
      customer: { reference: userId },
      metadata: {
        payment_id: paymentRow.id,
        payment_type: paymentType,
        organization_id: organizationId || '',
      },
      ipnTargetUrl: `${SUPABASE_URL}/functions/v1/payment-ipn`,
    };

    const lyraRes = await fetch(LYRA_API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Basic ${credentials}` },
      body: JSON.stringify(lyraPayload),
    });
    const lyraData = await lyraRes.json().catch(() => null);

    if (lyraData?.status !== 'SUCCESS' || !lyraData?.answer?.formToken) {
      console.error('create-payment: Lyra API error:', JSON.stringify(lyraData)?.slice(0, 1000));
      await supabase.from('payments').delete().eq('id', paymentRow.id);
      return reply({ error: 'Payment gateway error', details: lyraData?.answer?.errorMessage || 'Unknown error' }, 502);
    }

    await supabase.from('payments').update({ form_token: lyraData.answer.formToken }).eq('id', paymentRow.id);

    return reply({ formToken: lyraData.answer.formToken, paymentId: paymentRow.id }, 200);
  } catch (err) {
    console.error('create-payment error:', err instanceof Error ? err.message : String(err));
    return reply({ error: 'Internal server error' }, 500);
  }
});
