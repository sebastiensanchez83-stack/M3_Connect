/**
 * create-payment — Supabase Edge Function
 * Creates a payment form token via SogeCommerce (Lyra) REST API.
 *
 * POST /functions/v1/create-payment
 * Body: { amount_cents, currency?, order_id?, payment_type, reference_id?, metadata? }
 *
 * Returns: { formToken, paymentId }
 */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// SogeCommerce / Lyra REST API config
const LYRA_API_URL = Deno.env.get('LYRA_API_URL') || 'https://api-sogecommerce.societegenerale.eu/api-payment/V4/Charge/CreatePayment';
const LYRA_SHOP_ID = Deno.env.get('LYRA_SHOP_ID') || '69876357'; // demo
const LYRA_API_PASSWORD = Deno.env.get('LYRA_API_PASSWORD') || 'testpassword_DEMOPRIVATEKEY23G4475zXZQ2UA5x7M'; // demo
const LYRA_MODE = Deno.env.get('LYRA_MODE') || 'TEST';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY') || '';

function isAuthorized(req: Request): boolean {
  const apikey = req.headers.get('apikey') || '';
  const auth = req.headers.get('authorization') || '';
  return (apikey === SUPABASE_ANON_KEY) || auth.startsWith('Bearer ');
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS_HEADERS });
  }

  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    });
  }

  if (!isAuthorized(req)) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    });
  }

  try {
    const body = await req.json();
    const { amount_cents, currency = 'EUR', order_id, payment_type, reference_id, metadata = {}, user_id, organization_id } = body;

    if (!amount_cents || !payment_type || !user_id) {
      return new Response(JSON.stringify({ error: 'Missing required fields: amount_cents, payment_type, user_id' }), {
        status: 400,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      });
    }

    // Create payment record in DB
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
    const { data: paymentRow, error: dbError } = await supabase
      .from('payments')
      .insert({
        user_id,
        organization_id: organization_id || null,
        payment_type,
        amount_cents,
        currency,
        status: 'pending',
        reference_type: payment_type,
        reference_id: reference_id || null,
        metadata,
      })
      .select('id')
      .single();

    if (dbError) {
      console.error('DB insert error:', dbError);
      return new Response(JSON.stringify({ error: 'Failed to create payment record' }), {
        status: 500,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      });
    }

    // Call SogeCommerce / Lyra CreatePayment API
    const credentials = btoa(`${LYRA_SHOP_ID}:${LYRA_API_PASSWORD}`);
    const ipnUrl = `${SUPABASE_URL}/functions/v1/payment-ipn`;

    const lyraPayload = {
      amount: amount_cents,
      currency: currency.toUpperCase(),
      orderId: order_id || paymentRow.id,
      formAction: LYRA_MODE === 'TEST' ? 'PAYMENT' : 'PAYMENT',
      customer: {
        reference: user_id,
      },
      metadata: {
        payment_id: paymentRow.id,
        payment_type,
        organization_id: organization_id || '',
      },
      ipnTargetUrl: ipnUrl,
    };

    const lyraRes = await fetch(LYRA_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Basic ${credentials}`,
      },
      body: JSON.stringify(lyraPayload),
    });

    const lyraData = await lyraRes.json();

    if (lyraData.status !== 'SUCCESS' || !lyraData.answer?.formToken) {
      console.error('Lyra API error:', JSON.stringify(lyraData));
      // Clean up the pending payment record
      await supabase.from('payments').delete().eq('id', paymentRow.id);
      return new Response(JSON.stringify({ error: 'Payment gateway error', details: lyraData.answer?.errorMessage || 'Unknown error' }), {
        status: 502,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      });
    }

    // Save formToken to payment record
    await supabase.from('payments').update({ form_token: lyraData.answer.formToken }).eq('id', paymentRow.id);

    return new Response(JSON.stringify({
      formToken: lyraData.answer.formToken,
      paymentId: paymentRow.id,
    }), {
      status: 200,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    });
  } catch (err) {
    console.error('create-payment error:', err);
    return new Response(JSON.stringify({ error: 'Internal server error' }), {
      status: 500,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    });
  }
});
