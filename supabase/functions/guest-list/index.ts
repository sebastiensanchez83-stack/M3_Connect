import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import QRCode from "https://esm.sh/qrcode@1.5.4";

// Guest-list events (gl_event / gl_guest): invitation-only events run on a
// plain guest list. First user: World Yachting Summit 2026 (/wys26).
//
// Public actions (no account): read the event, request an invitation, open
// one's personal page by token, accept/decline an invitation, request a
// plus-one once confirmed. Staff actions (admin/moderator JWT): approve or
// reject requests, send invitations, resend a mail, cancel a guest.
//
// Seats: everyone "confirmed" or "invited" (answer pending) holds a seat, so
// staff cannot promise more than the capacity. Accepting an invitation is
// never refused — the seat was held when it was sent.
//
// The entry QR encodes /admin/guest-list/<slug>/checkin?token=<token>. A staff
// phone scanning it lands on the check-in console. It is attached to the mail
// (inline + as a file), never fetched from a third party — see sm26-badge-email.

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const SITE_URL = Deno.env.get("SITE_URL") || "https://smartmarinaconnect.com";
const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY") || "";
const SENDER_DOMAIN_FROM = "noreply@smartmarinaconnect.com";

const ALLOWED_ORIGINS = [
  "https://smartmarinaconnect.com", "https://m3connect.netlify.app", "https://m3connectv2.netlify.app",
  "http://localhost:5173", "http://localhost:3000",
];
const NETLIFY_SUBDOMAIN = /^https:\/\/[a-z0-9-]+--m3connect(v2)?\.netlify\.app$/;
const isAllowed = (o: string) => ALLOWED_ORIGINS.includes(o) || NETLIFY_SUBDOMAIN.test(o);
const cors = (req: Request) => ({
  "Access-Control-Allow-Origin": isAllowed(req.headers.get("origin") || "") ? req.headers.get("origin")! : ALLOWED_ORIGINS[0],
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
});
const json = (req: Request, body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...cors(req) } });

const db = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { autoRefreshToken: false, persistSession: false } });

// ─── Anti-spam: Cloudflare Turnstile (public "request" action only) ─────────
// SOFT until TURNSTILE_ENFORCE is "true": a token that is present is always
// checked (present and invalid => refused), but a request with no token still
// goes through, because the pages that are live may not send one yet.
// TURNSTILE_SECRET_KEY unset => the check is skipped (logged once). Cloudflare
// unreachable, or a secret it does not accept => the request goes through
// (logged): our setup is at fault, not the visitor.
// The same helper is inlined in contact-submit and newsletter-subscribe.
const TURNSTILE_SECRET = Deno.env.get("TURNSTILE_SECRET_KEY") || "";
const TURNSTILE_ENFORCE = (Deno.env.get("TURNSTILE_ENFORCE") || "").trim().toLowerCase() === "true";
const TURNSTILE_SETUP_ERRORS = new Set(["missing-input-secret", "invalid-input-secret", "bad-request", "internal-error"]);
let turnstileSkipLogged = false;

const clientIp = (req: Request): string | null =>
  req.headers.get("cf-connecting-ip") || req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || req.headers.get("x-real-ip") || null;

/** true: the request may go on. false: answer with the "captcha" error and say nothing more. Never throws. */
async function turnstileAllows(token: unknown, ip: string | null): Promise<boolean> {
  if (!TURNSTILE_SECRET) {
    if (!turnstileSkipLogged) {
      turnstileSkipLogged = true;
      console.warn("guest-list: TURNSTILE_SECRET_KEY is not set, the Turnstile check is skipped");
    }
    return true;
  }
  const response = typeof token === "string" ? token.trim() : "";
  if (!response) return !TURNSTILE_ENFORCE;
  if (response.length > 2048) return false;
  try {
    const form = new URLSearchParams({ secret: TURNSTILE_SECRET, response });
    if (ip) form.set("remoteip", ip);
    const res = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
      method: "POST",
      body: form,
      signal: AbortSignal.timeout(5000),
    });
    const out = (await res.json().catch(() => null)) as { success?: boolean; "error-codes"?: string[] } | null;
    if (out?.success === true) return true;
    const codes = out?.["error-codes"] ?? [];
    if (!out || codes.some((c) => TURNSTILE_SETUP_ERRORS.has(c))) {
      console.error("guest-list: Turnstile siteverify could not judge the token", res.status, codes.join(","));
      return true;
    }
    return false;
  } catch (err) {
    console.error("guest-list: Turnstile siteverify unreachable", err instanceof Error ? err.name : "error");
    return true;
  }
}

