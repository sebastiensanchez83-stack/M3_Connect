# Edge functions of the registration core: API for the REG and ADMIN lanes

Phase 1 EDGE lane, 9 Oct 2026. Built on the DB lane's contract
(`docs/registration-contract.md`, migrations `20261009200000_registration_prereqs` and
`20261009210000_registration_core`). Spec: `regspec-en.md` §4.1 to §4.3, §7, §13.

| Function | verify_jwt | Called by |
|---|---|---|
| `registration` | **false** (checks the session itself) | the site (anonymous or signed in), staff screens |
| `registration-cron` | **true** + service-role check inside | pg_cron (`invoke_registration_cron`) |
| `provision-person` | **true** + service-role or verified-staff check inside | `registration-cron`, staff screens |
| `send-profile-reminders` (changed) | false (unchanged) | pg_cron |

Deploy only after both migrations are applied. Every behaviour is behind
`platform_settings.registration_flags` (missing key = off), except HIDDEN events (canaries,
staff tests), which skip the flags: keep them closed (`closes_at` in the past) outside a test
run. canary-v2 (its slug is in this public repository) is created closed; contract §9 says
how to open it for an hour.

## `registration`

`POST` JSON `{ action, ... }` through `supabase.functions.invoke('registration', { body })`.
The user's session is sent automatically when signed in. Errors come back as HTTP 4xx with
`{ error: "<code>" }` (read the body of a non-2xx answer, like `src/lib/guestList.ts`); states
that are not errors come back as HTTP 200 `{ ok: false, state }`.

Event selector (every action that names an event): `gl_event_id`, or `slug`, or `event_id`
(the `events` catalogue id).

### Public

| action | body | answer |
|---|---|---|
| `form` | selector | `{ ok, engine, state, paused?, event, fields, tickets, questions, review_sla_text, prefill?, mine? }` (below) |
| `register` | selector, `first_name, last_name, email, company, job_title, phone, country, ticket_key, answers, consents, source_detail, organization_id, captcha, website` | anonymous: `{ ok: true }` (new and repeated registrations look the same); signed in: `{ ok: true, status, duplicate, registration_id }`; or `{ ok: false, state }` |
| `status` | `token` (status link) or, signed in, `registration_id` or a selector | the status view (below) |
| `update` | same keys as `status` + the changed fields: `first_name, last_name` (only while requested / needs_info / waitlisted), `company, job_title, phone, country`, `answers` (only the keys that change); while `needs_info`: `info_answer` (free text to M3, up to 2000 characters) | the status view |
| `cancel` | same keys as `status` | `{ ok: true, status: "cancelled" }` |
| `reminders` | same keys as `status` + `on: boolean` | `{ ok: true, reminders_on }` (false also stops the absentee follow-up) |
| `resend_links` | `email` | always `{ ok: true }` ("Get my links": one e-mail with a fresh link per upcoming registration) |
| `attach` (session required) | `token` | `{ ok: true }`, `{ ok: true, already: true }`, 409 `linked_elsewhere` / `already_registered` |

- `form.state`: `open, not_published, not_yet_open, closed, full, waitlist, members_only,
  invitation_only, registered, not_found` (contract §4). `paused: true` = the kill switch of
  the event kind is off (`webinar_v2` / `onsite_v2`): show "Registration is closed for now".
  Hidden events (canaries, tests) and staff are not paused.
- `form.event`: `gl_event_id, event_id, slug, title, kind (webinar|onsite), mode
  (instant|review|invitation), access, public_requests, waitlist, starts_at, ends_at,
  opens_at, closes_at, edit_locks_at, timezone, location, image_url, hidden`. Never the
  join link, never the staff address.
