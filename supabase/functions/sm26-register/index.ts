// SM26 public registration -- provisions a guest account + writes the
// registration/role/module rows server-side (service role, bypassing RLS),
// then emails a magic-link so the guest can access their workspace.
//
// Logged-in members do NOT use this function: the frontend writes their rows
// directly under their own JWT (RLS-enforced). This endpoint is ONLY the
// no-account guest path. It is intentionally public (verify_jwt = false);
// abuse is mitigated by a honeypot + required-field checks + the natural
// idempotency of "email already exists". TODO before prod: add Turnstile.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const ALLOWED_ORIGINS = [
  "https://smartmarinaconnect.com",
  "https://m3connect.netlify.app",
  "http://localhost:5173",
  "http://localhost:3000",
];
const ADMIN_EMAIL = Deno.env.get("SM26_ADMIN_EMAIL") || "events@m3monaco.com";
const SITE_URL = Deno.env.get("SITE_URL") || "https://smartmarinaconnect.com";

function corsOrigin(req: Request): string {
  const o = req.headers.get("origin") || "";
  return ALLOWED_ORIGINS.includes(o) ? o : ALLOWED_ORIGINS[0];
}
function cors(req: Request) {
  return {
    "Access-Control-Allow-Origin": corsOrigin(req),
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
  };
}
const json = (req: Request, body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...cors(req) },
  });

const s = (v: unknown) => {
  const t = typeof v === "string" ? v.trim() : "";
  return t === "" ? null : t;
};

function mapStartup(d: Record<string, unknown>) {
  return {
    startup_or_scaleup: s(d.startup_or_scaleup),
    stage: s(d.stage),
    categories: Array.isArray(d.categories) ? d.categories : [],
    organization_activity: s(d.organization_activity),
    problem: s(d.problem),
    solution: s(d.solution),
    differentiation: s(d.differentiation),
    usp: s(d.usp),
    target_markets: s(d.target_markets),
    business_model: s(d.business_model),
    competitive_positioning: s(d.competitive_positioning),
    collaboration_expected: s(d.collaboration_expected),
    investment_seeking: !!d.investment_seeking,
    investment_stage: s(d.investment_stage),
    investment_type: s(d.investment_type),
    funds_needed: s(d.funds_needed),
    references_text: s(d.references_text),
  };
}

function mapArch(d: Record<string, unknown>) {
  const members = String(d.team_members ?? "")
    .split("\n")
    .map((x) => x.trim())
    .filter(Boolean);
  const size = s(d.team_size);
  return {
    company_description: s(d.company_description),
    sustainability_statement: s(d.sustainability_statement),
    domain: s(d.domain),
    references_text: s(d.references_text),
    proof_of_enrolment_url: s(d.proof_of_enrolment_url),
    is_team: !!d.is_team,
    team_size: size ? parseInt(size, 10) : null,
    team_members: members,
    portfolio_link: s(d.portfolio_link),
    onsite_attendance: !!d.onsite_attendance,
  };
}

function mapMarina(d: Record<string, unknown>) {
  return {
    architectural_quality: s(d.architectural_quality),
    biodiversity: s(d.biodiversity),
    water: s(d.water),
    energy: s(d.energy),
    waste: s(d.waste),
    innovation: s(d.innovation),
    security: s(d.security),
    sustainable_diff: s(d.sustainable_diff),
    further_info: s(d.further_info),
  };
}

// Store the guest's base64 assets under their new account's storage folder.
// deno-lint-ignore no-explicit-any
async function uploadAssets(admin: any, userId: string, assetsIn: Record<string, { name?: string; type?: string; data?: string }[]>): Promise<Record<string, string[]>> {
  const out: Record<string, string[]> = {};
  const extOf = (n: string, t: string) => {
    const e = (n.split(".").pop() || "").toLowerCase();
    if (e && e.length <= 5 && /^[a-z0-9]+$/.test(e)) return e;
    if (t.includes("png")) return "png";
    if (t.includes("pdf")) return "pdf";
    if (t.includes("jpeg") || t.includes("jpg")) return "jpg";
    return "bin";
  };
  for (const [key, items] of Object.entries(assetsIn || {})) {
    if (!Array.isArray(items)) continue;
    const paths: string[] = [];
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      if (!it?.data) continue;
      try {
        const bin = atob(it.data);
        const bytes = new Uint8Array(bin.length);
        for (let j = 0; j < bin.length; j++) bytes[j] = bin.charCodeAt(j);
        const path = `${userId}/sm26/${key}/${Date.now()}-${i}.${extOf(it.name || "", it.type || "")}`;
        const { error } = await admin.storage.from("event-media").upload(path, bytes, { contentType: it.type || "application/octet-stream", upsert: true });
        if (!error) paths.push(path);
      } catch { /* skip an undecodable file */ }
    }
    if (paths.length) out[key] = paths;
  }
  return out;
}

