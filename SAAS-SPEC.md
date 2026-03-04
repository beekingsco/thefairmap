# TheFairMap SaaS Platform — Full Build Spec
**Created:** 2026-03-04  
**Status:** ACTIVE BUILD

---

## Vision
Transform TheFairMap from a single-tenant app (First Monday Trade Days only) into a multi-tenant SaaS platform where any fair, market, or trade show can get their own interactive vendor map.

**URL:** `thefairmap.com`  
**Revenue model:** Map owner subscriptions + vendor listing fees (vendor billing flows through the platform)

---

## Architecture

### 3-Tier System

| Tier | Who | Access | What they do |
|---|---|---|---|
| **Platform Admin** | Chris | `thefairmap.com/platform` | Manage all maps, all tenants, platform billing |
| **Map Owner** | e.g. Lewis family (VFM) | `firstmonday.thefairmap.com` | Manage their map, approve vendor edits, view vendor billing |
| **Vendor** | Booth holders | `firstmonday.thefairmap.com/vendors/my-booth` | Edit listing, manage photos/video, pay monthly fee |

### Subdomain Routing
- `thefairmap.com` → Marketing landing page
- `thefairmap.com/platform` → Platform admin (Chris only)
- `thefairmap.com/signup` → New map owner signup
- `[slug].thefairmap.com` → Tenant map (public-facing)
- `[slug].thefairmap.com/admin` → Map owner admin panel
- `[slug].thefairmap.com/vendors` → Vendor portal (login required)
- `[slug].thefairmap.com/vendors/claim` → Vendor claim flow

---

## Data Model

### Tenants (maps)
```json
{
  "id": "uuid",
  "slug": "firstmonday",
  "name": "First Monday Trade Days",
  "ownerEmail": "howdy@visitfirstmonday.com",
  "ownerName": "First Monday Admin",
  "plan": "pro",
  "stripeCustomerId": "cus_xxx",
  "stripeSubscriptionId": "sub_xxx",
  "status": "active",
  "settings": {
    "mapCenter": [-95.8624, 32.5585],
    "mapZoom": 17,
    "mapPitch": 60,
    "primaryColor": "#2f3d4d",
    "logoUrl": null,
    "customDomain": null
  },
  "createdAt": "ISO8601"
}
```

### Vendors (per-tenant)
```json
{
  "id": "uuid",
  "tenantId": "uuid",
  "locationId": "string",
  "email": "vendor@example.com",
  "name": "Vendor Business Name",
  "plan": "basic|showoff|standout",
  "billingCycle": "monthly|annual",
  "stripeCustomerId": "cus_xxx",
  "stripeSubscriptionId": "sub_xxx",
  "billingStatus": "active|past_due|cancelled|migrated",
  "migratedFromCF": true,
  "cfSubscriptionId": "cf_xxx",
  "renewalDate": "ISO8601",
  "status": "active|pending|suspended",
  "createdAt": "ISO8601"
}
```

### Locations (per-tenant, extended)
Extend current locations.json format with:
```json
{
  "id": "string",
  "tenantId": "uuid",
  "vendorId": "uuid|null",
  "name": "...",
  "description": "...",
  "lat": 0,
  "lng": 0,
  "categoryId": "...",
  "categoryName": "...",
  "tier": "free|basic|showoff|standout",
  "photos": [],
  "logoUrl": null,
  "videoUrl": null,
  "websiteUrl": null,
  "socialLinks": {},
  "pendingEdits": null,
  "approvalStatus": "live|pending|rejected"
}
```

### Pending Edits Queue
```json
{
  "id": "uuid",
  "tenantId": "uuid",
  "locationId": "string",
  "vendorId": "uuid",
  "submittedAt": "ISO8601",
  "changes": { "field": "newValue" },
  "status": "pending|approved|rejected",
  "reviewedBy": "uuid|null",
  "reviewedAt": "ISO8601|null",
  "reviewNote": "string|null"
}
```

