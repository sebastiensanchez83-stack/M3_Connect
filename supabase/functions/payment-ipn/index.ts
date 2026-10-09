/**
 * payment-ipn -- Supabase Edge Function. verify_jwt = false: Lyra cannot send a JWT;
 * the HMAC signature below is the only proof that a call comes from Lyra.
 *
 * Receives the IPN (Instant Payment Notification) of SogeCommerce / Lyra, REST API V4:
 *   POST /functions/v1/payment-ipn
 *   Content-Type: application/x-www-form-urlencoded
 *   Body: kr-hash, kr-hash-algorithm, kr-hash-key, kr-answer (JSON of the V4 Payment)
 *
 * What changed (reliability pass before WYS, 9 Oct 2026):
 *
 *  1. FAILS CLOSED. The key used to fall back to Lyra's PUBLIC demo key when the
 *     secret was missing, so anyone could sign a fake "PAID" notification. Now:
 *       - only a server-to-server IPN is accepted: kr-hash-key "password", signed
 *         with LYRA_API_PASSWORD. A browser-return payload (kr-hash-key
 *         "sha256_hmac") is refused with 400: nothing on the platform posts one
 *         here, and accepting it would only widen what a mis-set key lets through;
 *       - LYRA_SHOP_ID and LYRA_API_PASSWORD must be set (and the password must not
 *         be one of Lyra's public demo keys), else 503 and a clear log line;
 *       - the notification must be for M3's shop (answer.shopId = LYRA_SHOP_ID) and
 *         in the expected mode: PRODUCTION unless LYRA_MODE is TEST (an unset mode
 *         counts as PRODUCTION). Anything else is acknowledged and ignored.
 *     Lyra re-sends a refused (non-2xx) IPN a few times over about an hour, ONLY if
 *     "automatic retry" is on for the IPN rule in the Lyra back office. Any other
 *     algorithm: 400. The signature is compared in constant time.
 *
 *  2. E-MAILS ARE SENT. The confirmation used to go to send-notification with the
 *     anon key and no Authorization header, which send-notification refuses (401),
 *     so no payment e-mail ever went out. It now calls send-notification as the
 *     SERVICE caller (Authorization: Bearer <service-role key>, the rule documented
 *     in send-notification: "service -- another edge function holding the
 *     service-role key"). Paid -> payment_confirmed; failed for good -> payment_failed.
 *
 *  3. IDEMPOTENT. Lyra re-sends an IPN until it gets a 2xx, and may send several for
 *     one order. Two guards:
 *       - the status only moves through a conditional UPDATE (from pending / failed /
 *         cancelled; never away from paid or refunded), so the side effects (the
 *         event registration marked paid) run once, for the request that made the
 *         change;
 *       - at most ONE e-mail per (payment id, status): the e-mail is sent only by the
 *         request that inserts that key into public.payment_email_log (primary key
 *         (payment_id, status); migration 20261009180000_payment_email_log.sql). If
 *         the e-mail cannot be sent for a passing reason, the key is released and the
 *         IPN answered 500 so that Lyra's retry sends it; the retry changes nothing
 *         else. Without the table (migration not applied yet) no payment e-mail is
 *         sent, the log says so and the IPN is answered 503, so that a retry after
 *         the migration sends it: never a duplicate.
 *       - if marking the event registration paid fails, the payment is put back to
 *         its previous status and the IPN answered 500, so that the retry redoes
 *         both; if even that fails, M3's admins are alerted.
 *
 *  4. THE AMOUNT COMES FROM THE DATABASE. The e-mail shows payments.amount_cents and
 *     payments.currency. The amount Lyra reports is only compared with them: a "PAID"
 *     notification whose amount or currency differs is NOT applied (the payment stays
 *     as it was, the mismatch is kept in payments.metadata.ipn_mismatch) and M3's
 *     admins get an e-mail (notify-admins), since the customer has been charged.
 *
 *  5. NO AUTOMATIC RIGHTS. The platform is free (Victor, 6 Oct 2026) and M3 validates
 *     every company and person: the old "membership" branch (organisation and every
 *     member verified on payment) and the "additional_seats" branch (max_seats raised
 *     by a number taken from the payment's metadata) are gone. Such a payment is still
 *     recorded as paid and e-mailed; M3 acts on it by hand. Only "event_participation"
 *     keeps its effect: the linked event_registrations row is marked paid.
 *
 * Unknown payment, no payment id, a refund or an in-between status (RUNNING, ...):
 * answered 200 and logged, since a retry would not change anything.
 */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || '';
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
// Lyra signs an IPN with the REST API password of the shop (the one create-payment
// uses for Basic auth). LYRA_HMAC_KEY (browser returns) is not used here.
const LYRA_API_PASSWORD = (Deno.env.get('LYRA_API_PASSWORD') || '').trim();
const LYRA_SHOP_ID = (Deno.env.get('LYRA_SHOP_ID') || '').trim();
// PRODUCTION unless explicitly TEST: an unset or mistyped mode never lets a TEST
// notification mark a payment paid.
const EXPECTED_MODE = (Deno.env.get('LYRA_MODE') || '').trim().toUpperCase() === 'TEST' ? 'TEST' : 'PRODUCTION';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Lyra's documentation keys ("...DEMOPRIVATEKEY..."): public, so never a valid secret. */
const PUBLIC_DEMO_KEY_RE = /DEMOPRIVATEKEY/i;
const EMAIL_LOG_TABLE = 'payment_email_log';

