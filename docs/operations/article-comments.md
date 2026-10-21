# Article comments: trying them on the preview, then go-live

> **Résumé en français.**
> 1. Les membres validés commentent sous les articles et taguent une personne ou une entreprise avec « @ ». Publié tout de suite ; M3 masque à tout moment ; chaque membre peut signaler un commentaire.
> 2. Deux interrupteurs : `article_comments` (les commentaires, à allumer dès que la migration est appliquée, pour que les membres validés les essaient sur la préprod) et `article_comment_emails` (les e-mails, le jour J seulement). Tant que le second est éteint, un tag ou un signalement prévient sur le site uniquement (« À faire » du tableau de bord, Admin > Resources > Reported comments) et **aucun e-mail n'est mis en file** : rien ne peut partir plus tard.
> 3. Le jour J : supprimer tous les commentaires de test, déployer les trois fonctions, allumer `outbox_sender`, puis `article_comment_emails`.
> 4. Sur ordinateur, les commentaires sont dans la colonne de droite, sous « Authors », et restent à l'écran pendant la lecture ; sur téléphone, sous l'article.

Victor's decisions (21 Oct 2026): validated members comment under the articles of the
Resources library and tag a person or a company; comments are published at once (no
pre-moderation); M3 staff hide a comment at any time; every member can report a comment and
the M3 team gets an e-mail per report; a tagged person or company is told on the site and by
an immediate e-mail. Names of people are for validated members only: visitors and accounts M3
has not validated see the number of comments and a "Sign in" / "Your account is being
reviewed" panel. Members try the comments on the preview before go-live, with no e-mail at all
until go-live.

## The two switches (`platform_settings.registration_flags`, JSON `true` only; missing = off)

| Key | What it does | When to turn it on |
|---|---|---|
| `article_comments` | The comments: the section on the article pages of the redesign, the dashboard To do line "You were tagged in a comment", Admin > Resources > Reported comments. Off: nothing shows and every member function of the database answers `comments_off`. The live site (branch `main`) has no comment code: it shows nothing either way. | Once the migration is applied, for validated members to try comments on the preview. |
| `article_comment_emails` | The e-mails: the tagged person (or up to 3 owners of a tagged company) and the M3 team for each report. Off: tags and reports are told **on the site only**, and the database writes **no row** in `notification_outbox` (nothing waits to be sent at go-live). Turning it off later also stops what is queued: those e-mails are settled unsent. The pages say "they will see it on their dashboard" instead of "by e-mail", and the e-mail preferences hide "Comments". | Go-live day only, after the steps below. |

Both are in Admin > Settings > Registration switches > "Articles and comments", or:

```sql
update public.platform_settings
   set value = value || '{"article_comments": true}'::jsonb      -- or "article_comment_emails"
 where key = 'registration_flags';
```

Pages read the switches every five minutes: open tabs follow on their next read.

## What is in the repository (nothing is live)

| Piece | File | State on 21 Oct 2026 |
|---|---|---|
| Database | `supabase/migrations/20261021130000_article_comments.sql` (down in `down/`) | not applied |
| Dry run | `supabase/dryrun/20261021130000_article_comments.dryrun.sql` | not run; expected `DRYRUN 62 PASS, 0 FAIL` |
| E-mails | `supabase/functions/send-notification` (types `comment_mention`, `comment_report`) | not deployed (go-live) |
| Queue sender | `supabase/functions/registration-cron` (the two kinds in the outbox job) | not deployed (go-live) |
| Unsubscribe | `supabase/functions/unsubscribe` (category `comments`) | not deployed (go-live) |
| Site | branch `refonte`: `src/components/resources/ArticleComments.tsx`, the dashboard To do, Admin > Resources | preview only |

The database objects are additive: four tables only the new functions read and write
(`resource_comment`, `_mention`, `_report`, `_notice`), 24 functions, and two more kinds in
`notification_outbox`'s list (`comment_mention`, `comment_report`; the eight of Phase 3 are
kept). The live site never calls them.

## Step 1, now: members try the comments on the preview (no e-mail)

1. **Dry run** (one `execute_sql` call, the whole file). It must end with
   `DRYRUN 62 PASS, 0 FAIL`; any FAIL line: stop. C57 and E4 compare live tables with a snapshot
   taken at the start of the run: a member signing up or saving their profile meanwhile makes
   them fail without a defect. A FAIL on C57 or E4 alone: run it again.
2. **Apply** the migration (`apply_migration`, name `article_comments`), then check:
   ```sql
   select to_regclass('public.resource_comment') is not null,
          (select count(*) from pg_proc where proname like '%resource_comment%') = 24;
   ```
3. **Switch on `article_comments` only.** Deploy no function, leave `article_comment_emails`
   missing.
4. **Check** with two validated accounts on the preview: post under a public article tagging
   the other account; the other account sees "You were tagged in a comment" on its dashboard;
   report it from the other account; it shows in Admin > Resources > Reported comments. And no
   e-mail was queued:
   ```sql
   select count(*) from public.notification_outbox where kind in ('comment_mention', 'comment_report');  -- 0
   ```

