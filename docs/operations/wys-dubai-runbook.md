# World Yachting Summit, Dubai, 27 November 2026: runbook

> **Résumé en français.**
> 1. Ce document dit, jour par jour du 13 au 28 novembre, qui fait quoi pour les invités du WYS sur la plateforme, et comment tenir la porte le 27.
> 2. Confirmer un invité envoie tout de suite l'e-mail avec le QR ; un 2e e-mail « votre compte est prêt, choisissez votre mot de passe » suit (aujourd'hui seulement si l'interrupteur « provisioning » est allumé).
> 3. À la porte : scanner le QR (ou chercher le nom), lire la couleur de l'écran, vérifier la ligne « Access » (conférence / gala).
> 4. Si le réseau ou la plateforme tombe : liste papier imprimée la veille (noms seulement, jamais de liens ni de codes), pièce d'identité, puis saisie après coup.
> 5. Du 20 au 28 novembre, on ne touche à rien (liste en fin de document) ; la répétition générale a lieu le 18 sur l'événement test caché.

Written for the M3 team, no technical knowledge needed. Words in **bold** are what you see on
screen. Times are **Dubai time** (UTC+4) unless said otherwise.

## The three pages

| Page | Address | Who |
|---|---|---|
| Public request page | `smartmarinaconnect.com/wys26` | anyone (guests ask for an invitation) |
| Guest list (staff) | `smartmarinaconnect.com/admin/guest-list/wys26` | **admin accounts only** |
| Door check-in (staff) | `smartmarinaconnect.com/admin/guest-list/wys26/checkin` | admin accounts (moderator accounts could too; none exist today) |

Never send a staff address to a guest. Never change these addresses: every QR code already
e-mailed points at the door page.

## Roles

| Role | Who | Does |
|---|---|---|
| Event lead | Victor | Decides: over capacity, walk-ins, closing requests, re-admitting someone who declined. The only one who changes a setting. |
| Guest-list manager | `<NAME>` (admin account) | Reviews requests every day, approves or refuses, invites, resends passes, exports the list. |
| Door lead | `<NAME>` (admin account, laptop) | Runs the entrance, solves every red screen, holds the paper list and the laptop with the guest list. |
| Door staff | `<NAMES>` (2 to 3 per entrance, each with an admin account and a phone) | Scan, search a name, admit. Send every problem to the door lead. |
| Technical contact | `<NAME>` (on call 26 to 27 Nov) | Platform problems only. |

Every door phone needs its own verified **admin** account, created and tested before 13 Nov.
(A moderator account opens the door page but not the guest list; there are none today.)

## Timeline

| When | What | Who |
|---|---|---|
| **Before 13 Nov** | Admin accounts for every door person, signed in and tested on their own phone. Door phones chosen (Android if possible: it vibrates). Decide: the date requests close; when the "account" switch (`provisioning`) goes on (see "The two e-mails"); the backup decisions of `backups.md`. Fill the contact sheet. | Victor |
| **13 Nov** (J-14) | **Freeze 1**: the request form, the guest's personal page and the parity code take bug fixes only. Daily: open the guest list, review **To review**, approve or refuse. | Guest-list manager |
| 13 to 19 Nov | After every approval, read the message at the bottom of the screen: **"… N email(s) failed"** means some passes did not leave. Resend them (see below). | Guest-list manager |
| **18 Nov** (J-9) | **Door rehearsal** on the hidden test event (script below), with the real phones and accounts. | Door lead, door staff, technical contact |
| **20 Nov** (J-7) | **Full freeze** until 28 Nov: the "Do not touch" list applies. | everyone |
| Planned date (Victor) | Close requests: guest list, switch **Invitation requests are OPEN** to off. The page then shows "not open yet"; invitations already sent still work. | Victor |
| **26 Nov** (J-1) | Run the backup export (`backups.md`, section 3). Export and print the door list (see "Fallback"). Charge phones and power banks. Resend passes to anyone who asks. Check that each door phone is still signed in. | Victor, door lead |
| **27 Nov** (J) | Door: conference, then gala (same QR). Guest-list manager on the laptop for problems. | all |
| **28 Nov** (J+1) | Export the final list (**Export CSV**: it has the **Checked in** time). Enter any paper check-ins. Report incidents. The freeze ends. | Door lead, Victor |

## Confirming a guest, and the two e-mails

**Approve a request** (guest list, tab **Requests**):

1. Read the request. Tick **Conference**, **Gala dinner** or both (what the guest asked for is
   pre-ticked; change it if needed).
2. Press **Approve** (or tick several and press **Approve selected**).
3. Read the message: **"N approved — N pass(es) emailed"**. If it says **"N email(s) failed"**,
   go to the tab **Guest list**, find the person and press **Resend entry pass**.
