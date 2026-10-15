# Registration core: database contract (Phase 0.7 + Phase 1)

The EDGE, REG and ADMIN lanes build on this. Source of truth:
`supabase/migrations/20261009200000_registration_prereqs.sql` and
`supabase/migrations/20261009210000_registration_core.sql` (apply in that order, see §9).
Spec: `regspec-en.md` §3, §4, §11, §13. Anything not listed here is not built yet (see "Not in this migration").

## 1. Engines and invariants

| | `guest_list_v1` (wys26, canary-onsite) | `core_v2` (every new event, canary-v2) |
|---|---|---|
| Public writes | edge fn `guest-list` (FROZEN, never redeployed before 28 Nov) | edge fn `registration` via `gl_register_v2()` |
| Staff decisions | `guest-list` decide / invite / resend / cancel / update | `registration` via `gl_decide_v2()` |
| Statuses (`gl_guest.status`) | requested, invited, confirmed, declined, rejected, cancelled (enforced by trigger) | + needs_info, waitlisted, approved |
| Sources (`gl_guest.source`) | request, invitation, plus_one (enforced) | + registration (`request` written only in invitation mode, existing `request` rows stay editable after a mode change; a new `plus_one` only when `plus_ones = 1`) |
| Personal link | `/{slug}/guest?t={gl_guest.token}` (also the door QR) | `/registration?t={raw token}`, only sha256 stored (`gl_access_token`) |
| `user_id` on a new row | kept only when that account PROVED the row's address (else dropped silently by the guard) | set by `gl_register_v2` for a signed-in caller |
| Door QR | `gl_guest.token` (`door_token = 'shared'`, always) | `gl_guest.checkin_token` (`door_token = 'separate'`, always), minted by the DB at confirmation |
| Check-in RPC | `gl_checkin` (untouched) or `gl_checkin_v2` | `gl_checkin_v2` |

`door_token` follows `engine` (CHECK `gl_event_door_matches_engine`): a printed WYS QR is always admitted, and a core_v2 `gl_guest.token` is never a pass and never shown to anyone.
`guest-list` itself does not check the engine: its token actions (guest, rsvp, plus_one) and staff actions accept any slug or token. Only ever use it, and `AdminGuestList`, on `guest_list_v1` events.
Never: write any `sm_*` row; change a `gl_guest.token`; set `checkin_token` on a v1 row; move `/wys26`, `/wys26/guest?t=`, `/admin/guest-list/wys26/checkin?token=`.
Seats held = confirmed + invited + approved (`gl_seats_held`). On v1 this equals guest-list's rule.

## 2. Tables

