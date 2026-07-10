import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// ONE resolver for every participant asset (logo / photo / deck / product images
// / renders / panels / hero / banner / slides / proof), across all storage
// locations (sm_startup_profile, sm_architecture_entry, sm_marina_extra columns
// + sm_role_assignment.module_data) and both key conventions (logo vs logo_url).
// It normalises them, applies the caller's audience scope, and returns SIGNED
// URLs (service role signs, so an owner can view their own imported/... files
// that per-user storage RLS would otherwise block). Every surface (participant
// hub, investor portfolio, jury, e-catalogue dossier, partner console) calls
// this instead of re-implementing asset resolution.
//
// Body: { registration_id } (all roles) or { role_assignment_id } (one role).
// Returns: { assets: [{ role, role_assignment_id, kind, label, url, is_image,
//            filename }], audience }

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";

const ALLOWED_ORIGINS = [
  "https://smartmarinaconnect.com", "https://m3connect.netlify.app", "https://m3connectv2.netlify.app",
  "http://localhost:5173", "http://localhost:3000",
];
const NETLIFY_SUBDOMAIN = /^https:\/\/[a-z0-9-]+--m3connect(v2)?\.netlify\.app$/;
const isAllowed = (o) => ALLOWED_ORIGINS.includes(o) || NETLIFY_SUBDOMAIN.test(o);
const cors = (req) => ({
  "Access-Control-Allow-Origin": isAllowed(req.headers.get("origin") || "") ? req.headers.get("origin") : ALLOWED_ORIGINS[0],
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
});
const json = (req, body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...cors(req) } });

const IMG_EXT = /\.(png|jpe?g|gif|webp|svg|avif)(\?|$)/i;
const isHttp = (v) => typeof v === "string" && /^https?:\/\//.test(v);
// A value that is an uploaded asset (storage path OR http url with a file-ish key)
const FILE_KEY = /(_url$|logo|image|photo|deck|slides|brochure|attachment|proof|document|pitch|banner|render|hero|press|panel|media|gallery)/i;
const NON_ASSET_KEY = /(portfolio_link|website|social|link$|_at$|_by$|consent)/i;

const one = (x) => (Array.isArray(x) ? (x[0] || null) : x);
const fileName = (v) => { try { return decodeURIComponent(String(v).split("/").pop() || "file"); } catch { return String(v).split("/").pop() || "file"; } };
const isImg = (v) => IMG_EXT.test(String(v));

// Turn a stored value (path, http url, JSON-array-as-string, or array) into a
// clean array of asset strings.
function toList(raw) {
  if (raw == null) return [];
  if (Array.isArray(raw)) return raw.filter((x) => typeof x === "string" && x.trim());
  if (typeof raw === "string") {
    const s = raw.trim();
    if (!s) return [];
    if (s.startsWith("[")) { try { const a = JSON.parse(s); return Array.isArray(a) ? a.filter((x) => typeof x === "string" && x.trim()) : []; } catch { /* fall through */ } }
    return [s];
  }
  return [];
}

