// Nightly job that sends profile-completion reminders to users stuck
// in one of four states. Idempotent: the notification_sends table
// enforces a per-(user, type) cooldown so repeated invocations don't
// spam.
//
// Triggered by pg_cron at 08:00 UTC (job "nightly-profile-reminders", which
// calls public.invoke_send_profile_reminders(); see migration
// 20261007104218_email_functions_rate_log_and_reminders_cron.sql).
//
// Security (audit S9, 7 Oct 2026): the function used to be public -- anyone
// could start a reminder round. It now runs only for a caller holding a
// service-role key: the edge-function env key itself, or another service-role
// JWT (the copy kept in Vault and sent by the pg_cron invoker), which GoTrue
// must accept as service role. verify_jwt stays false: the function checks
// its caller itself. To run it by hand, POST with
//   Authorization: Bearer <service_role key>

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") || "";

function sameSecret(a: string, b: string): boolean {
  if (!a || !b) return false;
  const enc = new TextEncoder();
  const x = enc.encode(a);
  const y = enc.encode(b);
  if (x.length !== y.length) return false;
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x[i] ^ y[i];
  return diff === 0;
}

/** Unverified read of a JWT's "role" claim -- only a pre-filter, never trusted alone. */
function jwtRole(token: string): string | null {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  try {
    const b64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const payload = JSON.parse(atob(b64 + "=".repeat((4 - (b64.length % 4)) % 4)));
    return typeof payload?.role === "string" ? payload.role : null;
  } catch {
    return null;
  }
}

/**
 * True for the env service-role key, or for another JWT that claims the
 * service_role AND that GoTrue accepts on an admin-only endpoint (which
 * verifies the signature). Anything else -- anon key, user JWTs, forged
 * tokens -- is refused.
 */
async function isServiceRole(token: string): Promise<boolean> {
  if (!token) return false;
  if (sameSecret(token, SUPABASE_SERVICE_ROLE_KEY)) return true;
  if (jwtRole(token) !== "service_role") return false;
  try {
    // apikey only gets the request through the API gateway; GoTrue authorises
    // admin endpoints from the Authorization JWT (signature + role claim).
    const r = await fetch(`${SUPABASE_URL}/auth/v1/admin/users?page=1&per_page=1`, {
      headers: { Authorization: `Bearer ${token}`, apikey: SUPABASE_ANON_KEY || token },
    });
    await r.body?.cancel();
    return r.ok;
  } catch {
    return false;
  }
}

interface ReminderRule {
  type: string;
  after_days: number;
  cooldown_days: number;
}

const REMINDERS: Record<string, ReminderRule> = {
  signup_stalled: {
    type: "profile_reminder_signup_stalled",
    after_days: 3,
    cooldown_days: 7,
  },
  onboarding_incomplete: {
    type: "profile_reminder_onboarding_incomplete",
    after_days: 5,
    cooldown_days: 9,
  },
  pending_review_followup: {
    type: "profile_reminder_pending_review_followup",
    after_days: 7,
    cooldown_days: 14,
  },
  verified_but_thin: {
    type: "profile_reminder_verified_but_thin",
    after_days: 14,
    cooldown_days: 30,
  },
};

interface Candidate {
  user_id: string;
  type: string;
  data: Record<string, string>;
}

interface RunResult {
  ok: boolean;
  candidates_considered: number;
  reminders_sent: number;
  skipped_cooldown: number;
  errors: string[];
  by_type: Record<string, { sent: number; skipped: number }>;
}