### `gl_event` (one per event that takes registrations; staff-only RLS)
Existing: `id, slug, title, legacy_event_id (-> events.id, unique when set), capacity, notify_email, requests_open, settings jsonb, created_at`.
New (defaults reproduce today's behaviour):

| column | type / values | default |
|---|---|---|
| `hidden` | bool (never listed publicly; reachable by link; canaries and test events) | false |
| `engine` | `guest_list_v1` \| `core_v2` | guest_list_v1 |
| `kind` | `webinar` \| `onsite` | onsite |
| `registration_mode` | `instant` (webinars only) \| `review` \| `invitation` | invitation |
| `public_requests` | bool: invitation mode accepts "request an invitation" | true |
| `access` | `public` \| `members` (verified person). Gates the REGISTRATION only: the event page stays public (`events.access_level` is always `public` for core_v2; `members` there would mean marketplace access) | public |
| `opens_at`, `closes_at`, `edit_locks_at` | timestamptz (closes default = event end) | null |
| `waitlist` | bool | false |
| `plus_ones` | 0 \| 1 | 0 |
| `standard_fields` | `{company, job_title, phone, country: required\|optional\|hidden}`; missing key = optional; enforced by `gl_register_v2` | `{}` |
| `account_email_timing` | `with_confirmation` \| `after_event` | with_confirmation |
| `account_email_send_at` | timestamptz (after_event) | null |
| `meeting_url`, `replay_url` | text, staff-only; served to confirmed registrants | null |
| `reminders` | jsonb array of ISO-8601 durations before start, e.g. `["P1D","PT1H"]`, `["P7D"]` | `[]` |
| `door_token` | `shared` (v1) \| `separate` (v2); tied to `engine` | shared |
| `staff_alert_mode` | `each` \| `digest` | each |
| `updated_at` | timestamptz | now() |

CHECKs: `registration_mode <> 'instant' or kind = 'webinar'`; `engine = 'guest_list_v1' or requests_open = false`; `(engine = 'guest_list_v1' and door_token = 'shared') or (engine = 'core_v2' and door_token = 'separate')`.
Catalogue data (title, dates, image, speakers, published) lives in `events` (joined by `legacy_event_id`). Events without a catalogue row (only the canaries) read `settings.starts_at` / `settings.ends_at` (ISO strings). Use `gl_event_window(id)` for dates.
Data now: wys26 = guest_list_v1 / onsite / invitation / shared / with_confirmation. canary-onsite = guest_list_v1, hidden, `requests_open = false`. canary-v2 = core_v2 / webinar / instant / separate, hidden, capacity 20, fixed dates 30 June 2027 10:00-11:00 UTC, and CLOSED (`closes_at` 1 Oct 2026): its slug is in this public repository and a hidden event skips the registration flags, so an open canary would let anyone make the platform e-mail any address. Open it only for a test run (§9). To move them (staff SQL): `update gl_event set settings = settings || '{"starts_at":"2027-...Z","ends_at":"2027-...Z"}' where slug = 'canary-v2';`
`settings` keys of core_v2 events (no CHECK; `admin_save_event` MERGES them, so a save never removes a key; written by the event editor, read by `registration` / `registration-cron`): `timezone` (IANA, default Europe/Monaco: the event's wall-clock times), `no_reminders` (true = no reminder e-mails), `contact_email` (reply-to of the registrants' e-mails; empty = events@m3monaco.com), `practical_info` (else `programme_note`: printed in the on-site e-mails), `attendance_recorded` (webinars: `true` = staff pressed "Attendance is complete", absentees get "Sorry we missed you"; `false` = not complete yet, absentees are never known, and a replay link then goes to everyone as "The replay is available"; ABSENT = the cron decides: absentees known 30 minutes after the last attendance mark; the editor writes `false` on create, on duplicate and before the first mark), `starts_at` / `ends_at` (events without a catalogue row only). Not read by any function yet: `ask_image_consent` (the register form can show an image-rights tick box; Phase 1 asks image rights, when needed, with a question of kind `consent`) and `followup_note` (a personal text in the follow-up e-mail).

### `gl_ticket` (participation types; staff-only RLS) - unique `(event_id, key)`
`id, event_id, key (^[a-z0-9_]{1,40}$), label, description, price_cents (>=0, display only until December), currency 'EUR', price_note, invite_only bool, capacity int, allowed_company_types text[] (organization_type values), parts text[], display_order, active, created_at`.
No active ticket = implicit single "attendee" ticket (`ticket_key` stays null).

### `gl_question` (the event's own questions; staff-only RLS) - unique `(event_id, key)`
`id, event_id, key (^[a-z0-9_]{1,40}$), label, help, kind, options jsonb, max_length (1..10000), required, ticket_keys text[] (null/empty = every ticket), profile_field, editable_after_submit (default true), display_order, created_at`.
`kind`: `text, textarea, select, multiselect, checkbox, url, phone, country, sectors, parts, consent`.
`options`: array of `{"value": "...", "label": "..."}` (plain strings also accepted).
`profile_field`: `job_title | country | phone | linkedin_url` (written back to an empty profile field of a signed-in registrant; `phone` is accepted but NEVER written back: co-members of a company read each other's profiles, and the editor no longer offers it).
Answer shapes in `gl_guest.answers[key]`: checkbox/consent = boolean; multiselect/sectors/parts = array of strings (multiselect/parts within options); others = string (cut to max_length, default 500, textarea 4000; select within options).

### `gl_guest` additions (staff-only RLS; public goes through edge functions)
| column | values | default |
|---|---|---|
| `user_id` | -> auth.users, unique per event. guest_list_v1 INSERT: kept only if that account proved the row's address | null |
| `organization_id` | -> organizations | null |
| `ticket_key` | gl_ticket.key | null |
| `answers` | jsonb object | `{}` |
| `consents` | `{terms_at, image, marketing_at}` (other keys dropped by `gl_register_v2`) | `{}` |
| `source_detail` | `{entry: signup\|event_page\|deep_link\|campaign, ref, utm_source, utm_medium, utm_campaign, utm_term, utm_content}` (strings; other keys dropped) | `{}` |
| `payment_status` | `none, due, pending, invoiced, paid, waived, refunded` | none |
| `amount_cents`, `currency` | | null |
| `checkin_token` | uuid unique; v2 door QR; DB-minted | null |
| `info_request`, `info_requested_at` | needs_info loop (set by `gl_decide_v2`) | null |
| `link_opened_at` | first status-link opening (queue signal, never proof) | null |
| `cancelled_at` | DB-stamped when status becomes cancelled | null |
| `reminders_sent` | jsonb, e.g. `{"P1D": "<ts>"}` (cron) | `{}` |
| `account_action` | `linked, created, pending_link, skipped` (provisioning) | null |
| `provisioned_at` | | null |
| `updated_at` | DB-stamped on every update | now() |

Unique: `(event_id, lower(email))` (existing), `(event_id, user_id)`, `token`, `checkin_token`.

### `gl_access_token` (service role only; RLS on, no policy)
`token_hash bytea pk = sha256(raw token)`, `guest_id`, `created_at`, `last_used_at`, `expires_at` (event end + 30 days, at least now + 30 days), `revoked_at`.
Raw token: 43 chars base64url. `encode(sha256(token),'hex')` equals Node/Deno `sha256` hex of the UTF-8 token. "Resend my links" mints a new token; old ones keep working until expiry. Never the door token.

### `account_provision_job` (outbox; staff SELECT via RLS; writes: triggers, definer RPCs, service role)
`id, source_kind ('gl_guest'|'staff'), source_id, email (lower), payload jsonb {first_name, last_name, job_title, country, phone, company, gl_event_id, event_slug, guest_user_id}, org_action jsonb (default {"mode":"none"}; {mode: none|link|create, org_id, type, name, website, country, as_owner}), validate_person (default true), status ('queued'|'done'|'skipped'|'failed'), attempts, last_error, email_due_at, email_sent_at, created_by, created_at, done_at`. Unique `(source_kind, source_id)`.
Queued by the trigger (§3) with the default choices; `gl_decide_v2` stores the staff choices in the same transaction. guest-list approvals (wys26) keep the defaults: none / validate. Rows already confirmed on an on-site event when the migration runs get their job once (backfill).
A registration confirmed AGAIN (declined then accepted, cancelled then re-approved, reactivated) re-queues its job when that job is `skipped` or `failed`: `status='queued'`, `attempts=0`, fresh `email`/`payload`/`email_due_at`, default choices. A `queued` or `done` job is left alone.

### `review_log` (staff SELECT via RLS; no client write - use `review_log_add`)
`id bigint, subject_type ('person'|'company'|'registration'|'claim'|'join'|'merge'), subject_id uuid, action text (<=60), note, details jsonb, actor_id (spec "by"), created_at (spec "at")`.

### `profiles` additions
`country (<=80), phone (<=40), linkedin_url (<=300), affiliation (<=200), signup_source ('account'|'webinar'|'onsite'|'invitation'|'provisioned'|'legacy'; existing 155 rows = 'legacy', new rows NULL until Phase 2 sets it), signup_intent jsonb (Phase 2; never store a raw claim code: co-members can read profiles), email_proven_at, email_changed_at`.
Frozen against direct API writes by anyone but a verified admin (silently kept, no error): `email, email_proven_at, email_changed_at, signup_source, signup_intent` (+ `persona, access_status` as before). On an API INSERT they start empty and `email` = the JWT e-mail. `country, phone, linkedin_url, affiliation` are user-editable.
`profiles.email` = read-only copy of `auth.users.email` (trigger).
**Proven** (everywhere: `my_participations`, `get_my_event_access`, attach, `mark_email_proven`, the v1 guard) = `email_proven_at` is set AND `lower(profiles.email) = lower(auth.users.email)`: the proof belongs to the address it was stamped for. If an e-mail change ever fails to sync `profiles.email`, the old proof stops counting until a fresh link proves the new address. Use the same test in edge code.

### `profile_interest_sectors` (own rows + staff; anon nothing)
`user_id -> profiles, sector_id -> sectors, created_at`, pk `(user_id, sector_id)`. Insert/delete own rows (UI caps at 5).

### `platform_settings` keys (anyone reads except the last; staff write)
- `registration_flags`: `{"webinar_v2","onsite_v2","front_door","account_signup_v2","password_only_login","wys_form_v2","wys_status_edit","review_queue","provisioning","capabilities_enforced","turnstile"}`, all `false`. Missing key = false. **A switch is on only when its value is the JSON boolean `true`**: the text `"true"`, `1`, `"yes"` are off, everywhere (site `src/lib/flags.ts`, every edge function, and in SQL `admin_save_event`, `events_publish_guard`, `invoke_registration_cron`, which compare `(value -> key) = 'true'::jsonb`). Write flags as `{"webinar_v2": true}`, never `{"webinar_v2": "true"}`.
- `review_sla_text`: JSON string, "within 2 working days".
- `review_digest_recipients`: JSON array of e-mails, **staff-only** (restrictive policy). Seeded from the wys26 staff alert address.

### `guest_signup_rate_limits.scope`
New nullable text. The `registration` function writes its own scope (`reg_register`, `reg_resend`, ...) and counts with `.eq('scope', ...)`. NULL = guest-webinar-register, which counts every row by `ip_hash` / `email_hash` with no scope filter: hash with a prefix of your own, `sha256('reg:ip:' + ip)` and `sha256('reg:email:' + email)` (guest-webinar-register uses `ip:` / `email:`), so the two never count each other's rows. Rows deleted after 24 h.

## 3. What the database does on its own

| Trigger | When | Effect |
|---|---|---|
| `gl_guest_engine_guard` (BEFORE INSERT/UPDATE) | every gl_guest write | v1: refuses v2 statuses/sources and any checkin_token (SQLSTATE 23514, message starts `gl_guest_engine_guard`); on INSERT drops a `user_id` whose account has not proved the row's address. v2: refuses WRITING `source='request'` unless invitation mode (an existing request row stays editable after a mode change), and a new `source='plus_one'` row when `plus_ones = 0`; mints `checkin_token` when a row becomes `confirmed`. Stamps `cancelled_at`, `updated_at`. |
| `gl_guest_queue_provisioning` (AFTER INSERT/UPDATE OF status) | row becomes `confirmed` on a `kind='onsite'` event | inserts ONE `account_provision_job`, or re-queues it when it was `skipped`/`failed` (see §2); `email_due_at` = now (with_confirmation) or `account_email_send_at` / event end + 1 day (after_event). Never aborts the write. Covers wys26 approvals, RSVP accepts and plus-ones made by guest-list. |
| `event_registrations_engine_guard` (BEFORE INSERT/UPDATE OF event_id ON event_registrations) | the event has a core_v2 `gl_event` | refuses the row (23514, message starts `event_registrations_engine_guard`): RLS clients and the service-role `guest-webinar-register` alike. A core_v2 event registers in `gl_guest` only. |
| `events_publish_guard` (BEFORE INSERT/UPDATE OF published ON events) | a core_v2 event becomes published | refuses (22023 `publish_needs_flag`) unless flag `webinar_v2` (webinar) / `onsite_v2` (on-site) is on. Also checked inside `admin_save_event`. |
| `events_core_v2_meeting_url` (BEFORE UPDATE OF meeting_url ON events; migration `20261010120000_registration_catalogue_guard`) | a core_v2 event | forces `events.meeting_url` to NULL (the join link lives in `gl_event.meeting_url`; `events` is readable by anon). No error: the old editor still saves. |
| `events_core_v2_delete` (BEFORE DELETE ON events; same migration) | a core_v2 event | refused (23514, message starts `events_core_v2_delete`) while any `gl_guest` row exists; otherwise its `gl_event` (tickets, questions) is deleted with it, never left orphaned. |
| (none on e-mail confirmation) | | **No auth event proves an address** (integration review, 10 Oct 2026). A click on a sign-up confirmation, invite or recovery link proves the mailbox, not that the account's password belongs to its owner; and while Confirm email is off, a public sign-up with the address of an existing UNCONFIRMED account confirms it and returns a session to that caller without setting a password (GoTrue `signup.go`). Proof comes only from `mark_email_proven` (§4), once a new password is saved from an e-mailed link's session. `on_email_proven(uid)` (called by it) stamps proof (and sets `profiles.email` to the auth e-mail), puts the person's provisioning jobs left `pending_link` back to `queued` (confirmed row, job `done`, row `account_action='pending_link'`, row address = the address just proved, row unlinked or linked to this account), then attaches records and runs `complete_signup_for`, each in its own block: a failure there never loses the stamp. |
| `on_auth_user_email_changed` (auth.users) | `email` changed | `profiles.email` follows; `email_changed_at` = now; the proof is CLEARED, whatever the flow (the owner of the new address may click a "confirm your new address" e-mail for a change they never asked for: that proves the inbox, not the password). The person proves the new address with a new password saved from an e-mailed link (Forgot password?). |
| `trg_link_guest_registrations` (AFTER INSERT ON profiles) | a new account | **KEPT, unchanged** (integration review, 10 Oct 2026): links legacy `event_registrations` guest rows typed with the same address to the new account, unproven, exactly as the live main site does today. It never touches `gl_guest` or `sm_*`. With Confirm email off most new accounts never prove their address, so the proof-based attach cannot replace it yet; Phase 2 (AUTH lane: proof on every sign-up) drops it. |

The trigger on `auth.users` swallows its own errors (RAISE WARNING): auth never fails because of it.

## 4. RPCs

Errors: `raise` with SQLSTATE `42501` + message `forbidden` (wrong caller) or SQLSTATE `22023` + a code as message (listed). Map codes to English UI text. The service-role RPCs return `{ok:false, error}` instead of raising.

### Signed-in (authenticated)
| RPC | Returns | Notes |
|---|---|---|
| `my_participations()` | rows: `engine ('guest_list_v1'\|'core_v2'\|'legacy'\|'sm26'), registration_id, gl_event_id, event_id (events.id), slug, title, starts_at, ends_at, is_past, kind ('webinar'\|'onsite'), location, image_url, role_or_ticket, status (raw), status_display, payment_display, status_url, can_cancel, linked` ordered by starts_at desc | Rows by `user_id`, or by the auth e-mail when PROVEN (gl_guest, legacy guest rows, SM26 attendee). SM26 rows read-only (`can_cancel=false`, `status_url='/sm26/me'`). v1 rows: `status_url='/{slug}/guest?t={token}'` ONLY when the caller is proven, else null (that token is also the WYS door QR). v2 rows: `status_url=null` (manage with the session through `registration`). Legacy rows on a core_v2 event are never listed. |
| `get_my_event_access(p_event_ids uuid[] default null)` | `event_id, is_registered, meeting_url, replay_url` | Unchanged for every legacy row of today. The legacy branch ignores core_v2 events (their only registration is `gl_guest`). Adds: a CONFIRMED gl_guest of the caller (by user_id or proven e-mail) on `gl_event.legacy_event_id` -> `is_registered`, `meeting_url = coalesce(gl_event.meeting_url, events.meeting_url)`, `replay_url = gl_event.replay_url`. Staff always get the links. |
| `mark_email_proven()` | `{proven, stamped, attached?, requeued?, reason?}`; reason: `no_profile, no_email_link_session, email_changed_since, link_session_too_old, impersonation` | Called (`src/lib/emailProof.ts`) by `/welcome` and `/reset-password` once the person has SAVED A NEW PASSWORD from the e-mailed link's session (and signed the account's other sessions out), never as soon as the link opens: until then the password may be someone else's (Confirm email is off: anyone can create an account with another person's address), and the proof would hand them the registrations sent to that address. `/verify-email` (Phase 2 `confirm_email_proof`, §10.4) follows the same idea: it stamps only in a session opened with the account's password. Stamping runs `on_email_proven` (attach + re-queue of `pending_link` jobs). Stamps when the JWT `amr` has `otp, magiclink, recovery, invite, email/signup` or `email_change` dated after the last e-mail change AND less than 60 minutes ago (time to choose a password), and no admin "view as user" was logged within 5 minutes before / 1 minute after that link session. A link session too old (`link_session_too_old`) writes one `review_log` row (subject `person`, action `email_proof_late`, at most once an hour): staff tell the person to use "Forgot password?" again (§9). The ONLY way an address becomes proven. A proof stamped for an older address (`profiles.email` out of step) is re-stamped and `profiles.email` re-synced. |
| `attach_my_records()` | int (rows linked) | No-op unless proven. Once per session from AuthContext (Phase 2). Links gl_guest + legacy event_registrations guest rows; never sm_*. Never two rows of one event to one account. |
| `admin_save_event(p jsonb)` | `{gl_event_id, event_id, slug}` | Staff (`is_moderator`). See 4.1. |
| `admin_clone_event(p_src uuid, p_overrides jsonb)` | same | Staff. Copy (either engine) as a new unpublished core_v2 event with its tickets and questions; no meeting/replay links or dates of opening copied. `p_overrides = {event:{...}, registration:{slug (required), ...}}`. |
| `gl_checkin_v2(p_event_id, p_token uuid, p_guest_id uuid, p_undo bool)` | same jsonb as `gl_checkin`, plus `ticket_key` | Staff. `separate` door: `checkin_token` only; `shared`: `token`. `{ok:false,error:'unknown_token'}`, `{ok:false,error:'status_<s>',guest_id,name,company}`, `{ok:true,already:true,...}`, `{ok:true,undone:true,guest_id}`, `{ok:true,guest_id,name,company,conference,gala,plus_one,ticket_key}`. Message `forbidden` for non-staff. |
| `review_log_add(p_subject_type, p_subject_id uuid, p_action, p_note default null, p_details jsonb default '{}')` | bigint | Staff. One row per queue decision (also after a guest-list `decide` on wys26; `gl_decide_v2` writes its own). |

