# M3 Connect -- Manual Test Feedback Template

**Tester Name:** _______________
**Date:** _______________
**Environment:** Production (Netlify) / Local Dev
**Browser:** Chrome ___ / Safari ___ / Firefox ___ / Edge ___
**Device:** Desktop / Tablet / Mobile
**Build/Commit:** _______________

---

## Status Legend

| Status | Meaning |
|--------|---------|
| PASS | Works exactly as expected |
| FAIL | Does not work as expected -- describe what happened |
| BLOCKED | Cannot test -- dependency or prerequisite not met |
| SKIPPED | Intentionally not tested this round |

## Priority Legend

| Priority | Meaning |
|----------|---------|
| Critical | App is broken, data loss, or security issue |
| High | Core feature broken, no workaround |
| Medium | Feature partially broken or UX issue |
| Low | Cosmetic, minor annoyance, or nice-to-have |

---

## 1. Authentication

### AUTH-01: Sign Up as Marina

| Field | Value |
|-------|-------|
| **Priority** | Critical |
| **Precondition** | Logged out, on home page |
| **Steps** | 1. Click "Sign Up" or "Get Started" button on home page. 2. Select "Marina" persona. 3. Fill in email, password (min 8 chars), confirm password. 4. Submit the form. 5. Check email for confirmation link. 6. Click the confirmation link. |
| **Expected** | Account created. Confirmation email received. After confirming, redirected to onboarding page. |
| **Actual** | |
| **Status** | |
| **Notes/Screenshots** | |

### AUTH-02: Sign Up as Partner

| Field | Value |
|-------|-------|
| **Priority** | Critical |
| **Precondition** | Logged out |
| **Steps** | 1. Click "Sign Up". 2. Select "Partner" persona. 3. Fill in email, password, confirm password. 4. Submit. 5. Confirm email. |
| **Expected** | Account created with partner persona. Redirected to partner onboarding after confirmation. |
| **Actual** | |
| **Status** | |
| **Notes/Screenshots** | |

### AUTH-03: Sign Up as Media Partner

| Field | Value |
|-------|-------|
| **Priority** | Critical |
| **Precondition** | Logged out |
| **Steps** | 1. Click "Sign Up". 2. Select "Media Partner" persona. 3. Fill in email, password, confirm password. 4. Submit. 5. Confirm email. |
| **Expected** | Account created with media_partner persona. Redirected to media partner onboarding after confirmation. |
| **Actual** | |
| **Status** | |
| **Notes/Screenshots** | |

### AUTH-04: Login with Valid Credentials

| Field | Value |
|-------|-------|
| **Priority** | Critical |
| **Precondition** | Have a confirmed account |
| **Steps** | 1. Go to login page. 2. Enter valid email and password. 3. Click "Sign In". |
| **Expected** | Logged in and redirected to account page (or onboarding if not completed). No console errors. |
| **Actual** | |
| **Status** | Pass|
| **Notes/Screenshots** | |

### AUTH-05: Login with Invalid Credentials

| Field | Value |
|-------|-------|
| **Priority** | High |
| **Precondition** | Logged out |
| **Steps** | 1. Go to login page. 2. Enter valid email with wrong password. 3. Click "Sign In". |
| **Expected** | Error message displayed (e.g., "Invalid login credentials"). No crash. User stays on login page. |
| **Actual** | |
| **Status** | Pass|
| **Notes/Screenshots** | |

### AUTH-06: Password Reset Flow

| Field | Value |
|-------|-------|
| **Priority** | High |
| **Precondition** | Have a confirmed account, logged out |
| **Steps** | 1. Go to login page. 2. Click "Forgot Password" link. 3. Enter email address. 4. Submit. 5. Check email for reset link. 6. Click reset link. 7. Enter new password and confirm. 8. Submit. 9. Try logging in with new password. |
| **Expected** | Reset email received. New password accepted. Login with new password succeeds. |
| **Actual** | |
| **Status** | Fail|
| **Notes/Screenshots** | The email is sent no probleme but i tested the forgot password and mentioned a different email than the one of the account and it worked so this means anyone can reset a user's password. moreover once i clicked on the reset password from the email it says invalid link, see picture Screenshot 2026-04-02 at 11.08.47.png |

### AUTH-07: Logout

| Field | Value |
|-------|-------|
| **Priority** | Critical |
| **Precondition** | Logged in |
| **Steps** | 1. Click user menu or logout button. 2. Confirm logout. |
| **Expected** | Logged out. Redirected to home page. Protected routes no longer accessible. |
| **Actual** | |
| **Status** | Pass|
| **Notes/Screenshots** | |

---

## 2. Onboarding

### ONB-01: Complete Marina Onboarding

| Field | Value |
|-------|-------|
| **Priority** | Critical |
| **Precondition** | Logged in as marina user, email confirmed, onboarding not yet completed |
| **Steps** | 1. Land on onboarding page. 2. Fill in marina name, location, country, website. 3. Fill in extended fields: number of berths, max LOA, services offered. 4. Select relevant sectors from the list. 5. Add future plans if applicable. 6. Upload a logo image. 7. Submit the form. |
| **Expected** | Onboarding data saved to DB. User redirected to account page with "pending verification" banner. Profile shows as pending in admin panel. |
| **Actual** | |
| **Status** | |
| **Notes/Screenshots** | |

### ONB-02: Complete Partner Onboarding

| Field | Value |
|-------|-------|
| **Priority** | Critical |
| **Precondition** | Logged in as partner user, onboarding not completed |
| **Steps** | 1. Land on partner onboarding page. 2. Fill in company name, description, website. 3. Select partner sectors. 4. Upload company logo. 5. Submit. |
| **Expected** | Partner profile saved. User redirected to account page with pending status. |
| **Actual** | |
| **Status** | |
| **Notes/Screenshots** | |

### ONB-03: Complete Media Partner Onboarding

| Field | Value |
|-------|-------|
| **Priority** | Critical |
| **Precondition** | Logged in as media_partner user, onboarding not completed |
| **Steps** | 1. Land on media partner onboarding page. 2. Fill in publication name, description, website, audience reach. 3. Upload logo. 4. Submit. |
| **Expected** | Media partner profile saved. User redirected to account page with pending status. |
| **Actual** | |
| **Status** | |
| **Notes/Screenshots** | |

### ONB-04: Onboarding Form Validation

| Field | Value |
|-------|-------|
| **Priority** | High |
| **Precondition** | On any onboarding form |
| **Steps** | 1. Leave all required fields empty. 2. Click Submit. 3. Fill in partial data (e.g., name only). 4. Click Submit again. |
| **Expected** | Validation messages shown for each required field. Form does not submit until all required fields are filled. |
| **Actual** | |
| **Status** | |
| **Notes/Screenshots** | |

### ONB-05: Onboarding Redirect Logic

| Field | Value |
|-------|-------|
| **Priority** | High |
| **Precondition** | Logged in user who has NOT completed onboarding |
| **Steps** | 1. Try navigating directly to /account. 2. Try navigating to /submit-project. 3. Try navigating to /request-webinar. |
| **Expected** | User is redirected back to onboarding page for all protected routes until onboarding is complete. |
| **Actual** | |
| **Status** | |
| **Notes/Screenshots** | |

---

## 3. Admin Workflow

### ADM-01: Approve a User

| Field | Value |
|-------|-------|
| **Priority** | Critical |
| **Precondition** | Logged in as admin. At least one user with pending status exists. |
| **Steps** | 1. Go to /admin. 2. Click "Users" in the sidebar. 3. Find a pending user in the list. 4. Click "Approve" button. 5. Confirm the action. |
| **Expected** | User status changes to "verified". User can now access full platform features. Status badge updates in admin list. |
| **Actual** | |
| **Status** | Pass|
| **Notes/Screenshots** | |

### ADM-02: Reject a User with Reason

| Field | Value |
|-------|-------|
| **Priority** | Critical |
| **Precondition** | Logged in as admin. At least one pending user exists. |
| **Steps** | 1. Go to /admin > Users. 2. Find a pending user. 3. Click "Reject" button. 4. Enter a rejection reason in the dialog. 5. Confirm rejection. |
| **Expected** | User status changes to "rejected". Rejection reason is saved. User sees rejection message on their account page. |
| **Actual** | |
| **Status** | Pass|
| **Notes/Screenshots** | |

### ADM-03: Create a Resource

| Field | Value |
|-------|-------|
| **Priority** | High |
| **Precondition** | Logged in as admin |
| **Steps** | 1. Go to /admin > Resources. 2. Click "Create Resource" or equivalent button. 3. Fill in title, description, category, content. 4. Upload a thumbnail image if applicable. 5. Set as published. 6. Submit. |
| **Expected** | Resource created and visible on the public /resources page. |
| **Actual** | |
| **Status** | |
| **Notes/Screenshots** | |

### ADM-04: Create an Event

| Field | Value |
|-------|-------|
| **Priority** | High |
| **Precondition** | Logged in as admin |
| **Steps** | 1. Go to /admin > Events. 2. Click "Create Event". 3. Fill in event name, date, location, description, capacity. 4. Upload an event image. 5. Submit. |
| **Expected** | Event created and visible on the public /events page with correct details. |
| **Actual** | |
| **Status** | |
| **Notes/Screenshots** | |

### ADM-05: Admin Dashboard Stats

| Field | Value |
|-------|-------|
| **Priority** | Medium |
| **Precondition** | Logged in as admin |
| **Steps** | 1. Go to /admin (Dashboard view). 2. Check all 8 stat cards are displayed. 3. Verify the numbers seem reasonable (not all zeros if data exists). |
| **Expected** | Dashboard shows stat cards for: total users, pending users, marinas, partners, resources, events, projects, webinar requests. All cards render without errors. |
| **Actual** | |
| **Status** |Pass |
| **Notes/Screenshots** | |

---

## 4. Public Pages

### PUB-01: Home Page Loads

| Field | Value |
|-------|-------|
| **Priority** | Critical |
| **Precondition** | None |
| **Steps** | 1. Navigate to the root URL. 2. Scroll through the entire page. |
| **Expected** | Home page loads fully. Hero section, feature sections, CTA buttons all render. No broken images. No console errors. |
| **Actual** | |
| **Status** |Pass |
| **Notes/Screenshots** | |

### PUB-02: Resources Page

| Field | Value |
|-------|-------|
| **Priority** | High |
| **Precondition** | At least one published resource exists |
| **Steps** | 1. Navigate to /resources. 2. Verify resource cards display. 3. Click on a resource card to view details. |
| **Expected** | Resource listing loads. Cards show title, thumbnail, category. Detail page opens with full content. |
| **Actual** | |
| **Status** |Pass |
| **Notes/Screenshots** | |

### PUB-03: Events Page

| Field | Value |
|-------|-------|
| **Priority** | High |
| **Precondition** | At least one event exists |
| **Steps** | 1. Navigate to /events. 2. Verify event cards display. 3. Click on an event for details. |
| **Expected** | Events listed with date, name, location. Detail view shows full event info. |
| **Actual** | |
| **Status** |Pass |
| **Notes/Screenshots** | |

### PUB-04: Marketplace / Partners Page

| Field | Value |
|-------|-------|
| **Priority** | High |
| **Precondition** | At least one verified partner exists |
| **Steps** | 1. Navigate to /marketplace or /partners. 2. Browse partner listings. 3. Filter by sector if filter is available. 4. Click on a partner card. |
| **Expected** | Partners displayed with company info and sectors. Filters work. Detail view shows partner profile. |
| **Actual** | |
| **Status** |Pass |
| **Notes/Screenshots** | |

### PUB-05: About Page

| Field | Value |
|-------|-------|
| **Priority** | Medium |
| **Precondition** | None |
| **Steps** | 1. Navigate to /about. 2. Read through the page content. |
| **Expected** | Page loads. Content is present and readable. No layout issues. |
| **Actual** | |
| **Status** | |
| **Notes/Screenshots** | |

### PUB-06: Contact Page

| Field | Value |
|-------|-------|
| **Priority** | Medium |
| **Precondition** | None |
| **Steps** | 1. Navigate to /contact. 2. Fill in the contact form (if present). 3. Submit. |
| **Expected** | Page loads. Contact form submits successfully with confirmation message. |
| **Actual** | |
| **Status** | |
| **Notes/Screenshots** | |

### PUB-07: Legal Pages (Privacy, Terms, CGV)

| Field | Value |
|-------|-------|
| **Priority** | Medium |
| **Precondition** | None |
| **Steps** | 1. Navigate to footer links for Privacy Policy, Terms of Use, CGV. 2. Verify each page loads with content. |
| **Expected** | All legal pages load with full text content. No 404 errors. Links in footer are correct. |
| **Actual** | |
| **Status** |Pass |
| **Notes/Screenshots** | |

---

## 5. Submissions

### SUB-01: Submit a Project (Marina)

| Field | Value |
|-------|-------|
| **Priority** | Critical |
| **Precondition** | Logged in as verified marina user |
| **Steps** | 1. Navigate to /submit-project (or click "Submit Project" in navbar). 2. Fill in project title, description, budget range, timeline. 3. Select relevant sectors. 4. Submit. |
| **Expected** | Project saved to DB. Confirmation message shown. Project appears in user's account under Projects tab. Project visible in admin panel. |
| **Actual** | |
| **Status** | |
| **Notes/Screenshots** | |

### SUB-02: Submit an RFP (Marina)

| Field | Value |
|-------|-------|
| **Priority** | High |
| **Precondition** | Logged in as verified marina user |
| **Steps** | 1. Navigate to the RFP submission page. 2. Fill in RFP title, requirements, deadline, budget. 3. Select target partner sectors. 4. Submit. |
| **Expected** | RFP created. Confirmation shown. RFP appears in account and admin panel. |
| **Actual** | |
| **Status** | |
| **Notes/Screenshots** | |

### SUB-03: Submit a Consultation Request (Marina)

| Field | Value |
|-------|-------|
| **Priority** | High |
| **Precondition** | Logged in as verified marina user |
| **Steps** | 1. Navigate to consultation request page. 2. Fill in topic, description, preferred format (call/email/meeting). 3. Submit. |
| **Expected** | Consultation request saved. Confirmation shown. |
| **Actual** | |
| **Status** | |
| **Notes/Screenshots** | |

### SUB-04: Request a Webinar

