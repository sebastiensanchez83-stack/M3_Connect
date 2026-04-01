# M3 Connect -- Chrome Extension Test Guide

A guide for using the Claude Chrome Extension to visually test and audit the M3 Connect platform.

---

## Section 1: How to Use This Guide

### Setup

1. Install the Claude Chrome Extension from the Chrome Web Store.
2. Open M3 Connect in Chrome (production Netlify URL or localhost).
3. Navigate to the page specified for each test prompt.
4. Open the Claude Chrome Extension panel.
5. Paste the exact prompt into the extension and run it.

### How Each Test Works

- Each prompt below is **self-contained** -- paste it as-is into the extension.
- The extension will analyze the visible page, DOM, console, and/or network activity depending on the prompt.
- **Prerequisites** are listed before each prompt. Make sure you are logged in as the right user type and on the right page before running the prompt.
- After each test, note the results in the TEST_FEEDBACK_TEMPLATE.md document.

### Tips

- Run prompts one at a time for clearest results.
- If a prompt asks about console errors, make sure you have the browser console open (F12) before running it, or rely on the extension's console reading capability.
- For responsive tests, resize your browser window or use Chrome DevTools device mode BEFORE running the prompt.

---

## Section 2: Test Prompts by Category

---

### Category 1: Visual and Layout Checks

#### Test V-01: Home Page Visual Audit

**Page:** Home page (root URL `/`)
**Prerequisites:** None (can be logged out)

**Prompt:**
```
Analyze this page thoroughly and report on the following:

1. BROKEN IMAGES: Are there any images that failed to load (broken image icons, alt text showing instead of images, or empty image containers)?

2. BUTTON CONSISTENCY: List every button visible on this page. For each, note its text, color, and style. Are they all consistent in terms of padding, font size, border radius, and hover state? Flag any outliers.

3. TEXT OVERFLOW: Is there any text that overflows its container, gets cut off, or overlaps other elements? Check headings, paragraphs, and card content.

4. SPACING AND ALIGNMENT: Are sections evenly spaced? Are elements within each section properly aligned (centered content is centered, left-aligned content has consistent margins)?

5. FOOTER: Does the footer contain links to Privacy Policy, Terms, Contact, and social media? Are all footer links working (not 404)?

6. COLOR CONTRAST: Are there any areas where text is difficult to read due to poor color contrast against its background?

Report each finding clearly. For any issues found, describe the exact location on the page and what is wrong.
```

**Expected findings:** All images load, buttons use consistent M3 brand styling (navy/blue primary), no text overflow, proper section spacing, complete footer.
**Failure looks like:** Broken image placeholders, mismatched button styles, text clipping, uneven margins, missing footer links.

---

#### Test V-02: Resources Page Card Layout

**Page:** `/resources`
**Prerequisites:** At least one published resource in the system

**Prompt:**
```
Look at the resource cards displayed on this page and check:

1. CARD CONSISTENCY: Are all cards the same height and width? Do they have consistent border radius, shadow, and padding? If cards are in a grid, are they properly aligned?

2. CARD CONTENT: Does each card show a title, description (or excerpt), category tag, and a thumbnail image? Are any fields missing or showing "undefined", "null", or empty strings?

3. TRUNCATION: Are long titles or descriptions properly truncated with ellipsis or "Read more" rather than overflowing?

4. CLICKABILITY: Do cards have a hover effect indicating they are clickable? Does the entire card appear to be a link or just the title?

5. EMPTY STATE: If there are zero resources, is there a helpful empty state message, or is it just a blank page?

6. LOADING STATE: When the page first loads, is there a loading indicator (spinner, skeleton cards) or does content pop in abruptly?

Report each finding with specific details about what you see.
```

**Expected findings:** Uniform card grid, all fields populated, proper hover effects, loading states present.
**Failure looks like:** Cards of different sizes, missing thumbnails, "undefined" text in cards, no hover effect, blank area when loading.

---

#### Test V-03: Admin Panel Layout

**Page:** `/admin`
**Prerequisites:** Logged in as admin user

**Prompt:**
```
Examine the admin panel layout and report:

1. SIDEBAR: Is there a sidebar navigation? List all menu items visible. Does the active item have a visual indicator (highlight, bold, different color)?

2. STAT CARDS: On the dashboard view, how many stat cards are displayed? List each card's label and value. Are they arranged in a grid? Do they have consistent styling?

3. DATA TABLES: If there is a table (users, resources, etc.), check: Are column headers clear? Is the table responsive (horizontal scroll on small screens)? Are there action buttons per row? Do empty tables show a message?

4. NAVIGATION FLOW: Click through each sidebar item and verify each section loads without errors. Report any sections that show blank content or errors.

5. TYPOGRAPHY: Is the font consistent throughout the admin panel? Are headings, labels, and body text using a clear hierarchy?

Report all findings with specifics.
```

