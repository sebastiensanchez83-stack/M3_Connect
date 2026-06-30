// Reminder edge function: called hourly by pg_cron via pg_net.
// Finds event_registrations for webinars starting in 23-25h that haven't been reminded yet,
// and sends a reminder email (+ .ics) to both guest and authenticated registrants.
//
// No auth header check — this function is safe to call publicly because:
//   1. It is idempotent: reminder_sent_at guarantees each registration is only reminded once.
//   2. It only operates on registrations for webinars in the 23-25h window, so calls
//      outside that window are no-ops.
//   3. No sensitive data is returned (only aggregate counts).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
const SENDER_EMAIL = Deno.env.get("SENDER_EMAIL") || "Smart Marina Connect <noreply@smartmarinaconnect.com>";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const SITE_URL = Deno.env.get("SITE_URL") || "https://smartmarinaconnect.com";

function pad(n: number): string { return n < 10 ? `0${n}` : `${n}`; }
function toICSDate(d: Date): string {
  return d.getUTCFullYear().toString() + pad(d.getUTCMonth() + 1) + pad(d.getUTCDate()) + "T" + pad(d.getUTCHours()) + pad(d.getUTCMinutes()) + pad(d.getUTCSeconds()) + "Z";
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
}

function buildICS(event: EventRow, attendeeEmail: string): string {
  const start = event.date_time ? new Date(event.date_time) : new Date();
  const end = event.end_date_time ? new Date(event.end_date_time) : new Date(start.getTime() + 60 * 60 * 1000);
  const now = new Date();
  const eventUrl = `${SITE_URL}/events/${event.id}`;
  const descText = `${event.description || ""}\n\nJoin at: ${eventUrl}`;
  return [
    "BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Smart Marina Connect//Webinar//EN", "CALSCALE:GREGORIAN", "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    `UID:${event.id}@smartmarinaconnect.com`,
    `DTSTAMP:${toICSDate(now)}`,
    `DTSTART:${toICSDate(start)}`,
    `DTEND:${toICSDate(end)}`,
    `SUMMARY:${escapeICSText(event.title)}`,
    `DESCRIPTION:${escapeICSText(descText)}`,
    `LOCATION:${escapeICSText(event.location || eventUrl)}`,
    `URL:${eventUrl}`,
    `ATTENDEE;CN=${attendeeEmail};RSVP=TRUE:mailto:${attendeeEmail}`,
    "STATUS:CONFIRMED",
    "END:VEVENT", "END:VCALENDAR",
  ].join("\r\n");
}

function formatHumanDate(isoString: string | null): string {
  if (!isoString) return "TBD";
  try {
    return new Date(isoString).toLocaleString("en-GB", { weekday: "long", year: "numeric", month: "long", day: "numeric", hour: "2-digit", minute: "2-digit", timeZoneName: "short" });
  } catch { return isoString; }
}

