// Vercel Edge Function — proxies MapMe's custom venue tileset
// URL: /api/tile?z=18&x=61267&y=105971
export const config = { runtime: 'edge' };

const TILESET_ID = '0196a1e2-92d2-7ed9-9540-2191fb00a1af';
const MAPTILER_KEY = 'fQ4ZMToXe3rVrmKMAN7K';

export default async function handler(req) {
  const url = new URL(req.url);
  const z = url.searchParams.get('z');
  const x = url.searchParams.get('x');
  const y = url.searchParams.get('y');

  if (!z || !x || !y) {
    return new Response('expected ?z=&x=&y=', { status: 400 });
  }
  if (!/^\d+$/.test(z) || !/^\d+$/.test(x) || !/^\d+$/.test(y)) {
    return new Response('invalid tile coordinates', { status: 400 });
  }

  const upstream = `https://api.maptiler.com/tiles/${TILESET_ID}/${z}/${x}/${y}.png?key=${MAPTILER_KEY}`;

  try {
    const res = await fetch(upstream, {
      headers: {
        Referer: 'https://viewer.mapme.com/',
        Origin: 'https://viewer.mapme.com'
      }
    });

    if (!res.ok) {
      return new Response(`upstream: ${res.status}`, { status: res.status });
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
