/**
 * payment-ipn — Supabase Edge Function
 * Receives IPN (Instant Payment Notification) callbacks from SogeCommerce / Lyra.
 * Verifies HMAC-SHA-256 signature, updates payment status, and triggers notifications.
 *
 * POST /functions/v1/payment-ipn
 * Content-Type: application/x-www-form-urlencoded
 * Body: kr-hash, kr-hash-algorithm, kr-answer, kr-hash-key
 */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'content-type',
};

const LYRA_HMAC_KEY = Deno.env.get('LYRA_HMAC_KEY') || 'testpassword_DEMOPRIVATEKEY23G4475zXZQ2UA5x7M'; // demo key
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

async function verifyHmac(krAnswer: string, receivedHash: string, hashKey: string): Promise<boolean> {
  // Use the appropriate key based on kr-hash-key
  const key = hashKey === 'sha256_hmac' ? LYRA_HMAC_KEY : LYRA_HMAC_KEY;

  const encoder = new TextEncoder();
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    encoder.encode(key),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const signature = await crypto.subtle.sign('HMAC', cryptoKey, encoder.encode(krAnswer));
  const computed = Array.from(new Uint8Array(signature))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');

  return computed === receivedHash;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS_HEADERS });
  }

  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405, headers: CORS_HEADERS });
  }

  try {
    const contentType = req.headers.get('content-type') || '';
    let krHash: string, krHashAlgorithm: string, krAnswer: string, krHashKey: string;

    if (contentType.includes('application/x-www-form-urlencoded')) {
      const formData = await req.formData();
      krHash = formData.get('kr-hash') as string || '';
      krHashAlgorithm = formData.get('kr-hash-algorithm') as string || '';
      krAnswer = formData.get('kr-answer') as string || '';
      krHashKey = formData.get('kr-hash-key') as string || '';
    } else {
      // JSON fallback (client-side verification)
      const body = await req.json();
      krHash = body['kr-hash'] || body.krHash || '';
      krHashAlgorithm = body['kr-hash-algorithm'] || body.krHashAlgorithm || '';
      krAnswer = body['kr-answer'] || body.krAnswer || '';
      krHashKey = body['kr-hash-key'] || body.krHashKey || '';
    }

    if (!krAnswer || !krHash) {
      console.error('IPN: Missing kr-answer or kr-hash');
      return new Response('Bad Request', { status: 400, headers: CORS_HEADERS });
    }

    // Verify HMAC-SHA-256 signature
    const valid = await verifyHmac(krAnswer, krHash, krHashKey);
    if (!valid) {
      console.error('IPN: Invalid HMAC signature');
      return new Response('Invalid signature', { status: 403, headers: CORS_HEADERS });
    }

    // Parse the answer
    const answer = JSON.parse(krAnswer);
    const transactionStatus = answer.orderStatus; // PAID, UNPAID, RUNNING, ERROR
    const transactions = answer.transactions || [];
    const firstTx = transactions[0] || {};
    const txUuid = firstTx.uuid || '';
    const txId = firstTx.transactionDetails?.cardDetails?.legacyTransId || '';
    const metadata = answer.metadata || {};
    const paymentId = metadata.payment_id;
    const paymentType = metadata.payment_type;
    const organizationId = metadata.organization_id;

    if (!paymentId) {
      console.error('IPN: No payment_id in metadata');
      return new Response('Missing payment_id', { status: 400, headers: CORS_HEADERS });
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

    // Map Lyra status to our status
    let status = 'pending';
    if (transactionStatus === 'PAID') status = 'paid';
    else if (transactionStatus === 'UNPAID' || transactionStatus === 'ERROR') status = 'failed';
    else if (transactionStatus === 'CANCELLED') status = 'cancelled';

    // Update payment record
    const updates: Record<string, unknown> = {
      status,
      transaction_id: txId,
      transaction_uuid: txUuid,
      updated_at: new Date().toISOString(),
    };
    if (status === 'paid') {
      updates.paid_at = new Date().toISOString();
    }

    const { data: payment, error: updateError } = await supabase
      .from('payments')
      .update(updates)
      .eq('id', paymentId)
      .select('user_id, organization_id, payment_type, amount_cents, reference_id, metadata')
      .single();

    if (updateError) {
      console.error('IPN: Failed to update payment:', updateError);
      return new Response('DB error', { status: 500, headers: CORS_HEADERS });
    }

    // Post-payment actions
    if (status === 'paid' && payment) {
      // Send payment confirmation notification
      try {
        const { data: profile } = await supabase
          .from('profiles')
          .select('first_name, email')
          .eq('user_id', payment.user_id)
          .single();

        // Call send-notification edge function internally
        await fetch(`${SUPABASE_URL}/functions/v1/send-notification`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'apikey': Deno.env.get('SUPABASE_ANON_KEY') || '',
          },
          body: JSON.stringify({
            type: 'payment_confirmed',
            user_id: payment.user_id,
            data: {
              amount: `€${(payment.amount_cents / 100).toFixed(2)}`,
              payment_type: payment.payment_type,
              transaction_id: txUuid || txId || paymentId,
            },
          }),
        });
      } catch (e) {
        console.warn('IPN: notification failed (non-blocking):', e);
      }

      // If membership payment, verify the organization AND the user's profile
      if (payment.payment_type === 'membership' && payment.organization_id) {
        await supabase
          .from('organizations')
          .update({ access_status: 'verified' })
          .eq('id', payment.organization_id);

        // Also verify the user's profile (partner was in 'payment_pending' state)
        await supabase
          .from('profiles')
          .update({ access_status: 'verified' })
          .eq('user_id', payment.user_id);

        // Verify all members of this org (they inherit the org's verified status)
        const { data: orgMembers } = await supabase
          .from('organization_members')
          .select('user_id')
          .eq('organization_id', payment.organization_id);
        if (orgMembers && orgMembers.length > 0) {
          const memberIds = orgMembers.map((m: { user_id: string }) => m.user_id);
          await supabase
            .from('profiles')
            .update({ access_status: 'verified' })
            .in('user_id', memberIds)
            .eq('access_status', 'payment_pending');
        }
      }

      // If additional seats, increment max_seats on the organization
      if (payment.payment_type === 'additional_seats' && payment.organization_id) {
        const seatsCount = payment.metadata?.seats_count ? parseInt(payment.metadata.seats_count as string) : 1;
        const { data: currentOrg } = await supabase
          .from('organizations')
          .select('max_seats')
          .eq('id', payment.organization_id)
          .single();
        if (currentOrg) {
          await supabase
            .from('organizations')
            .update({ max_seats: (currentOrg.max_seats || 1) + seatsCount })
            .eq('id', payment.organization_id);
        }
      }

      // If event participation, confirm the registration
      if (payment.payment_type === 'event_participation' && payment.reference_id) {
        await supabase
          .from('event_registrations')
          .update({ payment_status: 'paid' })
          .eq('id', payment.reference_id);
      }
    }

    console.log(`IPN: Payment ${paymentId} updated to ${status} (tx: ${txUuid})`);
    return new Response('OK', { status: 200, headers: CORS_HEADERS });
  } catch (err) {
    console.error('IPN error:', err);
    return new Response('Internal error', { status: 500, headers: CORS_HEADERS });
  }
});