**Expected findings:** Sidebar with 8+ items, 8 stat cards on dashboard, functioning data tables, smooth section transitions.
**Failure looks like:** Missing sidebar items, stat cards showing 0 or NaN, broken tables, blank sections on click.

---

#### Test V-04: Account Page Tabs

**Page:** `/account`
**Prerequisites:** Logged in as a verified marina user

**Prompt:**
```
Analyze the account page and report:

1. STATUS BANNER: Is there a banner at the top showing the user's verification status? What does it say? What color is it (green for verified, yellow for pending, red for rejected)?

2. TABS: List every tab visible on this page. Click each tab and confirm it loads content (or shows an appropriate empty state). Report any tab that breaks or shows nothing.

3. PROFILE INFORMATION: In the profile section, is the user's name, email, organization, persona type, and status clearly displayed? Are there any fields showing "null", "undefined", or blank?

4. EDIT CAPABILITY: Is there an edit button or edit mode for profile information? If yes, does clicking it enable form fields?

5. VISUAL HIERARCHY: Is the most important information (status, name, organization) prominent? Are secondary details (creation date, etc.) appropriately de-emphasized?

Report all findings in detail.
```

**Expected findings:** Correct status banner color, all tabs functional, profile fields populated, edit button present.
**Failure looks like:** Wrong or missing banner, tabs that show blank content, "undefined" in profile fields, no edit option.

---

#### Test V-05: Marketplace / Partners Page

**Page:** `/marketplace` or `/partners`
**Prerequisites:** At least one verified partner exists

**Prompt:**
```
Review the marketplace/partners page:

1. PARTNER CARDS: List how many partner cards are visible. For each, check: Is the company name shown? Logo present? Sectors/categories displayed? Is there a link or button to view details?

2. FILTER/SEARCH: Is there a search bar or filter mechanism (by sector, by name)? If yes, try filtering -- does it work? Does it show a "no results" state when filtering produces zero matches?

3. SECTOR TAGS: If partners show sector tags, are they styled consistently (same color chips/badges)? Do they wrap properly when there are many sectors?

4. DETAIL VIEW: If you can click into a partner's detail page, does it show complete information (description, website link, contact info, sectors)?

5. LAYOUT: Does the page use a grid layout? Is it visually balanced? Are cards of uniform size?

Report all findings.
```

**Expected findings:** Partner cards with logos and sectors, working filters, consistent tag styling, functional detail views.
**Failure looks like:** Missing logos, broken filters, tags overflowing containers, 404 on detail pages.

---

### Category 2: Navigation and Links

#### Test N-01: Full Navigation Audit

**Page:** Any page (start on home page)
**Prerequisites:** Logged in as verified marina user

**Prompt:**
```
Test every navigation link on this page:

1. NAVBAR LINKS: List every link in the top navigation bar. For each link, report: the visible text, the URL it points to, and whether it is correct for a marina user. Verify the following should be present:
   - Home
   - Resources
   - Events
   - Marketplace/Partners
   - Submit Project (marina-only)
   - Propose Webinar (verified users)
   - Account
   - Logout

2. FOOTER LINKS: List every link in the footer. For each, report the text and target URL. Check that none lead to 404 pages.

3. LOGO LINK: Does clicking the logo/brand name navigate to the home page?

4. ACTIVE STATE: Does the current page's nav link have an active/highlighted state to show where the user is?

5. CTA BUTTONS: List any call-to-action buttons on the page (e.g., "Get Started", "Learn More"). Where do they navigate to?

Report any dead links, incorrect URLs, or missing navigation items.
```

**Expected findings:** All navbar items present for marina role, footer links work, logo links to home, active state on current page.
**Failure looks like:** Missing nav items, dead footer links, no active state indicator, CTA buttons going to wrong pages.

---

#### Test N-02: Protected Route Enforcement

**Page:** Start on home page
**Prerequisites:** Logged OUT (no active session)

**Prompt:**
```
I need you to check if protected routes are properly secured. Try navigating to each of these URLs and report what happens for each:

1. /account
2. /admin
3. /submit-project
4. /request-webinar
5. /onboarding

For each URL, report:
- Does it redirect to the login page?
- Does it show a blank page?
- Does it show the actual protected content (which would be a security issue)?
- Is there a clear message telling the user they need to log in?

This is a critical security check. Any protected page that renders content without authentication is a serious bug.
```

**Expected findings:** All protected routes redirect to login page when not authenticated.
**Failure looks like:** Any protected page rendering its content without requiring login, blank white screens instead of redirects.

---

#### Test N-03: Breadcrumb and Back Navigation

**Page:** Any detail page (resource detail, event detail, partner detail)
**Prerequisites:** Navigated from a list page to a detail page