---

## Vendor Pricing Tiers

| Tier | Monthly | Annual | Features |
|---|---|---|---|
| **Free** | $0 | $0 | Text-only listing, name + description + 3 categories |
| **Basic** | $4.99 | $49.99 | Same as free (paid = priority support, future features) |
| **Show Off** | $9.99 | $99.00 | Photos (up to 10) + custom logo marker on map |
| **Stand Out** | $19.99 | $199.00 | Everything + YouTube/Vimeo video embed + social links + website URL |

### Map Owner Plans (future — skip for MVP)
- Start with manual onboarding (Chris approves each map owner)

---

## Pages to Build

### 1. `thefairmap.com` — Marketing Landing Page
- Hero: "Your fair. Your map. Your brand."
- Features section (vendor management, approval workflow, mobile-ready)
- Pricing (teaser — "contact us to get started")
- CTA: "Get your map →" → /signup
- Clean, modern design. NOT the current map viewer.

### 2. `thefairmap.com/signup` — Map Owner Signup
- Fields: Name, Email, Organization/Event name, Desired subdomain, Message
- On submit: creates pending tenant record, sends email to Chris to approve
- Confirmation page: "We'll be in touch within 24 hours"

### 3. `thefairmap.com/platform` — Platform Admin (Chris only)
- List all tenants (slug, owner, vendor count, status)
- Approve/reject new signup requests
- View revenue summary (tenant count, vendor billing totals)
- Impersonate any tenant admin
- Manage Stripe price IDs

### 4. `[slug].thefairmap.com` — Public Map (existing viewer)
- Same MapLibre GL map as current build
- Loads tenant-specific locations from API
- Vendor tier visible: Show Off → custom logo dot, Stand Out → video in popup
- "Claim your listing" link in footer/popup for unclaimed pins

### 5. `[slug].thefairmap.com/admin` — Map Owner Admin
- Login: email + password (tenant owner only)
- **Dashboard:** vendor count, pending approvals, monthly billing total
- **Map editor:** add/edit/delete locations (existing admin panel, scoped to tenant)
- **Pending queue:** review vendor edit submissions → approve/reject with note
- **Vendor list:** all vendors, their tier, billing status, renewal date
- **Categories:** manage categories for this map
- **Settings:** map center/zoom, colors, logo

### 6. `[slug].thefairmap.com/vendors/claim` — Vendor Claim Flow
- Step 1: Enter email address
- Step 2: Show matching pin(s) on the map → "Is this your booth?"
- Step 3: Pick a plan (Free, Basic, Show Off, Stand Out)
- Step 4: Stripe checkout (if paid plan)
- Step 5: Set password, confirm account
- Email sent: "Welcome — your listing is live (or pending approval)"

### 7. `[slug].thefairmap.com/vendors/login` — Vendor Login

### 8. `[slug].thefairmap.com/vendors/dashboard` — Vendor Dashboard
- View their current listing (live version)
- Edit listing fields based on plan:
  - Free/Basic: name, description, categories
  - Show Off: + photos, logo upload
  - Stand Out: + video URL, social links, website
- Submit changes → goes to pending queue (badge shows "Awaiting approval")
- Billing section: current plan, renewal date, upgrade/downgrade/cancel
- Upgrade CTA if on lower tier

---

## Tech Stack

### Backend
- **Node.js + Express** (same as current server.js — extend it)
- **SQLite** via `better-sqlite3` — replaces JSON files, supports multi-tenant
- **express-session** — same as current
- **Stripe** — vendor billing + map owner billing
- **Nodemailer or Resend** — transactional email
- **Multer** — photo uploads (same as current)

### Frontend
- Vanilla HTML/CSS/JS (no frameworks — consistent with current codebase)
- MapLibre GL JS for all map views
- Existing style.css extended

