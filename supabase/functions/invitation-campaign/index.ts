import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  invitationAttachmentNames,
  invitationSender,
  renderInvitationEmail,
  type InvitationRenderCampaign,
  type InvitationRenderRecipient,
} from "./render.ts";

// invitation-campaign: the sender of the "Invitation campaigns" admin module
// (/admin/invitations). Staff only. POST with the signed-in staff member's JWT.
//
// DEPLOY with verify_jwt = TRUE (files index.ts and render.ts). The gateway refuses a call
// without a valid JWT; inside, the caller must also pass public.is_moderator() (a verified
// admin or moderator, the rule of the module's RLS), checked with the caller's own JWT. The
// work is then done with the service role, always naming that staff member to the database
// functions (p_actor), which check it again and journal it in their name.
//
// Actions (the contract with the admin screens):
//   test         {campaign_id, recipient_id, to?}  one invitation, with that guest's real texts
//                and PDFs, to the caller's OWN address ("to" only if it is the caller's), with
//                "[Test] " before the subject. Never links, marks or logs the guest.
//   preview_send {campaign_id, recipient_ids, adopt?, pdfs_on_send?}  what a send would do,
//                nothing written: sendable, without e-mail, blocked (duplicates, a possible
//                same person not yet dismissed by staff, pending request not adopted, address
//                already on the list, capacity, PDFs missing...), seats left. pdfs_on_send:
//                the screen uploads fresh PDFs right before each send, so files not there yet
//                do not block (the admin screens always pass it).
//   send         {campaign_id, recipient_ids, force_capacity?, adopt?: recipient_id[]}
//                at most 10 guests per call, and no new guest once the call has run 70 s (the
//                rest come back in "remaining": call again with them), one e-mail each.
//                IDEMPOTENT: only draft or ready guests not being sent are taken (a lock per
//                guest stops a double click); a guest already sent, or whose last send may
//                have gone out, is never sent again here.
//   resend       {campaign_id, recipient_id}  the explicit re-send of one invitation.
//   set_answer   {campaign_id, recipient_id, answer: accepted|declined|no_answer, force?}
//                records an answer received by e-mail; "accepted" then sends the platform's
//                entry pass (QR) through the LIVE guest-list function's existing "resend"
//                action, with the caller's JWT (guest-list is not changed: WYS freeze).
//
// One send, per guest: lock the guest (and read it again, as it is now); read ticket.pdf and
// letter.pdf from the private bucket invitation-files (uploaded by the admin screen BEFORE the
// send, at <campaign>/<guest>/); mark the guest "send_uncertain" BEFORE anything can go out;
// put the guest on the event's guest list (invitation_link_guest, never with its adopt
// option: a new "invited" row; an address already on the list is never invited twice, except
// a PENDING public request staff chose to adopt, taken with invitation_adopt_request, same row
// and token); send through Resend with both PDFs attached; then invitation_mark_sent writes,
// in one transaction, the gl_email_log 'invitation' line the health monitor expects within 10
// minutes, the guest "sent", the mark cleared, and the journal. A send Resend refuses is tried
// once more (429 and 5xx, network errors); if it still fails, the link made by this send is
// undone (invitation_unlink_guest, or invitation_unadopt_request) so no guest-list row stays
// "invited" without its e-mail (the next send re-opens that cancelled row with
// invitation_relink_guest, same token), and the mark becomes the refusal's code. When the
// outcome is unknown (network error), or the sender was stopped mid-way (timeout, crash), the
// link and the "send_uncertain" mark stay: a plain send skips that guest; staff look for the
// e-mail in the Resend log (or ask the guest), then use resend if it did not go.
//
// Sender: the campaign's sender_name / sender_email / reply_to, else "<event name>"
// <noreply@smartmarinaconnect.com>, replies to events@m3monaco.com (render.ts). No function of
// the platform has ever sent from m3monaco.com, so it is not known to be verified in the
// platform's Resend account: switch a campaign to events@m3monaco.com only after a test send
// from it went through (Resend refuses an unverified domain: error sender_domain_not_verified).
//
// Never: an account (no auth user, no profile), an RSVP link or a QR in this e-mail (phase 2),
// a change to guest-list, gl_guest tokens or the door. Logs carry ids and codes, never
// addresses or names.

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") || "";
const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY") || "";

const BUCKET = "invitation-files";
const BATCH_MAX = 10;
const PREVIEW_MAX = 500;
const LOCK_MINUTES = 5;
const SPACING_MS = 600; // Resend's default rate limit is 2 requests per second.
const RETRY_WAIT_MS = 1500;
const RESEND_TIMEOUT_MS = 15_000;
// The platform ends a request after 150 s. One guest takes at most 2 x 15 s of Resend plus
// the waits and its reads, so a "send" call starts no new guest after 70 s: the rest come back
// in "remaining", and the call ends far from the limit.
const SEND_BUDGET_MS = 70_000;
// A guest whose last send may have gone out: a plain send skips it, only resend sends again.
const NEEDS_EXPLICIT_RESEND = ["send_uncertain", "sent_not_recorded"];
// Resend: 40 MB per e-mail, attachments counted after base64 (x 4/3). Our PDFs are ~0.7 MB.
const MAX_ATTACHMENTS_BYTES = 28 * 1024 * 1024;

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

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isUuid = (x: unknown): x is string => typeof x === "string" && UUID_RE.test(x);
const uuids = (x: unknown): string[] => [...new Set((Array.isArray(x) ? x : []).filter(isUuid).map((s) => s.toLowerCase()))];
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const db = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { autoRefreshToken: false, persistSession: false } });

