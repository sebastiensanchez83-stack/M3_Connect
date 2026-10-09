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
| Sources (`gl_guest.source`) | request, invitation, plus_one (enforced) | + registration (`request` only in invitation mode; a new `plus_one` only when `plus_ones = 1`) |
| Personal link | `/{slug}/guest?t={gl_guest.token}` | `/registration?t={raw token}`, only sha256 stored (`gl_access_token`) |
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
| `access` | `public` \| `members` (verified person) | public |
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
Data now: wys26 = guest_list_v1 / onsite / invitation / shared / with_confirmation. canary-onsite = guest_list_v1, hidden, `requests_open = false`. canary-v2 = core_v2 / webinar / instant / separate, hidden, capacity 20, fixed dates 30 June 2027 10:00-11:00 UTC. To move them (staff SQL): `update gl_event set settings = settings || '{"starts_at":"2027-...Z","ends_at":"2027-...Z"}' where slug = 'canary-v2';`

### `gl_ticket` (participation types; staff-only RLS) - unique `(event_id, key)`
`id, event_id, key (^[a-z0-9_]{1,40}$), label, description, price_cents (>=0, display only until December), currency 'EUR', price_note, invite_only bool, capacity int, allowed_company_types text[] (organization_type values), parts text[], display_order, active, created_at`.
No active ticket = implicit single "attendee" ticket (`ticket_key` stays null).

### `gl_question` (the event's own questions; staff-only RLS) - unique `(event_id, key)`
`id, event_id, key (^[a-z0-9_]{1,40}$), label, help, kind, options jsonb, max_length (1..10000), required, ticket_keys text[] (null/empty = every ticket), profile_field, editable_after_submit (default true), display_order, created_at`.
`kind`: `text, textarea, select, multiselect, checkbox, url, phone, country, sectors, parts, consent`.
`options`: array of `{"value": "...", "label": "..."}` (plain strings also accepted).
`profile_field`: `job_title | country | phone | linkedin_url` (written back to an empty profile field of a signed-in registrant).
Answer shapes in `gl_guest.answers[key]`: checkbox/consent = boolean; multiselect/sectors/parts = array of strings (multiselect/parts within options); others = string (cut to max_length, default 500, textarea 4000; select within options).

### `gl_guest` additions (staff-only RLS; public goes through edge functions)
| column | values | default |
|---|---|---|
| `user_id` | -> auth.users, unique per event | null |
| `organization_id` | -> organizations | null |
| `ticket_key` | gl_ticket.key | null |
| `answers` | jsonb object | `{}` |
| `consents` | `{terms_at, image, marketing_at}` | `{}` |
| `source_detail` | `{entry: signup\|event_page\|deep_link\|campaign, utm...}` | `{}` |
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

### `review_log` (staff SELECT via RLS; no client write - use `review_log_add`)
`id bigint, subject_type ('person'|'company'|'registration'|'claim'|'join'|'merge'), subject_id uuid, action text (<=60), note, details jsonb, actor_id (spec "by"), created_at (spec "at")`.

### `profiles` additions
`country (<=80), phone (<=40), linkedin_url (<=300), affiliation (<=200), signup_source ('account'|'webinar'|'onsite'|'invitation'|'provisioned'|'legacy'; existing 155 rows = 'legacy', new rows NULL until Phase 2 sets it), signup_intent jsonb (Phase 2; never store a raw claim code: co-members can read profiles), email_proven_at, email_changed_at`.
Frozen against direct API writes by anyone but a verified admin (silently kept, no error): `email, email_proven_at, email_changed_at, signup_source, signup_intent` (+ `persona, access_status` as before). On an API INSERT they start empty and `email` = the JWT e-mail. `country, phone, linkedin_url, affiliation` are user-editable.
`profiles.email` = read-only copy of `auth.users.email` (trigger).

### `profile_interest_sectors` (own rows + staff; anon nothing)
`user_id -> profiles, sector_id -> sectors, created_at`, pk `(user_id, sector_id)`. Insert/delete own rows (UI caps at 5).

