import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const ALLOWED_ORIGINS = [
  "https://connect.m3monaco.com",
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

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders(req) });
  }

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { "Content-Type": "application/json", ...corsHeaders(req) },
    });
  }

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) {
    return new Response(JSON.stringify({ error: "No auth token" }), {
      status: 401,
      headers: { "Content-Type": "application/json", ...corsHeaders(req) },
    });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;

  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
  });

  const { data: callerData, error: callerError } = await userClient.rpc("is_moderator");
  if (callerError || !callerData) {
    return new Response(JSON.stringify({ error: "Access denied. Admin/moderator role required." }), {
      status: 403,
      headers: { "Content-Type": "application/json", ...corsHeaders(req) },
    });
  }

  const { email, password, first_name, last_name } = await req.json();
  if (!email || !password) {
    return new Response(JSON.stringify({ error: "Email and password are required" }), {
      status: 400,
      headers: { "Content-Type": "application/json", ...corsHeaders(req) },
    });
  }

  const adminClient = createClient(supabaseUrl, serviceRoleKey);

  const { data: newUser, error: createError } = await adminClient.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: {
      first_name: first_name || "",
      last_name: last_name || "",
      persona: "admin",
    },
  });

  if (createError) {
    return new Response(JSON.stringify({ error: createError.message }), {
      status: 400,
      headers: { "Content-Type": "application/json", ...corsHeaders(req) },
    });
  }

  await new Promise((r) => setTimeout(r, 1000));

  const { error: updateError } = await adminClient
    .from("profiles")
    .update({
      persona: "admin",
      access_status: "verified",
      onboarding_status: "completed",
      first_name: first_name || null,
      last_name: last_name || null,
    })
    .eq("user_id", newUser.user.id);

  if (updateError) {
    console.error("Profile update error:", updateError);
  }

  return new Response(
    JSON.stringify({
      success: true,
      user_id: newUser.user.id,
      email: newUser.user.email,
    }),
    { status: 200, headers: { "Content-Type": "application/json", ...corsHeaders(req) } }
  );
});