### Subdomain Routing
- Express middleware reads `req.hostname`
- `thefairmap.com` → serves marketing/platform routes
- `*.thefairmap.com` → extracts slug, loads tenant context, serves tenant routes
- For local dev: use `localhost:4000` with `?tenant=firstmonday` query param fallback

### Database Schema (SQLite)
```sql
CREATE TABLE tenants (
  id TEXT PRIMARY KEY,
  slug TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  owner_email TEXT NOT NULL,
  owner_name TEXT,
  owner_password TEXT,
  plan TEXT DEFAULT 'manual',
  stripe_customer_id TEXT,
  stripe_subscription_id TEXT,
  status TEXT DEFAULT 'pending',
  settings TEXT DEFAULT '{}',
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE locations (
  id TEXT NOT NULL,
  tenant_id TEXT NOT NULL,
  vendor_id TEXT,
  name TEXT,
  description TEXT,
  lat REAL,
  lng REAL,
  category_id TEXT,
  category_name TEXT,
  tier TEXT DEFAULT 'free',
  photos TEXT DEFAULT '[]',
  logo_url TEXT,
  video_url TEXT,
  website_url TEXT,
  social_links TEXT DEFAULT '{}',
  pending_edits TEXT,
  approval_status TEXT DEFAULT 'live',
  PRIMARY KEY (id, tenant_id)
);

CREATE TABLE vendors (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  location_id TEXT,
  email TEXT NOT NULL,
  name TEXT,
  password TEXT,
  plan TEXT DEFAULT 'free',
  billing_cycle TEXT DEFAULT 'monthly',
  stripe_customer_id TEXT,
  stripe_subscription_id TEXT,
  billing_status TEXT DEFAULT 'active',
  migrated_from_cf INTEGER DEFAULT 0,
  renewal_date TEXT,
  status TEXT DEFAULT 'active',
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE pending_edits (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  location_id TEXT NOT NULL,
  vendor_id TEXT NOT NULL,
  submitted_at TEXT DEFAULT (datetime('now')),
  changes TEXT NOT NULL,
  status TEXT DEFAULT 'pending',
  reviewed_by TEXT,
  reviewed_at TEXT,
  review_note TEXT
);

CREATE TABLE sessions (
  sid TEXT PRIMARY KEY,
  sess TEXT,
  expired TEXT
);
```

---

## Migration: First Monday as Tenant #1

1. Create tenant record: slug=`firstmonday`, owner=`howdy@visitfirstmonday.com`
2. Import all existing `data/locations.json` into `locations` table under this tenant
3. Import all existing `data/users.json` vendor accounts into `vendors` table
4. Set all existing locations to `tier=free`, `approval_status=live`
5. When Stripe migration runs later: match vendor emails → update plan + billing fields

### Stripe Migration (deferred — do after platform is live)
- Pull all active subscriptions from `info@beekings.com` Stripe account
- Match by email to vendor records
- Update plan tier + billing cycle + renewal date
- Send "claim your account" email to each paying vendor

---

## File Structure

```
thefairmap/
├── server.js              ← REWRITTEN — multi-tenant router
├── db.js                  ← NEW — SQLite setup + helpers
├── routes/
│   ├── platform.js        ← NEW — platform admin routes
│   ├── tenant.js          ← NEW — tenant admin routes  
│   ├── vendor.js          ← NEW — vendor portal routes
│   ├── public.js          ← NEW — public map + API routes
│   └── auth.js            ← NEW — login/logout/session
├── public/
│   ├── index.html         ← REWRITTEN — marketing landing page
│   ├── signup.html        ← NEW — map owner signup
│   ├── map.html           ← MOVED — the actual map viewer
│   ├── map.js             ← KEPT — map logic (tenant-aware)
│   ├── style.css          ← EXTENDED
│   ├── admin.html         ← KEPT + scoped to tenant
│   ├── admin.js           ← KEPT + tenant-aware
│   ├── vendor-claim.html  ← NEW
│   ├── vendor-login.html  ← NEW
│   └── vendor-dash.html   ← NEW
├── data/
│   ├── thefairmap.db      ← NEW — SQLite database
│   └── locations.json     ← KEPT for migration seed
├── uploads/               ← KEPT
├── ecosystem.config.js    ← UPDATE — add env vars
├── package.json           ← UPDATE — add better-sqlite3
└── SAAS-SPEC.md           ← THIS FILE
```