const esc = (s: unknown) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
const clean = (s: unknown, max = 200) => (typeof s === "string" ? s.trim().slice(0, max) : "");
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Ev = { id: string; slug: string; title: string; capacity: number | null; notify_email: string | null; requests_open: boolean; settings: Record<string, any> };
type Guest = Record<string, any>;

async function loadEvent(slug: string): Promise<Ev | null> {
  const { data } = await db.from("gl_event").select("id, slug, title, capacity, notify_email, requests_open, settings").eq("slug", slug).maybeSingle();
  return data as Ev | null;
}
async function eventById(id: string): Promise<Ev | null> {
  const { data } = await db.from("gl_event").select("id, slug, title, capacity, notify_email, requests_open, settings").eq("id", id).maybeSingle();
  return data as Ev | null;
}
async function seatsHeld(eventId: string): Promise<number> {
  const { count } = await db.from("gl_guest").select("id", { count: "exact", head: true })
    .eq("event_id", eventId).in("status", ["confirmed", "invited"]);
  return count || 0;
}

// ─── Email ───────────────────────────────────────────────────────────────
function frame(ev: Ev, heading: string, body: string) {
  const s = ev.settings || {};
  return `
  <div style="font-family:Arial,Helvetica,sans-serif;max-width:560px;margin:0 auto;color:#111827">
    <div style="background:#18182D;color:#fff;padding:22px 24px;border-radius:8px 8px 0 0">
      <div style="font-size:12px;opacity:.75;text-transform:uppercase;letter-spacing:.6px">${esc(ev.title)}</div>
      <div style="font-size:20px;font-weight:700;margin-top:4px">${heading}</div>
    </div>
    <div style="border:1px solid #e5e7eb;border-top:none;padding:24px;border-radius:0 0 8px 8px;line-height:1.5">
      ${body}
      <p style="margin-top:28px;font-size:13px;color:#6b7280">${esc(s.date_label || "")}${s.venue ? ` · ${esc(s.venue)}` : ""}${s.city ? `, ${esc(s.city)}` : ""}</p>
    </div>
  </div>`;
}
const button = (href: string, label: string, color = "#18182D") =>
  `<a href="${href}" style="display:inline-block;background:${color};color:#fff;text-decoration:none;padding:12px 22px;border-radius:6px;font-weight:700;margin:4px 6px 4px 0">${label}</a>`;
const partsText = (g: Guest) =>
  g.conference && g.gala ? "the conference and the gala dinner" : g.gala ? "the gala dinner" : g.conference ? "the conference" : "the event";
const guestUrl = (ev: Ev, g: Guest) => `${SITE_URL}/${ev.slug}/guest?t=${g.token}`;
const checkinUrl = (ev: Ev, g: Guest) => `${SITE_URL}/admin/guest-list/${ev.slug}/checkin?token=${g.token}`;

async function qrPngBase64(text: string): Promise<string> {
  const dataUrl: string = await QRCode.toDataURL(text, {
    margin: 2, width: 600, errorCorrectionLevel: "M", color: { dark: "#000000ff", light: "#ffffffff" },
  });
  return dataUrl.split(",")[1] || "";
}

