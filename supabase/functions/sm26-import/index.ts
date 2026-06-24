// One-time SM26 Jotform import. Staff-only. Receives the raw CSV export in the
// request body, parses it, and inserts registrations + roles + module data with
// the service role. Existing platform accounts are linked by email; new ones
// get a claim_code. Idempotent on (email, source='jotform_import').

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const ALLOWED = ["https://smartmarinaconnect.com", "https://m3connect.netlify.app", "http://localhost:5173", "http://localhost:3000"];
function cors(req: Request) {
  const o = req.headers.get("origin") || "";
  return { "Access-Control-Allow-Origin": ALLOWED.includes(o) ? o : ALLOWED[0], "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type", "Access-Control-Allow-Methods": "POST, OPTIONS" };
}
const json = (req: Request, b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { "Content-Type": "application/json", ...cors(req) } });

function parseCSV(str: string): string[][] {
  const rows: string[][] = []; let row: string[] = []; let f = ""; let i = 0; let q = false;
  while (i < str.length) {
    const c = str[i];
    if (q) { if (c === '"') { if (str[i + 1] === '"') { f += '"'; i += 2; continue; } q = false; i++; continue; } f += c; i++; continue; }
    if (c === '"') { q = true; i++; continue; }
    if (c === ',') { row.push(f); f = ""; i++; continue; }
    if (c === '\r') { i++; continue; }
    if (c === '\n') { row.push(f); rows.push(row); row = []; f = ""; i++; continue; }
    f += c; i++;
  }
  if (f.length || row.length) { row.push(f); rows.push(row); }
  return rows;
}

const E = (v: unknown) => (v == null ? "" : String(v)).trim();
const S = (v: unknown) => E(v) === "" ? null : E(v);
const BOOL = (v: unknown) => ["yes", "oui", "accepté", "accepted", "true", "1"].includes(E(v).toLowerCase());
const ARR = (v: unknown) => E(v).split(/\r?\n|;|,/).map(x => x.trim()).filter(Boolean);
const clean = (o: Record<string, unknown>) => { const r: Record<string, string> = {}; for (const k in o) { const x = o[k]; if (x != null && String(x).trim() !== "") r[k] = String(x).trim(); } return r; };
const dateISO = (v: unknown) => { const t = E(v); if (!t) return null; const d = new Date(t); return isNaN(d.getTime()) ? null : d.toISOString(); };

