# Smart Marina Connect service e-mails: design system

Every e-mail the platform sends through Resend (sign-up, password reset, invitations,
notifications, guest-list and webinar mails...) uses one frame, the same as the Mailchimp
welcome e-mail. Newsletters are different: they are sent by Mailchimp, not by this code.

Code: the block between `// ---- SMC e-mail layout v1 ...` and `// ---- end SMC e-mail layout ----`
in [docs/email-layout.ts](email-layout.ts) (reference copy, never imported). Supabase edge
functions deployed through the MCP must be self-contained, so the block is **pasted, byte for byte,
into every function that sends an e-mail**. Change the reference first, then copy it.

```
node scripts/email-previews.mjs            # render ~20 sample e-mails (real code, fictional data) + run the checks
node scripts/email-previews.mjs --check    # checks only: every copy of the block identical to the reference,
                                           # no backslash-u escape, links, escaping, text part
```

The previews go to `Design/Propositions SMC/E-mails` in the Dropbox folder (or the folder given as
argument, or `EMAIL_PREVIEW_DIR`). Open `index.html` there.

## Frame

| Part | Value |
| --- | --- |
| Page | `#eef2f8`, 32 px / 12 px padding |
| Card | white, 600 px (fluid below 620 px), 16 px radius |
| Header band | navy `#0b2653`, white S logo (`https://smartmarinaconnect.com/logo-white.png`, 22 px) + "Smart Marina Connect" wordmark, Arial 18 px bold |
| Rule | 4 px gold `#d7a647` |
| Content | 40 px side padding (24 px on mobile): eyebrow, title, greeting, body, button, note |
| Footer | light `#f6f7f9`: "Smart Marina Connect · by M3 Monaco", "Questions? events@m3monaco.com", link to smartmarinaconnect.com |

Service e-mails have **no marketing unsubscribe** in the footer. Only `send-notification` adds
"Manage preferences / Unsubscribe / Contact" under the footer (its per-category opt-outs and its
`List-Unsubscribe` header predate this design and stay). Since 8 Oct 2026 its "Unsubscribe" link is
`/unsubscribe?t=<signed token>` (account + notification category) and `List-Unsubscribe` points at
the `unsubscribe` edge function, which takes the RFC 8058 one-click POST; the contract is at the top
of `supabase/functions/unsubscribe/index.ts`. An e-mail to several people (the B2B introduction) or
to an address that is not the account's own gets the plain `/unsubscribe` page instead.

## Tokens (`EM`)

| Token | Hex | Use |
| --- | --- | --- |
| `navy` | `#0b2653` | header band, titles, button text, links |
| `gold` | `#d7a647` | rule, button, note left border |
| `teal` | `#1f7a8c` | eyebrows and labels in small capitals, bullets |
| `ink` | `#1f2937` | body text |
| `muted` | `#5b6475` | small notes, footer |
| `line` | `#e3e7ee` | hairlines |
| `page` / `soft` | `#eef2f8` / `#f6f7f9` | page background / footer, notes, code box |

Font: Arial, Helvetica, sans-serif. Body 16/25, small notes 14/21, footer 12/18, eyebrow 12 bold
capitals with 1 px letter spacing, title 26/32 bold (23/29 on mobile).

## Components

| Function | What it gives |
| --- | --- |
| `emailLayout({ preheader, eyebrow, title, greeting, bodyHtml, cta, secondary, signoff, footerNote, reason, footerLinks, lang, pageTitle })` | the whole document |
| `emButton(label, url)` | gold pill, navy bold text, arrow added |
| `emLink(label, url)` | bold underlined navy link (secondary action) |
| `emP(html, gap?)` | one body paragraph |
| `emInfoTable([[label, value], ...])` | label / value rows between hairlines (label in teal capitals) |
| `emNote(html, label?)` | pale box with a gold left rule (a reason, a quoted message) |
| `emCode(code)` | a code to read or type, monospace, in a bordered box |
| `emTextToHtml(safeText)` | text body to paragraphs (see below) |
| `emText({ title, greeting, body, cta, secondary, signoff, footerNote, reason, links })` | the plain-text alternative |
| `emEsc(s)` / `emStripTags(s)` | escaping / tag removal |

`cta.showUrl` prints the link under the button ("If the button does not work, copy this link...").
The auth e-mails use it; notifications do not.

### What goes in `emTextToHtml`

Blank line = new paragraph, line break = `<br>`. Three conventions, everything else is a paragraph:

- lines starting with `• ` become a bullet list;
- a paragraph starting with `Reason:`, `Feedback:`, `Message:`, `Moderator notes:` or
  `Reason provided by our team:` becomes a note box (the label is lifted into the box header);
- trailing lines `Date:`, `Location:`, `Payment type:`, `Transaction ID:`, `Organization:`,
  `Deadline:` become an info table.

`<strong>` in a template is tinted navy. The templates themselves stay plain text, so adding a
notification type needs no HTML.

## Rules

1. **Design only.** Links, tokens, codes, QR images, subjects, recipients, conditions and data fields
   are never touched when a template is restyled.
2. **Escape first.** Every string given to the layout as HTML must already be HTML-safe (`emEsc`).
   Only trusted template markup (`<strong>`, `<br>`, entities) may stay raw. `emText` takes plain text
   (call `emStripTags` on a body that carries tags).
3. **English only.** No patronage wording; "partners" are paying sponsors only, everyone else is a member.
4. **Reply-to is `events@m3monaco.com`** on every transactional e-mail. The sender address stays as it is
   (`SENDER_EMAIL`, `noreply@smartmarinaconnect.com` by default).