| Field | Value |
|-------|-------|
| **Priority** | High |
| **Precondition** | Logged in as any verified user |
| **Steps** | 1. Navigate to /request-webinar. 2. Fill in webinar topic, description, preferred date range. 3. Select relevant sectors. 4. Submit. |
| **Expected** | Webinar request saved. Confirmation shown. Request appears in admin > Webinar Requests. |
| **Actual** | |
| **Status** | |
| **Notes/Screenshots** | |

### SUB-05: Submission Form Validation

| Field | Value |
|-------|-------|
| **Priority** | High |
| **Precondition** | On any submission form |
| **Steps** | 1. Open any submission form (project, RFP, consultation, webinar). 2. Click submit without filling anything. 3. Fill in only partial data. 4. Submit again. |
| **Expected** | Proper validation messages appear for all required fields. Form does not submit with missing required data. |
| **Actual** | |
| **Status** | |
| **Notes/Screenshots** | |

---

## 6. Account Management

### ACC-01: View Account Page

| Field | Value |
|-------|-------|
| **Priority** | Critical |
| **Precondition** | Logged in as any verified user |
| **Steps** | 1. Navigate to /account. 2. Check all tabs are present and clickable. |
| **Expected** | Account page loads with profile info, appropriate tabs (Profile, Projects, Registrations, etc.). Status banner reflects correct status. |
| **Actual** | |
| **Status** | |
| **Notes/Screenshots** | |

### ACC-02: Edit Profile

| Field | Value |
|-------|-------|
| **Priority** | High |
| **Precondition** | Logged in, on account page |
| **Steps** | 1. Go to profile/edit section. 2. Change company name or description. 3. Save changes. 4. Reload page. |
| **Expected** | Changes saved and persisted after reload. |
| **Actual** | |
| **Status** | |
| **Notes/Screenshots** | |

### ACC-03: Organization Settings

| Field | Value |
|-------|-------|
| **Priority** | High |
| **Precondition** | Logged in as organization owner/admin |
| **Steps** | 1. Navigate to organization settings. 2. View current organization details. 3. Edit organization name or settings if possible. 4. Save. |
| **Expected** | Organization settings page loads. Changes save correctly. |
| **Actual** | |
| **Status** | |
| **Notes/Screenshots** | |

### ACC-04: Invite Organization Member

| Field | Value |
|-------|-------|
| **Priority** | High |
| **Precondition** | Logged in as organization owner |
| **Steps** | 1. Go to organization members section. 2. Click "Invite Member" or equivalent. 3. Enter invitee email address. 4. Select role. 5. Send invitation. |
| **Expected** | Invitation sent. Invitee appears in pending members list. Invitee receives email. |
| **Actual** | |
| **Status** | |
| **Notes/Screenshots** | |

### ACC-05: View Tier / Subscription Info

| Field | Value |
|-------|-------|
| **Priority** | Medium |
| **Precondition** | Logged in as partner user |
| **Steps** | 1. Navigate to account page. 2. Find subscription/tier information section. 3. Verify current tier is displayed. |
| **Expected** | Current tier/plan displayed. Upgrade options visible if applicable. |
| **Actual** | |
| **Status** | |
| **Notes/Screenshots** | |

---

## 7. Pre-Audit S3

### S3-01: Start S3 Assessment

| Field | Value |
|-------|-------|
| **Priority** | High |
| **Precondition** | Logged in as verified marina user |
| **Steps** | 1. Navigate to the S3 pre-audit assessment page. 2. Verify the questionnaire loads with all sections/questions. |
| **Expected** | Questionnaire renders with all questions. Instructions are clear. Progress indicator works (if present). |
| **Actual** | |
| **Status** |Skipped |
| **Notes/Screenshots** | |

### S3-02: Complete S3 Assessment

| Field | Value |
|-------|-------|
| **Priority** | High |
| **Precondition** | On S3 assessment page, questionnaire loaded |
| **Steps** | 1. Answer all questions in the questionnaire. 2. Submit the completed assessment. |
| **Expected** | Assessment saved. Results page or score displayed. Data persists in user account. |
| **Actual** | |
| **Status** |Skipped |
| **Notes/Screenshots** | |

### S3-03: View S3 Results

| Field | Value |
|-------|-------|
| **Priority** | High |
| **Precondition** | S3 assessment completed |
| **Steps** | 1. Navigate to results page (or check account page for results). 2. Review score breakdown by category. |
| **Expected** | Results show overall score and per-category breakdown. Recommendations or next steps displayed. |
| **Actual** | |
| **Status** |Skipped |
| **Notes/Screenshots** | |

---

## 8. Permissions

### PER-01: Marina User Sees Correct Navigation

| Field | Value |
|-------|-------|
| **Priority** | Critical |
| **Precondition** | Logged in as verified marina user |
| **Steps** | 1. Check navbar links. 2. Note which items are visible. |
| **Expected** | Should see: Home, Resources, Events, Marketplace, Account, Submit Project, Propose Webinar. Should NOT see: Admin Panel link. |
| **Actual** | |
| **Status** |Pass |
| **Notes/Screenshots** | |

### PER-02: Partner User Sees Correct Navigation

| Field | Value |
|-------|-------|
| **Priority** | Critical |
| **Precondition** | Logged in as verified partner user |
| **Steps** | 1. Check navbar links. 2. Attempt to access /submit-project directly via URL. |
| **Expected** | Should see appropriate partner navigation. Should NOT have access to marina-only features like Submit Project. Should NOT see Admin Panel. |
| **Actual** | |
| **Status** |Pass |
| **Notes/Screenshots** | |

### PER-03: Admin User Sees Admin Panel

| Field | Value |
|-------|-------|
| **Priority** | Critical |
| **Precondition** | Logged in as admin or moderator |
| **Steps** | 1. Check navbar for "Admin Panel" link. 2. Click it. 3. Verify all admin sidebar sections are accessible. |
| **Expected** | Admin Panel link visible in navbar. /admin page loads with sidebar: Dashboard, Users, Resources, Events, Partners, Projects, Leads, Webinar Requests. |
| **Actual** | |
| **Status** |Pass |
| **Notes/Screenshots** | |

### PER-04: Non-Admin Cannot Access /admin

| Field | Value |
|-------|-------|
| **Priority** | Critical |
| **Precondition** | Logged in as non-admin user (marina or partner) |
| **Steps** | 1. Type /admin directly in the URL bar. 2. Press Enter. |
| **Expected** | User is redirected away from admin page (to home or account). Admin panel does not render. |
| **Actual** | |
| **Status** | |
| **Notes/Screenshots** | |

### PER-05: Pending User Restrictions

| Field | Value |
|-------|-------|
| **Priority** | High |
| **Precondition** | Logged in as user with "pending" access_status |
| **Steps** | 1. Try to access /submit-project. 2. Try to access /request-webinar. 3. Check what is visible in account page. |
| **Expected** | Pending user cannot access submission features. Account page shows "pending verification" banner. Limited functionality until approved. |
| **Actual** | |
| **Status** | |
| **Notes/Screenshots** | |

---

## 9. Mobile / Responsive

### MOB-01: Home Page at Mobile Width

| Field | Value |
|-------|-------|
| **Priority** | High |
| **Precondition** | Use Chrome DevTools, toggle device toolbar, select iPhone 14 or 375px width |
| **Steps** | 1. Load home page at mobile width. 2. Check hero section, navigation hamburger menu, all sections. 3. Scroll to footer. |
| **Expected** | Layout adapts properly. No horizontal scroll. Text readable. Images scale. Hamburger menu opens and closes. All sections stack vertically. |
| **Actual** | |
| **Status** | |
| **Notes/Screenshots** | |

### MOB-02: Navigation Menu on Mobile

| Field | Value |
|-------|-------|
| **Priority** | High |
| **Precondition** | Mobile width viewport |
| **Steps** | 1. Tap hamburger menu icon. 2. Verify all nav links appear. 3. Tap a link. 4. Verify navigation occurs and menu closes. |
| **Expected** | Hamburger menu toggles open/close. All links work. Menu closes after navigation. No overlap or z-index issues. |
| **Actual** | |
| **Status** | |
| **Notes/Screenshots** | |

### MOB-03: Forms on Mobile

| Field | Value |
|-------|-------|
| **Priority** | Medium |
| **Precondition** | Mobile width viewport, logged in |
| **Steps** | 1. Open onboarding or any submission form at mobile width. 2. Fill in fields. 3. Check that input fields are full width and tappable. 4. Submit. |
| **Expected** | Form fields are properly sized. Labels visible. No input fields hidden off-screen. Submit button accessible. Keyboard does not obscure critical elements. |
| **Actual** | |
| **Status** | |
| **Notes/Screenshots** | |

### MOB-04: Account Page on Mobile

| Field | Value |
|-------|-------|
| **Priority** | Medium |
| **Precondition** | Mobile width viewport, logged in as verified user |
| **Steps** | 1. Navigate to /account at mobile width. 2. Check tab navigation. 3. Switch between tabs. |
| **Expected** | Tabs are scrollable or wrap properly. Content displays correctly. No overlap. |
| **Actual** | |
| **Status** | |
| **Notes/Screenshots** | |

---

## 10. Edge Cases

### EDG-01: Empty States

| Field | Value |
|-------|-------|
| **Priority** | Medium |
| **Precondition** | Logged in as verified user with no submissions |
| **Steps** | 1. Go to account page > Projects tab (with no projects). 2. Go to account page > Registrations tab (with no event registrations). 3. Check any list page with no data. |
| **Expected** | Friendly empty state messages displayed (e.g., "You haven't submitted any projects yet"). No blank white sections. No errors. |
| **Actual** | |
| **Status** |Pass  |
| **Notes/Screenshots** | |

### EDG-02: Double Form Submission

| Field | Value |
|-------|-------|
| **Priority** | High |
| **Precondition** | On any submission form, filled and ready to submit |
| **Steps** | 1. Fill in a form completely. 2. Click Submit rapidly twice in quick succession. |
| **Expected** | Only one submission is created. Button should disable after first click or show loading state. No duplicate records in DB. |
| **Actual** | |
| **Status** | |
| **Notes/Screenshots** | |

### EDG-03: Session Expiry

| Field | Value |
|-------|-------|
| **Priority** | High |
| **Precondition** | Logged in |
| **Steps** | 1. Log in. 2. Wait for session to expire (or manually clear auth token in browser storage). 3. Try to navigate to a protected page. |
| **Expected** | User is gracefully redirected to login page. No infinite loops or white screens. Clear message that session has expired. |
| **Actual** | |
| **Status** | |
| **Notes/Screenshots** | |

### EDG-04: Invalid URL / 404 Handling

| Field | Value |
|-------|-------|
| **Priority** | Medium |
| **Precondition** | None |
| **Steps** | 1. Navigate to a non-existent URL (e.g., /this-page-does-not-exist). |
| **Expected** | A proper 404 page is displayed with navigation back to home. No blank screen. |
| **Actual** | |
| **Status** | |
| **Notes/Screenshots** | |

### EDG-05: Large File Upload

| Field | Value |
|-------|-------|
| **Priority** | Medium |
| **Precondition** | On any form with file upload (onboarding logo, etc.) |
| **Steps** | 1. Try uploading a file larger than 5MB. 2. Try uploading a non-image file (e.g., .exe or .pdf) to an image-only field. |
| **Expected** | Large files: error message about max file size. Wrong file type: error message about accepted formats. No crash. |
| **Actual** | |
| **Status** | |
| **Notes/Screenshots** | |

### EDG-06: Special Characters in Input

| Field | Value |
|-------|-------|
| **Priority** | Medium |
| **Precondition** | On any form |
| **Steps** | 1. Enter special characters in text fields: `<script>alert('xss')</script>`, `' OR 1=1 --`, accented characters like `Reseau Francais de Marinas`. 2. Submit the form. |
| **Expected** | Special characters are properly sanitized. No XSS execution. Accented characters are preserved correctly. Form submits without error. |
| **Actual** | |
| **Status** | |
| **Notes/Screenshots** | |

### EDG-07: Payment Test Mode (Lyra/SogeCommerce)

| Field | Value |
|-------|-------|
| **Priority** | High |
| **Precondition** | Logged in as partner, on subscription/payment page |
| **Steps** | 1. Navigate to payment/upgrade section. 2. Select a plan. 3. Enter test card details (Lyra test card: 4970 1000 0000 0003, any future expiry, any CVV). 4. Submit payment. |
| **Expected** | Test payment processed. Subscription status updated. Confirmation page shown. No real charges made. |
| **Actual** | |
| **Status** | |
| **Notes/Screenshots** | |

### EDG-08: Reference Request System

| Field | Value |
|-------|-------|
| **Priority** | Medium |
| **Precondition** | Logged in as verified user |
| **Steps** | 1. Navigate to reference request feature. 2. Select a partner or marina to request a reference from. 3. Submit the request. 4. Check the recipient account for the incoming request. |
| **Expected** | Reference request sent and visible to recipient. Requester sees pending status. |
| **Actual** | |
| **Status** | |
| **Notes/Screenshots** | |

---

## 11. Chrome Extension Test Results

> **How to use:** Run each prompt from `docs/CHROME_EXTENSION_TEST_GUIDE.md` in the Claude Chrome Extension.
> Copy the extension's response into the **Findings** column. Mark Status as PASS if no issues, FAIL if issues found.

### Visual & Layout (V-01 to V-05)

| Test ID | Page | Status | Findings |
|---------|------|--------|----------|
| V-01 | Home `/` | |# M3 Connect Homepage — UI/UX Audit Report

---

## 1. BROKEN IMAGES

**No traditional broken images found**, but there is a notable observation:

**Resource card image placeholders:** All three Featured Resources cards (the articles and guide) display a generic document SVG icon on a very faint gradient background (`from-primary/10 to-primary/5`) instead of actual article thumbnail images. There are zero `<img>` elements on the entire page. While this is by design (placeholder icons rather than broken images), it creates a visually sparse look — the image areas are 438×192px of near-white gradient with a small document icon centered, which may read as "image failed to load" to some users.

**Partner logos:** Similarly, partner organizations show monogram initials (MC, OE, MS, etc.) in gray circles rather than actual company logos. This appears intentional but worth noting.

**Verdict:** No technically broken images. All visual content uses SVG icons and CSS gradients as placeholders.

---

## 2. BUTTON CONSISTENCY

