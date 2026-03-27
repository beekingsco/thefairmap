// Vercel Edge Function — proxies MapMe's venue tileset style.json
// Returns tile metadata (bounds, zoom levels, tile URL template) so the
// client can configure the overlay source dynamically.
export const config = { runtime: 'edge' };

const TILESET_ID = '0196a1e2-92d2-7ed9-9540-2191fb00a1af';
const MAPME_REFERER = 'https://viewer.mapme.com/';

export default async function handler(req) {
  const key = process.env.MAPTILER_KEY;
  if (!key) {
    return new Response('MAPTILER_KEY not configured', { status: 500 });
  }

  const upstream = `https://api.maptiler.com/tiles/${TILESET_ID}/tiles.json?key=${key}`;

  try {
    const res = await fetch(upstream, {
      headers: {
        Referer: MAPME_REFERER,
        Origin: 'https://viewer.mapme.com',
        'User-Agent': 'Mozilla/5.0 (compatible; TheFairMap/1.0)'
      }
    });

    if (!res.ok) {
      return new Response(`upstream error: ${res.status}`, { status: res.status });
    }

    const data = await res.json();
    return new Response(JSON.stringify(data), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'public, max-age=86400, stale-while-revalidate=604800',
        'Access-Control-Allow-Origin': '*'
      }
    });
  } catch (err) {
    return new Response('fetch failed: ' + err.message, { status: 502 });
  }
}
