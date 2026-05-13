// Nightly job that sends profile-completion reminders to users stuck
// in one of four states. Idempotent: the notification_sends table
// enforces a per-(user, type) cooldown so repeated invocations don't
// spam.
//
// Triggered by pg_cron at 08:00 UTC. Can also be invoked manually for
// testing; the cooldown protects against accidental bursts.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";

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

Deno.serve(async (_req: Request) => {
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