4. If the platform asks **"Go over capacity anyway?"**: stop and ask Victor. Capacity is 150
   seats (confirmed + invited not yet answered).

**Refuse:** **Refuse**. No e-mail goes unless **Email a polite decline when refusing** is
ticked (off by default).

**Invite someone directly** (tab **Invite**): one person or a pasted list. They receive an
invitation with **Accept** and **Decline**. Their seat is held from the invitation. When they
press **Accept**, they are confirmed at once and receive their pass.

**E-mail 1: the pass (the one that matters at the door).** Subject "Your invitation is
confirmed — World Yachting Summit …", sent at once by the guest list, with the QR code in the
e-mail and attached as `entry-pass.png`. It works offline: a screenshot or a print is fine.

**E-mail 2: "Your Smart Marina Connect account is ready"** (it asks the guest to choose a
password; the link works once). It opens the guest's platform account; it has nothing to do
with entry. Today it only leaves when the
switch `provisioning` is on. While the switch is off, these e-mails wait, and they all leave
together when it is switched on, possibly weeks after the pass. Once the next registration
update is installed (not yet), it will arrive about one minute after the pass, always second.
A guest who already has a confirmed account gets no second e-mail. What to tell guests: "Keep
the e-mail with your QR code. The other e-mail only opens your Smart Marina Connect account."

**Guests who lost their pass:** guest list > find them > **Resend entry pass**. Their personal
page (the **Open my invitation** button of their pass or invitation e-mail) also shows the QR
once they are confirmed. Never
copy a personal link to anyone other than the guest: whoever holds it can cancel the place.

## At the door

### Before opening (30 minutes before)

1. Each phone: charged, power bank, screen lock set to 5 minutes or more, sound on (iPhone:
   ring switch on), Wi-Fi of the venue AND mobile data available.
2. Open the phone's **usual browser** (the one the camera app opens), **one tab only**, sign
   in at `smartmarinaconnect.com`, then open `smartmarinaconnect.com/admin/guest-list/wys26/checkin`
   and bookmark it.
3. Check the header: **Check-in**, the event name, **"X of Y confirmed guests arrived"**. If it
   reads **0 of 0** and **Scan a QR code** is grey, the page could not reach the platform:
   reload once; if it stays, see "Fallback".
4. Tap **Scan a QR code** once to allow the camera, then **Test sound & buzz**. iPhones never
   vibrate from a web page: the sound and the colour are the signal.

### Admitting a guest

**Built-in scanner (preferred):** tap **Scan a QR code**, hold the guest's QR about 15 cm away
so it fills the white box. The scanner closes after each read and shows the result: tap
**Scan a QR code** again for the next guest. If nothing reads (glare, broken screen), use
**Take a photo instead**, or the name search.

**Phone camera app:** pointing the camera app at the QR opens the door page and admits the
guest straight away. It only works on a phone signed in in that same browser. If the phone
asks to sign in, sign in and scan again (on the current site the code is lost when you sign
in).

**Never let a guest scan their own QR**: it opens a staff page.

### What the screen means

| Screen | Meaning | Do |
|---|---|---|
| Green **Welcome — admitted**, name, company, **Access: …** | Admitted now | Read **Access**: **Conference**, **Gala dinner** or **Conference + Gala dinner**. The system does NOT stop a conference-only guest at the gala: you do. **· plus-one** = a guest's plus-one. |
| Amber **Already checked in at <time>** | This pass was already used | At the gala this is normal (same QR as the morning). Otherwise ask for photo ID: a forwarded QR shows amber for the second person. |
| Red **Not admitted** + **Unknown QR code — not a pass for this event** | Not our QR | Name search. |
| Red + **Request not approved yet** | The request is still waiting | Door lead. |
| Red + **Invited but has not accepted — check with the organiser** | Never answered the invitation | Door lead: the guest presses **Accept** in their invitation e-mail now, then name search. |
| Red + **Declined the invitation** | The guest, or someone with their link, declined | Door lead, Victor decides. |
| Red + **Request was refused** / **Invitation cancelled** | Refused or cancelled by M3 | Door lead, Victor decides. |
| Red + **any other text** (for example **Failed to fetch**) | **Network problem, NOT a refusal** | Scan again. If it repeats, see "Fallback". |

### Name search (no QR)

Type at least 2 letters of the first name, last name or company (not the e-mail) in **No QR?
Search a name or company**. Up to 12 people appear: **Check in** admits; **Not accepted yet**
= invited, never answered (door lead); **In** with an arrow = already in. Ask for photo ID.
People who declined, were refused, cancelled or are still waiting never appear: door lead.
The list refreshes after your own actions or the refresh button at the top right: if a
colleague just admitted someone, you may still see **Check in**; the platform answers
**Already checked in** anyway.

