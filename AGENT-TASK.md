# TheFairMap — Session 2 Task (Feb 21 Evening)

Live: https://thefairmap.vercel.app
Target: https://viewer.mapme.com/first-monday-finder
Repo: /Users/scoutbot/.openclaw/workspace/thefairmap

---

## PRIORITY 1: TILE PROXY — Add the real venue tiles (MOST IMPORTANT)

MapMe uses a custom MapTiler raster tileset that shows the colored venue layout (colored pavilion rows, booth numbers, "Arbor 1", "Boardwalk" labels). We need to add this as an overlay.

### Step 1: Create Vercel tile proxy function

Create `api/venue-tile/[...slug].js`:

```js
export const config = { runtime: 'edge' };

export default async function handler(req) {
  const url = new URL(req.url);
  // slug is like ["18","61267","105971"]
  const parts = url.pathname.replace('/api/venue-tile/', '').split('/');
  if (parts.length < 3) return new Response('bad path', { status: 400 });
  const [z, x, yPng] = parts;
  const y = yPng.replace('.png', '');
  
  const upstream = `https://api.maptiler.com/tiles/0196a1e2-92d2-7ed9-9540-2191fb00a1af/${z}/${x}/${y}.png?key=fQ4ZMToXe3rVrmKMAN7K`;
  
  const res = await fetch(upstream, {
    headers: {
      Referer: 'https://viewer.mapme.com/',
      Origin: 'https://viewer.mapme.com'
    }
  });
  
  if (!res.ok) return new Response('tile not found', { status: res.status });
  
  const body = await res.arrayBuffer();
  return new Response(body, {
    status: 200,
    headers: {
      'Content-Type': 'image/png',
      'Cache-Control': 'public, max-age=86400',
      'Access-Control-Allow-Origin': '*'
    }
  });
}
```

### Step 2: Add route in vercel.json

In `vercel.json`, add to the `rewrites` array:
```json
{ "source": "/api/venue-tile/:path*", "destination": "/api/venue-tile/:path*" }
```

Actually, no rewrite needed — Vercel auto-routes `api/` functions.

### Step 3: Add the overlay layer in map.js

In map.js, find the function `resolveVenueStyleUrl` (or wherever the map style is set). After the map's `style.load` event fires, add the venue raster overlay source and layer.

Find the `style.load` event listener (or create one). After the base style loads, inject:

```js
// Add venue overlay tiles
if (!map.getSource('venue-overlay')) {
  map.addSource('venue-overlay', {
    type: 'raster',
    tiles: [`${window.location.origin}/api/venue-tile/{z}/{x}/{y}.png`],
    tileSize: 256,
    minzoom: 13,
    maxzoom: 22,
    bounds: [-95.87783605142862, 32.55078690554766, -95.85260241651899, 32.57611879608321],
    attribution: 'Map © MapTiler'
  });
}
if (!map.getLayer('venue-overlay-layer')) {
  // Insert BELOW the marker layers so markers stay on top
  const firstMarkerLayer = map.getStyle().layers.find(l => l.id === 'location-markers' || l.id === 'location-icons' || l.id === 'location-clusters');
  map.addLayer({
    id: 'venue-overlay-layer',
    type: 'raster',
    source: 'venue-overlay',
    paint: {
      'raster-opacity': 1.0
    }
  }, firstMarkerLayer?.id);
}
```

This must also survive style changes (satellite toggle). When switching back to venue style, re-add the layer. Look for the existing style switch logic and add the overlay there too.

---

## PRIORITY 2: DOUBLE LOGO — Hide map-brand-overlay on mobile

In `style.css`, inside the `@media (max-width: 960px)` block, find `.map-brand-overlay` and add `display: none !important;`.

The mobile topbar (`#mobile-topbar`) already shows the brand. The overlay creates a duplicate. On mobile, only the topbar brand should show.

---

## PRIORITY 3: Keep comparing and fixing

After tiles + logo fix, compare https://viewer.mapme.com/first-monday-finder vs https://thefairmap.vercel.app and fix every difference you find. Use Playwright for screenshots.

---

## DEPLOYMENT

After EACH fix:
```bash
cd /Users/scoutbot/.openclaw/workspace/thefairmap
git add -A && git commit -m "fix: description"
vercel --prod --yes --token=$VERCEL_TOKEN
```

---

## RULES
- Vanilla HTML/CSS/JS only — NO frameworks
- Check that the tile proxy actually works before committing (fetch one tile to verify)
- NEVER stop working — keep finding and fixing differences
- Use Playwright for visual verification

When completely finished, run:
openclaw system event --text "TheFairMap tile proxy + double logo fix deployed" --mode now