### `platform_settings` keys (anyone reads except the last; staff write)
- `registration_flags`: `{"webinar_v2","onsite_v2","front_door","account_signup_v2","password_only_login","wys_form_v2","wys_status_edit","review_queue","provisioning","capabilities_enforced","turnstile"}`, all `false`. Missing key = false.
- `review_sla_text`: JSON string, "within 2 working days".
- `review_digest_recipients`: JSON array of e-mails, **staff-only** (restrictive policy). Seeded from the wys26 staff alert address.

### `guest_signup_rate_limits.scope`
New nullable text. The `registration` function writes its own scope (`reg_register`, `reg_resend`, ...) and counts with `.eq('scope', ...)`. NULL = guest-webinar-register, which counts every row by `ip_hash` / `email_hash` with no scope filter: hash with a prefix of your own, `sha256('reg:ip:' + ip)` and `sha256('reg:email:' + email)` (guest-webinar-register uses `ip:` / `email:`), so the two never count each other's rows. Rows deleted after 24 h.

## 3. What the database does on its own

| Trigger | When | Effect |
|---|---|---|
| `gl_guest_engine_guard` (BEFORE INSERT/UPDATE) | every gl_guest write | v1: refuses v2 statuses/sources and any checkin_token (SQLSTATE 23514, message starts `gl_guest_engine_guard`). v2: refuses `source='request'` unless invitation mode, and a new `source='plus_one'` row when `plus_ones = 0`; mints `checkin_token` when a row becomes `confirmed`. Stamps `cancelled_at`, `updated_at`. |
| `gl_guest_queue_provisioning` (AFTER INSERT/UPDATE OF status) | row becomes `confirmed` on a `kind='onsite'` event | inserts ONE `account_provision_job` (ON CONFLICT DO NOTHING), `email_due_at` = now (with_confirmation) or `account_email_send_at` / event end + 1 day (after_event). Never aborts the write. Covers wys26 approvals, RSVP accepts and plus-ones made by guest-list. |
| `on_auth_user_email_confirmed` (auth.users) | `email_confirmed_at` null -> set, AND a confirmation/invite/recovery e-mail had been sent, AND no admin "view as user" in the last 10 min | `on_email_proven(uid)`: stamps proof, attaches records, runs `complete_signup_for`. With Confirm email OFF (today) sign-ups prove nothing. |
| `on_auth_user_email_changed` (auth.users) | `email` changed | `profiles.email` follows; `email_changed_at` = now; proof kept only if the change went through the confirmed change flow, else cleared. |
| (dropped) `trg_link_guest_registrations` | | no more unproven linking at sign-up |

Every trigger on `auth.users` swallows its own errors (RAISE WARNING): auth never fails because of them.

## 4. RPCs

Errors: `raise` with SQLSTATE `42501` + message `forbidden` (wrong caller) or SQLSTATE `22023` + a code as message (listed). Map codes to English UI text. The service-role RPCs return `{ok:false, error}` instead of raising.