Deno.serve(async (req: Request) => {
  const bearer = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "").trim();
  if (!(await isServiceRole(bearer))) {
    return new Response(JSON.stringify({ ok: false, error: "Unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  const result: RunResult = {
    ok: true,
    candidates_considered: 0,
    reminders_sent: 0,
    skipped_cooldown: 0,
    errors: [],
    by_type: {},
  };

  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    return new Response(JSON.stringify({ ...result, ok: false, errors: ["Missing env vars"] }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  // ────────────────────────────────────────────────────────────────
  // 1) Gather candidates per reminder type
  // ────────────────────────────────────────────────────────────────

  const candidates: Candidate[] = [];

  // A) signup_stalled — email confirmed (i.e. profile exists), no
  //    organization, onboarding_status draft, age > 3 days
  {
    const r = REMINDERS.signup_stalled;
    const cutoff = new Date(Date.now() - r.after_days * 86400000).toISOString();

    // Step 1: find profiles meeting time + state criteria
    const { data: stalledProfiles, error } = await supabase
      .from("profiles")
      .select("user_id, first_name")
      .eq("onboarding_status", "draft")
      .eq("access_status", "pending")
      .not("persona", "in", "(admin,moderator)")
      .lt("created_at", cutoff);

    if (error) {
      result.errors.push(`signup_stalled query: ${error.message}`);
    } else if (stalledProfiles && stalledProfiles.length > 0) {
      // Step 2: filter out those with an organization membership
      const userIds = stalledProfiles.map((p) => p.user_id);
      const { data: members } = await supabase
        .from("organization_members")
        .select("user_id")
        .in("user_id", userIds);
      const withOrg = new Set((members ?? []).map((m: { user_id: string }) => m.user_id));

      for (const p of stalledProfiles) {
        if (!withOrg.has(p.user_id)) {
          candidates.push({
            user_id: p.user_id,
            type: r.type,
            data: { first_name: p.first_name ?? "" },
          });
        }
      }
    }
  }

  // B) onboarding_incomplete — has organization, onboarding_status
  //    draft, age > 5 days
  {
    const r = REMINDERS.onboarding_incomplete;
    const cutoff = new Date(Date.now() - r.after_days * 86400000).toISOString();

    const { data: rows, error } = await supabase
      .from("profiles")
      .select(`
        user_id, first_name,
        membership:organization_members!inner(
          organization:organizations(name, onboarding_status)
        )
      `)
      .eq("onboarding_status", "draft")
      .eq("access_status", "pending")
      .not("persona", "in", "(admin,moderator)")
      .lt("created_at", cutoff);

    if (error) {
      result.errors.push(`onboarding_incomplete query: ${error.message}`);
    } else {
      type Row = {
        user_id: string;
        first_name: string | null;
        membership: { organization: { name: string; onboarding_status: string } | null }[] | null;
      };
      for (const row of (rows as unknown as Row[] | null) ?? []) {
        const org = row.membership?.[0]?.organization;
        if (!org) continue;
        if (org.onboarding_status === "submitted" || org.onboarding_status === "completed") continue;
        candidates.push({
          user_id: row.user_id,
          type: r.type,
          data: { first_name: row.first_name ?? "", org_name: org.name },
        });
      }
    }
  }

  // C) pending_review_followup — onboarding submitted + access pending
  //    + submitted age > 7 days. We use profile updated_at as a proxy
  //    for "submitted at"; if there's no good signal, fall back to
  //    created_at.
  {
    const r = REMINDERS.pending_review_followup;
    const cutoff = new Date(Date.now() - r.after_days * 86400000).toISOString();

    const { data: rows, error } = await supabase
      .from("profiles")
      .select("user_id, first_name, updated_at")
      .eq("onboarding_status", "submitted")
      .eq("access_status", "pending")
      .not("persona", "in", "(admin,moderator)")
      .lt("updated_at", cutoff);

    if (error) {
      result.errors.push(`pending_review_followup query: ${error.message}`);
    } else {
      for (const p of rows ?? []) {
        candidates.push({
          user_id: p.user_id,
          type: r.type,
          data: { first_name: p.first_name ?? "" },
        });
      }
    }
  }

  // D) verified_but_thin — verified org but missing logo OR description
  //    AND verified > 14 days ago. Heuristic only (full completeness
  //    check would require more joins).
  {
    const r = REMINDERS.verified_but_thin;
    const cutoff = new Date(Date.now() - r.after_days * 86400000).toISOString();

    const { data: rows, error } = await supabase
      .from("organizations")
      .select("id, name, logo_url, description, updated_at, owner_user_id")
      .eq("access_status", "verified")
      .lt("updated_at", cutoff);

    if (error) {
      result.errors.push(`verified_but_thin query: ${error.message}`);
    } else {
      type Row = {
        id: string;
        name: string;
        logo_url: string | null;
        description: string | null;
        owner_user_id: string | null;
      };
      for (const row of (rows as unknown as Row[] | null) ?? []) {
        if (!row.owner_user_id) continue;
        const thin = !row.logo_url || !row.description || row.description.trim() === "";
        if (!thin) continue;
        candidates.push({
          user_id: row.owner_user_id,
          type: r.type,
          data: { org_name: row.name },
        });
      }
    }
  }

  result.candidates_considered = candidates.length;

  // ────────────────────────────────────────────────────────────────
  // 2) For each candidate, check cooldown then invoke send-notification
  // ────────────────────────────────────────────────────────────────

  for (const c of candidates) {
    if (!result.by_type[c.type]) {
      result.by_type[c.type] = { sent: 0, skipped: 0 };
    }

    // Cooldown check
    const rule = Object.values(REMINDERS).find((x) => x.type === c.type)!;
    const cutoff = new Date(Date.now() - rule.cooldown_days * 86400000).toISOString();

    const { data: recentSend } = await supabase
      .from("notification_sends")
      .select("sent_at")
      .eq("user_id", c.user_id)
      .eq("notification_type", c.type)
      .gte("sent_at", cutoff)
      .order("sent_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (recentSend) {
      result.skipped_cooldown += 1;
      result.by_type[c.type].skipped += 1;
      continue;
    }

    // Invoke send-notification
    try {
      const res = await fetch(`${SUPABASE_URL}/functions/v1/send-notification`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        },
        body: JSON.stringify({
          type: c.type,
          user_id: c.user_id,
          data: c.data,
        }),
      });

      if (!res.ok) {
        const text = await res.text();
        result.errors.push(`send ${c.type} to ${c.user_id}: ${text}`);
        continue;
      }

      // Log only on success
      await supabase.from("notification_sends").insert({
        user_id: c.user_id,
        notification_type: c.type,
      });

      result.reminders_sent += 1;
      result.by_type[c.type].sent += 1;
    } catch (err) {
      result.errors.push(`send ${c.type} to ${c.user_id}: ${(err as Error).message}`);
    }
  }

  console.log(`Reminders run: ${result.reminders_sent} sent, ${result.skipped_cooldown} skipped, ${result.errors.length} errors`);

  return new Response(JSON.stringify(result), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
});
