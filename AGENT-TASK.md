# TheFairMap — Round 4 Polish

## STATUS: Major progress. Keep going.

Live: https://thefairmap.vercel.app  
Target: https://viewer.mapme.com/first-monday-finder

## BUGS TO FIX FIRST

### 1. Filters count shows (0) — should show (716)
The "Filters (0)" button on the left edge shows 0 instead of the total location count. Fix the initialization so it shows the correct total on page load.

### 2. Venue Map / Satellite toggle buttons missing from top-right
MapMe has two stacked buttons in the top-right corner:
- "🗺 Venue Map" (highlighted/active by default)  
- "🛰 Satellite" (below it)
These toggle between the MapTiler streets style and a satellite imagery style. They should be styled as pill buttons with icons. Make sure they are VISIBLE — previous commits may have added them but they might be hidden or positioned off-screen.

## UX POLISH AFTER BUGS

### 3. MapMe has a ">" chevron on the left edge (not "Filters (0)")
On desktop, MapMe shows just a thin ">" chevron toggle to open the sidebar — NOT a "Filters" button. The Filters button with count is INSIDE the sidebar once it's open. Match this behavior.

### 4. Marker size and spacing
MapMe markers at this zoom level are slightly larger and more spaced out. Our markers look a bit cluttered in dense areas. Consider adjusting circle-radius stops.

### 5. Detail panel when clicking a marker
When you click a marker in MapMe, a detail panel slides in from the right showing: vendor name, category badge, description, photos. Make sure our detail panel matches this behavior and styling.

### 6. Mobile responsiveness
Test on 375px width viewport. MapMe's mobile shows: full-screen map, bottom drawer for categories, tap marker → bottom sheet with details. Match this.

## DEPLOYMENT
After EACH fix, commit and deploy:
```bash
git add -A && git commit -m "vX.X: description"
cd /Users/scoutbot/.openclaw/workspace/thefairmap && vercel --prod --yes --token=$VERCEL_TOKEN
```

## RULES
- Vanilla HTML/CSS/JS only — NO frameworks
- NEVER STOP. Keep finding and fixing differences.
- When done with all items above, run: `openclaw system event --text "Done: Round 4 polish complete" --mode now`
