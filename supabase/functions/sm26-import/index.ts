// One-time SM26 Jotform import. Staff-only. Receives the raw CSV export in the
// request body, parses it, and inserts registrations + roles + module data with
// the service role. Existing platform accounts are linked by email; new ones
// get a claim_code.
//
// Collision-safe + enriching: if the person already has a LIVE registration for
// the event (whether a prior import or a self-signup), we do NOT create a second
// one. We ENRICH the existing record instead -- filling only fields that are
// still empty, never overwriting what is already there. If the Jotform role
// differs from the roles the person already holds, we do NOT add the role; we
// record it as a suggestion (import_role_suggestions) for staff to review and
// add with the existing add-role tool, which notifies the person.

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
const likeEsc = (s: string) => s.replace(/[\\%_]/g, c => `\\${c}`);

const PARTICIPATE: Record<string, string[]> = { "Jury member": ["jury", "investor"], "Marina": ["marina"], "Speaker": ["speaker"], "Startup / Scaleup": ["startup"], "Visitor": ["visitor"] };
const ORG = new Set(["marina", "startup", "sponsor"]);
const social = (r: string[], a: number, b: number, c: number, d: number) => clean({ linkedin: r[a], instagram: r[b], facebook: r[c], twitter: r[d] });
function genCode(used: Set<string>) { const A = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"; let c: string; do { c = "SM26-"; for (let i = 0; i < 6; i++) c += A[Math.floor(Math.random() * A.length)]; } while (used.has(c)); used.add(c); return c; }

const LIVE = (status: unknown) => !["declined", "cancelled"].includes(E(status).toLowerCase());

// A value that carries no information -- never used to fill or overwrite.
const isEmpty = (v: unknown) =>
  v == null || v === "" ||
  (Array.isArray(v) && v.length === 0) ||
  (typeof v === "object" && !Array.isArray(v) && Object.keys(v as object).length === 0);

// Fill-missing: keys of `candidate` that hold a value AND are empty (or absent)
// in `existing`. Never overwrites an existing non-empty value.
function fillMissing(existing: Record<string, unknown>, candidate: Record<string, unknown>): Record<string, unknown> {
  const patch: Record<string, unknown> = {};
  for (const k in candidate) {
    if (isEmpty(candidate[k])) continue;
    if (isEmpty(existing[k])) patch[k] = candidate[k];
  }
  return patch;
}

// ---- Row builders (shared by create + enrich) ------------------------------

// Base registration fields that may be enriched. Consent/legal (image_consent,
// terms_accepted_at) and identity linkage are deliberately excluded -- an
// import must not back-fill someone's consent or re-link their account.
function baseEnrichable(r: string[]): Record<string, unknown> {
  return {
    first_name: S(r[1]), last_name: S(r[2]), phone: S(r[4]), company_name: S(r[5]), website: S(r[6]),
    country: S(r[8]), job_title: S(r[7]), how_heard: S(r[9]),
    prior_participation: clean({ participated: r[10], events: r[11] }),
    objective: S(r[116]), billing_address: S(r[114]), vat_number: S(r[115]),
    num_attendees: parseInt(E(r[112]), 10) || null,
  };
}

// module_data captured per role. Startup/architect carry their data in typed
// profile tables instead, so return {} for them.
function roleModuleData(role: string, r: string[]): Record<string, string> {
  if (role === "jury") return clean({ domain: r[12], jury_category: r[38], ecat_consent: r[39], social_consent: r[40], bio: r[43], company_description: r[17], sustainability: r[18], references: r[19], logo_url: r[41], photo_url: r[42] });
  if (role === "investor") return clean({ domain: r[12], note: "Derived from jury registration" });
  if (role === "speaker") return clean({ domain: r[12], bio: r[43] || r[18], company_description: r[17], references: r[19], photo_url: r[20] || r[32], portfolio: r[33], linkedin: r[24] });
  if (role === "marina") return clean({ type: r[45], register_award: r[44], overview: r[60], services: r[61], sustainable_diff: r[62], total_berths: r[48], superyacht_berths: r[49], longest_berths: r[50], certification: r[53], yacht_club: r[54], logo_url: r[47], hd_images: r[63], building_images: r[64], pitch: r[65] });
  return {};
}

// Typed profile row for startup / marina (null for roles without one).
function typedProfile(role: string, r: string[], eventId: string, raId: string): { table: string; row: Record<string, unknown> } | null {
  if (role === "startup") return {
    table: "sm_startup_profile",
    row: {
      role_assignment_id: raId, event_id: eventId,
      startup_or_scaleup: S(r[86]), stage: S(r[99]), categories: ARR(r[91]), organization_activity: S(r[87]),
      problem: S(r[88]), solution: S(r[89]), differentiation: S(r[90]), usp: S(r[93]), target_markets: S(r[92]),
      business_model: S(r[96]), competitive_positioning: S(r[97]), collaboration_expected: S(r[98]),
      investment_seeking: BOOL(r[100]), investment_type: S(r[101]), funds_needed: S(r[102]), references_text: S(r[94]),
      logo_url: S(r[103]), deck_url: S(r[104]), product_images: ARR(r[95]), pitch_optin: !!E(r[110]), pitch_media_url: S(r[110]),
      social_links: social(r, 106, 107, 108, 109), visibility_level: 3,
    },
  };
  if (role === "marina") return {
    table: "sm_marina_extra",
    row: {
      role_assignment_id: raId, event_id: eventId,
      architectural_quality: S(r[71]), biodiversity: S(r[72]), water: S(r[74]), energy: S(r[76]),
      waste: S(r[78]), innovation: S(r[80]), security: S(r[82]), further_info: S(r[84]),
    },
  };
  return null;
}

// deno-lint-ignore no-explicit-any
type Admin = any;

// Insert (if absent) or fill-missing (if present) the typed profile for a role.
async function upsertTypedProfile(admin: Admin, role: string, r: string[], eventId: string, raId: string) {
  const tp = typedProfile(role, r, eventId, raId);
  if (!tp) return;
  const { data: existing } = await admin.from(tp.table).select("*").eq("role_assignment_id", raId).maybeSingle();
  if (!existing) { await admin.from(tp.table).insert(tp.row); return; }
  const { role_assignment_id: _a, event_id: _b, ...candidate } = tp.row as Record<string, unknown>;
  const patch = fillMissing(existing as Record<string, unknown>, candidate);
  if (Object.keys(patch).length) await admin.from(tp.table).update(patch).eq("role_assignment_id", raId);
}

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
  // One registration per COMPANY -- keep only the LATEST submission (by date).
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
  const result = {
    total: data.length, deduped: deduped.length,
    imported: 0, enriched: 0, skipped: 0, linked: 0,
    codes: [] as { email: string; code: string }[],
    role_suggestions: [] as { email: string; has_roles: string[]; suggested: string[] }[],
    errors: [] as { email: string; error: string }[],
  };

  for (const r of deduped) {
    const email = E(r[3]).toLowerCase();
    try {
      const roles = PARTICIPATE[E(r[15])] || ["visitor"];

      // Any registration already on this event for this email (case-insensitive,
      // LIKE-safe). A live one -> enrich; only declined/cancelled -> treat as
      // absent and create fresh (a cancelled person may re-register).
      const { data: existingRows } = await admin.from("sm_registration")
        .select("id, user_id, status, import_role_suggestions, first_name, last_name, phone, company_name, website, country, job_title, how_heard, prior_participation, objective, billing_address, vat_number, num_attendees")
        .eq("event_id", eventId).ilike("email", likeEsc(email));
      const existing = (existingRows as Record<string, unknown>[] | null || []).find(x => LIVE(x.status));

      if (existing) {
        const regId = existing.id as string;

        // 1) Base info -- fill only what is empty.
        const basePatch = fillMissing(existing, baseEnrichable(r));
        if (Object.keys(basePatch).length) {
          await admin.from("sm_registration").update({ ...basePatch, updated_at: new Date().toISOString() }).eq("id", regId);
        }

        // 2) Roles: enrich the ones the person already has; suggest the rest.
        const { data: existingRAs } = await admin.from("sm_role_assignment")
          .select("id, role, module_data").eq("registration_id", regId);
        const ras = (existingRAs as { id: string; role: string; module_data: Record<string, unknown> | null }[] | null) || [];
        const held = new Set(ras.map(x => x.role));
        const suggest: string[] = [];

        for (const role of roles) {
          const match = ras.find(x => x.role === role);
          if (match) {
            const md = roleModuleData(role, r);
            const mdPatch = fillMissing(match.module_data || {}, md);
            if (Object.keys(mdPatch).length) {
              await admin.from("sm_role_assignment").update({ module_data: { ...(match.module_data || {}), ...mdPatch } }).eq("id", match.id);
            }
            await upsertTypedProfile(admin, role, r, eventId, match.id);
          } else if (role !== "visitor") {
            suggest.push(role);
          }
        }

        // 3) Record any brand-new role suggestion (never auto-add).
        const prior = (existing.import_role_suggestions as string[] | null) || [];
        const fresh = suggest.filter(s => !prior.includes(s) && !held.has(s));
        if (fresh.length) {
          await admin.from("sm_registration").update({ import_role_suggestions: [...prior, ...fresh] }).eq("id", regId);
          result.role_suggestions.push({ email, has_roles: [...held], suggested: fresh });
        }

        result.enriched++;
        continue;
      }

      // --- No live registration: create a fresh one (original behaviour) -----
      const { data: uid } = await admin.rpc("sm_user_id_by_email", { p_email: email });
      const code = uid ? null : genCode(used);

      const { data: regRow, error: regErr } = await admin.from("sm_registration").insert({
        event_id: eventId, user_id: uid || null, source: "jotform_import", email,
        ...baseEnrichable(r),
        image_consent: BOOL(r[117]),
        terms_accepted_at: BOOL(r[118]) ? (dateISO(r[0]) || new Date().toISOString()) : null,
        claim_code: code, status: "submitted", created_at: dateISO(r[0]) || new Date().toISOString(),
      }).select("id").single();
      if (regErr) {
        // Partial unique indexes (event+email for imports, event+user) backstop
        // duplicates the LIVE-row lookup can't see -- e.g. re-importing someone
        // whose only existing row is declined/cancelled. Skip quietly, don't
        // create a second row and don't surface it as an error.
        if ((regErr as { code?: string }).code === "23505") { result.skipped++; continue; }
        throw regErr;
      }
      const rid = (regRow as { id: string }).id;

      for (const role of roles) {
        const scope = ORG.has(role) ? "org" : "user";
        const { data: raRow, error: raErr } = await admin.from("sm_role_assignment")
          .insert({ registration_id: rid, event_id: eventId, role, scope, depth: "full", source: "self", status: "self_submitted", module_data: roleModuleData(role, r) })
          .select("id").single();
        if (raErr) throw raErr;
        const raId = (raRow as { id: string }).id;
        await upsertTypedProfile(admin, role, r, eventId, raId);
      }

      result.imported++;
      if (uid) result.linked++; else if (code) result.codes.push({ email, code });
    } catch (e) {
      result.errors.push({ email, error: String((e as Error).message || e) });
    }
  }

  return json(req, result);
});