**Prompt:**
```
Check the navigation behavior on this detail page:

1. BACK NAVIGATION: Is there a "Back" button or breadcrumb trail? If yes, does it navigate to the correct parent page (e.g., resource detail back to /resources)?

2. BROWSER BACK: Does pressing the browser's back button return to the previous page with the correct scroll position and any active filters preserved?

3. BREADCRUMBS: If breadcrumbs exist, are they accurate? (e.g., "Home > Resources > [Resource Title]")

4. PAGE TITLE: Does the page title (in the browser tab) update to reflect the current content?

5. URL STRUCTURE: Is the URL clean and readable (e.g., /resources/123 or /resources/resource-slug)?

Report all findings.
```

**Expected findings:** Working back navigation, accurate breadcrumbs or back links, descriptive page titles.
**Failure looks like:** No way to go back, broken breadcrumbs, generic page titles, messy URLs.

---

### Category 3: Form Validation

#### Test F-01: Signup Form Validation

**Page:** Signup page
**Prerequisites:** Logged out

**Prompt:**
```
Test the signup form validation thoroughly:

1. EMPTY SUBMISSION: Click the submit/signup button without entering anything. List every validation message that appears. Are they clear and helpful?

2. INVALID EMAIL: Enter "notanemail" in the email field and submit. What error message appears?

3. SHORT PASSWORD: Enter a valid email but a 3-character password. What happens?

4. PASSWORD MISMATCH: Enter a valid email, a proper password, but a different confirm password. What error appears?

5. EXISTING EMAIL: If possible, enter an email you know already exists. What happens on submission?

6. FIELD INDICATORS: Do required fields have asterisks (*) or other visual indicators? Do invalid fields get a red border or highlight?

7. REAL-TIME vs SUBMIT: Do validations happen in real-time (as you type/blur) or only on submit?

For each test, report the exact error message text and how it is displayed (inline, toast, modal, etc.).
```

**Expected findings:** Clear validation for all invalid inputs, red field indicators, inline error messages.
**Failure looks like:** No validation messages, form submits with invalid data, generic error messages, errors only in console.

---

#### Test F-02: Onboarding Form Validation (Marina)

**Page:** `/onboarding`
**Prerequisites:** Logged in as marina user who has NOT completed onboarding

**Prompt:**
```
Test the marina onboarding form validation:

1. REQUIRED FIELDS: Try to submit the form empty. Which fields show validation errors? List every required field and its error message.

2. FIELD TYPES: Check the following field behaviors:
   - Marina name: Is there a max character limit?
   - Website URL: Does it validate URL format (accepts https://example.com, rejects "not a url")?
   - Number of berths: Does it only accept numbers? What happens with negative numbers or text?
   - Email fields: Do they validate email format?
   - Country: Is it a dropdown or free text? If dropdown, are options comprehensive?

3. SECTORS SELECTION: How many sectors can be selected? Is there a minimum required? What happens if you select none?

4. FILE UPLOAD: If there is a logo upload field, what file types are accepted? What is the max size? What happens when you try to upload an invalid file?

5. FORM PROGRESS: If the form has multiple steps, can you skip ahead without completing previous steps?

Report every validation behavior found.
```

**Expected findings:** All required fields validated, proper input type constraints, sector selection enforced, file upload restrictions working.
**Failure looks like:** Missing validation on required fields, text accepted in number fields, no file type restrictions.

---

#### Test F-03: Project Submission Form

**Page:** `/submit-project`
**Prerequisites:** Logged in as verified marina user

**Prompt:**
```
Examine and test the project submission form:

1. FORM FIELDS: List every field on the form (name, label, type -- text/select/textarea/file/etc., required or optional).

2. EMPTY SUBMISSION: Submit with all fields empty. Report all validation messages.

3. CHARACTER LIMITS: For text fields and textareas, are there visible character counters? What are the limits? What happens when you exceed them?

4. SECTOR SELECTION: If there is a sector selector, is it multi-select? How does it display selected items? Can you deselect?

5. BUDGET FIELD: If there is a budget field, what format does it expect? (number, range dropdown, free text?) Does it handle currency formatting?

6. SUBMIT BEHAVIOR: When you submit a valid form, does the button show a loading state? Is it disabled during submission? What confirmation message appears? Where are you redirected after?

7. DRAFT CAPABILITY: Can you save a form as draft without submitting? Is there auto-save?

Report all findings in detail.
```

**Expected findings:** Clear field labels, proper validation, loading state on submit, confirmation message, post-submit redirect.
**Failure looks like:** Unlabeled fields, no validation, button stays clickable during submission, no confirmation.

---

#### Test F-04: Contact Form Validation

**Page:** `/contact`
**Prerequisites:** None