Here is a full inventory of every visible button and button-styled link:

**Navbar buttons:**
- **Language switcher** (globe icon): transparent bg, gray text, 12px border-radius, 36px height, no padding
- **Login**: transparent bg, gray text (`rgb(75, 85, 99)`), 12px border-radius, 36px height, padding `0 12px`
- **Sign Up**: navy bg (`rgb(11, 38, 83)`), white text, 12px border-radius, 36px height, padding `0 12px`

**Hero section CTA buttons (link-buttons):**
- **"Join Now — It's Free"**: gold bg (`rgb(215, 166, 71)`), navy text, **6px border-radius**, 44px height, padding `0 32px`
- **"Explore the Marketplace"**: transparent bg, white text, white 1px border, **6px border-radius**, 44px height, padding `0 32px`

**Bottom CTA section button (link-button):**
- **"Join Now"**: transparent bg, white text, white 1px border, **6px border-radius**, 44px height, padding `0 32px`

**Section action links (styled as text links with arrows):**
- **"View All →"**, **"View Calendar →"**, **"View All Partners →"**: gold text (`rgb(215, 166, 71)`) on no background, no border-radius, no padding — these are text links, not buttons

**Consistency issues flagged:**

- **Border-radius mismatch:** Navbar buttons use `12px` border-radius while hero/CTA buttons use `6px`. This is a noticeable inconsistency across the button system.
- **Height inconsistency:** Navbar buttons are 36px tall; hero and CTA buttons are 44px. While it's common for hero CTAs to be larger, the jump is notable.
- **Padding inconsistency:** Navbar buttons use `0 12px` padding while CTA buttons use `0 32px`. This is expected given the size difference but should be part of a defined scale.
- **The language switcher button** has 0px padding and no visible text — it differs significantly from the Login button next to it.

Overall the button styles are **mostly consistent within their respective contexts** (navbar vs. page CTAs), but the border-radius difference (12px navbar vs. 6px CTAs) is a design system inconsistency worth aligning.

---

## 3. TEXT OVERFLOW

**Issues found:**

- **H1 "The Platform for Marina Innovation"**: The font is 60px with a line-height of 60px. The scrollHeight is 65px vs. the offsetHeight of 60px — the descenders of letters like "p" and "y" extend 5px below the allocated height. The overflow is set to `visible` so it doesn't clip, but it's a tight fit that could cause overlap issues with added content.

- **Resource card descriptions**: All three resource card paragraph texts are clamped using `line-clamp-2`. The content exceeds the 2-line limit (scrollHeight 60px vs. offsetHeight 40px), so text is truncated with "...". This is intentional and visually clean.

- **Partner name "Mediterranean Marine Supplies"**: This name is truncated to "Mediterranean Marine Sup..." in the Our Partners section. The scrollWidth (176px) exceeds the offsetWidth (160px). The CSS truncation class is applied, but among the 6 partner cards, this is the only name that gets cut off, making it look inconsistent.

- **"For Marinas" card text in accessibility tree**: The accessibility tree showed the text cut off at "tailored to your " — however, the full DOM text reads "tailored to your operations." and renders fully on screen. This appears to be an accessibility tree character limit, not a visual issue.

**Verdict:** One real issue — the "Mediterranean Marine Supplies" partner name is truncated. Resource card clamping is by design and works well.

---

## 4. SPACING AND ALIGNMENT

**Section spacing analysis:**

| Section | Padding Top | Padding Bottom |
|---|---|---|
| Hero | 128px | 128px |
| Why Join M3 Connect? | 64px | 64px |
| How It Works | 64px | 64px |
| Stats bar | 32px | 32px |
| Featured Resources | 64px | 64px |
| Upcoming Events | 64px | 64px |
| Our Partners | 64px | 64px |
| CTA ("Are you a Marina?") | 64px | 64px |

The spacing is **very consistent** — all content sections use 64px top/bottom padding, with the hero being intentionally larger (128px) and the stats bar being a compact accent row (32px). This is well-structured.

**Card alignment:**
- The three "Why Join" cards are all exactly 440×206px, center-aligned text — perfectly consistent.
- The three resource cards are all 440×362px — consistent.
- The three event cards are all 440×131px — consistent.
- The six partner cards are all 208×136px — consistent.

**Section headings**: "Featured Resources," "Upcoming Events," and "Our Partners" are all left-aligned with their "View All/View Calendar/View All Partners" links right-aligned on the same row. This pattern is consistent.

**Verdict:** Spacing and alignment are excellent. No issues found.

---

## 5. FOOTER

**Footer structure and content:**

The footer has four columns: brand info (with tagline & social icons), Platform links, Company links, and Legal links.

**Required links — all present:**
- **Privacy Policy** → `/privacy` — ✅ Returns 200
- **Terms of Service** → `/terms` — ✅ Returns 200
- **Contact** → `/contact` — ✅ Returns 200
- **Social media**: LinkedIn and Instagram icons present with valid external URLs

**Additional footer links (all return 200):**
- Resources → `/resources` ✅
- Events → `/events` ✅
- Partners → `/partners` ✅
- Become a Member → `/become-partner` ✅
- About → `/about` ✅
- Legal Notice → `/mentions-legales` ✅
- Commercial Terms → `/conditions-commerciales` ✅
- Cookie Policy → `/cookies` ✅

**Social media links:**
- LinkedIn: `https://www.linkedin.com/company/monaco-marina-management` — present
- Instagram: `https://www.instagram.com/monacomarinamanagement/` — present