### Signed-in (authenticated)
| RPC | Returns | Notes |
|---|---|---|
| `my_participations()` | rows: `engine ('guest_list_v1'\|'core_v2'\|'legacy'\|'sm26'), registration_id, gl_event_id, event_id (events.id), slug, title, starts_at, ends_at, is_past, kind ('webinar'\|'onsite'), location, image_url, role_or_ticket, status (raw), status_display, payment_display, status_url, can_cancel, linked` ordered by starts_at desc | Rows by `user_id`, or by the auth e-mail when PROVEN (gl_guest, legacy guest rows, SM26 attendee). SM26 rows read-only (`can_cancel=false`, `status_url='/sm26/me'`). v1 rows: `status_url='/{slug}/guest?t={token}'` (that token is also the WYS door QR: show it only to its owner). v2 rows: `status_url=null` (manage with the session through `registration`). |
| `get_my_event_access(p_event_ids uuid[] default null)` | `event_id, is_registered, meeting_url, replay_url` | Unchanged for legacy rows. Adds: a CONFIRMED gl_guest of the caller (by user_id or proven e-mail) on `gl_event.legacy_event_id` -> `is_registered`, `meeting_url = coalesce(gl_event.meeting_url, events.meeting_url)`, `replay_url = gl_event.replay_url`. Staff always get the links. |
| `mark_email_proven()` | `{proven, stamped, attached?, reason?}`; reason: `no_profile, no_email_link_session, email_changed_since, link_session_too_old, impersonation` | Call it AS SOON AS `/welcome`, `/reset-password` or `/verify-email` opens (AUTH lane, Phase 2), before the person types anything. Stamps when the JWT `amr` has `otp, magiclink, recovery, invite, email/signup` or `email_change` dated after the last e-mail change AND less than 15 minutes ago, and no admin "view as user" was logged within 5 minutes before / 1 minute after that link session. |
| `attach_my_records()` | int (rows linked) | No-op unless proven. Once per session from AuthContext (Phase 2). Links gl_guest + legacy event_registrations guest rows; never sm_*. Never two rows of one event to one account. |
| `admin_save_event(p jsonb)` | `{gl_event_id, event_id, slug}` | Staff (`is_moderator`). See 4.1. |
| `admin_clone_event(p_src uuid, p_overrides jsonb)` | same | Staff. Copy (either engine) as a new unpublished core_v2 event with its tickets and questions; no meeting/replay links or dates of opening copied. `p_overrides = {event:{...}, registration:{slug (required), ...}}`. |
| `gl_checkin_v2(p_event_id, p_token uuid, p_guest_id uuid, p_undo bool)` | same jsonb as `gl_checkin`, plus `ticket_key` | Staff. `separate` door: `checkin_token` only; `shared`: `token`. `{ok:false,error:'unknown_token'}`, `{ok:false,error:'status_<s>',guest_id,name,company}`, `{ok:true,already:true,...}`, `{ok:true,undone:true,guest_id}`, `{ok:true,guest_id,name,company,conference,gala,plus_one,ticket_key}`. Message `forbidden` for non-staff. |
| `review_log_add(p_subject_type, p_subject_id uuid, p_action, p_note default null, p_details jsonb default '{}')` | bigint | Staff. One row per queue decision (also after a guest-list `decide` on wys26; `gl_decide_v2` writes its own). |