### Plus-ones

Each plus-one has their own pass and QR and is admitted on their own (**plus-one** tag). The
host's check-in does not admit them. A plus-one whose request was not approved has no QR and
does not appear in the search: door lead (Victor may approve it on the laptop, tab
**Requests**; the plus-one then receives a pass by e-mail).

### Undo

Right after a green screen, the arrow on the card undoes it; in the name search, the **In**
button with an arrow does the same. One tap, no confirmation. Without network an undo looks
done but is not: refresh and check.

### Walk-ins

The door page cannot add anyone. Only with Victor's OK: on the laptop, tab **Invite**, invite
the person with their e-mail; they press **Accept** on their phone; then name search.

## Fallback if the network or the platform fails

**Prepare on 26 Nov (evening):**

1. On the laptop, guest list > **Export CSV** (`wys26-guest-list.csv`). The file holds e-mails
   and phone numbers: keep it on the laptop only and delete it after the event.
2. Open it in Excel, keep the rows with Status **Confirmed** (make a second, short list of
   **Invited — awaiting answer**), keep only the columns **Last name, First name, Company,
   Conference, Gala, Plus-one of**, sort by last name, add an empty **Arrived** column, print
   2 copies per entrance.
3. **Never print** an e-mail address, a phone number, a personal link or a code. The only code
   allowed on paper is the guest's own QR on their own pass.
4. Leave the guest list open on the laptop (a page already open stays readable without
   network, as long as it is not reloaded).

**If it fails on the day:**

1. On one phone: switch between Wi-Fi and mobile data, reload once. Do not sign out (you may not
   be able to sign back in without network).
2. Still failing: switch to paper. Ask the name and a photo ID. A QR cannot be checked without
   network; the guest's pass e-mail shows their first name ("Dear …"). Find the name on the
   paper list, tick **Arrived** with the time, read **Conference** / **Gala**.
3. Call the technical contact.
4. When it works again: enter every paper arrival with the name search, **Check in**.

**Do not:** clear the browser, reinstall, open several tabs, use another scanning app.

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
- **The site**: no Netlify deploy on 26 and 27 Nov (a deploy changes the page files under
  phones that have the door page open).
- **Supabase**: no compute change, no restore, no backup setting change, no project setting
  change. No change to door staff accounts.

**Allowed:** approve, refuse, invite, resend a pass or an invitation, cancel a guest (Victor's
decision), check in and undo, export the CSV, close requests on the planned date.

The health monitor (`health-monitor.md`) warns by e-mail if the door function, the event or
the guest codes change, or if a confirmed guest has no QR e-mail.

## Door rehearsal, 18 November (hidden test event)

The test event `canary-onsite` is hidden, holds 20 seats, takes no public requests and sends
no staff alert. Use test addresses that M3 controls (Victor's OK), the real door phones and
accounts.

1. Laptop: `smartmarinaconnect.com/admin/guest-list/canary-onsite`, tab **Invite**: invite
   test guests A, B and C (conference + gala).
2. The invitation's **Accept** button opens a "not found" page (known: the test event has no
   public page). Instead, on the laptop, **Copy personal link** for A, change
   `canary-onsite/guest` into `wys26/guest` in the address, open it on a test phone, press
   **Accept**. The real pass e-mail arrives. Same for B.
3. Door phone: `smartmarinaconnect.com/admin/guest-list/canary-onsite/checkin`. Built-in
   scanner on A's QR: green. Again: amber **Already checked in**. Undo, rescan: green.
4. Camera app on B's QR: admitted directly. Then sign the phone out and repeat: note what
   happens.
5. Name search for C: **Not accepted yet**.
6. On A's personal page, request a plus-one D; laptop, tab **Requests**: approve; scan D's
   pass: green with **plus-one**.
7. On B's personal page, **I can no longer attend**; scan B's QR: red **Declined the
   invitation**.
8. Airplane mode, scan: red with a technical text = the "network, not refusal" case. Back
   online, reload.
9. Each phone: **Test sound & buzz**; iPhone with the ring switch both ways.
10. Paper drill: **Export CSV** of the test event, print the door list, admit one guest on
    paper, then enter them with the name search.
11. Clean up: cancel the test guests (no e-mail is sent). Confirming test guests also queues
    their "account" e-mail: the health monitor may report it while the switch is off; that is
    expected, tell the technical contact.

Write down: which phones worked, every problem, seconds per guest.
