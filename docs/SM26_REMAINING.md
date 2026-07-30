# What is still open — SM26

Event: 20–21 September 2026. Feature freeze agreed for **15 August**.
Last updated 30 July (check-in scanner fixed — see the note at the end).

Kept here rather than in a chat thread, because a chat thread is not somewhere
anyone will look in three weeks.

---

## Victor's own actions (nobody else can do these)

| | Why it matters |
|---|---|
| **Confirm PITR is on** in Supabase → Database → Backups | The only protection against a bad data change. Could not be established from the API. Everything else — Netlify, git, SQL grants — is already reversible. |
| **Press "Test the QR"** on the SM26 health screen, then scan it with the check-in scanner | Proves the whole chain end to end on a real phone. It sends nothing. The generator and the scanner have each been verified off-platform; what has never been done is one real phone reading one real pass. |
| **Delete Zoom meeting `82360201544`** | Created by the preview bug on 28 July, scheduled 1 Sept, belongs to nobody. |
| **Chase 19 jurors** who have not said whether they attend on site | Balaguer, Besomi, Chiappini, Cullen, Falcone, Gonzalvez, Holi, Hopwood, Kourniotis, Laudus, Lebreton-Wolf, Maas, Murray Kerr, Racioppo, Sindermann, Sousa, Thoraval, van Brussel, Weninger. Without an answer the door refuses them. |
| **Invoice the 4 architects coming on site** — €600 each | Cowan Architects, JASPER ARCHITECTS, Reddy Architecture & Urbanism, W_ARKS. The other 7 compete remotely and correctly owe nothing. |
| **Decide on the audience ballot** | It currently offers all 24 innovations, not a Top 5. No shortlist mechanism exists. |

---

## Audit findings still open

Verified by direct query, in rough order of consequence.

- **D-3 — the architecture competition has no jury wiring at all.** 12 entries, zero
  assignments, and the architecture-scoped jurors are on no panel. **2 of the 6
  awards cannot be given** as things stand. Closes 19 August.
- **EF-01 — the vote is judged on the registration owner, not the person scanned in.**
  An absent buyer can vote; a colleague who was actually at the door cannot.
- **EF-05 — no shortlist on the public ballot** (see above).
- **LM-04 — `notify-admins` has no authentication.** Anyone can make M3's whole admin
  team receive an email with attacker-chosen text. Narrower than the relay closed on
  29 July, but the same shape.
- **C-1 / LM-05 — `sm26-assets` signs participant-writable paths with the service role.**
  Known and carried since before this audit. A participant who edits their own
  `module_data` to point at another path can read another participant's files.
- **C-2 — architecture blind judging is defeated by the file path**, which carries the
  firm's name inside the signed URL even though the filename is nulled.

### Reported by the audit but NOT independently re-verified

Listed so they are not mistaken for confirmed. All are frontend code reads.

- **A-3** — every admin "View as user" invalidates that person's outstanding
  welcome / set-password link.
- **B-1** — the completeness check that flips `needs_info` → `info_provided` is
  stricter than the green ticks shown on the same screen.
- **B-2** — the request-info picker offers columns whose answers are written to a
  different store than the one the picker reads.
- **B-4** — two editors on the same tab each write the whole `module_data` object, so
  whichever saves second reverts the other.
- **B-5** — no admin surface can edit a registration's base fields, and the
  participant one hides itself after the edit deadline while still showing the
  "we need details" banner.
- **B-6** — no admin writer uses `requireFreshSession()`, so a long-idle admin tab
  silently updates zero rows and still reports success. Admin consoles are exactly
  what gets used on the day.

---

## Deliberately parked until after 22 September

Incubator / dealflow · FR-EN translation · HubSpot sync · Jotform webhook ·
full financial reconciliation (participants get their invoice on their account,
which is enough for this edition).

---

## Not defects — normal states of the process

Recorded because they look alarming in a report and are not.

- Jury assignments are left in **draft** while registrations are still arriving.
- People refused at the door are **waiting for payment**, which is expected to land.
- Architects who compete remotely have **no fee line**, which is correct — they only
  pay if they travel.

---

## Closed on 30 July: the door scanner would not read the pass

Worth recording, because the same trap will be there next edition.

The scanner took whatever resolution the browser offered. Browsers hand out
**640×480** when nobody asks. Replaying real entry passes through the actual
decode path: at 640×480 the code has to fill **30% of the frame** to read at
all; at 1080p it reads down to **10%** — the badge can be held three times
further away. That is the entire reported symptom: a phone's own camera app
read a pass the in-app scanner could not, because the camera app uses the full
sensor and the web page was using a postage stamp.

It now asks for 1080p, asks for continuous autofocus, and waits for the video to
actually have a frame before reading. Three smaller holes were closed at the
same time — the native `BarcodeDetector` could fail forever without ever falling
back to the bundled decoder; only one framing of each frame was tried; and a
pass shown on a dark-mode screen was not attempted inverted.

There is now a **"Take a photo instead"** button as a last resort, a live
resolution readout in the corner of the viewfinder, and a prompt after seven
seconds of reading nothing — so at the door it is possible to tell a bad frame
apart from a broken scanner.

**Still unproven:** one real phone reading one real pass. Press "Test the QR" on
the health screen and scan the code it shows. Nothing is emailed either way.