### Public (anon + authenticated)
`public_registration_events()` -> `gl_event_id, event_id, slug, engine, kind, registration_mode, access, title, starts_at, ends_at, location, image_url, state` for events not hidden, catalogue row published, not ended; ordered by start. (wys26's catalogue row is unpublished today, so it is not listed.) `gl_event_slug_for(events.id)` is unchanged.

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
| `attach_my_records_for(uid)`, `on_email_proven(uid)` | int / jsonb (accept-invite stamps proof with `on_email_proven`) |
| `complete_signup_for(uid)` | jsonb; Phase 2 replaces the body (same signature) |
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
- An unpublished, not hidden event is a draft: `gl_register_v2` answers `state='not_published'`. A hidden event takes registrations by link (tests).
- Keeps `events` in step: `event_type` (webinar|on_site), `invitation_only` (= invitation mode), `access_level` (= access), `max_attendance` (= capacity), `meeting_url = NULL` (the join link is never public).
- Defaults on create: kind webinar; mode instant (webinar) / review (onsite).
- Codes: `forbidden, bad_input, event_not_found, guest_list_event` (v1 events are edited in `/admin/guest-list/:slug`), `title_required, slug_required, slug_invalid` (`^[a-z0-9]+(-[a-z0-9]+)*$`, <= 60), `slug_reserved` (sm26, wys26, admin, register, registration, signup, events, join, welcome), `slug_taken` (gl_event or sm_event), `slug_locked` (published), `bad_kind, bad_mode, instant_needs_webinar, bad_access, bad_capacity, bad_standard_fields, bad_reminders` (`^P(T?[0-9]+[DHMW])+$`), `bad_tickets, bad_ticket_key, duplicate_ticket_key, bad_questions, bad_question_key, duplicate_question_key`. A bad question `kind`/`profile_field` raises the table CHECK (23514).

### 4.2 `gl_register_v2(p)` (core_v2 only; the event row is locked: capacity is race-free)
Input: `{gl_event_id, user_id?, email, first_name, last_name, company?, job_title?, phone?, country?, ticket_key?, answers?, consents?, source_detail?, organization_id?}`.
- Signed in (`user_id`): the auth e-mail replaces `email`; EMPTY names, job title, phone and country come from the profile, and an empty company from the person's company (the one given in `organization_id` if they belong to it, else their only company). One-click = `{gl_event_id, user_id}`.
- `standard_fields`: a `hidden` field is dropped (never stored, never written back); a `required` one must be present after the profile fill.
- Results:
  - `{ok:true, duplicate:false, reactivated, guest_id, status}`: `status` = `confirmed` / `waitlisted` (instant), `requested` (review; invitation + public_requests with `source='request'`). A cancelled/declined row of the same person is re-used (`reactivated:true`, same tokens).
  - `{ok:true, duplicate:true, guest_id, status}`: already registered (same e-mail or account).
  - `{ok:false, state}`: `not_published, not_yet_open, closed, members_only, invitation_only, full`.
  - `{ok:false, error}`: `bad_input, not_found, wrong_engine, unknown_user, invalid_email, missing_fields (+ fields[]: first_name, last_name, company, job_title, phone, country), ticket_required, unknown_ticket, ticket_invite_only, ticket_not_allowed, invalid_answers (+ keys[])`.
- Unknown answer keys are dropped. Standard fields and `profile_field` answers fill EMPTY profile fields of a signed-in registrant.
- **The public response of the `registration` function must stay identical for new and duplicate registrations** (`{ok:true}`); `duplicate` only decides which e-mail is sent. Never return a token.

### 4.3 `gl_decide_v2(...)` (core_v2 staff decisions, one transaction)
The `registration` function checks the staff session, then calls it with `p_actor` = that staff user (checked again: verified admin or moderator).
- `p_decision`: `approve` (requested / needs_info / waitlisted -> `confirmed`), `reject` (same -> `rejected`), `waitlist` (requested / needs_info -> `waitlisted`), `request_info` (requested / waitlisted -> `needs_info`, `p_info_request` required, stamps `info_request` and `info_requested_at`). Up to 200 ids. Rows in another status or another event are skipped.
- Locks the event row; `approve` checks event capacity and each ticket's capacity (seats held + adding) unless `p_force`. Paid tickets (`approved` + `payment_due`) arrive in December: today approve always confirms.
- Sets `decided_at`, `decided_by`; the DB mints `checkin_token` and queues the on-site provisioning job; the job gets `p_org_action` / `p_validate_person` (and `created_by`) in the SAME transaction, before any cron can see it. One `review_log` row per changed registration (`subject_type='registration'`, `action=p_decision`, note, details).
- Returns `{ok:true, decision, status, changed: [ids], skipped: [ids], jobs}` (e-mail the `changed` rows) or `{ok:false, error}`: `bad_decision, bad_input, forbidden, bad_org_action, info_request_required, not_found, wrong_engine, capacity (+held, capacity, adding), ticket_capacity (+ticket_key, held, capacity, adding)`.

## 5. Lane notes

**EDGE (`registration`, `registration-cron`, `provision-person`)**
- Writes with the service role. Core_v2 inserts: `gl_register_v2` only. wys26 parity `register`: the guest-list rules, legacy columns only (+ `user_id` when the JWT e-mail equals the form e-mail, + `consents`), `source='request'`, `status='requested'`.
- Staff `decide` on core_v2: `gl_decide_v2` only (never two REST writes: the cron could provision between them). `cancel`: `status='cancelled'` (DB stamps `cancelled_at`). `needs_info` -> `requested` after the person answers: `update ... set status='requested'`. `attach` (token + JWT): set `user_id` if null, write `review_log`, never touch `email_proven_at`.
- `provision-person`: skip (`status='skipped'`, `email_due_at=null`) a job whose gl_guest no longer exists or is no longer `confirmed` (contract runs delete their canary rows; their jobs stay); set `gl_guest.user_id / account_action / provisioned_at`; when NO account e-mail will be sent (linked, pending_link, skipped) set `email_due_at = null` in the same update as `status='done'`; never write `email_proven_at` (the set-password link click proves it through the auth trigger or `mark_email_proven`).
- `registration-cron` (verify_jwt = true) receives `POST {"job": "provision" | "reminders" | "digest"}` with the service key from pg_cron: provision every 5 min (only when flag `provisioning` and a job is queued, failed with attempts < 5, or has an account e-mail due in the last 7 days), reminders at :10 hourly (flag `webinar_v2` or `onsite_v2`), digest once a day at 08:00 Europe/Monaco (flag `review_queue`). Reminders: stamp `gl_guest.reminders_sent[duration]`; skip cancelled/declined/rejected. Digest: also count companies pending review (`organizations.access_status='pending'`, including those flagged `organization_pending_review` in `organization_audit_log`).
- After `webinar_v2` is live: `select cron.unschedule('guest-webinar-reminders-hourly');` (not in this migration).
- Status links: `gl_issue_access_token` / `gl_resolve_access_token`; e-mail `${SITE}/registration?t=<raw>`.
- Rate limits: see `guest_signup_rate_limits.scope` (prefix your hashes).

**REG (front)**
- Read `platform_settings.registration_flags` (missing = false). Lists: `public_registration_events()`. My events: `my_participations()`. Join link: `get_my_event_access`. Never read `gl_*` tables directly (staff-only).
- Map `status_display` to words (§2.3 of the spec): `under_review` Received, under review · `needs_info` Information needed · `waitlisted` Waiting list · `invited` Invited, please reply · `payment_due` Approved, payment due · `confirmed` Confirmed · `not_accepted` Not accepted · `declined` You declined · `cancelled` Cancelled · `event_ended` Event ended. `payment_display`: none, due, pending, invoiced, paid, waived, refunded.
- `/{slug}/guest?t=` routes exist only for guest_list_v1 events (wys26). core_v2 events use `/registration?t=`.
- Do not publish a core_v2 event while the old main site is live: main still offers its old registration on `/events/:id`.

**ADMIN**
- Editor: `admin_save_event` / `admin_clone_event`; read `gl_event`, `gl_ticket`, `gl_question`, `gl_guest`, `account_provision_job`, `review_log` directly (staff RLS). wys26 stays in `AdminGuestList` (guest-list function).
- `AdminGuestList` and every guest-list staff action (decide, invite, resend, cancel, update) must refuse an event whose `engine <> 'guest_list_v1'`: guest-list would e-mail a pass carrying `gl_guest.token`, which a core_v2 door refuses. Core_v2 decisions go through the `registration` function (`gl_decide_v2`).
- Door: `gl_checkin_v2` for core_v2 (it also works for v1); route `/admin/guest-list/:slug/checkin` unchanged.
- Flags/SLA/digest: update `platform_settings` rows (staff RLS). Never edit `gl_event.engine` or `door_token` by hand (the CHECK refuses a mismatch).

## 6. RLS / grants summary
- `gl_event, gl_guest, gl_ticket, gl_question`: staff (`is_moderator()`) only.
- `gl_access_token`: no client access at all. `account_provision_job`, `review_log`: staff SELECT; no client INSERT/UPDATE/DELETE (even staff: use RPCs / service role).
- `profile_interest_sectors`: own rows + staff. `platform_settings.review_digest_recipients`: staff only.
- EXECUTE: internal helpers and `gl_register_v2` / `gl_decide_v2` service role only; signed-in RPCs not for anon; `public_registration_events` for everyone.
- `create_organization`: no longer executable by anon/PUBLIC; no auto-verification (authenticated keeps it until Phase 2); a company created by a verified person is logged `organization_pending_review`.

## 7. Deviations from the spec (decided or forced)
1. `sm_autoclaim_by_email` NOT revoked (the redesigned member dashboard uses it). See §9.
2. wys26 `account_email_timing = 'with_confirmation'` (Victor 7 Oct: account at validation), not `after_event` 28 Nov. guest-list is frozen, so the set-password e-mail is a separate e-mail from provision-person, not a block inside the QR e-mail.
3. canary-onsite created with `requests_open = false` (the contract script opens/closes it). canary-v2 has fixed dates (30 June 2027), not "now + 30 days".
4. `review_log` columns `actor_id` / `created_at` instead of `by` / `at`.
5. Added (not in the spec list): `gl_event.hidden`, `profiles.email_changed_at`, `gl_register_v2`, `gl_decide_v2`, `gl_registration_state` (+ `not_published`), `gl_seats_held`, `gl_event_window`, `gl_issue_access_token`, `gl_resolve_access_token`, `public_registration_events`, `review_log_add`, `guest_signup_rate_limits.scope`, the restrictive policy on `review_digest_recipients`, CHECK `gl_event_door_matches_engine`, the provisioning backfill, the `organization_pending_review` audit event.
6. The proof trigger requires a sent link before the confirmation (Confirm email is OFF: GoTrue confirms sign-ups itself) and ignores admin "view as user" sessions. `mark_email_proven` accepts only a link session less than 15 minutes old.
7. `complete_signup_for` is a placeholder (Phase 2).
8. `create_organization` is also revoked from anon; `admin_save_event` ignores `door_token`.

## 8. Not in this migration
Phase 2: `handle_new_user` metadata mapping, `complete_signup_for` body, `email_proof_token` + `confirm_email_proof`, organization_invitations changes, `create_organization` revoke from authenticated, `org_members_insert` owner branch, `normalize_org_name` + trigram index, legacy proof backfill, revoking `sm_autoclaim_by_email`.
Phase 3: review queue RPCs, rights (`org_type_capability`, `has_capability`...), `archived_at` / `duplicate_of`, staff choices for WYS provisioning jobs.
December: `payment_id`, `gl_invoice`, `event-checkout`, `approved` + payment in `gl_decide_v2`.

## 9. Runbook (coordinator)
1. `scripts/contract/sm26-snapshot.sql` (read-only), keep the output.
2. Dry run `supabase/dryrun/20261009200000_registration_prereqs.dryrun.sql`, then apply `20261009200000_registration_prereqs`.
3. Dry run `supabase/dryrun/20261009210000_registration_core.dryrun.sql`, then apply `20261009210000_registration_core` at a quiet moment.
4. Snapshot again: SM26 lines and the wys26 token fingerprint identical; "confirmed on-site rows without a provisioning job" = 0.
- Both migrations and both dry runs set `lock_timeout = 5s`, `statement_timeout = 120s`. "canceling statement due to lock timeout": nothing was applied, run it again a little later.
- **Before switching `provisioning` on** (only after `registration-cron` and `provision-person` are deployed), list who will get an account and a set-password e-mail, and get Victor's OK:
  `select j.email, g.status, j.created_at from account_provision_job j join gl_guest g on g.id = j.source_id where j.payload->>'event_slug' = 'wys26' and j.status = 'queued' order by j.created_at;`
  Every wys26 guest confirmed since the apply is in it; the first run sends to all of them at once, possibly weeks after their QR e-mail.
- Until the review queue exists, Victor checks Admin > Companies (status pending) once a week: a company created by a verified member from the old wizard now waits there, while that wizard still tells its creator "set up and live".
- `sm_autoclaim_by_email` (kept on purpose) still links an imported SM26 registration to the account that has its e-mail, PROVEN OR NOT, and writes `sm_registration` / `sm_role_assignment`. If an SM26 fingerprint changes and nothing else did, look there first. Phase 2: have the dashboard read SM26 through `my_participations()` and revoke it.
