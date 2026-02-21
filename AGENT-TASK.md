# TheFairMap Build Task — UPDATED 2026-02-21 1:30 PM

## STATUS: MAP IS LIVE — NOW POLISH TO MATCH MAPME

The map is rendering all 719 markers with MapTiler streets-v2 tiles. Chris's MapTiler key is deployed in config.js.

## YOUR JOB: Fix these 4 things in ORDER

### 1. MAP PITCH (3D tilt)
Set map `pitch: 60` in the MapLibre GL initialization options in map.js. MapMe uses a dramatic 3D aerial tilt. Also set `bearing: 0` and ensure smooth rotation works.

### 2. SIDEBAR COLLAPSED BY DEFAULT (desktop)
On desktop (>768px), the category sidebar should start COLLAPSED — just the ">" chevron toggle visible on the left edge. The full sidebar only opens when user clicks the chevron. On mobile, keep the drawer behavior as-is.

### 3. MARKER ICONS INSIDE CIRCLES 
Each marker in MapMe has a small white icon inside the colored circle representing its category (fork/knife for food, shirt for clothing, ring for jewelry, etc.). The icon SVGs already exist in `data/icons/`. Load them into the markers.

### 4. TOP CONTROL BUTTONS
Match MapMe's control layout:
- Top-left: "≡ Filters (716)" button (hamburger + count badge)
- Top-right: "🗺 Venue Map" button (active/highlighted) + "🛰 Satellite" button below it
- These should toggle between map styles

## DEPLOYMENT
After EACH fix, commit and deploy:
```bash
git add -A && git commit -m "vX.X: description"
cd /Users/scoutbot/.openclaw/workspace/thefairmap && vercel --prod --yes --token=$VERCEL_TOKEN
```

## REFERENCE
- MapMe target: https://viewer.mapme.com/first-monday-finder
- Our site: https://thefairmap.vercel.app
- Data: data/mapme-full-export.json (719 locations, 67 categories with colors/shapes)
- Icons: data/icons/*.svg

## RULES
- Vanilla HTML/CSS/JS only — NO frameworks
- NEVER STOP. Keep finding differences and fixing them.
- After the 4 items above, keep comparing with MapMe and fixing any visual differences you find.
- When completely finished with all 4, run: `openclaw system event --text "Done: All 4 MapMe UI fixes deployed" --mode now`
