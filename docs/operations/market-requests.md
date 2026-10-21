# Marina requests: one admin screen, and the e-mail to the requester

> **Résumé en français.**
> 1. Admin > Marketplace > « Marina requests » remplace les 4 écrans (projets, RFP, consultations, leads) : une seule liste (filtres, recherche, export CSV, cartes sur téléphone, « en attente de réponse » en premier) et une page par demande où M3 agit : changer le statut avec un message (ou la raison d'un refus), corriger le texte, ajouter une note interne. Tout est tracé dans l'historique de la demande.
> 2. L'auteur de la demande (son compte, jamais une autre adresse) reçoit un e-mail court en anglais quand sa demande est publiée (un projet : approuvé, car un projet n'est jamais montré aux autres membres), refusée (avec la raison), clôturée, ou quand un projet est terminé. M3 voit l'e-mail avant de l'envoyer et peut décocher « Tell them by e-mail ». Jamais d'e-mail pour une correction de texte ni pour une note.
> 3. Les leads partenaires (formulaire public « devenir partenaire », sans compte) ne reçoivent aucun e-mail automatique : ce sont des contacts commerciaux, M3 leur répond en personne (bouton « Write to … »).
> 4. Avant le jour J, aucun e-mail n'est mis en file (l'interrupteur `outbox_sender` est éteint) : rien ne part plus tard non plus. Le jour J : migration appliquée, `send-notification` et `registration-cron` déployés avec le lot D2, puis `outbox_sender` allumé.
> 5. Les anciennes adresses (/admin/rfps, /admin/projects, …, et leurs /:id) restent valables : elles ouvrent la nouvelle page.

## What is in the repository (nothing is live on 21 Oct 2026)

| Piece | File | State |
|---|---|---|
| Database | `supabase/migrations/20261021175000_market_requests.sql` (down in `down/`) | not applied |
| Dry run | `supabase/dryrun/20261021175000_market_requests.dryrun.sql` | not run; expected `DRYRUN 27 PASS, 0 FAIL` |
| E-mail | `supabase/functions/send-notification` (type `market_request_status`, `sendMarketRequestEmails`) | not deployed (D2 batch) |
| Queue sender | `supabase/functions/registration-cron` (route `market_request_status` -> send-notification, never sent after 72 h) | not deployed (D2 batch) |
| Admin pages | `src/components/admin/v2/market/` (`RequestsPage`, `RequestDetailPage`) and the 8 old screens, now redirects | branch `refonte` once merged |
| Previews | `node scripts/email-previews.mjs` renders `notif-m1` to `notif-m6` | |
| Test | `node tests/market-email.test.mjs` (the page's preview = the real e-mail; the statuses = the database's) | |

## The database (additive; branch `main` never names these objects)

- `notification_outbox` accepts one more kind: `market_request_status`.
- `review_log` accepts one more `subject_type`: `market_request` (actions `request_status`,
  `request_edited`, `request_note`). This is the history shown on each request page.
- Three staff functions (verified admins and moderators, `public.is_moderator()`), one per action:
  `admin_market_request_set_status(kind, id, status, message, notify)`,
  `admin_market_request_edit(kind, id, changes)`, `admin_market_request_note(kind, id, note)`.
- `market_request_email(outbox id)`: every word of one queued e-mail, for send-notification only
  (service_role).
- Main's old admin screens keep writing the four tables directly (their staff policies are
  untouched); a status changed there makes a queued e-mail "out of date", so it is never sent.

## The e-mail rules

- To the request's author account only (`rfps.marina_user_id`, `consultations.marina_user_id`,
  `marina_projects.user_id`), read from the request, never given by the page; never to a
  suspended account.
- RFPs and consultations: published (`approved`), not published (`rejected`, the reason is
  required: the requester also reads it on their account page), `closed`. Marina projects:
  `approved` (the e-mail says "approved", never "published": `marina_projects` is read by its
  author and M3 only), `rejected`, `completed`. Nothing for the other statuses, nothing for
  partner leads.
- **Who else reads the reason.** `rfps` and `consultations` are readable, every row and every
  column, by every member with marketplace access and by verified developers (their read
  policies, unchanged here). So `rejection_reason` and the old `admin_notes` are NOT private:
  the page says so ("write nothing confidential"), and the status function clears
  `rejection_reason` on any status other than `rejected` (the reason stays in the history).
  Follow-up (separate reviewed migration): a restrictive read policy on both tables,
  `status = 'approved' or own row or is_moderator()`.
- Before go-live (`outbox_sender` off) a change is logged `sender_off` and the page sends
  `notify` false whatever the box says: nothing the page called "a note for the history" can be
  e-mailed if the switch is turned on while the page is open.
- A requester who turned off the "submissions" e-mails: the queued row is settled unsent ("not
  sent: the requester turned these e-mails off"), so the history never says "E-mail sent".
- One e-mail per status change (`dedupe_key` `market_request_status:<review_log id>`). A newer
  change of the same request settles the older e-mail that has not left; an e-mail whose request
  changed status again, was deleted, or waited more than 72 hours is never sent.
- Filed under the e-mail preference "submissions" (as the old RFP and consultation e-mails), with
  the personal unsubscribe link. The requester's title shows "[link]" instead of a web address.
- The page asks send-notification to send it at once; registration-cron's outbox job sends what
  is left a few minutes later.

## Go-live day (with the D2 e-mail batch), in this order

1. **Dry run** (one `execute_sql` call, the whole file): it must end with
   `DRYRUN 27 PASS, 0 FAIL`. C17 (suspended requester) and C24 (the requester's own edit) say
   "skipped" when no such account exists: that counts as a pass.
2. **Apply** the migration (`apply_migration`, name `market_requests`), then check:
   ```sql
   select count(*) from pg_proc where proname like '%market_request%';   -- 8
   ```
3. **Deploy** `send-notification` and `registration-cron` with the rest of the D2 batch (grep for
   a literal backslash followed by u first, compare the sha256, keep `verify_jwt`: false for
   send-notification, true for registration-cron).
4. `outbox_sender` on (part of the same go-live). From then on, a status change queues the e-mail.
5. **Check** with a test request of a test account: publish it from Admin > Marina requests; the
   history says "E-mail sent"; the test inbox has "Your request for proposals is published".

Until step 4, the page says "E-mails to members start at go-live: this change will NOT be
e-mailed" and the history keeps "No e-mail: e-mails to members start at go-live".

## Removing it

The down file drops the eight functions, deletes the `market_request_status` rows of the e-mail
queue and the `market_request` rows of `review_log` (the history of the requests: export it
first if it matters), and puts both lists back. The statuses and corrected texts stay.