**Prompt:**
```
Test the contact form on this page:

1. FIELDS PRESENT: What fields does the contact form have? (name, email, subject, message, etc.)

2. EMPTY SUBMISSION: Submit empty. What validations appear?

3. INVALID EMAIL: Enter a name and message but an invalid email. What happens?

4. LONG MESSAGE: Paste a very long message (1000+ characters). Does the textarea handle it? Is there a character limit?

5. SUCCESS STATE: Fill in all fields correctly and submit. What confirmation is shown? Does the form clear after submission? Can you submit again immediately?

6. SPAM PROTECTION: Is there a CAPTCHA, honeypot field, or rate limiting? (Check the form HTML source for hidden fields)

Report all findings.
```

**Expected findings:** Required field validation, email format check, success message, form clears on success.
**Failure looks like:** No validation, submission silently fails, no confirmation, form does not clear.

---

#### Test F-05: Payment Form (Test Mode)

**Page:** Payment/subscription page
**Prerequisites:** Logged in as partner user, navigated to upgrade/payment section

**Prompt:**
```
Examine the payment form and Lyra/SogeCommerce integration:

1. TEST MODE INDICATOR: Is there any visible indicator that payments are in test mode? (test badge, banner, sandbox notice)

2. PLAN SELECTION: What plans/tiers are available? Are prices clearly displayed? Is there a comparison or feature list per tier?

3. PAYMENT FORM: Is the payment form embedded (iframe) or a redirect to Lyra's hosted page? What fields are present (card number, expiry, CVV, name)?

4. VALIDATION: What happens if you enter invalid card details? Are error messages from the payment provider clearly displayed?

5. TEST CARD: If you can see card input fields, note whether they accept the test card format (4970 1000 0000 0003).

6. SECURITY: Does the payment page use HTTPS? Is the card form within a secure iframe (not directly in the page DOM)?

7. LOADING/PROCESSING: After submitting payment, is there a processing indicator? What happens during the wait?

Report all findings. Note: do NOT actually complete a payment unless explicitly asked.
```

**Expected findings:** Test mode indicator, clear pricing, secure payment iframe, proper validation on card fields.
**Failure looks like:** No test mode indicator, broken payment embed, insecure card handling, no processing state.

---

### Category 4: Permission Checks

#### Test P-01: Marina User Permissions

**Page:** Any page
**Prerequisites:** Logged in as verified marina user

**Prompt:**
```
Audit what this marina user can see and access:

1. NAVIGATION: List every item in the top navigation bar. Screenshot or describe the navbar.

2. ALLOWED PAGES: Navigate to each of these and report if they load or redirect:
   - /account (should load)
   - /submit-project (should load for verified marina)
   - /request-webinar (should load for verified users)
   - /resources (should load)
   - /events (should load)
   - /marketplace (should load)

3. RESTRICTED PAGES: Navigate to each of these and report if they properly block access:
   - /admin (should redirect or show access denied)
   - /onboarding (should redirect since already completed)

4. ACCOUNT TABS: On the /account page, which tabs are visible? Are there any admin-only tabs showing that should be hidden?

5. ACTION BUTTONS: On resource/event pages, are there any "Edit" or "Delete" buttons visible that should only appear for admins?

Report all findings. Flag any access that seems wrong for a marina user.
```

**Expected findings:** Marina sees Submit Project and Webinar links, cannot access /admin, no edit/delete buttons on public content.
**Failure looks like:** Admin link visible, /admin loads, edit buttons on resources/events, missing Submit Project link.

---

#### Test P-02: Partner User Permissions

**Page:** Any page
**Prerequisites:** Logged in as verified partner user

**Prompt:**
```
Audit what this partner user can see and access:

1. NAVIGATION: List every item in the top navigation bar.

2. PARTNER-SPECIFIC: Does the partner see any partner-specific features?
   - Partner profile/dashboard
   - Lead management or notifications
   - Marketplace listing management

3. MARINA-ONLY FEATURES: Check if these marina-only features are properly hidden:
   - /submit-project (should NOT be accessible for partners)
   - S3 Pre-Audit assessment (marina-only feature)

4. RESTRICTED: Navigate to /admin. Does it block access?

5. ACCOUNT PAGE: What tabs are visible on /account for a partner? Are they different from marina tabs?

Report all findings. Highlight any feature that is visible but should not be for a partner role.
```

**Expected findings:** Partner sees marketplace/partner-specific features, cannot access marina-only features, no admin access.
**Failure looks like:** Partner can access Submit Project, admin panel loads, marina-only features visible.

---

#### Test P-03: Admin User Full Access

**Page:** Start on home page
**Prerequisites:** Logged in as admin user

**Prompt:**
```
Verify the admin user has full access to all platform features:

1. NAVBAR: List all navigation items. Confirm "Admin Panel" or equivalent is present.

2. ADMIN PANEL SECTIONS: Navigate to /admin and list every section in the sidebar. Click each one and confirm it loads with data or an appropriate empty state. The expected sections are:
   - Dashboard (stat cards)
   - Users (list with approve/reject actions)
   - Resources (list with create/edit/delete)
   - Events (list with create/edit/delete)
   - Partners (list)
   - Projects (list)
   - Leads (list)
   - Webinar Requests (list with status management)

3. ADMIN ACTIONS: For the Users section, verify you can see:
   - Approve button for pending users
   - Reject button with reason dialog
   - User detail view

4. CONTENT MANAGEMENT: In Resources or Events, verify you can:
   - See a "Create" button
   - See edit/delete options on existing items

Report all findings. Flag any admin section that is broken or missing.
```

