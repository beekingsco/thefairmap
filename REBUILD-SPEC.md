# TheFairMap v2 — Complete Rebuild Spec

## Goal
Production-ready replacement for MapMe.com's "First Monday Finder" map at `viewer.mapme.com/first-monday-finder`. Chris's staff must be able to transition seamlessly — feature parity is non-negotiable.

**Target:** Cancel MapMe subscription once TheFairMap is fully live.

---

## 1. Map Engine

| Detail | Value |
|--------|-------|
| Library | MapLibre GL JS v4.9.1 (CDN: unpkg) |
| Tile provider | MapTiler |
| Custom style ID | `daff07a7-1b27-4d4e-bdc0-c18601af5067` |
| Style proxy | `/api/map-style` (Vercel Edge Function) |
| Fallback style | OpenFreeMap Liberty (`tiles.openfreemap.org/styles/liberty`) |
| Default center | `[-95.86328, 32.55795]` (Boardwalk area) |
| Default zoom | 17 |
| Default pitch | 60 (3D perspective) |
| Default bearing | 0 |
| maxZoom | 20 |

### Map Styles
- **Venue mode** — MapTiler custom style with 3D buildings, satellite/vector hybrid. Default on load.
- **Satellite mode** — MapTiler satellite imagery. Toggle via map controls.
- Style switching preserves camera position and all marker layers.

### Terrain
- MapTiler DEM terrain for 3D extrusion (optional, enhances 3D buildings feel).

---

## 2. Location Data

- **Source:** `data/mapme-full-export.json` (429 KB, 719 locations, 67 categories)
- **Runtime fetch:** Tries `/api/locations` first, falls back to `/data/mapme-full-export.json`
- **Working copy:** `data/locations.json` (identical structure)

### Location Schema
```json
{
  "id": "uuid",
  "externalId": "uuid (MapMe reference)",
  "name": "string",
  "description": "HTML string (<p>, <br>, <strong>)",
  "address": "string (may be empty)",
  "lat": 32.56476165,
  "lng": -95.86567022,
  "categoryId": "uuid",
  "categoryName": "string",
  "inactive": { "address": true },
  "zoom": 20.02,
  "pitch": 60,
  "bearing": 0
}
```

### Rules
- Descriptions contain raw HTML — must sanitize on render (escapeHtml for untrusted fields, allow safe tags for display).
- Inactive locations (`inactive.address === true`): render on map, hide address in detail panel.
- All 719 locations must render — no filtering at data load.

---

## 3. Categories (67 total)

### Category Schema
```json
{
  "id": "uuid",
  "name": "string",
  "color": "#ff00ffff (RGBA hex)",
  "shape": "circle | pin | none",
  "icon": "svg",
  "count": 81
}
```

### Category Groups (5 hardcoded)
1. **My Favorites**
2. **Market Amenities**
3. **Food & Drink**
4. **Shop by Product Type**
5. **Entertainment & Rentals**

Groups are collapsible in the sidebar. Each group contains its relevant categories.

### Category Icons
- 66+ SVG icons in `data/icons/` (kebab-case filenames matching category names)
- Manifest: `data/icons/manifest.json` for explicit mappings
- Fallback: generic built-in SVG icons (fork, shirt, gem, home, star, etc.)

### Map Markers
- Colored circles (~35px) using category color as background
- SVG icon overlaid on circle
- Cluster layer for zoomed-out views (700+ pins need aggregation)
- Hover highlight layer
- Selected/active highlight layer

---

## 4. UI Layout

### Desktop (>960px)
```
┌──────────────────────────────────────────────┐
│  Header Bar (logo, search, date/cycle info)  │
├────────────┬─────────────────────────────────┤
│  Sidebar   │         Map Area                │
│  (358px)   │  ┌─────────┐                    │
│            │  │ Controls │ (zoom, geo,        │
│  - Search  │  │ top-right│  style toggles)    │
│  - Filters │  └─────────┘                    │
│  - Category│                                 │
│    overview │                  ┌─────────────┤
│  - Location│                  │ Detail Panel ││
│    list    │                  │ (right card) ││
│            │                  └─────────────┤│
│            ├─────────────────────────────────┤
│            │  Bottom Panel (vendor list,     │
│            │  recent updates — tabbed)       │
└────────────┴─────────────────────────────────┘
```

### Mobile (<=960px)
- Sidebar becomes overlay/drawer with scrim backdrop
- Bottom panel becomes swipeable sheet with drag handle
- Detail panel becomes full-width overlay
- Map controls reposition for thumb reach
- Mobile-specific search bar in topbar

### Sidebar Components
1. **Search bar** — full-text search across name, category, address, description
2. **Category filter** — show/hide categories, grouped in collapsible sections
3. **Category overview** — list of all categories with colored icons and location counts
4. **Location list** — filtered results, clickable to open detail