type Status = 'pending' | 'paid' | 'failed' | 'cancelled' | 'refunded';

function text(body: string, status: number): Response {
  return new Response(body, { status, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
}

/** The IPN signing secret, or null (missing / public demo key). */
function ipnKey(): string | null {
  if (!LYRA_API_PASSWORD || PUBLIC_DEMO_KEY_RE.test(LYRA_API_PASSWORD)) return null;
  return LYRA_API_PASSWORD;
}

/** Only what a reference looks like (ids, amounts, currency codes): safe in any e-mail. */
function plain(value: unknown, max = 100): string {
  return String(value ?? '').replace(/[^0-9A-Za-z._:-]/g, '').slice(0, max);
}

/**
 * An e-mail to M3's admins (and the contact inbox) through notify-admins, as the
 * service caller. Awaited, but never throws: the IPN answer does not depend on it.
 */
async function alertM3(subject: string, details: string[]): Promise<void> {
  try {
    const res = await fetch(`${SUPABASE_URL}/functions/v1/notify-admins`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
        apikey: SUPABASE_SERVICE_KEY,
      },
      body: JSON.stringify({
        submission_type: subject,
        submitter: 'Payment notifications (payment-ipn)',
        details: details.join('\n'),
        include_contact_inbox: true,
      }),
    });
    if (!res.ok) console.error(`IPN: admin alert "${subject}" not sent (${res.status}): ${(await res.text().catch(() => '')).slice(0, 200)}`);
  } catch (e) {
    console.error(`IPN: admin alert "${subject}" not sent:`, e instanceof Error ? e.message : String(e));
  }
}

function sameText(a: string, b: string): boolean {
  const enc = new TextEncoder();
  const x = enc.encode(a);
  const y = enc.encode(b);
  if (x.length !== y.length) return false;
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x[i] ^ y[i];
  return diff === 0;
}