(These returned opaque responses due to cross-origin restrictions, which is normal — they can't be verified as 404 or not without direct navigation, but the URLs are well-formed and point to real platform paths.)

**Missing social platforms:** No Twitter/X, Facebook, or YouTube links are present. This may or may not be an issue depending on the brand's social strategy.

**Verdict:** All essential footer links are present and working (HTTP 200). The footer is well-organized.

---

## 6. COLOR CONTRAST

**This is the most significant area of concern.** Multiple elements fail WCAG AA contrast requirements (4.5:1 for normal text, 3:1 for large text):

| Element | Foreground | Background | Contrast Ratio | Requirement | Result |
|---|---|---|---|---|---|
| **"View All →" link** | Gold `rgb(215,166,71)` | Light gray `rgb(248,250,252)` | **2.13:1** | 4.5:1 | ❌ FAIL |
| **"View Calendar →" link** | Gold `rgb(215,166,71)` | White `rgb(255,255,255)` | **2.23:1** | 4.5:1 | ❌ FAIL |
| **"View All Partners →" link** | Gold `rgb(215,166,71)` | Light gray `rgb(248,250,252)` | **2.13:1** | 4.5:1 | ❌ FAIL |
| **"Public" badge** (green) | White `rgb(255,255,255)` | Green `rgb(34,197,94)` | **2.28:1** | 4.5:1 | ❌ FAIL |
| **CTA heading** "Are you a Marina?" | White `rgb(255,255,255)` | Gold `rgb(215,166,71)` | **2.23:1** | 3:1 (large) | ❌ FAIL |
| **CTA paragraph text** | Light gray `rgb(243,244,246)` | Gold `rgb(215,166,71)` | **2.02:1** | 4.5:1 | ❌ FAIL |
| **CTA "Join Now" button text** | White | Gold background | **2.23:1** | 4.5:1 | ❌ FAIL |

**Elements that pass:**
- Hero heading (white on navy): 14.83:1 ✅
- Footer text (white on navy): 14.83:1 ✅
- Footer subtext (light gray on navy): 10.06:1 ✅
- "Join Now — It's Free" button (navy on gold): 6.66:1 ✅
- Sign Up button (white on navy): 14.83:1 ✅

**Summary of contrast issues:** The gold/amber accent color (`rgb(215,166,71)`) is used extensively as both a text color and a background color, and in both cases it creates serious contrast failures. The entire "Are you a Marina?" CTA banner is essentially unreadable for users with low vision. The "View All" action links across three sections are all below minimum contrast. The green "Public" badges also fail.

---

## Summary of All Issues

**Critical (affects accessibility/usability):**
1. Six color contrast failures across gold text links, the gold CTA banner section, and green badges — all below WCAG AA minimums.

**Minor (cosmetic):**
2. Border-radius inconsistency: navbar buttons use 12px while CTA buttons use 6px.
3. "Mediterranean Marine Supplies" partner name is truncated with ellipsis due to container width.
4. Resource cards show placeholder SVG icons instead of actual article images (likely a content gap, not a bug). |
| V-02 | Resources `/resources` | |# Resource Cards — Detailed UI/UX Audit Report

The Resources page displays **4 total resource cards**: 1 featured card at the top in a horizontal layout, and 3 standard grid cards below it in a 3-column row. Here are the findings across all six criteria.

---

## 1. CARD CONSISTENCY

**Grid cards (the 3 standard cards):** These are highly consistent with each other. All three measure exactly **347×429px**, share identical border-radius (`12px`), border (`1px solid rgb(243,244,246)`), background (white), and box-shadow (`shadow-sm`). The image placeholder areas within each are also identical at **345×215px**. The grid alignment is perfect — all three cards sit in a clean 3-column row with equal gutters.

**Featured card vs. grid cards — inconsistencies found:**

The featured card's inner container uses a **16px border-radius** while the grid cards use **12px**. This is a minor but real design system inconsistency. The featured card uses a horizontal layout (image left, content right) at **1088×354px**, which is intentionally different from the vertical grid cards, so size differences are by design. However, the border-radius difference appears unintentional and should be harmonized.

Both the featured card and grid cards share the same border style (`1px solid gray-100`) and shadow level (`shadow-sm`), which is consistent.

---

## 2. CARD CONTENT

Here is a field-by-field comparison across all cards:

| Field | Featured Card | Grid Card 1 | Grid Card 2 | Grid Card 3 |
|---|---|---|---|---|
| Category tag | ✅ Article | ✅ Article | ✅ Guide | ✅ Article |
| Title | ✅ | ✅ | ✅ | ✅ |
| Description | ✅ | ✅ | ✅ | ✅ |
| Date | ✅ 6 Mar 2026 | ✅ 28 Feb 2026 | ✅ 21 Feb 2026 | ✅ 11 Mar 2026 |
| Read time | ✅ 1 min read | ✅ 1 min | ✅ 1 min | ✅ 7 min |
| Author | ✅ Wei Chen | ❌ Missing | ❌ Missing | ❌ Missing |
| Topic tags | N/A | ✅ 3 tags | ✅ 3 tags | ❌ **Missing** |
| "Read more" | ✅ | ❌ Missing | ❌ Missing | ❌ Missing |
| Thumbnail image | SVG placeholder | SVG placeholder | SVG placeholder | SVG placeholder |

**Issues found:**

**Missing author on all grid cards:** The featured card displays "Wei Chen" as the author, but none of the three grid cards show any author name. This could be a design choice (grid cards are compact), but it creates an information gap.

**Missing topic tags on Card 3:** Cards 1 and 2 display small gray tag pills at the bottom (e.g., "sustainability," "Mediterranean," "environment" and "emergency," "safety," "fire"), but Card 3 ("From Anchorage to Itinerary") has **no tags at all**. This leaves visible empty whitespace at the bottom of that card. This appears to be a data issue — the resource simply has no tags assigned.

**Missing "Read more" on grid cards:** The featured card includes a prominent "Read more →" link, while the grid cards have none. Since the entire card is clickable this isn't a functional issue, but it removes a clear affordance for the user.

**No real thumbnail images anywhere:** All four cards use the same SVG document icon on a light navy-tinted background (`bg-primary/10`) as a placeholder where a thumbnail image would normally go. There are zero `<img>` elements on the page. This gives the resource section a placeholder/pre-launch feel.

**No "undefined", "null", or empty string issues:** I checked every text node inside all cards and found no instances of broken data rendering. All content that is present renders correctly.

---

## 3. TRUNCATION

**Descriptions on grid cards:** All three grid cards apply `line-clamp-2` to their description paragraphs, limiting them to 2 lines. All three descriptions are genuinely longer than 2 lines (scrollHeight exceeds offsetHeight), so they truncate gracefully with CSS ellipsis. Card 1's description scrollHeight is 68px vs. a visible 46px; Card 3's is 91px vs. 46px. The truncation renders cleanly with "..." at the end.

**Titles on grid cards:** Titles also use `line-clamp-2`. Card 3's title "From Anchorage to Itinerary: Unlocking Emerging Charter Destinations" is the longest and wraps to exactly 2 lines (44px at 22px line-height). None of the titles overflow or get cut off inappropriately.

**Featured card description:** Uses `line-clamp-3` (3 lines), and the full text fits within the 3-line limit without truncation. This is appropriate for the larger featured layout.

**No overflow issues detected:** The card container's `overflow: hidden` prevents any content from bleeding out. No text overlaps, no horizontal scrolling, and no clipping without ellipsis.

---

## 4. CLICKABILITY

**Entire card is a link:** Each card (both featured and grid) is wrapped in a single `<a>` element that covers the full card area. The cursor changes to `pointer` on hover. This is the correct pattern — users can click anywhere on the card.

**Hover effects — grid cards:** The CSS classes include `hover:shadow-md` and `hover:-translate-y-0.5`, which means on hover the card shadow deepens and the card lifts up by 2px. The transition is smooth (`transition-all duration-300`). The `group` class is also used, and the title changes color to the primary navy on hover (`group-hover:text-primary`). These are good interactive affordances.

**Hover effects — featured card:** The featured card's inner container uses `hover:shadow-lg` with a `transition-all duration-300`. It does not have the translate-Y lift effect that the grid cards do. This is a minor inconsistency in hover behavior between the two card types.

**Visual feedback is present but subtle:** The shadow change and 2px lift are functional but the effect is quite subtle in practice. There is no background color change or border color shift on hover, which would make the interactive state more noticeable.

---

## 5. EMPTY STATE

**Excellent empty state implementation.** When I searched for a nonsense string ("zzzzxxxxxxxnoresults"), the page correctly:

- Removed the featured card and grid cards entirely
- Displayed a large, centered document icon
- Showed the message: **"No resources found matching your criteria."**
- Provided a **"Clear filters"** button to reset the search

This is a well-designed, helpful empty state that clearly communicates why there are no results and offers a direct action to recover. No blank whitespace, no confusing behavior.

---

## 6. LOADING STATE

**No dedicated loading indicator observed.** When I navigated to/reloaded the Resources page, the content appeared immediately with no visible spinner, skeleton cards, or loading animation. The page renders server-side or loads extremely fast, so there's no noticeable content pop-in.

I also checked the DOM for any hidden skeleton or loading elements (`animate-pulse`, `skeleton`, `spinner`, `shimmer` classes) and found **zero** such elements in the markup. The application does not appear to implement skeleton loading states.

While this isn't a problem when loading is fast (as it currently is with only 4 resources), it could become an issue if the resource library grows significantly, if network conditions are poor, or if filters trigger slow API calls. Users might see a blank content area with no feedback during loading.

---

## Summary of Issues

**Data/Content Issues:**
1. **No real thumbnail images** on any card — all display SVG placeholder icons, giving a "coming soon" appearance
2. **Card 3 is missing topic tags** while Cards 1 and 2 have them, leaving uneven whitespace at the card bottom
3. **Author name missing** from all grid cards (only shown on featured card)

**Design Inconsistencies:**
4. **Border-radius mismatch:** Featured card inner container uses `16px` vs. grid cards' `12px`
5. **Hover behavior differs:** Featured card gets `hover:shadow-lg` without vertical lift; grid cards get `hover:shadow-md` plus `-translate-y-0.5`
6. **"Read more" link** only appears on the featured card, not on grid cards

**Missing Feature:**
7. **No loading/skeleton state** — if the API is ever slow, users will see an empty area with no feedback |
| V-03 | Admin `/admin` | |# Admin Panel Layout — Detailed Audit Report

---

## 1. SIDEBAR

**Yes, there is a sidebar navigation** fixed to the left side of the admin panel. It is 191px wide with a transparent background and contains **14 menu items**, each with an icon and label:

1. Dashboard (`/admin`)
2. Users (`/admin/users`)
3. Resources (`/admin/resources`)
4. Events (`/admin/events`)
5. Sponsorships (`/admin/sponsorships`)
6. Expositions (`/admin/expositions`)
7. Marina Projects (`/admin/projects`)
8. Partner Leads (`/admin/leads`)
9. Webinar Requests (`/admin/webinars`)
10. B2B Requests (`/admin/partner-requests`)
11. RFPs (`/admin/rfps`)
12. Consultations (`/admin/consultations`)
13. Resource Requests (`/admin/resource-drafts`)
14. Platform Settings (`/admin/settings`)

**Active state indicator:** The active/current item is clearly indicated with a light navy background (`bg-primary/10`, which renders as `rgba(11, 38, 83, 0.1)`) and navy text (`rgb(11, 38, 83)`). Inactive items have transparent backgrounds with gray text (`rgb(55, 65, 81)`) and include `hover:bg-gray-100` for hover feedback. All items share the same font size (14px), font weight (500/medium), padding (8px 12px), and border-radius (8px). The styling is consistent and the active state is clearly distinguishable.

**Responsive behavior:** At smaller viewports (tested at 768px), the sidebar transforms into an overlay that slides in from the left, with a hamburger menu button in the top-right of the header. This is a functional responsive pattern, though the sidebar overlay covers the content area when open.

---

## 2. STAT CARDS

The dashboard displays **6 stat cards** under the "Performance Snapshot" section header. They are arranged in a responsive **6-column grid** (`grid-cols-2 sm:grid-cols-3 lg:grid-cols-6`).

| # | Label | Value | Badge |
|---|---|---|---|
| 1 | Total Revenue | €0 | — |
| 2 | Total Users | 43 | 86% active (green) |
| 3 | New This Week | 0 | -100% (red, down arrow) |
| 4 | New This Month | 0 | -100% (red) |
| 5 | Organizations | 25 | 1 reqs |
| 6 | Active B2B | 14 | — |

**Consistent styling:** All 6 cards share identical dimensions (179×125px), border-radius (8px), white background, and shadow. Each card has a colored circular icon at the top, a large bold value (24px, weight 700), and a small label below (10px, weight 500, gray). The value text is consistently `rgb(17, 24, 39)` (near-black) and labels are `rgb(107, 114, 128)` (gray).

**Grid alignment:** Cards are perfectly aligned in a single row at desktop width with equal 12px (gap-3) gutters between them.

**Additional dashboard widgets (below the stat cards):** The dashboard is densely packed with additional content panels including an Opportunities Pipeline bar chart, Business Activity list, Ecosystem Breakdown donut chart, User Status donut chart, User Engagement metrics, Signup Trend line chart, Revenue Trend line chart, Events Performance list, Tier Distribution horizontal bar chart, Insights & Recommendations alert cards, All Action Items grid (10 mini-cards), Recent Signups list, Recent Payments (empty state), and 4 quick-action buttons at the bottom (Manage Users, Add Resource, Add Event, Review Drafts). This is a comprehensive and well-organized dashboard.

---

## 3. DATA TABLES

I found data tables across multiple sections. Here's the analysis:

**Users Table (`/admin/users`):**
Column headers: Name, Organization, Persona, Tier, Reference, Access Status, Created. Headers are 16px, font-weight 500, left-aligned, with transparent background. The table contains 43 rows (matching the "43" stat card). Inline action controls include Persona dropdown (select) and Access Status dropdown per row. The Name column links to the user profile. The table wrapper has `overflow-x: auto`, enabling **horizontal scrolling on smaller screens** — I confirmed this works at 768px width where the rightmost columns scroll into view. There is a search bar and status/persona filter dropdowns above the table. Action buttons at the top include "2 Unconfirmed Emails" (warning), "Export CSV", and "Create Admin".

**Resources Table (`/admin/resources`):**
Columns: Title, Type, Access, Lang, Status, Actions. Has a clear Actions column with **edit (pencil icon) and delete (trash icon)** buttons per row. Very clean layout.

**Sponsorships Table (`/admin/sponsorships`):**
Columns: Organization, Current Tier, Requested Tier, Status, Date, Actions. Actions include a view (eye) icon per row. Status filter dropdown at the top.

**Expositions Table (`/admin/expositions`):**
Columns: Marina, Event, Status, Amount, Date, Actions. View icon per row.

**Marina Projects Table (`/admin/projects`):**
Columns: Marina, Type, Budget, Status, Date, Actions. Status is an inline dropdown select. View icon per row.

**Webinar Requests Table (`/admin/webinars`):**
Columns: Name, Requester, Lang, Status, Date, Actions. Status is an inline dropdown. View icon per row. Filter tabs at top (All, Submitted, Under Review, Accepted, Rejected).

**RFPs Table (`/admin/rfps`):**
Columns: Name, Marina, Deadline, Status, Actions. Actions include view icon and Close/Reopen button per row.

**Consultations Table (`/admin/consultations`):**
Columns: Name, Marina, Status, Date, Actions. View icon and Close/Reopen button per row.

**Resource Requests Table (`/admin/resource-drafts`):**
Columns: (Title + description), Type, Lang, Status, Submitter, Date, Actions. View icon per row.

**Non-table sections:**
Events (`/admin/events`) uses a **card-based list** rather than a table — each event is a horizontal card with date badge, title, type/access badges, location, and registration count. This is a deliberate and appropriate design choice for event data.

Partner Leads (`/admin/leads`) also uses a **card-based list** with lead name, type badge, country, contact info, temperature indicator (Cold/Warm/Hot), and status dropdown.

B2B Requests (`/admin/partner-requests`) uses a **card-based list** with sender → receiver format, message preview, time ago, status badge, and Accept/Reject action buttons.

**Empty state handling:** The dashboard's "Recent Payments" section displays **"No payments yet"** as a clear empty state message. However, I did not encounter any completely empty tables during testing (all sections had data), so I cannot confirm whether the table views themselves have dedicated empty state messages.

---

## 4. NAVIGATION FLOW

I clicked through **all 14 sidebar items** and every section loaded successfully. Here are the results:

| Section | URL | Status | Notes |
|---|---|---|---|
| Dashboard | `/admin` | ✅ Loads | Full dashboard with all widgets |
| Users | `/admin/users` | ✅ Loads | Table with 43 users |
| Resources | `/admin/resources` | ✅ Loads | Table with 9 resources |
| Events | `/admin/events` | ✅ Loads | Card list with 11 events |
| Sponsorships | `/admin/sponsorships` | ✅ Loads | Table with 2 requests |
| Expositions | `/admin/expositions` | ✅ Loads | Table with 1 request |
| Marina Projects | `/admin/projects` | ✅ Loads | Table with 7 projects |
| Partner Leads | `/admin/leads` | ✅ Loads | Card list with 6 leads |
| Webinar Requests | `/admin/webinars` | ✅ Loads | Table with 7 requests |
| B2B Requests | `/admin/partner-requests` | ✅ Loads | Card list with 8 requests |
| RFPs | `/admin/rfps` | ✅ Loads | Table with 6 RFPs |
| Consultations | `/admin/consultations` | ✅ Loads | Table with 6 consultations |
| Resource Requests | `/admin/resource-drafts` | ✅ Loads | Table with 5 drafts |
| Platform Settings | `/admin/settings` | ✅ Loads | Form with marketing stats |

**No errors, no blank pages, no broken sections.** Every sidebar item navigates correctly and renders content. The active sidebar indicator updates properly for each page. The page titles update to reflect the current section and include item counts (e.g., "Users (43)", "Events (11)").

---

## 5. TYPOGRAPHY

**Font family:** The entire admin panel uses **Inter** (with system-ui and sans-serif fallbacks) consistently across every element — headings, body text, labels, table headers, sidebar items, badges, and buttons. There is zero font variation, which is excellent.

**Heading hierarchy — issues found:**

The semantic heading levels don't follow a consistent size hierarchy:

The H1 "Dashboard" renders at 20px/700 weight. The H2 "Priority Actions Required" renders at 14px/700 weight with uppercase text-transform and 0.7px letter-spacing — this is actually **smaller** than the H1. Similarly, H3 "Performance Snapshot" renders at only 12px/700 weight with uppercase, making it the smallest heading on the page. Other H3 elements like "Opportunities Pipeline," "Business Activity," and "Ecosystem Breakdown" render at 14px/700 weight (normal case).

This means H3 headings are styled inconsistently: "Performance Snapshot" uses 12px uppercase while "Opportunities Pipeline" uses 14px normal case. While the semantic hierarchy (H1 > H2 > H3) is correct in the DOM, the visual sizing inverts in places (H3 at 14px is the same visual size as the H2 at 14px uppercase).

**Section label typography:** The small-caps/uppercase section labels like "PERFORMANCE SNAPSHOT" (12px, 700, gray, uppercase, 0.6px letter-spacing) and "ALL ACTION ITEMS" serve as visual section dividers. This pattern is used consistently for these divider-style headings.

**Body text and labels:** Dashboard stat values use 24px/700 weight. Stat labels use 10px/500 gray. Table headers use 16px/500. Table body text uses 14px/400. Sidebar items use 14px/500. Badges use 12px/600. This creates a clear and readable hierarchy within each section.

**Overall assessment:** The font family is perfectly consistent. The weight and size scaling within individual components (stat cards, tables, sidebar) is well-designed. The main issue is that the HTML heading levels (H1, H2, H3) don't map to a consistent visual size scale — the H2 can appear the same size as H3, and one H3 style (uppercase section divider) is smaller than another H3 style (widget title).

---

## Summary of Issues

**No critical issues found.** The admin panel is functional, well-organized, and loads without errors across all 14 sections.

**Minor issues:**

1. **Heading size inconsistency:** H2 (14px) and some H3s (14px) render at the same visual size; one H3 ("Performance Snapshot") renders at 12px while others render at 14px.
2. **No confirmed empty state for table views:** While the dashboard shows "No payments yet" for empty content, I couldn't verify whether the table-based sections (Users, Resources, etc.) have dedicated empty state messages when filtered to zero results.
3. **Users table lacks explicit action buttons column:** Unlike Resources (which has edit/delete icons) or RFPs (which has view/close buttons), the Users table relies on inline dropdown selects for Persona and Access Status changes. There is no dedicated "Actions" column header, which departs from the pattern used in other tables.
4. **Stat card label font size (10px)** is quite small and may pose readability challenges for some users. WCAG recommends a minimum of 12px for body text. |
| V-04 | Account `/account` | |# Account Page — Detailed Audit Report

---

## 1. STATUS BANNER

There is **no standalone status banner** at the top of the page. Instead, the user's verification status is shown as a **badge within a header card**.

The header area is a rounded card (`border-radius: 12px`) with a dark navy gradient background (`from-[#0b2653] to-[#143a6b]`), 104px tall and spanning the full content width. It contains the user's avatar, name, persona type, organization, and a verification badge positioned on the right side.

**Verification badge details:** The badge reads **"✓ Verified"** with a checkmark icon. It uses a green color scheme: light green background (`rgb(220, 252, 231)`), dark green text (`rgb(22, 101, 52)`), and a green border (`1px solid rgb(187, 247, 208)`). It's styled as a rounded pill (`border-radius: 9999px`) at 12px font size with semibold (600) weight.

**Color coding is correct:** The green palette appropriately signals a positive "verified" status. Based on the code pattern, it's reasonable to expect that pending would use yellow/amber and rejected would use red, though I can only confirm the verified state for this user.

The badge is visually clear and immediately visible against the dark navy background, though its position at the far right edge of the header card could make it easy to overlook on first glance — it's not the first thing the eye hits.

---

## 2. TABS

The page uses a **left sidebar navigation** (not horizontal tabs) that functions as the tab system. There are **10 tabs** visible:

| # | Tab Name | Loads? | Content |
|---|---|---|---|
| 1 | **Dashboard** | ✅ | Stats cards (Profile Views: 11, Connection Requests: 2, Pending Requests: 1), Recommended Resources list, Upcoming Events list, Quick Summary with counts |
| 2 | **Organization** | ✅ | Organization profile (M3 Monaco), badges (Owner, Associate Partner, Verified), general details, marina details with "Edit Organization" and "View Public Page" buttons |
| 3 | **Profile** | ✅ | Personal information (email, job title), account details (persona, status, role, registered date), organization info, "Preview my profile" button |
| 4 | **Registrations** | ✅ | "My Event Registrations" list — 4 confirmed events, with "Browse Events" button |
| 5 | **Projects** | ✅ | "My Projects" list — 2 projects (infrastructure, Environmental Certification), with "Submit a Project" button |
| 6 | **Webinars** | ✅ | "My Webinar Requests" — 1 accepted request, with "Propose a Webinar" button |
| 7 | **RFPs** | ✅ | "My RFPs" — 2 entries (1 Open, 1 Closed) with Close/Reopen and Delete actions, "Submit an RFP" button |
| 8 | **Consultations** | ✅ | "My Consultations" — 2 entries (both Open) with Close and Delete actions, "Request a Consultation" button |
| 9 | **B2B Requests** | ✅ | List of B2B connection requests with status badges (Pending, Accepted). Has a **red notification badge showing "1"** on the sidebar item |
| 10 | **Pricing** | ✅ | 3 pricing tiers (Member €0, Innovation Partner €3,000, Associate Partner €15,000) with current plan indicator and upgrade button |

**All 10 tabs load successfully** with appropriate content. No tab shows blank content, errors, or broken states. The active tab is visually highlighted with a navy background (`bg-primary/10`) and bold navy text, matching the admin panel's sidebar pattern.

**Notable feature:** The B2B Requests tab shows a red notification badge with "1" indicating an unread/pending item, which is a useful UX touch.

---

## 3. PROFILE INFORMATION

The Profile tab displays the following fields, all clearly populated:

**Personal Information section:**
- **Name:** Victor Meyer (displayed as H1 heading in header + repeated in profile body)
- **Email:** victor@m3monaco.com ✅
- **Job Title:** Marina Director ✅

**Account Details section:**
- **Persona:** Marina / Port ✅
- **Status:** Verified ✅
- **Organization Role:** Owner ✅
- **Registered:** March 3, 2026 ✅

**Organization section (within Profile tab):**
- **Organization:** M3 Monaco ✅ (with logo and "Manage organization →" link)
- **Country:** Monaco ✅
- **City:** Monaco ✅
- **Description:** Full paragraph about M3 Monaco ✅
- **Website:** https://www.m3monaco.com ✅

**No "null", "undefined", or blank values found.** I checked every text node in the profile section and all fields have proper values. The only "empty" text content detected was from IMG elements (profile photos), which is expected — images don't have text content.

The profile photo is present and renders correctly (a marina/port image), with a helpful "Hover photo to change" hint beneath it.

---

## 4. EDIT CAPABILITY

**Profile tab:** There is **no "Edit Profile" button** on the Profile tab. The profile information is displayed in read-only mode. The only interactive elements are the profile photo (with "Hover photo to change" hint) and a "Preview my profile" button at the bottom. Users cannot edit their name, email, job title, or other personal details from this view.

**Organization tab:** This tab **does** have edit capability. It shows three action buttons at the top: "View Public Page," **"Edit Organization,"** and "✨ Upgrade Tier." The "Edit Organization" button is clearly visible and would presumably enable form fields to modify the organization's details.

**This is a gap:** Users have no way to edit their personal profile fields (name, job title, email) from the Profile tab itself. The only edit capability is for the organization. If a user needs to change their name or job title, there's no obvious path to do so. This is a notable usability issue.

---

## 5. VISUAL HIERARCHY

**Header banner — strong hierarchy:**
The user's name "Victor Meyer" is the most prominent element, rendered at **24px, bold (700 weight), white text** on the dark navy gradient. The persona ("Marina / Port") and organization ("• M3 Monaco") appear directly below in **14px, regular (400 weight), semi-transparent white** (`rgba(255,255,255,0.8)`), creating a clear primary/secondary distinction. The verified badge sits at the right edge with its green pill format providing immediate status recognition.

**Dashboard stat cards — good emphasis:**
The three stat cards (Profile Views: 11, Connection Requests: 2, Pending Requests: 1) use large bold numbers as the visual anchor with smaller gray labels beneath, each accentuated by a distinct colored border-top (green, teal, orange) and a matching icon. These draw the eye effectively as key metrics.

**Profile tab sections — clear organization:**
Section headers like "PERSONAL INFORMATION" and "ACCOUNT DETAILS" use uppercase text with slightly smaller font size and gray color, functioning as visual dividers. Field labels (Email, Job Title, etc.) appear in light gray at a smaller font, with values beneath in darker, heavier text. This label-value pair pattern is consistent and easy to scan.

**Secondary information is appropriately de-emphasized:**
The "Registered: March 3, 2026" date uses the same label-value styling as other fields, which is appropriate — it doesn't compete with the name or status for attention. The sidebar navigation items use 14px medium-weight text with icons, maintaining a clean and subordinate visual presence relative to the main content area.

**One visual hierarchy concern:** The "Verified" badge in the header banner, while styled in green, sits far to the right and is relatively small (84×22px on a 1120px-wide banner). For such an important piece of information, it could benefit from being positioned closer to the user's name or made slightly larger. On the Organization tab, the same "Verified" badge appears more prominently alongside "Owner" and "Associate Partner" badges, which is more effective.

---

## Summary of All Findings

**What works well:**
- All 10 tabs load correctly with no errors or blank states
- Verification badge uses correct green color coding
- All profile fields are populated with no null/undefined values
- Clear visual hierarchy with name and status most prominent
- B2B Requests tab has a notification badge for pending items
- Dashboard tab provides a useful at-a-glance summary with recommended resources and events
- Organization tab has full edit capability

**Issues found:**

1. **No "Edit Profile" button on the Profile tab** — users cannot modify their personal information (name, job title, email). Only the Organization has an edit option. This is a significant usability gap.
2. **Verified badge placement** — positioned at the far right of the header banner, it's slightly easy to miss. On the Organization tab, the same information is displayed more prominently with multiple badges alongside the name.
3. **Sidebar active state inconsistency** — when switching tabs, the sidebar sometimes highlights "Webinars" when "Pricing" is the active tab (observed during the Pricing tab test). This appears to be a rendering glitch where the sidebar highlight doesn't always update immediately on scroll. |
| V-05 | Marketplace `/network` | |## Partners Page Audit — connect.m3monaco.com/partners

---

### 1. PARTNER CARDS

**Total visible: 11 cards** arranged in a 4-column grid (4 + 4 + 3).

| # | Company Name | Logo | Sectors Displayed | Country | Link to Detail |
|---|---|---|---|---|---|
| 1 | M3 Connect Operations | Initials "MC" (no real logo) | None | Monaco | ✅ `/organizations/m3-connect-operations` |
| 2 | OceanGuard Environmental | Initials "OE" | 2 shown + "+2" overflow badge | Norway | ✅ |
| 3 | MarinaTech Solutions | Initials "MS" | 2 shown + "+2" | France | ✅ |
| 4 | SmartDock Systems | Initials "SS" | 2 shown + "+2" | Singapore | ✅ |
| 5 | Mediterranean Marine Supplies | Initials "MM" | 2 shown + "+2" | France | ✅ |
| 6 | SecureMoor Technologies | Initials "ST" | 2 shown + "+3" | United Kingdom | ✅ |
| 7 | GreenPort Solutions | Initials "GS" | 2 shown + "+4" | Netherlands | ✅ |
| 8 | AquaDock Engineering | Initials "AE" | 2 shown + "+3" | Italy | ✅ |
| 9 | EnergiSea | Initials "E" | 2 shown + "+2" | Denmark | ✅ |
| 10 | SilvaNav Consulting | Initials "SC" | **None** | Portugal | ✅ |
| 11 | Incomplete Corp | Initials "IC" | **None** | United States | ✅ |

**Findings:**

- Every card shows the company name and country. All 11 cards are clickable links to their respective detail pages.
- **No real logos** on any card — all use a circular initials placeholder (e.g., "MC", "OE") in a grey circle with a gold arc accent. This is a data completeness gap; no actual company logos are uploaded.
- **Three cards have no sector tags at all**: M3 Connect Operations (#1), SilvaNav Consulting (#10), and Incomplete Corp (#11). These cards appear sparser than others, creating visual unevenness.

---

### 2. FILTER/SEARCH

A single search input is present at the top with placeholder text "Search by name, country, sector…". There are no additional filter dropdowns, category selectors, or faceted filters.

**Testing results:**

- **Search by name** ("MarinaTech"): Correctly filters to show only MarinaTech Solutions. ✅
- **Search by country** ("France"): Returns MarinaTech Solutions and Mediterranean Marine Supplies — both France-based. ✅
- **Search by sector** ("Environmental"): Returns OceanGuard Environmental and GreenPort Solutions — both with environmental sector tags. ✅
- **No results state** (searched "zzzzxxxxxxxnoresults"): Displays a centered icon with the message "No partners match your search." This is a clean, user-friendly empty state. ✅

**Issue:** There is no "Clear search" button or "X" icon in the search field. Users must manually select and delete their text to reset the results. On the Resources page, the empty state has a "Clear filters" button — the Partners page lacks this.

---

### 3. SECTOR TAGS

**Styling consistency:** There are exactly two visual styles, and they are applied consistently across all cards:

- **Sector tags** — Gold/amber background (`rgb(215, 166, 71)`) with navy text (`rgb(11, 38, 83)`), 12px font size, fully rounded pill shape (`border-radius: 9999px`). Consistent across all 16 sector tag elements.
- **"+N" overflow badges** — Transparent background with dark text and a visible border, same pill shape and font size. Consistent across all 8 "+N" elements. These clearly indicate additional sectors beyond the 2 shown.

**Tag wrapping:** Tags use `flex-wrap` in a centered, gapped container. When a tag's text is long (e.g., "Biodiversity Protection & Nature-based Solutions" at 274px wide), the text wraps within the badge itself to a second line (38px height vs. the normal 22px). This is functional but creates a visually chunkier badge. The container handles multiple tags and wrapping lines well — no overflow or clipping observed.

**No issues found** with tag consistency or wrapping behavior. ✅

---

### 4. DETAIL VIEW

Clicking a card navigates to `/organizations/[slug]`. I tested three detail pages:

**OceanGuard Environmental (fully populated):**
- Header: Company name, "Partner" badge, location ("Oslo, Norway"), website link (www.oceanguard.no with external link icon), member count ("2 members")
- "About" tab with: Description paragraph, Service Sectors (4 gold tags displayed — all sectors shown, not truncated like on the card), Details section with Type, Location, Headquarters, and Website
- ✅ Complete

**SilvaNav Consulting (no sectors on card):**
- Header: Company name, "Partner" badge, location, website, member count
- Description present, Details present (Type, Location, Website)
- **Service Sectors section is entirely absent** (not shown as empty, just omitted)
- Mostly complete ✅

**Incomplete Corp (minimal data):**
- Header: Company name, "Partner" badge + gold "Main Sponsor" badge, location ("Miami, United States"), member count
- **No website link** in header
- **No Description section** — completely missing
- **No Service Sectors section** — completely missing
- **No Headquarters** in Details
- Details only shows: Type (Partner) and Location
- ⚠️ This is a clear data completeness issue — the page looks very empty

**Additional issue on detail pages:** The member count displays "1 members" (with plural "members" even when count is 1). This is a grammar bug — it should read "1 member."

---

### 5. LAYOUT

**Grid structure:** The page uses a CSS Grid with responsive breakpoints: 2 columns on small screens (`grid-cols-2`), 3 on medium (`md:grid-cols-3`), and 4 on large (`lg:grid-cols-4`). Gap is 24px (`gap-6`). At the current viewport (1439px), it displays as a 4-column grid.

**Card width uniformity:** All 11 cards are exactly 324px wide. ✅

**Card height behavior:** Cards within the same row are equal height due to the `h-full` CSS class, but heights vary between rows based on content:

- **Row 1** (cards 1–4): 296px each
- **Row 2** (cards 5–8): 280px each
- **Row 3** (cards 9–11): 254px each

This is acceptable behavior — within each row, cards are perfectly aligned. The height difference between rows is driven by content volume (more/fewer tags and longer/shorter names).

**Last row balance:** Row 3 has only 3 cards in a 4-column grid, leaving the rightmost column empty. The 3 cards are left-aligned. This is standard CSS Grid behavior and is visually acceptable, though centering the 3 cards or using a different layout strategy for partial rows could look more polished.

**Visual balance overall:** The page is clean and well-structured. Content is centered, the search bar is appropriately sized, and spacing is consistent.

---

### Summary of Issues

| Severity | Issue | Location |
|---|---|---|
| **Medium** | No real logos uploaded — all cards use initials placeholders | All 11 cards |
| **Medium** | "Incomplete Corp" detail page is severely incomplete (no description, no sectors, no website, no HQ) | `/organizations/incomplete-corp` |
| **Low** | 3 cards have no sector tags, making them visually sparse | Cards #1, #10, #11 |
| **Low** | Grammar bug: "1 members" should be "1 member" | Detail pages with 1 member |
| **Low** | No "Clear search" button or X icon in the search field | Search input |
| **Low** | Service Sectors section silently omitted on detail pages when empty (no "No sectors listed" message) | Detail pages without sectors |
| **Minor** | Long sector tag text wraps inside the badge pill (multi-line badge) | OceanGuard card, Mediterranean Marine Supplies card | |

### Navigation & Links (N-01 to N-03)

| Test ID | Page | Status | Findings |
|---------|------|--------|----------|
| N-01 | Any (full nav audit) | |## Navigation Link Audit — connect.m3monaco.com/partners

---

### 1. NAVBAR LINKS

The top navigation bar contains two areas: a **main link bar** (always visible) and a **user dropdown menu** (under the Victor Meyer avatar).

**Main Navbar Links (always visible):**

| # | Visible Text | URL | Loads Correctly | Active State Works |
|---|---|---|---|---|
| 1 | [Logo] M3 Connect | `/` | ✅ Homepage | N/A (logo, no active state) |
| 2 | Home | `/` | ✅ Homepage | ✅ |
| 3 | Resources | `/resources` | ✅ Resource Library | ✅ |
| 4 | Events | `/events` | ✅ Events & Webinars | ✅ |
| 5 | Partners | `/partners` | ✅ Our Partners | ✅ |
| 6 | Network | `/network` | ✅ Partner Directory / Open RFPs / Open Consultations | ✅ |
| 7 | Become a Member | `/become-partner` | ✅ Join M3 Connect | ✅ |
| 8 | 🌐 (Globe icon) | N/A | Language toggle button ("Switch to French") | N/A |

**User Dropdown Menu (click Victor Meyer avatar):**

| # | Visible Text | URL | Loads Correctly |
|---|---|---|---|
| 1 | My Account | `/account` | ✅ Account dashboard |
| 2 | My Registrations | `/account?tab=registrations` | ✅ Account with registrations tab |
| 3 | Submit Project | `/submit-project` | ✅ Submit a Project Need form |
| 4 | Submit an RFP | `/submit-rfp` | ✅ Submit a Request for Proposals form |
| 5 | Request Consultation | `/submit-consultation` | ✅ Request a Consultation form |
| 6 | Propose Webinar | `/request-webinar` | ✅ Propose a Webinar form |
| 7 | Logout | (button, no URL) | ✅ Functional button |

**Assessment against your required items:**

| Required Item | Present? | Location | Notes |
|---|---|---|---|
| Home | ✅ | Main navbar | `/` |
| Resources | ✅ | Main navbar | `/resources` |
| Events | ✅ | Main navbar | `/events` |
| Marketplace/Partners | ⚠️ Partial | Main navbar shows **"Partners"** (`/partners`) and **"Network"** (`/network`) as separate links | There is no single "Marketplace" link. The label "Partners" shows partner cards; "Network" shows the full directory with RFPs and consultations. The homepage (logged out) has an "Explore the Marketplace" CTA that points to `/marketplace`, which **redirects to `/network`** — not `/partners`. This naming split may confuse users. |
| Submit Project (marina-only) | ✅ | User dropdown under "ACTIONS" | `/submit-project` |
| Propose Webinar (verified users) | ✅ | User dropdown under "ACTIONS" | `/request-webinar` |
| Account | ✅ | User dropdown | `/account` |
| Logout | ✅ | User dropdown (red text at bottom) | Button — no href |

**⚠️ Issues found:**

- **"Submit Project" and "Propose Webinar" are not directly visible in the main navbar.** They are hidden inside the user dropdown menu under "ACTIONS." A marina user must click their avatar, then look for these items. They are also in the mobile hamburger menu but not exposed in the desktop top bar.
- **Two extra action items** are in the dropdown that weren't in your required list: "Submit an RFP" (`/submit-rfp`) and "Request Consultation" (`/submit-consultation`). These are bonuses but worth noting.
- **"My Registrations"** is an extra convenience shortcut to `/account?tab=registrations`.

---

### 2. FOOTER LINKS

The footer is organized into three columns plus social icons.

| Section | Link Text | URL | Status |
|---|---|---|---|
| **Social** | LinkedIn | `https://www.linkedin.com/company/monaco-marina-management` | ✅ External, `target="_blank"` |
| **Social** | Instagram | `https://www.instagram.com/monacomarinamanagement/` | ✅ External, `target="_blank"` |
| **Platform** | Resources | `/resources` | ✅ 200 — loads "Resource Library" |
| **Platform** | Events | `/events` | ✅ 200 — loads "Events & Webinars" |
| **Platform** | Partners | `/partners` | ✅ 200 — loads "Our Partners" |
| **Platform** | Become a Member | `/become-partner` | ✅ 200 — loads "Join M3 Connect" |
| **Company** | About | `/about` | ✅ 200 — loads "About M3 Connect" |
| **Company** | Contact | `/contact` | ✅ 200 — loads "Contact Us" |
| **Legal** | Terms of Service | `/terms` | ✅ 200 — loads "Terms of Use" |
| **Legal** | Privacy Policy | `/privacy` | ✅ 200 — loads "Privacy Policy" |
| **Legal** | Legal Notice | `/mentions-legales` | ✅ 200 — loads "Legal Notice" |
| **Legal** | Commercial Terms | `/conditions-commerciales` | ✅ 200 — loads "Commercial Terms for Paid Offers and Partners" |
| **Legal** | Cookie Policy | `/cookies` | ✅ 200 — loads "Cookie Policy" |

**All 13 footer links verified — zero 404 errors.** Every internal link loads a page with real content (not a blank shell). Both external social links open in new tabs.

**⚠️ Minor note:** The footer has no link to "Home" (`/`) or "Network" (`/network`), though these are in the main navbar. The footer also doesn't include the action links (Submit Project, etc.), which is reasonable.

---

### 3. LOGO LINK

The "M3 Connect" logo/brand text (ref `[ref_5]`) at the top-left links to `/` (homepage). **Clicking it successfully navigates to the homepage.** ✅

---

### 4. ACTIVE STATE

**How it works:** The active nav link receives the CSS classes `text-primary bg-primary/5`, which renders it in dark navy (`rgb(11, 38, 83)`) with a subtle blue-tinted background, plus a bottom underline. Inactive links use `text-gray-600` (gray, `rgb(75, 85, 99)`).

**Testing results for each main nav destination:**

| Page | Active Link Highlighted | Visual Indicator |
|---|---|---|
| `/` (Home) | ✅ "Home" | Navy text + underline + light bg |
| `/resources` | ✅ "Resources" | Same |
| `/events` | ✅ "Events" | Same |
| `/partners` | ✅ "Partners" | Same |
| `/network` | ✅ "Network" | Same |
| `/become-partner` | ✅ "Become a Member" | Same |
| `/account` | ❌ **No active link** | All nav items appear gray/inactive |
| `/submit-project` | ❌ **No active link** | All nav items appear gray/inactive |
| `/request-webinar` | ❌ **No active link** | All nav items appear gray/inactive |

**⚠️ Issue:** When the user navigates to any dropdown-only page (`/account`, `/submit-project`, `/submit-rfp`, `/submit-consultation`, `/request-webinar`), no navbar link is highlighted. The user loses their sense of place in the site hierarchy. These pages could benefit from either adding a breadcrumb or lightly highlighting a parent nav item.

---

### 5. CTA BUTTONS

The Partners page itself has **no CTA buttons** in the main content area — only the partner card links and the search input. There is no "Add Partner," "Get Started," or promotional CTA.

For reference, here are the CTAs found on the homepage (the only pages with prominent CTAs):

**Authenticated homepage** (logged in as Victor Meyer):

| CTA Text | URL | Working |
|---|---|---|
| Explore Resources → | `/resources` | ✅ |
| My Account | `/account` | ✅ |

**Unauthenticated homepage** (logged out — from prior audit):

| CTA Text | URL | Working | Issue? |
|---|---|---|---|
| Join Now — It's Free → | `/become-partner` | ✅ | — |
| Explore the Marketplace | `/marketplace` | ⚠️ | **Redirects to `/network`**, not `/partners`. This creates a disconnect: the navbar has both "Partners" and "Network" as separate pages, but the homepage CTA called "Marketplace" goes to Network. |

---

### Summary of Issues

| Severity | Issue | Details |
|---|---|---|
| **Medium** | Submit Project & Propose Webinar hidden in dropdown | The user's required items "Submit Project" and "Propose Webinar" are only accessible via the avatar dropdown menu, not visible in the main navbar. A marina user may not discover them without clicking on their profile. |
| **Medium** | "Marketplace" naming confusion | The logged-out homepage CTA "Explore the Marketplace" navigates to `/marketplace` which redirects to `/network`, while the navbar has a separate "Partners" link at `/partners`. These are two different pages, but the term "Marketplace" isn't used anywhere in the navbar — it maps to "Network" silently. |
| **Low** | No active state on dropdown-only pages | Visiting `/account`, `/submit-project`, `/submit-rfp`, `/submit-consultation`, or `/request-webinar` results in no navbar link being highlighted, leaving the user without a visual location indicator. |
| **None** | Dead links or 404s | **Zero issues found.** All 6 navbar links, 7 dropdown menu items, and 13 footer links load successfully with real content. | |
| N-02 | Protected routes | |## Protected Route Security Audit — connect.m3monaco.com

**Test conditions:** Unauthenticated session (logged out, no session cookie). All tests performed by directly navigating to each URL in the browser.

---

### Results Summary

| # | Route | Redirects? | Shows Protected Content? | Login Message? | Verdict |
|---|---|---|---|---|---|
| 1 | `/account` | ✅ → `/` (homepage) | ❌ No protected data exposed | ❌ No message | **Secure** (with UX concern) |
| 2 | `/admin` | ✅ → `/` (homepage) | ❌ No admin data exposed | ❌ No message | **Secure** (with UX concern) |
| 3 | `/submit-project` | ✅ → `/` (homepage) | ❌ No form content exposed | ❌ No message | **Secure** (with UX concern) |
| 4 | `/request-webinar` | ✅ → `/` (homepage) | ❌ No form content exposed | ❌ No message | **Secure** (with UX concern) |
| 5 | `/onboarding` | ✅ → `/` (homepage) | ❌ No onboarding content exposed | ❌ No message | **Secure** (with UX concern) |

**No security vulnerabilities found.** No protected content is rendered to unauthenticated users on any of the five routes.

---

### Detailed Findings Per Route

**1. /account → Redirects to `/` (homepage)**
The user's account dashboard, profile information, registrations, and organization data are never rendered. The redirect happens via client-side JavaScript before any user-specific API calls are made. The final page shows the public homepage with "Login" and "Sign Up" buttons. No toast, alert, or message tells the user why they were redirected.

**2. /admin → Redirects to `/` (homepage)**
This is the most critical route tested. The admin panel (which contains user tables, stat dashboards, settings, and moderation tools) is completely inaccessible. The server returns a generic 3,678-byte SPA shell with zero admin content embedded. No Supabase API calls for admin data are triggered. The client-side router checks auth state and immediately redirects to the homepage. No flash of admin UI was observed.

**3. /submit-project → Redirects to `/` (homepage)**
The project submission form (Project Type, Budget Range, Timeline, Description) is never rendered. The redirect prevents unauthenticated users from even seeing the form fields.

**4. /request-webinar → Redirects to `/` (homepage)**
The webinar proposal form is never rendered. Same redirect behavior as above.

**5. /onboarding → Redirects to `/` (homepage)**
The onboarding flow is never rendered. Same redirect behavior.

---

### Technical Details

The protection mechanism works as follows: the server returns an identical 3,678-byte SPA shell HTML for all routes (status 200), containing no route-specific data. The client-side JavaScript then checks the Supabase auth state, determines the user is not authenticated, and performs an immediate client-side redirect to `/`. No protected API endpoints are called during this process — only the public homepage data (partner organizations) is fetched after landing on `/`.

I confirmed this by inspecting network requests after navigating to `/admin`: the only Supabase API call made was a public query for verified partner organizations (the homepage content), not any admin, user, or session endpoints.

---

### UX Issue (Not a Security Issue)

While all 5 routes are securely protected, there is a consistent **user experience problem**: none of the redirects include any feedback to the user. When an unauthenticated user navigates to `/account`, `/admin`, `/submit-project`, `/request-webinar`, or `/onboarding`, they are silently dropped on the homepage with no indication of what happened.

**What the user experiences:** They type a URL (or click a bookmarked link), the page loads, and they see the homepage. There is no toast notification, no banner, no "Please log in to access this page" message, and no redirect to a login page. The user might not even realize they were redirected.

**Recommended fix:** Instead of silently redirecting to the homepage, the app should either redirect to a `/login` page with a return URL parameter (e.g., `/login?redirect=/account`), or display a brief toast message like "Please log in to access that page." This is standard practice and would significantly improve the experience for users who are trying to access protected content via direct links or bookmarks.

---

### Verdict

**Security: PASS** — All 5 protected routes properly prevent unauthenticated access. No protected content, user data, or admin functionality is exposed. The server-side HTML contains no sensitive data, and no protected API calls are made before the redirect.

**UX: NEEDS IMPROVEMENT** — Silent redirect to homepage with no login prompt or message. Users lose context about what they were trying to do and receive no guidance on how to proceed. |
| N-03 | Breadcrumbs/back | |## Detail Page Navigation Audit — connect.m3monaco.com

I tested navigation behavior across all three detail page types: organization profiles, resources, and events.

---

### 1. BACK NAVIGATION

Every detail page has a back link in the top-left of the content area (chevron icon + text). All three work correctly in that they navigate to a valid parent listing page.

| Detail Page Type | Back Link Text | Destination | Works? |
|---|---|---|---|
| Organization (`/organizations/...`) | "< View All Partners" | `/partners` | ✅ Navigates correctly |
| Resource (`/resources/...`) | "< Back to Resources" | `/resources` | ✅ Navigates correctly |
| Event (`/events/...`) | "< Back to Events" | `/events` | ✅ Navigates correctly |

**⚠️ Issue — Organization back link is hardcoded:** The organization detail page always displays "View All Partners" linking to `/partners`, regardless of where the user came from. I navigated to GreenPort Solutions from the **Network** page (`/network`), but the back link still pointed to `/partners`. This is misleading — if a user was browsing the Network directory (which includes all organization types, not just partners), clicking "View All Partners" takes them to a different page than where they were.

**⚠️ Inconsistent labeling:** The back link text varies in style across page types. Organizations use "View All Partners" (noun-focused), while resources and events use "Back to Resources" / "Back to Events" (action-focused). The organization label is also the only one that doesn't use the word "Back."

---

### 2. BROWSER BACK

I tested the browser back button from detail pages back to listing pages.

**Test A — Partners page with search filter → Organization detail → Browser back:**
- Applied a search filter ("France") showing 2 filtered results
- Clicked into MarinaTech Solutions
- Pressed browser back
- **Result:** Returned to `/partners` but the **search filter was lost** — the search box was empty and all 11 cards were showing again instead of the filtered 2. Scroll position was roughly restored (47px from top — near the top of the page, not where the clicked card was).

**Test B — Resources page → Resource detail → Browser back:**
- Scrolled down on the Resources page to the card grid area (scroll ~880px)
- Clicked into "The Future of Sustainable Marinas in the Mediterranean"
- Pressed browser back
- **Result:** Returned to `/resources` with **scroll position approximately preserved** (880px — in the card grid area). The type filter was on "All" (which was what we had before navigating away), so this was preserved. However, the search filter is not persisted in the URL.

**Root cause:** Neither the Partners nor Resources page stores filter/search state in the URL (no query parameters like `?search=France` or `?type=whitepaper`). This means the browser's history system cannot restore these states on back navigation. Scroll position is partially restored by the browser's native scroll restoration, but filter state is always reset.

---

### 3. BREADCRUMBS

**No breadcrumbs exist on any detail page.** None of the three page types (organization, resource, event) implement a breadcrumb trail. There is no `nav[aria-label="breadcrumb"]` or any breadcrumb-like UI element anywhere in the DOM.

Each page only provides a single back link. A user on a resource detail page sees "< Back to Resources" but has no hierarchical context like "Home > Resources > Article Title" that would show them where they are in the site structure.

This is a missed opportunity for navigation clarity, especially for users who arrive at a detail page via a direct link or search engine — they have no context about the page's place in the site hierarchy.

---

### 4. PAGE TITLE

All three detail page types correctly update the browser tab title to reflect the content. Each follows a "[Content Title] — M3 Connect" pattern, though there's a slight inconsistency:

| Page Type | Tab Title Format | Example |
|---|---|---|
| Organization | `{Name} — M3 Connect` | "GreenPort Solutions — M3 Connect" |
| Resource | `{Title} — M3 Connect` | "The Future of Sustainable Marinas in the Mediterranean — M3 Connect" |
| Event | `{Title} — Events — M3 Connect` | "World Yachting Summit 2026 — **Events** — M3 Connect" |

**⚠️ Minor inconsistency:** The event title includes an intermediate "Events" segment (`Title — Events — M3 Connect`) while organizations and resources do not include their section name. For consistency, all should follow the same pattern — either all include the section or none do.

---

### 5. URL STRUCTURE

| Page Type | URL Pattern | Example | Readable? |
|---|---|---|---|
| Organization | `/organizations/{slug}` | `/organizations/greenport-solutions` | ✅ Clean, human-readable slug |
| Resource | `/resources/{uuid}` | `/resources/f1000007-0000-4000-8000-000000000007` | ❌ Raw UUID, not readable |
| Event | `/events/{uuid}` | `/events/5d7eaf71-c189-4956-9515-655f4f630ec1` | ❌ Raw UUID, not readable |

**⚠️ Issue — Inconsistent URL strategy:** Organizations use clean, SEO-friendly slugs (`greenport-solutions`), while resources and events use raw UUIDs. This creates several problems: resource and event URLs are not shareable in a meaningful way (a user can't glance at the URL and understand what it leads to), they are poor for SEO, and the inconsistency suggests different implementation approaches across page types.

For comparison, a clean URL would look like `/resources/future-of-smart-marinas-iot-trends-2026` or `/events/world-yachting-summit-2026` — the organization pages already demonstrate this is achievable on this platform.

---

### Summary of Issues

| Severity | Issue | Details |
|---|---|---|
| **Medium** | Search/filter state lost on browser back | Partners page search filter and any applied filters are not stored in the URL, so browser back always resets to the default unfiltered view. Users lose their search context. |
| **Medium** | Organization back link is hardcoded to `/partners` | Navigating to an organization from the Network page (`/network`) still shows "View All Partners" linking to `/partners`, not back to the Network where the user came from. |
| **Medium** | No breadcrumbs on any detail page | Users arriving via direct links have no hierarchical context. Only a single back link is provided with no "Home > Section > Page" trail. |
| **Low** | Resource and event URLs use raw UUIDs | `/resources/f1000007-...` is not human-readable or SEO-friendly, unlike the clean slug-based organization URLs (`/organizations/greenport-solutions`). |
| **Low** | Inconsistent back link labeling | Organizations: "View All Partners"; Resources: "Back to Resources"; Events: "Back to Events" — different phrasing styles. |
| **Low** | Event page title includes section name, others don't | Event: "Title — Events — M3 Connect" vs. Organization/Resource: "Title — M3 Connect". Minor inconsistency. | |

### Form Validation (F-01 to F-05)

| Test ID | Page | Status | Findings |
|---------|------|--------|----------|
| F-01 | Signup form | |## Audit 9: Signup Form Validation — Complete Report

The signup form is located at `/become-partner`, triggered by clicking "Join as a Marina" (or similar profile buttons), opening a modal dialog titled "Create an Account."

---

### 1. EMPTY SUBMISSION

**Result:** The browser's native HTML5 validation fires. Focus is moved to the first invalid required field (First Name), and the browser shows its **native tooltip**: `"Please fill in this field."` No custom inline error messages appear. No red borders. No custom validation UI.

**Validation messages:** Only the native browser tooltip on the first empty required field. The other 5 empty required fields are not flagged until the first one is fixed.

**Display method:** Native browser tooltip (OS-level popup near the field). No inline text, no toast, no modal.

**Assessment:** ⚠️ Relying solely on native browser validation with no custom messaging is a poor UX pattern — messages vary by browser/language, only one field is flagged at a time, and the tooltips are transient and easy to miss.

---

### 2. INVALID EMAIL

**Result:** With "notanemail" in the email field and all other fields valid, clicking "Create my account" triggers native HTML5 `typeMismatch` validation. The browser shows a native tooltip:

> `"Please include an '@' in the email address. 'notanemail' is missing an '@'."`

**Display method:** Native browser tooltip only. No custom inline error, no red border on the email field, no toast.

**Assessment:** ⚠️ The error message is functional but browser-generated. No custom styling or persistent error indicator.

---

### 3. SHORT PASSWORD

**Result:** With "abc" typed into the Password field (which has `minLength="8"`) and all other fields valid, clicking submit triggers native HTML5 `tooShort` validation:

> `"Please lengthen this text to 8 characters or more (you are currently using 3 characters)."`

The Password placeholder helpfully says "Min. 8 characters," which is good. However, there is no custom inline message or visual indicator. The Confirm Password field has **no minLength attribute** — it accepts any length.

**Display method:** Native browser tooltip only. No red border, no inline error.

**Assessment:** ⚠️ The placeholder hint is helpful, but the lack of a persistent error message is problematic. Also, the Confirm Password field should arguably enforce the same minLength.

---

### 4. PASSWORD MISMATCH

**Result:** 🐛 **BUG — No error message whatsoever.** With valid data in all fields (valid email, 14-character matching passwords except Confirm Password deliberately different), checking the terms checkbox, and clicking submit: the form **silently does nothing**. No error message, no toast, no inline message, no red border, no console log. The React `onSubmit` handler detects the mismatch and simply returns without feedback.

Additionally tested: with mismatched passwords and checkbox **unchecked**, the form also silently blocks with no feedback.

**Display method:** None — complete silence.

**Assessment:** 🔴 **Critical UX bug.** The user receives zero feedback about why submission failed. They would have no idea their passwords don't match.

---

### 5. EXISTING EMAIL

**Result:** 🐛 **BUG — Silent redirect with no error message.** With all fields valid (matching passwords, checkbox checked) and using the known existing email `victor@m3monaco.com`, clicking submit causes the form to:
1. Make a background request to check `organizations?primary_domain=eq.m3monaco.com`
2. Redirect to the homepage (`/`)
3. Show **no error message, no toast, no feedback** of any kind
4. The user remains logged out

No Supabase `auth/signup` call was observed in network traffic for the existing email case — the form appears to redirect before or without making the auth call.

**Display method:** None — silent redirect to homepage.

**Assessment:** 🔴 **Critical UX bug.** The user fills out an entire form, clicks submit, and is dumped on the homepage with no indication of success or failure. They cannot tell if their account was created, if the email already exists, or what went wrong. (Note: Supabase deliberately returns the same response for existing emails to prevent enumeration, but the frontend should show a generic success message like "Check your email for a confirmation link.")

---

### 6. FIELD INDICATORS

**Required field markers:**
| Field | Asterisk (*) | `required` attribute |
|---|---|---|
| First Name * | ✅ Yes | ✅ Yes |
| Last Name * | ✅ Yes | ✅ Yes |
| Job Title | ❌ No | ❌ No (optional) |
| Professional Email * | ✅ Yes | ✅ Yes |
| Company / Organization Name * | ✅ Yes | ✅ Yes |
| Company Website | ❌ No | ❌ No (optional) |
| Password * | ✅ Yes | ✅ Yes |
| Confirm Password * | ✅ Yes | ✅ Yes |

**Assessment:** ✅ Asterisks are correctly placed on all 6 required fields and absent from the 2 optional fields.

**Invalid field styling:** 🔴 **None.** All fields have the same border color (`rgb(226, 232, 240)` — light gray) regardless of validity state. There are no CSS rules targeting the `:invalid` pseudo-class. Invalid fields get no red border, no highlight, no icon, and no inline error text. The checkbox (terms acceptance) also has no visual error state when unchecked.

---

### 7. REAL-TIME vs SUBMIT

**Result:** Validation is **submit-only** for HTML5 constraints, and even then only via native browser tooltips. Tested scenarios:

- **Blur (tab out) from invalid email:** No error shown. Border stays gray. Email matches `:invalid` but no CSS targets it.
- **Blur from short password:** No error shown. Border stays gray. Password matches `:invalid` but no CSS targets it.
- **Keyup/typing:** No real-time validation fires during typing.
- **Submit click:** HTML5 native validation tooltip appears on the first invalid field. For custom checks (password match, checkbox), no error is shown at all.

**Assessment:** 🔴 **No real-time validation exists.** All validation is submit-only, and even submit validation is incomplete (password mismatch and checkbox are silently blocked with no user feedback).

---

### Summary of Issues

| # | Severity | Issue |
|---|---|---|
| 1 | 🔴 Critical | Password mismatch produces zero feedback — silent form block |
| 2 | 🔴 Critical | Existing email submission silently redirects to homepage with no message |
| 3 | 🔴 Critical | Unchecked terms checkbox silently blocks submission with no error |
| 4 | 🟠 Major | No custom inline validation messages — relies entirely on browser tooltips |
| 5 | 🟠 Major | No red borders or visual indicators on invalid fields |
| 6 | 🟠 Major | No real-time (blur/keyup) validation — everything is submit-only |
| 7 | 🟡 Minor | Confirm Password field lacks `minLength` attribute (Password has `minLength=8`) |
| 8 | 🟡 Minor | No CSS rules for `:invalid` pseudo-class on any form inputs | |
| F-02 | Onboarding (marina) | | |
| F-03 | Submit project | |## Audit 10: Project Submission Form — Complete Report

**URL:** `/submit-project`
**Page title:** "Submit a Project Need"
**Subtitle:** "Tell us about your project and we will connect you with the right partners."
**Access control:** Only verified marina organizations can access this form. Non-marina users (e.g., "Events Team") see an "Access Restricted — Only verified marina organizations can submit projects" message with a lock icon.

---

### 1. FORM FIELDS

The form is inside a card labeled "Project Details — Tell us about your project needs." It has **4 fields + 1 consent checkbox + 1 submit button**. No file upload, no title field, no sector selector.

| # | Label | Type | Required | Options / Details |
|---|---|---|---|---|
| 1 | **Project Type \*** | Select (combobox dropdown) | ✅ Yes | Energy, Digital, Infrastructure, Services, Other |
| 2 | **Budget Range \*** | Select (combobox dropdown) | ✅ Yes | Under €10,000 · €10,000–€50,000 · €50,000–€100,000 · €100,000–€500,000 · Over €500,000 |
| 3 | **Timeline \*** | Select (combobox dropdown) | ✅ Yes | 0-12 months · 12-24 months · 24+ months |
| 4 | **Project Description \*** | Textarea (5 rows) | ✅ Yes | Placeholder: "Describe your project needs, goals, and any specific requirements..." |
| 5 | **I consent to M3 Connect processing this information** | Checkbox (Radix UI) | ❌ No (`required=false`) but functionally required to enable submit | — |
| 6 | **Submit Project** | Submit button | — | Disabled at 50% opacity until ALL fields + checkbox are filled |

**Notable observations:**

There is **no project title field** — the submitted project uses the Project Type value (e.g., "energy", "digital") as its display name on the account page. This is a significant UX gap since all "Energy" projects would show the same generic name. There is no file upload field, no sector/category multi-select, and no contact information fields. The form is notably minimal with just 4 fields.

---

### 2. EMPTY SUBMISSION

The submit button uses a **disabled-until-valid** pattern rather than validation messages. When no fields are filled, the "Submit Project" button is visually disabled (`opacity: 0.5`, `disabled: true`, `cursor: default`). Clicking it does nothing — no validation messages appear, no error text, no field highlighting.

When forcibly enabled via JavaScript and clicked with an empty form, the browser's native HTML5 validation fires on the textarea showing "Please fill in this field." The three hidden `<select>` elements have pre-selected default values (first option), so they pass validation even when the visible combobox triggers still show "Select..."

**Button enable conditions** — all of the following must be true: all 3 dropdowns selected, textarea non-empty, AND consent checkbox checked. The button enables dynamically as the user fills fields, without any error messages for incomplete fields.

**Assessment:** ⚠️ The disabled-button approach prevents submission errors but provides **no guidance** about which fields still need to be filled. A user stuck with a faded button wouldn't know what's missing.

---

### 3. CHARACTER LIMITS

**Textarea:** `maxLength: none (-1)`, `minLength: none (-1)`. The textarea accepted 5,000 characters without any issue. There is no character counter visible anywhere on the page, no visible limit, and no soft limit. The textarea is resizable (bottom-right drag handle visible).

**Select fields:** Not applicable — they use predefined options.

**Assessment:** ⚠️ No character counter and no max length means users could submit extremely long descriptions. A character counter and reasonable limit (e.g., 2,000 characters) would be advisable.

---

### 4. SECTOR SELECTION

**There is no sector/category selector on this form.** The only categorization is the "Project Type" dropdown, which is a single-select with 5 options (Energy, Digital, Infrastructure, Services, Other). It uses Radix UI Select component, which displays a dropdown list. Once an option is selected, it shows in the trigger button. You can change the selection by opening the dropdown again, but there is no deselect/clear — once selected, it stays selected until a different option is chosen.

**Assessment:** The form lacks granularity. A multi-select sector field would help match projects with relevant partners more effectively.

---

### 5. BUDGET FIELD

**Type:** Single-select dropdown with predefined EUR ranges.

**Options:** Under €10,000 · €10,000–€50,000 · €50,000–€100,000 · €100,000–€500,000 · Over €500,000

**Format:** Predefined ranges only — no free text input, no exact number entry, no currency selector. All values are displayed in euros (€) with thousands separators. The underlying values use snake_case keys (e.g., `under_10k`, `10k_50k`, `50k_100k`, `100k_500k`, `over_500k`).

**Assessment:** ✅ The range approach is appropriate for a project inquiry form where exact budgets may not be known upfront. The EUR-only currency is suitable for a Monaco-based platform. No currency formatting issues since it's all predefined text.

---

### 6. SUBMIT BEHAVIOR

Tested with two successful submissions. The sequence is:

**Loading state:** ✅ Yes — the button text changes from "Submit Project" to **"Loading..."**, the button becomes disabled (`disabled: true`), and opacity drops to 0.5. This loading state lasted approximately **728ms** in testing.

**Disabled during submission:** ✅ Yes — prevents double submission.

**Confirmation message:** ✅ A toast notification appears: **"Project submitted! Our team will contact you soon."** The toast appears in the bottom area of the viewport within the `[aria-label="Notifications (F8)"]` region. It auto-dismisses after a few seconds.

**Redirect:** ❌ No redirect. The form stays on `/submit-project` and resets to its empty state (all dropdowns back to "Select...", textarea cleared, checkbox unchecked, submit button disabled). The user remains on the same page.

**Verification:** The submitted project appears immediately on the `/account?tab=projects` page, displayed with the Project Type as its name (e.g., "energy"), today's date, the budget range, and a "new" status badge.

**Assessment:** The submit behavior is functional. One concern: the form resets without redirecting, so a user could accidentally submit multiple identical projects. A redirect to the projects list or a persistent success state would be better.

---

### 7. DRAFT CAPABILITY

**Save as Draft:** ❌ No draft/save button exists. The only button on the form is "Submit Project."

**Auto-save:** ❌ No auto-save. No data is stored in `localStorage` or `sessionStorage`. Navigating away from the form loses all entered data with no "unsaved changes" warning.

**Assessment:** 🟠 Missing feature. For a form that involves project descriptions and budget decisions, users may want to save progress and return later. No browser-level `beforeunload` warning is shown either, so closing the tab or navigating away silently loses all input.

---

### Summary of Issues

| # | Severity | Issue |
|---|---|---|
| 1 | 🟠 Major | **No project title field** — project type value is used as the display name, leading to generic names like "energy" or "digital" |
| 2 | 🟠 Major | **No draft/auto-save capability** — navigating away loses all entered data without warning |
| 3 | 🟠 Major | **No guidance on which fields are incomplete** — the disabled button provides no indication of what's missing |
| 4 | 🟡 Minor | **No character counter or limit** on the description textarea — unlimited input accepted |
| 5 | 🟡 Minor | **Consent checkbox label lacks asterisk (\*)** despite being functionally required to enable submission — inconsistent with the 4 other required fields |
| 6 | 🟡 Minor | **No redirect after submission** — form resets in place, allowing accidental duplicate submissions |
| 7 | 🟡 Minor | **Toast dismisses automatically** — no persistent success state for confirmation |
| 8 | ℹ️ Info | Only 4 fields + checkbox — very minimal for a project submission; no file attachments, no sector tags, no contact info collected |
| 9 | ℹ️ Info | Non-marina accounts see a proper "Access Restricted" page with a lock icon — good access control UX (better than the silent redirect on protected routes found in Audit 7) | |
| F-04 | Contact form | |## Audit 11: Contact Form — Complete Report

**URL:** `/contact`
**Page title:** "Contact Us"

### Critical Finding: No Contact Form Exists

The contact page at `/contact` contains **no contact form whatsoever**. The entire page consists of:

- **Heading:** "Contact Us" (with a screen-reader-only subheading "Contact Information")
- **Email card:** An envelope icon, the heading "Email", and a mailto link to `contact@m3connect.mc`
- **Address card:** A pin icon, the heading "Address", and static text "Monaco Marina Management / Monaco"

I verified this through multiple methods: visual inspection, accessibility tree (`0 form elements`, `0 inputs`, `0 textareas`, `0 submit buttons`), full DOM inspection, iframe check (none), external form script check (no HubSpot, Typeform, Google Forms, or similar embeds), and the French-language version (identical structure, no form).

---

### Answers to Each Test Item

**1. FIELDS PRESENT:** None. There is no contact form. The page only provides a mailto email link and a physical address.

**2. EMPTY SUBMISSION:** N/A — no form to submit.

**3. INVALID EMAIL:** N/A — no email input field exists.

**4. LONG MESSAGE:** N/A — no message textarea exists.

**5. SUCCESS STATE:** N/A — no submission mechanism exists.

**6. SPAM PROTECTION:** N/A — with no form, there are no hidden fields, no CAPTCHA, no honeypot. The only contact method is a `mailto:contact@m3connect.mc` link which opens the user's native email client.

---

### Assessment

| # | Severity | Issue |
|---|---|---|
| 1 | 🔴 Critical | **No contact form on the contact page** — the footer links "Contact" from every page on the site, setting the expectation that users can contact the team directly. Instead they land on a page with only an email address and a physical address. |
| 2 | 🟠 Major | **No structured way to send inquiries** — forcing users to use their email client (mailto link) means the platform has no record of inquiries, no ability to route by topic, and a high-friction contact experience. |
| 3 | 🟡 Minor | **Sparse page content** — the page is visually empty with just two small cards and a lot of white space, followed immediately by the footer. It looks incomplete or under construction. |

A contact form with fields like Name, Email, Subject, and Message would be standard for a B2B platform. This would allow the platform to track inquiries, auto-respond with confirmations, and route messages appropriately. |
| F-05 | Payment form (test) | |## Audit 12 — Payment Form & Lyra/SogeCommerce Integration

---

### 1. TEST MODE INDICATOR

**No visible test mode indicator exists anywhere on the site.** There is no test badge, sandbox banner, or development notice displayed on the pricing page, the upgrade modal, or any other page. The SogeCommerce/Lyra Krypton client is loaded from the **production endpoint** (`api-sogecommerce.societegenerale.eu`), not a sandbox/test URL. The application bundle also contains a reference to `production` mode, and no references to `testMode`, `sandbox`, or `TEST_MODE` were found. The site is operating in what appears to be a live production configuration.

---

### 2. PLAN SELECTION

Six tiers are available, displayed in two rows of three cards:

**Row 1:**

**Member** — €500 annual membership fee (no renewal price listed). 5 connect requests, webinar requests not included, 1 team member, Public + Members resources/events, no sponsor badge, no priority support. CTA: "Join as Member →" (links to `/become-partner`).

**Innovation Partner** (current plan) — €3,000 annual invoice, renewal €2,500/year. 20 connect requests, 5 webinar requests/year, 5 team members, all content/events, sponsor badge included, no priority support. CTA: "Current plan" (disabled/greyed out).

**Associate Partner** (tagged "Most popular") — €15,000 annual invoice, renewal €10,000/year. Unlimited connect/webinar requests, 10 team members, all content, all events + priority, sponsor badge + priority support included. CTA: "Request upgrade →".

**Row 2:**

**Partner** — €40,000, renewal €35,000/year. 15 team members. Events: all + priority. CTA: "Request upgrade →".

**Premium Sponsor** — €100,000, renewal €90,000/year. 20 team members. Events: all + VIP. CTA: "Request upgrade →".

**Main Sponsor** — €150,000, renewal €150,000/year. 25 team members. Events: all + VIP. CTA: "Request upgrade →".

All prices are clearly displayed in euros. A **"Full feature comparison" table** below the cards provides a detailed side-by-side breakdown across three categories: Pricing, Platform Access, B2B Features, and Visibility & Support. The current plan column is highlighted with "Your plan" label. Checkmarks (✓) and ✗ indicators show feature availability clearly.

---

### 3. PAYMENT FORM

**There is NO embedded payment form currently visible on any page.** However, the Lyra/SogeCommerce Krypton client is fully loaded and configured:

The `<head>` contains:
- `<!-- SogeCommerce / Lyra Payment Form -->` comment
- CSS: `https://api-sogecommerce.societegenerale.eu/static/js/krypton-client/V4.0/ext/classic-reset.css` (loaded, HTTP 200)
- JS: `https://api-sogecommerce.societegenerale.eu/static/js/krypton-client/V4.0/ext/classic.js` (loaded, HTTP 200)

A `KR_CONFIGURATION` global object exists with full configuration: classic theme (V4.18.2), button template showing `{label} {price}`, merchant logo (base64 SVG), smart form overlay, and `setFormConfig` method.

The main application bundle (1.5MB) contains: `kr-embedded` (2 occurrences), `formToken` (2 occurrences), `setFormConfig`, `pendingPayment`, `paymentStatus`, plus 120 total references to "payment" including 4 membership-payment and 5 event-payment references.

**The payment form uses a `kr-embedded` container** (an embedded iframe within the page, not a redirect). It is initialized dynamically with a `formToken` from the server when payment is required. However, this form only appears conditionally — it is not triggered for the current account because:
- The "Innovation Partner" plan includes event access (so event registration shows "Included in Innovation Partner" instead of a payment form)
- Tier upgrades use a **"Request upgrade" modal** (manual request + invoice process), not online payment

The upgrade modal contains: a "Select Sponsor Level" dropdown (Associate Partner, Partner, Premium Sponsor, Main Sponsor), an optional invoice upload field, and a 4-step "How it works" process explaining that M3 will contact the user with pricing details after the request.

---

### 4. VALIDATION

Since the payment form is not currently rendered (no `formToken` is generated for this account's scenarios), I cannot test card validation directly. The Krypton client library handles validation within its iframe — error messages would come from Société Générale's payment form, not from the application DOM.

---

### 5. TEST CARD

No card input fields are visible. The payment form infrastructure supports the Krypton V4.0 classic embedded form, which would display standard card fields (card number, expiry, CVV) within a secure iframe when a `formToken` is provided. The test card format (4970 1000 0000 0003) is a standard Lyra/SogeCommerce test card — whether it would be accepted depends on whether the merchant account is in test mode. Given the production endpoint being used, test cards would likely be **rejected** in the current configuration.

---

### 6. SECURITY

**HTTPS:** ✅ The site is served over HTTPS with `isSecureContext: true` on `connect.m3monaco.com`.

**Secure iframe:** ✅ The Krypton client uses `kr-embedded` mode, which renders the card form inside a **secure iframe** hosted on Société Générale's domain. Card details are never exposed to the merchant's page DOM — they are entered directly into the payment provider's iframe and processed server-side. This is PCI DSS compliant architecture.

**Script sources:** Both the CSS and JS load from `api-sogecommerce.societegenerale.eu` (Société Générale's official domain), not a third-party CDN.

**No sensitive data in DOM:** No card numbers, tokens, or payment secrets are present in the page HTML or JavaScript globals.

---

### 7. LOADING/PROCESSING

Since the payment form cannot be triggered with the current account, I could not observe the processing state directly. However, the code analysis reveals:

- The `KR_CONFIGURATION` includes `button.animation` and `smartButton.button.spinnerVisible: true`, indicating the payment button shows a **spinner animation** during processing.
- The bundle contains `paymentPending` status handling, confirming a pending/processing state exists.
- The button template `{label} {price}` would show the payment amount on the submit button.

---

### Summary of Key Findings

**🔴 Critical:** The Lyra/SogeCommerce payment form is fully integrated at the code level but is **not accessible through any current user flow** with the Innovation Partner account. The payment form is conditionally rendered and appears to be reserved for specific scenarios (likely: Member-tier membership payments or paid event registrations for non-included plans).

**⚠️ Notable:** All tier upgrades above the current plan use a **manual request-and-invoice process** (not online payment). The "Request upgrade" buttons open a modal where users submit a request, and M3 contacts them with pricing details. This means the SogeCommerce integration may only be used for the base Member tier (€500) or specific paid event registrations.

**⚠️ Notable:** There is no test mode indicator, and the production payment endpoint is configured. If the payment form were to appear, it would process real transactions.

**⚠️ Notable:** The Krypton CSS and JS are loaded globally on **every page** of the site (even pages with no payment functionality), adding unnecessary network requests and bundle weight. |

### Permission Checks (P-01 to P-04)

| Test ID | Logged in as | Status | Findings |
|---------|-------------|--------|----------|
| P-01 | Marina user | | |
| P-02 | Partner user | | |
| P-03 | Admin user | | |
| P-04 | Not logged in | | |

### Responsive Design (R-01 to R-03)

| Test ID | Viewport | Status | Findings |
|---------|----------|--------|----------|
| R-01 | 375px (mobile) | | |
| R-02 | 768px (tablet) | | |
| R-03 | Forms at mobile | | |

### Console & Network (C-01 to C-02)

| Test ID | Check | Status | Findings |
|---------|-------|--------|----------|
| C-01 | Console errors | | |
| C-02 | Performance/loading | | |

### Content Quality (Q-01 to Q-03)

| Test ID | Check | Status | Findings |
|---------|-------|--------|----------|
| Q-01 | Text content | | |
| Q-02 | Data accuracy | | |
| Q-03 | Email content | | |

### Accessibility (A-01 to A-03)

| Test ID | Check | Status | Findings |
|---------|-------|--------|----------|
| A-01 | Keyboard nav | | |
| A-02 | Semantic HTML | | |
| A-03 | Color contrast | | |

### Chrome Extension Issues Found

_List any issues the Chrome Extension flagged that need fixing:_

| Issue ID | Test ID | Description | Severity | Screenshot |
|----------|---------|-------------|----------|------------|
| CE-001 | | | | |
| CE-002 | | | | |
| CE-003 | | | | |
| CE-004 | | | | |
| CE-005 | | | | |

---

## Summary

| Section | Total Tests | PASS | FAIL | BLOCKED | SKIPPED |
|---------|-------------|------|------|---------|---------|
| 1. Authentication | 7 | | | | |
| 2. Onboarding | 5 | | | | |
| 3. Admin Workflow | 5 | | | | |
| 4. Public Pages | 7 | | | | |
| 5. Submissions | 5 | | | | |
| 6. Account Management | 5 | | | | |
| 7. Pre-Audit S3 | 3 | | | | |
| 8. Permissions | 5 | | | | |
| 9. Mobile/Responsive | 4 | | | | |
| 10. Edge Cases | 8 | | | | |
| 11. Chrome Extension | 28 | | | | |
| **TOTAL** | **82** | | | | |

## Critical Bugs Found

| Bug ID | Test ID | Description | Steps to Reproduce | Priority |
|--------|---------|-------------|-------------------|----------|
| BUG-001 | | | | |
| BUG-002 | | | | |
| BUG-003 | | | | |

## General Notes

_Write any overall observations, patterns, or concerns here._

---

*Template version: 1.1 -- Created for M3 Connect platform testing*
