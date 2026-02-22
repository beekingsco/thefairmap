# FairMap Listing Portal — Build Spec
## Date: Feb 22, 2026

## Overview
Add a booth-owner self-service portal with 3 subscription tiers, a claim/create flow, an admin approval queue, and Stripe billing. All existing 700 listings stay active and untouched.

---

## 1. Listing Tiers

| Tier | Monthly | Annual | Features |
|------|---------|--------|----------|
| Basic | $4.99/mo | $49.99/yr | Text only (name, description, address). 1 category. |
| Stand Out | $14.99/mo | $149.99/yr | Everything in Basic + up to 3 photos, 3 categories. |
| Show Off | $24.99/mo | $249.99/yr | Everything in Stand Out + 1 YouTube/Vimeo video link, social media links (FB, IG, Twitter/X, TikTok), website URL button. |

All 700 existing listings stay **active** and **unclaimed** — they remain visible on the map forever. Listing owners sign up to claim and enhance theirs.

---

## 2. Data Model Changes

### locations.json additions (add fields to existing location objects):
```json
{
  "listingTier": "unclaimed",      // "unclaimed" | "basic" | "standout" | "showoff"
  "ownerId": null,                  // user ID of booth owner who claimed it
  "status": "active",              // "active" | "pending_approval"
  "pendingChanges": null,          // object with proposed changes, or null
  "images": [],                    // array of image URLs (Stand Out+)
  "videoUrl": "",                  // YouTube/Vimeo URL (Show Off only)
  "website": "",                   // website URL (Show Off only)
  "socialLinks": {                 // social links (Show Off only)
    "facebook": "",
    "instagram": "",
    "twitter": "",
    "tiktok": ""
  }
}
```

### users.json additions (add fields to existing user objects):
```json
{
  "email": "",
  "role": "admin",                  // "admin" | "editor" | "booth_owner"
  "stripeCustomerId": null,
  "subscription": {
    "tier": null,                   // "basic" | "standout" | "showoff"
    "billingPeriod": null,          // "monthly" | "annual"
    "stripeSubscriptionId": null,
    "status": null,                 // "active" | "past_due" | "canceled" | "trialing"
    "currentPeriodEnd": null
  },
  "claimedLocationIds": []         // array of location IDs this owner manages
}
```

### New file: data/claims.json
```json
[]
```
Each claim object:
```json
{
  "id": "claim-timestamp",
  "locationId": "loc-123",         // existing location ID, OR null for new
  "userId": "user-456",
  "status": "pending",             // "pending" | "approved" | "rejected"
  "type": "claim",                 // "claim" (existing) | "create" (new)
  "newLocationData": null,         // populated if type = "create"
  "businessVerification": "",      // owner's verification note
  "submittedAt": "ISO date",
  "reviewedAt": null,
  "reviewedBy": null,
  "reviewNote": ""
}
```

---

## 3. New Files to Create

### server.js — Add to existing file:

New API routes needed:

**Public/Auth routes:**
- `POST /api/register` — Create booth_owner account (username, email, password, displayName)
- `POST /api/stripe/create-checkout` — Create Stripe checkout session (requires auth)
- `POST /api/stripe/webhook` — Stripe webhook handler (raw body, verify signature)
- `GET /api/stripe/portal` — Create Stripe customer portal session (requires auth)

**Booth owner routes (requireAuth + requireBoothOwner middleware):**
- `GET /api/portal/listings` — Get all locations claimed by the current user
- `POST /api/portal/claim` — Submit a claim request for an existing location
- `POST /api/portal/create-listing` — Submit a new listing request
- `PUT /api/portal/listings/:id` — Submit changes to own listing (goes to pendingChanges, NOT live)
- `POST /api/portal/listings/:id/upload` — Upload image for own listing

**Admin routes (existing requireAdmin):**
- `GET /api/admin/pending` — Get all locations with pendingChanges
- `POST /api/admin/approve/:id` — Approve pending changes (merge pendingChanges into live)
- `POST /api/admin/reject/:id` — Reject pending changes (clear pendingChanges, optional message)
- `GET /api/admin/claims` — Get all pending claim requests
- `POST /api/admin/claims/:id/approve` — Approve claim: assign ownerId, mark as claimed
- `POST /api/admin/claims/:id/reject` — Reject claim with reason

