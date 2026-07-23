// Signup via a valid organization claim code -- bypasses email confirmation
// because the user already proved ownership of the email by clicking the
// invitation link sent to that address.
//
// Security: validates the claim code matches a real organization before
// creating a pre-confirmed account. Invalid codes fall back to normal signup.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const ALLOWED_ORIGINS = [
  "https://smartmarinaconnect.com",
  "https://m3connect.netlify.app",
  "http://localhost:5173",
  "http://localhost:3000",
];

const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";

function corsHeaders(req: Request) {
  const origin = req.headers.get("origin") || "";
  const allowed = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    "Access-Control-Allow-Origin": allowed,
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
  };
}

// Fire-and-forget admin notification (fans out to every admin via notify-admins)
async function notifyAdminsOfSignup(data: { email: string; first_name?: string; last_name?: string; org_name?: string; claim_code?: string; membership?: string }) {
  try {
    if (!SUPABASE_URL || !SERVICE_ROLE_KEY) return;
    const fullName = [data.first_name, data.last_name].filter(Boolean).join(" ").trim() || data.email;
    const details = [
      `Email: ${data.email}`,
      `Signup method: Claim code (${data.claim_code || "unknown"})`,
      data.org_name ? `Organization: ${data.org_name}` : "",
      data.membership ? `Membership: ${data.membership}` : "",
    ].filter(Boolean).join("\n");
    await fetch(`${SUPABASE_URL}/functions/v1/notify-admins`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${SERVICE_ROLE_KEY}`,
        "apikey": SERVICE_ROLE_KEY,
      },
      body: JSON.stringify({
        submission_type: "new user signup",
        submitter: fullName,
        details,
        include_contact_inbox: true,
      }),
    });
  } catch {
    // Swallow any errors -- notifications must never block signup
  }
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

    const { email, password, first_name, last_name, persona, claim_code } = await req.json();

    if (!email || !password || !claim_code) {
      return new Response(
        JSON.stringify({ error: "Email, password, and claim_code are required" }),
        { status: 400, headers }
      );
    }

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

    // 1. Validate the claim code matches a real organization (case-insensitive).
    //    Escape LIKE wildcards so "IGY_MIAMI" can't match a different org than
    //    the exact claim below (the RPC uses exact upper/trim equality).
    const normalizedCode = String(claim_code).trim().toUpperCase();
    const codePattern = normalizedCode.replace(/[\\%_]/g, (c) => `\\${c}`);
    const { data: org, error: orgError } = await admin
      .from("organizations")
      .select("id, name, organization_type")
      .not("claim_code", "is", null)
      .ilike("claim_code", codePattern)
      .maybeSingle();

    if (orgError || !org) {
      return new Response(
        JSON.stringify({ error: "Invalid organization code. Please use the normal signup process." }),
        { status: 400, headers }
      );
    }

    // 2. Check if a user with this email already exists
    const { data: existingList } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
    const existing = existingList?.users?.find((u: { email?: string }) => u.email?.toLowerCase() === email.toLowerCase());
    if (existing) {
      return new Response(
        JSON.stringify({ error: "An account with this email already exists. Please log in instead." }),
        { status: 400, headers }
      );
    }

    // 3. Create the user with email_confirm: true (skips confirmation email)
    const { data: newUser, error: createError } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: {
        first_name: first_name || "",
        last_name: last_name || "",
        persona: persona || org.organization_type || "marina",
      },
    });

    if (createError || !newUser?.user) {
      return new Response(
        JSON.stringify({ error: createError?.message || "Failed to create account" }),
        { status: 400, headers }
      );
    }

    // 4. Create the org membership + resolve persona/status SERVER-SIDE and
    //    atomically. This used to depend on a best-effort client auto-claim run
    //    after sign-in; a failed sign-in or a closed tab left a confirmed account
    //    with no membership, invisible to its own organization. The client effect
    //    now only acts as a redundant fallback.
    let membershipRole = "FAILED";
    const { data: claimData, error: claimErr } = await admin.rpc("claim_organization_for_user", {
      p_user_id: newUser.user.id,
      p_claim_code: normalizedCode,
    });
    if (claimErr) {
      console.error("claim_organization_for_user failed", claimErr);
    } else {
      membershipRole = (claimData as { role?: string } | null)?.role || "unknown";
    }

    // 5. Notify all admins of the new signup (fire-and-forget), incl. the outcome.
    notifyAdminsOfSignup({
      email,
      first_name,
      last_name,
      org_name: org.name,
      claim_code: claim_code,
      membership: membershipRole,
    });

    return new Response(
      JSON.stringify({
        success: true,
        user_id: newUser.user.id,
        email: newUser.user.email,
        organization_id: org.id,
        organization_name: org.name,
        member_role: membershipRole,
      }),
      { status: 200, headers }
    );
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return new Response(JSON.stringify({ error: message }), { status: 500, headers });
  }
});