### Map Controls (top-right)
1. Zoom in/out
2. Compass (reset bearing)
3. Geolocate ("Find me")
4. Style toggle: Venue / Satellite
5. Venue overlay toggle (booth/pavilion tiles)

### Detail Panel
- Location name (bold)
- Description (rendered HTML)
- Category badge (colored)
- Address (if not inactive)
- Close button

### Bottom Panel
- Tabbed: Vendors / Recent Updates
- Draggable on mobile (sheet handle)

---

## 5. Venue Tile Overlay

The venue overlay shows colored pavilion rows and booth numbers, matching MapMe's visual hierarchy.

### Architecture
```
Client (MapLibre)
  → /api/venue-tile/{z}/{x}/{y}.png   (Vercel Edge Function)
    → MapTiler tiles API                (tileset 0196a1e2-92d2-7ed9-9540-2191fb00a1af)
```

### Edge Functions
| Endpoint | File | Purpose |
|----------|------|---------|
| `/api/map-style` | `api/map-style.js` | Proxy MapTiler custom style JSON, hides API key |
| `/api/venue-tile-style` | `api/venue-tile-style.js` | Proxy venue tileset metadata (tiles.json) |
| `/api/venue-tile/{z}/{x}/{y}.png` | `api/venue-tile/[...slug].js` | Proxy individual venue raster tiles |
| `/api/tile?z=&x=&y=` | `api/tile.js` | Proxy base map tiles |

### Client Integration
- Tileset metadata fetched from `/api/venue-tile-style` on load
- Raster overlay source added as `venue-overlay` with tiles from `/api/venue-tile/{z}/{x}/{y}.png`
- Layer `venue-overlay-layer` inserted beneath road labels but above base map
- Opacity fades in as user zooms closer (full detail at booth-level zoom)
- Toggle button shows/hides overlay
- Hidden in satellite mode (no venue tiles available)

### Caching
- All tile proxy responses: `Cache-Control: public, max-age=86400, stale-while-revalidate=604800` (24h fresh, 7-day stale)
- CORS: `Access-Control-Allow-Origin: *`

### Authentication
- All proxies add `Referer: https://viewer.mapme.com/` and `Origin: https://viewer.mapme.com` headers
- `MAPTILER_KEY` env var required on server (never exposed to client)

---

## 6. Search & Filtering

### Search Engine (client-side)
- Full-text search against concatenated: `name + categoryName + address + description`
- Stored as lowercase `loc.search` field for fast matching
- Suggestion scoring: exact start match (3) > name match (2) > description match (1)
- Max 12 suggestions displayed
- Live filtering as user types
- Search input synced across header, sidebar, and mobile topbar

### Search UX
- Autocomplete dropdown with category-colored badges
- Escape key / click-outside / location-open all dismiss suggestions
- Results update map markers in real-time (hidden categories + search query)

### Category Filtering
- Toggle individual categories on/off
- Group-level toggle (show/hide all in group)
- Active filters update markers immediately via `applyFilters()`

---

## 7. Deep Linking

- Supports: `?loc=<id>`, `#loc=<id>`, `/location/<id>` (MapMe-compatible)
- Updates URL hash on location open: `#loc=<id>`
- On page load: if hash/param present, opens location and flies to marker
- Enables sharing direct links to specific vendors

---

## 8. Responsive Design

| Breakpoint | Layout |
|------------|--------|
| >960px | Desktop: sidebar (358px) + map + optional right panel |
| <=960px | Mobile: fullscreen map, overlay sidebar/drawer, swipe sheets |

### Mobile Features
- Touch-friendly marker sizes
- Swipeable bottom sheet with drag handle
- Scrim layers for drawer/overlay dismissal
- Repositioned map controls for thumb reach

---

## 9. Tech Stack

| Layer | Technology |
|-------|-----------|
| Map rendering | MapLibre GL JS 4.9.1 (CDN) |
| Base tiles | MapTiler (custom satellite/vector style, 3D buildings) |
| Venue overlay | MapTiler custom tileset (proxied through Edge Functions) |
| Frontend | Vanilla HTML/CSS/JS — **no frameworks** |
| Backend | Node.js + Express (server.js) |
| Database | SQLite3 via better-sqlite3 (WAL mode) |
| Hosting | Vercel (frontend + Edge Functions) + Railway (backend API) |
| Auth | Session-based (express-session) + Stripe integration |