async function sendAccessEmail(email: string, firstName: string, link: string) {
  const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
  const SENDER_EMAIL =
    Deno.env.get("SENDER_EMAIL") || "Smart Marina Connect <noreply@smartmarinaconnect.com>";
  if (!RESEND_API_KEY) {
    console.error("RESEND_API_KEY not set -- skipping access email");
    return;
  }
  const greeting = firstName ? `Hello ${firstName},` : "Hello,";
  const html = `
<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="margin:0;padding:0;background:#f4f5f7;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f4f5f7;padding:40px 20px;"><tr><td align="center">
<table role="presentation" width="600" cellspacing="0" cellpadding="0" style="background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,.06);">
<tr><td style="background:#0b2653;padding:32px 40px;text-align:center;">
<h1 style="margin:0;color:#fff;font-size:22px;font-weight:700;">Smart &amp; Sustainable Marina Rendezvous 2026</h1>
<p style="margin:6px 0 0;color:#93c5fd;font-size:13px;">20-21 September 2026 · Yacht Club de Monaco</p></td></tr>
<tr><td style="padding:40px;">
<p style="margin:0 0 8px;color:#374151;font-size:16px;">${greeting}</p>
<h2 style="margin:0 0 16px;color:#111827;font-size:20px;font-weight:600;">Your registration is received</h2>
<p style="margin:0 0 28px;color:#4b5563;font-size:15px;line-height:1.6;">Thank you for registering for the Rendezvous. We've created your Smart Marina Connect workspace -- click below to set your password and complete your participation. M3 will confirm your registration (and send any invoice) shortly.</p>
<table role="presentation" cellspacing="0" cellpadding="0" style="margin:0 auto;"><tr><td style="background:#0b2653;border-radius:8px;">
<a href="${link}" target="_blank" style="display:inline-block;padding:14px 32px;color:#fff;font-size:15px;font-weight:600;text-decoration:none;">Set my password &amp; access my registration</a>
</td></tr></table>
<p style="margin:28px 0 0;color:#9ca3af;font-size:13px;line-height:1.5;">If you didn't register for this event, you can safely ignore this email.</p>
</td></tr>
<tr><td style="padding:24px 40px;background:#f9fafb;border-top:1px solid #e5e7eb;text-align:center;">
<p style="margin:0;color:#9ca3af;font-size:12px;">&copy; ${new Date().getFullYear()} Smart Marina Connect</p></td></tr>
</table></td></tr></table></body></html>`.trim();

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: SENDER_EMAIL,
      to: [email],
      subject: "Your Smart Marina Rendezvous 2026 registration",
      html,
    }),
  });
  if (!res.ok) console.error("Resend error", res.status, await res.text());
}