**Stripe prices (hardcode these IDs — replace with real ones from Stripe dashboard):**
```js
const STRIPE_PRICES = {
  basic_monthly:    process.env.STRIPE_PRICE_BASIC_MONTHLY    || 'price_basic_monthly_placeholder',
  basic_annual:     process.env.STRIPE_PRICE_BASIC_ANNUAL     || 'price_basic_annual_placeholder',
  standout_monthly: process.env.STRIPE_PRICE_STANDOUT_MONTHLY || 'price_standout_monthly_placeholder',
  standout_annual:  process.env.STRIPE_PRICE_STANDOUT_ANNUAL  || 'price_standout_annual_placeholder',
  showoff_monthly:  process.env.STRIPE_PRICE_SHOWOFF_MONTHLY  || 'price_showoff_monthly_placeholder',
  showoff_annual:   process.env.STRIPE_PRICE_SHOWOFF_ANNUAL   || 'price_showoff_annual_placeholder',
};
```

Add `stripe` to package.json dependencies. In server.js, wrap all Stripe calls in try/catch that returns a helpful error if keys aren't configured yet (so the app runs without Stripe keys during dev).

---

### portal.html — Booth owner portal dashboard
- Shows the user's claimed listings
- "Claim a Location" button → opens claim flow
- "Add New Location" button → opens create flow  
- Subscription status badge (tier name + renewal date)
- "Manage Billing" button → Stripe customer portal
- Each listing card shows: name, tier badge, status (Active / Pending Approval), "Edit" button

### portal-claim.html — Claim or Create listing flow
**Step 1: Search** — Live search box that searches the 700 existing locations by name/booth number
- Shows matching results as cards with location name, category, booth number
- Each card has "Claim This Location" button
- At bottom: "My location isn't listed — Create New" link → goes to create form

**Step 2: Verify ownership** — Small form:
- "How can you verify you own this location?" text area (booth number, business name, etc.)
- Tier selection (radio buttons with pricing for Basic/Stand Out/Show Off + monthly/annual toggle)
- "Continue to Payment" button → triggers Stripe checkout
- Note: if Stripe keys not configured, show "Stripe not configured — contact admin"

**Step 3: Confirmation** — After Stripe callback
- "Your claim has been submitted! An admin will review and approve it within 24 hours."
- Link back to portal

### portal-edit.html — Edit listing form (tier-gated)
Shows different fields based on the user's subscription tier:

**All tiers (Basic+):**
- Business/Booth Name
- Short Description (max 280 chars)
- Full Description (rich text — just a textarea, no editor needed)
- Address / Booth Number
- Category (dropdown — limited to 1 for Basic, 3 for Stand Out+)

**Stand Out+ only:**
- Photos — upload up to 3 images (shows locked message with upgrade CTA if Basic)

**Show Off only:**
- Video URL (YouTube or Vimeo)
- Website URL
- Social Links (FB, IG, Twitter, TikTok)
- (Shows locked message with upgrade CTA for Basic/Stand Out)

Submit button: "Submit for Review" — saves to pendingChanges, does NOT go live
Shows yellow banner: "⚠️ Changes will go live after admin review (usually within 24h)"

If there are already pendingChanges on this listing, show a blue banner: "You have changes pending review. Submitting new changes will replace your pending submission."

### signup.html — New customer signup page
Clean marketing page with:
- 3 pricing cards (Basic / Stand Out / Show Off)
- Monthly/Annual toggle (show savings)
- Each card has feature list and "Get Started" button
- "Already have an account? Sign in" link

"Get Started" → shows registration form inline:
- Business Name / Display Name
- Email address
- Username
- Password
- Then "Continue to Payment" → Stripe checkout

### login.html — already exists, just add "Sign up as a listing owner" link

---

## 4. Admin Panel Updates (admin.html + admin.js)

Add two new tabs to the existing admin panel:

