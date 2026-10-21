# The WYS door on day D

Lane C3, 21 Oct 2026. Victor decided (Q15 = a) that the new WYS invitation-request form
(`wys_form_v2`) and the guest's editable personal page (`wys_status_edit`) go on at day D.
This file gives the day-D switch order for everything WYS, a 10-minute test for Victor right
after the switch, and the rollback. It adds to [`go-live-runbook.md`](go-live-runbook.md) D5
row 12 and to [`wys-dubai-runbook.md`](wys-dubai-runbook.md); it changes neither.

**What never moves:** `/wys26`, `/wys26/guest?t=<token>`,
`/admin/guest-list/wys26/checkin?token=<token>` (the QR), the tokens, the `guest-list`
function (v6, commit 446b1c9a, not redeployed before 29 Nov), its secrets, `gl_checkin`.

## 1. Every WYS path on the new site, and what it needs on day D

| Path | Who | Calls | Flags / functions |
|---|---|---|---|
| `/wys26`, request form | Visitor, no account | `registration` action `register` (parity) when `wys_form_v2` is on; `guest-list` `request` when off. The client falls back to `guest-list` by itself if `registration` answers `not_available`, `session_expired`, 401, 404 or BOOT_ERROR | `wys_form_v2`; `registration` deployed (current v2); Turnstile per Q13 |
| Signed in on `/wys26` | Member | Same, e-mail locked to the account's | `wys_form_v2` |
| Thank-you message | Visitor | none | none |
| E-mails after a request | Visitor, M3 | Parity: acknowledgement with a "View my request" link to `/wys26/guest?t=` + staff alert. Off: guest-list's acknowledgement + staff alert | none |
| `/wys26/guest?t=` personal page: view, accept, decline, plus-one, pass QR | Guest | `guest-list` `guest` / `rsvp` / `plus_one` (unchanged) | none |
| Personal page: Edit, Cancel, Send again, Add to my account | Guest | `registration` `status` / `update` / `cancel` / `restore` / `attach` | `wys_status_edit`; "Add to my account" also needs the new event pages (`webinar_v2` or `onsite_v2`) |
| Pass e-mail and QR | Guest | Sent by `guest-list` on approval or acceptance (old look until 29 Nov) | none |
| `/admin/guest-list/wys26`: approve, refuse, invite, resend, cancel, CSV, open/close requests | M3 | `guest-list` staff actions, `gl_event` / `gl_guest` | Moderator or admin account |
| `/admin/guest-list/wys26/invitations` | M3 | `invitation-campaign`, `invitation_*` tables | Admin |
| `/admin/guest-list/wys26/checkin` (QR or name search) | Door phones | `gl_checkin` | Staff account; with `password_only_login` on, the door phones sign in with a password |
| Account e-mail "your account is ready" | Confirmed wys26 guests | `provision-person` via `registration-cron` | `provisioning` (D5 row 10) |

## 2. Day-D switch order (WYS only)

Every flag uses the D5 template of the go-live runbook. After each one, check in a FRESH tab:
the site keeps the flags 5 minutes.

1. **After the site is published, flags still off (D1 checks).** On a phone, signed out:
   `/wys26` loads with the form; `/wys26/guest` with no token shows "This invitation link
   cannot be opened". The wys26 guest list opens (read only). Nothing else changes for WYS here.
2. **D5 rows 1 to 10 as planned.** Row 4 (`password_only_login`): each door-phone account must
   have a password (they are staff accounts, already the case per the French plan §2). Row 10
   (`provisioning`): the confirmed wys26 guests get the "account ready" e-mail in the same
   minute; tell Victor the number first.