function labelFor(kind, idx, total) {
  const base = { logo: "Logo", photo: "Photo", deck: "Pitch deck", product: "Product image", render: "Project image", panel: "Competition panel", hero: "Hero image", banner: "Banner", slides: "Slides", proof: "Proof of enrolment", pitch: "Pitch media", company_image: "Company image", press: "Press card", other: "File" }[kind] || "File";
  return total > 1 ? `${base} ${idx + 1}` : base;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors(req) });
  if (req.method !== "POST") return json(req, { error: "Method not allowed" }, 405);
  const admin = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { autoRefreshToken: false, persistSession: false } });

  const token = (req.headers.get("authorization") || "").replace("Bearer ", "");
  if (!token) return json(req, { error: "Unauthorized" }, 401);
  const { data: u } = await admin.auth.getUser(token);
  const uid = u?.user?.id;
  if (!uid) return json(req, { error: "Unauthorized" }, 401);

  let body;
  try { body = await req.json(); } catch { return json(req, { error: "Invalid JSON" }, 400); }
  let registrationId = (body.registration_id || "").trim();
  const roleAssignmentId = (body.role_assignment_id || "").trim();
  if (!registrationId && roleAssignmentId) {
    const { data: ra0 } = await admin.from("sm_role_assignment").select("registration_id").eq("id", roleAssignmentId).maybeSingle();
    registrationId = ra0?.registration_id || "";
  }
  if (!registrationId) return json(req, { error: "registration_id or role_assignment_id required" }, 400);

  const { data: regRow } = await admin.from("sm_registration")
    .select("id, event_id, user_id, organization_id, status").eq("id", registrationId).maybeSingle();
  const reg = regRow;
  if (!reg) return json(req, { error: "Registration not found" }, 404);

  // ---- Audience resolution ------------------------------------------------
  const { data: prof } = await admin.from("profiles").select("persona, access_status").eq("user_id", uid).maybeSingle();
  const persona = prof?.persona || "";
  const verified = prof?.access_status === "verified";
  const isStaff = ["admin", "moderator"].includes(persona) && verified;

  let canAccess = isStaff || reg.user_id === uid;
  if (!canAccess && reg.organization_id) {
    const { data: mem } = await admin.from("organization_members").select("id").eq("organization_id", reg.organization_id).eq("user_id", uid).maybeSingle();
    canAccess = !!mem;
  }

  let isYachtClub = false, isJuror = false, isInvestor = false;
  if (!canAccess) {
    const { data: yc } = await admin.from("sm_event_partner").select("id").eq("user_id", uid).eq("event_id", reg.event_id).eq("kind", "yacht_club").maybeSingle();
    isYachtClub = !!yc;
  }
  if (!canAccess && !isYachtClub) {
    // assigned juror for any of this registration's role assignments?
    const { data: ras } = await admin.from("sm_role_assignment").select("id").eq("registration_id", registrationId);
    const raIds = (ras || []).map((r) => r.id);
    if (raIds.length) {
      const { data: ja } = await admin.from("sm_jury_assignment").select("id").eq("juror_user_id", uid).in("entry_role_assignment_id", raIds).limit(1);
      isJuror = !!(ja && ja.length);
    }
    // accredited investor: persona investor + verified. (The persona-investor <->
    // confirmed-SM26-investor-role accreditation is already unified upstream, so
    // a confirmed SM26 investor carries persona 'investor'.)
    if (persona === "investor" && verified) isInvestor = true;
  }

  if (!isStaff && !canAccess && !isYachtClub && !isJuror && !isInvestor) return json(req, { error: "Forbidden" }, 403);
  const audience = isStaff ? "staff" : canAccess ? "owner" : isYachtClub ? "yacht_club" : isJuror ? "juror" : "investor";
  const blind = audience === "juror";           // jury is anonymous: no filenames
  const startupOnly = audience === "investor";  // investors only evaluate startups

  // ---- Load role assignments + their profile rows -------------------------
  let raQuery = admin.from("sm_role_assignment").select("id, role, status, module_data").eq("registration_id", registrationId);
  if (roleAssignmentId) raQuery = raQuery.eq("id", roleAssignmentId);
  const { data: roles } = await raQuery;
  const raList = (roles || []).filter((r) => r.status !== "declined");
  const raIds = raList.map((r) => r.id);
  const { data: startups } = await admin.from("sm_startup_profile").select("role_assignment_id, logo_url, deck_url, product_images, pitch_media_url").in("role_assignment_id", raIds.length ? raIds : ["00000000-0000-0000-0000-000000000000"]);
  const { data: archs } = await admin.from("sm_architecture_entry").select("role_assignment_id, logo_url, company_image_url, project_renders, proof_of_enrolment_url").in("role_assignment_id", raIds.length ? raIds : ["00000000-0000-0000-0000-000000000000"]);
  const startupBy = {}; (startups || []).forEach((s) => { startupBy[s.role_assignment_id] = s; });
  const archBy = {}; (archs || []).forEach((a) => { archBy[a.role_assignment_id] = a; });

  // ---- Normalise ----------------------------------------------------------
  const raw = []; // {role, ra, kind, path}
  const push = (role, ra, kind, val) => { for (const p of toList(val)) raw.push({ role, ra, kind, path: p }); };

  for (const r of raList) {
    if (startupOnly && r.role !== "startup") continue;
    const md = r.module_data || {};
    const su = startupBy[r.id];
    const ar = archBy[r.id];

    if (su) {
      push(r.role, r.id, "logo", su.logo_url);
      push(r.role, r.id, "deck", su.deck_url);
      push(r.role, r.id, "product", su.product_images);
      push(r.role, r.id, "pitch", su.pitch_media_url);
    }
    if (ar) {
      push(r.role, r.id, "logo", ar.logo_url);
      push(r.role, r.id, "company_image", ar.company_image_url);
      push(r.role, r.id, "render", ar.project_renders);
      if (!blind) push(r.role, r.id, "proof", ar.proof_of_enrolment_url);
    }
    // module_data asset keys (covers marina, jury, media, sponsor, speaker,
    // investor, vip + any duplicated startup/arch keys)
    for (const [k, v] of Object.entries(md)) {
      if (k.startsWith("_")) continue;
      if (NON_ASSET_KEY.test(k)) continue;
      if (!FILE_KEY.test(k)) continue;
      const kind = /logo/i.test(k) ? "logo" : /photo/i.test(k) ? "photo" : /deck|pitch/i.test(k) ? "deck" : /product/i.test(k) ? "product" : /render|panel/i.test(k) ? "render" : /hero/i.test(k) ? "hero" : /banner/i.test(k) ? "banner" : /slides/i.test(k) ? "slides" : /press/i.test(k) ? "press" : /proof/i.test(k) ? "proof" : "other";
      if (blind && (kind === "logo" || kind === "photo")) continue; // anonymise
      push(r.role, r.id, kind, v);
    }
  }

  // Dedupe by (ra, path)
  const seen = new Set();
  const deduped = raw.filter((x) => { const key = x.ra + "|" + x.path; if (seen.has(key) || !x.path) return false; seen.add(key); return true; });

  // Group for stable labels per (ra, kind), then sign
  const counts = {};
  for (const x of deduped) { const k = x.ra + "|" + x.kind; counts[k] = (counts[k] || 0) + 1; }
  const idxMap = {};

  // Batch-sign storage paths
  const storagePaths = [...new Set(deduped.filter((x) => !isHttp(x.path)).map((x) => x.path))];
  const signed = {};
  if (storagePaths.length) {
    const { data: urls } = await admin.storage.from("event-media").createSignedUrls(storagePaths, 3600);
    for (const d of urls || []) { if (d && d.path && d.signedUrl) signed[d.path] = d.signedUrl; }
  }

  const assets = deduped.map((x) => {
    const gk = x.ra + "|" + x.kind;
    const idx = (idxMap[gk] = (idxMap[gk] || 0)); idxMap[gk] = idx + 1;
    const url = isHttp(x.path) ? x.path : (signed[x.path] || null);
    return {
      role: x.role,
      role_assignment_id: x.ra,
      kind: x.kind,
      label: labelFor(x.kind, idx, counts[gk]),
      url,
      is_image: isImg(x.path) || (!!url && isImg(url)),
      filename: blind ? null : fileName(x.path),
    };
  }).filter((a) => a.url);

  return json(req, { assets, audience });
});