async function send(ev: Ev, to: string, subject: string, html: string, opts: { guestId?: string; kind: string; by?: string | null; attachments?: unknown[] }) {
  if (!RESEND_API_KEY) { console.error("no RESEND_API_KEY"); return false; }
  try {
    const resp = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: `${ev.title.replace(/[<>"]/g, "")} <${SENDER_DOMAIN_FROM}>`,
        to: [to],
        reply_to: ev.settings?.contact_email || "contact@smartmarinaconnect.com",
        subject, html,
        ...(opts.attachments ? { attachments: opts.attachments } : {}),
      }),
    });
    if (!resp.ok) { console.error("resend failed", await resp.text()); return false; }
    await db.from("gl_email_log").insert({ guest_id: opts.guestId || null, event_id: ev.id, kind: opts.kind, to_email: to, sent_by: opts.by || null })
      .then(() => {}, (e) => console.error("log failed", e));
    return true;
  } catch (e) { console.error("send error", e); return false; }
}

async function sendPass(ev: Ev, g: Guest, by: string | null) {
  const png = await qrPngBase64(checkinUrl(ev, g));
  const plusOneLine = g.plus_one_of
    ? ""
    : `<p>Would you like to bring a guest? You can ask for a plus-one from your personal page — each plus-one is reviewed by our team.</p>`;
  const html = frame(ev, "Your invitation is confirmed", `
    <p>Dear ${esc(g.first_name)},</p>
    <p>We are delighted to confirm your place at <strong>${esc(ev.title)}</strong> for <strong>${partsText(g)}</strong>.</p>
    <p style="text-align:center;margin:24px 0">
      <img src="cid:entryqr" alt="Entry QR code" width="240" height="240" style="border:1px solid #e5e7eb;border-radius:8px;padding:8px;background:#fff" />
    </p>
    <p style="font-size:13px;color:#6b7280;text-align:center">Show this QR code at the entrance — it is personal to you. It is also attached as <strong>entry-pass.png</strong>. No QR? Just give your name at the desk.</p>
    ${plusOneLine}
    <p>${button(guestUrl(ev, g), "Open my invitation")}</p>
    <p style="font-size:13px;color:#6b7280">${esc(ev.settings?.programme_note || "")}</p>`);
  return send(ev, g.email, `Your invitation is confirmed — ${ev.title}`, html, {
    guestId: g.id, kind: "pass", by,
    attachments: [
      { filename: "qr-inline.png", content: png, content_type: "image/png", content_id: "entryqr" },
      { filename: "entry-pass.png", content: png, content_type: "image/png" },
    ],
  });
}

async function sendInvitation(ev: Ev, g: Guest, by: string | null) {
  const url = guestUrl(ev, g);
  const s = ev.settings || {};
  const html = frame(ev, "You are invited", `
    <p>Dear ${esc(g.first_name)},</p>
    <p>It is our pleasure to invite you to <strong>${esc(ev.title)}</strong>${s.tagline ? ` — <em>${esc(s.tagline)}</em>` : ""}, on <strong>${esc(s.date_label || "")}</strong> at ${esc(s.venue || "")}, ${esc(s.city || "")}.</p>
    <p>This invitation is for <strong>${partsText(g)}</strong> and is personal to you.</p>
    <p>Please let us know whether you will join us:</p>
    <p>${button(`${url}&answer=accept`, "Accept", "#15803d")}${button(`${url}&answer=decline`, "Decline", "#6b7280")}</p>
    <p style="font-size:13px;color:#6b7280">Once you accept, you will receive your personal entry QR code by email.</p>`);
  return send(ev, g.email, `Invitation — ${ev.title}`, html, { guestId: g.id, kind: "invitation", by });
}

async function sendRequestAck(ev: Ev, g: Guest) {
  const html = frame(ev, g.plus_one_of ? "Plus-one request received" : "Request received", `
    <p>Dear ${esc(g.first_name)},</p>
    <p>Thank you for your interest in <strong>${esc(ev.title)}</strong>. Attendance is by invitation only; our team reviews every request and will come back to you by email.</p>`);
  return send(ev, g.email, `Your request — ${ev.title}`, html, { guestId: g.id, kind: "request_ack" });
}