### File Structure
```
/
├── index.html          # Map viewer (304 lines)
├── map.js              # Viewer logic (2249 lines)
├── style.css           # All styles (1939 lines)
├── admin.html          # Admin panel
├── admin.js            # Admin logic
├── server.js           # Express backend
├── db.js               # SQLite schema + queries
├── config.js           # Runtime config
├── vercel.json         # Routing + rewrites
├── api/
│   ├── map-style.js            # Edge: style proxy
│   ├── venue-tile-style.js     # Edge: tileset metadata proxy
│   ├── venue-tile/[...slug].js # Edge: venue tile proxy
│   ├── tile.js                 # Edge: base tile proxy
│   └── config.js               # Edge: client config
├── data/
│   ├── mapme-full-export.json  # Source data (719 locations, 67 categories)
│   ├── locations.json          # Working copy
│   ├── icons/                  # 66+ SVG category icons
│   └── venue-overlay.svg       # Pavilion/booth overlay graphic
├── routes/                     # Express route modules
├── public/                     # Platform dashboard pages
└── uploads/                    # User uploads
```

---

## 10. Deployment

| Target | Platform | URL |
|--------|----------|-----|
| Frontend + Edge Functions | Vercel | thefairmap.com |
| Backend API | Railway | thefairmap-production.up.railway.app |
| Repo | GitHub | beekingsco/thefairmap |

- Auto-deploys from GitHub on push
- Embeddable via `<iframe src="https://thefairmap.com">`
- `X-Frame-Options: ALLOWALL` configured in vercel.json

### Environment Variables (required on Vercel + Railway)
- `MAPTILER_KEY` — MapTiler API key for tile proxies
- `SESSION_SECRET` — Express session encryption
- `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` — Stripe integration
- `BASE_URL` — Server base URL

---

## 11. Feature Completion Status

### Viewer (index.html + map.js + style.css)
- [x] MapLibre GL JS with MapTiler custom style
- [x] 719 locations rendered as colored circle markers
- [x] 67 categories with icons, colors, grouping
- [x] Category filtering (show/hide)
- [x] Category overview panel with counts
- [x] Full-text search with autocomplete suggestions
- [x] Search suggestion scoring and ranking
- [x] Location detail panel with HTML description
- [x] Venue tile overlay (pavilion/booth numbers)
- [x] Venue/Satellite style toggle
- [x] Venue overlay toggle button
- [x] Zoom controls
- [x] Geolocation ("Find me")
- [x] 3D building rendering (pitch: 60)
- [x] Marker clustering at zoomed-out levels
- [x] Deep linking (?loc=, #loc=, /location/)
- [x] Mobile responsive (drawer, sheets, scrim)
- [x] Loading overlay with spinner
- [x] Error banner with retry
- [x] Embeddable via iframe
- [x] Escape/click-outside dismiss for search suggestions
- [x] Terrain/DEM support

### Edge Functions
- [x] `/api/map-style` — style proxy
- [x] `/api/venue-tile-style` — tileset metadata proxy
- [x] `/api/venue-tile/{z}/{x}/{y}.png` — venue tile proxy
- [x] `/api/tile` — base tile proxy

### Admin Panel
- [x] Add/edit locations via form
- [x] CSV import
- [x] JSON export
- [x] Table view of all locations

### Platform (SaaS)
- [x] Multi-tenant architecture
- [x] Vendor login/dashboard
- [x] Vendor claim workflow
- [x] Platform admin dashboard
- [x] Analytics dashboard
- [x] Stripe billing integration

---

## 12. Remaining Work (Priority Order)

### P0 — Ship Blockers
1. **Verify venue tile overlay renders correctly in production** — Confirm `/api/venue-tile/` returns valid PNG tiles on Vercel with the production `MAPTILER_KEY`.
2. **Replace MapMe API key** — Get our own MapTiler API key and update `MAPTILER_KEY` env var. Remove Referer spoofing once we own the key.
3. **Final visual QA vs MapMe** — Side-by-side comparison of thefairmap.com vs viewer.mapme.com/first-monday-finder. Document any rendering differences.

### P1 — Near-Term
4. **Own MapTiler tileset** — Upload our own venue tileset to MapTiler (from `data/venue-overlay.svg` or GeoJSON source) so we don't depend on MapMe's tileset ID.
5. **Performance audit** — Test with 719 markers on mobile. Ensure smooth panning/zooming. Consider reducing marker DOM if needed.
6. **Analytics tracking** — Add basic usage analytics (page views, search queries, popular locations).

### P2 — Future
7. **Vendor self-service** — Complete vendor portal for listing updates, photo uploads, description edits.
8. **Real-time updates** — Push location changes from admin to viewer without full page reload.
9. **PWA support** — Offline capability for on-site use at the trade grounds.

---

## Reference
- MapMe viewer: `viewer.mapme.com/first-monday-finder`
- TheFairMap production: `thefairmap.com`
- MapTiler style: `daff07a7-1b27-4d4e-bdc0-c18601af5067`
- Venue tileset: `0196a1e2-92d2-7ed9-9540-2191fb00a1af`