type Row = Record<string, any>;
type Ctx = { uid: string; jwt: string; email: string; campaign: Row; event: Row };
type Outcome = "sent" | "skipped" | "blocked" | "failed" | "uncertain";
type Result = { id: string; outcome: Outcome; code?: string; detail?: string; guest_id?: string; adopted?: "request"; status?: string };

// ─── Data ────────────────────────────────────────────────────────────────
async function loadCampaign(id: string): Promise<Row | null> {
  const { data } = await db.from("invitation_campaign").select("*").eq("id", id).maybeSingle();
  return data;
}
async function loadEvent(id: string): Promise<Row | null> {
  const { data } = await db.from("gl_event").select("id, slug, title, capacity, engine").eq("id", id).maybeSingle();
  return data;
}
async function loadRecipients(campaignId: string, ids: string[]): Promise<Row[]> {
  const out: Row[] = [];
  for (let i = 0; i < ids.length; i += 100) {
    const { data, error } = await db.from("invitation_recipient").select("*").eq("campaign_id", campaignId).in("id", ids.slice(i, i + 100));
    if (error) throw new Error(`recipients: ${error.message}`);
    out.push(...(data || []));
  }
  const order = new Map(ids.map((id, i) => [id, i]));
  return out.sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
}
async function journal(ctx: Ctx, recipientId: string | null, action: string, payload: Record<string, unknown>) {
  const { error } = await db.from("invitation_log").insert({
    campaign_id: ctx.campaign.id, recipient_id: recipientId, action, actor_id: ctx.uid, payload,
  });
  if (error) console.error("invitation-campaign: journal failed", action, error.message);
}
async function rpc(fn: string, args: Record<string, unknown>): Promise<Row> {
  const { data, error } = await db.rpc(fn, args);
  if (error) throw new Error(`${fn}: ${error.message}`);
  return (data || {}) as Row;
}
/** A list kept in invitation_campaign.settings by the Guests tab (adopt, dismissed_duplicates). */
function settingsList(c: Row, key: string): Set<string> {
  const v = c.settings ? c.settings[key] : null;
  return new Set(Array.isArray(v) ? v.filter((x: unknown) => typeof x === "string").map((x: string) => x.toLowerCase()) : []);
}
/** Adoptions asked by the screen that staff also recorded for that guest in the Guests tab. */
function adoptChosen(c: Row, asked: unknown): Set<string> {
  const chosen = settingsList(c, "adopt");
  return new Set(uuids(asked).filter((id) => chosen.has(id)));
}
/** Name matches (same name, or same name and organisation) staff have not marked "Not the same person". */
function samePersonOf(c: Row, dups: Row[]): Map<string, string[]> {
  const dismissed = settingsList(c, "dismissed_duplicates");
  const out = new Map<string, string[]>();
  for (const d of dups) {
    if (d.match_on === "email") continue; // e-mail matches have their own rules (one address = one person)
    if (dismissed.has(`${d.recipient_id}:${d.other_id}`.toLowerCase())) continue;
    out.set(d.recipient_id, [...(out.get(d.recipient_id) || []), `${d.other_kind}:${d.other_id}`]);
  }
  return out;
}

// ─── PDFs (private bucket, uploaded by the admin screen before the send) ─────
function pdfPaths(campaignId: string, r: Row) {
  const base = `${campaignId}/${r.id}/`;
  // A path written on the guest row is used only inside that guest's own folder.
  const pick = (p: unknown, file: string) => (typeof p === "string" && p.startsWith(base) && !p.includes("..") ? p : base + file);
  return { ticket: pick(r.ticket_pdf_path, "ticket.pdf"), letter: pick(r.letter_pdf_path, "letter.pdf") };
}
async function folderFiles(campaignId: string, recipientId: string): Promise<Map<string, number>> {
  const { data } = await db.storage.from(BUCKET).list(`${campaignId}/${recipientId}`, { limit: 100 });
  const m = new Map<string, number>();
  for (const f of data || []) if (f?.name) m.set(`${campaignId}/${recipientId}/${f.name}`, Number((f.metadata as Row | null)?.size) || 0);
  return m;
}
async function readPdf(path: string): Promise<Uint8Array | null> {
  const { data, error } = await db.storage.from(BUCKET).download(path);
  if (error || !data) return null;
  const bytes = new Uint8Array(await data.arrayBuffer());
  // "%PDF-"
  if (bytes.length < 5 || bytes[0] !== 0x25 || bytes[1] !== 0x50 || bytes[2] !== 0x44 || bytes[3] !== 0x46 || bytes[4] !== 0x2d) return null;
  return bytes;
}
function base64(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}
async function attachmentsFor(ctx: Ctx, r: Row): Promise<{ ok: true; list: Row[]; bytes: number } | { ok: false; code: string }> {
  const paths = pdfPaths(ctx.campaign.id, r);
  const [letter, ticket] = await Promise.all([readPdf(paths.letter), readPdf(paths.ticket)]);
  if (!letter || !ticket) return { ok: false, code: "missing_pdfs" };
  const bytes = letter.length + ticket.length;
  if (bytes > MAX_ATTACHMENTS_BYTES) return { ok: false, code: "too_large" };
  const names = invitationAttachmentNames(ctx.campaign as InvitationRenderCampaign, r as InvitationRenderRecipient);
  return {
    ok: true, bytes,
    list: [
      { filename: names.letter, content: base64(letter), content_type: "application/pdf" },
      { filename: names.ticket, content: base64(ticket), content_type: "application/pdf" },
    ],
  };
}

