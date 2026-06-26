// Networking introductions. Staff-only. action 'introduce': email BOTH sides of a
// connection request (sharing each other's address) with Victor CC'd, then mark the
// request — and its mutual reverse, if any — as introduced. test_email previews to
// the tester only and does NOT mark introduced.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const ALLOWED_ORIGINS = [
  "https://smartmarinaconnect.com", "https://m3connect.netlify.app",
  "http://localhost:5173", "http://localhost:3000",
];
const NETLIFY_SUBDOMAIN = /^https:\/\/[a-z0-9-]+--m3connect\.netlify\.app$/;
const isAllowed = (o: string) => ALLOWED_ORIGINS.includes(o) || NETLIFY_SUBDOMAIN.test(o);
const cors = (req: Request) => ({
  "Access-Control-Allow-Origin": isAllowed(req.headers.get("origin") || "") ? (req.headers.get("origin") as string) : ALLOWED_ORIGINS[0],
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
});
const json = (req: Request, body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...cors(req) } });

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
const SENDER_EMAIL = Deno.env.get("SENDER_EMAIL") || "Smart Marina Connect <noreply@smartmarinaconnect.com>";
const ORGANIZER_EMAIL = "victor@m3monaco.com";

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors(req) });
  try {
    const token = (req.headers.get("authorization") || "").replace("Bearer ", "");
    if (!token) return json(req, { error: "Unauthorized" }, 401);
    const admin = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { autoRefreshToken: false, persistSession: false } });
    const { data: u } = await admin.auth.getUser(token);
    const uid = u?.user?.id;
    if (!uid) return json(req, { error: "Unauthorized" }, 401);
    const { data: prof } = await admin.from("profiles").select("persona, access_status").eq("user_id", uid).maybeSingle();
    const p = prof as { persona?: string; access_status?: string } | null;
    const isStaff = !!p && ["admin", "moderator"].includes(p.persona || "") && p.access_status === "verified";
    if (!isStaff) return json(req, { error: "Forbidden" }, 403);

    const body = await req.json().catch(() => ({}));
    if (body.action !== "introduce") return json(req, { error: "Unknown action" }, 400);
    if (!RESEND_API_KEY) return json(req, { error: "Email is not configured" }, 500);

    const connId = typeof body.connection_id === "string" ? body.connection_id : "";
    if (!connId) return json(req, { error: "Missing connection_id" }, 400);
    const testEmail = typeof body.test_email === "string" && body.test_email.includes("@") ? body.test_email.trim().toLowerCase() : null;

    const { data: cRow } = await admin.from("sm_connection").select("*").eq("id", connId).maybeSingle();
    const c = cRow as Record<string, unknown> | null;
    if (!c) return json(req, { error: "Connection not found" }, 404);

    type Side = { email?: string | null; name?: string; company?: string | null };
    const resolveReg = async (regId: string): Promise<Side> => {
      const { data } = await admin.from("sm_registration").select("email, first_name, last_name, company_name").eq("id", regId).maybeSingle();
      const r = data as { email?: string; first_name?: string; last_name?: string; company_name?: string } | null;
      return r ? { email: r.email, name: `${r.first_name || ""} ${r.last_name || ""}`.trim() || (r.company_name || "Participant"), company: (r.company_name || "").trim() || null } : {};
    };
    const resolveProfile = async (userId: string): Promise<Side> => {
      const { data } = await admin.from("profiles").select("email, first_name, last_name").eq("user_id", userId).maybeSingle();
      const r = data as { email?: string; first_name?: string; last_name?: string } | null;
      return r ? { email: r.email, name: `${r.first_name || ""} ${r.last_name || ""}`.trim() || "Participant", company: null } : {};
    };

    const to = await resolveReg(c.to_registration_id as string);
    let from: Side;
    if (c.from_registration_id) from = await resolveReg(c.from_registration_id as string);
    else if (c.from_user_id) from = await resolveProfile(c.from_user_id as string);
    else from = { email: (c.from_email as string) || null, name: (c.from_name as string) || (c.from_email as string) || "Guest", company: null };

    if (!to.email || !from.email) return json(req, { error: "One side has no email on file, so the introduction can't be sent." }, 400);

    const note = (c.note as string) || "";
    const line = (s: Side) => `<li><strong>${esc(s.name || "Participant")}</strong>${s.company ? `, ${esc(s.company)}` : ""} — <a href="mailto:${esc(String(s.email))}">${esc(String(s.email))}</a></li>`;
    const html = `<p>Hello,</p>
<p>Following the <strong>Smart &amp; Sustainable Marina Rendezvous 2026</strong>, we're glad to introduce you to each other:</p>
<ul>${line(from)}${line(to)}</ul>
${note ? `<p>Context noted at the event: “${esc(note)}”.</p>` : ""}
<p>We'll leave it with you to take the conversation forward — wishing you a productive connection.</p>
<p>Warm regards,<br>The Smart Marina Rendezvous team</p>`;

    const recipients = testEmail ? [testEmail] : [from.email, to.email];
    const payload: Record<string, unknown> = { from: SENDER_EMAIL, to: recipients, subject: "An introduction from the Smart Marina Rendezvous 2026", html };
    if (!testEmail) payload.cc = [ORGANIZER_EMAIL];
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!res.ok) { console.error("resend intro error", res.status, await res.text()); return json(req, { error: "Email failed to send" }, 502); }

    if (!testEmail) {
      const now = new Date().toISOString();
      await admin.from("sm_connection").update({ introduced_at: now }).eq("id", connId);
      // mark the mutual reverse (participant<->participant) introduced too
      if (c.from_registration_id) {
        await admin.from("sm_connection").update({ introduced_at: now })
          .eq("event_id", c.event_id as string)
          .eq("from_registration_id", c.to_registration_id as string)
          .eq("to_registration_id", c.from_registration_id as string)
          .is("introduced_at", null);
      }
    }
    return json(req, { ok: true, test: !!testEmail });
  } catch (e) {
    console.error("sm26-connection error", e);
    return json(req, { error: String((e as Error).message || e) }, 500);
  }
});