## Step 2, go-live day (around 4-5 Nov), in this order

1. **Delete every test comment** (the comments, their tags, reports and dashboard notices go
   with them):
   ```sql
   select count(*) from public.resource_comment;                        -- what goes
   delete from public.resource_comment;                                 -- cascades to _mention, _report, _notice
   select count(*) from public.notification_outbox
    where kind in ('comment_mention', 'comment_report');                -- must be 0 (no e-mail while the switch was off)
   ```
   If that last count is not 0, something queued e-mails meanwhile: settle them unsent before
   going on (`update public.notification_outbox set sent_at = now(), last_error = 'not sent:
   test comment' where kind in ('comment_mention', 'comment_report') and sent_at is null`).
2. **Deploy** `send-notification`, `unsubscribe` and `registration-cron` together, with the rest
   of the go-live e-mail batch (follow the edge-function deploy gotcha: grep the files for a
   literal backslash followed by u first, compare the sha256, keep `verify_jwt` as it is: false
   for send-notification and unsubscribe, true for registration-cron). With `unsubscribe` left on
   its old version, a comment e-mail's unsubscribe link would turn off every optional e-mail.
3. **`outbox_sender` on** (part of the same go-live). It is the safety net: the page asks
   send-notification right after a post or a report; whatever could not leave then (closed tab,
   more than 30 e-mails in an hour from one member) is sent by registration-cron's outbox job a
   few minutes later. Comment e-mails older than 72 hours are never sent late.
4. **`article_comment_emails` on** (`article_comments` stays on).
5. **Check** with two validated test accounts: tag the other account and a company; the other
   account gets the e-mail and the To do line; report the comment from the other account; the
   M3 team gets "A comment was reported"; hide it in Admin > Resources > Reported comments. Then
   delete those test comments with their "Delete" button.

## Switching off

- **E-mails only** (`article_comment_emails` off): comments go on; tags and reports are told on
  the site only; e-mails already queued are not sent (the database answers "out of date" and
  send-notification or the cron settles them unsent).
- **Everything** (`article_comments` off): nothing about comments shows, and queued e-mails are
  not sent either. Comments, tags and reports are kept, unseen, until it is on again.
- **Remove everything**: the down file
  (`supabase/migrations/down/20261021130000_article_comments.down.sql`) takes out both switches,
  drops the functions, the tables (every comment is lost) and the comment rows of the e-mail
  queue, and puts the queue's list of kinds back to the eight of Phase 3.

## The rules the database enforces

- Writing, tagging, reporting and reading with names: `profiles.access_status = 'verified'`
  (M3 staff read and moderate even with the switch off).
- Only under an article the reader may read (published, `can_access_resource`).
- 2000 characters, 5 tags, 10 comments an hour per member, 20 reports a day per member, one
  report per member and comment.
- 60 people told a day per author: every notice made in the last 24 hours counts, including
  those withdrawn by an edit or a delete, so neither makes room for more. At most one e-mail a
  day from the same author to the same person (the next tags are told on the site only).
- A tag must be a validated person, or a verified company that is not archived nor merged;
  its name is rewritten from the database. Anything else becomes plain text. The text is
  checked again until nothing changes, so a tag hidden inside another is checked too.
- A company tag tells up to 3 of its owners (`organization_members.role = 'owner'` or the
  company's `owner_user_id`), or up to 3 of its validated members when it has no owner.
- Never the author; one notice per person and comment, ever (a tag removed then put back
  brings the same notice back, with no new e-mail); only people who may read the article (an
  article made members-only later: queued e-mails and dashboard lines stop for those who can no
  longer open it).
- A report keeps a copy of the text as it was (M3 sees it in the reported comments, and the
  report e-mail quotes it). While a report is open, its author cannot edit the comment
  (`comment_under_review`); they can still delete it.
- Edit: any time, marked "edited", not once hidden, not while reported. Delete: by the author,
  the text is erased at once for everyone (the empty row stays for the limits and M3's report
  list; the reports keep their copy).
- In e-mails, a web address typed in a comment or a report reason shows as "[link]" (mail
  programs would make it clickable inside the platform's own e-mail).
- E-mail preferences: tags are the category "comments" (members can turn them off in their
  e-mail preferences and with the unsubscribe link); reports go to M3 staff under "admin".

## Open points (for Victor)

- **Reported text kept after a delete.** A deleted comment disappears for everyone at once, but
  each report on it keeps a copy for M3 (the evidence a tagged person may already have received
  by e-mail). Say if it should be erased too.
- A company with no owner has its validated members told (3 at most). Say if only owners
  should be.
- Members-only and marina-only articles: the people who can open them are told; today every
  article is public.
- Individuals as companies named after the person (Victor, 21 Oct): nothing in the comments
  stops it (they would be taggable and linked like any company), but the database accepts only
  five company types today, and company names are readable by signed-out visitors, unlike
  people's names.
- No replies to a comment yet (a flat discussion, oldest first), no reactions, no edit history.