// ─── Resend ──────────────────────────────────────────────────────────────
type Attempt = { kind: "ok" | "retryable" | "fatal" | "network"; status: number; id?: string; code?: string };
async function resendOnce(payload: Row, idempotencyKey: string): Promise<Attempt> {
  try {
    const resp = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json", "Idempotency-Key": idempotencyKey },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(RESEND_TIMEOUT_MS),
    });
    const text = await resp.text();
    if (resp.ok) {
      let id = "";
      try { id = String(JSON.parse(text)?.id || ""); } catch { /* id stays empty */ }
      return { kind: "ok", status: resp.status, id };
    }
    console.error("invitation-campaign: resend refused", resp.status, text.slice(0, 300));
    const domain = resp.status === 403 && /domain/i.test(text) && /verif/i.test(text);
    if (resp.status === 429 || resp.status >= 500) return { kind: "retryable", status: resp.status, code: `resend_${resp.status}` };
    if (resp.status === 409) return { kind: "network", status: 409, code: "resend_409" }; // a same-key request still running
    return { kind: "fatal", status: resp.status, code: domain ? "sender_domain_not_verified" : `resend_${resp.status}` };
  } catch (e) {
    console.error("invitation-campaign: resend unreachable", e instanceof Error ? e.name : "error");
    return { kind: "network", status: 0, code: "resend_unreachable" };
  }
}
/** sent | failed (nothing went out) | uncertain (it may have gone). One retry, same idempotency key. */
async function resendWithRetry(payload: Row, key: string): Promise<{ outcome: "sent" | "failed" | "uncertain"; id?: string; code?: string; attempts: number }> {
  const first = await resendOnce(payload, key);
  if (first.kind === "ok") return { outcome: "sent", id: first.id, attempts: 1 };
  if (first.kind === "fatal") return { outcome: "failed", code: first.code, attempts: 1 };
  await sleep(RETRY_WAIT_MS);
  const second = await resendOnce(payload, key);
  if (second.kind === "ok") return { outcome: "sent", id: second.id, attempts: 2 };
  const unsure = first.kind === "network" || second.kind === "network";
  return { outcome: unsure ? "uncertain" : "failed", code: second.code || first.code, attempts: 2 };
}
function emailPayload(ctx: Ctx, r: Row, to: string, attachments: Row[], test: boolean) {
  const campaign = ctx.campaign as InvitationRenderCampaign;
  const mail = renderInvitationEmail(campaign, r as InvitationRenderRecipient, { test });
  const sender = invitationSender(campaign);
  return {
    mail, sender,
    payload: { from: sender.from, to: [to], reply_to: sender.replyTo, subject: mail.subject, html: mail.html, text: mail.text, attachments },
  };
}

// ─── One guest ───────────────────────────────────────────────────────────
/** Takes the guest's send lock and returns the guest as it is now (not as an earlier read saw it). */
async function claim(ctx: Ctx, id: string, anyStatus: boolean): Promise<{ at: string; row: Row } | null> {
  const at = new Date().toISOString();
  const stale = new Date(Date.now() - LOCK_MINUTES * 60_000).toISOString();
  let q = db.from("invitation_recipient").update({ sending_at: at })
    .eq("id", id).eq("campaign_id", ctx.campaign.id)
    .or(`sending_at.is.null,sending_at.lt."${stale}"`);
  if (!anyStatus) q = q.in("status", ["draft", "ready"]);
  const { data, error } = await q.select("*");
  if (error) { console.error("invitation-campaign: claim failed", error.message); return null; }
  return data && data.length ? { at, row: data[0] } : null;
}
/** Lets the lock go and stores the outcome's code (null clears it). */
async function release(id: string, at: string, code: string | null) {
  const { error } = await db.from("invitation_recipient").update({ sending_at: null, send_error: code ? code.slice(0, 300) : null })
    .eq("id", id).eq("sending_at", at);
  if (error) console.error("invitation-campaign: release failed", error.message);
}
/** Lets the lock go, nothing else changed (a guest left out before anything was done). */
async function unlock(id: string, at: string) {
  const { error } = await db.from("invitation_recipient").update({ sending_at: null }).eq("id", id).eq("sending_at", at);
  if (error) console.error("invitation-campaign: unlock failed", error.message);
}

