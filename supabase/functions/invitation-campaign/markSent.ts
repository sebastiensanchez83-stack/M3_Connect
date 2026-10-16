// "Mark as sent" of the "Invitation campaigns" admin module: an invitation that went out
// WITHOUT the platform (Victor's own mailbox, a posted letter, a phone call, in person,
// through somebody else; the SM26 channel list). The edge function's action "mark_sent".
//
// PURE: no import, no Deno, DOM or network API, erasable TypeScript only. index.ts hands it
// the database (MarkSentDeps); scripts/invitations-check.mjs drives it against an in-memory
// copy of the SQL functions' contracts.
//
// It does everything a platform send does, except sending (same rules as sendOne in
// index.ts):
//   - the sender's lock: one guest at a time, draft or ready only, so a guest is never marked
//     (or sent) twice, and a mark never races a platform send;
//   - one person, one invitation: a same name staff have not dismissed in the Guests tab
//     ("Not the same person") blocks;
//   - the guest-list path: invitation_link_guest WITHOUT its adopt option (a new "invited" row;
//     an address already invited, confirmed or declined in WYS 2026 is never invited twice),
//     a pending /wys26 request only when staff chose to adopt it (invitation_adopt_request,
//     same row and token), the guest's own row cancelled after a refused send re-opened
//     (invitation_relink_guest); capacity as guest-list v6 "invite", unless forced;
//   - then invitation_mark_sent, in ONE transaction: the gl_email_log 'invitation' line the
//     health monitor expects within 10 minutes of the link, status sent, sent_at, lock and
//     error cleared, journal line 'invitation_sent'. Its message_id is "hand:<channel>", so
//     the channel is recorded in that same transaction. A 'sent_by_hand' journal line adds
//     the date given by staff.
//     gl_email_log cannot tell a hand-sent invitation from a platform e-mail (same kind
//     'invitation', the guest's address): the monitor only needs the line. Anything that
//     reports what was e-mailed must read the channel from invitation_log (invitationChannels).
//   - a platform send that may have gone out (send_uncertain, sent_not_recorded) can be
//     recorded as the platform's e-mail, channel "platform" (message_id PLATFORM_RECORDED), and
//     only such a guest; sent_not_recorded is always recorded so, since that e-mail went out.
// If recording fails, the link made here is undone (invitation_unlink_guest or
// invitation_unadopt_request): no guest-list row stays "invited" without its log line.
// Nothing is e-mailed here. The entry pass still goes when staff mark the guest Accepted.

/** The SM26 channels (src/components/admin/types.ts SM26_INVITE_CHANNELS), without "Letter drawn here". */
export const INVITATION_HAND_CHANNELS = ["email", "post", "phone", "in_person", "third_party"] as const;
export type InvitationHandChannel = (typeof INVITATION_HAND_CHANNELS)[number];
/**
 * What staff may record: one of the SM26 channels, or "platform" for a platform e-mail that went
 * out but was not recorded (only for a guest whose send was interrupted, see markSentOne).
 */
export type InvitationMarkChannel = InvitationHandChannel | "platform";
/** invitation_mark_sent's message_id for an invitation sent by hand: "hand:post". */
export const INVITATION_HAND_PREFIX = "hand:";
/** invitation_mark_sent's message_id for a platform e-mail recorded with "Mark as sent" (Tracking shows it as the platform's). */
export const PLATFORM_RECORDED = "platform:recorded_by_staff";
/** Guests per "mark_sent" call (no e-mail goes out, but each guest takes a few database calls). */
export const MARK_SENT_BATCH_MAX = 25;
/** How far back a date may go (a list recorded late), in days. */
export const MARK_SENT_MAX_AGE_DAYS = 400;

// deno-lint-ignore no-explicit-any
export type MarkRow = Record<string, any>;

export type HandSentInput =
  | { ok: true; channel: InvitationMarkChannel; sentOn: string | null }
  | { ok: false; error: "bad_channel" | "bad_date" | "future_date" | "too_old" };

const isoDay = (d: Date) => d.toISOString().slice(0, 10);

/**
 * Checks the channel and the date of a "mark_sent" call. The date is YYYY-MM-DD; empty means
 * "now" (sent_at keeps the time of the mark). A date may be at most one day ahead of the
 * server's UTC day (a guest marked late in the evening east of Greenwich) and at most
 * MARK_SENT_MAX_AGE_DAYS old.
 */
export function parseHandSent(channel: unknown, sentOn: unknown, now: Date): HandSentInput {
  const ch = typeof channel === "string" ? channel.trim() : "";
  if (ch !== "platform" && !(INVITATION_HAND_CHANNELS as readonly string[]).includes(ch)) return { ok: false, error: "bad_channel" };
  if (sentOn === null || sentOn === undefined || sentOn === "") return { ok: true, channel: ch as InvitationMarkChannel, sentOn: null };
  if (typeof sentOn !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(sentOn)) return { ok: false, error: "bad_date" };
  const d = new Date(`${sentOn}T12:00:00Z`);
  // 2026-02-30 rolls over to 2 March: only a real day comes back unchanged.
  if (Number.isNaN(d.getTime()) || isoDay(d) !== sentOn) return { ok: false, error: "bad_date" };
  if (sentOn > isoDay(new Date(now.getTime() + 86_400_000))) return { ok: false, error: "future_date" };
  if (sentOn < isoDay(new Date(now.getTime() - MARK_SENT_MAX_AGE_DAYS * 86_400_000))) return { ok: false, error: "too_old" };
  return { ok: true, channel: ch as InvitationMarkChannel, sentOn };
}

