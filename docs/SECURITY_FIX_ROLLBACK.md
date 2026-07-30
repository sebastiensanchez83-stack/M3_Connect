# Rolling back the 29 July security fixes

Every change made during the pre-event security pass, with the exact statement
that undoes it. Written so that anyone — not only the person who made the
change — can put the platform back the way it was without guessing.

Each undo restores the **original** state, not an approximation: the previous
policy body and grant shape were read out of the live database before being
replaced, and are reproduced verbatim below.

---

## 1. Database grants and policies

All four migrations are privilege changes or a single policy. None of them
altered any participant data, so undoing them cannot lose anything.

### `sec_revoke_public_execute_internal_functions`
Closed `provision_tier_entitlements`, `sync_org_entitlements` and
`compute_pulse_snapshot` to anonymous callers.

**Undo** (restores the PostgreSQL default, which is what was there before):
```sql
grant execute on function public.provision_tier_entitlements(uuid, text) to public;
grant execute on function public.sync_org_entitlements(uuid, text) to public;
grant execute on function public.compute_pulse_snapshot() to public;
```

*Symptom that would justify this:* organisation creation or tier changes stop
provisioning entitlements, or the admin Pulse screen returns a permission error.
Neither appeared in testing — org creation was verified to still provision its
four entitlement rows.

### `sec_event_partner_media_exclude_invoices`
Stopped Yacht Club / Yachting Ventures accounts reading `invoices/`.

**Undo** (the policy exactly as it was):
```sql
drop policy if exists sm_event_partner_read_media on storage.objects;
create policy sm_event_partner_read_media on storage.objects
for select to authenticated
using (
  bucket_id = 'event-media'
  and exists (select 1 from sm_event_partner ep where ep.user_id = auth.uid())
  and name not like 'architecture-pack/%'
  and not exists (select 1 from sm_architecture_file f where f.file_path = storage.objects.name)
);
```

*Symptom:* the Yacht Club console cannot open a file it needs. Verified after the
change that they still see 41 e-catalogue files and 570 objects in total, so this
should not occur — but if a specific file 404s for them, this is the undo.

### `sec_hide_claim_codes_from_anon` and `..._column_grants`
Stopped anonymous visitors reading organisation claim codes.

**Undo** (a table-level grant supersedes the column grants, restoring the old
behaviour in one statement):
```sql
grant select on public.organizations to anon;
```

*Symptom:* a public page shows no organisations, or the partners page is empty.
Verified after the change that anonymous callers still see 233 verified
organisations and both partners.

The empty `org_claim_attempt` table created alongside is unused; drop it if you
want the schema clean:
```sql
drop table if exists public.org_claim_attempt;
```

---

## 2. Edge functions

Supabase keeps every deployed version. Rolling one back means redeploying the
previous source, not clicking a button — so the substantive change is recorded
here in case it must be reversed by hand.

### `claim-code-signup` (v8 → v9)
One line changed. v9 creates the account **unconfirmed**:

```ts
email_confirm: false,   // v9 (current)
email_confirm: true,    // v8 (previous)
```

*Effect of the change:* someone signing up with a claim code now receives the
normal confirmation email and must click it before they can log in.
*Effect of reverting:* signup is instant again — and so is creating a working
account under somebody else's email address, which is the hole this closed.

### Others touched on 28–29 July
`sm26-register` v13, `sm26-media-kit` v7, `sm26-jury-session` v9,
`sm26-provision` v6. Each is described in its commit message; none changed an
email template's wording, only when and to whom it is sent.

---

## 3. Frontend

Every change is a separate commit on `main`, so any one can be undone without
touching the others:

```bash
git revert <sha>
git push origin main
```

Netlify rebuilds automatically. The commits from this pass, newest first:

| sha | What it changed |
|---|---|
| `a493f45f` | Follow-up emails from a selection |
| `535d5c51` | Partners page lists by tier, not company type |
| `100253cc` | Country list gains Hong Kong + 20 territories |
| `2943446d` | Jury sessions stay in step with panel and batch |
| `4e1cffaf` | Jury invitations in Monaco time |
| `91b13adf` | Jury invitation sent as a meeting request |
| `452dbd27` | Jury previews leave no trace; invitation layout |
| `0cbe7506` | Registration honeypot; media-kit tracker; console filters |

---

## 4. What these undos do NOT cover

Data corrections are already committed and cannot be reversed by a grant or a
`git revert`. They would need a point-in-time restore, or reversing by hand.
**Confirm in the Supabase dashboard whether PITR is enabled on this project** —
it is an add-on and could not be established from the API.

Recorded here so each can be reversed manually if ever needed:

- **Media kits** — `notified_at` backfilled on 6 registrations from `sm_email_log`
  (Faber, SPPC Cap d'Ail, SMBL, BioBright, ARIDDITIVE, Blue Parameters).
- **Jury session `JG1 x SG1`** — put back to draft after a preview wrongly marked
  it sent; its Zoom fields were cleared and one stray `invited_at` removed. The
  Zoom meeting `82360201544` created by that preview still exists on the Zoom
  account and should be deleted there.
- **Jury rosters** — 2 stale startup entries removed (GO BRIDGE THE GAP on the two
  SG6 sessions), 9 missing juror seats added.
- **Sponsors** — the empty duplicate `Airport Authority Hong Kong` record was
  deleted after moving its single contact link to the record holding the
  agreement. **This is the only deletion in the whole pass.** It carried no
  agreement, no brand asset and no deliverable.
- **Countries** — two registrations normalised to `Hong Kong` (Carrie Ng, from
  `China`; Eric Ho, from `Hong Kong, China`) and the Airport Authority Hong Kong
  organisation likewise.

---

## 5. Later changes (30 July)

### `sm26-badge-email` (v2 → v3)
The entry QR is now generated on the server and attached to the message
(`cid:entryqr`) instead of being hotlinked from `api.qrserver.com`, the token is
printed as a text fallback, every send is written to `sm_email_log` with kind
`entry_qr`, and a send is skipped if that address already has one (pass
`resend: true` to override).

*Undo:* redeploy v2, whose QR line was:
```ts
const qr = `https://api.qrserver.com/v1/create-qr-code/?size=280x280&margin=10&data=${encodeURIComponent(checkinUrl)}`;
```
Reverting reintroduces the third-party dependency and loses the send log.

### `sm26-badge-email` (v3 → v4)
The repo copy, which had been two versions behind, is back in step with what is
deployed — so `supabase/functions/sm26-badge-email/index.ts` can be trusted
again. The only behaviour change is the QR image itself: rendered at 600px
instead of 480, in black instead of the brand navy. Nothing about who is
emailed, when, or what the message says.

*Undo:* set `width: 480` and `dark: "#0b2653ff"` in `qrPngBase64` and redeploy.
Passes already sent stay valid either way — the token is unchanged.

### Triggers added 30 July
```sql
drop trigger if exists sm_architecture_onsite_sync on public.sm_architecture_entry;
drop trigger if exists sm_registration_withdrawal on public.sm_registration;
```
Dropping either only stops future syncing; no data is altered by the drop.