/** One invitation: first send (resend false) or the explicit re-send (resend true). */
async function sendOne(ctx: Ctx, seen: Row, opts: { resend: boolean; adopt: boolean; force: boolean }): Promise<Result> {
  const id: string = seen.id;
  if (!seen.email) return { id, outcome: "blocked", code: "no_email" };
  if (!opts.resend && !["draft", "ready"].includes(seen.status)) return { id, outcome: "skipped", code: "already_sent", status: seen.status };
  const lock = await claim(ctx, id, opts.resend);
  if (!lock) return { id, outcome: "skipped", code: opts.resend ? "in_progress" : "in_progress_or_sent" };
  const { at } = lock;
  const r = lock.row; // read again under the lock: the call's first read may be a minute old
  const leave = async (res: Result): Promise<Result> => { await unlock(id, at); return res; };
  // The last send of this guest may have gone out (or did): that mark stays until the explicit
  // resend records or refuses a new one; a plain send never sends it again.
  const mayHaveGone = r.gl_guest_id && NEEDS_EXPLICIT_RESEND.includes(r.send_error) ? String(r.send_error) : null;
  if (!r.email) return await leave({ id, outcome: "blocked", code: "no_email" });
  if (opts.resend) {
    if (!r.gl_guest_id) return await leave({ id, outcome: "blocked", code: "not_sent_yet" });
  } else if (mayHaveGone) {
    return await leave({ id, outcome: "skipped", code: "needs_explicit_resend", detail: mayHaveGone });
  }

  const fail = async (outcome: "blocked" | "failed", code: string, extra: Partial<Result> = {}, journalIt = false): Promise<Result> => {
    // A block (nothing went out) keeps an earlier "it may have gone" mark.
    await release(id, at, outcome === "blocked" && mayHaveGone ? mayHaveGone : code);
    // Codes and counts only: an unexpected error's message may quote a value (an address).
    if (journalIt) await journal(ctx, id, "send_failed", { error: code, resend: opts.resend, detail: code === "error" ? null : extra.detail ?? null });
    return { id, outcome, code, ...extra };
  };

  try {
    // One person, one invitation: a name match staff have not dismissed in the Guests tab
    // ("Not the same person") blocks the first send. Same rule as preview_send.
    if (!opts.resend) {
      const { data: dups, error: dupErr } = await db.rpc("invitation_find_duplicates", { p_campaign_id: ctx.campaign.id, p_recipient_id: id });
      if (dupErr) throw new Error(`invitation_find_duplicates: ${dupErr.message}`);
      const same = samePersonOf(ctx.campaign, ((dups || []) as Row[]).filter((d) => d.recipient_id === id)).get(id);
      if (same?.length) return await fail("blocked", "same_person", { detail: same.join(" ") });
    }
    // Texts and files first: nothing touches the guest list before the e-mail is ready.
    const files = await attachmentsFor(ctx, r);
    if (!files.ok) return await fail("blocked", files.code);
    const { mail, payload } = emailPayload(ctx, r, r.email, files.list, false);
    if (mail.empty) return await fail("blocked", "empty_email");
    if (mail.unknown.length) return await fail("blocked", "unresolved_variables", { detail: mail.unknown.join(" ") });

    // From here the e-mail may go out. Mark it first: a sender stopped from here on (timeout,
    // crash) leaves a guest that only the explicit resend sends again. invitation_mark_sent
    // clears the mark; a refusal or a block replaces it with its own code.
    const { data: marked0, error: markErr } = await db.from("invitation_recipient").update({ send_error: "send_uncertain" })
      .eq("id", id).eq("sending_at", at).select("id");
    if (markErr) throw new Error(`mark: ${markErr.message}`);
    if (!marked0?.length) return { id, outcome: "skipped", code: "in_progress" }; // the lock went stale and was taken over

    // On the guest list (or already there).
    let guestId: string = r.gl_guest_id || "";
    let undo: "unlink" | "unadopt" | null = null;
    let adopted: "request" | undefined;
    if (opts.resend) {
      const { data: g } = await db.from("gl_guest").select("status").eq("id", guestId).maybeSingle();
      if (!g || !["invited", "confirmed"].includes(g.status)) return await fail("blocked", `guest_${g?.status || "missing"}`);
    } else {
      // Never with p_adopt: an address already invited, confirmed or declined on the list
      // (from WYS 2026, maybe since the check) is never sent a second, different invitation.
      let link = await rpc("invitation_link_guest", { p_recipient_id: id, p_force: opts.force, p_adopt: false, p_actor: ctx.uid });
      if (!link.ok && link.error === "already_on_list" && link.guest_status === "requested" && link.guest_source === "request"
          && opts.adopt) {
        // A pending /wys26 request staff chose to adopt for this guest. invitation_adopt_request
        // takes pending requests only: approved, refused or cancelled since, it refuses.
        link = await rpc("invitation_adopt_request", { p_recipient_id: id, p_force: opts.force, p_actor: ctx.uid });
        if (link.ok && link.adopted_request) { undo = "unadopt"; adopted = "request"; }
      } else if (!link.ok && link.error === "already_on_list"
                 && link.guest_status === "cancelled" && link.guest_source === "invitation") {
        // Most likely this guest's own row, cancelled by the undo of an earlier refused send
        // (step 1 keeps it on the list): re-open it. The database checks it is that row.
        const re = await rpc("invitation_relink_guest", { p_recipient_id: id, p_force: opts.force, p_actor: ctx.uid });
        if (re.ok) { link = re; undo = "unlink"; } else if (re.error !== "not_relinkable") link = re;
      } else if (link.ok && link.created) {
        undo = "unlink";
      } else if (link.ok && link.already_linked && !["invited", "confirmed"].includes(link.guest_status)) {
        // Linked by an earlier send that failed; the row changed in WYS 2026 since (cancelled...).
        return await fail("blocked", `guest_${link.guest_status || "missing"}`);
      }
      if (!link.ok) {
        // Same codes as preview_send: an address with a pending public request is
        // "pending_request" (adopt it, or leave it to WYS 2026), whatever the step that saw it.
        const onList = link.error === "already_on_list";
        const code = onList && link.guest_status === "requested" && link.guest_source === "request" ? "pending_request"
          : onList && ["rejected", "cancelled", "requested"].includes(link.guest_status) ? "not_adoptable"
          : String(link.error || "link_failed");
        const detail = [link.guest_status, link.held != null ? `${link.held}/${link.capacity}` : ""].filter(Boolean).join(" ");
        return await fail("blocked", code, detail ? { detail } : {});
      }
      guestId = String(link.guest_id);
    }

    const key = `invitation-${id}-${guestId}-${Date.parse(at)}`;
    const sent = await resendWithRetry(payload, key);
    if (sent.outcome !== "sent") {
      let undone: string | null = null;
      if (sent.outcome === "failed" && undo) {
        try {
          const u = await rpc(undo === "unlink" ? "invitation_unlink_guest" : "invitation_unadopt_request",
            { p_recipient_id: r.id, p_actor: ctx.uid });
          undone = u.ok ? undo : `${undo}_refused_${u.error}`;
        } catch (e) {
          undone = `${undo}_error`;
          console.error("invitation-campaign: undo failed", e instanceof Error ? e.message : e);
        }
      }
      const code = sent.outcome === "uncertain" ? "send_uncertain" : String(sent.code || "send_failed");
      const res = await fail("failed", code,
        { detail: `${sent.attempts} attempt(s)${undone ? `, ${undone}` : ""}` }, true);
      return { ...res, outcome: sent.outcome === "uncertain" ? "uncertain" : "failed", ...(undone && undone === undo ? {} : { guest_id: guestId }) };
    }

    // Gone. Record it (gl_email_log 'invitation', status, journal) in one transaction.
    let marked: Row | null = null;
    for (let i = 0; i < 2 && !marked; i++) {
      try {
        marked = await rpc("invitation_mark_sent", { p_recipient_id: r.id, p_actor: ctx.uid, p_resend: opts.resend, p_message_id: sent.id || null });
      } catch (e) {
        console.error("invitation-campaign: mark_sent failed", e instanceof Error ? e.message : e);
        if (i === 0) await sleep(800);
      }
    }
    if (!marked?.ok) {
      // The e-mail went out but is not recorded: never send it again; a developer adds the log line.
      await release(id, at, "sent_not_recorded");
      await journal(ctx, r.id, "send_failed", { error: "sent_not_recorded", message_id: sent.id || null, guest_id: guestId });
      return { id: r.id, outcome: "failed", code: "sent_not_recorded", guest_id: guestId, detail: "The e-mail went out. Do not send it again." };
    }
    return { id: r.id, outcome: "sent", guest_id: guestId, status: String(marked.status), ...(adopted ? { adopted } : {}) };
  } catch (e) {
    console.error("invitation-campaign: send error", e instanceof Error ? e.message : e);
    return await fail("failed", "error", { detail: e instanceof Error ? e.message.slice(0, 200) : "error" }, true);
  }
}

