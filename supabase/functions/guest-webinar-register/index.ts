import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
const SENDER_EMAIL = Deno.env.get("SENDER_EMAIL") || "Smart Marina Connect <noreply@smartmarinaconnect.com>";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const SITE_URL = Deno.env.get("SITE_URL") || "https://smartmarinaconnect.com";

// Rate limits
const MAX_PER_IP_PER_HOUR = 5;
const MAX_PER_EMAIL_PER_HOUR = 3;

const ALLOWED_ORIGINS = [
  "https://smartmarinaconnect.com",
  "https://m3connect.netlify.app",
  "http://localhost:5173",
  "http://localhost:3000",
];

function getCorsOrigin(req: Request): string {
  const origin = req.headers.get("origin") || "";
  return ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
}

function corsHeaders(req: Request) {
  return {
    "Access-Control-Allow-Origin": getCorsOrigin(req),
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
  };
}

async function sha256(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hashBuffer)).map(b => b.toString(16).padStart(2, "0")).join("");
}

function getClientIp(req: Request): string {
  return (
    req.headers.get("cf-connecting-ip") ||
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    req.headers.get("x-real-ip") ||
    "unknown"
  );
}

function pad(n: number): string {
  return n < 10 ? `0${n}` : `${n}`;
}

function toICSDate(d: Date): string {
  return (
    d.getUTCFullYear().toString() +
    pad(d.getUTCMonth() + 1) +
    pad(d.getUTCDate()) +
    "T" +
    pad(d.getUTCHours()) +
    pad(d.getUTCMinutes()) +
    pad(d.getUTCSeconds()) +
    "Z"
  );
}

function escapeICSText(text: string): string {
  return text.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\n/g, "\\n");
}

interface EventRow {
  id: string;
  title: string;
  description: string | null;
  date_time: string | null;
  end_date_time: string | null;
  location: string | null;
  event_type: string;
  access_level: string | null;
  invitation_only: boolean | null;
  published: boolean | null;
}

function buildICS(event: EventRow, guestEmail: string): string {
  const start = event.date_time ? new Date(event.date_time) : new Date();
  const end = event.end_date_time ? new Date(event.end_date_time) : new Date(start.getTime() + 60 * 60 * 1000);
  const now = new Date();
  const eventUrl = `${SITE_URL}/events/${event.id}`;
  const descText = `${event.description || ""}\n\nJoin at: ${eventUrl}`;

  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Smart Marina Connect//Webinar//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    `UID:${event.id}@smartmarinaconnect.com`,
    `DTSTAMP:${toICSDate(now)}`,
    `DTSTART:${toICSDate(start)}`,
    `DTEND:${toICSDate(end)}`,
    `SUMMARY:${escapeICSText(event.title)}`,
    `DESCRIPTION:${escapeICSText(descText)}`,
    `LOCATION:${escapeICSText(event.location || eventUrl)}`,
    `URL:${eventUrl}`,
    `ORGANIZER;CN=Smart Marina Connect:mailto:noreply@smartmarinaconnect.com`,
    `ATTENDEE;CN=${guestEmail};RSVP=TRUE:mailto:${guestEmail}`,
    "STATUS:CONFIRMED",
    "BEGIN:VALARM",
    "TRIGGER:-PT15M",
    "ACTION:DISPLAY",
    `DESCRIPTION:Reminder: ${escapeICSText(event.title)}`,
    "END:VALARM",
    "END:VEVENT",
    "END:VCALENDAR",
  ];
  return lines.join("\r\n");
}

function formatHumanDate(isoString: string | null): string {
  if (!isoString) return "TBD";
  try {
    const d = new Date(isoString);
    return d.toLocaleString("en-GB", {
      weekday: "long",
      year: "numeric",
      month: "long",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      timeZoneName: "short",
    });
  } catch {
    return isoString;
  }
}

