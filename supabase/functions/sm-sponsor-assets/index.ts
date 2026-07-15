import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// Yacht Club (or staff) download bundle: every Smart Marina Event sponsor's
// uploaded marketing/e-catalogue assets — brand assets (logos), the files they
// provide for deliverables (A4 pages, brochures), and any designed e-catalogue
// page — returned as short-lived SIGNED urls. Signed server-side with the
// service role so the Yacht Club never needs blanket storage access (the
// sp_files_ycm storage policy is narrow/buggy) and the sponsor's own uploads
// stay private to sponsor + M3 + YCM. Gated to YCM (sm_event_partner
// kind='yacht_club') or verified staff.

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const SPONSORSHIP_BUCKET = "sponsorship-files";
const MEDIA_BUCKET = "event-media";
const EXPIRES = 60 * 60; // 1 hour

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

const IMG_EXT = /\.(png|jpe?g|webp|gif|svg|avif)$/i;
const isImage = (mime, filename) =>
  (typeof mime === "string" && mime.startsWith("image/")) || IMG_EXT.test(filename || "");

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors(req) });
  if (req.method !== "POST") return json(req, { error: "Method not allowed" }, 405);
  const db = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { autoRefreshToken: false, persistSession: false } });

  const token = (req.headers.get("authorization") || "").replace("Bearer ", "");
  if (!token) return json(req, { error: "Unauthorized" }, 401);
  const { data: u } = await db.auth.getUser(token);
  const uid = u?.user?.id;
  if (!uid) return json(req, { error: "Unauthorized" }, 401);

  // Gate: verified staff OR a Yacht Club event partner.
  const { data: prof } = await db.from("profiles").select("persona, access_status").eq("user_id", uid).maybeSingle();
  const isStaff = prof && ["admin", "moderator"].includes(prof.persona || "") && prof.access_status === "verified";
  let isYcm = false;
  if (!isStaff) {
    const { data: ep } = await db.from("sm_event_partner").select("id").eq("user_id", uid).eq("kind", "yacht_club").limit(1);
    isYcm = !!(ep && ep.length);
  }
  if (!isStaff && !isYcm) return json(req, { error: "Forbidden" }, 403);

  // Event benefits -> agreements -> sponsors (exclude renewed agreements).
  const { data: benefits } = await db.from("sp_agreement_benefit").select("id, agreement_id").eq("program", "SMART_MARINA_EVENT");
  const benefitList = benefits || [];
  const agreementIds = [...new Set(benefitList.map((b) => b.agreement_id).filter(Boolean))];
  if (agreementIds.length === 0) return json(req, { sponsors: [] });

  const { data: agreements } = await db.from("sp_agreement").select("id, sponsor_id, status").in("id", agreementIds);
  const liveAgreements = (agreements || []).filter((a) => a.status !== "renewed");
  const agrToSponsor = new Map(liveAgreements.map((a) => [a.id, a.sponsor_id]));
  const sponsorIds = [...new Set(liveAgreements.map((a) => a.sponsor_id).filter(Boolean))];
  if (sponsorIds.length === 0) return json(req, { sponsors: [] });

  // Only event benefits whose agreement is live map a deliverable to a sponsor.
  const benefitToSponsor = new Map();
  for (const b of benefitList) {
    const sp = agrToSponsor.get(b.agreement_id);
    if (sp) benefitToSponsor.set(b.id, sp);
  }
  const eventBenefitIds = [...benefitToSponsor.keys()];

  const { data: sponsors } = await db.from("sp_sponsor").select("id, company_name, organization_id").in("id", sponsorIds);
  const [{ data: brand }, { data: deliverables }] = await Promise.all([
    db.from("sp_brand_asset").select("sponsor_id, kind, label, storage_path, external_url, filename, mime").in("sponsor_id", sponsorIds),
    eventBenefitIds.length
      ? db.from("sp_deliverable_file").select("agreement_benefit_id, storage_path, external_url, filename, mime, review_status").in("agreement_benefit_id", eventBenefitIds)
      : Promise.resolve({ data: [] }),
  ]);

  // Optional: a designed e-catalogue page for a sponsor that is also a registrant.
  const orgIds = (sponsors || []).map((s) => s.organization_id).filter(Boolean);
  const regToSponsor = new Map();
  let ecatPages = [];
  if (orgIds.length) {
    const { data: regs } = await db.from("sm_registration").select("id, organization_id").in("organization_id", orgIds);
    const orgToSponsor = new Map((sponsors || []).filter((s) => s.organization_id).map((s) => [s.organization_id, s.id]));
    for (const r of regs || []) { const sp = orgToSponsor.get(r.organization_id); if (sp) regToSponsor.set(r.id, sp); }
    const regIds = [...regToSponsor.keys()];
    if (regIds.length) {
      const { data: pages } = await db.from("sm_ecat_page").select("registration_id, title, designed_file_path").in("registration_id", regIds).not("designed_file_path", "is", null);
      ecatPages = pages || [];
    }
  }

  // Collect paths to batch-sign, per bucket.
  const spPaths = new Set();
  const mediaPaths = new Set();
  for (const a of brand || []) if (a.storage_path) spPaths.add(a.storage_path);
  for (const d of deliverables || []) if (d.storage_path) spPaths.add(d.storage_path);
  for (const p of ecatPages) if (p.designed_file_path) mediaPaths.add(p.designed_file_path);

  const signMap = new Map();
  const signBatch = async (bucket, paths) => {
    if (!paths.length) return;
    const { data } = await db.storage.from(bucket).createSignedUrls(paths, EXPIRES);
    for (const s of data || []) if (s.path && s.signedUrl) signMap.set(`${bucket}:${s.path}`, s.signedUrl);
  };
  await Promise.all([signBatch(SPONSORSHIP_BUCKET, [...spPaths]), signBatch(MEDIA_BUCKET, [...mediaPaths])]);

  // Assemble per sponsor.
  const out = new Map();
  for (const s of sponsors || []) out.set(s.id, { sponsor_id: s.id, company_name: s.company_name || "Sponsor", assets: [] });
  const push = (sponsorId, asset) => { const g = out.get(sponsorId); if (g) g.assets.push(asset); };

  for (const a of brand || []) {
    const url = a.external_url || (a.storage_path ? signMap.get(`${SPONSORSHIP_BUCKET}:${a.storage_path}`) : null);
    if (!url) continue;
    push(a.sponsor_id, { group: "logo", label: a.label || a.kind || "Logo", filename: a.filename || a.label || "logo", url, is_image: isImage(a.mime, a.filename), is_external: !!a.external_url });
  }
  for (const d of deliverables || []) {
    const sponsorId = benefitToSponsor.get(d.agreement_benefit_id);
    if (!sponsorId) continue;
    const url = d.external_url || (d.storage_path ? signMap.get(`${SPONSORSHIP_BUCKET}:${d.storage_path}`) : null);
    if (!url) continue;
    push(sponsorId, { group: "deliverable", label: d.filename || "Deliverable", filename: d.filename || "deliverable", url, is_image: isImage(d.mime, d.filename), is_external: !!d.external_url, review_status: d.review_status || null });
  }
  for (const p of ecatPages) {
    const sponsorId = regToSponsor.get(p.registration_id);
    const url = p.designed_file_path ? signMap.get(`${MEDIA_BUCKET}:${p.designed_file_path}`) : null;
    if (!sponsorId || !url) continue;
    push(sponsorId, { group: "ecat", label: p.title || "E-catalogue page", filename: (p.title || "ecat-page") + ".pdf", url, is_image: false, is_external: false });
  }

  // Only sponsors that actually have something to download.
  const sponsorsOut = [...out.values()].filter((g) => g.assets.length > 0);
  return json(req, { sponsors: sponsorsOut });
});
