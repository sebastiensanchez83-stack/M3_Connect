// SM26 account provisioning -- turns a confirmed event registration into a real
// platform identity in one shot: auth account (if none), persona, verified
// status, company organization (create/link, member tier, verified) and the
// welcome email (magic link -> /welcome to set a password).
// Staff-triggered from the admin console (confirm dialog + backfill panel).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const SITE_URL = Deno.env.get("SITE_URL") || "https://smartmarinaconnect.com";

const ALLOWED_ORIGINS = [
  "https://smartmarinaconnect.com", "https://m3connect.netlify.app", "https://m3connectv2.netlify.app",
  "http://localhost:5173", "http://localhost:3000",
];
const NETLIFY_SUBDOMAIN = /^https:\/\/[a-z0-9-]+--m3connect(v2)?\.netlify\.app$/;
const isAllowed = (o: string) => ALLOWED_ORIGINS.includes(o) || NETLIFY_SUBDOMAIN.test(o);
const cors = (req: Request) => ({
  "Access-Control-Allow-Origin": isAllowed(req.headers.get("origin") || "") ? (req.headers.get("origin") as string) : ALLOWED_ORIGINS[0],
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
});
const json = (req: Request, body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...cors(req) } });

const PERSONAS = new Set(["marina", "partner", "media_partner", "investor", "individual", "developer"]);
const ORG_TYPES = new Set(["marina", "partner", "media_partner", "investor", "developer"]);

const slugify = (s: string) =>
  s.toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "org";