async function hmacHex(key: string, message: string): Promise<string> {
  const enc = new TextEncoder();
  const cryptoKey = await crypto.subtle.importKey('raw', enc.encode(key), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', cryptoKey, enc.encode(message));
  return Array.from(new Uint8Array(sig), (b) => b.toString(16).padStart(2, '0')).join('');
}

// deno-lint-ignore no-explicit-any
type Json = any;

/** The payment id this order was created with (create-payment puts it in the metadata and uses it as orderId). */
function paymentIdOf(answer: Json): string | null {
  const firstTx = Array.isArray(answer?.transactions) ? answer.transactions[0] : null;
  const candidates = [
    answer?.metadata?.payment_id,
    answer?.orderDetails?.metadata?.payment_id,
    firstTx?.metadata?.payment_id,
    answer?.orderDetails?.orderId,
  ];
  for (const c of candidates) {
    if (typeof c === 'string' && UUID_RE.test(c.trim())) return c.trim().toLowerCase();
  }
  return null;
}

/** Lyra's order status as ours; null = nothing to record (RUNNING, PARTIALLY_PAID, ...). */
function targetStatus(orderStatus: unknown): Status | null {
  switch (String(orderStatus || '').toUpperCase()) {
    case 'PAID': return 'paid';
    case 'UNPAID': return 'failed';
    case 'ABANDONED':
    case 'CANCELLED': return 'cancelled';
    default: return null;
  }
}

function formatAmount(cents: number, currency: string): string {
  const cur = (currency || 'EUR').toUpperCase();
  try {
    return new Intl.NumberFormat('en-GB', { style: 'currency', currency: cur }).format(cents / 100);
  } catch {
    return `${(cents / 100).toFixed(2)} ${cur}`;
  }
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return text('Method not allowed', 405);

  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    console.error('IPN refused: SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY is not set');
    return text('Server not configured', 503);
  }

  // ── 1. Read and verify the signature ──────────────────────────────────────
  let krHash = '';
  let krHashAlgorithm = '';
  let krAnswer = '';
  let krHashKey = '';
  try {
    const contentType = req.headers.get('content-type') || '';
    if (contentType.includes('application/x-www-form-urlencoded') || contentType.includes('multipart/form-data')) {
      const form = await req.formData();
      krHash = String(form.get('kr-hash') ?? '');
      krHashAlgorithm = String(form.get('kr-hash-algorithm') ?? '');
      krAnswer = String(form.get('kr-answer') ?? '');
      krHashKey = String(form.get('kr-hash-key') ?? '');
    } else {
      const body = await req.json();
      krHash = String(body?.['kr-hash'] ?? '');
      krHashAlgorithm = String(body?.['kr-hash-algorithm'] ?? '');
      krAnswer = String(body?.['kr-answer'] ?? '');
      krHashKey = String(body?.['kr-hash-key'] ?? '');
    }
  } catch {
    console.error('IPN refused: unreadable body');
    return text('Bad Request', 400);
  }

  if (!krAnswer || !krHash) {
    console.error('IPN refused: kr-answer or kr-hash missing');
    return text('Bad Request', 400);
  }
  if (krHashAlgorithm.toLowerCase() !== 'sha256_hmac') {
    console.error(`IPN refused: unsupported kr-hash-algorithm "${krHashAlgorithm.slice(0, 40)}"`);
    return text('Bad Request', 400);
  }
  if (krHashKey !== 'password') {
    // "sha256_hmac" is a browser-return payload: never posted here by the platform.
    console.error(`IPN refused: kr-hash-key "${krHashKey.slice(0, 40)}" (only server-to-server IPNs, kr-hash-key "password", are accepted)`);
    return text('Bad Request', 400);
  }
  const key = ipnKey();
  if (!key || !LYRA_SHOP_ID) {
    const missing = [!key ? 'LYRA_API_PASSWORD (missing or a public demo key)' : '', !LYRA_SHOP_ID ? 'LYRA_SHOP_ID' : ''].filter(Boolean).join(' and ');
    console.error(`IPN REFUSED: ${missing} not set. Set it in the Supabase dashboard (Edge Functions > Secrets); Lyra retries this notification only if automatic retry is on in its back office.`);
    return text('Payment notifications are not configured', 503);
  }
  const computed = await hmacHex(key, krAnswer);
  if (!sameText(computed, krHash.trim().toLowerCase())) {
    console.error('IPN refused: invalid signature');
    return text('Invalid signature', 403);
  }

  // ── 2. What the notification says (signed by Lyra from here on) ────────────
  let answer: Json;
  try {
    answer = JSON.parse(krAnswer);
  } catch {
    console.error('IPN refused: kr-answer is not JSON');
    return text('Bad Request', 400);
  }

  const paymentId = paymentIdOf(answer);
  if (!paymentId) {
    console.warn('IPN ignored: no payment id in the order (not created by create-payment)');
    return text('Ignored', 200);
  }
  const answerShop = plain(answer?.shopId, 40);
  if (answerShop && answerShop !== LYRA_SHOP_ID) {
    console.error(`IPN ignored for payment ${paymentId}: notification for shop ${answerShop}, not LYRA_SHOP_ID`);
    return text('Ignored', 200);
  }
  if (!answerShop) console.warn(`IPN for payment ${paymentId}: no shopId in the answer (signature checked with this shop's password)`);
  const answerMode = String(answer?.orderDetails?.mode || '').toUpperCase();
  if (answerMode && answerMode !== EXPECTED_MODE) {
    console.warn(`IPN ignored for payment ${paymentId}: ${plain(answerMode, 20)}-mode notification, ${EXPECTED_MODE} expected (LYRA_MODE)`);
    return text('Ignored', 200);
  }
  const transactions: Json[] = Array.isArray(answer?.transactions) ? answer.transactions : [];
  const firstTx: Json = transactions[0] || {};
  if (String(firstTx?.operationType || '').toUpperCase() === 'CREDIT') {
    console.warn(`IPN ignored for payment ${paymentId}: refund (CREDIT) notification, handled by M3 by hand`);
    return text('Ignored', 200);
  }
  const target = targetStatus(answer?.orderStatus);
  // UNPAID while the order is still OPEN = one refused attempt; the buyer may retry.
  const finalOrder = String(answer?.orderCycle || 'CLOSED').toUpperCase() !== 'OPEN';
  const txUuid = typeof firstTx?.uuid === 'string' ? firstTx.uuid.slice(0, 100) : '';
  const txId = typeof firstTx?.transactionDetails?.cardDetails?.legacyTransId === 'string'
    ? firstTx.transactionDetails.cardDetails.legacyTransId.slice(0, 100)
    : '';
  const reportedCents = Number(answer?.orderDetails?.orderTotalAmount ?? firstTx?.amount);
  const reportedCurrency = String(answer?.orderDetails?.orderCurrency ?? firstTx?.currency ?? '').toUpperCase();

  const db = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, { auth: { persistSession: false } });

  const { data: payment, error: loadError } = await db
    .from('payments')
    .select('id, user_id, payment_type, amount_cents, currency, status, paid_at, reference_id, reference_type, metadata')
    .eq('id', paymentId)
    .maybeSingle();
  if (loadError) {
    console.error(`IPN: could not read payment ${paymentId}:`, loadError.message);
    return text('DB error', 500);
  }
  if (!payment) {
    console.warn(`IPN ignored: payment ${paymentId} does not exist`);
    return text('Ignored', 200);
  }
  if (!target) {
    console.log(`IPN: payment ${paymentId} order status "${String(answer?.orderStatus || '').slice(0, 40)}" recorded nowhere (in progress)`);
    return text('OK', 200);
  }

  // ── 3. The amount is the database's; Lyra's must match it to count as paid ─
  if (target === 'paid') {
    const dbCurrency = String(payment.currency || 'EUR').toUpperCase();
    if (!Number.isInteger(reportedCents) || reportedCents !== payment.amount_cents || reportedCurrency !== dbCurrency) {
      console.error(`IPN AMOUNT MISMATCH for payment ${paymentId}: Lyra reports ${reportedCents} ${reportedCurrency}, the database expects ${payment.amount_cents} ${dbCurrency}. Not marked paid; M3 must review it.`);
      const meta = (payment.metadata && typeof payment.metadata === 'object' && !Array.isArray(payment.metadata)) ? payment.metadata : {};
      // The same transaction reported again (a second IPN for it): M3 already knows.
      const alreadyFlagged = !!txUuid && meta?.ipn_mismatch?.transaction_uuid === txUuid;
      const { error: flagError } = await db
        .from('payments')
        .update({
          metadata: {
            ...meta,
            ipn_mismatch: {
              reported_cents: Number.isFinite(reportedCents) ? reportedCents : null,
              reported_currency: reportedCurrency.slice(0, 10),
              transaction_uuid: txUuid,
              at: new Date().toISOString(),
            },
          },
          updated_at: new Date().toISOString(),
        })
        .eq('id', paymentId);
      if (flagError) console.error(`IPN: could not record the mismatch on payment ${paymentId}:`, flagError.message);
      // The customer has been charged and nothing tells them so: M3 must look at it.
      // Only references and figures go in the e-mail (plain() keeps [0-9A-Za-z._:-]).
      if (!alreadyFlagged) await alertM3('payment needs review', [
        `A payment notification from Lyra does not match the payment it names, so it was NOT marked paid.`,
        `Payment: ${paymentId}`,
        `Lyra reports: ${Number.isFinite(reportedCents) ? reportedCents : 'no amount'} cents, currency ${plain(reportedCurrency, 10) || 'none'}`,
        `The database expects: ${payment.amount_cents} cents, currency ${plain(dbCurrency, 10)}`,
        `Lyra transaction: ${plain(txUuid) || 'n/a'}`,
        `Check the transaction in the Lyra back office, then correct or refund it.`,
      ]);
      return text('OK', 200);
    }
  }

  // ── 4. Move the status, once ──────────────────────────────────────────────
  // Never away from paid or refunded; never "again" to the same status.
  const from: Status[] = (['pending', 'failed', 'cancelled'] as Status[]).filter((s) => s !== target);
  const now = new Date().toISOString();
  const updates: Record<string, unknown> = { status: target, updated_at: now };
  if (txId) updates.transaction_id = txId;
  if (txUuid) updates.transaction_uuid = txUuid;
  if (target === 'paid') updates.paid_at = now;

  const { data: moved, error: updateError } = await db
    .from('payments')
    .update(updates)
    .eq('id', paymentId)
    .in('status', from)
    .select('id');
  if (updateError) {
    console.error(`IPN: could not update payment ${paymentId}:`, updateError.message);
    return text('DB error', 500);
  }
  const transitioned = (moved?.length ?? 0) > 0;
  const statusNow: string = transitioned ? target : String(payment.status);
  if (transitioned) {
    console.log(`IPN: payment ${paymentId} ${payment.status} -> ${target} (tx ${txUuid || txId || 'n/a'})`);
  } else if (statusNow !== target) {
    console.warn(`IPN: payment ${paymentId} is ${statusNow}; a "${target}" notification does not change it`);
  }

  // Side effects: only for the request that made the change.
  if (transitioned && target === 'paid') {
    if (payment.payment_type === 'event_participation' && payment.reference_id &&
        (!payment.reference_type || payment.reference_type === 'event_participation')) {
      const { error: regError } = await db
        .from('event_registrations')
        .update({ payment_status: 'paid' })
        .eq('id', payment.reference_id);
      if (regError) {
        console.error(`IPN: payment ${paymentId} paid, but event registration ${payment.reference_id} could not be marked paid:`, regError.message);
        // Put the payment back as it was (only if nothing moved it since), so that
        // Lyra's retry makes the change again and redoes this step.
        const { data: undone, error: undoError } = await db
          .from('payments')
          .update({ status: payment.status, paid_at: payment.paid_at ?? null, updated_at: new Date().toISOString() })
          .eq('id', paymentId)
          .eq('status', 'paid')
          .eq('paid_at', now)
          .select('id');
        const putBack = !undoError && (undone?.length ?? 0) > 0;
        if (!putBack) console.error(`IPN: payment ${paymentId} could not be put back to ${payment.status}:`, undoError?.message || 'no row');
        // Told either way: Lyra re-sends the notification only if automatic retry is
        // on in its back office.
        await alertM3('payment needs review', [
          `Lyra reported a payment as paid, but its event registration could not be marked paid (database error).`,
          `Payment: ${paymentId}`,
          `Event registration: ${plain(payment.reference_id)}`,
          putBack
            ? `The payment was put back to "${plain(payment.status, 20)}" so that Lyra's next notification redoes both. If it still shows "${plain(payment.status, 20)}" in an hour, mark the payment and the registration paid by hand.`
            : `The payment shows "paid". Mark the registration paid by hand in the admin.`,
        ]);
        if (putBack) return text('Registration not updated yet', 500);
      }
    } else if (payment.payment_type === 'membership' || payment.payment_type === 'additional_seats') {
      console.warn(`IPN: ${payment.payment_type} payment ${paymentId} paid. No automatic change (platform free, M3 validates): review it in the admin.`);
    }
  }

  // ── 5. One e-mail per (payment, status) ───────────────────────────────────
  const emailStatus = statusNow === target && (target === 'paid' || (target === 'failed' && finalOrder)) ? target : null;
  if (!emailStatus) return text('OK', 200);

  const { error: claimError } = await db.from(EMAIL_LOG_TABLE).insert({ payment_id: paymentId, status: emailStatus });
  if (claimError) {
    if (claimError.code === '23505') return text('OK', 200); // already e-mailed (or being e-mailed)
    const missing = claimError.code === '42P01' || claimError.code === 'PGRST205' || /does not exist|could not find the table/i.test(claimError.message || '');
    console.error(missing
      ? `IPN: no ${emailStatus} e-mail for payment ${paymentId} yet: table public.${EMAIL_LOG_TABLE} is missing (apply migration 20261009180000_payment_email_log.sql); answering 503 so that Lyra's retry sends it`
      : `IPN: no ${emailStatus} e-mail for payment ${paymentId} yet: could not record it (${claimError.code || ''} ${claimError.message || ''}); answering 503 so that Lyra's retry sends it`);
    // The status change is already saved; a retry changes nothing else and sends the
    // e-mail once the key can be recorded.
    return text('E-mail not sent yet', 503);
  }

  const amount = formatAmount(payment.amount_cents, payment.currency);
  const data: Record<string, string> = emailStatus === 'paid'
    ? { amount, payment_type: String(payment.payment_type || ''), transaction_id: txUuid || txId || paymentId }
    : { amount };
  let outcome: 'sent' | 'permanent' | 'retry' = 'retry';
  try {
    const res = await fetch(`${SUPABASE_URL}/functions/v1/send-notification`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
        apikey: SUPABASE_SERVICE_KEY,
      },
      body: JSON.stringify({
        type: emailStatus === 'paid' ? 'payment_confirmed' : 'payment_failed',
        user_id: payment.user_id,
        data,
      }),
    });
    const detail = (await res.text().catch(() => '')).slice(0, 300);
    if (res.ok) {
      outcome = 'sent'; // includes "skipped: user opted out" (their own choice)
      console.log(`IPN: ${emailStatus} e-mail for payment ${paymentId}: ${detail}`);
    } else if (res.status === 400) {
      outcome = 'permanent'; // e.g. no address for this account: a retry cannot help
      console.error(`IPN: ${emailStatus} e-mail for payment ${paymentId} refused (400): ${detail}`);
    } else {
      console.error(`IPN: ${emailStatus} e-mail for payment ${paymentId} failed (${res.status}): ${detail}`);
    }
  } catch (e) {
    console.error(`IPN: ${emailStatus} e-mail for payment ${paymentId} failed:`, e instanceof Error ? e.message : String(e));
  }

  if (outcome === 'retry') {
    // Give the key back and let Lyra retry the IPN: the retry changes nothing else.
    const { error: releaseError } = await db.from(EMAIL_LOG_TABLE).delete().eq('payment_id', paymentId).eq('status', emailStatus);
    if (releaseError) {
      console.error(`IPN: could not release the e-mail key of payment ${paymentId}; no retry will send it:`, releaseError.message);
      return text('OK', 200);
    }
    return text('E-mail not sent yet', 500);
  }
  return text('OK', 200);
});