/** What index.ts gives: its sender helpers, on the real database. */
export interface MarkSentDeps {
  /** The sender's lock on a draft or ready guest, and the guest as it is now; null if taken, or not draft/ready. */
  claim(id: string): Promise<{ at: string; row: MarkRow } | null>;
  /** Lets the lock go, nothing else changed. */
  unlock(id: string, at: string): Promise<void>;
  /** Lets the lock go and stores the code in send_error (null clears it). */
  release(id: string, at: string, code: string | null): Promise<void>;
  /** invitation_find_duplicates(campaign, this guest). Throws on a database error. */
  duplicates(recipientId: string): Promise<MarkRow[]>;
  /** A database function as the service role, for the staff member (p_actor). Throws on a database error. */
  rpc(fn: string, args: Record<string, unknown>): Promise<MarkRow>;
  /** The guest row as it is now (status, gl_guest_id), or null. */
  read(id: string): Promise<MarkRow | null>;
  /** Writes sent_at on a guest now sent. Never throws: false when it did not save. */
  setSentAt(id: string, iso: string): Promise<boolean>;
  /** A journal line (invitation_log) in the staff member's name. Never throws. */
  journal(recipientId: string, action: string, payload: Record<string, unknown>): Promise<void>;
}

export interface MarkSentOptions {
  /** The verified staff member (p_actor). */
  actor: string;
  /** "platform" is refused (platform_not_sent) unless this guest's platform send may have gone out. */
  channel: InvitationMarkChannel;
  /** YYYY-MM-DD given by staff, or null for now. */
  sentOn: string | null;
  /** Staff chose, in the Guests tab, to adopt this guest's pending /wys26 request. */
  adopt: boolean;
  /** Over the event capacity anyway. */
  force: boolean;
  /** settings.dismissed_duplicates, lower case: "recipientId:otherId" marked "Not the same person". */
  dismissed: Set<string>;
}

export type MarkOutcome = "sent" | "skipped" | "blocked" | "failed";
export interface MarkResult {
  id: string;
  outcome: MarkOutcome;
  code?: string;
  detail?: string;
  guest_id?: string;
  adopted?: "request";
  status?: string;
  /** The channel recorded: "platform" for a platform e-mail that went out (always so for sent_not_recorded). */
  channel?: InvitationMarkChannel;
}

/** A last send that may have gone out keeps its mark until something replaces it (sendOne's rule). */
const MAY_HAVE_GONE = ["send_uncertain", "sent_not_recorded"];