---

## MVP Scope (Build Now)

**In scope:**
- [ ] SQLite DB setup with schema
- [ ] Multi-tenant subdomain routing in Express
- [ ] Marketing landing page (thefairmap.com)
- [ ] Platform admin (/platform) — tenant list + approve signups
- [ ] Tenant map viewer (slug.thefairmap.com) — public map, tenant-scoped data
- [ ] Tenant admin panel (slug.thefairmap.com/admin) — existing admin scoped to tenant
- [ ] Vendor claim flow (4-step: find booth → pick plan → Stripe → set password)
- [ ] Vendor dashboard (view listing, submit edits, billing info)
- [ ] Pending approval queue in tenant admin
- [ ] Stripe: vendor subscription checkout + webhook handling
- [ ] First Monday data migration (seed tenant #1 from existing locations.json)
- [ ] Email: claim invite, approval notification, welcome

**Out of scope for MVP:**
- Map owner signup self-service (manual for now — Chris approves)
- Map owner Stripe billing (manual invoicing for now)
- Custom domain support (CNAME mapping)
- Vendor mobile app
- CF subscription import (deferred — do after platform is live)

---

## Environment Variables Needed

```env
PORT=4000
NODE_ENV=production
BASE_URL=https://thefairmap.com
PLATFORM_ADMIN_EMAIL=chris@beekings.com
PLATFORM_ADMIN_PASS=[from 1password]
SESSION_SECRET=[random 64 char string]

# Stripe
STRIPE_SECRET_KEY=sk_live_xxx
STRIPE_WEBHOOK_SECRET=whsec_xxx
STRIPE_PRICE_BASIC_MONTHLY=price_xxx
STRIPE_PRICE_BASIC_ANNUAL=price_xxx
STRIPE_PRICE_SHOWOFF_MONTHLY=price_xxx
STRIPE_PRICE_SHOWOFF_ANNUAL=price_xxx
STRIPE_PRICE_STANDOUT_MONTHLY=price_xxx
STRIPE_PRICE_STANDOUT_ANNUAL=price_xxx

# Email
RESEND_API_KEY=re_xxx
FROM_EMAIL=hello@thefairmap.com

# First Monday tenant seed
SEED_TENANT=true
```

---

## Local Dev

```bash
cd /Users/scoutbot/.openclaw/workspace/thefairmap
npm install
node server.js
# Map viewer: http://localhost:4000/?tenant=firstmonday
# Admin: http://localhost:4000/admin?tenant=firstmonday
# Vendor portal: http://localhost:4000/vendors?tenant=firstmonday
# Platform admin: http://localhost:4000/platform
```

In production, subdomains route automatically. In local dev, `?tenant=slug` is the fallback.

---

## Notes for Agent

- Preserve ALL existing map functionality (MapLibre, markers, search, categories, filters)
- The map viewer itself barely changes — just becomes tenant-aware via API
- server.js is 848 lines — rewrite it cleanly with the routes/ split
- Keep bcryptjs for passwords, stripe for billing, multer for uploads
- Use `better-sqlite3` (sync API — simpler than async sqlite3)
- Run `npm install better-sqlite3 resend` to add new deps
- The existing locations.json has 3 test locations — use mapme-full-export.json if it exists for real data
- Test: after migration, `firstmonday.thefairmap.com` (or `localhost:4000/?tenant=firstmonday`) should show the full map exactly as it does today
- DO NOT break the existing map — it's live and people are using it
- Deploy target: same PM2 setup on Scout's Mac mini, port 4000