### Public (anon + authenticated)
`public_registration_events()` -> `gl_event_id, event_id, slug, engine, kind, registration_mode, access, title, starts_at, ends_at, location, image_url, state` for events not hidden, catalogue row published, not ended; ordered by start. (wys26's catalogue row is unpublished today, so it is not listed.) Members-only events are listed too (`access='members'`): the page is public, registration says members only.
`gl_event_slug_for(events.id)` is unchanged and **engine-blind**: it returns the slug of a core_v2 event too. Do not treat its answer as "this is a guest list": branch on `engine` (from `public_registration_events()` or the `registration` function's `form`).

### Service role only (edge functions)
| RPC | Returns |
|---|---|
| `gl_register_v2(p jsonb)` | see 4.2 |
| `gl_decide_v2(p_gl_event_id, p_guest_ids uuid[], p_decision, p_actor uuid, p_org_action jsonb default '{"mode":"none"}', p_validate_person default true, p_force default false, p_info_request default null, p_note default null)` | see 4.3 |
| `gl_registration_state(p_gl_event_id, p_user_id default null, p_email default null)` | `{state, engine, kind, mode, access, capacity, seats_held, starts_at, ends_at, opens_at, closes_at, my_guest_id, my_status}`; `state`: `open, not_published, not_yet_open, closed, full, waitlist, members_only, invitation_only, registered, not_found` (v1 events: open/closed/registered). Signed-in: pass `p_user_id` (auth e-mail used). **Privacy:** never pass `p_email` for an anonymous caller, and never return `state='registered'`, `my_guest_id` or `my_status` to anyone but the signed-in owner (public answers never reveal who registered). |
| `gl_issue_access_token(p_guest_id)` | raw token text (core_v2 rows only; else `wrong_engine` / `guest_not_found`) |
| `gl_resolve_access_token(p_token, p_touch default true)` | guest id or null (unknown/expired/revoked); touch stamps `last_used_at` and the first `link_opened_at` |
| `gl_seats_held(p_gl_event_id, p_ticket_key default null)` | int |
| `gl_event_window(p_gl_event_id)` | `(starts_at, ends_at)`; ends_at = end, else start + 1 day (full day) / + 2 h |
| `attach_my_records_for(uid)`, `on_email_proven(uid)` | int / jsonb (any future caller of `on_email_proven`, e.g. a Phase 2 accept-invite, must follow the rule of `mark_email_proven`: proof only once a new password is chosen from an e-mailed link) |
| `complete_signup_for(uid)` | jsonb; body since Phase 2: §10.3 |
| `invoke_registration_cron(job)` | pg_cron only |

### 4.1 `admin_save_event(p)` shape
```json
{
  "id": "<gl_event id; omit to create>",
  "event": { "title", "description", "date_time", "end_date_time", "is_full_day", "location", "location_details",
             "language", "speakers", "event_partners", "event_website_url", "image_url", "replay_url (public)", "published" },
  "registration": { "slug", "kind", "registration_mode", "public_requests", "access", "opens_at", "closes_at",
                    "edit_locks_at", "capacity", "waitlist", "plus_ones", "standard_fields", "account_email_timing",
                    "account_email_send_at", "meeting_url", "replay_url (registrants)", "reminders",
                    "staff_alert_mode", "notify_email", "hidden", "settings (merged)" },
  "tickets":   [ { "key", "label", "description", "price_cents", "currency", "price_note", "invite_only", "capacity",
                   "allowed_company_types", "parts", "display_order", "active" } ],
  "questions": [ { "key", "label", "help", "kind", "options", "max_length", "required", "ticket_keys",
                   "profile_field", "editable_after_submit", "display_order" } ]
}
```
- A key that is absent keeps the stored value (save tab by tab). `tickets` / `questions`, when present, are the full list: upsert by key; a ticket left out is deleted, or switched `active=false` if someone registered with it; a question left out is deleted.
- Always sets `engine='core_v2'`, `requests_open=false`, `door_token='separate'` (a `door_token` key is ignored); new events get `events.published=false` unless given; `hidden=true` forces unpublished.
- **Publishing needs the flag**: making a core_v2 event published (new, or unpublished before) raises `publish_needs_flag` unless `registration_flags.webinar_v2` (webinar) / `onsite_v2` (on-site) is true. Saving an event that is already published works with the flag off. The same rule guards direct `events.published` writes (trigger `events_publish_guard`). Reason: while the old main site is live, its event page sends visitors of any event with a gl_event slug to `/{slug}`, a page main does not have.
- An unpublished, not hidden event is a draft: `gl_register_v2` answers `state='not_published'`. A hidden event takes registrations by link (tests).
- Keeps `events` in step: `event_type` (webinar|on_site), `invitation_only` (= invitation mode), `access_level = 'public'` always (`gl_event.access` gates registration only), `max_attendance` (= capacity), `meeting_url = NULL` (the join link is never public).
- Defaults on create: kind webinar; mode instant (webinar) / review (onsite).
- Codes: `forbidden, bad_input, event_not_found, guest_list_event` (v1 events are edited in `/admin/guest-list/:slug`), `title_required, slug_required, slug_invalid` (`^[a-z0-9]+(-[a-z0-9]+)*$`, <= 60), `slug_reserved` (sm26, wys26, admin, register, registration, signup, events, join, welcome), `slug_taken` (gl_event or sm_event), `slug_locked` (published, or any `gl_guest` row exists: e-mailed door passes and reminders carry `/admin/guest-list/<slug>/checkin?token=`; hidden test events and events unpublished again included), `bad_kind, bad_mode, instant_needs_webinar, bad_access, bad_capacity, bad_standard_fields, bad_reminders` (`^P(T?[0-9]+[DHMW])+$`), `publish_needs_flag` (detail names the flag), `bad_tickets, bad_ticket_key, duplicate_ticket_key, bad_questions, bad_question_key, duplicate_question_key`. A bad question `kind`/`profile_field` raises the table CHECK (23514).

### 4.2 `gl_register_v2(p)` (core_v2 only; the event row is locked: capacity is race-free)
Input: `{gl_event_id, user_id?, email, first_name, last_name, company?, job_title?, phone?, country?, ticket_key?, answers?, consents?, source_detail?, organization_id?}`.
- Signed in (`user_id`): the auth e-mail replaces `email`; EMPTY names, job title, phone and country come from the profile, and an empty company from the person's company (the one given in `organization_id` if they belong to it, else their only company). One-click = `{gl_event_id, user_id}`. A suspended account gets `error='account_suspended'`.
- `consents` keeps only `terms_at, image, marketing_at` (string or boolean, strings cut to 100); `source_detail` only `entry, ref, utm_source, utm_medium, utm_campaign, utm_term, utm_content` (strings, cut to 200). Anything else is dropped.
- A reactivated (cancelled/declined) row starts over: decision fields, info request, `reminders_sent` and `link_opened_at` are cleared; `payment_status` and the tokens stay. When a signed-in account that does NOT get the row (not proven for its address, or the row is another account's) brings it back, the row KEEPS its names, company, job title, phone and country (they belong to whoever registered that address); signed out, the typed details replace them as for any public registration.
- `standard_fields`: a `hidden` field is dropped (never stored, never written back); a `required` one must be present after the profile fill.
- Results:
  - `{ok:true, duplicate:false, reactivated, guest_id, status}`: `status` = `confirmed` / `waitlisted` (instant), `requested` (review; invitation + public_requests with `source='request'`). A cancelled/declined row of the same person is re-used (`reactivated:true`, same tokens). The reactivated row joins the signed-in account only when it is already that account's, or when it has no account and the caller is PROVEN (§2) for its address; otherwise `user_id` (and `organization_id`) stay as they were, in the same statement (the `registration` function then gives the public answer).
  - `{ok:true, duplicate:true, guest_id, status}`: already registered (same e-mail or account).
  - `{ok:false, state}`: `not_published, not_yet_open, closed, members_only, invitation_only, full`.
  - `{ok:false, error}`: `bad_input, not_found, wrong_engine, unknown_user, account_suspended, invalid_email, missing_fields (+ fields[]: first_name, last_name, company, job_title, phone, country), ticket_required, unknown_ticket, ticket_invite_only, ticket_not_allowed, invalid_answers (+ keys[])`.
- Unknown answer keys are dropped. Standard fields and `profile_field` answers fill EMPTY profile fields of a signed-in registrant: job title, country, LinkedIn. NEVER the phone (co-members read profiles; a number given to M3 for one event stays on the registration).
- **The public response of the `registration` function must stay identical for new and duplicate registrations** (`{ok:true}`); `duplicate` only decides which e-mail is sent. Never return a token.

### 4.3 `gl_decide_v2(...)` (core_v2 staff decisions, one transaction)
The `registration` function checks the staff session, then calls it with `p_actor` = that staff user (checked again: verified admin or moderator).
- `p_decision`: `approve` (requested / needs_info / waitlisted -> `confirmed`), `reject` (same -> `rejected`), `waitlist` (requested / needs_info -> `waitlisted`), `request_info` (requested / waitlisted -> `needs_info`, `p_info_request` required, stamps `info_request` and `info_requested_at`). Up to 200 ids. Rows in another status or another event are skipped.
- Locks the event row; `approve` checks event capacity and each ticket's capacity (seats held + adding) unless `p_force`. Paid tickets (`approved` + `payment_due`) arrive in December: today approve always confirms.
- Sets `decided_at`, `decided_by`; the DB mints `checkin_token` and queues the on-site provisioning job; the job gets `p_org_action` / `p_validate_person` (and `created_by`) in the SAME transaction, before any cron can see it. One `review_log` row per changed registration (`subject_type='registration'`, `action=p_decision`, note, details).
- Returns `{ok:true, decision, status, changed: [ids], skipped: [ids], jobs}` (e-mail the `changed` rows) or `{ok:false, error}`: `bad_decision, bad_input, forbidden, bad_org_action, info_request_required, not_found, wrong_engine, capacity (+held, capacity, adding), ticket_capacity (+ticket_key, held, capacity, adding)`.

## 5. Lane notes

**EDGE (`registration`, `registration-cron`, `provision-person`)**
- Writes with the service role. Core_v2 inserts: `gl_register_v2` only. wys26 parity `register`: the guest-list rules, legacy columns only (+ `user_id` only when the caller is PROVEN (§2) and the JWT e-mail equals the form e-mail; the guard drops any other `user_id`; + `consents`), `source='request'`, `status='requested'`.
- **Door codes and v1 tokens go to the inbox, not to a session**: never return `checkin_token`, a v1 `gl_guest.token` or a QR to a signed-in session whose e-mail is not PROVEN (§2). Send them by e-mail, or show them on the status-link page (`gl_access_token`, the holder read the inbox). Confirm email is off: an account alone proves nothing about its address.
- Flood guard (spec §4.1 `register`): the function enforces it, not the DB. More than 40 registrations on one event in 10 minutes (`select count(*) from gl_guest where event_id = $1 and created_at > now() - interval '10 minutes'`) -> answer the anonymous caller with the generic error and alert staff; keep signed-in members and invitations flowing (a campaign e-mail can bring a real burst).
- Staff `decide` on core_v2: `gl_decide_v2` only (never two REST writes: the cron could provision between them). `approve` on a non-hidden on-site event answers 409 `onsite_not_live` while flag `onsite_v2` is off (its pass and status links point at `SITE_URL`, the main site, whose door only knows `gl_guest.token`). `cancel`: `status='cancelled'` (DB stamps `cancelled_at`). `needs_info` -> `requested` after the person answers: `update ... set status='requested'`. `attach` (token + JWT): set `user_id` if null, write `review_log` (`same_email`), never touch `email_proven_at`. An attached row of ANOTHER address never gets M3's choices automatically (provision-person, below). `reminders`, like `update` / `cancel`, answers 403 `sign_in_required` on a `read_only` view.
- `provision-person`: skip (`status='skipped'`, `email_due_at=null`) a job whose gl_guest no longer exists or is no longer `confirmed` (contract runs delete their canary rows; their jobs stay; a registration confirmed again re-queues its skipped job by itself); link an existing account only when it is PROVEN for that address (else `account_action='pending_link'`; once the person proves it, `on_email_proven` re-queues the job and attach links the row, so the next run applies M3's choices); a row ALREADY linked gets M3's choices only when the account's auth e-mail IS the row's address and is proven (a status link forwarded and attached to someone else's account stays `pending_link`, `same_address: false` in `review_log`: staff decide by hand); create a missing account CONFIRMED (`email_confirm: true`, `pw_pending`, no password anyone knows), never unconfirmed (a public sign-up would take an unconfirmed account over while Confirm email is off); never copy the phone to the profile; set `gl_guest.user_id / account_action / provisioned_at`; when NO account e-mail will be sent (linked, pending_link, skipped) set `email_due_at = null` in the same update as `status='done'`; never write `email_proven_at` (`mark_email_proven` proves it once the person saves a new password from the account e-mail's link).
- `registration-cron` (verify_jwt = true) receives `POST {"job": "provision" | "reminders" | "digest"}` with the service key from pg_cron: provision every 5 min (only when flag `provisioning` and a job is queued, failed with attempts < 5, or has an account e-mail due in the last 7 days), reminders at :10 hourly (flag `webinar_v2` or `onsite_v2`), digest once a day at 08:00 Europe/Monaco (flag `review_queue`). Reminders: stamp `gl_guest.reminders_sent[duration]`; skip cancelled/declined/rejected. Digest: also count companies pending review (`organizations.access_status='pending'`, including those flagged `organization_pending_review` in `organization_audit_log`).
- After `webinar_v2` is live: `select cron.unschedule('guest-webinar-reminders-hourly');` (not in this migration).
- Status links: `gl_issue_access_token` / `gl_resolve_access_token`; e-mail `${SITE}/registration?t=<raw>`.
- Rate limits: see `guest_signup_rate_limits.scope` (prefix your hashes).

**REG (front)**
- Read `platform_settings.registration_flags` (missing = false). Lists: `public_registration_events()`. My events: `my_participations()`. Join link: `get_my_event_access`. Never read `gl_*` tables directly (staff-only).
- Map `status_display` to words (§2.3 of the spec): `under_review` Received, under review · `needs_info` Information needed · `waitlisted` Waiting list · `invited` Invited, please reply · `payment_due` Approved, payment due · `confirmed` Confirmed · `not_accepted` Not accepted · `declined` You declined · `cancelled` Cancelled · `event_ended` Event ended. `payment_display`: none, due, pending, invoiced, paid, waived, refunded.
- `/{slug}/guest?t=` routes exist only for guest_list_v1 events (wys26). core_v2 events use `/registration?t=`.
- `gl_event_slug_for` is engine-blind (see §4 Public): the event page must branch on `engine`, never send a core_v2 event to `/{slug}` as a guest list.
- A core_v2 event cannot be published until its flag is on (`publish_needs_flag`, §4.1): main's event page would send its visitors to `/{slug}`, a NotFound page on main. Flip `webinar_v2` / `onsite_v2` only once the redesign with the new event pages is live.
- A `status_url` of null on a v1 row means "check your e-mail for your personal link" (the caller's address is not proven yet).

**ADMIN**
- Editor: `admin_save_event` / `admin_clone_event`; read `gl_event`, `gl_ticket`, `gl_question`, `gl_guest`, `account_provision_job`, `review_log` directly (staff RLS). wys26 stays in `AdminGuestList` (guest-list function).
- "Publish" shows `publish_needs_flag` as: "Publishing opens once the new event pages are live." Keep the event as a draft (or hidden for tests) until then. The old events admin list hits the same rule.
- Audience "validated members only" (`access='members'`) restricts who can register; the event page stays visible to everyone.
- `AdminGuestList` and every guest-list staff action (decide, invite, resend, cancel, update) must refuse an event whose `engine <> 'guest_list_v1'`: guest-list would e-mail a pass carrying `gl_guest.token`, which a core_v2 door refuses. Core_v2 decisions go through the `registration` function (`gl_decide_v2`).
- Door: `gl_checkin_v2` for core_v2 (it also works for v1); route `/admin/guest-list/:slug/checkin` unchanged.
- Flags/SLA/digest: update `platform_settings` rows (staff RLS). Never edit `gl_event.engine` or `door_token` by hand (the CHECK refuses a mismatch).

## 6. RLS / grants summary
- `gl_event, gl_guest, gl_ticket, gl_question`: staff (`is_moderator()`) only.
- `gl_access_token`: no client access at all. `account_provision_job`, `review_log`: staff SELECT; no client INSERT/UPDATE/DELETE (even staff: use RPCs / service role).
- `profile_interest_sectors`: own rows + staff. `platform_settings.review_digest_recipients`: staff only.
- `event_registrations`: policies unchanged; the trigger `event_registrations_engine_guard` refuses any row on a core_v2 event (every role). `events`: policies unchanged; `events_publish_guard` gates publication of core_v2 events.
- EXECUTE: internal helpers and `gl_register_v2` / `gl_decide_v2` service role only; signed-in RPCs not for anon; `public_registration_events` for everyone.
- `create_organization`: no longer executable by anon/PUBLIC; no auto-verification (authenticated keeps it until Phase 2); a company created by a verified person is logged `organization_pending_review`.

## 7. Deviations from the spec (decided or forced)
1. `sm_autoclaim_by_email` NOT revoked (the redesigned member dashboard uses it). See §9.
2. wys26 `account_email_timing = 'with_confirmation'` (Victor 7 Oct: account at validation), not `after_event` 28 Nov. Victor's decision was "the set-password block goes INSIDE the QR e-mail"; guest-list is frozen until 28 Nov, so that is impossible: it becomes a separate e-mail from provision-person. **Not yet confirmed by Victor** (see §9: ask before `provisioning` goes on; the hold option is one SQL statement).
3. canary-onsite created with `requests_open = false` (the contract script opens/closes it). canary-v2 has fixed dates (30 June 2027), not "now + 30 days".
4. `review_log` columns `actor_id` / `created_at` instead of `by` / `at`.
5. Added (not in the spec list): `gl_event.hidden`, `profiles.email_changed_at`, `gl_register_v2`, `gl_decide_v2`, `gl_registration_state` (+ `not_published`), `gl_seats_held`, `gl_event_window`, `gl_issue_access_token`, `gl_resolve_access_token`, `public_registration_events`, `review_log_add`, `guest_signup_rate_limits.scope`, the restrictive policy on `review_digest_recipients`, CHECK `gl_event_door_matches_engine`, the provisioning backfill, the `organization_pending_review` audit event.
6. No auth trigger proves an address (integration review, 10 Oct 2026: a confirmation, invite, recovery or e-mail change link proves the inbox, not the password; and with Confirm email off GoTrue hands a session to a public sign-up over an unconfirmed account). `mark_email_proven` is the only proof: a link session less than 60 minutes old, after the last e-mail change, not an admin "view as user", called once a new password is saved.
7. `complete_signup_for` was a placeholder in Phase 1; Phase 2 gives it its body (§10.3).
8. `create_organization` is also revoked from anon; `admin_save_event` ignores `door_token`.
9. `access='members'` gates registration only; `events.access_level` stays `public` (the spec's "members = verified person" differs from the catalogue's `members` = marketplace access).
10. Publishing a core_v2 event needs flag `webinar_v2` / `onsite_v2` (DB-enforced) while the old main site is live.
11. The per-event flood guard (> 40 in 10 min) stays in the `registration` function (§5), not in `gl_register_v2`.
12. "Proven" also requires `profiles.email` = the auth e-mail (no separate `email_proven_for` column: `profiles.email` is the address the proof was stamped for).
13. **Interim choice (integration review, 10 Oct 2026): `trg_link_guest_registrations` is KEPT, and `mark_email_proven` is wired now.** The spec drops the unproven auto-link at sign-up and replaces it with the proof-based attach. But nothing proves an ordinary new account yet (Confirm email off; the AUTH lane is Phase 2), so dropping it would have hidden a guest webinar registration from the person who then creates an account (My events, join link), on main and on the redesign. Until Phase 2: the trigger stays (legacy `event_registrations` only, as today); `/welcome` and `/reset-password` call `mark_email_proven` once a new password is saved from an e-mailed link's session (not when the link opens: see §4 `mark_email_proven`); `on_email_proven` re-queues the person's `pending_link` provisioning jobs. A WYS guest whose account existed before stays `pending_link` (no link, no validation, no `status_url` in My events) until they set a new password from an e-mailed link (Forgot password? or a /welcome link) on a page of the redesign (main's pages do not call `mark_email_proven`, and no auth trigger proves anything: an account provisioned for WYS works on main but stays unproven until the person sets a password on the redesign); then it resolves by itself at the next provisioning run.
14. Registration flags are on only as JSON `true` in SQL too (the reviewed core read the text `"true"` as on in `admin_save_event` / `events_publish_guard` and cast in `invoke_registration_cron`).

## 8. Not in this migration
Phase 2: built in §10 (`handle_new_user` mapping, `complete_signup_for`, e-mail proof, organization_invitations, matching, legacy proof backfill; `create_organization` revoke held for go-live). `org_members_insert` owner branch: done by 20261011083257. Still open: revoking `sm_autoclaim_by_email`, dropping `trg_link_guest_registrations` (§10.9).
Phase 3: review queue RPCs, rights (`org_type_capability`, `has_capability`...), `archived_at` / `duplicate_of`, staff choices for WYS provisioning jobs.
December: `payment_id`, `gl_invoice`, `event-checkout`, `approved` + payment in `gl_decide_v2`.

## 9. Runbook (coordinator)
1. `scripts/contract/sm26-snapshot.sql` (read-only), keep the output.
2. Dry run `supabase/dryrun/20261009200000_registration_prereqs.dryrun.sql`, then apply `20261009200000_registration_prereqs`.
3. Dry run `supabase/dryrun/20261009210000_registration_core.dryrun.sql`, then apply `20261009210000_registration_core` at a quiet moment.
4. Snapshot again: SM26 lines and the wys26 token fingerprint identical; "confirmed on-site rows without a provisioning job" = 0.
5. Dry run `supabase/dryrun/20261010120000_registration_catalogue_guard.dryrun.sql` ("13 PASS, 0 FAIL"), then apply `20261010120000_registration_catalogue_guard` (integration wave: the old event editor can no longer put a join link in the public catalogue row of a core_v2 event, or orphan it).
- Both migrations and both dry runs set `lock_timeout = 5s`, `statement_timeout = 120s`. "canceling statement due to lock timeout": nothing was applied, run it again a little later.
- **Before switching `provisioning` on** (only after `registration-cron` and `provision-person` are deployed), list who will get an account and a set-password e-mail, and get Victor's OK:
  `select j.email, g.status, j.created_at from account_provision_job j join gl_guest g on g.id = j.source_id where j.payload->>'event_slug' = 'wys26' and j.status = 'queued' order by j.created_at;`
  Every wys26 guest confirmed since the apply is in it; the first run sends to all of them at once, possibly weeks after their QR e-mail.
  Victor chooses (his 7 Oct wish, "inside the QR e-mail", is impossible while guest-list is frozen): (a) a separate "your account is ready" e-mail at confirmation (current setting), or (b) hold the account e-mail until after the gala:
  `update gl_event set account_email_timing = 'after_event', account_email_send_at = '2026-11-28 09:00+01' where slug = 'wys26';`
  `update account_provision_job set email_due_at = '2026-11-28 09:00+01' where payload->>'event_slug' = 'wys26' and status = 'queued';`
  (the second statement moves the jobs already queued; record the answer in §7 item 2).
- Dry-run totals: prereqs "25 PASS, 0 FAIL" (13 + 12); core "195 PASS, 0 FAIL" (23 structural + 172 cases; integration review: trigger kept, reactivation linked only when proven, flags as JSON true, proof re-queues `pending_link` jobs; integration fix: no proof trigger on confirmation, e-mail change clears the proof, re-queue by address, 60-minute link window, canary-v2 closed, slug locked by registrations, no phone write-back, reactivation keeps the row's identity); catalogue guard "13 PASS, 0 FAIL".
- **Flags are written as JSON booleans**: `update platform_settings set value = value || '{"webinar_v2": true}'::jsonb where key = 'registration_flags';` (never `"true"` in quotes: it counts as off everywhere).
- **No on-site core_v2 confirmations on a non-hidden event until the redesign is live on main** (not even a staff test with real people): the pass and status links of a non-hidden event go to `SITE_URL` (main), whose door page calls `gl_checkin` with `gl_guest.token` only and refuses every core_v2 `checkin_token`, and main's `/admin/guest-list/<slug>` would run guest-list actions on that slug. Test on-site flows on hidden events (their links go to `REGISTRATION_SITE_URL`). The `registration` function refuses `approve` there (409 `onsite_not_live`) while `onsite_v2` is off; the database only blocks publishing.
- **`pending_link` provisioning jobs** (an existing account that has not proved the address: nothing linked, nobody validated) resolve by themselves once the person sets a new password from an e-mailed link on the redesign (`/reset-password`, `/welcome`; opening the link alone proves nothing): tell them to use "Forgot password?" with that address and choose a new password. Find them: `select j.email, j.done_at from account_provision_job j join gl_guest g on g.id = j.source_id where g.account_action = 'pending_link' and j.status = 'done';` A row linked to an account of ANOTHER address (a forwarded status link, `review_log.details->>'same_address' = 'false'`) never resolves by itself: check with the person, then validate them by hand if right.
- **Proof saved too late** (new password saved more than an hour after the link was opened: not proven): `select l.subject_id, u.email, l.created_at from review_log l join auth.users u on u.id = l.subject_id where l.action = 'email_proof_late' order by l.created_at desc;` Ask the person to use "Forgot password?" again and choose a password straight away.
- **canary-v2 is closed between test runs** (its slug is public and a hidden event skips the flags). Open it for one hour, run the test, close it again:
  `update gl_event set closes_at = now() + interval '1 hour' where slug = 'canary-v2';` ... `update gl_event set closes_at = '2026-10-01 00:00+00' where slug = 'canary-v2';`
  Any hidden test event made in the editor: keep it closed too (a past closing date) when no test is running.
- **A new guest-list event (wys27...)** needs its two public routes in `App.tsx` (`/<slug>`, `/<slug>/guest`) AND an entry in `GUEST_LIST_PAGES` (`src/lib/registration.ts`), or its event page shows the plain "invitation only" card.
- **Help button**: the floating Help button (refonte, `helpPlaces.ts`) is not shown on `/register/<slug>` or `/registration` on purpose: the help centre still describes the old webinar sign-up. Add those pages to `helpPlaceFor` when the help answers are rewritten for the new registration (before `webinar_v2` goes on); on phones it must then keep clear of the bottom buttons (`data-help-avoid`). On `/events/<id>` it shows, and the sign-up window (a modal) covers it.
- A company created by a verified member from the old wizard now waits for M3 (Admin > Review lists it, `admin_review_queue`), while that wizard still tells its creator "set up and live".
- `sm_autoclaim_by_email` (kept on purpose) still links an imported SM26 registration to the account that has its e-mail, PROVEN OR NOT, and writes `sm_registration` / `sm_role_assignment`. If an SM26 fingerprint changes and nothing else did, look there first. Phase 2: have the dashboard read SM26 through `my_participations()` and revoke it.

## 10. Phase 2: sign-up identity (DB lane)

Source of truth, in apply order:
1. `supabase/migrations/20261012112000_org_invitations_expiry.sql` (invitations expire on the live site too);
2. `supabase/migrations/20261012113000_signup_identity_orgs.sql` (part 1, companies and teams);
3. `supabase/migrations/20261012113500_signup_identity.sql` (part 2, people);
4. `supabase/migrations/20261012114000_signup_identity_backfill.sql` (legacy proof backfill, independent, **held until Victor chooses**, §10.7).

Go-live only: `supabase/migrations/held/signup_identity_golive.sql`. Spec §3.8, §3.9, §4.4-4.6, §5; Victor's decisions of 6, 8 and 11 Oct.

### 10.1 What changes for the live site and for the redesign with every flag off
- **Decline on a join request works.** `organization_invitations.status` now allows `rejected`. `reject_join_request` always wrote it and the CHECK refused it (23514). Main's InboxTab and types, the redesign's `orgActions` / `InvitationStatus`, and both versions of send-notification (`join_request_rejected` looks for `status = 'rejected'`) already handle `rejected`, so the CHECK was widened and the function left as it is.
- **A claim code never makes anyone a member of a company that already has an owner** (an owner member row or `owner_user_id`). `claim_organization` and `claim_organization_for_user` raise "This company already has an owner on Smart Marina Connect. Ask them to invite you to the team." A company with no owner is unchanged on the old client until the held file (from then on M3 decides every claim). An owner's own retry of `claim_organization_for_user` is unchanged. claim-code-signup and the admin "Send Connect Link" still hand out codes of owned companies (EDGE / admin lanes: refuse them there).
- **Invitations expire.** A pending invitation past `expires_at` becomes `expired` (a status of the old CHECK) when the expiry file is applied and every 5 minutes after (pg_cron `org-invitations-expire`, `*/5 * * * *`; hourly left main's onboarding offering an Accept button that fails for up to an hour), and `check_pending_invitation` leaves it out: both onboarding pages (main and the redesign) offer a pending invitation with a single Accept button, read by a stored invitation id with status `pending` or through `check_pending_invitation`, so an expired one would be a dead end. `/join/<id>` shows "no longer valid" for it. Then (part 1) `accept_org_invitation` refuses a row past `expires_at` ("This invitation has expired. Ask the person who invited you to send a new one."). The only pending invitation in production (18 May 2026) is past its date: it becomes `expired`. Owners cannot write an invitation that expires later than `now() + 30 days` (insert policy; both clients use the default).
- **A suspended account stays suspended** when it accepts an invitation (`accept_org_invitation`) or when an owner approves its join request (`approve_join_request`).
- New profiles get `signup_source = 'account'` when made by a sign-up form (main's, the v2 form, claim-code-signup) or create-admin-user; an account made by one of M3's tools (metadata `pw_pending` or `provision_job_id`: sm26-register, sm26-provision, sponsor-invite, sm26-attendee-invite, provision-person) keeps NULL, as today (provision-person then writes `provisioned`). Everything else in a new profile is what it was, for the old metadata keys.
- **Nothing runs and nothing is queued while `account_signup_v2` is off** (checked in the database: `complete_signup_for` answers `flag_off`, `submit_signup_intent` raises `flag_off`), whatever a direct API call stores in sign-up metadata.
- The legacy proof backfill is a separate file (§10.7). A stamp IS read by the live site: `get_my_event_access` (main's dashboard and event page) counts a confirmed `gl_guest` row of the proven address, and `gl_guest_engine_guard` keeps `user_id` on a new WYS row only for a proven account.

### 10.2 Sign-up metadata (AUTH lane: `supabase.auth.signUp({ options: { data } })`)
| key | stored in | rule |
|---|---|---|
| `first_name`, `last_name`, `job_title`, `persona` | as today | names <= 100, job title <= 200; persona whitelist `marina, partner, media_partner, developer, investor, individual` (else `individual`) |
| `country` | `profiles.country` | text <= 80 |
| `affiliation` | `profiles.affiliation` | the participant's free-text organisation, <= 200 |
| `sector_ids` | `profile_interest_sectors` | array of active `sectors.id`; 5 at most are kept, unknown ids ignored |
| `signup_intent` | `profiles.signup_intent` (cleaned) | object `{action: join\|new\|none, org_id, name, website, country, type, code}`. Its presence means "sign-up form v2". |
| `declared_type` | `signup_intent.type`, when the intent has no `type` | `marina, partner, investor, developer, media_partner, participant` |
| `pw_pending`, `provision_job_id` | (not stored by this trigger) | their presence means "made by an M3 tool": `signup_source` stays NULL |

The cleaned intent is `{v: 1, action, org_id (join only, valid uuid), name <= 200, website <= 300, country <= 80, type, has_code}`. An unknown `action` becomes `join` (valid org_id), `new` (a name) or `none`. **The claim code is never stored in profiles** (co-members read profiles). It goes to the private `signup_claim_code` table (3-40 characters, trimmed) and is checked once by `complete_signup_for`. Metadata never sets `access_status`, a staff persona, `email_proven_at` or `signup_source`. A malformed v2 key is skipped with a WARNING: a sign-up never fails because of it.

### 10.3 Running the intent: `complete_signup_for(uid)` (service role; called by `on_email_proven`)
It runs once (`signup_intent.done_at` + `result`), only while `registration_flags.account_signup_v2` is JSON `true`, and only for a PROVEN account (§2 "Proven"). Otherwise it answers `{done:false, reason: no_profile | no_intent | flag_off | not_proven | account_suspended | account_rejected}`; with `flag_off` the intent and the claim code are kept: once the flag is on, `complete_my_signup()` (the dashboard, once per session) runs them for a person already proven. Answers: `{done:true, result}` or `{done:true, already:true, result}`.

`result.path`:
| path | when | effect |
|---|---|---|
| `join_requested` | company verified, with an owner | `organization_invitations` row `join_requested` (the person's auth e-mail, `invited_by_user_id` null, so the owner can approve it with `approve_join_request`, which verifies the person unless suspended); outbox `team_join_request` to the owner |
| `claim_requested` | company verified with no owner, or a matching claim code of a company with no owner (any status) | row `claim_requested` (`code_matched` true with a code). **M3 decides** (Phase 3 `admin_decide_claim`); nobody becomes a member yet |
| `company_pending` | company not verified | nothing; M3 decides from the person's card |
| `new_company` | `action = new` | nothing: no company row before M3 validates (§5) |
| `none` | no company | nothing |
| `invitation_pending` / `already_member` / `org_not_found` / `join_declined_recently` | an invitation not past its expiry already waits / already a member / unknown company / that owner declined this person less than 30 days ago | nothing new |

`result.code`, when a code was typed: `matched`; `invalid` (one failure recorded in `org_claim_attempt`); `throttled` (10 or more failures in the hour, the same count as `claim_organization`); `refused_has_owner` (Victor, 11 Oct: the code claims nothing; the person's request goes to the owner as `join_requested` when the company is verified); `mismatch` (integration review, 15 Oct: the code is another company's than the one picked in the list: the PICK stands, the code claims nothing and counts as one failure). A matching code decides the company only when no company was picked, or when it is the one picked (with `action = new`, the page then does not name the company the person typed).
The `team_join_request` e-mail is queued to `organizations.owner_user_id` only when that account is also an owner member (send-notification's `realOwnerOf`); otherwise the request is filed and the owner members see it in the inbox, with no e-mail.
For a `pending` person, always: `onboarding_status` goes from `draft` to `submitted` (so the person shows in `admin_review_queue`), and ONE outbox `account_under_review` is queued (one per person, ever). A verified person gets no such e-mail. **Until the address is proven nothing runs**: a v2 sign-up stays `draft` (not in M3's list, no e-mail). With Confirm email off (production today) the AUTH lane must send the proof link right after sign-up (account-signup `send_email_proof` -> `/verify-email` -> `confirm_email_proof`); the person may open it on another device after signing in there with the password. A verified person's `new_company` / `company_pending`, and every `claim_requested` row, reach no M3 screen until Phase 3 (§10.8).

### 10.4 RPCs
| RPC | caller | returns / errors |
|---|---|---|
| `complete_my_signup()` | authenticated | `complete_signup_for(auth.uid())` (idempotent). The redesign calls it once per tab session (AuthContext, `completeMySignupOnce`) only for a proven account whose profile carries an intent without `done_at`, with `account_signup_v2` on; then sends the e-mails as after a proof. |
| `submit_signup_intent(p_intent jsonb)` | authenticated, in no company | Same shape as the metadata intent, code included. Stores it (`submitted_at`) and runs it now when the address is proven, otherwise once it is. 22023: `flag_off` (`account_signup_v2` off: nothing stored), `no_profile, account_suspended, already_in_company, request_pending` (an open join or claim request for that e-mail, not past its `expires_at`: 30 days), `too_soon` (one a minute), `bad_input`. For "Add my company" and a claim link opened while signed in. |
| `issue_email_proof_token(p_user_id)` | service role (account-signup `send_email_proof`, which calls it since the integration of 15 Oct 2026, after its own per-account and per-network limits) | `{ok, token (43 characters, base64url), email, expires_at (24 h)}` or `{ok:false, error: unknown_user \| already_proven \| rate_limited}` (3 an hour). Only the sha256 is stored. Link: `/verify-email?t=<token>`. |
| `confirm_email_proof(p_token)` | authenticated (`/verify-email`) | `{proven, stamped, attached?, requeued?, signup?, reason?}`. Reasons: `invalid_token`, `wrong_account` (the link belongs to another account: sign in with that one), `email_changed`, `used`, `expired`, `impersonation`, `password_session_required`. **Stamps only in a session opened with the account's password** (JWT `amr` has `password`; a GoTrue sign-up session with Confirm email off has it too): a magic-link, one-time-code or recovery session proves the inbox, not the password (Phase 1 rule, §4 `mark_email_proven`). On `password_session_required` the page offers "Sign in with your password" or "Choose a new password" (`/reset-password`, which proves through `mark_email_proven`); the link stays usable. Stamps through `on_email_proven` (attach, re-queue, complete_signup_for). Never a login. |
| `notification_outbox_claim(p_limit default 20, p_actor uuid default null, p_kinds text[] default null)` | service role | The claimed rows (unsent, fewer than 5 attempts, unclaimed or claimed more than 10 minutes ago); `attempts` + 1. |
| `notification_outbox_done(p_id, p_error default null)` | service role | true = marked sent (or, with an error, failed: the claim is released and `last_error` kept); false = unknown or already sent |
| `company_search(p_q, p_limit default 8)` | service role (account-signup `company_search`) | `id, name, logo_url, city, country, organization_type, verified` for verified and pending companies, 8 at most, by `normalize_org_name` (trigram or substring, exact first). Nothing under 3 characters. No owner, member or claim-code information. |
| `normalize_org_name(text)`, `immutable_unaccent(text)` | anyone | IMMUTABLE helpers: lower case, accents off, dots dropped, other punctuation -> space, legal-form SUFFIXES dropped (`sas, sarl, sa, sam, ltd, llc, inc, gmbh, srl, spa, bv, doo`; never a leading word: "Spa Resorts SpA" -> `spa resorts`), spaces collapsed. Index `organizations_name_norm_trgm_idx` (`extensions.gin_trgm_ops`). With `search_path ''`, write `operator(extensions.%)` and `extensions.similarity`. |

### 10.5 Outbox (`notification_outbox`, staff read)
Columns: `kind`, `user_id` (recipient), `actor_id` (whose action queued it), `subject_id`, `dedupe_key` (unique: queued once, ever), `data`, `claimed_at`, `attempts`, `sent_at`, `last_error`.
- `account_under_review`: the recipient is the person; `data {path, org_name?, first_name?}`. The path (§10.3) lets the template word the join, claim and new-company cases differently. The promised delay is `platform_settings.review_sla_text`.
- `team_join_request`: the recipient is the company's owner; `data {organization_id, org_name, invitation_id, requester_name?, requester_email}`. Same content as send-notification's `join_request_received`.
- Sending (EDGE lane): the person's page calls send-notification right after `confirm_email_proof`, `mark_email_proven`, `submit_signup_intent` or `complete_my_signup`, with `{type: 'account_under_review', user_id}` and `{type: 'team_join_request', data: {invitation_id}}`. **As integrated (15 Oct 2026):** send-notification reads the row whose `dedupe_key` is its own reference (`account_under_review:<user id>`, `team_join_request:<invitation id>`): a row already sent is skipped (`{success, skipped, reason: 'duplicate'}`), a member caller is refused without an unsent row (or when the queue cannot be read), and after the e-mail leaves (or the recipient opted out of its category) the row is marked with `notification_outbox_done(p_id)`. Service and staff callers send without a row, as before. `notification_outbox_claim` and the registration-cron drain of the rows nobody asked for (`p_actor` null) are **not built yet**: Phase 3, before `account_signup_v2` goes on (§10.8). The drain must mark done WITHOUT sending a `team_join_request` whose invitation is no longer `join_requested` (send-notification already refuses it) and an `account_under_review` whose person is no longer `pending` (send-notification refuses it for every caller since 15 Oct), so a row held back for days never announces a decision already taken.
- **send-notification is deployed at go-live, not with Phase 2** (integration review, 15 Oct 2026). The rf-p2 version is also the redesign's go-live version (new layout for every notification, `${SITE_URL}/unsubscribe?t=` links the old site cannot open, a `List-Unsubscribe-Post` header aimed at the `unsubscribe` function, which is not deployed): it goes out with `unsubscribe` (chantiers item 7). Until then production keeps main's send-notification, which answers 400 "Unknown notification type" to `account_under_review` and `team_join_request`: the redesign's calls are fire-and-forget, and the queued rows stay unsent for the Phase 3 drain. If those e-mails are needed earlier, add only these types to main's source as a separate build.

### 10.6 Team invitations
- Statuses: `pending, accepted, expired, cancelled, join_requested, rejected, claim_requested`. `code_matched` is never set on a `pending` or `join_requested` row. A `pending` row past `expires_at` is set to `expired` within 5 minutes (pg_cron `org-invitations-expire`); `join_requested` / `claim_requested` rows are not: past their `expires_at` they stay visible to the owner / M3 but no longer block the person from filing another request (`submit_signup_intent`).
- Clients insert only `pending` rows signed by themselves and expiring within 30 days (policy `owners_can_create_invitations`, note `signup_identity <fingerprint>`), and update only `status`, to `pending` or `cancelled` (20261011083257). `join_requested` rows come from `complete_signup_for` (proven address) and, until the held file, from `request_org_join` (confirmed address). `claim_requested` rows come from `complete_signup_for` only.
- Links, **as integrated (15 Oct 2026)**: new e-mails carry `/join/<token>` where the token is the signed "SMC invite token v1" of the EDGE lane (`base64url(invitation id + issue time) "." base64url(HMAC)`, key derived from the service-role key, bound to the invitation's id, company and address; minted by send-notification only while `registration_flags.invite_links_v2` AND `account_signup_v2` are on, checked by accept-invite; the page tells it from an id by its format). The database's first random-token design (`org_invitation_token` and its five RPCs) was **removed from part 1 before its first apply** (integration review, 15 Oct 2026): no table, no RPC, nothing granted to `authenticated` for it. `/join/<uuid>` (the invitation id) keeps resolving through `get_invitation_for_join` + `accept_org_invitation` (main, and the redesign while `account_signup_v2` is off). **An invitation id is not a secret** (company members read invitations): accept-invite never creates an account or stamps proof from an id link, only from a signed token (`createUser({email_confirm: true, password})`, then the invitation, the membership, the profile, `on_email_proven` and a `review_log` row `join` / `invitation_accepted`); an id link only e-mails a fresh signed link to the invited address. An account that already has the address signs in **with its password** and joins from the signed link: accept-invite `accept_existing` (`{token}` + the session's access token). The session's account must have the invited address; an address not proven yet is proven there only when the session was opened with the password (JWT `amr` `password`; else `password_session_required` and the page asks for a password sign-in): the link proves the inbox, the password the account (`on_email_proven`), then accept_org_invitation's effects server side and a `review_log` row (`account: existing`). A proven account needs no password session. `/join/<id>` links keep `accept_org_invitation(p_invitation_id)`, which at go-live also requires a proven address (§10.8).

### 10.7 Legacy proof backfill (§5): `20261012114000_signup_identity_backfill.sql`, held for Victor's choice
`auth.audit_log_entries` is empty in this project (0 rows: GoTrue's audit trail goes to the log service), so the spec's source cannot prove anything. The backfill reads `auth.mfa_amr_claims` (the amr of live sessions) instead. It stamps an account when a session was opened by one of the chosen methods:
- after the account was created and after the last e-mail change, and never for an account that ever asked for an e-mail change (`auth.users.email_change_sent_at`, which also covers changes made before `profiles.email_changed_at` existed);
- to an address that is both the auth e-mail and `profiles.email`;
- not within -5/+1 minutes of an `admin_impersonation_log` row, and not before that log existed (11 Jul 2026).

**Victor's choice** (the `v_methods` line of the file; rebuild its dry run after a change). Counts read on 15 Oct 2026; ended sessions drop out of `mfa_amr_claims`, so they only go down while this waits:
- `recovery` only (the file as committed): **4 accounts**. A "Forgot password?" link of this address was opened: the flow in which a new password is saved, the nearest to the Phase 1 rule.
- every e-mail link (`otp, magiclink, recovery, invite, email/signup, email_change`), the spec's wording: **47 accounts**, 43 of them on magic-link or one-time-code sign-ins only. A link proves the inbox, not that the password is the person's: with Confirm email off since May, anyone could have created an account with another person's address and kept its password, and the stamp would then show that person's registrations (WYS status link and door QR in `my_participations`) to the password holder. This is exactly what the integration review of 10 Oct refused for `mark_email_proven`.
- not applying it: everyone proves the address with the dashboard banner (`/verify-email`, signed in with the password) or by choosing a new password.

`email_proven_at` = that session's time; `updated_at` is untouched. Each stamp gets one `review_log` row (`action 'email_proof_backfill'`, `details {stamped_at, method, migration: '20261012114000'}`), which the down script uses. As `on_email_proven`, the person's provisioning jobs left `pending_link` go back to `queued` (0 on 15 Oct). `attach_my_records_for` and `complete_signup_for` are not run. A stamp is read at once by the live site (§10.1). The down unstamps exactly the rows still carrying the stamp; records attached and jobs re-queued in between are kept.

### 10.8 Held for go-live (`held/signup_identity_golive.sql`) and the flag
It refuses to run unless `registration_flags.account_signup_v2` and `front_door` are JSON `true`, a `public.admin_validate_person` exists (Phase 3: M3's way to create companies) and part 2 is applied. It then:
- revokes EXECUTE on `create_organization` from authenticated (spec §3.9);
- revokes EXECUTE on `claim_organization` from authenticated, anon and PUBLIC (M3 decides every claim);
- makes `request_org_join` file a request only for a PROVEN address, and count an open claim as an open request;
- makes `accept_org_invitation` work only for a PROVEN address (integration review, 15 Oct 2026). With Confirm email off since May, `email_confirmed_at` proves nothing, and `current_user_email()` (policy `invitees_can_view_own_invitation`) shows an invitation's id to anyone who signed up with the invitee's address: without this, that person could join the company (verified with it) while the real invitee is locked out. An unproven invitee proves the address with the dashboard banner, or joins from a signed link (accept-invite `accept_existing`, password session);
- makes `approve_join_request` let in only a requester who PROVED the address ("This person has not confirmed their email address yet...").

`current_user_email()` itself is not changed (it serves other policies): an unproven account can still SEE an invitation for its address, not accept it. The first three break main's OnboardingPage and OrganizationTab, and the redesign's while `account_signup_v2` is off; the last two also refuse main's legacy flows for unproven accounts. It ships with a down script and a dry run.

**Do not switch `account_signup_v2` on before Phase 3** ships `admin_decide_claim` and an `admin_review_queue` that reads `claim_requested` rows and `signup_intent` (production's queue reads neither on 15 Oct): until then a claim, and a verified person's new or pending company, reach no M3 screen.

### 10.9 Runbook (coordinator)
Every dry run is ONE file in ONE `execute_sql` call, under 60 KB, ending with `RAISE EXCEPTION 'DRYRUN ...'`. Run them off-peak: the part 1 dry runs hold an ACCESS EXCLUSIVE lock on `organization_invitations`, and the backfill ones a lock on `profiles` (DISABLE TRIGGER), until their final rollback (seconds; live reads of invitations and writes to profiles wait meanwhile).
1. Expiry (after the registration core): `supabase/dryrun/20261012112000_org_invitations_expiry.dryrun.sql` (8 PASS, 0 FAIL), `.down.dryrun.sql` (4 PASS). Apply `20261012112000_org_invitations_expiry` (NOTICE: 1 invitation set to expired; job every 5 minutes).
2. Part 1 (after the expiry file, BEFORE part 2 exists): `20261012113000_signup_identity_orgs.dryrun.sql` (19 PASS), `.dryrun2.sql` (12 PASS), `.down.dryrun.sql` (7 PASS). There is no `.dryrun3.sql` any more (it tested the removed token objects). Apply part 1.
3. Part 2: `20261012113500_signup_identity.dryrun.sql` (14 PASS), `.dryrun2.sql` (23 PASS), `.dryrun3.sql` (24 PASS: C17-C19 are the code/pick and owner rules of 15 Oct), `.down.dryrun.sql` (4 PASS). Apply part 2.
4. Backfill, once Victor has chosen (§10.7): `20261012114000_signup_identity_backfill.dryrun.sql` (6 PASS; B01 prints the count and the methods), `.down.dryrun.sql` (5 PASS). Apply it. It does not depend on parts 1 and 2.
5. After applying, compare `md5(replace(prosrc, chr(13), ''))` of the functions named in the preconditions with their "mine" value, and count `select count(*) from review_log where action = 'email_proof_backfill'`.
6. Go-live: switch the flags, run `supabase/dryrun/signup_identity_golive.dryrun.sql` (13 PASS: 10 cases + 3 down checks), then apply the held file. Undo order: the held down, the backfill down (any time), the part 2 down, the part 1 down (refuses while part 2 is applied), the expiry down (refuses while part 1 is applied).
7. Still open: dropping `trg_link_guest_registrations` (§7 item 13) and revoking `sm_autoclaim_by_email` depend on the AUTH lane's go-live state; they are not in these files.
8. Edge functions for Phase 2 (one at a time from rf-p2, sha256 checked after each; no literal backslash-u): `account-signup` (new, verify_jwt false), `accept-invite` (new, verify_jwt false), `notify-admins` (verify_jwt false, before `front_door` goes on), `registration` (verify_jwt false; then `wys-parity.mjs` on the canary only). **Not** send-notification: go-live, with `unsubscribe` (§10.5).
9. Secrets for a preview test: `ACCOUNT_SITE_URL` (account-signup, accept-invite) and `REGISTRATION_SITE_URL` (registration) = `https://refonte--m3connectv2.netlify.app`. **Unset both right after the test** (`supabase secrets unset ACCOUNT_SITE_URL REGISTRATION_SITE_URL`): left in place, verify-email links, signed invitation links, "account already exists" sign-in links and WYS status links would point at the preview after go-live.

### 10.10 Integration of the four lanes (rf-p2, 15 Oct 2026)
- **Invitation links:** the EDGE lane's signed token, not part 1's first design (§10.6). Reasons: the page, accept-invite and send-notification were built, reviewed and tested on it; the database design would have re-opened two review findings (any inviter's reminder giving an invitation 30 more days through `org_invitation_issue_token`, and the half-done-join resume); and a token bound to the row's address and company needs no table. The cross-review then had the unused objects removed from part 1 before its first apply.
- **Proof links:** account-signup mints through `issue_email_proof_token` (one generator, the one `confirm_email_proof` reads), no direct insert.
- **E-mails the database queues:** send-notification settles `notification_outbox` rows (§10.5); nothing is sent twice when a drain is added. The drain itself is Phase 3.
- **complete_my_signup:** called by the redesign (§10.4), so an intent kept by `flag_off` runs once the flag is on.
- **Sign-up metadata:** the v2 form's keys (`first_name, last_name, job_title, persona, country, affiliation, sector_ids, declared_type, signup_intent{action, org_id, name, website, country, type, code}`, `lang`) are exactly the ones `handle_new_user` reads or ignores (§10.2). Since the cross-review: no `company_name` / `company_website` (main's onboarding would prefill its wizard and create the company itself), and the claim code leaves the account's own metadata as soon as a session exists (`stripClaimCodeFromMetadata`, called by AuthContext once per session for an account whose metadata holds one: right after the sign-up with Confirm email off, at the first sign-in otherwise). The database copy is `signup_claim_code`, emptied by `complete_signup_for`.
- **Cross-review fixes (15 Oct 2026):** expiry job every 5 minutes; part 1 without the token objects; `complete_signup_for`'s `mismatch` and owner rules (§10.3); the held file's proof for `accept_org_invitation` and `approve_join_request` (§10.8) with accept-invite `accept_existing` (§10.6); send-notification held to go-live and `account_under_review` only for a pending person (§10.5); "Add my company" ignores a request past its `expires_at`; GA never sees a personal link (index.html: the tag starts on the first address without a secret).

### 10.11 Preview test plan (coordinator; integration review, 15 Oct 2026)
The preview (`https://refonte--m3connectv2.netlify.app`) uses the PRODUCTION database: every sign-up made there is real.
1. After the migrations (§10.9 steps 1-3) and the four deploys (step 8), set the two secrets (step 9), then switch on briefly: `front_door`, `password_only_login`, `account_signup_v2`. Optionally `wys_form_v2` and `wys_status_edit` (the parity form writes real wys26 rows: test address only, or the canary pages). Keep `invite_links_v2` off.
2. Testers use their own throwaway addresses and, in the sign-up's company step, ONLY "No company", "It's another company: create ..." or a dedicated test company owned by a test account. **Never pick a listed real company and never type a claim code**: picking a verified company with an owner files a production `join_requested` row the real owner sees in the old site's inbox and team list (and queues a `team_join_request` e-mail to that owner, sent by the Phase 3 drain if the row is left); picking one of the 164 verified ownerless companies files a `claim_requested` row on a real company.
3. **Every test sign-up e-mails real M3 staff** (notify-admins, "new sign-up"): warn them before the test.
4. Turn every flag back off, unset the secrets (step 9).
5. Cleanup, run by the coordinator **with Victor's OK** (fill in the test addresses; read first, then delete; outbox rows BEFORE the accounts, because deleting an account only nulls `actor_id` on the e-mails it queued for somebody else):
```sql
-- read
with t(email) as (values ('tester1@example.com'), ('tester2@example.com'))
select 'invitation' as kind, i.id::text, i.status, i.organization_id::text from public.organization_invitations i join t on lower(btrim(i.email)) = lower(t.email)
union all
select 'outbox', n.id::text, n.kind, coalesce(n.sent_at::text, 'unsent') from public.notification_outbox n
 where n.user_id in (select u.id from auth.users u join t on lower(u.email) = lower(t.email))
    or n.actor_id in (select u.id from auth.users u join t on lower(u.email) = lower(t.email))
union all
select 'member', m.user_id::text, m.role, m.organization_id::text from public.organization_members m
 where m.user_id in (select u.id from auth.users u join t on lower(u.email) = lower(t.email))
union all
select 'account', u.id::text, u.email, u.created_at::text from auth.users u join t on lower(u.email) = lower(t.email);
-- delete (same list of addresses)
with t(email) as (values ('tester1@example.com'), ('tester2@example.com')),
     ids as (select u.id from auth.users u join t on lower(u.email) = lower(t.email))
delete from public.notification_outbox n where n.user_id in (select id from ids) or n.actor_id in (select id from ids);
with t(email) as (values ('tester1@example.com'), ('tester2@example.com'))
delete from public.organization_invitations i using t
 where lower(btrim(i.email)) = lower(t.email) and i.invited_by_user_id is null;
```
Then delete the test accounts in the Supabase dashboard (Authentication > Users): their profile, memberships, proof tokens and claim codes go with them; check with the read query that nothing is left. A WYS test row (`gl_guest`) is cancelled from the M3 admin, never deleted by hand.