// Notify M3 that a new registration came in (guest path).
async function sendAdminAlert(d: { first: string; last: string; email: string; company: string | null; role: string }) {
  const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
  const SENDER_EMAIL =
    Deno.env.get("SENDER_EMAIL") || "Smart Marina Connect <noreply@smartmarinaconnect.com>";
  if (!RESEND_API_KEY) return;
  const name = `${d.first} ${d.last}`.trim();
  const html =
    `<p>A new registration came in for the <strong>Smart &amp; Sustainable Marina Rendezvous 2026</strong>:</p>` +
    `<p><strong>${name}</strong>${d.company ? ` -- ${d.company}` : ""}<br>Role: ${d.role}<br>${d.email}</p>` +
    `<p><a href="${SITE_URL}/admin/sm26" style="background:#0b2653;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none;display:inline-block">Open the registrations console</a></p>`;
  try {
    await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: SENDER_EMAIL,
        to: [ADMIN_EMAIL],
        subject: `New registration -- ${name}${d.company ? ` (${d.company})` : ""}`,
        html,
      }),
    });
  } catch (e) {
    console.error("admin alert failed", e);
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors(req) });
  if (req.method !== "POST") return json(req, { error: "Method not allowed" }, 405);

  let payload: Record<string, unknown>;
  try {
    payload = await req.json();
  } catch {
    return json(req, { error: "Invalid JSON" }, 400);
  }

  const honeypot = payload.honeypot;
  const origin = typeof payload.origin === "string" ? payload.origin : "";
  const r = (payload.registration ?? {}) as Record<string, unknown>;
  const role = s(payload.role);
  const scope = payload.scope === "org" ? "org" : "user";
  const light = (payload.light ?? {}) as Record<string, unknown>;
  const extras = (payload.extras ?? {}) as Record<string, unknown>;
  const assetsIn = (payload.assets ?? {}) as Record<string, { name?: string; type?: string; data?: string }[]>;

  // Silently accept bots (honeypot field should always be empty)
  if (honeypot) return json(req, { status: "created" });

  const email = (typeof r.email === "string" ? r.email : "").trim().toLowerCase();
  const first = s(r.first_name);
  const last = s(r.last_name);
  if (!email || !first || !last) return json(req, { error: "Name and email are required" }, 400);
  if (!role) return json(req, { error: "Please choose how you want to participate" }, 400);
  if (!r.terms_accepted) return json(req, { error: "Terms must be accepted" }, 400);

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { data: ev } = await admin.from("sm_event").select("id").eq("slug", "sm26").maybeSingle();
  if (!ev) return json(req, { error: "Event not available" }, 400);
  const eventId = (ev as { id: string }).id;

  // Don't create a second registration when a LIVE one already exists for this
  // email -- typically an imported Jotform row not yet claimed (user_id still
  // null). Checked BEFORE creating an auth account so a duplicate attempt leaves
  // no orphan pw_pending account behind. Respond exactly like a fresh success
  // (anti-enumeration); the person inherits that record on login via
  // sm_autoclaim_by_email. Public endpoint -- we only READ here, never mutate a
  // record that may belong to someone else.
  const emailEsc = email.replace(/[\\%_]/g, (c) => `\\${c}`);
  const { data: liveByEmail } = await admin
    .from("sm_registration").select("id, status").eq("event_id", eventId).ilike("email", emailEsc);
  if ((liveByEmail as { status: string }[] | null || []).some(
    (x) => !["declined", "cancelled"].includes((x.status || "").toLowerCase())
  )) return json(req, { status: "ok" });

  // Provision a confirmed account (we send our own magic-link below)
  const { data: created, error: createErr } = await admin.auth.admin.createUser({
    email,
    email_confirm: true,
    user_metadata: {
      first_name: first,
      last_name: last,
      job_title: s(r.job_title) || "",
      persona: "individual",
      // Routed to the /welcome step (set a password) on first arrival;
      // cleared by the welcome page once done.
      pw_pending: true,
    },
  });

  let userId: string;
  if (createErr) {
    const msg = (createErr.message || "").toLowerCase();
    const code = (createErr as { code?: string }).code;
    const emailExists =
      code === "email_exists" ||
      msg.includes("already been registered") ||
      msg.includes("already registered") ||
      msg.includes("already exists");
    if (!emailExists) {
      console.error("createUser failed", createErr);
      return json(req, { error: "Registration could not be completed. Please try again." }, 400);
    }
    // Existing account: link the registration to it. Never reveal that the email
    // already exists -- respond exactly as for a brand-new signup (anti-enumeration).
    const { data: prof } = await admin.from("profiles").select("user_id").ilike("email", email).maybeSingle();
    if (!(prof as { user_id?: string } | null)?.user_id) return json(req, { status: "ok" });
    userId = (prof as { user_id: string }).user_id;
  } else {
    userId = created.user!.id;
  }

  // Idempotent: if this person already registered for the event, succeed quietly.
  const { data: dupReg } = await admin
    .from("sm_registration").select("id").eq("event_id", eventId).eq("user_id", userId).maybeSingle();
  if (dupReg) return json(req, { status: "ok" });

  const { data: reg, error: regErr } = await admin
    .from("sm_registration")
    .insert({
      event_id: eventId,
      user_id: userId,
      organization_id: null,
      first_name: first,
      last_name: last,
      email,
      phone: s(r.phone),
      company_name: s(r.company_name),
      website: s(r.website),
      country: s(r.country),
      job_title: s(r.job_title),
      how_heard: s(r.how_heard),
      objective: s(r.objective),
      billing_address: s(r.billing_address),
      vat_number: s(r.vat_number),
      num_attendees: typeof r.num_attendees === "number" && r.num_attendees > 0 ? Math.trunc(r.num_attendees) : null,
      prior_participation: r.prior_participation && typeof r.prior_participation === "object" && !Array.isArray(r.prior_participation) ? r.prior_participation : null,
      image_consent: !!r.image_consent,
      terms_accepted_at: new Date().toISOString(),
      status: "submitted",
    })
    .select("id")
    .single();
  if (regErr || !reg) {
    if ((regErr as { code?: string } | null)?.code === "23505") return json(req, { status: "ok" }); // already registered (race)
    console.error("registration insert failed", regErr);
    return json(req, { error: "Registration could not be completed. Please try again." }, 500);
  }

  const ap = await uploadAssets(admin, userId, assetsIn);
  const { data: ra, error: raErr } = await admin
    .from("sm_role_assignment")
    .insert({
      registration_id: (reg as { id: string }).id,
      event_id: eventId,
      organization_id: null,
      role,
      scope,
      depth: "full",
      source: "self",
      status: "self_submitted",
      module_data: { ...light, ...extras, ...ap },
    })
    .select("id")
    .single();
  if (raErr || !ra) {
    console.error("role insert failed", raErr);
    return json(req, { error: "Could not complete your registration. Please try again." }, 500);
  }
  const raId = (ra as { id: string }).id;

  if (role === "startup" && payload.startup) {
    const { error } = await admin
      .from("sm_startup_profile")
      .insert({ role_assignment_id: raId, event_id: eventId, logo_url: ap.logo_url?.[0] ?? null, deck_url: ap.deck?.[0] ?? null, product_images: ap.product_images ?? [], pitch_media_url: ap.pitch_media?.[0] ?? null, ...mapStartup(payload.startup as Record<string, unknown>) });
    if (error) console.error("startup insert failed", error);
  } else if ((role === "architect_pro" || role === "architect_student") && payload.arch) {
    const { error } = await admin.from("sm_architecture_entry").insert({
      role_assignment_id: raId,
      event_id: eventId,
      category: role === "architect_pro" ? "professional" : "student",
      logo_url: ap.logo_url?.[0] ?? null,
      company_image_url: ap.hero_image?.[0] ?? null,
      project_renders: ap.renders ?? [],
      ...mapArch(payload.arch as Record<string, unknown>),
    });
    if (error) console.error("architecture insert failed", error);
  } else if (role === "marina" && payload.marina) {
    const { error } = await admin
      .from("sm_marina_extra")
      .insert({ role_assignment_id: raId, event_id: eventId, organization_id: null, ...mapMarina(payload.marina as Record<string, unknown>) });
    if (error) console.error("marina insert failed", error);
  }

  // Alert M3 of the new registration (the participant gets their own email below).
  await sendAdminAlert({ first: first || "", last: last || "", email, company: s(r.company_name), role: role || "" });

  // Email the guest a magic-link to access their new workspace.
  try {
    const base = ALLOWED_ORIGINS.includes(origin) ? origin : "https://smartmarinaconnect.com";
    // Land on the welcome step (set password -> event hub). If the auth
    // redirect allow-list rejects the path and falls back to the site root,
    // the pw_pending metadata still routes them to /welcome client-side.
    const redirectTo = `${base}/welcome`;
    const { data: linkData, error: linkErr } = await admin.auth.admin.generateLink({
      type: "magiclink",
      email,
      options: { redirectTo },
    });
    if (linkErr) console.error("generateLink failed", linkErr);
    const actionLink = (linkData as { properties?: { action_link?: string } })?.properties?.action_link;
    if (actionLink) await sendAccessEmail(email, first || "", actionLink);
  } catch (e) {
    console.error("access email failed", e);
  }

  return json(req, { status: "ok" });
});