5. **Always send a text part** next to the HTML, built with `emText`, with the same link.
6. **No backslash-u escapes in an edge function.** The MCP `deploy_edge_function` doubles them and broke
   `send-email` for 8 minutes on 6 Oct 2026. Use entities (`&zwnj;`, `&middot;`) or the real character.
   `--check` fails if one appears in a function that carries the block.
7. **Light only.** The page declares `color-scheme: light`, every cell has a `bgcolor` and an explicit text
   colour, so clients that force a dark theme keep the contrast. The only dark area is the brand band;
   the wordmark next to the logo stays readable if the logo is recoloured.
8. **Tables and inline styles only** (Outlook). Rounded corners and `max-width` are progressive: square
   and 600 px fixed in Outlook desktop. Keep the whole message under 100 KB (Gmail clips above).
9. **No secrets and no real personal data** in templates, samples or previews (the repo is public).

## Adding the layout to another function

1. Paste the block from `docs/email-layout.ts` above the template code. It has no import and no Deno API.
2. Build the body with `emP` / `emTextToHtml` / `emInfoTable` / `emNote` / `emCode`, escape the values,
   call `emailLayout({...})`, and put `reply_to: EM.contact` and `text: emText({...})` in the Resend payload.
3. `node scripts/email-previews.mjs --check`. To get the function into the previews, add a sample in the script.
4. Deploy (agent, not by hand): grep the file for a literal backslash-u, pass it byte for byte, set `verify_jwt`
   explicitly to **the value the function has today**: read it with `list_edge_functions` right before the deploy and
   copy it, never take it from this doc (the MCP defaults to true, and an anonymous endpoint opened by mistake, or a
   webhook closed by mistake, is a silent outage). Values on 8 Oct 2026, for reference only: `false` for `send-email`,
   `send-notification`, `claim-code-signup`, `send-status-notification`, `send-reference-email`, `contact-submit`,
   `guest-list`, `guest-webinar-register` and `newsletter-subscribe`; `true` for `guest-webinar-reminders` (cron),
   `sp-notify` and `sponsor-invite`. Then compare `get_edge_function` with the local file by sha256.

## Resend senders (outside SM26, which is frozen)

Every one of them is on the shared layout (11 functions, `node scripts/email-previews.mjs --check` verifies the block):

| Function | E-mails | Reply-to |
| --- | --- | --- |
| `send-email` | Auth hook: signup, recovery, magiclink, invite, email_change, reauthentication, generic action link/code | `events@m3monaco.com` |
| `send-notification` | the 44 notification types (also used by `notify-admins`, `send-profile-reminders` and `payment-ipn`, which send nothing themselves) | `events@m3monaco.com` |
| `claim-code-signup` | confirm the e-mail address of a claim-code account (EN copy, FR copy kept) | `events@m3monaco.com` |
| `send-status-notification` | account approved / application not approved (with reason) / suspended | `events@m3monaco.com` |
| `send-reference-email` | client recommendation to confirm (two links: confirm, do not confirm) | `events@m3monaco.com` |
| `sponsor-invite` | sponsorship portal ready (magic link) | `events@m3monaco.com` |
| `sp-notify` | sponsor asset needed | `events@m3monaco.com` |
| `guest-webinar-register` | webinar registration confirmation (.ics attached) | `events@m3monaco.com` |
| `guest-webinar-reminders` | day-before webinar reminder (.ics attached) | `events@m3monaco.com` |
| `guest-list` | World Yachting Summit: invitation (accept / decline), confirmation with entry QR, request received, request declined, staff notification | `events@m3monaco.com`, like the footer (the admin's `settings.contact_email` field is no longer read) |
| `contact-submit` | contact form alert to the M3 inbox | the visitor's address (so a reply goes to the sender), never `events@` |

Notes for the next change:

- `guest-list`: the entry QR is an attachment (`content_id: "entryqr"`, plus the same image as `entry-pass.png`) and the HTML
  points at `cid:entryqr`. Keep both; `--check` fails if either goes. The previews draw the QR inline with the local `qrcode`
  package only so it shows in a browser. The sender name stays the event title.
- `claim-code-signup`: the copy-this-link line and the "ignore this e-mail" line sit in the footer note (they come from the
  EN/FR copy), not from the layout's `showUrl`, so the FR copy keeps working if it is ever switched back on.
- `send-reference-email`: the section titles (1., 2., 3.) are a local helper (`refHeading`), the layout block is untouched.
  The privacy paragraph still names `contact@smartmarinaconnect.com` (its original wording, kept on purpose because this change is
  design only), while the footer and the reply-to are `events@m3monaco.com`. To unify, change the `contact` constant in
  `buildReferenceEmail` once Victor has confirmed which inbox clients should write to.
  The two answers are the gold button (confirm) and the underlined link (do not confirm); both URLs and their tokens are unchanged.
- Each e-mail is built by a pure function (no I/O), so the previews run the real code: `buildInviteEmail` (sponsor-invite),
  `buildAssetNeededEmail` (sp-notify), `buildReminderEmail`, `buildConfirmationEmail` (webinar and claim-code), `renderStatusEmail`,
  `buildReferenceEmail`, `renderInboxEmail` (contact-submit), `renderPass` / `renderInvitation` / `renderRequestAck` / `renderReject` /
  `renderStaffNotice` (guest-list).