// ─── Preview of a send (nothing written) ─────────────────────────────────
async function previewSend(ctx: Ctx, ids: string[], adopt: Set<string>, pdfsOnSend = false) {
  const rows = await loadRecipients(ctx.campaign.id, ids);
  const found = new Set(rows.map((r) => r.id));
  const emails = [...new Set(rows.map((r) => r.email).filter(Boolean))] as string[];

  // The event's guest list rows for these addresses, and which campaign guest holds each.
  const guests = new Map<string, Row>();
  for (let i = 0; i < emails.length; i += 100) {
    const { data } = await db.from("gl_guest").select("id, email, status, source, plus_one_of").eq("event_id", ctx.event.id)
      .in("email", emails.slice(i, i + 100));
    for (const g of data || []) guests.set(String(g.email).toLowerCase(), g);
  }
  const guestIds = [...guests.values()].map((g) => g.id);
  // Rows these guests unlinked after a refused send: "send" re-opens them (invitation_relink_guest).
  const unlinked = new Set<string>();
  for (let i = 0; i < ids.length; i += 100) {
    const { data } = await db.from("invitation_log").select("recipient_id, payload").eq("action", "guest_unlinked")
      .in("recipient_id", ids.slice(i, i + 100));
    for (const l of data || []) if (l?.payload?.guest_id) unlinked.add(`${l.recipient_id}:${l.payload.guest_id}`);
  }
  const holder = new Map<string, string>();
  for (let i = 0; i < guestIds.length; i += 100) {
    const { data } = await db.from("invitation_recipient").select("id, gl_guest_id").in("gl_guest_id", guestIds.slice(i, i + 100));
    for (const x of data || []) holder.set(x.gl_guest_id, x.id);
  }
  // Same address on another campaign guest of the event (one address = one person), and a
  // possible same person (same name, or same name and organisation, in a campaign of the event
  // or on its guest list): blocked until staff choose "Not the same person" in the Guests tab
  // (settings.dismissed_duplicates) or remove one of them. Nothing is merged.
  const dupEmail = new Map<string, string>();
  const { data: dups, error: dupErr } = await db.rpc("invitation_find_duplicates", { p_campaign_id: ctx.campaign.id });
  if (dupErr) throw new Error(`invitation_find_duplicates: ${dupErr.message}`);
  const mine = ((dups || []) as Row[]).filter((d) => found.has(d.recipient_id));
  for (const d of mine) if (d.match_on === "email" && d.other_kind === "recipient") dupEmail.set(d.recipient_id, d.other_id);
  const samePerson = samePersonOf(ctx.campaign, mine);
  const { count: held } = await db.from("gl_guest").select("id", { count: "exact", head: true })
    .eq("event_id", ctx.event.id).in("status", ["confirmed", "invited"]);
  const capacity: number | null = ctx.event.capacity ?? null;
  let seatsLeft = capacity == null ? null : Math.max(0, capacity - (held || 0));

  // 1. What each guest is, from the rows alone.
  const staleMs = Date.now() - LOCK_MINUTES * 60_000;
  const out: Row[] = [];
  const rowOf = new Map<string, Row>();
  for (const r of rows) {
    const item: Row = { id: r.id, state: "sendable" };
    rowOf.set(r.id, r);
    const g = r.email ? guests.get(r.email) : undefined;
    if (!["draft", "ready"].includes(r.status)) { item.state = "already_sent"; item.status = r.status; }
    else if (r.sending_at && Date.parse(r.sending_at) > staleMs) { item.state = "in_progress"; }
    else if (!r.email) { item.state = "no_email"; }
    else if (r.gl_guest_id && NEEDS_EXPLICIT_RESEND.includes(r.send_error)) { item.state = "blocked"; item.code = "needs_explicit_resend"; item.detail = r.send_error; }
    else if (r.gl_guest_id) {
      // An earlier failed send left it linked: no new seat, unless that row changed in WYS 2026.
      item.code = "linked";
      const own = g && g.id === r.gl_guest_id ? g : null;
      if (own && !["invited", "confirmed"].includes(own.status)) { item.state = "blocked"; item.code = `guest_${own.status}`; }
    }
    else if (!r.first_name || !r.last_name) { item.state = "blocked"; item.code = "missing_name"; }
    else if (dupEmail.has(r.id)) { item.state = "blocked"; item.code = "duplicate_email"; item.other_id = dupEmail.get(r.id); }
    else if (g && holder.has(g.id)) { item.state = "blocked"; item.code = "guest_linked_elsewhere"; item.other_id = holder.get(g.id); }
    else if (g && g.status === "cancelled" && g.source === "invitation" && unlinked.has(`${r.id}:${g.id}`)) {
      item.code = "relink"; item.seat = true; // its own row, cancelled after a refused send
    } else if (g) {
      item.guest_status = g.status; item.guest_source = g.source;
      if (g.status === "requested" && g.source === "request" && !g.plus_one_of) {
        // Only a PENDING request can be adopted, and only when staff chose it for this guest.
        item.can_adopt = "request";
        if (!adopt.has(r.id)) { item.state = "blocked"; item.code = "pending_request"; }
        else { item.adopt = "request"; item.seat = true; }
      } else if (["invited", "confirmed", "declined"].includes(g.status)) {
        // Invited, approved or answered in WYS 2026: never a second, different invitation.
        item.state = "blocked"; item.code = "already_on_list";
      } else { item.state = "blocked"; item.code = "not_adoptable"; }
    } else item.seat = true;
    if (samePerson.has(r.id)) {
      item.same_name = samePerson.get(r.id);
      if (item.state === "sendable") { item.state = "blocked"; item.code = "same_person"; item.detail = item.same_name.join(" "); delete item.seat; delete item.adopt; }
    }
    out.push(item);
  }
  // 2. Texts and PDFs of those still sendable (10 folders at a time).
  const todo = out.filter((x) => x.state === "sendable");
  for (let i = 0; i < todo.length; i += 10) {
    await Promise.all(todo.slice(i, i + 10).map(async (item) => {
      const r = rowOf.get(item.id)!;
      const mail = renderInvitationEmail(ctx.campaign as InvitationRenderCampaign, r as InvitationRenderRecipient);
      if (mail.empty) { item.state = "blocked"; item.code = "empty_email"; return; }
      if (mail.unknown.length) { item.state = "blocked"; item.code = "unresolved_variables"; item.detail = mail.unknown.join(" "); return; }
      // The admin screen regenerates and uploads both PDFs right before each send: their absence
      // now is not a block then ("send" still refuses a guest whose files are missing).
      if (pdfsOnSend) return;
      const present = await folderFiles(ctx.campaign.id, r.id);
      const p = pdfPaths(ctx.campaign.id, r);
      if (!present.has(p.ticket) || !present.has(p.letter)) { item.state = "blocked"; item.code = "missing_pdfs"; return; }
      item.bytes = (present.get(p.ticket) || 0) + (present.get(p.letter) || 0);
      if (item.bytes > MAX_ATTACHMENTS_BYTES) { item.state = "blocked"; item.code = "too_large"; }
    }));
  }
  // 3. Seats, in the order given: a new guest-list row or an adopted request takes one.
  let needed = 0;
  for (const item of out) {
    if (item.state !== "sendable" || !item.seat) continue;
    needed++;
    if (seatsLeft != null) {
      if (seatsLeft <= 0) { item.state = "blocked"; item.code = "capacity"; continue; }
      seatsLeft--;
    }
  }
  const by = (s: string) => out.filter((x) => x.state === s);
  const blocked = by("blocked");
  const count = (code: string) => blocked.filter((x) => x.code === code).length;
  const sender = invitationSender(ctx.campaign as InvitationRenderCampaign);
  return {
    ok: true,
    selected: ids.length,
    not_found: ids.filter((id) => !found.has(id)),
    sendable: by("sendable").length,
    without_email: by("no_email").length,
    without_email_ids: by("no_email").map((x) => x.id),
    already_sent: by("already_sent").length,
    in_progress: by("in_progress").length,
    blocked: {
      total: blocked.length,
      duplicates: count("duplicate_email") + count("guest_linked_elsewhere"),
      same_person: count("same_person"),
      pending_request: count("pending_request"),
      already_on_list: count("already_on_list"),
      not_adoptable: count("not_adoptable"),
      capacity: count("capacity"),
      missing_pdfs: count("missing_pdfs"),
      missing_name: count("missing_name"),
      other: blocked.filter((x) => !["duplicate_email", "guest_linked_elsewhere", "same_person", "pending_request", "already_on_list",
        "not_adoptable", "capacity", "missing_pdfs", "missing_name"].includes(x.code)).length,
    },
    same_name_warnings: out.filter((x) => x.same_name).length,
    seats: { capacity, held: held || 0, left: capacity == null ? null : Math.max(0, capacity - (held || 0)), needed },
    seats_left: capacity == null ? null : Math.max(0, capacity - (held || 0)),
    from: sender.from, reply_to: sender.replyTo,
    batch_max: BATCH_MAX,
    recipients: out,
  };
}

