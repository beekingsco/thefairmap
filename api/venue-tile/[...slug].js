// Vercel Edge Function — proxies MapMe's custom venue tileset
// Adds the Referer header required by MapTiler's key restriction
export const config = { runtime: 'edge' };

const TILESET_ID = '0196a1e2-92d2-7ed9-9540-2191fb00a1af';
const MAPTILER_KEY = 'fQ4ZMToXe3rVrmKMAN7K';
const MAPME_REFERER = 'https://viewer.mapme.com/';

export default async function handler(req) {
  const url = new URL(req.url);
  // pathname will be /api/venue-tile/18/61267/105971 or /api/venue-tile/18/61267/105971.png
  const path = url.pathname.replace(/^\/api\/venue-tile\//, '');
  const parts = path.split('/');

  if (parts.length < 3) {
    return new Response('expected /api/venue-tile/{z}/{x}/{y}', { status: 400 });
  }

  const z = parts[0];
  const x = parts[1];
  const y = parts[2].replace(/\.png$/, '');

  // Validate numeric
  if (!/^\d+$/.test(z) || !/^\d+$/.test(x) || !/^\d+$/.test(y)) {
    return new Response('invalid tile coordinates', { status: 400 });
  }

  const upstream = `https://api.maptiler.com/tiles/${TILESET_ID}/${z}/${x}/${y}.png?key=${MAPTILER_KEY}`;

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

    const body = await res.arrayBuffer();
    return new Response(body, {
      status: 200,
      headers: {
        'Content-Type': 'image/png',
        'Cache-Control': 'public, max-age=86400, stale-while-revalidate=604800',
        'Access-Control-Allow-Origin': '*'
      }
    });
  } catch (err) {
    return new Response('fetch failed: ' + err.message, { status: 502 });
  }
}
