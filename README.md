# 🗺️ TheFairMap

**Self-hosted interactive vendor map for fairs, markets, and trade days.**  
A replacement for MapMe.com — free to run, fully customizable.

## Live URLs

- **Map Viewer:** [TheFairMap.com](https://thefairmap.com)
- **Admin Panel:** [TheFairMap.com/admin](https://thefairmap.com/admin)

## Tech Stack

- **MapLibre GL JS** — free, open-source map rendering (Mapbox fork)
- **OpenFreeMap** — free map tiles (OpenStreetMap-based)
- **Vanilla JS** — no frameworks, fast loading
- **Vercel** — free static hosting with auto-deploy

**Total running cost: $0/year** (vs $3,500/year for MapMe Enterprise)

## Quick Start

```bash
# Clone
git clone https://github.com/beekingsco/thefairmap.git
cd thefairmap

# Local dev (any static server works)
npx serve .
# Open http://localhost:3000
# Admin at http://localhost:3000/admin.html
```

## How to Update Vendor Locations

### Option 1: Admin Panel
1. Go to `/admin` (password: `fairmap2026`)
2. Click the map to drop a pin → fill out the form → Add
3. Click **Export JSON** → download the updated `locations.json`
4. Replace `data/locations.json` in the repo → commit → push → auto-deploys

### Option 2: Edit JSON Directly
Edit `data/locations.json` — each location looks like:
```json
{
  "id": "beekings-1",
  "name": "Bee King's Honey",
  "category": "honey",
  "booth": "Arbor 1, Booths 65-68",
  "description": "Texas raw honey...",
  "lat": 32.5540,
  "lng": -95.8660,
  "website": "https://beekings.com",
  "image": "",
  "featured": true
}
```

### Option 3: CSV Import
1. Open `/admin`
2. Paste CSV with columns: `name, category, booth, lat, lng, description, website, image, featured`
3. Click Import → Export JSON → commit

## Embedding on a Website

### WordPress / Squarespace / Any Site
```html
<iframe src="https://thefairmap.com" width="100%" height="600" frameborder="0"></iframe>
```

### With Specific Map
```html
<iframe src="https://thefairmap.com?map=firstmonday" width="100%" height="600" frameborder="0"></iframe>
```

## Categories

| ID | Name | Color | Icon |
|---|---|---|---|
| food | Food & Drink | #FF6B35 | 🍽️ |
| honey | Honey & Bees | #F7C948 | 🍯 |
| crafts | Crafts & Art | #7B68EE | 🎨 |
| antiques | Antiques | #8B4513 | 🏺 |
| plants | Plants & Garden | #2ECC71 | 🌿 |
| general | General Vendors | #95A5A6 | 🛍️ |

Edit categories in `data/locations.json` → `categories` array.

## Deploy to Vercel

```bash
# Install Vercel CLI
npm i -g vercel

# Deploy
vercel --prod
```

Or connect the GitHub repo → Vercel auto-deploys on push.

## File Structure

```
thefairmap/
├── index.html          # Map viewer (embeddable)
├── admin.html          # Admin panel
├── style.css           # All styles
├── map.js              # Viewer logic
├── admin.js            # Admin logic
├── data/
│   └── locations.json  # All location data
├── vercel.json         # Vercel routing config
└── README.md           # This file
```

## License

MIT — Built for BeeKings / First Monday Trade Days.
