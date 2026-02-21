# TheFairMap Build Task — UPDATED 2026-02-21 4:15 PM

## STATUS: Map is live and working. Now fix these 4 things.

Live: https://thefairmap.vercel.app
Target: https://viewer.mapme.com/first-monday-finder
Data: data/mapme-full-export.json (719 locations, 67 categories)

---

## PRIORITY 1: Drag-to-dismiss bottom sheet (MOST IMPORTANT)

The mobile/detail slide-up panel must feel EXACTLY like MapMe:
- User can grab the handle bar and DRAG it up (to expand) or drag DOWN to dismiss
- It should follow the user's finger/mouse in real time — not just animate on tap
- Snaps closed when dragged past ~40% of its height
- Snaps open when dragged up past ~30% of viewport
- Use pointer events (pointerdown/pointermove/pointerup) — NOT touch only
- Add a visible drag handle bar at the top (4px wide, 36px tall rounded pill, gray, centered)
- This applies to BOTH the detail panel (#detail-panel) AND the mobile sidebar sheet

Reference MapMe behavior: the bottom sheet feels like a native iOS sheet — smooth, responsive, real drag tracking.

---

## PRIORITY 2: First Monday Finder logo in sidebar

Below the search bar and above the category list, add a centered logo image.
- Source: data/icons/fairmap-icon-192.png (or check if there's a better logo file in data/)
- Display as centered image, max-width 160px, with padding
- This matches MapMe which shows the map logo/branding in the sidebar header area

---

## PRIORITY 3: Marker icon contrast (white OR black)

Currently all icons inside markers are white. MapMe auto-picks white or black based on the marker's background color for maximum contrast.
- For LIGHT colored markers (yellow, orange, light green, etc.) → use BLACK icons
- For DARK colored markers (dark blue, dark green, dark red, purple, etc.) → use WHITE icons
- Use luminance calculation: if (0.299*R + 0.587*G + 0.114*B) > 128 → use black icon; else white
- Apply this to the MapLibre icon color paint property OR render icons accordingly

---

## PRIORITY 4: Keep comparing and fixing

After all 3 above, keep loading https://viewer.mapme.com/first-monday-finder and fixing every visual difference you find. Never stop.

---

## DEPLOYMENT
After EACH fix:
```bash
git add -A && git commit -m "vX.X: description"
vercel --prod --yes --token=$VERCEL_TOKEN
```

## RULES
- Vanilla HTML/CSS/JS only — NO frameworks
- Never stop working
- Use Playwright (installed) for headless testing to verify fixes work before committing