3. **Precondition for row 12:** the `wys-parity` contract test has passed on `canary-onsite`
   (`scripts/contract/wys-parity.mjs`; it writes canary rows and sends real e-mails to the
   test address: Victor's OK first). Check `registration` is the deployed version listed in
   runbook §1.
4. **`wys_form_v2` on.** Fresh tab, `/wys26`: the form looks the same. Test 1 below.
5. **`wys_status_edit` on**, a few minutes later. Tests 2 to 4 below.
6. **D+1, Turnstile (Q13).** `TURNSTILE_ENFORCE` hits both `guest-list` and `registration`:
   run test 1 again right after, on a phone, signed out.
7. **13 Nov:** freeze 1 (bug fixes only). **18 Nov:** door rehearsal. **20 to 28 Nov:** no
   flag change; the rollback in §4 is the only exception, and only if the form is broken.

## 3. Ten-minute test for Victor, right after the switch

Use a phone, not signed in, and a test address of yours (not a real guest's). This creates
ONE real request on the WYS list; you cancel it yourself at step 4, so M3 never acts on it.

1. **Ask for an invitation (2 min).** Open smartmarinaconnect.com/wys26. Tap "Request an
   invitation", fill in the form with your test address, tick both parts, send.
   You should see "Thank you". Within a minute: your test inbox has the acknowledgement with
   a "View my request" button, and events@m3monaco.com has the staff alert.
2. **Open your request (2 min).** Tap "View my request" in that e-mail. You should see "Dear
   [first name]", the yellow "Under review" label, "Asked for: Conference + Gala dinner", an
   "Edit my request" button and a "Cancel my request" link.
3. **Change it (2 min).** Tap "Edit my request", change the job title, untick "Gala dinner",
   tap "Save my changes". You should see "Your request is updated" and "Asked for:
   Conference". On a computer, the admin WYS guest list shows the new job title.
4. **Cancel it (1 min).** Tap "Cancel my request", then "Yes, cancel my request". The page
   says you cancelled it and offers "Send my request again". Do NOT tap it. In the admin, the
   request is gone from "Requests".
5. **The door (2 min).** On a door phone, signed in: open the WYS check-in page from the
   admin. It shows "x of y confirmed guests arrived". Type two letters of a real confirmed
   guest's name: they appear. Do not tap them (that would check them in; if it happens, tap
   the undo arrow).
6. **Nothing else moved (1 min).** In the admin guest list, copy one real confirmed guest's
   link (the copy icon "Copy personal link" on their row), open it and look only: same
   status, same QR. Do not tap anything on it.

If step 1, 2 or 5 fails, tell Claude at once: it is a rollback case (§4).

## 4. Rollback: switch the new form off

Either flag can go off alone. Off takes effect in a fresh tab at once and in open tabs
within 5 minutes; nothing is lost in between: a form sent from an old tab gets
`not_available` from `registration` and the page re-sends it to `guest-list` by itself.

```sql
update public.platform_settings
   set value = jsonb_set(value, '{wys_status_edit}', 'false'::jsonb, true), updated_at = now()
 where key = 'registration_flags' returning value;
update public.platform_settings
   set value = jsonb_set(value, '{wys_form_v2}', 'false'::jsonb, true), updated_at = now()
 where key = 'registration_flags' returning value;
```

After: `/wys26` sends requests to `guest-list` exactly as before day D; the personal page
loses only Edit / Cancel / Send again / Add to my account; links, QR codes, tokens, the pass
e-mails and the door do not change (same rows). "View my request" links already e-mailed
keep working (same personal page). The full-site rollback (runbook §8 step 6) turns both off
too. From 20 to 28 Nov this is the only WYS flag change allowed, and only if the form fails.

## 5. Checked on the mock (21 Oct)

Fictional data, flags as on day D (`webinar_v2` and `turnstile` off), phone and desktop:
request through the parity path, the e-mails it triggers, the personal page (edit, cancel,
send again, accept from `?answer=accept`, plus-one, pass QR, invalid link), the signed-in
form with the locked e-mail, the door (QR link signed out, sign in with password, admitted;
a request refused; name search), the admin approve (pass e-mail with the check-in link) and
the invitations page. Two client bugs were fixed in `GuestInvitationPage.tsx`:
- a request under review showed "Admission: —": it now shows what was asked for (or no row);
- "I can no longer attend" gave a confirmed place up in one tap (and stopped the QR), with no
  way back for a request-sourced guest: it now asks first.
