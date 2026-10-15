# World Yachting Summit, Dubai, 27 November 2026: runbook

> **Résumé en français.**
> 1. Ce document dit, jour par jour jusqu'au 28 novembre, qui fait quoi pour les invités du WYS sur la plateforme, et comment tenir la porte le 27 (répétition le 18 sur l'événement test caché).
> 2. Avant le 13 nov : un compte admin testé sur chaque téléphone de porte, plus un téléphone de secours ; téléphone perdu : rétrograder son compte depuis l'ordinateur (Admin > Users).
> 3. Confirmer un invité envoie tout de suite l'e-mail avec le QR ; le 2e e-mail « choisissez votre mot de passe » ne part que si l'interrupteur « provisioning » est allumé.
> 4. À la porte : scanner, lire la couleur ET la ligne « Access » ; au gala l'écran orange est normal, mais sans « Gala dinner » l'invité va voir le responsable ; ne jamais toucher « In » dans la recherche (cela annule l'entrée).
> 5. Réseau ou plateforme en panne : liste papier (noms seulement) ; du 20 au 28 novembre on ne touche à rien, ni réglages ni code du site (liste en fin de document).

Written for the M3 team, no technical knowledge needed. Words in **bold** are what you see on
screen. Times are **Dubai time** (UTC+4) unless said otherwise.

On 15 Oct the live site is the current design. The redesign goes live before 13 Nov or after
28 Nov, never in between; where the two differ, both are described.

## The three pages

| Page | Address | Who |
|---|---|---|
| Public request page | `smartmarinaconnect.com/wys26` | anyone (guests ask for an invitation) |
| Guest list (staff) | `smartmarinaconnect.com/admin/guest-list/wys26` | **admin accounts only** |
| Door check-in (staff) | `smartmarinaconnect.com/admin/guest-list/wys26/checkin` | admin or moderator accounts |

Never send a staff address to a guest. Never change these addresses: every QR code already
e-mailed points at the door page.

## Roles

| Role | Who | Does |
|---|---|---|
| Event lead | Victor | Decides: over capacity, walk-ins, unannounced companions, closing requests, re-admitting someone who declined or was refused. The only one who changes a setting. |
| Guest-list manager | `<NAME>` (admin account) | Reviews requests every day, approves or refuses, invites, resends passes, exports the list. |
| Door lead | `<NAME>` (admin account, laptop, spare phone) | Runs the entrance, solves every red screen, holds the paper list, the laptop with the guest list and the spare phone. |
| Door staff | `<NAMES>` (2 to 3 per entrance, each with an account and a phone) | Scan, search a name, admit. Send every problem to the door lead. |
| Technical contact | `<NAME>` (on call 26 to 27 Nov) | Platform problems only. |

**Accounts.** Every door phone needs its own verified staff account, created and tested before
13 Nov, plus **one spare phone** signed in to another staff account, kept by the door lead.
The person signs up on the platform first; then Victor, on the laptop: **Admin > Users** > their
account > **Persona / Role** > **Admin** (or **Moderator**) > **Save**. A moderator account
opens the door page but not the guest list (which shows e-mails and phone numbers): the better
choice for door staff who only scan. The guest-list manager and the door lead need **Admin**.

## Timeline

| When | What | Who |
|---|---|---|
| **From now** (8 requests already waiting on 15 Oct) | Daily: open the guest list, tab **Requests**, approve or refuse. Read the message at the bottom of the screen **straight away**: it disappears after about 5 seconds and the next message replaces it. **"… N email(s) failed"** means some passes did not leave: resend them (see below). Once the health monitor is on, its `wys.pass_missing` alert says the same. | Guest-list manager |
| **Before 13 Nov** | Staff accounts for every door person and the spare phone, signed in and tested on their own phone. Door phones chosen (Android if possible: it vibrates). On every phone used at SM26: **Test sound & buzz** (see "Before opening", step 4). Decide: the date requests close; when the "account" switch (`provisioning`) goes on (see "The two e-mails"); the backup decisions of `backups.md`; a local data plan (eSIM) for Dubai. Install the health monitor (planned, not yet done). Fill the contact sheet. | Victor |
| **12 Nov** | Backup export (`backups.md`, section 3). | Sébastien or technical contact |
| **13 Nov** (J-14) | **Freeze 1**: the request form, the guest's personal page and the parity code take bug fixes only. | everyone |
| **18 Nov** (J-9) | **Door rehearsal** on the hidden test event (script below), with the real phones and accounts. | Door lead, door staff, technical contact |
| **20 Nov** (J-7) | **Full freeze** until 28 Nov: the "Do not touch" list applies. | everyone |
| Planned date (Victor) | Close requests: guest list, switch **Invitation requests are OPEN** to off. The page then shows "not open yet"; invitations already sent still work. | Victor |
| **25 Nov** (before travel) | Backup export, from Monaco (it downloads 2.6 GB: never on venue or hotel Wi-Fi). | Sébastien |
| **26 Nov** (J-1) | On arrival: test the local data plan on every phone; one phone can share its connection (hotspot). Export and print the door list (see "Fallback"). Charge phones, power banks, the laptop. Resend passes to anyone who asks. Check that each door phone is still signed in and its bookmark opens **World Yachting Summit 2026**. | Victor, door lead |
| **27 Nov** (J) morning | If the network is fine: export and print the list again (guests confirmed since yesterday). | Door lead |
| **27 Nov** (J) | Door: conference, then gala (same QR). Guest-list manager on the laptop for problems. | all |
| **28 Nov** (J+1) | Export the final list (**Export CSV**: it has the **Checked in** time). Enter any paper check-ins. Report incidents. Shred the paper lists, delete the CSV files. The freeze ends. | Door lead, Victor |

## Confirming a guest, and the two e-mails

**Approve a request** (guest list, tab **Requests**):

1. Read the request. Tick **Conference**, **Gala dinner** or both (what the guest asked for is
   pre-ticked; change it if needed).
2. Press **Approve** (or tick several and press **Approve selected**).
3. Read the message at once (it disappears after about 5 seconds): **"N approved — N pass(es)
   emailed"**. If it says **"N email(s) failed"**, go to the tab **Guest list**, find the
   person and tap the **envelope icon** at the right of their row (its tooltip reads **Resend
   entry pass**). It answers **"Entry pass re-sent"**. If no message appears at all, the pass
   did NOT leave: try again later and tell the technical contact.
4. If the platform asks **"Go over capacity anyway?"**: stop and ask Victor. Capacity is 150
   seats (confirmed + invited not yet answered).

**Refuse:** **Refuse**. No e-mail goes unless **Email a polite decline when refusing** is
ticked (off by default).

**Invite someone directly** (tab **Invite**): one person or a pasted list. They receive an
invitation with **Accept** and **Decline**. Their seat is held from the invitation. When they
press **Accept**, they are confirmed at once and receive their pass. Anyone already on the list
(even refused or declined) is skipped: **Already on the list (skipped)**.

**E-mail 1: the pass (the one that matters at the door).** Subject "Your invitation is
confirmed — World Yachting Summit …", sent at once by the guest list, with the QR code in the
e-mail and attached as `entry-pass.png`. It works offline: a screenshot or a print is fine.

**E-mail 2: "Your Smart Marina Connect account is ready"** (it asks the guest to choose a
password; the link works once). It opens the guest's platform account; it has nothing to do
with entry. Today it only leaves when the switch `provisioning` is on. While the switch is off,
these e-mails wait, and they all leave together when it is switched on, possibly weeks after
the pass (and the health monitor warns about them until then: `health-monitor.md`, step 6).
Once the next registration update is installed (not yet), it will arrive about one minute
after the pass, always second. A guest who already has a confirmed account gets no second
e-mail. What to tell guests: "Keep the e-mail with your QR code. The other e-mail only opens
your Smart Marina Connect account."

**Guests who lost their pass:** guest list, tab **Guest list** > find them > the **envelope
icon** on their row (**Resend entry pass**). Their personal page (the **Open my invitation**
button of their pass or invitation e-mail) also shows the QR once they are confirmed.

**Personal links.** The **two-squares icon** on a guest's row (tooltip **Copy personal link**)
copies that guest's own page. It is NOT the **Copy link** button at the top of the page, which
copies the public request page. Never give a personal link to anyone other than the guest:
whoever holds it can decline their place. The **red no-entry icon** on the row cancels the
guest (Victor's decision; no e-mail is sent). On a phone or tablet the icons show no tooltip:
use the laptop.

## At the door

### Before opening (30 minutes before)

1. Each phone: charged, power bank, screen lock set to 5 minutes or more, sound on (iPhone:
   ring switch on), venue Wi-Fi AND the local data plan working.
2. Open the phone's **usual browser**, **one tab only**, sign in at `smartmarinaconnect.com`,
   then open the bookmark of `smartmarinaconnect.com/admin/guest-list/wys26/checkin`.
3. Check the header: **Check-in**, then **World Yachting Summit 2026 · X of Y confirmed guests
   arrived**. If it says **Canary on-site (internal test)**, this is the rehearsal bookmark:
   type the wys26 address above and bookmark it again. If it reads **0 of 0** and **Scan a QR
   code** is grey, the page could not reach the platform: reload once; if it stays, see
   "Fallback".
4. Tap **Scan a QR code** once to allow the camera (iPhone: if the camera stays refused,
   Settings > Safari > Camera > Allow), then **Test sound & buzz**. iPhones never vibrate from
   a web page: the sound and the colour are the signal. If it answers **Buzzed, no sound** or
   **Nothing reached you** with the ring on, the sound was switched off on this phone at SM26
   (this page has no sound button of its own, and its message about a "toolbar sound button"
   refers to the SM26 page). Fix it before 13 Nov, with the technical contact: open
   `smartmarinaconnect.com/admin/sm26/checkin` once (it needs an admin account), tap the crossed-out speaker icon at the
   top so it shows a speaker, touch nothing else, go back to the bookmark. (Opening that page
   re-checks the SM26 badges; on 15 Oct this changes nothing, and the health monitor's
   `drift.sm26_archive` would show it.) On the day, if it still happens, rely on the colour.
5. Under the camera, ignore the hint **"The scanner stays open…"**: on this page it closes
   after each read.

### Admitting a guest

**Built-in scanner (always use this):** tap **Scan a QR code**, hold the guest's QR about
15 cm away so it fills the white box. The scanner closes after each read and shows the result:
tap **Scan a QR code** again for the next guest. If nothing reads (glare, broken screen, dim
light: raise the guest's screen brightness, light a printed pass with another phone's torch),
use **Take a photo instead**, or the name search.

**Phone camera app (backup only):** pointing the camera app at the QR opens the door page in a
NEW tab and admits the guest straight away. Close that tab after each guest: several open tabs
are a known cause of the phone being signed out in the middle of the door. It only works on a
phone signed in in that same browser. If the phone is signed out, the current site shows the
**home page** with **"Please log in to access this page."** (the redesign shows a sign-in form
instead). Sign in (this needs network), open the bookmark, scan again with the built-in
scanner: the code from the camera is lost.

**Never let a guest scan their own QR**: it opens a staff page.

### What the screen means

| Screen | Meaning | Do |
|---|---|---|
| Green **Welcome — admitted**, name, company, **Access: …** | Admitted now | Read **Access**: **Conference**, **Gala dinner** or **Conference + Gala dinner**. The system does NOT stop a conference-only guest at the gala: you do. **· plus-one** = a guest's plus-one. |
| Amber **Already checked in at <time>**, name, **Access: …** | This pass was already used | Conference: ask for photo ID (a forwarded QR shows amber for the second person). Gala: expected, see "At the gala". There is no undo on an amber card. |
| Red **Not admitted** + **Unknown QR code — not a pass for this event** | Not our QR | Name search. If EVERY pass shows this, check the header: the page may be the test event (Before opening, step 3). |
| Red + **Request not approved yet** | The request is still waiting | Door lead (Victor may approve it on the laptop, tab **Requests**; then see "Refresh"). |
| Red + **Invited but has not accepted — check with the organiser** | Never answered the invitation | Door lead: the guest presses **Accept** in their invitation e-mail now, then scan their new pass, or refresh and search the name. |
| Red + **Declined the invitation** | The guest, or someone with their link, declined | Door lead. An **invited** guest who declined can press **Changed your mind? Accept the invitation** on their personal page (only while seats remain), then scan again. Anyone else: Victor decides (below). |
| Red + **Request was refused** / **Invitation cancelled** | Refused or cancelled by M3 | Door lead, Victor decides (below). |
| Red + **Failed to fetch** or a similar network text | **Network problem, NOT a refusal** | Scan again once. If it repeats, see "Fallback". |
| Red + **forbidden**, **permission denied** or a text with **JWT** | **This phone's sign-in** stopped working | Hand the phone to the door lead and use the spare phone. Do not sign out while the network is down. |
| Red + any other text | Unknown | Door lead; technical contact. |

**When Victor says yes** to someone the platform refuses (declined, refused, cancelled, not on
the list): let the guest in by hand and write name, time and "Victor OK" on the paper list. The
platform cannot re-admit them before 28 Nov (re-inviting skips anyone already on the list).

### At the gala

- The QR is the same as in the morning, so most guests scan **amber**: that is expected. Read
  the **Access** line on the amber card. It must say **Gala dinner** or **Conference + Gala
  dinner**. If it says **Conference** only, do not let them in: door lead.
- **Green** at the gala is fine too: the guest skipped the conference. Read **Access** all the
  same.
- In the name search, a guest who came in the morning shows **In** with an arrow. **Never tap
  In**: it undoes their check-in. Read the access text under their name (**Conference + Gala
  dinner**…) and let them in.

### Name search (no QR)

Type at least 2 letters of the first name, last name or company (not the e-mail) in **No QR?
Search a name or company**. Up to 12 people appear: **Check in** admits; **Not accepted yet**
= invited, never answered (door lead); **In** with an arrow = already in (do not tap it). Ask
for photo ID. People who declined, were refused, cancelled or are still waiting never appear:
door lead.

**Refresh.** The phone loads the guest list once and searches it without network. It reloads
after this phone's own check-ins and when you tap the **refresh icon** (circular arrows, top
right). So after any change made on the laptop (a walk-in invited, a plus-one approved, a
guest who just accepted), **tap the refresh icon first, then search the name**. If a
colleague just admitted someone, you may still see **Check in**; the platform answers
**Already checked in** anyway.

### Plus-ones

Each plus-one has their own pass and QR and is admitted on their own (**plus-one** tag). The
host's check-in does not admit them. A plus-one whose request was not approved has no QR and
does not appear in the search: door lead. Victor may approve it on the laptop, tab
**Requests**; the plus-one receives a pass by e-mail; refresh the door phone and search, or
scan the new pass.

**A companion nobody asked for = a walk-in.** Ask Victor. If yes, either the host requests a
plus-one on their personal page (**Request a plus-one**: it needs the companion's own e-mail,
not the host's; one per guest) and the laptop approves it in **Requests**, or the laptop
invites the companion in **Invite**. Then refresh the door phone and search the name. If the
network is slow, admit on paper with "Victor OK".

### Undo

Right after a green screen, the arrow on the card undoes it. In the name search, the **In**
button with an arrow undoes a check-in. One tap, no confirmation: never at the gala (see
above). Without network an undo looks done but is not: refresh and check.

### Walk-ins

The door page cannot add anyone. Only with Victor's OK: on the laptop, tab **Invite**, invite
the person with their e-mail; they press **Accept** on their phone and receive their pass;
then on the door phone tap the refresh icon and search the name, or scan the new pass. If they
cannot open their e-mail: on the laptop, tab **Guest list**, the two-squares icon on their row
(**Copy personal link**), open that link on the laptop with the guest beside you, press
**Accept**; their QR appears on the page: scan it from the laptop screen. Someone already on
the list (refused, declined, cancelled) cannot be invited again: paper and "Victor OK".

### Lost or stolen door phone

A door phone is signed in to a staff account: whoever holds it can see guests and, with an
admin account, open the guest list (e-mails, phone numbers), cancel guests or change settings.

1. Tell Victor and the door lead at once.
2. On the laptop: **Admin > Users** > that person's account > **Persona / Role** > a non-staff
   role (for example **Individual**) > **Save**. From then that phone's door page refuses
   check-ins (red **forbidden**) and the guest list stops loading. This is the one allowed
   change to a staff account during the freeze.
3. Switch to the spare phone.
4. Write it down. On 28 Nov: restore the role if the phone is found, and change that
   account's password.

## Fallback if the network or the platform fails

**Prepare on 26 Nov (evening), again on the 27th in the morning:**

1. On the laptop, guest list > **Export CSV** (`wys26-guest-list.csv`). The file holds e-mails
   and phone numbers: keep it on the laptop only and delete it after the event.
2. Open it in Excel, keep the rows with Status **Confirmed** (make a second, short list of
   **Invited — awaiting answer**), keep only the columns **Last name, First name, Company,
   Conference, Gala, Plus-one of**, sort by last name, add an empty **Arrived** column, print
   2 copies per entrance.
3. **Never print** an e-mail address, a phone number, a personal link or a code. The only code
   allowed on paper is the guest's own QR on their own pass.
4. Leave the guest list open on the laptop (a page already open stays readable without
   network, as long as it is not reloaded). Bring the laptop charger and a power strip.

**If it fails on the day:**

1. On one phone: switch between Wi-Fi and mobile data (or the hotspot phone), reload once. Do
   not sign out (you may not be able to sign back in without network).
2. Still failing: switch to paper. Ask the name and a photo ID. A QR cannot be checked without
   network; the guest's pass e-mail shows their first name ("Dear …"). Find the name on the
   paper list, tick **Arrived** with the time, read **Conference** / **Gala**.
3. Call the technical contact.
4. Power cut at the venue: phones on power banks, laptop on battery, paper list; light for
   printed passes from a phone torch.
5. When it works again: enter every paper arrival with the name search, **Check in**.

**Do not:** clear the browser, reinstall, open several tabs, use another scanning app.

**After the event (28 Nov):** shred every paper list and delete every exported CSV.

## Contact sheet (fill before 13 Nov, keep printed at the desk)

| Role | Name | Phone | Reachable |
|---|---|---|---|
| Event lead | Victor Meyer | `<PHONE>` | 26 to 28 Nov |
| Guest-list manager | `<NAME>` | `<PHONE>` | |
| Door lead | `<NAME>` | `<PHONE>` | |
| Technical contact | `<NAME>` | `<PHONE>` | on call 26 to 27 Nov |
| Venue IT / Wi-Fi | `<NAME>` | `<PHONE>` | |
| Guests' questions (reply-to of the e-mails) | `<CONTACT E-MAIL>` | | |

Status pages: `status.supabase.com` (platform database), `www.netlifystatus.com` (site).

## Do not touch from 20 to 28 November

- **The guest-list function**: no redeploy, no change to its secrets (`RESEND_API_KEY`,
  `SITE_URL`, `TURNSTILE_*`). The deployed version is not the latest code in git: a redeploy
  would change the e-mails.
- **The wys26 event settings**: its address (`wys26`), engine, door mode, hidden flag, the
  **Settings** tab texts (date, venue, city, contact e-mail, programme: they feed the e-mails),
  the staff alert address, the capacity (only Victor). The only planned change is closing
  requests, by Victor, on his date.
- **Guest codes**: never edit or regenerate a guest's code (token); never share a personal link.
- **The door check-in function** (`gl_checkin`), the guest-list triggers, any `gl_*`
  migration, the account trigger.
- **The registration switches** (`registration_flags`), unless decided before 20 Nov; the
  secrets `REGISTRATION_SITE_URL` and `ACCOUNT_SITE_URL` stay unset.
- **The site's code**: no change to the door page, the guest-list page, the guest's personal
  page, the `/wys26` request page, or the SM26 check-in page (the door reuses its scanner and
  its sound). The personal page and the `/wys26` form take bug fixes only from 13 Nov.
- **Deploys**: every push to `main` goes live automatically. From 20 Nov, nothing reaches
  `main` without Victor's OK; on 26 and 27 Nov nothing at all (a deploy changes the page files
  under phones that have the door page open). The redesign goes live before 13 Nov or after
  28 Nov.
- **Supabase**: no compute change, no restore, no backup setting change, no project setting
  change. No change to staff accounts, except demoting a lost phone's account (above).

**Allowed:** approve, refuse, invite, resend a pass or an invitation, cancel a guest (Victor's
decision), check in and undo, export the CSV, close requests on the planned date.

Once installed and switched on (planned before 13 Nov, not yet done), the health monitor
(`health-monitor.md`) e-mails M3 if the door function or the event changes, if a guest code
goes missing or is duplicated, or if a confirmed guest has no QR e-mail. It does not see a
code replaced by another one.

## Door rehearsal, 18 November (hidden test event)

The test event `canary-onsite` is hidden, holds 20 seats, takes no public requests and sends
no staff alert. Use test addresses that M3 controls (Victor's OK), the real door phones, the
spare phone and the real accounts.

1. Laptop: `smartmarinaconnect.com/admin/guest-list/canary-onsite`, tab **Invite**: invite
   test guests A, B and C (conference + gala), then E (**Conference** only).
2. The invitation's **Accept** button opens a "not found" page (known: the test event has no
   public page). Instead, on the laptop, tab **Guest list**, tap the **two-squares icon** on
   A's row (**Copy personal link**; NOT the **Copy link** button at the top), paste it in the
   address bar, change `canary-onsite/guest` into `wys26/guest`, open it on a test phone,
   press **Accept**. The real pass e-mail arrives. Same for B and E.
3. Door phone: `smartmarinaconnect.com/admin/guest-list/canary-onsite/checkin`. Built-in
   scanner on A's QR: green. Again: amber **Already checked in** (no undo on amber). Undo in
   the name search: A, tap **In**. Rescan: green.
4. Camera app on B's QR: admitted directly; close the new tab. Undo B in the name search.
   Sign the phone out and scan B with the camera app again: note what happens (current site:
   home page with **"Please log in to access this page."**). Sign in, open the bookmark, scan
   B with the built-in scanner: green.
5. Name search for C: **Not accepted yet**. C accepts (step 2 trick). Search again without
   refreshing: still **Not accepted yet**. Tap the refresh icon: **Check in**.
6. Gala drill: scan E twice: green, then amber with **Access: Conference**: "not for the
   gala". Scan A again: amber with **Conference + Gala dinner**: admitted.
7. On A's personal page, **Request a plus-one** D; laptop, tab **Requests**: approve; scan D's
   pass: green with **plus-one**.
8. On B's personal page, **I can no longer attend**; scan B's QR: red **Declined the
   invitation**. B presses **Changed your mind? Accept the invitation**; scan: green.
9. Walk-in drill: laptop invites F; F accepts on the laptop through the personal link (as in
   "Walk-ins", with the step 2 change of address); door phone: refresh, search F, **Check in**.
10. Airplane mode, scan: red with a technical text = the "network, not refusal" case. Back
    online, reload.
11. Second phone: sign out and sign in again (network on), open the bookmark: time it.
12. Lost-phone drill, with an account created for the drill (never Victor's): on the laptop
    set its role to **Individual**; scan on its phone: red **forbidden**; set the role back.
13. Each phone: **Test sound & buzz**; iPhone with the ring switch both ways.
14. Paper drill: **Export CSV** of the test event, print the door list, admit one guest on
    paper, then enter them with the name search.
15. Clean up: cancel the test guests (no e-mail is sent). On EVERY phone delete the canary
    bookmark, bookmark `smartmarinaconnect.com/admin/guest-list/wys26/checkin` and check its
    header reads **World Yachting Summit 2026**. Confirming test guests also queues their
    "account" e-mail: the health monitor may report it while the switch is off; that is
    expected, tell the technical contact.

Write down: which phones worked, every problem, seconds per guest.