**Expected findings:** All admin sections accessible and functional, CRUD actions available on content, approve/reject on users.
**Failure looks like:** Missing admin sidebar items, broken sections, no create/edit buttons, approve/reject not working.

---

#### Test P-04: Unauthenticated User Restrictions

**Page:** Home page
**Prerequisites:** Logged OUT completely

**Prompt:**
```
Test what an unauthenticated visitor can and cannot access:

1. VISIBLE PAGES: Navigate to each public page and confirm it loads:
   - / (home)
   - /resources
   - /events
   - /marketplace or /partners
   - /about
   - /contact
   - /privacy, /terms, /cgv (legal pages)

2. PROTECTED PAGES: Try to access each of these and report the behavior:
   - /account
   - /admin
   - /submit-project
   - /request-webinar
   - /onboarding
   For each, note: Does it redirect to login? Show a blank page? Show the content (security issue)?

3. NAVBAR: What links are visible in the navbar for a logged-out user? Is "Sign Up" and "Login" prominently shown?

4. CTAs: Do call-to-action buttons on the home page direct to signup/login appropriately?

Report all findings. Any protected page accessible without login is a critical security issue.
```

**Expected findings:** All public pages load, all protected pages redirect to login, CTA buttons lead to signup.
**Failure looks like:** Protected content visible without login, blank pages instead of redirects, missing signup/login buttons.

---

### Category 5: Responsive Design

#### Test R-01: Mobile Layout (375px)

**Page:** Home page
**Prerequisites:** Set Chrome DevTools device toolbar to iPhone 14 (375px width) or manually resize to 375px

**Prompt:**
```
Analyze this page at mobile width and check:

1. HORIZONTAL SCROLL: Is there any horizontal scrollbar? Scroll right -- does any content extend beyond the viewport? This is a common responsive bug.

2. HAMBURGER MENU: Is the navigation collapsed into a hamburger/mobile menu? Does it open when tapped? Does it list all navigation items? Does it close when you tap a link or tap outside?

3. HERO SECTION: Does the hero/banner section adapt properly? Is the heading readable (not too large)? Is the CTA button full-width or appropriately sized?

4. CONTENT SECTIONS: Do multi-column layouts (2-col, 3-col, grids) stack to single column on mobile? Are images scaling properly?

5. FONT SIZES: Is all text readable without zooming? Are headings proportionally smaller on mobile?

6. TOUCH TARGETS: Are buttons and links large enough to tap (minimum 44x44px)? Is there enough spacing between clickable elements?

7. FOOTER: Does the footer stack its columns vertically? Are footer links tappable?

Report every responsive issue found.
```

**Expected findings:** No horizontal scroll, hamburger menu works, single-column stacking, readable text, adequate touch targets.
**Failure looks like:** Horizontal scroll present, nav items overflowing, overlapping content, tiny tap targets, footer columns not stacking.

---

#### Test R-02: Tablet Layout (768px)

**Page:** Resources or Events page
**Prerequisites:** Set viewport to 768px width (iPad)

**Prompt:**
```
Check this page at tablet width (768px):

1. GRID LAYOUT: If content is in a card grid, how many columns are showing? (Expect 2 columns at tablet). Are cards properly sized and spaced?

2. NAVIGATION: Is the nav still a hamburger menu at this width, or does it show full horizontal links? Either is acceptable but it should look intentional, not broken.

3. SIDEBAR: If there is a sidebar (filters, admin sidebar), does it collapse or remain visible? Is there adequate space for main content?

4. IMAGES: Are images properly scaled? No stretching or pixelation?

5. WHITESPACE: Is there appropriate padding on the sides? Content should not touch the screen edges.

6. TABLES: If there are data tables, do they fit or require horizontal scrolling? Is horizontal scrolling smooth?

Report all findings.
```

**Expected findings:** 2-column card grid, proper navigation mode, adequate padding, no edge-touching content.
**Failure looks like:** Cards squished or single-column when 2 would fit, nav broken between mobile and desktop, tables overflowing without scroll.

---

#### Test R-03: Form Responsiveness

**Page:** Any form page (onboarding, submit project, contact)
**Prerequisites:** Mobile viewport (375px), logged in if needed