### Tab: "Approvals" (approval queue)
- Badge with count of pending approvals on tab label
- List of locations with pending changes
- Each row shows: location name, owner name, date submitted, "Review" button
- Review modal:
  - Left side: Current live data
  - Right side: Proposed changes (highlight differences in yellow)
  - "Approve" button (green) — merges changes live
  - "Reject" button (red) — clears pendingChanges, optionally sends rejection note
  - Rejection note textarea (optional)

### Tab: "Claims" (claim queue)
- Badge with count of pending claims
- List of pending claim/create requests
- Each row: location name (or "NEW: [name]"), claimant username, date, verification note, "Review" button
- Review modal:
  - Shows location details + claimant info + verification text
  - "Approve Claim" — sets location.ownerId, location.listingTier to their subscribed tier
  - "Reject" — rejects with optional note

### Tab: "Listings" (new overview — or add to existing Locations tab)
- Add "Tier" column to location list showing tier badge (unclaimed/basic/standout/showoff)
- Add "Owner" column showing owner username if claimed
- Filter by tier

---

## 5. Navigation / Routes

| URL | Auth | Description |
|-----|------|-------------|
| `/` | public | Map viewer |
| `/login` | public | Admin/owner login |
| `/signup` | public | New listing owner signup |
| `/portal` | booth_owner | Owner dashboard |
| `/portal/claim` | booth_owner | Claim/create flow |
| `/portal/edit/:id` | booth_owner (owns location) | Edit listing |
| `/admin` | admin/editor | Admin panel |

**Middleware logic:**
- `requireBoothOwner`: user must have role "booth_owner" OR "admin"
- Portal pages served as static HTML files (like admin.html)
- Add GET routes in server.js to serve them with auth check

---

## 6. Stripe Setup Notes

Add to package.json: `"stripe": "^14.x"`

Create `.env.example` with:
```
STRIPE_SECRET_KEY=sk_test_...
STRIPE_WEBHOOK_SECRET=whsec_...
STRIPE_PRICE_BASIC_MONTHLY=price_...
STRIPE_PRICE_BASIC_ANNUAL=price_...
STRIPE_PRICE_STANDOUT_MONTHLY=price_...
STRIPE_PRICE_STANDOUT_ANNUAL=price_...
STRIPE_PRICE_SHOWOFF_MONTHLY=price_...
STRIPE_PRICE_SHOWOFF_ANNUAL=price_...
```

Webhook events to handle:
- `checkout.session.completed` — activate subscription, assign tier to user
- `customer.subscription.updated` — update tier/status
- `customer.subscription.deleted` — mark subscription canceled
- `invoice.payment_failed` — mark subscription past_due

All Stripe code should be wrapped so the app starts/runs without keys (just disables payment features gracefully with a visible "Stripe not configured" message).

---

## 7. Style Notes
- Portal and signup pages should share style.css plus portal-specific styles in a `portal.css`
- Match the dark admin nav bar style for portal nav
- Green brand color: `#357717` (matches the map's search bar)
- Listing tier color badges:
  - unclaimed: grey `#9ca3af`
  - basic: blue `#3b82f6`
  - standout: purple `#8b5cf6`
  - showoff: gold `#f59e0b`

---

## 8. What NOT to Change
- `index.html` — public map viewer, don't touch
- `map.js` — map logic, don't touch
- `style.css` — map styles, don't touch (use portal.css for new pages)
- Existing location data in `data/locations.json` — add new fields but don't modify existing data
- The 700 existing listings remain active and visible on the map regardless of tier

---

## Completion Criteria
1. `npm start` runs without errors
2. `/signup` page loads with 3 pricing tiers
3. A new user can register as booth_owner
4. A booth_owner can search and submit a claim request
5. Admin `/admin` panel shows Claims and Approvals tabs with working approve/reject
6. A booth_owner can edit their claimed listing and see "pending review" state
7. Admin can approve changes and they go live
8. Stripe checkout redirects to Stripe (even if keys are test/placeholder — graceful error if unconfigured)
9. All existing map functionality unchanged

---

When completely finished, run:
openclaw system event --text "FairMap listing portal built — signup, claim flow, approval queue, Stripe scaffolded" --mode now