/** Marks ONE guest as invited by hand. `seen` is the guest as the call read it (maybe a minute old). */
export async function markSentOne(deps: MarkSentDeps, seen: MarkRow, o: MarkSentOptions): Promise<MarkResult> {
  const id = String(seen.id);
  if (!seen.email) return { id, outcome: "blocked", code: "no_email" };
  if (!["draft", "ready"].includes(seen.status)) return { id, outcome: "skipped", code: "already_sent", status: seen.status };
  const lock = await deps.claim(id);
  if (!lock) return { id, outcome: "skipped", code: "in_progress_or_sent" };
  const { at } = lock;
  const r = lock.row; // read again under the lock
  const leave = async (res: MarkResult): Promise<MarkResult> => { await deps.unlock(id, at); return res; };
  const keep = r.gl_guest_id && MAY_HAVE_GONE.includes(r.send_error) ? String(r.send_error) : null;
  if (!r.email) return await leave({ id, outcome: "blocked", code: "no_email" });
  // "Platform e-mail" only records a platform send that may have gone out. One that certainly
  // went out (sent_not_recorded) is recorded as the platform's, whatever channel was chosen.
  if (o.channel === "platform" && !keep) return await leave({ id, outcome: "blocked", code: "platform_not_sent" });
  const channel: InvitationMarkChannel = keep === "sent_not_recorded" ? "platform" : o.channel;

  let undo: "invitation_unlink_guest" | "invitation_unadopt_request" | null = null;
  let guestId = "";
  /** Undoes the link made by this call; returns what happened, for the journal. */
  const undoLink = async (): Promise<string | null> => {
    if (!undo) return null;
    try {
      const u = await deps.rpc(undo, { p_recipient_id: id, p_actor: o.actor });
      return u.ok ? "undone" : `undo_refused_${u.error}`;
    } catch {
      return "undo_error";
    }
  };
  const failed = async (code: string, detail: string | null): Promise<MarkResult> => {
    const undone = await undoLink();
    await deps.release(id, at, keep || code);
    await deps.journal(id, "mark_failed", { error: code, guest_id: guestId || null, undone, detail });
    return { id, outcome: "failed", code, detail: undone || undefined, ...(guestId && undone !== "undone" ? { guest_id: guestId } : {}) };
  };

  try {
    // One person, one invitation (same rule as the send): a name match not dismissed blocks.
    const dups = await deps.duplicates(id);
    const same = dups.filter((d) => d.recipient_id === id && d.match_on !== "email"
      && !o.dismissed.has(`${id}:${d.other_id}`.toLowerCase())).map((d) => `${d.other_kind}:${d.other_id}`);
    if (same.length) return await leave({ id, outcome: "blocked", code: "same_person", detail: same.join(" ") });

    // On the guest list (or already there), exactly as the send does it.
    let adopted: "request" | undefined;
    let link = await deps.rpc("invitation_link_guest", { p_recipient_id: id, p_force: o.force, p_adopt: false, p_actor: o.actor });
    if (!link.ok && link.error === "already_on_list" && link.guest_status === "requested" && link.guest_source === "request" && o.adopt) {
      link = await deps.rpc("invitation_adopt_request", { p_recipient_id: id, p_force: o.force, p_actor: o.actor });
      if (link.ok && link.adopted_request) { undo = "invitation_unadopt_request"; adopted = "request"; }
    } else if (!link.ok && link.error === "already_on_list" && link.guest_status === "cancelled" && link.guest_source === "invitation") {
      // Most likely this guest's own row, cancelled by the undo of an earlier refused send.
      const re = await deps.rpc("invitation_relink_guest", { p_recipient_id: id, p_force: o.force, p_actor: o.actor });
      if (re.ok) { link = re; undo = "invitation_unlink_guest"; } else if (re.error !== "not_relinkable") link = re;
    } else if (link.ok && link.created) {
      undo = "invitation_unlink_guest";
    } else if (link.ok && link.already_linked && !["invited", "confirmed"].includes(link.guest_status)) {
      // Linked by an earlier send that failed; the row changed in WYS 2026 since.
      return await leave({ id, outcome: "blocked", code: `guest_${link.guest_status || "missing"}` });
    }
    if (!link.ok) {
      const onList = link.error === "already_on_list";
      const code = onList && link.guest_status === "requested" && link.guest_source === "request" ? "pending_request"
        : onList && ["rejected", "cancelled", "requested"].includes(link.guest_status) ? "not_adoptable"
        : String(link.error || "link_failed");
      const detail = [link.guest_status, link.held != null ? `${link.held}/${link.capacity}` : ""].filter(Boolean).join(" ");
      return await leave({ id, outcome: "blocked", code, ...(detail ? { detail } : {}) });
    }
    guestId = String(link.guest_id);

    // Record it: the monitor's log line, status, journal, in one transaction. One call only:
    // if its answer is lost, the row says whether it went through (never a second log line).
    let marked: MarkRow | null = null;
    let markError = "";
    try {
      marked = await deps.rpc("invitation_mark_sent", {
        p_recipient_id: id, p_actor: o.actor, p_resend: false,
        p_message_id: channel === "platform" ? PLATFORM_RECORDED : `${INVITATION_HAND_PREFIX}${channel}`,
      });
    } catch (e) {
      markError = e instanceof Error ? e.message.slice(0, 200) : "error";
      const now = await deps.read(id).catch(() => null);
      if (now && now.status === "sent" && String(now.gl_guest_id) === guestId) marked = { ok: true, status: "sent", recovered: true };
    }
    if (!marked?.ok) return await failed("mark_failed", marked?.error ? String(marked.error) : markError || null);

    const dateSaved = o.sentOn ? await deps.setSentAt(id, `${o.sentOn}T12:00:00.000Z`) : true;
    await deps.journal(id, "sent_by_hand", {
      guest_id: guestId, channel, sent_on: o.sentOn, adopted: adopted || null, date_saved: dateSaved,
      ...(channel !== o.channel ? { chosen: o.channel } : {}), ...(keep ? { after: keep } : {}),
    });
    return {
      id, outcome: "sent", guest_id: guestId, status: String(marked.status || "sent"), channel,
      ...(adopted ? { adopted } : {}), ...(dateSaved ? {} : { detail: "date_not_saved" }),
    };
  } catch (e) {
    // A database error before anything was recorded (the link may have been made).
    return await failed("error", e instanceof Error ? e.message.slice(0, 200) : "error");
  }
}

/** The channel of a guest's first invitation, from the journal (invitation_log) lines of a campaign. */
export function invitationChannels(lines: { recipient_id: string | null; action: string; payload: MarkRow | null }[]): Map<string, string> {
  const out = new Map<string, string>();
  for (const l of lines) {
    if (!l.recipient_id || out.has(l.recipient_id)) continue;
    const p = l.payload || {};
    if (l.action === "sent_by_hand" && typeof p.channel === "string") out.set(l.recipient_id, p.channel);
    else if (l.action === "invitation_sent" && !p.resend) {
      const m = typeof p.message_id === "string" && p.message_id.startsWith(INVITATION_HAND_PREFIX) ? p.message_id.slice(INVITATION_HAND_PREFIX.length) : "";
      out.set(l.recipient_id, m || "platform");
    }
  }
  return out;
}
