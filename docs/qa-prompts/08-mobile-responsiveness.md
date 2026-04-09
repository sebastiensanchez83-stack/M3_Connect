# Prompt 08 — Mobile responsiveness audit

## Copy-paste to Claude Chrome

```
Test mobile responsiveness of https://smartmarinaconnect.com

Use Chrome DevTools → Device emulation to simulate these viewports:
- iPhone SE (375 × 667) — smallest common modern viewport
- iPhone 14 Pro (393 × 852)
- iPad Mini (768 × 1024)

For each viewport, test the following pages and interactions:

=== Public pages (test at iPhone SE first) ===

1. https://smartmarinaconnect.com/
   - Hero section: text readable, CTA button tappable (>= 44x44px)
   - Navbar: hamburger menu icon visible, logo visible, no overflow
   - Click hamburger → menu slides in, all links tappable with enough spacing
   - Click a link → menu closes, page loads
   - Footer: legal links stack vertically, no overflow

2. /events
   - Event cards stack single column
   - Images load
   - Filter chips wrap correctly, are tappable
   - Click into an event

3. /events/{id}
   - Event detail hero reflows
   - Registration card is full-width or stacked
   - Packages (if any) reflow
   - No horizontal scroll on the page

4. /join (signup)
   - Form fields full width
   - Labels readable (>= 14px)
   - Keyboard doesn't obscure the submit button
   - Dropdown/select works with mobile touch

5. /account (requires login — use the QA marina from Prompt 03 or log in again)
   - Dashboard stats don't overflow
   - Tabs are scrollable horizontally OR reflow
   - Cards stack vertically
   - Logout button is reachable

6. /admin (requires admin login — use Sebastien's session)
   - Sidebar should be HIDDEN by default on mobile
   - Hamburger button at top-left opens sidebar
   - Sidebar slides in over content
   - Tapping a link closes sidebar and loads page
   - Tables should either scroll horizontally OR reflow to card layout
   - Try /admin/users and /admin/events specifically

=== General checks at EACH viewport ===

For every page visited, verify:

A. No horizontal scrollbar at the page level (only designated areas like tables may scroll)
B. No text is cut off or overflows its container
C. No elements overlap (check cards, nav items, buttons)
D. Tap targets are minimum 44×44 px (use the Elements inspector to measure)
E. Forms: inputs are full-width, labels visible, submit button reachable above the fold on signup
F. Modals/dialogs: fit within the viewport, have an accessible close button, backdrop dims content
G. Images: don't stretch or distort, load correctly
H. Font sizes: body text minimum 14px, buttons minimum 14px
I. Images/videos don't cause layout shift (CLS)

=== Specific things to break-test ===

1. On /events/{webinar}, open the lightweight signup form on iPhone SE. Verify all 4 fields are reachable, keyboard doesn't hide the submit button, error toasts are visible.

2. On /admin, try rotating device (simulate landscape). The sidebar and layout should adapt.

3. On /account, if there are multiple tabs (Projects, Events, RFPs, etc.), verify tab navigation works on touch.

4. On any page, pinch-zoom should be ENABLED (accessibility requirement). Meta viewport should not include `user-scalable=no`.

SPECIFIC THINGS TO FLAG:

- (P0) Page has horizontal scrollbar at body level → broken layout
- (P0) Critical CTA (signup, register) unreachable on mobile
- (P0) Hamburger menu doesn't open or close
- (P0) Modal/dialog is cut off and cannot be dismissed
- (P0) Admin sidebar is stuck open on mobile, blocking content
- (P1) Tables overflow and can't be scrolled
- (P1) Tap targets smaller than 44×44 px on important buttons
- (P1) Form submit button hidden behind keyboard
- (P1) Meta viewport has user-scalable=no (accessibility fail)
- (P2) Minor text wrapping issues
- (P2) Icon misalignment
- (P3) Ideal but not blocking: hover states don't translate well to mobile

For each viewport, report format:
| Page | Horizontal scroll | Tap targets OK | Forms usable | Issues |

At the end, produce a summary table:
| Viewport | Pages tested | P0 count | P1 count | P2 count |
```