**Prompt:**
```
Test this form at mobile width:

1. FORM WIDTH: Does the form span the full width of the screen with appropriate padding? Or is it a narrow centered card that is too small to use on mobile?

2. INPUT FIELDS: Are all input fields full-width and tall enough to tap easily? Can you read the labels and placeholder text?

3. SELECT/DROPDOWN: Do dropdown selectors work on mobile? Do they use the native mobile picker or a custom one? Is it usable?

4. MULTI-SELECT: If there are multi-select fields (sectors), how do they display on mobile? Can you select/deselect easily?

5. FILE UPLOAD: If there is a file upload, does the upload button work on mobile? Does it open the camera/file picker?

6. SUBMIT BUTTON: Is the submit button visible without scrolling past it? Is it full-width on mobile? Can you reach it easily?

7. ERROR MESSAGES: Submit the form empty and check if error messages are visible on mobile and do not overlap or hide behind other elements.

Report all findings.
```

**Expected findings:** Full-width form, usable inputs, native pickers on mobile, accessible submit button, visible error messages.
**Failure looks like:** Form too narrow, inputs hard to tap, broken dropdowns, submit button hidden, errors not visible.

---

### Category 6: Console and Network Errors

#### Test C-01: Console Error Sweep

**Page:** Navigate through: Home -> Resources -> Events -> Marketplace -> Account
**Prerequisites:** Logged in, browser console open (F12 > Console tab)

**Prompt:**
```
Check the browser console for errors on this page. Report:

1. RED ERRORS: List every red error message in the console. For each, include:
   - The full error message
   - The source file and line number
   - Whether it appears on page load or after an interaction

2. YELLOW WARNINGS: List significant warnings (ignore minor React development warnings). Focus on:
   - Deprecation warnings
   - Failed prop type warnings
   - Accessibility warnings

3. NETWORK ERRORS: Check the Network tab (F12 > Network). Are there any failed requests (red, status 4xx or 5xx)? For each, report:
   - The URL
   - The HTTP status code
   - When it occurs (page load, button click, etc.)

4. REACT ERRORS: Are there any React error boundaries showing (red error overlay in development, or error fallback UI in production)?

5. SUPABASE ERRORS: Are there any errors related to Supabase (auth, database queries, storage)?

Report every finding. Console errors can indicate real bugs even if the page looks fine visually.
```

**Expected findings:** Zero red errors, minimal warnings, no failed network requests, no Supabase auth errors.
**Failure looks like:** Red console errors, 401/403/500 network responses, React error boundaries, Supabase query failures.

---

#### Test C-02: Performance and Loading

**Page:** Home page (hard refresh with Ctrl+Shift+R)
**Prerequisites:** Browser DevTools open, Network tab visible

**Prompt:**
```
Analyze the performance and loading behavior of this page:

1. LOAD TIME: How long does the page take to fully load? (Check the Network tab's total load time at the bottom)

2. LARGE ASSETS: In the Network tab, sort by size. Are there any files over 1MB? List the largest 5 files with their sizes. Are images optimized (WebP, compressed)?

3. RENDER BLOCKING: Does the page show content immediately or is there a significant white screen before content appears?

4. LOADING STATES: During initial load, are there loading skeletons, spinners, or placeholders? Or does content pop in abruptly causing layout shifts?

5. LAZY LOADING: Are off-screen images lazy-loaded (check for loading="lazy" attribute)?

6. API CALLS: How many Supabase API calls happen on page load? List them from the Network tab (filter by "supabase" or the project URL). Are any of them redundant (same query called multiple times)?

7. BUNDLE SIZE: What is the size of the main JavaScript bundle? (Look for .js files in the Network tab)

Report all findings with specific numbers and file names.
```

**Expected findings:** Page loads under 3 seconds, images under 500KB, loading states present, minimal API calls.
**Failure looks like:** 5+ second load, uncompressed images over 2MB, no loading states, duplicate API calls, bundle over 2MB.

---

### Category 7: Content Quality

#### Test Q-01: Text Content Review

**Page:** Home page
**Prerequisites:** None

**Prompt:**
```
Review all text content on this page for quality:

1. SPELLING: Are there any spelling mistakes in headings, paragraphs, or buttons? Check carefully, including footer text.

2. GRAMMAR: Are there any grammatical errors? Check for subject-verb agreement, proper punctuation, and sentence structure.

3. PLACEHOLDER TEXT: Is there any Lorem Ipsum, "TODO", "FIXME", "test", or other placeholder/development text visible on the page?

4. CONSISTENCY: Is the tone of voice consistent? (professional B2B tone expected). Are terms used consistently? (e.g., always "Marina" not sometimes "marina" and sometimes "port")

5. TRANSLATIONS: If the page is in English, is ALL text in English? Are there any untranslated strings in French or other languages that look out of place?

6. BROKEN INTERPOLATION: Is there any text showing template literals like "{name}", "{{variable}}", "undefined", or "null" that should have been replaced with actual data?

7. CTA CLARITY: Are call-to-action buttons clear about what they do? ("Get Started" vs "Click Here")

Report every finding with the exact text and its location on the page.
```