const PARTICIPATE: Record<string, string[]> = { "Jury member": ["jury", "investor"], "Marina": ["marina"], "Speaker": ["speaker"], "Startup / Scaleup": ["startup"], "Visitor": ["visitor"] };
const ORG = new Set(["marina", "startup", "sponsor"]);
const social = (r: string[], a: number, b: number, c: number, d: number) => clean({ linkedin: r[a], instagram: r[b], facebook: r[c], twitter: r[d] });
function genCode(used: Set<string>) { const A = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"; let c: string; do { c = "SM26-"; for (let i = 0; i < 6; i++) c += A[Math.floor(Math.random() * A.length)]; } while (used.has(c)); used.add(c); return c; }

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors(req) });
  if (req.method !== "POST") return json(req, { error: "Method not allowed" }, 405);
  const auth = req.headers.get("Authorization");
  if (!auth) return json(req, { error: "No auth token" }, 401);

  const url = Deno.env.get("SUPABASE_URL")!;
  const srk = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const anon = Deno.env.get("SUPABASE_ANON_KEY")!;

  const userClient = createClient(url, anon, { global: { headers: { Authorization: auth } } });
  const { data: isStaff } = await userClient.rpc("sm_is_staff");
  if (!isStaff) return json(req, { error: "Staff only" }, 403);

  let body: { csv?: string };
  try { body = await req.json(); } catch { return json(req, { error: "Invalid JSON" }, 400); }
  if (!body.csv) return json(req, { error: "Missing csv" }, 400);

  const admin = createClient(url, srk, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: ev } = await admin.from("sm_event").select("id").eq("slug", "sm26").maybeSingle();
  if (!ev) return json(req, { error: "Event not found" }, 400);
  const eventId = (ev as { id: string }).id;

  const rows = parseCSV(body.csv);
  const data = rows.slice(1).filter(r => E(r[3]) || E(r[1]));
  // One registration per COMPANY — keep only the LATEST submission (by date).
  // A company that submitted multiple times (even via different people) is
  // registered once. Falls back to email when no meaningful company is given.
  const NOVAL = new Set(["", "n/a", "na", "n.a.", "none", "-", "/", "."]);
  const keyOf = (r: string[]) => { const co = E(r[5]).toLowerCase().replace(/\s+/g, " "); return co && !NOVAL.has(co) ? "co:" + co : "em:" + E(r[3]).toLowerCase(); };
  const latest = new Map<string, { t: number; r: string[] }>();
  for (const r of data) {
    const k = keyOf(r);
    if (k === "co:" || k === "em:") continue;
    const d = new Date(E(r[0])); const t = isNaN(d.getTime()) ? 0 : d.getTime();
    const cur = latest.get(k);
    if (!cur || t >= cur.t) latest.set(k, { t, r });
  }
  const deduped = [...latest.values()].map(x => x.r);
  const used = new Set<string>();
  const result = { total: data.length, deduped: deduped.length, imported: 0, skipped: 0, linked: 0, codes: [] as { email: string; code: string }[], errors: [] as { email: string; error: string }[] };

  for (const r of deduped) {
    const email = E(r[3]).toLowerCase();
    try {
      const { data: existing } = await admin.from("sm_registration").select("id").eq("source", "jotform_import").ilike("email", email).maybeSingle();
      if (existing) { result.skipped++; continue; }
      const { data: uid } = await admin.rpc("sm_user_id_by_email", { p_email: email });
      const code = uid ? null : genCode(used);

      const { data: regRow, error: regErr } = await admin.from("sm_registration").insert({
        event_id: eventId, user_id: uid || null, source: "jotform_import",
        first_name: S(r[1]), last_name: S(r[2]), email, phone: S(r[4]), company_name: S(r[5]), website: S(r[6]),
        country: S(r[8]), job_title: S(r[7]), how_heard: S(r[9]),
        prior_participation: clean({ participated: r[10], events: r[11] }),
        objective: S(r[116]), image_consent: BOOL(r[117]),
        terms_accepted_at: BOOL(r[118]) ? (dateISO(r[0]) || new Date().toISOString()) : null,
        billing_address: S(r[114]), vat_number: S(r[115]),
        num_attendees: parseInt(E(r[112]), 10) || null,
        claim_code: code, status: "submitted", created_at: dateISO(r[0]) || new Date().toISOString(),
      }).select("id").single();
      if (regErr) throw regErr;
      const rid = (regRow as { id: string }).id;

      const roles = PARTICIPATE[E(r[15])] || ["visitor"];
      for (const role of roles) {
        const scope = ORG.has(role) ? "org" : "user";
        let md: Record<string, string> = {};
        if (role === "jury") md = clean({ domain: r[12], jury_category: r[38], ecat_consent: r[39], social_consent: r[40], bio: r[43], company_description: r[17], sustainability: r[18], references: r[19], logo_url: r[41], photo_url: r[42] });
        else if (role === "investor") md = clean({ domain: r[12], note: "Derived from jury registration" });
        else if (role === "speaker") md = clean({ domain: r[12], bio: r[43] || r[18], company_description: r[17], references: r[19], photo_url: r[20] || r[32], portfolio: r[33], linkedin: r[24] });
        else if (role === "marina") md = clean({ type: r[45], register_award: r[44], overview: r[60], services: r[61], sustainable_diff: r[62], total_berths: r[48], superyacht_berths: r[49], longest_berths: r[50], certification: r[53], yacht_club: r[54], logo_url: r[47], hd_images: r[63], building_images: r[64], pitch: r[65] });

        const { data: raRow, error: raErr } = await admin.from("sm_role_assignment").insert({ registration_id: rid, event_id: eventId, role, scope, depth: "full", source: "self", status: "self_submitted", module_data: md }).select("id").single();
        if (raErr) throw raErr;
        const raId = (raRow as { id: string }).id;

        if (role === "startup") {
          await admin.from("sm_startup_profile").insert({
            role_assignment_id: raId, event_id: eventId,
            startup_or_scaleup: S(r[86]), stage: S(r[99]), categories: ARR(r[91]), organization_activity: S(r[87]),
            problem: S(r[88]), solution: S(r[89]), differentiation: S(r[90]), usp: S(r[93]), target_markets: S(r[92]),
            business_model: S(r[96]), competitive_positioning: S(r[97]), collaboration_expected: S(r[98]),
            investment_seeking: BOOL(r[100]), investment_type: S(r[101]), funds_needed: S(r[102]), references_text: S(r[94]),
            logo_url: S(r[103]), deck_url: S(r[104]), product_images: ARR(r[95]), pitch_optin: !!E(r[110]), pitch_media_url: S(r[110]),
            social_links: social(r, 106, 107, 108, 109), visibility_level: 3,
          });
        } else if (role === "marina") {
          await admin.from("sm_marina_extra").insert({
            role_assignment_id: raId, event_id: eventId,
            architectural_quality: S(r[71]), biodiversity: S(r[72]), water: S(r[74]), energy: S(r[76]),
            waste: S(r[78]), innovation: S(r[80]), security: S(r[82]), further_info: S(r[84]),
          });
        }
      }
      result.imported++;
      if (uid) result.linked++; else if (code) result.codes.push({ email, code });
    } catch (e) {
      result.errors.push({ email, error: String((e as Error).message || e) });
    }
  }

  return json(req, result);
});
