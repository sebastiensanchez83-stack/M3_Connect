// SM26 media sync: copy participant images from the PRIVATE event-media bucket
// into the PUBLIC buckets and set them as account avatars (profiles.avatar_url),
// organization logos (organizations.logo_url) and org galleries
// (organizations.gallery). Staff-triggered, idempotent (only fills EMPTY targets,
// never overwrites), so it's safe to re-run — e.g. after importing new people.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";

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

const isPath = (v: unknown): v is string => typeof v === "string" && v.includes("/") && !/^https?:\/\//i.test(v);
const extOf = (p: string) => { const e = (p.split("/").pop() || "").split("?")[0].split(".").pop(); return e && e.length <= 5 ? e.toLowerCase() : "jpg"; };

// deno-lint-ignore no-explicit-any
async function copyToPublic(admin: any, src: string, bucket: string, dest: string): Promise<string | null> {
  const { data: blob, error } = await admin.storage.from("event-media").download(src);
  if (error || !blob) return null;
  const { error: upErr } = await admin.storage.from(bucket).upload(dest, blob, { contentType: (blob as Blob).type || "image/jpeg", upsert: true });
  if (upErr) return null;
  return admin.storage.from(bucket).getPublicUrl(dest).data.publicUrl;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors(req) });
  if (req.method !== "POST") return json(req, { error: "Method not allowed" }, 405);

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE);
  const token = (req.headers.get("authorization") || "").replace("Bearer ", "");
  if (!token) return json(req, { error: "Unauthorized" }, 401);
  const { data: u } = await admin.auth.getUser(token);
  const uid = u?.user?.id;
  if (!uid) return json(req, { error: "Unauthorized" }, 401);
  const { data: prof } = await admin.from("profiles").select("persona, access_status").eq("user_id", uid).maybeSingle();
  const p = prof as { persona?: string; access_status?: string } | null;
  if (!p || !["admin", "moderator"].includes(p.persona || "") || p.access_status !== "verified") return json(req, { error: "Forbidden" }, 403);

  const { data: ev } = await admin.from("sm_event").select("id").eq("slug", "sm26").maybeSingle();
  if (!ev) return json(req, { error: "Event not found" }, 404);
  const eventId = (ev as { id: string }).id;

  const { data: regs } = await admin.from("sm_registration")
    .select("id, user_id, organization_id, status, roles:sm_role_assignment(role, module_data, startup:sm_startup_profile(logo_url, product_images), arch:sm_architecture_entry(logo_url, company_image_url, project_renders))")
    .eq("event_id", eventId);
  // deno-lint-ignore no-explicit-any
  const list = (regs || []) as any[];

  let avatars = 0, logos = 0, galleries = 0;
  for (const r of list) {
    if (["declined", "cancelled"].includes(r.status)) continue;
    // deno-lint-ignore no-explicit-any
    const roles = (r.roles || []) as any[];

    // Account avatar from a headshot (jury/speaker photo) — only if none set.
    if (r.user_id) {
      const { data: pr } = await admin.from("profiles").select("avatar_url").eq("user_id", r.user_id).maybeSingle();
      if (pr && !pr.avatar_url) {
        let photo: string | null = null;
        for (const ra of roles) { const md = ra.module_data || {}; const c = md.photo ?? md.photo_url; if (isPath(c)) { photo = c; break; } }
        if (photo) {
          const url = await copyToPublic(admin, photo, "profile-images", `${r.user_id}/avatar-sm26.${extOf(photo)}`);
          if (url) { await admin.from("profiles").update({ avatar_url: url }).eq("user_id", r.user_id); avatars++; }
        }
      }
    }

    if (r.organization_id) {
      const { data: org } = await admin.from("organizations").select("logo_url, gallery").eq("id", r.organization_id).maybeSingle();
      if (org) {
        // Org logo — only if none set.
        if (!org.logo_url) {
          let logo: string | null = null;
          for (const ra of roles) { const sp = Array.isArray(ra.startup) ? ra.startup[0] : ra.startup; const ar = Array.isArray(ra.arch) ? ra.arch[0] : ra.arch; const md = ra.module_data || {}; const c = sp?.logo_url ?? ar?.logo_url ?? md.logo ?? md.logo_url; if (isPath(c)) { logo = c; break; } }
          if (logo) {
            const url = await copyToPublic(admin, logo, "org-logos", `${r.organization_id}/logo-sm26.${extOf(logo)}`);
            if (url) { await admin.from("organizations").update({ logo_url: url }).eq("id", r.organization_id); logos++; }
          }
        }
        // Org gallery from product images — only if empty.
        if (!org.gallery || (Array.isArray(org.gallery) && org.gallery.length === 0)) {
          let imgs: string[] = [];
          for (const ra of roles) {
            const sp = Array.isArray(ra.startup) ? ra.startup[0] : ra.startup;
            const ar = Array.isArray(ra.arch) ? ra.arch[0] : ra.arch;
            if (sp?.product_images?.length) { imgs = sp.product_images; break; }
            if (ar && (ar.company_image_url || ar.project_renders?.length)) { imgs = [ar.company_image_url, ...(ar.project_renders || [])].filter(Boolean); break; }
          }
          imgs = imgs.slice(0, 12);
          const urls: string[] = [];
          for (let i = 0; i < imgs.length; i++) { const src = imgs[i]; if (!isPath(src)) continue; const url = await copyToPublic(admin, src, "org-logos", `${r.organization_id}/gallery-sm26-${i}.${extOf(src)}`); if (url) urls.push(url); }
          if (urls.length) { await admin.from("organizations").update({ gallery: urls }).eq("id", r.organization_id); galleries++; }
        }
      }
    }
  }
  return json(req, { ok: true, avatars, logos, galleries });
});