function buildReminderEmail(firstName: string, event: EventRow): { subject: string; html: string } {
  const eventUrl = `${SITE_URL}/events/${event.id}`;
  const when = formatHumanDate(event.date_time);
  const subject = `Tomorrow: ${event.title}`;
  const html = `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"><title>${subject}</title></head>
<body style="margin:0;padding:0;background-color:#f4f5f7;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background-color:#f4f5f7;padding:40px 20px;"><tr><td align="center">
<table role="presentation" width="600" cellspacing="0" cellpadding="0" style="background-color:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.06);">
<tr><td style="background-color:#0c4a6e;padding:32px 40px;text-align:center;">
<h1 style="margin:0;color:#ffffff;font-size:24px;font-weight:700;">Smart Marina Connect</h1>
<p style="margin:6px 0 0;color:#93c5fd;font-size:13px;">Webinar reminder</p>
</td></tr>
<tr><td style="padding:40px;">
<p style="margin:0 0 8px;color:#374151;font-size:16px;">Hello ${firstName || "there"},</p>
<h2 style="margin:0 0 16px;color:#111827;font-size:20px;font-weight:600;">Your webinar starts in ~24 hours</h2>
<table role="presentation" width="100%" style="background-color:#f9fafb;border:1px solid #e5e7eb;border-radius:8px;margin-bottom:24px;"><tr><td style="padding:20px 24px;">
<p style="margin:0 0 8px;color:#0c4a6e;font-size:17px;font-weight:600;">${event.title}</p>
<p style="margin:0;color:#6b7280;font-size:14px;"><strong>When:</strong> ${when}</p>
</td></tr></table>
<p style="margin:0 0 24px;color:#4b5563;font-size:14px;line-height:1.6;">Click below to access the webinar details and join link.</p>
<table role="presentation" cellspacing="0" cellpadding="0" style="margin:0 auto;"><tr><td style="background-color:#0c4a6e;border-radius:8px;">
<a href="${eventUrl}" target="_blank" style="display:inline-block;padding:14px 32px;color:#ffffff;font-size:15px;font-weight:600;text-decoration:none;">View Webinar</a>
</td></tr></table>
</td></tr>
<tr><td style="padding:24px 40px;background-color:#f9fafb;border-top:1px solid #e5e7eb;text-align:center;">
<p style="margin:0;color:#9ca3af;font-size:12px;">&copy; ${new Date().getFullYear()} M3 Monaco — Smart Marina Connect</p>
</td></tr>
</table></td></tr></table></body></html>`;
  return { subject, html };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: { "Access-Control-Allow-Origin": "*" } });
  }

  try {
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    const nowIso = new Date().toISOString();
    const in25hIso = new Date(Date.now() + 25 * 60 * 60 * 1000).toISOString();
    const in23hIso = new Date(Date.now() + 23 * 60 * 60 * 1000).toISOString();

    // Fetch all webinar events starting in the 23h-25h window
    const { data: events, error: evErr } = await supabase
      .from("events")
      .select("id, title, description, date_time, end_date_time, location")
      .eq("event_type", "webinar")
      .eq("published", true)
      .gte("date_time", in23hIso)
      .lte("date_time", in25hIso);

    if (evErr) {
      console.error("Event fetch error:", evErr);
      return new Response(JSON.stringify({ error: evErr.message }), { status: 500, headers: { "Content-Type": "application/json" } });
    }

    if (!events || events.length === 0) {
      return new Response(JSON.stringify({ success: true, events: 0, reminders_sent: 0 }), { status: 200, headers: { "Content-Type": "application/json" } });
    }

    let totalSent = 0;
    let totalErrors = 0;

    for (const event of events) {
      // Fetch all registrations for this event that haven't been reminded yet
      const { data: regs, error: regErr } = await supabase
        .from("event_registrations")
        .select("id, user_id, guest_email, guest_first_name")
        .eq("event_id", event.id)
        .is("reminder_sent_at", null);

      if (regErr || !regs) {
        console.error("Registration fetch error:", regErr);
        continue;
      }

      for (const reg of regs) {
        // Resolve recipient email + first name
        let recipientEmail = reg.guest_email || "";
        let firstName = reg.guest_first_name || "";

        if (!recipientEmail && reg.user_id) {
          const { data: profile } = await supabase
            .from("profiles")
            .select("email, first_name")
            .eq("user_id", reg.user_id)
            .maybeSingle();
          if (profile?.email) {
            recipientEmail = profile.email;
            firstName = firstName || profile.first_name || "";
          }
        }

        if (!recipientEmail) continue;

        if (!RESEND_API_KEY) {
          console.warn("RESEND_API_KEY missing — skipping");
          break;
        }

        try {
          const { subject, html } = buildReminderEmail(firstName, event as EventRow);
          const ics = buildICS(event as EventRow, recipientEmail);
          const icsBase64 = btoa(ics);

          const res = await fetch("https://api.resend.com/emails", {
            method: "POST",
            headers: { Authorization: `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
            body: JSON.stringify({
              from: SENDER_EMAIL,
              to: [recipientEmail],
              subject,
              html,
              attachments: [{ filename: "webinar.ics", content: icsBase64, content_type: "text/calendar; charset=utf-8; method=PUBLISH" }],
            }),
          });

          if (res.ok) {
            totalSent++;
            await supabase.from("event_registrations").update({ reminder_sent_at: nowIso }).eq("id", reg.id);
          } else {
            totalErrors++;
            const errText = await res.text();
            console.error("Resend error:", res.status, errText);
          }
        } catch (e) {
          totalErrors++;
          console.error("Reminder send error:", e);
        }
      }
    }

    return new Response(JSON.stringify({ success: true, events: events.length, reminders_sent: totalSent, errors: totalErrors }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("guest-webinar-reminders error:", message);
    return new Response(JSON.stringify({ error: message }), { status: 500, headers: { "Content-Type": "application/json" } });
  }
});