async function sendReject(ev: Ev, g: Guest, by: string | null) {
  const html = frame(ev, "About your request", `
    <p>Dear ${esc(g.first_name)},</p>
    <p>Thank you for your interest in <strong>${esc(ev.title)}</strong>. Unfortunately we are not able to extend an invitation for this edition, as places are very limited. We hope to welcome you at a future event.</p>`);
  return send(ev, g.email, `Your request — ${ev.title}`, html, { guestId: g.id, kind: "reject", by });
}

async function notifyStaff(ev: Ev, g: Guest, host?: Guest | null) {
  if (!ev.notify_email) return;
  const rows: [string, unknown][] = [
    ["Name", `${g.first_name} ${g.last_name}`], ["Email", g.email], ["Phone", g.phone], ["Company", g.company],
    ["Job title", g.job_title], ["Country", g.country],
    ["Wishes to attend", [g.wants_conference && "Conference", g.wants_gala && "Gala dinner"].filter(Boolean).join(" + ")],
    ["Why", g.motivation],
  ];
  if (host) rows.unshift(["Plus-one of", `${host.first_name} ${host.last_name} (${host.email})`]);
  const table = rows.filter(([, v]) => v).map(([k, v]) =>
    `<tr><td style="padding:4px 12px 4px 0;color:#6b7280;vertical-align:top">${esc(k)}</td><td style="padding:4px 0">${esc(v)}</td></tr>`).join("");
  const html = frame(ev, host ? "New plus-one request" : "New invitation request", `
    <table style="font-size:14px;border-collapse:collapse">${table}</table>
    <p>${button(`${SITE_URL}/admin/guest-list/${ev.slug}`, "Review in the admin")}</p>`);
  await send(ev, ev.notify_email, `${host ? "Plus-one request" : "Invitation request"}: ${g.first_name} ${g.last_name} — ${ev.title}`, html, { guestId: g.id, kind: "staff_notify" });
}

// ─── Public views ────────────────────────────────────────────────────────
function publicEvent(ev: Ev) {
  return { slug: ev.slug, title: ev.title, requests_open: ev.requests_open, settings: ev.settings };
}
async function guestView(ev: Ev, g: Guest) {
  let host = null, plusOne = null;
  if (g.plus_one_of) {
    const { data } = await db.from("gl_guest").select("first_name, last_name").eq("id", g.plus_one_of).maybeSingle();
    host = data;
  } else {
    const { data } = await db.from("gl_guest").select("first_name, last_name, status")
      .eq("plus_one_of", g.id).not("status", "in", "(rejected,cancelled,declined)").order("created_at", { ascending: false }).limit(1);
    plusOne = data?.[0] || null;
  }
  return {
    event: publicEvent(ev),
    guest: {
      first_name: g.first_name, last_name: g.last_name, company: g.company, status: g.status, source: g.source,
      conference: g.conference, gala: g.gala, checked_in: !!g.checked_in_at,
      checkin_url: g.status === "confirmed" ? checkinUrl(ev, g) : null,
      is_plus_one: !!g.plus_one_of, host, plus_one: plusOne,
    },
  };
}

