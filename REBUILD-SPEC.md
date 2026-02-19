# TheFairMap v2 — Complete Rebuild Spec

## Goal
Rebuild TheFairMap to be a production-ready replacement for MapMe.com's "First Monday Finder" map.
This must be an exact feature-equivalent replacement so Chris's staff can seamlessly transition.

## Critical Requirements

### 1. Map Engine
- **MapLibre GL JS** (latest stable v4.x) — free Mapbox GL JS fork
- **MapTiler** for tile provider — use the same style MapMe uses (satellite/vector hybrid with 3D buildings)
  - MapTiler API key from MapMe: `YOUR_MAPTILER_KEY` (free tier, we'll replace later with our own)
  - Style URL: `https://api.maptiler.com/maps/daff07a7-1b27-4d4e-bdc0-c18601af5067/style.json?key=YOUR_MAPTILER_KEY`
  - This gives us the SAME tile rendering as the MapMe map (3D buildings, satellite overlay)
- Default view: center=[-95.8624, 32.5585], zoom=17, pitch=60, bearing=0
- maxZoom: 20

### 2. Location Data
- All 719 locations are in `data/mapme-full-export.json`
- Each location has: id, name, description (HTML), lat, lng, categoryId, categoryName, address
- Descriptions contain HTML formatting (bold, line breaks, paragraphs)
- Some locations are "inactive" (address hidden) — still show them on the map

### 3. Categories (67 total)
- Each category has: id, name, color, shape (circle/pin/none), count
- Must display as colored circle markers with the category color
- Support category filtering (show/hide categories)
- Display a collapsible category legend/overview panel

### 4. UI Layout — Match MapMe Viewer
The MapMe viewer has:
- **Left sidebar (collapsible)** with:
  - Search bar at top
  - Category overview panel (expandable/collapsible) showing all categories with their marker icons and counts
  - Clicking a category expands to show its locations
- **Map area** filling the rest of the screen
  - 3D perspective view (pitch: 60)
  - Colored circle markers for each location
  - Markers sized ~35px with category color background
  - Zoom controls (top-right)
  - Geolocation button ("Find my location")
  - Map attribution (bottom)
- **Location popup** when clicking a pin:
  - Location name (bold)
  - Description (with HTML)
  - Category badge
- **Mobile responsive** — sidebar becomes overlay/drawer

### 5. Key Features to Replicate
- [x] Search locations by name
- [x] Category filter (show/hide categories)
- [x] Category overview with location counts
- [x] Click pin to see popup with details
- [x] Geolocation ("Find me")
- [x] Zoom controls
- [x] Mobile responsive
- [x] Embeddable via iframe
- [x] 3D building rendering (from MapTiler)
- [x] Marker clustering (optional but nice for zoomed-out view with 700+ pins)

### 6. Admin Panel (admin.html)
Keep the existing admin panel but update it to work with the new data format:
- Click map to add pin
- Form to fill in name, description, category, etc.
- CSV import
- JSON export
- Table view of all locations

### 7. Tech Stack
- **NO frameworks** — vanilla HTML/CSS/JS (keeps it fast and simple)
- **MapLibre GL JS 4.x** via CDN
- **Static hosting** (Vercel) — no backend needed
- Data loaded from `data/locations.json`

### 8. Deployment
- Auto-deploys via Vercel from GitHub (beekingsco/thefairmap)
- Custom domain: thefairmap.com
- Embeddable via `<iframe src="https://thefairmap.com">`

### 9. Data Migration
- Convert `data/mapme-full-export.json` → `data/locations.json` in the TheFairMap format
- The new locations.json should include ALL 719 locations with their categories
- HTML descriptions must be preserved

### 10. Color Scheme
Keep the warm earth-tone theme from TheFairMap v1 but make it feel more professional.
The MapMe viewer uses a clean white/gray UI with colored markers. Match that clean feel.

## Files to Modify
- `index.html` — rebuilt map viewer
- `map.js` — rebuilt map logic with MapTiler + all features
- `style.css` — updated styles to match MapMe viewer feel
- `data/locations.json` — migrated from mapme-full-export.json
- `admin.html` — updated admin panel
- `admin.js` — updated admin logic

## What NOT to Change
- `vercel.json` — keep existing config
- `.git` — don't mess with git history
- `README.md` — update after rebuild

## Priority
Get the viewer (index.html + map.js + style.css) working perfectly first.
Admin panel is secondary.

## Reference
The MapMe viewer is live at: https://viewer.mapme.com/first-monday-finder
Use the same MapTiler style and tile source for identical appearance.
