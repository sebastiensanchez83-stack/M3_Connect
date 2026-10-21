# Article comments: switching them on at go-live

> **Résumé en français.**
> 1. Les membres validés commentent sous les articles et taguent une personne ou une entreprise avec « @ ». Publié tout de suite ; M3 masque à tout moment ; chaque signalement envoie un e-mail à l'équipe M3.
> 2. Un tag prévient la personne (ou les propriétaires de l'entreprise) sur son tableau de bord (« À faire ») et par un e-mail immédiat, en anglais.
> 3. Rien n'est en production : une migration (avec sa répétition à blanc), trois fonctions à déployer, puis l'interrupteur `article_comments` à allumer le jour où la refonte devient le site.
> 4. L'ordre ci-dessous compte : base de données, puis fonctions, puis interrupteur.

Victor's decisions (21 Oct 2026): validated members comment under the articles of the
Resources library and tag a person or a company; comments are published at once (no
pre-moderation); M3 staff hide a comment at any time; every member can report a comment and
the M3 team gets an e-mail per report; a tagged person or company is told on the site and by
an immediate e-mail. Names of people are for validated members only: visitors and accounts M3
has not validated see the number of comments and a "Sign in" / "Your account is being
reviewed" panel.

## What is in the repository (nothing is live)

| Piece | File | State on 21 Oct 2026 |
|---|---|---|
| Database | `supabase/migrations/20261021130000_article_comments.sql` (down in `down/`) | not applied |
| Dry run | `supabase/dryrun/20261021130000_article_comments.dryrun.sql` | not run; expected `DRYRUN 52 PASS, 0 FAIL` |
| E-mails | `supabase/functions/send-notification` (types `comment_mention`, `comment_report`) | not deployed |
| Queue sender | `supabase/functions/registration-cron` (the two kinds in the outbox job) | not deployed |
| Unsubscribe | `supabase/functions/unsubscribe` (category `comments`) | not deployed |
| Site | branch `refonte`: `src/components/resources/ArticleComments.tsx`, the dashboard To do, Admin > Resources | preview only |

The database objects are additive: four tables only the new functions read and write
(`resource_comment`, `_mention`, `_report`, `_notice`), 23 functions, and two more kinds in
`notification_outbox`'s list (`comment_mention`, `comment_report`; the eight of Phase 3 are
kept). The live site never calls them. With the switch off every member function answers
`comments_off` and the public count answers null.

## Go-live, in this order

1. **Dry run** (one `execute_sql` call, the whole file). It must end with
   `DRYRUN 52 PASS, 0 FAIL`; any FAIL line: stop.
2. **Apply** the migration (`apply_migration`, name `article_comments`), then check:
   ```sql
   select to_regclass('public.resource_comment') is not null,
          (select count(*) from pg_proc where proname like '%resource_comment%') = 23;
   ```
3. **Deploy** `send-notification`, `unsubscribe` and `registration-cron`, with the rest of the
   go-live e-mail batch (follow the edge-function deploy gotcha: grep the files for a literal
   backslash followed by u first, compare the sha256, keep `verify_jwt` as it is: false for
   send-notification and unsubscribe, true for registration-cron). The two kinds wait in the
   queue, marked "held", while an older send-notification is live: nothing is lost.
4. **E-mail queue**: `outbox_sender` should be on (it is part of the same go-live). It is the
   safety net: the page asks send-notification right after a post or a report; whatever could
   not leave then (closed tab, more than 30 e-mails in an hour from one member) is sent by
   registration-cron's outbox job a few minutes later. Comment e-mails older than 72 hours are
   never sent late.
5. **Switch on** in Admin > Settings > Registration switches > "Comments under articles", or:
   ```sql
   update public.platform_settings
      set value = value || '{"article_comments": true}'::jsonb
    where key = 'registration_flags';
   ```
   Pages read the switches every five minutes: open tabs follow on their next read.
6. **Check** with two validated test accounts: post a comment under a public article tagging
   the other account and a company; the other account gets the e-mail and the To do line;
   report the comment from the other account; the M3 team gets "A comment was reported";
   hide it in Admin > Resources > Reported comments.

## Switching off

Turn the switch off (same place, or `value || '{"article_comments": false}'`). Nothing is
deleted: comments, tags and reports stay, unseen, until it is on again. Queued e-mails that
have not left stay queued (the page path refuses while off; the cron still sends what is
already queued: settle them by hand if needed).

To remove everything: the down file (`supabase/migrations/down/20261021130000_article_comments.down.sql`)
drops the functions, the tables (every comment is lost) and the comment rows of the e-mail
queue, and puts the queue's list of kinds back to the eight of Phase 3.

## The rules the database enforces

- Writing, tagging, reporting and reading with names: `profiles.access_status = 'verified'`
  (M3 staff read and moderate even with the switch off).
- Only under an article the reader may read (published, `can_access_resource`).
- 2000 characters, 5 tags, 10 comments an hour per member, 60 people told a day per author,
  20 reports a day per member, one report per member and comment.
- A tag must be a validated person, or a verified company that is not archived nor merged;
  its name is rewritten from the database. Anything else becomes plain text.
- A company tag tells up to 3 of its owners (`organization_members.role = 'owner'` or the
  company's `owner_user_id`), or up to 3 of its validated members when it has no owner.
- Never the author; one notice and one e-mail per person and comment; only people who may
  read the article.
- Edit: any time, marked "edited", not once hidden. Delete: by the author, the text is erased
  at once (the empty row stays for the limits and M3's report list).
- E-mail preferences: tags are the category "comments" (members can turn them off in their
  e-mail preferences and with the unsubscribe link); reports go to M3 staff under "admin".

## Open points (for Victor)

- A company with no owner has its validated members told (3 at most). Say if only owners
  should be.
- Members-only and marina-only articles: the people who can open them are told; today every
  article is public.
- No replies to a comment yet (a flat discussion, oldest first), no reactions, no edit history.