// ─── Handler ─────────────────────────────────────────────────────────────
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors(req) });
  if (req.method !== "POST") return json(req, { error: "Method not allowed" }, 405);
  let body: Record<string, any>;
  try { body = await req.json(); } catch { return json(req, { error: "Invalid JSON" }, 400); }
  const action = String(body.action || "");

  // ── Public ──
  if (action === "event") {
    const ev = await loadEvent(clean(body.slug, 60));
    if (!ev) return json(req, { error: "not_found" }, 404);
    return json(req, { event: publicEvent(ev) });
  }

  if (action === "request") {
    if (clean(body.website)) return json(req, { ok: true }); // honeypot: pretend success
    const ev = await loadEvent(clean(body.slug, 60));
    if (!ev) return json(req, { error: "not_found" }, 404);
    if (!ev.requests_open) return json(req, { error: "closed" }, 400);
    const g = {
      first_name: clean(body.first_name, 80), last_name: clean(body.last_name, 80),
      email: clean(body.email, 200).toLowerCase(), phone: clean(body.phone, 40), company: clean(body.company, 160),
      job_title: clean(body.job_title, 160), country: clean(body.country, 80), motivation: clean(body.motivation, 2000),
      wants_conference: body.wants_conference !== false, wants_gala: body.wants_gala !== false,
    };
    if (!g.first_name || !g.last_name || !EMAIL_RE.test(g.email) || !g.company || !g.job_title)
      return json(req, { error: "missing_fields" }, 400);
    if (!g.wants_conference && !g.wants_gala) return json(req, { error: "no_part" }, 400);
    // Anti-spam (Turnstile), after the field checks so a form refused for another
    // reason does not use up the visitor's single-use token. Soft until
    // TURNSTILE_ENFORCE is "true". A distinct code (400), so the page can say the
    // check did not go through; nothing else is given away.
    if (!(await turnstileAllows(body.captcha, clientIp(req)))) return json(req, { error: "captcha" }, 400);
    // Flood guard: a burst of requests in ten minutes is not people.
    const since = new Date(Date.now() - 10 * 60_000).toISOString();
    const { count } = await db.from("gl_guest").select("id", { count: "exact", head: true })
      .eq("event_id", ev.id).eq("source", "request").gte("created_at", since);
    if ((count || 0) > 40) return json(req, { error: "busy" }, 429);
    const { data: existing } = await db.from("gl_guest").select("id").eq("event_id", ev.id).eq("email", g.email).maybeSingle();
    // Same answer as a new request, whatever the existing status: this form must not reveal who is on the list.
    if (existing) return json(req, { ok: true });
    const { data: row, error } = await db.from("gl_guest").insert({ ...g, event_id: ev.id, source: "request", status: "requested" }).select("*").single();
    if (error) {
      if (error.code === "23505") return json(req, { ok: true });
      return json(req, { error: error.message }, 500);
    }
    await Promise.all([sendRequestAck(ev, row), notifyStaff(ev, row)]);
    return json(req, { ok: true });
  }

  if (action === "guest" || action === "rsvp" || action === "plus_one") {
    const token = clean(body.token, 40);
    if (!UUID_RE.test(token)) return json(req, { error: "not_found" }, 404);
    const { data: g } = await db.from("gl_guest").select("*").eq("token", token).maybeSingle();
    if (!g) return json(req, { error: "not_found" }, 404);
    const ev = await eventById(g.event_id);
    if (!ev) return json(req, { error: "not_found" }, 404);

    if (action === "rsvp") {
      const answer = body.answer;
      if (answer === "accept") {
        // Only an invitation (or an invitation they declined and now want back)
        // can be accepted by the guest. A request is accepted by staff.
        const canAccept = g.status === "invited" || (g.status === "declined" && g.source !== "request");
        if (g.status === "confirmed") return json(req, await guestView(ev, g));
        if (!canAccept) return json(req, { error: "not_allowed" }, 400);
        if (g.status === "declined" && ev.capacity != null && (await seatsHeld(ev.id)) >= ev.capacity)
          return json(req, { error: "full" }, 409);
        const { data: up } = await db.from("gl_guest").update({ status: "confirmed", responded_at: new Date().toISOString() })
          .eq("id", g.id).select("*").single();
        await sendPass(ev, up, null);
        return json(req, await guestView(ev, up));
      }
      if (answer === "decline") {
        if (!["invited", "confirmed"].includes(g.status)) return json(req, await guestView(ev, g));
        const { data: up } = await db.from("gl_guest").update({ status: "declined", responded_at: new Date().toISOString() })
          .eq("id", g.id).select("*").single();
        return json(req, await guestView(ev, up));
      }
      return json(req, { error: "bad_answer" }, 400);
    }

    if (action === "plus_one") {
      if (g.status !== "confirmed" || g.plus_one_of) return json(req, { error: "not_allowed" }, 400);
      const { data: open } = await db.from("gl_guest").select("id").eq("plus_one_of", g.id)
        .not("status", "in", "(rejected,cancelled,declined)").limit(1);
      if (open?.length) return json(req, { error: "already" }, 400);
      const p = {
        first_name: clean(body.first_name, 80), last_name: clean(body.last_name, 80), email: clean(body.email, 200).toLowerCase(),
        company: clean(body.company, 160), job_title: clean(body.job_title, 160), phone: clean(body.phone, 40),
      };
      if (!p.first_name || !p.last_name || !EMAIL_RE.test(p.email)) return json(req, { error: "missing_fields" }, 400);
      if (p.email === g.email.toLowerCase()) return json(req, { error: "same_email" }, 400);
      const { data: dupe } = await db.from("gl_guest").select("id").eq("event_id", ev.id).eq("email", p.email).maybeSingle();
      if (dupe) return json(req, { error: "email_taken" }, 400);
      const { data: row, error } = await db.from("gl_guest").insert({
        ...p, event_id: ev.id, source: "plus_one", status: "requested", plus_one_of: g.id,
        wants_conference: g.conference, wants_gala: g.gala,
      }).select("*").single();
      if (error) return json(req, { error: error.code === "23505" ? "email_taken" : error.message }, 400);
      await notifyStaff(ev, row, g);
      return json(req, await guestView(ev, g));
    }

    return json(req, await guestView(ev, g));
  }

  // ── Staff ──
  const jwt = (req.headers.get("authorization") || "").replace("Bearer ", "");
  const { data: u } = jwt ? await db.auth.getUser(jwt) : { data: null };
  const uid = u?.user?.id;
  if (!uid) return json(req, { error: "Unauthorized" }, 401);
  const { data: prof } = await db.from("profiles").select("persona, access_status").eq("user_id", uid).maybeSingle();
  if (!prof || !["admin", "moderator"].includes(prof.persona || "") || prof.access_status !== "verified")
    return json(req, { error: "Forbidden" }, 403);

  const ev = body.event_id ? await eventById(clean(body.event_id, 40)) : await loadEvent(clean(body.slug, 60));
  if (!ev) return json(req, { error: "event not found" }, 404);
  const force = body.force === true;
  const now = new Date().toISOString();

  if (action === "decide") {
    const ids: string[] = (Array.isArray(body.guest_ids) ? body.guest_ids : []).filter((x: unknown) => typeof x === "string" && UUID_RE.test(x));
    if (!ids.length) return json(req, { error: "no guests" }, 400);
    const { data: rows } = await db.from("gl_guest").select("*").eq("event_id", ev.id).in("id", ids);
    const pending = (rows || []).filter((r) => r.status === "requested");
    if (body.decision === "approve") {
      if (ev.capacity != null && !force) {
        const held = await seatsHeld(ev.id);
        if (held + pending.length > ev.capacity) return json(req, { error: "capacity", held, capacity: ev.capacity, adding: pending.length }, 409);
      }
      let sent = 0, failed = 0;
      for (const r of pending) {
        const conference = typeof body.conference === "boolean" ? body.conference : r.wants_conference;
        const gala = typeof body.gala === "boolean" ? body.gala : r.wants_gala;
        const { data: up } = await db.from("gl_guest").update({ status: "confirmed", conference, gala, decided_at: now, decided_by: uid })
          .eq("id", r.id).eq("status", "requested").select("*").maybeSingle();
        if (!up) continue;
        (await sendPass(ev, up, uid)) ? sent++ : failed++;
      }
      return json(req, { ok: true, approved: pending.length, sent, failed, skipped: ids.length - pending.length });
    }
    if (body.decision === "reject") {
      let sent = 0;
      for (const r of pending) {
        const { data: up } = await db.from("gl_guest").update({ status: "rejected", decided_at: now, decided_by: uid })
          .eq("id", r.id).eq("status", "requested").select("*").maybeSingle();
        if (up && body.notify === true && (await sendReject(ev, up, uid))) sent++;
      }
      return json(req, { ok: true, rejected: pending.length, sent, skipped: ids.length - pending.length });
    }
    return json(req, { error: "bad decision" }, 400);
  }

  if (action === "invite") {
    const list: Record<string, unknown>[] = Array.isArray(body.guests) ? body.guests.slice(0, 500) : [];
    const conference = body.conference !== false, gala = body.gala !== false;
    if (!conference && !gala) return json(req, { error: "Choose conference, gala or both" }, 400);
    const valid: Guest[] = [], invalid: string[] = [];
    const seen = new Set<string>();
    for (const x of list) {
      const g = {
        first_name: clean(x.first_name, 80), last_name: clean(x.last_name, 80), email: clean(x.email, 200).toLowerCase(),
        company: clean(x.company, 160), job_title: clean(x.job_title, 160), phone: clean(x.phone, 40), country: clean(x.country, 80),
      };
      if (!g.first_name || !g.last_name || !EMAIL_RE.test(g.email) || seen.has(g.email)) { invalid.push(g.email || `${g.first_name} ${g.last_name}`.trim() || "(empty row)"); continue; }
      seen.add(g.email); valid.push(g);
    }
    const { data: existingRows } = valid.length
      ? await db.from("gl_guest").select("email, status").eq("event_id", ev.id).in("email", valid.map((g) => g.email))
      : { data: [] };
    const existing = new Map((existingRows || []).map((r) => [r.email.toLowerCase(), r.status]));
    const fresh = valid.filter((g) => !existing.has(g.email));
    const alreadyOnList = valid.filter((g) => existing.has(g.email)).map((g) => `${g.email} (${existing.get(g.email)})`);
    if (ev.capacity != null && !force) {
      const held = await seatsHeld(ev.id);
      if (held + fresh.length > ev.capacity) return json(req, { error: "capacity", held, capacity: ev.capacity, adding: fresh.length }, 409);
    }
    let sent = 0, failed = 0;
    for (const g of fresh) {
      const { data: row, error } = await db.from("gl_guest").insert({
        ...g, event_id: ev.id, source: "invitation", status: "invited", conference, gala,
        wants_conference: conference, wants_gala: gala, invited_at: now, decided_by: uid, decided_at: now,
      }).select("*").single();
      if (error || !row) { failed++; continue; }
      (await sendInvitation(ev, row, uid)) ? sent++ : failed++;
    }
    return json(req, { ok: true, invited: fresh.length, sent, failed, already_on_list: alreadyOnList, invalid });
  }

  if (action === "resend" || action === "cancel" || action === "update") {
    const id = clean(body.guest_id, 40);
    const { data: g } = await db.from("gl_guest").select("*").eq("event_id", ev.id).eq("id", id).maybeSingle();
    if (!g) return json(req, { error: "guest not found" }, 404);
    if (action === "resend") {
      if (g.status === "invited") return json(req, { ok: await sendInvitation(ev, g, uid), kind: "invitation" });
      if (g.status === "confirmed") return json(req, { ok: await sendPass(ev, g, uid), kind: "pass" });
      return json(req, { error: `Nothing to resend for a guest who is ${g.status}` }, 400);
    }
    if (action === "cancel") {
      await db.from("gl_guest").update({ status: "cancelled", decided_at: now, decided_by: uid }).eq("id", g.id);
      return json(req, { ok: true });
    }
    // update: change access (conference/gala) of a guest; optionally re-send the pass
    const patch: Record<string, unknown> = {};
    if (typeof body.conference === "boolean") patch.conference = body.conference;
    if (typeof body.gala === "boolean") patch.gala = body.gala;
    if (typeof body.admin_note === "string") patch.admin_note = clean(body.admin_note, 2000);
    const { data: up } = await db.from("gl_guest").update(patch).eq("id", g.id).select("*").single();
    return json(req, { ok: true, guest: up });
  }

  return json(req, { error: "Unknown action" }, 400);
});