async function sendWelcomeEmail(email: string, firstName: string, link: string) {
  const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
  const SENDER_EMAIL = Deno.env.get("SENDER_EMAIL") || "Smart Marina Connect <noreply@smartmarinaconnect.com>";
  if (!RESEND_API_KEY) { console.error("RESEND_API_KEY not set"); return false; }
  const greeting = firstName ? `Hello ${firstName},` : "Hello,";
  const html = `
<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="margin:0;padding:0;background:#f4f5f7;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f4f5f7;padding:40px 20px;"><tr><td align="center">
<table role="presentation" width="600" cellspacing="0" cellpadding="0" style="background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,.06);">
<tr><td style="background:#0b2653;padding:32px 40px;text-align:center;">
<h1 style="margin:0;color:#fff;font-size:22px;font-weight:700;">Smart &amp; Sustainable Marina Rendezvous 2026</h1>
<p style="margin:6px 0 0;color:#93c5fd;font-size:13px;">20&ndash;21 September 2026 &middot; Yacht Club de Monaco</p></td></tr>
<tr><td style="padding:40px;">
<p style="margin:0 0 8px;color:#374151;font-size:16px;">${greeting}</p>
<h2 style="margin:0 0 16px;color:#111827;font-size:20px;font-weight:600;">Your participation is confirmed &mdash; your account is ready</h2>
<p style="margin:0 0 28px;color:#4b5563;font-size:15px;line-height:1.6;">M3 has confirmed your registration for the Rendezvous, and your Smart Marina Connect account is ready. Click below to set your password &mdash; you'll land in your event hub where you can complete your participation, and your account also gives you access to the Smart Marina Connect platform.</p>
<table role="presentation" cellspacing="0" cellpadding="0" style="margin:0 auto;"><tr><td style="background:#0b2653;border-radius:8px;">
<a href="${link}" target="_blank" style="display:inline-block;padding:14px 32px;color:#fff;font-size:15px;font-weight:600;text-decoration:none;">Set my password &amp; open my event hub</a>
</td></tr></table>
<p style="margin:28px 0 0;color:#9ca3af;font-size:13px;line-height:1.5;">If you weren't expecting this email, you can safely ignore it.</p>
</td></tr>
<tr><td style="padding:24px 40px;background:#f9fafb;border-top:1px solid #e5e7eb;text-align:center;">
<p style="margin:0;color:#9ca3af;font-size:12px;">Smart Marina Connect &middot; M3 Monaco</p></td></tr>
</table></td></tr></table></body></html>`.trim();
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: SENDER_EMAIL, to: [email], subject: "Your Smart Marina Connect account is ready", html }),
  });
  if (!res.ok) { console.error("Resend error", res.status, await res.text()); return false; }
  return true;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors(req) });
  if (req.method !== "POST") return json(req, { error: "Method not allowed" }, 405);

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE);

  // Staff gate
  const token = (req.headers.get("authorization") || "").replace("Bearer ", "");
  if (!token) return json(req, { error: "Unauthorized" }, 401);
  const { data: u } = await admin.auth.getUser(token);
  const uid = u?.user?.id;
  if (!uid) return json(req, { error: "Unauthorized" }, 401);
  const { data: prof } = await admin.from("profiles").select("persona, access_status").eq("user_id", uid).maybeSingle();
  const p = prof as { persona?: string; access_status?: string } | null;
  if (!p || !["admin", "moderator"].includes(p.persona || "") || p.access_status !== "verified") return json(req, { error: "Forbidden" }, 403);

  let body: {
    registration_id?: string; persona?: string;
    org?: "create" | "link" | "none"; org_name?: string; org_id?: string;
    send_email?: boolean;
  };
  try { body = await req.json(); } catch { return json(req, { error: "Invalid JSON" }, 400); }

  const persona = (body.persona || "individual").trim();
  if (!PERSONAS.has(persona)) return json(req, { error: `Invalid persona: ${persona}` }, 400);
  const orgMode = body.org || "none";
  const sendEmail = body.send_email !== false;

  const { data: regData } = await admin.from("sm_registration")
    .select("id, event_id, email, first_name, last_name, job_title, company_name, user_id, organization_id")
    .eq("id", body.registration_id || "").maybeSingle();
  if (!regData) return json(req, { error: "Registration not found" }, 404);
  const reg = regData as {
    id: string; event_id: string; email: string | null; first_name: string | null; last_name: string | null;
    job_title: string | null; company_name: string | null; user_id: string | null; organization_id: string | null;
  };
  const email = (reg.email || "").trim().toLowerCase();
  if (!email) return json(req, { error: "Registration has no email" }, 400);

  // 1) Ensure an auth account
  let userId = reg.user_id;
  let createdAccount = false;
  if (!userId) {
    const { data: created, error: createErr } = await admin.auth.admin.createUser({
      email,
      email_confirm: true,
      user_metadata: {
        first_name: reg.first_name || "", last_name: reg.last_name || "",
        job_title: reg.job_title || "", persona, pw_pending: true,
      },
    });
    if (createErr) {
      const msg = (createErr.message || "").toLowerCase();
      const exists = (createErr as { code?: string }).code === "email_exists" || msg.includes("already");
      if (!exists) { console.error("createUser failed", createErr); return json(req, { error: "Could not create the account" }, 500); }
      const { data: existing } = await admin.from("profiles").select("user_id").ilike("email", email).maybeSingle();
      userId = (existing as { user_id?: string } | null)?.user_id || null;
      if (!userId) return json(req, { error: "An auth user exists for this email but has no profile -- resolve in Supabase" }, 409);
    } else {
      userId = created.user!.id;
      createdAccount = true;
    }
  }

  // 2) Persona + access. Never touch staff, and never silently override an
  //    ESTABLISHED core identity: a real (non-'individual') persona is left
  //    exactly as-is -- no persona switch, no forced verification (which would
  //    bypass the core references gate). Only a fresh event identity
  //    ('individual', or a just-created account) is provisioned to the suggested
  //    persona. The caller is told when an identity was preserved.
  let profileNote: string | null = null;
  const { data: targetProf } = await admin.from("profiles").select("persona, access_status").eq("user_id", userId).maybeSingle();
  const tp = targetProf as { persona?: string; access_status?: string } | null;
  if (tp) {
    const ep = (tp.persona || "").trim();
    // A just-created account already carries the suggested persona (set in its
    // metadata at createUser), so it must NOT be mistaken for a pre-existing
    // identity -- only accounts that existed BEFORE this call are preserved.
    if (["admin", "moderator"].includes(ep)) {
      // staff -- never touched
    } else if (!createdAccount && ep !== "" && ep !== "individual") {
      profileNote = `This email already has a "${ep}" account -- left unchanged (persona, access and onboarding kept). Adjust in Admin > Users if it should differ.`;
    } else {
      const { error: profErr } = await admin.from("profiles")
        .update({ persona, access_status: "verified", onboarding_status: "completed" })
        .eq("user_id", userId);
      if (profErr) { console.error("profile update failed", profErr); return json(req, { error: `Profile update failed: ${profErr.message}` }, 500); }
    }
  }

  // 3) Organization
  let orgId: string | null = reg.organization_id;
  let orgCreated = false;
  if (orgMode === "create") {
    const name = (body.org_name || reg.company_name || "").trim();
    if (!name) return json(req, { error: "Organization name required" }, 400);
    const orgType = ORG_TYPES.has(persona) ? persona : "partner";
    let inserted: { id: string } | null = null;
    for (let attempt = 0; attempt < 4 && !inserted; attempt++) {
      const slug = attempt === 0 ? slugify(name) : `${slugify(name)}-${Math.floor(1000 + Math.random() * 9000)}`;
      const { data: org, error: orgErr } = await admin.from("organizations").insert({
        // access_status verified (M3 vouches for the company by provisioning it),
        // but onboarding_status is left at its 'draft' default: the org profile is
        // not actually complete (only the name is set), and provisioning an event
        // registration must not fabricate a "fully onboarded" org. Complete it
        // from the admin org sheet when the profile is filled.
        name, slug, organization_type: orgType, tier: "member",
        access_status: "verified",
        created_by_user_id: userId, owner_user_id: userId,
        website: null,
      }).select("id").single();
      if (!orgErr && org) inserted = org as { id: string };
      else if ((orgErr as { code?: string } | null)?.code !== "23505") {
        console.error("org insert failed", orgErr);
        return json(req, { error: `Organization creation failed: ${orgErr?.message}` }, 500);
      }
    }
    if (!inserted) return json(req, { error: "Could not find a free organization slug" }, 500);
    orgId = inserted.id;
    orgCreated = true;
    const { error: memErr } = await admin.from("organization_members").insert({ organization_id: orgId, user_id: userId, role: "owner" });
    if (memErr && (memErr as { code?: string }).code !== "23505") console.error("owner membership failed", memErr);
  } else if (orgMode === "link") {
    if (!body.org_id) return json(req, { error: "org_id required for link" }, 400);
    orgId = body.org_id;
    const { data: existingMem } = await admin.from("organization_members")
      .select("id").eq("organization_id", orgId).eq("user_id", userId).maybeSingle();
    if (!existingMem) {
      // Only the organization's owner of record joins as "owner"; everyone else
      // joins as a collaborator. This used to key off "does an owner member
      // already exist", which silently handed ownership away: the ~164
      // pre-created marina organizations have no members at all, so the first
      // event participant linked to one became its owner. claim_organization
      // only sets owner_user_id when the org has no owner member yet, so that
      // permanently locked the real manager out of their own organization when
      // they later entered their claim code -- repairable only by hand.
      const { data: orgRow } = await admin.from("organizations")
        .select("owner_user_id").eq("id", orgId).maybeSingle();
      const isOwnerOfRecord =
        !!userId && (orgRow as { owner_user_id: string | null } | null)?.owner_user_id === userId;
      const { error: memErr } = await admin.from("organization_members")
        .insert({ organization_id: orgId, user_id: userId, role: isOwnerOfRecord ? "owner" : "collaborator" });
      if (memErr && (memErr as { code?: string }).code !== "23505") console.error("link membership failed", memErr);
    }
  }

  // 4) Link the registration (+ org-scoped role assignments)
  const regPatch: Record<string, unknown> = { user_id: userId };
  if (orgId) regPatch.organization_id = orgId;
  const { error: linkErr } = await admin.from("sm_registration").update(regPatch).eq("id", reg.id);
  if (linkErr) { console.error("registration link failed", linkErr); return json(req, { error: `Could not link the registration: ${linkErr.message}` }, 500); }
  if (orgId) {
    await admin.from("sm_role_assignment").update({ organization_id: orgId })
      .eq("registration_id", reg.id).eq("scope", "org");
  }

  // 5) Welcome email (magic link -> /welcome)
  let emailed = false;
  if (sendEmail) {
    try {
      const { data: linkData, error: linkGenErr } = await admin.auth.admin.generateLink({
        type: "magiclink", email, options: { redirectTo: `${SITE_URL}/welcome` },
      });
      if (linkGenErr) console.error("generateLink failed", linkGenErr);
      const actionLink = (linkData as { properties?: { action_link?: string } })?.properties?.action_link;
      if (actionLink) emailed = await sendWelcomeEmail(email, reg.first_name || "", actionLink);
    } catch (e) { console.error("welcome email failed", e); }
  }

  return json(req, { ok: true, user_id: userId, organization_id: orgId, created_account: createdAccount, created_org: orgCreated, emailed, profile_note: profileNote });
});
