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
| **Status** | |
| **Notes/Screenshots** | |

### AUTH-05: Login with Invalid Credentials

| Field | Value |
|-------|-------|
| **Priority** | High |
| **Precondition** | Logged out |
| **Steps** | 1. Go to login page. 2. Enter valid email with wrong password. 3. Click "Sign In". |
| **Expected** | Error message displayed (e.g., "Invalid login credentials"). No crash. User stays on login page. |
| **Actual** | |
| **Status** | |
| **Notes/Screenshots** | |

### AUTH-06: Password Reset Flow

| Field | Value |
|-------|-------|
| **Priority** | High |
| **Precondition** | Have a confirmed account, logged out |
| **Steps** | 1. Go to login page. 2. Click "Forgot Password" link. 3. Enter email address. 4. Submit. 5. Check email for reset link. 6. Click reset link. 7. Enter new password and confirm. 8. Submit. 9. Try logging in with new password. |
| **Expected** | Reset email received. New password accepted. Login with new password succeeds. |
| **Actual** | |
| **Status** | |
| **Notes/Screenshots** | |

### AUTH-07: Logout

| Field | Value |
|-------|-------|
| **Priority** | Critical |
| **Precondition** | Logged in |
| **Steps** | 1. Click user menu or logout button. 2. Confirm logout. |
| **Expected** | Logged out. Redirected to home page. Protected routes no longer accessible. |
| **Actual** | |
| **Status** | |
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
| **Status** | |
| **Notes/Screenshots** | |

### ADM-02: Reject a User with Reason

| Field | Value |
|-------|-------|
| **Priority** | Critical |
| **Precondition** | Logged in as admin. At least one pending user exists. |
| **Steps** | 1. Go to /admin > Users. 2. Find a pending user. 3. Click "Reject" button. 4. Enter a rejection reason in the dialog. 5. Confirm rejection. |
| **Expected** | User status changes to "rejected". Rejection reason is saved. User sees rejection message on their account page. |
| **Actual** | |
| **Status** | |
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
| **Status** | |
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
| **Status** | |
| **Notes/Screenshots** | |

### PUB-02: Resources Page

| Field | Value |
|-------|-------|
| **Priority** | High |
| **Precondition** | At least one published resource exists |
| **Steps** | 1. Navigate to /resources. 2. Verify resource cards display. 3. Click on a resource card to view details. |
| **Expected** | Resource listing loads. Cards show title, thumbnail, category. Detail page opens with full content. |
| **Actual** | |
| **Status** | |
| **Notes/Screenshots** | |

### PUB-03: Events Page

| Field | Value |
|-------|-------|
| **Priority** | High |
| **Precondition** | At least one event exists |
| **Steps** | 1. Navigate to /events. 2. Verify event cards display. 3. Click on an event for details. |
| **Expected** | Events listed with date, name, location. Detail view shows full event info. |
| **Actual** | |
| **Status** | |
| **Notes/Screenshots** | |

### PUB-04: Marketplace / Partners Page

| Field | Value |
|-------|-------|
| **Priority** | High |
| **Precondition** | At least one verified partner exists |
| **Steps** | 1. Navigate to /marketplace or /partners. 2. Browse partner listings. 3. Filter by sector if filter is available. 4. Click on a partner card. |
| **Expected** | Partners displayed with company info and sectors. Filters work. Detail view shows partner profile. |
| **Actual** | |
| **Status** | |
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
| **Status** | |
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
| **Status** | |
| **Notes/Screenshots** | |

### S3-02: Complete S3 Assessment

| Field | Value |
|-------|-------|
| **Priority** | High |
| **Precondition** | On S3 assessment page, questionnaire loaded |
| **Steps** | 1. Answer all questions in the questionnaire. 2. Submit the completed assessment. |
| **Expected** | Assessment saved. Results page or score displayed. Data persists in user account. |
| **Actual** | |
| **Status** | |
| **Notes/Screenshots** | |

### S3-03: View S3 Results

| Field | Value |
|-------|-------|
| **Priority** | High |
| **Precondition** | S3 assessment completed |
| **Steps** | 1. Navigate to results page (or check account page for results). 2. Review score breakdown by category. |
| **Expected** | Results show overall score and per-category breakdown. Recommendations or next steps displayed. |
| **Actual** | |
| **Status** | |
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
| **Status** | |
| **Notes/Screenshots** | |

### PER-02: Partner User Sees Correct Navigation

| Field | Value |
|-------|-------|
| **Priority** | Critical |
| **Precondition** | Logged in as verified partner user |
| **Steps** | 1. Check navbar links. 2. Attempt to access /submit-project directly via URL. |
| **Expected** | Should see appropriate partner navigation. Should NOT have access to marina-only features like Submit Project. Should NOT see Admin Panel. |
| **Actual** | |
| **Status** | |
| **Notes/Screenshots** | |

### PER-03: Admin User Sees Admin Panel

| Field | Value |
|-------|-------|
| **Priority** | Critical |
| **Precondition** | Logged in as admin or moderator |
| **Steps** | 1. Check navbar for "Admin Panel" link. 2. Click it. 3. Verify all admin sidebar sections are accessible. |
| **Expected** | Admin Panel link visible in navbar. /admin page loads with sidebar: Dashboard, Users, Resources, Events, Partners, Projects, Leads, Webinar Requests. |
| **Actual** | |
| **Status** | |
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
| **Status** | |
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
| **TOTAL** | **54** | | | | |

## Critical Bugs Found

| Bug ID | Test ID | Description | Steps to Reproduce | Priority |
|--------|---------|-------------|-------------------|----------|
| BUG-001 | | | | |
| BUG-002 | | | | |
| BUG-003 | | | | |

## General Notes

_Write any overall observations, patterns, or concerns here._

---

*Template version: 1.0 -- Created for M3 Connect platform testing*