// ─── The entry pass after "Accepted": the live guest-list function, unchanged ──
async function sendPassThroughGuestList(jwt: string, eventId: string, guestId: string): Promise<{ ok: boolean; error?: string }> {
  try {
    const resp = await fetch(`${SUPABASE_URL}/functions/v1/guest-list`, {
      method: "POST",
      headers: { Authorization: `Bearer ${jwt}`, apikey: ANON_KEY, "Content-Type": "application/json" },
      body: JSON.stringify({ action: "resend", event_id: eventId, guest_id: guestId }),
      signal: AbortSignal.timeout(60_000),
    });
    const out = await resp.json().catch(() => null) as Row | null;
    if (resp.ok && out?.ok === true) return { ok: true };
    return { ok: false, error: String(out?.error || `guest_list_${resp.status}`).slice(0, 200) };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.name : "guest_list_unreachable" };
  }
}

// ─── Handler ─────────────────────────────────────────────────────────────
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors(req) });
  if (req.method !== "POST") return json(req, { error: "Method not allowed" }, 405);

  // Staff only: a valid session, and public.is_moderator() for that session.
  const jwt = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  if (!jwt) return json(req, { error: "Unauthorized" }, 401);
  const { data: u } = await db.auth.getUser(jwt);
  const uid = u?.user?.id;
  if (!uid) return json(req, { error: "Unauthorized" }, 401);
  const asCaller = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${jwt}` } },
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data: isMod, error: modErr } = await asCaller.rpc("is_moderator");
  if (modErr || isMod !== true) return json(req, { error: "Forbidden" }, 403);

  let body: Row;
  try { body = await req.json(); } catch { return json(req, { error: "Invalid JSON" }, 400); }
  const action = String(body?.action || "");
  if (!isUuid(body?.campaign_id)) return json(req, { error: "campaign_id required" }, 400);
  const campaign = await loadCampaign(body.campaign_id.toLowerCase());
  if (!campaign) return json(req, { error: "campaign_not_found" }, 404);
  const event = await loadEvent(campaign.gl_event_id);
  if (!event) return json(req, { error: "event_not_found" }, 404);
  const ctx: Ctx = { uid, jwt, email: String(u?.user?.email || "").toLowerCase(), campaign, event };
  const needsResend = ["test", "send", "resend"].includes(action);
  if (needsResend && !RESEND_API_KEY) return json(req, { error: "E-mail is not configured (no RESEND_API_KEY)" }, 500);

  try {
    if (action === "test") {
      if (!isUuid(body.recipient_id)) return json(req, { error: "recipient_id required" }, 400);
      const [r] = await loadRecipients(campaign.id, [body.recipient_id.toLowerCase()]);
      if (!r) return json(req, { error: "recipient_not_found" }, 404);
      // Only to the caller: the address of their session, or their profile's address.
      const { data: prof } = await db.from("profiles").select("email").eq("user_id", uid).maybeSingle();
      const own = new Set([ctx.email, String(prof?.email || "").toLowerCase()].filter(Boolean));
      const asked = typeof body.to === "string" ? body.to.trim().toLowerCase() : "";
      if (asked && !own.has(asked)) return json(req, { error: "test_only_to_yourself" }, 400);
      const to = asked || ctx.email || [...own][0] || "";
      if (!to) return json(req, { error: "no_address_for_you" }, 400);
      const files = await attachmentsFor(ctx, r);
      if (!files.ok) return json(req, { ok: false, error: files.code }, 400);
      const { mail, sender, payload } = emailPayload(ctx, r, to, files.list, true);
      if (mail.empty) return json(req, { ok: false, error: "empty_email" }, 400);
      const sent = await resendWithRetry(payload, `invitation-test-${r.id}-${Date.now()}`);
      await journal(ctx, r.id, "test_sent", { ok: sent.outcome === "sent", error: sent.code || null, message_id: sent.id || null });
      return json(req, {
        ok: sent.outcome === "sent", error: sent.outcome === "sent" ? undefined : (sent.code || sent.outcome),
        to, from: sender.from, reply_to: sender.replyTo, subject: mail.subject, unknown_variables: mail.unknown,
        attachments_bytes: files.bytes,
      });
    }

    if (action === "preview_send") {
      const ids = uuids(body.recipient_ids).slice(0, PREVIEW_MAX);
      if (!ids.length) return json(req, { error: "recipient_ids required" }, 400);
      return json(req, await previewSend(ctx, ids, adoptChosen(campaign, body.adopt), body.pdfs_on_send === true));
    }

    if (action === "send") {
      if (campaign.archived_at) return json(req, { error: "campaign_archived" }, 400);
      const all = uuids(body.recipient_ids);
      if (!all.length) return json(req, { error: "recipient_ids required" }, 400);
      const ids = all.slice(0, BATCH_MAX);
      const adopt = adoptChosen(campaign, body.adopt);
      const rows = await loadRecipients(campaign.id, ids);
      const byId = new Map(rows.map((r) => [r.id, r]));
      const results: Result[] = [];
      const notReached: string[] = [];
      const started = Date.now();
      let resendCalls = 0;
      for (const id of ids) {
        if (results.length > 0 && Date.now() - started > SEND_BUDGET_MS) { notReached.push(id); continue; }
        const r = byId.get(id);
        if (!r) { results.push({ id, outcome: "skipped", code: "not_found" }); continue; }
        if (resendCalls > 0) await sleep(SPACING_MS);
        const res = await sendOne(ctx, r, { resend: false, adopt: adopt.has(id), force: body.force_capacity === true });
        if (res.outcome === "sent" || res.outcome === "failed" || res.outcome === "uncertain") resendCalls++;
        results.push(res);
      }
      const n = (o: Outcome) => results.filter((x) => x.outcome === o).length;
      return json(req, {
        ok: true, sent: n("sent"), failed: n("failed"), uncertain: n("uncertain"), blocked: n("blocked"), skipped: n("skipped"),
        results, remaining: [...notReached, ...all.slice(BATCH_MAX)],
      });
    }

    if (action === "resend") {
      if (campaign.archived_at) return json(req, { error: "campaign_archived" }, 400);
      if (!isUuid(body.recipient_id)) return json(req, { error: "recipient_id required" }, 400);
      const [r] = await loadRecipients(campaign.id, [body.recipient_id.toLowerCase()]);
      if (!r) return json(req, { error: "recipient_not_found" }, 404);
      const res = await sendOne(ctx, r, { resend: true, adopt: false, force: false });
      return json(req, { ok: res.outcome === "sent", result: res });
    }

    if (action === "set_answer") {
      if (!isUuid(body.recipient_id)) return json(req, { error: "recipient_id required" }, 400);
      if (!["accepted", "declined", "no_answer"].includes(body.answer)) return json(req, { error: "bad_answer" }, 400);
      const [r] = await loadRecipients(campaign.id, [body.recipient_id.toLowerCase()]);
      if (!r) return json(req, { error: "recipient_not_found" }, 404);
      const res = await rpc("invitation_set_answer", {
        p_recipient_id: r.id, p_answer: body.answer, p_force: body.force === true, p_actor: uid,
      });
      if (!res.ok) return json(req, res);
      let pass: { sent: boolean; error?: string } | null = null;
      if (res.pass_needed && res.guest_id) {
        const p = await sendPassThroughGuestList(jwt, event.id, String(res.guest_id));
        pass = { sent: p.ok, ...(p.error ? { error: p.error } : {}) };
        await journal(ctx, r.id, p.ok ? "pass_sent" : "pass_failed", { guest_id: res.guest_id, error: p.error || null });
      }
      // pass.sent false: the answer is recorded; "Accepted" again retries the pass.
      return json(req, { ...res, pass });
    }

    return json(req, { error: "Unknown action" }, 400);
  } catch (e) {
    console.error("invitation-campaign:", action, e instanceof Error ? e.message : e);
    return json(req, { error: e instanceof Error ? e.message.slice(0, 300) : "error" }, 500);
  }
});
