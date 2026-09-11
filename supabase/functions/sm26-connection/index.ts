// Networking introductions. Staff-only. action 'introduce': email BOTH sides of a
// connection request (sharing each other's address) with Victor CC'd, then mark the
// pair — both directions, however each side came in — as introduced. test_email
// previews to the tester only and does NOT mark introduced.
//
// Who each side is comes from the DB resolver sm_connection_party (badge, exhibitor
// stand code, networking pass or typed details), the same one the admin list reads,
// so the email always goes to the people staff saw on screen.

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

// Quotes too: names and addresses typed by guests land inside href="mailto:…".
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
// Same rule as the DB (apostrophes are legal: o'brien@…); esc() makes them safe in HTML.
const EMAIL_RE = /^[^\s@"<>]+@[^\s@"<>]+\.[^\s@"<>]+$/;

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

    type Party = {
      note: string | null; introduced_at: string | null;
      from_name: string | null; from_email: string | null; from_company: string | null;
      to_name: string | null; to_email: string | null; to_company: string | null;
    };
    const { data: rows, error: partyErr } = await admin.rpc("sm_connection_party", { p_connection_id: connId });
    if (partyErr) { console.error("sm_connection_party", partyErr); return json(req, { error: "Could not load the connection" }, 500); }
    const c = (Array.isArray(rows) ? rows[0] : rows) as Party | undefined;
    if (!c) return json(req, { error: "Connection not found" }, 404);
    if (c.introduced_at && !testEmail) return json(req, { error: "This pair has already been introduced." }, 409);

    type Side = { email?: string | null; name?: string; company?: string | null };
    const from: Side = { email: c.from_email, name: c.from_name || c.from_email || "Guest", company: c.from_company };
    const to: Side = { email: c.to_email, name: c.to_name || c.to_company || "Participant", company: c.to_company };

    if (!to.email || !from.email) return json(req, { error: "One side has no email on file, so the introduction can't be sent." }, 400);
    if (!EMAIL_RE.test(to.email) || !EMAIL_RE.test(from.email)) return json(req, { error: "One side's email address doesn't look valid, so the introduction can't be sent." }, 400);

    const note = c.note || "";
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
      // The whole pair, both directions, matched the same way the admin list pairs them.
      const { error: markErr } = await admin.rpc("sm_connection_mark_introduced", { p_connection_id: connId });
      if (markErr) console.error("sm_connection_mark_introduced", markErr);
    }
    return json(req, { ok: true, test: !!testEmail });
  } catch (e) {
    console.error("sm26-connection error", e);
    return json(req, { error: String((e as Error).message || e) }, 500);
  }
});