**Expected findings:** Professional, error-free text, no placeholder content, consistent terminology.
**Failure looks like:** Typos, Lorem Ipsum, "TODO" text, mixed languages, template variables visible, unclear CTAs.

---

#### Test Q-02: Data Display Accuracy

**Page:** `/account`
**Prerequisites:** Logged in as verified marina user with some profile data

**Prompt:**
```
Check the accuracy of data displayed on the account page:

1. PROFILE DATA: Is the user's name, email, organization, and persona displayed correctly? Does it match what was entered during signup/onboarding?

2. STATUS: Is the verification status (verified/pending/rejected) displayed correctly? Does the status badge color match the status?

3. DATES: Are any dates displayed in a readable format (not raw ISO timestamps like "2025-01-15T14:30:00.000Z")? Is the date format consistent across the page?

4. NUMBERS: Are numbers formatted readably (e.g., "1,234" not "1234" for large numbers)?

5. LISTS: If there are lists (sectors, services, etc.), are they displayed as readable lists (chips, bullets, comma-separated) and not as raw JSON arrays like "[\"sector1\",\"sector2\"]"?

6. IMAGES: If a profile logo/avatar was uploaded, does it display correctly? Proper sizing and aspect ratio?

7. EMPTY FIELDS: For any optional fields that were not filled in, do they show "Not provided" or similar, rather than "null", "undefined", or blank space?

Report all findings.
```

**Expected findings:** All data formatted and displayed correctly, proper date formatting, readable lists, graceful empty states.
**Failure looks like:** Raw ISO dates, JSON arrays in UI, "null"/"undefined" text, missing images, unformatted numbers.

---

#### Test Q-03: Email Content Quality

**Page:** Check email inbox after triggering emails
**Prerequisites:** Performed signup, password reset, or received an admin action (approve/reject)

**Prompt:**
```
Review the emails sent by the M3 Connect platform:

Note: This test requires checking actual emails. Describe what you see if you can view email screenshots, or guide the tester on what to check.

For each email type (signup confirmation, password reset, approval/rejection notification), check:

1. SENDER: Is the "From" address professional (e.g., noreply@m3connect.com, not a raw Supabase address)?

2. SUBJECT LINE: Is the subject clear and professional?

3. BRANDING: Does the email include M3 Connect branding (logo, colors)? Or is it a plain text Supabase default email?

4. CONTENT: Is the email content clear, grammatically correct, and professional?

5. LINKS: Do email links (confirmation, reset) work correctly? Do they point to the correct domain (not localhost)?

6. MOBILE: Is the email readable on mobile (not breaking layout)?

7. REPLY-TO: Is there an appropriate reply-to address?

Report all findings. Note that Supabase default emails may need customization.
```

**Expected findings:** Branded emails with correct links, professional content, working action links.
**Failure looks like:** Raw Supabase emails, links pointing to localhost, no branding, broken action links.

---

### Category 8: Accessibility

#### Test A-01: Keyboard Navigation

**Page:** Home page, then navigate to any form page
**Prerequisites:** None

**Prompt:**
```
Test keyboard accessibility on this page:

1. TAB ORDER: Press Tab repeatedly to move through the page. Does the focus move in a logical order (top to bottom, left to right)? Does focus ever get trapped (you cannot Tab away from an element)?

2. FOCUS INDICATORS: When you Tab to an element, is there a visible focus ring/outline? Can you always tell which element is currently focused? Are focus indicators visible against the page background?

3. INTERACTIVE ELEMENTS: Can you activate all buttons, links, and form controls using only the keyboard? (Enter to click buttons, Space for checkboxes, Arrow keys for selects)

4. MODAL/DIALOG: If there is a modal or dropdown, can you open it with keyboard? Can you close it with Escape? Does focus return to the trigger element after closing?

5. SKIP LINK: Is there a "Skip to main content" link that appears when you first Tab on the page? (This helps screen reader users skip repetitive navigation.)

6. DROPDOWN MENUS: Can navigation dropdown menus be opened and navigated with keyboard?

Report all findings. Keyboard accessibility is essential for users who cannot use a mouse.
```

**Expected findings:** Logical tab order, visible focus indicators, all interactive elements keyboard-accessible, modals trap and return focus.
**Failure looks like:** No focus indicators, focus trapped in elements, buttons not activatable with Enter, no skip link, modals stealing focus permanently.

---

#### Test A-02: Screen Reader Compatibility (Semantic HTML)

**Page:** Any content-heavy page (home, resources, or account)
**Prerequisites:** None (checking HTML structure, not requiring screen reader)