function buildConfirmationEmail(params: {
  firstName: string;
  event: EventRow;
}): { subject: string; html: string } {
  const { firstName, event } = params;
  const eventUrl = `${SITE_URL}/events/${event.id}`;
  const when = formatHumanDate(event.date_time);
  const subject = `You're registered — ${event.title}`;
  const year = new Date().getFullYear();
  const html = `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>${subject}</title></head>
<body style="margin:0;padding:0;background-color:#f4f5f7;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif;">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background-color:#f4f5f7;padding:40px 20px;">
<tr><td align="center">
<table role="presentation" width="600" cellspacing="0" cellpadding="0" style="background-color:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.06);">
<tr><td style="background-color:#0c4a6e;padding:32px 40px;text-align:center;">
<h1 style="margin:0;color:#ffffff;font-size:24px;font-weight:700;letter-spacing:-0.5px;">Smart Marina Connect</h1>
<p style="margin:6px 0 0;color:#93c5fd;font-size:13px;font-weight:400;">The B2B platform for the marina industry</p>
</td></tr>
<tr><td style="padding:40px;">
<p style="margin:0 0 8px;color:#374151;font-size:16px;line-height:1.5;">Hello ${firstName || "there"},</p>
<h2 style="margin:0 0 16px;color:#111827;font-size:20px;font-weight:600;">You're registered for the webinar</h2>
<p style="margin:0 0 24px;color:#4b5563;font-size:15px;line-height:1.6;">Thanks for signing up! Your spot is confirmed for:</p>
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background-color:#f9fafb;border:1px solid #e5e7eb;border-radius:8px;margin-bottom:24px;">
<tr><td style="padding:20px 24px;">
<p style="margin:0 0 8px;color:#0c4a6e;font-size:17px;font-weight:600;">${event.title}</p>
<p style="margin:0;color:#6b7280;font-size:14px;line-height:1.6;"><strong>When:</strong> ${when}</p>
</td></tr>
</table>
<p style="margin:0 0 24px;color:#4b5563;font-size:14px;line-height:1.6;">A calendar invite (.ics) is attached to this email so you can add it to your calendar in one click. We'll send you a reminder 24 hours before the webinar starts.</p>
<table role="presentation" cellspacing="0" cellpadding="0" style="margin:0 auto;">
<tr><td style="background-color:#0c4a6e;border-radius:8px;">
<a href="${eventUrl}" target="_blank" style="display:inline-block;padding:14px 32px;color:#ffffff;font-size:15px;font-weight:600;text-decoration:none;letter-spacing:0.3px;">View Webinar Details</a>
</td></tr></table>
<p style="margin:32px 0 0;color:#9ca3af;font-size:13px;line-height:1.5;">If you want full access to the platform (resources, events, partner network), you can <a href="${SITE_URL}/become-partner" style="color:#0c4a6e;">create a free account</a> with the same email and your registration will be automatically linked.</p>
</td></tr>
<tr><td style="padding:24px 40px;background-color:#f9fafb;border-top:1px solid #e5e7eb;text-align:center;">
<p style="margin:0;color:#9ca3af;font-size:12px;">&copy; ${year} Smart Marina Connect</p>
</td></tr>
</table>
</td></tr></table>
</body></html>`;
  return { subject, html };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders(req) });
  }

  const headers = { "Content-Type": "application/json", ...corsHeaders(req) };

  try {
    const body = await req.json();
    const eventId: string | undefined = body.event_id;
    const firstName: string = (body.first_name || "").trim();
    const lastName: string = (body.last_name || "").trim();
    const email: string = (body.email || "").trim().toLowerCase();
    const company: string | null = body.company ? String(body.company).trim() : null;

    if (!eventId || !firstName || !lastName || !email) {
      return new Response(JSON.stringify({ error: "Missing required fields" }), { status: 400, headers });
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return new Response(JSON.stringify({ error: "Invalid email format" }), { status: 400, headers });
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // ── Rate limiting ────────────────────────────────
    const ip = getClientIp(req);
    const ipHash = await sha256(`ip:${ip}`);
    const emailHash = await sha256(`email:${email}`);
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();

    const [ipCount, emailCount] = await Promise.all([
      supabase.from("guest_signup_rate_limits").select("id", { count: "exact", head: true }).eq("ip_hash", ipHash).gte("created_at", oneHourAgo),
      supabase.from("guest_signup_rate_limits").select("id", { count: "exact", head: true }).eq("email_hash", emailHash).gte("created_at", oneHourAgo),
    ]);

    if ((ipCount.count ?? 0) >= MAX_PER_IP_PER_HOUR) {
      return new Response(JSON.stringify({ error: "Too many signups from this network. Please try again later.", code: "RATE_LIMIT_IP" }), { status: 429, headers });
    }
    if ((emailCount.count ?? 0) >= MAX_PER_EMAIL_PER_HOUR) {
      return new Response(JSON.stringify({ error: "This email has reached the signup limit. Please try again later.", code: "RATE_LIMIT_EMAIL" }), { status: 429, headers });
    }

    // ── Fetch event (validate it's an eligible public webinar) ────────────────
    const { data: event, error: eventError } = await supabase
      .from("events")
      .select("id, title, description, date_time, end_date_time, location, event_type, access_level, invitation_only, published")
      .eq("id", eventId)
      .maybeSingle();

    if (eventError || !event) {
      return new Response(JSON.stringify({ error: "Event not found" }), { status: 404, headers });
    }
    if (event.event_type !== "webinar" || event.access_level !== "public" || event.invitation_only === true || event.published === false) {
      return new Response(JSON.stringify({ error: "This event is not open for guest signup" }), { status: 403, headers });
    }

    // ── Insert registration ────────────────────────────────
    const { error: insertError } = await supabase.from("event_registrations").insert({
      event_id: eventId,
      user_id: null,
      guest_first_name: firstName,
      guest_last_name: lastName,
      guest_email: email,
      guest_company: company || null,
      registration_type: "guest",
      payment_status: "free",
    });

    if (insertError) {
      if (insertError.code === "23505") {
        return new Response(JSON.stringify({ error: "This email is already registered for this webinar.", code: "DUPLICATE" }), { status: 409, headers });
      }
      console.error(JSON.stringify({ tag: "guest_webinar_insert_error", message: insertError.message, code: insertError.code }));
      return new Response(JSON.stringify({ error: "Could not register", details: insertError.message }), { status: 500, headers });
    }

    // ── Record rate-limit entries (only after successful insert) ────────────
    await supabase.from("guest_signup_rate_limits").insert([
      { ip_hash: ipHash, email_hash: emailHash },
    ]);

    // ── Send confirmation email with .ics attachment ────────────────
    let emailStatus: "sent" | "failed" | "skipped" = "skipped";
    let emailId: string | null = null;
    let emailError: string | null = null;

    if (RESEND_API_KEY) {
      try {
        const { subject, html } = buildConfirmationEmail({ firstName, event: event as EventRow });
        const ics = buildICS(event as EventRow, email);
        const icsBase64 = btoa(ics);

        const resendRes = await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${RESEND_API_KEY}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            from: SENDER_EMAIL,
            to: [email],
            subject,
            html,
            attachments: [
              {
                filename: "webinar.ics",
                content: icsBase64,
                content_type: "text/calendar; charset=utf-8; method=PUBLISH",
              },
            ],
          }),
        });
        const resendBody = await resendRes.text();
        if (!resendRes.ok) {
          emailStatus = "failed";
          emailError = `${resendRes.status} ${resendBody}`;
          console.error(JSON.stringify({
            tag: "guest_webinar_email_failed",
            status: resendRes.status,
            body: resendBody,
            to: email,
            event_id: eventId,
            sender: SENDER_EMAIL,
          }));
        } else {
          emailStatus = "sent";
          try {
            const parsed = JSON.parse(resendBody);
            emailId = parsed?.id ?? null;
          } catch { /* ignore */ }
          console.log(JSON.stringify({
            tag: "guest_webinar_email_sent",
            resend_id: emailId,
            to: email,
            event_id: eventId,
          }));
        }
      } catch (e) {
        emailStatus = "failed";
        emailError = e instanceof Error ? e.message : String(e);
        console.error(JSON.stringify({
          tag: "guest_webinar_email_exception",
          error: emailError,
          to: email,
          event_id: eventId,
        }));
      }
    } else {
      console.warn(JSON.stringify({ tag: "guest_webinar_email_skipped", reason: "RESEND_API_KEY not set" }));
    }

    return new Response(JSON.stringify({ success: true, email_status: emailStatus, email_id: emailId, email_error: emailError }), { status: 200, headers });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(JSON.stringify({ tag: "guest_webinar_register_error", message }));
    return new Response(JSON.stringify({ error: message }), { status: 500, headers });
  }
});
