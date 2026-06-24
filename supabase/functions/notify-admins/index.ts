// Fan-out notification: sends an admin notification email to EVERY admin user
// registered in the profiles table (persona = 'admin').
//
// Called by the client via notifyAdmin() and by other edge functions when a
// new signup / submission needs to reach the full admin team, not just the
// generic contact inbox.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const ALLOWED_ORIGINS = [
  "https://smartmarinaconnect.com",
  "https://m3connect.netlify.app",
  "http://localhost:5173",
  "http://localhost:3000",
];

const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

function corsHeaders(req: Request) {
  const origin = req.headers.get("origin") || "";
  const allowed = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    "Access-Control-Allow-Origin": allowed,
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
  };
}

Deno.serve(async (req: Request) => {
  const headers = { "Content-Type": "application/json", ...corsHeaders(req) };

  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders(req) });
  }

  try {
    if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
      return new Response(JSON.stringify({ error: "Server not configured" }), { status: 500, headers });
    }

    const { submission_type, submitter, details, include_contact_inbox } = await req.json();

    if (!submission_type) {
      return new Response(JSON.stringify({ error: "submission_type is required" }), { status: 400, headers });
    }

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

    // Look up every admin user (persona = 'admin') with a valid email
    const { data: adminProfiles, error } = await admin
      .from("profiles")
      .select("email")
      .eq("persona", "admin")
      .not("email", "is", null);

    if (error) {
      return new Response(JSON.stringify({ error: error.message }), { status: 500, headers });
    }

    // Build recipient list (de-duplicated, lowercased)
    const recipients = new Set<string>();
    for (const p of adminProfiles || []) {
      if (p.email) recipients.add(String(p.email).toLowerCase());
    }
    // Optionally also CC the generic contact inbox
    if (include_contact_inbox !== false) {
      recipients.add("contact@smartmarinaconnect.com");
    }

    // Fire-and-forget call to send-notification for each recipient
    const sendPromises = Array.from(recipients).map((email) =>
      fetch(`${SUPABASE_URL}/functions/v1/send-notification`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${SERVICE_ROLE_KEY}`,
          "apikey": SERVICE_ROLE_KEY,
        },
        body: JSON.stringify({
          type: "admin_new_submission",
          email,
          data: {
            submission_type,
            submitter: submitter || "a user",
            details: details || "",
          },
        }),
      }).catch(() => { /* swallow individual failures */ })
    );

    await Promise.all(sendPromises);

    return new Response(
      JSON.stringify({ success: true, notified: recipients.size, recipients: Array.from(recipients) }),
      { status: 200, headers }
    );
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return new Response(JSON.stringify({ error: message }), { status: 500, headers });
  }
});