**Prompt:**
```
Audit the page's semantic HTML for screen reader compatibility:

1. HEADINGS: Inspect the page heading structure. Is there exactly one h1? Do headings follow a logical hierarchy (h1 > h2 > h3, no skipping levels)? List the heading structure.

2. LANDMARKS: Check for proper ARIA landmarks or semantic HTML elements:
   - <header> or role="banner"
   - <nav> or role="navigation"
   - <main> or role="main"
   - <footer> or role="contentinfo"
   Are these present?

3. IMAGES: Do all <img> elements have alt attributes? Are the alt texts descriptive (not just "image" or empty strings for meaningful images)? Decorative images should have alt="".

4. FORM LABELS: If there are forms, does every input have an associated <label> element (either wrapping or using for/id)? Are labels descriptive?

5. BUTTONS: Do buttons have descriptive text? Are there any icon-only buttons without aria-label? (e.g., a close button that is just an "X" without aria-label="Close")

6. LINKS: Do links have descriptive text? Are there any "Click here" or "Read more" links without context?

7. COLOR-ONLY INFORMATION: Is any information conveyed only through color? (e.g., error states shown only by red color, without text or icons)

Report all findings.
```

**Expected findings:** Proper heading hierarchy, landmark elements present, alt texts on images, labeled form inputs.
**Failure looks like:** Multiple h1s, skipped heading levels, missing landmarks, images without alt text, unlabeled inputs, icon buttons without aria-label.

---

#### Test A-03: Color Contrast and Visual Accessibility

**Page:** Any page with text content
**Prerequisites:** None

**Prompt:**
```
Check color contrast and visual accessibility:

1. TEXT CONTRAST: Examine the main text color against its background. Does it appear to meet WCAG AA standards (4.5:1 ratio for normal text, 3:1 for large text)? Check:
   - Body text on white/light backgrounds
   - Text on colored sections (hero banners, CTAs)
   - Light gray placeholder text in form fields
   - Text on dark footer background

2. BUTTON CONTRAST: Do buttons have sufficient contrast between their text and background color? Check both primary (filled) and secondary (outlined) buttons.

3. STATUS INDICATORS: Are status badges (verified, pending, rejected) distinguishable by more than just color? Do they include text labels or icons in addition to color?

4. LINKS: Are links visually distinguishable from surrounding text? (Underlined or clearly different color, not just slightly different shade)

5. FOCUS STATES: Are focus outlines high-contrast enough to see clearly?

6. ZOOM: Zoom the page to 200%. Does the layout still work? Is all content still accessible? Is any text cut off or overlapping?

Report all findings with specific element descriptions and locations.
```

**Expected findings:** Adequate contrast ratios, multi-indicator status badges, visible link styling, functional at 200% zoom.
**Failure looks like:** Low contrast text, color-only status indicators, links indistinguishable from text, layout breaks at 200% zoom.

---

## Quick Reference: Test Checklist

| ID | Category | Test Name | Page | Prerequisites |
|----|----------|-----------|------|---------------|
| V-01 | Visual | Home Page Audit | `/` | None |
| V-02 | Visual | Resource Cards | `/resources` | Published resources |
| V-03 | Visual | Admin Panel | `/admin` | Admin login |
| V-04 | Visual | Account Tabs | `/account` | Verified marina login |
| V-05 | Visual | Marketplace | `/marketplace` | Verified partners exist |
| N-01 | Navigation | Full Nav Audit | Any | Marina login |
| N-02 | Navigation | Protected Routes | Any | Logged out |
| N-03 | Navigation | Back Navigation | Detail page | Navigated from list |
| F-01 | Forms | Signup Validation | Signup page | Logged out |
| F-02 | Forms | Onboarding Validation | `/onboarding` | Marina, not onboarded |
| F-03 | Forms | Project Submission | `/submit-project` | Verified marina |
| F-04 | Forms | Contact Form | `/contact` | None |
| F-05 | Forms | Payment Form | Payment page | Partner login |
| P-01 | Permissions | Marina Access | Any | Marina login |
| P-02 | Permissions | Partner Access | Any | Partner login |
| P-03 | Permissions | Admin Full Access | `/admin` | Admin login |
| P-04 | Permissions | Unauth Restrictions | Any | Logged out |
| R-01 | Responsive | Mobile 375px | `/` | DevTools mobile |
| R-02 | Responsive | Tablet 768px | `/resources` | DevTools tablet |
| R-03 | Responsive | Form Mobile | Form page | DevTools mobile |
| C-01 | Console | Error Sweep | Multiple pages | DevTools Console |
| C-02 | Console | Performance | `/` | DevTools Network |
| Q-01 | Content | Text Review | `/` | None |
| Q-02 | Content | Data Display | `/account` | Verified login |
| Q-03 | Content | Email Quality | Email inbox | After triggering emails |
| A-01 | Accessibility | Keyboard Nav | Any | None |
| A-02 | Accessibility | Semantic HTML | Any | None |
| A-03 | Accessibility | Color Contrast | Any | None |

---

*Guide version: 1.0 -- Created for M3 Connect platform testing with Claude Chrome Extension*
