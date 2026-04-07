import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
const SITE_URL = Deno.env.get("SITE_URL") || "https://smartmarinaconnect.com";

const ALLOWED_ORIGINS = [
  "https://smartmarinaconnect.com",
  "https://m3connect.netlify.app",
  "http://localhost:5173",
  "http://localhost:3000",
];

function getCorsOrigin(req: Request): string {
  const origin = req.headers.get("origin") || "";
  return ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
}

function corsHeaders(req: Request) {
  return {
    "Access-Control-Allow-Origin": getCorsOrigin(req),
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
  };
}

const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

function generateToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}

async function hashToken(token: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(token);
  const hash = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, '0')).join('');
}

function buildEmailHtml(data: {
  recipientFirstName: string;
  partnerLegalName: string;
  referenceId: string;
  verificationCode: string;
  expiresAt: string;
  recipientEmail: string;
  clientLegalName: string;
  clientCountry: string;
  clientWebsite: string;
  signerName: string;
  signerTitle: string;
  projectName: string;
  projectLocation: string;
  projectStartDate: string;
  projectEndDate: string;
  projectDeliveryDate: string;
  contractReference: string;
  solutionProduct: string;
  scopeDescription: string;
  resultsSummary: string;
  keyKpis: string;
  recommendationStatement: string;
  confirmUrl: string;
  rejectUrl: string;
}): string {
  return `<!doctype html>
<html lang="fr">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>M3 Connect \u2013 Recommandation</title></head>
<body style="margin:0;padding:0;background-color:#f4f6f8;">
<div style="display:none;font-size:1px;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;">Confirmation de recommandation client, ${data.referenceId}, ${data.projectName}, action requise.</div>
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background-color:#f4f6f8;"><tr><td align="center" style="padding:24px 12px;">
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="640" style="width:640px;max-width:100%;background-color:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 6px 18px rgba(0,0,0,0.06);">
<tr><td style="padding:22px 24px;background-color:#0b1f3a;color:#ffffff;">
  <div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;opacity:0.9;">M3 Connect \u2014 v\u00e9rification de recommandation</div>
  <div style="font-family:Arial,Helvetica,sans-serif;font-size:20px;font-weight:700;margin-top:6px;">Action requise \u2014 confirmer une recommandation client</div>
</td></tr>
<tr><td style="padding:22px 24px 10px 24px;">
  <div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:20px;color:#111827;">
    Bonjour <strong>${data.recipientFirstName}</strong>,<br><br>
    <strong>${data.partnerLegalName}</strong> a indiqu\u00e9 que vous \u00eates habilit\u00e9(e) \u00e0 confirmer une recommandation client concernant le projet ci-dessous.
    Cette confirmation s'inscrit dans le processus d'onboarding et d'enqu\u00eate d'honorabilit\u00e9 de M3 Connect.
  </div>
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin-top:16px;background-color:#f9fafb;border:1px solid #e5e7eb;border-radius:10px;">
    <tr><td style="padding:12px 14px;"><div style="font-family:Arial,Helvetica,sans-serif;font-size:13px;line-height:18px;color:#111827;">
      <strong>R\u00e9f\u00e9rence M3 Connect</strong> : ${data.referenceId}<br>
      <strong>Code de v\u00e9rification</strong> : ${data.verificationCode}<br>
      <strong>Expiration</strong> : ${data.expiresAt}<br>
      <strong>Email destinataire</strong> : ${data.recipientEmail}
    </div></td></tr>
  </table>
  <div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;font-weight:700;color:#111827;margin-top:18px;">1. Organisation cliente</div>
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin-top:8px;border:1px solid #e5e7eb;border-radius:10px;overflow:hidden;">
    <tr><td style="padding:10px 12px;background-color:#ffffff;"><div style="font-family:Arial,Helvetica,sans-serif;font-size:13px;line-height:18px;color:#111827;">
      <strong>Soci\u00e9t\u00e9</strong> : ${data.clientLegalName}<br>
      <strong>Pays</strong> : ${data.clientCountry || 'N/A'}<br>
      <strong>Site</strong> : ${data.clientWebsite || 'N/A'}<br>
      <strong>Signataire d\u00e9clar\u00e9</strong> : ${data.signerName}, ${data.signerTitle}
    </div></td></tr>
  </table>
  <div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;font-weight:700;color:#111827;margin-top:18px;">2. Projet et p\u00e9rim\u00e8tre</div>
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin-top:8px;border:1px solid #e5e7eb;border-radius:10px;overflow:hidden;">
    <tr><td style="padding:10px 12px;background-color:#ffffff;"><div style="font-family:Arial,Helvetica,sans-serif;font-size:13px;line-height:18px;color:#111827;">
      <strong>Projet</strong> : ${data.projectName}<br>
      <strong>Localisation</strong> : ${data.projectLocation || 'N/A'}<br>
      <strong>P\u00e9riode</strong> : ${data.projectStartDate || 'N/A'} \u00e0 ${data.projectEndDate || 'N/A'}<br>
      <strong>Mise en service</strong> : ${data.projectDeliveryDate || 'N/A'}<br>
      <strong>R\u00e9f\u00e9rence contrat</strong> : ${data.contractReference || 'N/A'}<br>
      <strong>Solution / produit</strong> : ${data.solutionProduct || 'N/A'}<br>
      <strong>P\u00e9rim\u00e8tre</strong> : ${data.scopeDescription || 'N/A'}
    </div></td></tr>
  </table>
  <div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;font-weight:700;color:#111827;margin-top:18px;">3. R\u00e9sultats et valeur observ\u00e9e</div>
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin-top:8px;border:1px solid #e5e7eb;border-radius:10px;overflow:hidden;">
    <tr><td style="padding:10px 12px;background-color:#ffffff;"><div style="font-family:Arial,Helvetica,sans-serif;font-size:13px;line-height:18px;color:#111827;">
      ${data.resultsSummary || 'N/A'}<br>
      <strong>KPIs</strong> : ${data.keyKpis || 'N/A'}
    </div></td></tr>
  </table>
  <div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;font-weight:700;color:#111827;margin-top:18px;">Recommandation propos\u00e9e</div>
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin-top:8px;background-color:#f0fdf4;border:1px solid #bbf7d0;border-radius:10px;">
    <tr><td style="padding:14px;">
      <div style="font-family:Arial,Helvetica,sans-serif;font-size:13px;line-height:18px;color:#15803d;font-style:italic;">
        \u00ab ${data.recommendationStatement} \u00bb
      </div>
    </td></tr>
  </table>
  <div style="margin-top:24px;text-align:center;">
    <a href="${data.confirmUrl}" style="display:inline-block;padding:14px 28px;background-color:#16a34a;color:#ffffff;text-decoration:none;border-radius:8px;font-family:Arial,Helvetica,sans-serif;font-size:14px;font-weight:700;margin:0 6px 12px;">\u2713 Je confirme et je signe</a>
    <a href="${data.rejectUrl}" style="display:inline-block;padding:14px 28px;background-color:#ffffff;color:#dc2626;text-decoration:none;border-radius:8px;border:1px solid #fca5a5;font-family:Arial,Helvetica,sans-serif;font-size:14px;font-weight:700;margin:0 6px 12px;">\u2717 Je ne confirme pas</a>
  </div>
  <div style="margin-top:20px;padding:14px;background-color:#f9fafb;border:1px solid #e5e7eb;border-radius:10px;">
    <div style="font-family:Arial,Helvetica,sans-serif;font-size:12px;line-height:16px;color:#6b7280;">
      <strong>Confidentialit\u00e9 et consentement</strong><br>
      En confirmant cette recommandation, vous acceptez que votre nom, titre et confirmation soient partag\u00e9s avec M3 Connect dans le cadre du processus d'onboarding du partenaire. Vos donn\u00e9es sont trait\u00e9es conform\u00e9ment \u00e0 notre politique de confidentialit\u00e9.<br><br>
      Si vous avez des questions, contactez notre \u00e9quipe \u00e0 <a href="mailto:info@m3monaco.com" style="color:#2563eb;">info@m3monaco.com</a>
    </div>
  </div>
</td></tr>
<tr><td style="padding:16px 24px;background-color:#f9fafb;border-top:1px solid #e5e7eb;">
  <div style="font-family:Arial,Helvetica,sans-serif;font-size:11px;color:#9ca3af;text-align:center;">
    M3 Monaco SAM \u00b7 3 Boulevard des Moulins, Monte Carlo Palace, Office B21, 98000 Monaco<br>
    Cet email a \u00e9t\u00e9 envoy\u00e9 par M3 Connect dans le cadre d'un processus d'onboarding partenaire.
  </div>
</td></tr>
</table></td></tr></table></body></html>`;
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders(req) });
  }

  const headers = { 'Content-Type': 'application/json', ...corsHeaders(req) };

  try {
    const { reference_request_id, recipients } = await req.json();

    if (!reference_request_id || !recipients || !Array.isArray(recipients) || recipients.length === 0) {
      return new Response(JSON.stringify({ error: 'Missing reference_request_id or recipients' }), { status: 400, headers });
    }

    const { data: refReq, error: refErr } = await supabaseAdmin
      .from('reference_requests')
      .select('*')
      .eq('id', reference_request_id)
      .single();

    if (refErr || !refReq) {
      return new Response(JSON.stringify({ error: 'Reference request not found', details: refErr?.message }), { status: 404, headers });
    }

    const { data: partnerOrg } = await supabaseAdmin
      .from('organizations')
      .select('name')
      .eq('id', refReq.partner_organization_id)
      .single();

    const results: Array<{ email: string; status: string; error?: string }> = [];

    for (const recipient of recipients) {
      const confirmToken = generateToken();
      const rejectToken = generateToken();
      const openToken = generateToken();

      const confirmHash = await hashToken(confirmToken);
      const rejectHash = await hashToken(rejectToken);
      const openHash = await hashToken(openToken);

      const { error: recErr } = await supabaseAdmin
        .from('reference_recipients')
        .insert({
          reference_request_id,
          email: recipient.email,
          first_name: recipient.first_name || null,
          last_name: recipient.last_name || null,
          job_title: recipient.job_title || null,
          confirm_token_hash: confirmHash,
          reject_token_hash: rejectHash,
          open_token_hash: openHash,
        });

      if (recErr) {
        results.push({ email: recipient.email, status: 'failed', error: recErr.message });
        continue;
      }

      const confirmUrl = `${SITE_URL}/reference/confirm?token=${confirmToken}&ref=${refReq.reference_id}`;
      const rejectUrl = `${SITE_URL}/reference/reject?token=${rejectToken}&ref=${refReq.reference_id}`;

      const emailHtml = buildEmailHtml({
        recipientFirstName: recipient.first_name || 'Madame/Monsieur',
        partnerLegalName: partnerOrg?.name || 'Partner',
        referenceId: refReq.reference_id,
        verificationCode: refReq.verification_code,
        expiresAt: new Date(refReq.expires_at).toLocaleString('fr-FR', { timeZone: 'Europe/Paris' }),
        recipientEmail: recipient.email,
        clientLegalName: refReq.client_legal_name,
        clientCountry: refReq.client_country || '',
        clientWebsite: refReq.client_website || '',
        signerName: `${recipient.first_name || ''} ${recipient.last_name || ''}`.trim(),
        signerTitle: recipient.job_title || '',
        projectName: refReq.project_name,
        projectLocation: refReq.project_location || '',
        projectStartDate: refReq.project_start_date || '',
        projectEndDate: refReq.project_end_date || '',
        projectDeliveryDate: refReq.project_delivery_date || '',
        contractReference: refReq.contract_reference || '',
        solutionProduct: refReq.solution_product || '',
        scopeDescription: refReq.scope_description || '',
        resultsSummary: refReq.results_summary || '',
        keyKpis: refReq.key_kpis || '',
        recommendationStatement: refReq.recommendation_statement,
        confirmUrl,
        rejectUrl,
      });

      if (RESEND_API_KEY) {
        try {
          const emailResponse = await fetch('https://api.resend.com/emails', {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${RESEND_API_KEY}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              from: Deno.env.get("SENDER_EMAIL") || 'Smart Marina Connect <noreply@smartmarinaconnect.com>',
              to: recipient.email,
              subject: `Action requise — Confirmer une recommandation client (${refReq.reference_id})`,
              html: emailHtml,
            }),
          });

          if (emailResponse.ok) {
            await supabaseAdmin
              .from('reference_recipients')
              .update({ delivery_status: 'sent', sent_at: new Date().toISOString() })
              .eq('reference_request_id', reference_request_id)
              .eq('email', recipient.email);

            await supabaseAdmin.from('reference_events').insert({
              reference_request_id,
              event_type: 'email_sent',
              actor_type: 'system',
              actor_id: 'edge-function',
              metadata: { recipient_email: recipient.email },
            });

            results.push({ email: recipient.email, status: 'sent' });
          } else {
            const errBody = await emailResponse.text();
            await supabaseAdmin
              .from('reference_recipients')
              .update({ delivery_status: 'failed' })
              .eq('reference_request_id', reference_request_id)
              .eq('email', recipient.email);
            results.push({ email: recipient.email, status: 'send_failed', error: errBody });
          }
        } catch (sendErr) {
          results.push({ email: recipient.email, status: 'send_failed', error: String(sendErr) });
        }
      } else {
        results.push({ email: recipient.email, status: 'recipient_created_no_email', error: 'No RESEND_API_KEY configured.' });
      }
    }

    const anySent = results.some(r => r.status === 'sent');
    const anyCreated = results.some(r => r.status === 'recipient_created_no_email' || r.status === 'sent');
    if (anySent) {
      await supabaseAdmin
        .from('reference_requests')
        .update({ status: 'sent' })
        .eq('id', reference_request_id);
    } else if (anyCreated) {
      await supabaseAdmin.from('reference_events').insert({
        reference_request_id,
        event_type: 'recipients_created_no_email',
        actor_type: 'system',
        actor_id: 'edge-function',
        metadata: { results },
      });
    }

    return new Response(JSON.stringify({ success: true, results }), { headers });
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { 'Content-Type': 'application/json', ...corsHeaders(req) },
    });
  }
});