- `form.fields`: `{ company, job_title, phone, country }` each `required | optional | hidden`.
- `form.tickets[]`: `key, label, description, price_cents, currency, price_note, invite_only,
  parts, restricted_to (company types or null), allowed` (false = invite-only, or not one of
  the caller's verified company types).
- `form.questions[]`: `key, label, help, kind, options, max_length, required, ticket_keys,
  editable_after_submit`. Answer shapes: contract §2 (`gl_question`).
- `form.prefill` (signed in): `first_name, last_name, email, email_locked: true, job_title,
  country, phone, company, organizations: [{id, name}], verified`.
- `form.mine` (signed in, already registered): `{ registration_id, status, status_display }`.
- For a `guest_list_v1` event (wys26, canary-onsite), `form` only answers `{ engine, state,
  parity, event }`: `parity: true` = post the `/wys26` form to `registration` (flag
  `wys_form_v2`), else to `guest-list`.

`register`:
- One-click when signed in: `{ action: "register", slug }` is enough; empty fields come from
  the profile (contract §4.2).
- Anonymous: `consents.terms === true` is required (`terms_required`). `consents` takes
  booleans `{ terms, image, marketing }`; the function stamps `terms_at` / `marketing_at`.
  `source_detail`: `{ entry: signup|event_page|deep_link|campaign, ref, utm_* }`.
- Limits: anonymous 5 per hour per IP and 3 per hour per address (+ Turnstile, + the flood
  guard); signed in (no captcha) 10 per hour per account address and 20 per hour per IP.
  Above them: 429 `rate_limited`. A repeated registration e-mails "already registered" at
  most once an hour; a registration cancelled then made again alerts the staff once a day.
- A signed-in account whose address is not PROVEN (contract §2; Confirm email is off) never
  takes over a cancelled or declined registration of that address that it does not hold:
  the row comes back to life unlinked (as for an anonymous registration) and the answer is
  the public `{ ok: true }`. `gl_register_v2` links on reactivation only when proven (one
  statement); this function only gives the public answer.
- Error codes: `invalid_email, terms_required, rate_limited (429), captcha, busy (429),
  missing_fields (+ fields[]), invalid_answers (+ keys[]), ticket_required, unknown_ticket,
  ticket_invite_only, ticket_not_allowed, account_suspended (403), not_found (404),
  session_expired (401), not_available (403, wys parity off), closed / no_part (parity)`.
- wys26 parity (guest_list_v1 event, flag `wys_form_v2`, or a hidden canary): the body of
  `guest-list`'s `request` (`slug, first_name, last_name, email, phone, company, job_title,
  country, motivation, wants_conference, wants_gala, captcha, website`) + `consents`. Same
  rules, codes and answers as `guest-list`. The acknowledgement gets a "View my request"
  button to `/{slug}/guest?t=`.

Status view (`status`, `update`):
```
{ ok, engine, via: token|session, read_only,
  event: { gl_event_id, event_id, slug, title, kind, mode, starts_at, ends_at, timezone, location, image_url, ended },
  registration: { id, status, status_display, payment_display, first_name, last_name, email_masked,
                  company, job_title, phone, country, ticket_key, ticket_label, answers, info_request,
                  created_at, linked, linked_to_me },
  timeline: [{ step: received|needs_info|confirmed|not_accepted|waitlisted|cancelled|checked_in, at }],
  fields, questions: [{ ..., editable }], can_edit, can_edit_names, can_cancel, can_answer_info, edit_locks_at,
  reminders_on, meeting_url, replay_url, pass: { qr_text } | null, calendar: { title, starts_at, ends_at, location, url } | null }
```
- `linked`: the registration is linked to an account; `linked_to_me`: to the account that is
  asking (a status link opened while signed in), so the page can say "In your account".
- `read_only: true`: the registration is linked to an account whose address is PROVEN and
  the page was not opened by that account: show "Sign in to manage"; `update` / `cancel` /
  `reminders` answer 403 `sign_in_required`. A row linked to an account that has not proved its address
  stays editable by the status link (the token proves the mailbox).
- Signed in without a token, a registration is found by account, or (proven address only)
  by the address when no account holds it yet: the `registration_id` that `form` / `register`
  report always works with `status`, `update`, `cancel` and `reminders`.
- `needs_info`: saving the form answers M3 (status back to `requested`, staff alerted with
  the question, `info_answer` and the list of changed details; the answer is also kept in
  `review_log`, action `info_provided`, as `note`). Show a "Your answer" text box and send it
  as `info_answer`; saving without any change and without an answer still counts as "my
  details are correct". `can_answer_info`: the answer is taken until the event ends, even
  once the details are locked (`can_edit` false, edit lock or event started): `update` then
  takes `info_answer` only and ignores the other fields.
- `pass.qr_text` (confirmed on-site): draw it as a QR code, full screen, with a brightness
  hint. Given to a status link, or to a signed-in owner whose e-mail is proven.
- `status_display` words: contract §5 REG.
- Codes: 404 `not_found` (unknown, expired or revoked link), 409 `locked` (not editable any
  more), 409 `changed` (edited elsewhere: reload), 400 `missing_fields`, `invalid_answers`.

Status link page `/registration?t=<token>` (REG lane): call `status` with the token. The
reminder e-mails of a person without an account link to `/registration?t=<token>&reminders=off`:
show a button "Stop e-mails about this event" that calls `reminders` with `on: false`. Never
act on the page load alone (mail scanners open links).

wys26 personal page `/wys26/guest?t=<gl_guest.token>`, flag `wys_status_edit` (else 403
`not_available`): `update` (only while `requested`: `phone, company, job_title, country,
motivation, wants_conference, wants_gala`), `cancel` (a request only), `attach` (signed in,
"Add to my account"). The e-mail address is never editable. `status` does not take this token
(the page keeps guest-list's `guest` action). A request cancelled from this page comes back
as a new request when the person sends the `/wys26` form again, but ONLY through the parity
form (`wys_form_v2` on): while it is off, `/wys26` posts to the frozen guest-list, which
answers `{ ok: true }` and records nothing. Label the cancel button accordingly ("You will
not be able to send a new request from this page") while `wys_form_v2` is off.

### Staff (verified admin or moderator session)

| action | body | answer |
|---|---|---|
| `decide` | `gl_event_id, guest_ids (<= 200), decision (approve|reject|waitlist|request_info), info_request, note, force, org_action, validate_person, notify` | `gl_decide_v2`'s answer + `{ sent, failed }`; 409 `capacity` / `ticket_capacity` (+ held, capacity, adding); 409 `onsite_not_live`: `approve` on a non-hidden on-site event while flag `onsite_v2` is off (its pass would point at the main site, whose door refuses a core_v2 code) |
| `send_status_link` | `guest_id` | `{ ok }`: e-mails the registration link (core_v2: a fresh status link; wys26: the personal link; the fallback when `wys_form_v2` is off) |
| `resend` | `guest_id` | `{ ok }`: e-mails the current status again (core_v2) |

- `decide` e-mails every changed row: confirmed (webinar: `.ics` + join link; on-site: entry
  QR + `.ics`), waiting list, information needed. `reject` e-mails only with `notify: true`.
  `notify: false` sends nothing.
- `org_action` / `validate_person` are stored on the provisioning job (on-site confirmations):
  `{ mode: none|link|create, org_id, type, name, website, country, as_owner }`.
- Not built here (needs the DB lane): `invite` for core_v2 invitation events, and the RSVP of
  such invitations; `export` (read `gl_guest` directly: staff RLS); the waiting-list
  promotion when a confirmed person cancels (spec §7 `reg_seat_available`: nobody on the
  waiting list is moved up or told today; staff approve waitlisted rows with `decide`). It
  needs a system actor for `gl_decide_v2` (or a dedicated promote RPC) from the DB lane.

## `registration-cron`

`POST { job: "provision" | "reminders" | "digest", force? }` with a service-role key.

- `reminders` (hourly at :10): `gl_event.reminders` (ISO durations before the start; empty =
  webinar `P7D, P1D, PT1H`, on-site `P7D`; `settings.no_reminders: true` = none) to confirmed
  rows; the absentee follow-up after a webinar with the replay link (`gl_event.replay_url`,
  else `events.replay_url`); the daily new-registrations e-mail of events in
  `staff_alert_mode = digest` (08:10 Monaco). Opt-outs: `reminders_sent.off`, and
  `notification_prefs.events = false` for a linked account (signed unsubscribe link).
  `reminders_sent` keys: the durations, `off`, `followup`, `replay`.
  A reminder goes up to 30 minutes early (hourly job: "1 hour before" arrives 30 to 90
  minutes before the start). One that falls due right after a (re)confirmation is skipped.
- Absentee follow-up (webinars, 1 hour after the end): who came = `checked_in_at` (ADMIN
  lane: "mark as attended" through `gl_checkin_v2`). Absentees are known when
  `gl_event.settings.attendance_recorded` is true, or, without that setting, once someone is
  marked and nobody was marked in the last 30 minutes; `attendance_recorded: false` = never.
  Known: "Sorry we missed you" (+ replay) to the others. Not known: only the replay, worded
  for everyone, and nothing while there is no replay link.
- Canary tests: pg_cron wakes `reminders` only when `webinar_v2` or `onsite_v2` is on. With
  both off, run it by hand: `POST {"job":"reminders","force":true}` with the service key
  (hidden events are always served when the job runs).
- `digest` (08:00 Monaco, flag `review_queue`): counts and oldest age of registrations to
  review (all events, wys26 included), pending people, pending companies, failed account
  creations, to `platform_settings.review_digest_recipients`.
- `provision` (every 5 min, flag `provisioning`): calls `provision-person`.

Event settings read (`gl_event.settings`): `timezone` (IANA, default Europe/Monaco),
`practical_info` (else `programme_note`), `contact_email` (reply-to), `no_reminders`.

## `provision-person`

- Service role: `{ action: "run" }` (25 jobs, then 50 due account e-mails).
- Staff: `{ action: "run", job_ids }` (now), `{ action: "send_emails", job_ids }` ("Send account
  e-mails now", whatever the due date). With `provisioning` off, staff may only run jobs of
  hidden events.
- Results per job: `created | linked | pending_link | skipped | failed | busy`; e-mails:
  `sent | not_needed | no_account | failed | failed_gave_up | busy`.
- `pending_link` = an account has the address (or already holds the registration) but has
  not PROVED it, or holds the registration under ANOTHER address (a status link forwarded and
  attached to someone else's account: `same_address: false` in `review_log`; never applied by
  a run, staff decide by hand): M3's choices (validate the person, company action) are NOT applied;
  `review_log` (action `provisioned`) says `proven: false` and what was not applied. Once the
  person proved the address, a staff `run` of that job applies them (a `done` job whose row
  is still `pending_link` is queued again). The proof re-queues it by itself: `on_email_proven`
  (through `mark_email_proven`, called by /welcome and /reset-password once a new password is
  saved from the e-mailed link; no auth trigger proves anything) puts the person's
  `pending_link` jobs of that address back to `queued`, and the next provisioning run applies them.
- Accounts created here are CONFIRMED (no password anyone knows, `pw_pending`): an unconfirmed
  account could be taken over by a public sign-up with its address while Confirm email is off.
  Their account e-mail is a `recovery` link through /welcome. The phone of a registration is
  never copied to a profile.
- Retries: a job is tried at most 5 times by the cron (a run that crashed counts); then it
  is `failed` and only a staff `run` retries it. An account e-mail that failed 5 times is
  given up (`email_due_at` cleared, `last_error` "e-mail: gave up ..."); staff "Send account
  e-mails now" (`send_emails`) still sends it.

## Environment

Existing secrets: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_ANON_KEY`,
`RESEND_API_KEY`, `SITE_URL`, `TURNSTILE_SECRET_KEY` (optional), `TURNSTILE_ENFORCE` (optional).
New, optional: `REGISTRATION_SITE_URL`, the site of the links (`/registration`, `/welcome`,
`/events/:id`, the door QR, `/unsubscribe`) in the e-mails of HIDDEN test events only (canary
tests on the preview before the redesign is live). Every real event always links to
`SITE_URL`, so a preview address left there by mistake never reaches a real pass or link.
Real events send nothing before their flag (`webinar_v2` / `onsite_v2`), and those flags go
on only once the redesign (with `/registration` and `/unsubscribe`) is live.

## Deviations to confirm

- `send-profile-reminders`: spec §4.7 (Phase 1) leaves every persona `individual` account
  out of the company reminders. Built: only accounts made by the registration flows
  (`signup_source` webinar / onsite / invitation / provisioned) or that chose "No company"
  are left out now; persona `individual` is left out once `account_signup_v2` is on (today
  "individual" is also the default persona of the old sign-up wizard). To follow the spec
  now: `individualsToo = true` in `participantIds`' caller. Needs Victor's choice.
