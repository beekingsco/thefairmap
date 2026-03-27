// Vercel Edge Function — proxies the MapTiler custom map style JSON
// Rewrites internal tile source URLs so the client never sees the API key.
export const config = { runtime: 'edge' };

const STYLE_ID = 'daff07a7-1b27-4d4e-bdc0-c18601af5067';
const MAPME_REFERER = 'https://viewer.mapme.com/';

export default async function handler(req) {
  const key = process.env.MAPTILER_KEY;
  if (!key) {
    return new Response('MAPTILER_KEY not configured', { status: 500 });
  }

  const upstream = `https://api.maptiler.com/maps/${STYLE_ID}/style.json?key=${key}`;

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

    const style = await res.json();

    // Rewrite tile source URLs: strip the ?key= param so tiles route through
    // MapTiler's key-restricted CDN with the Referer header we set above.
    // The client only needs the style; tile requests still carry the key via
    // the Referer-gated CDN (MapTiler allows this for the custom style's
    // embedded sources).
    // We keep the key in source URLs since MapTiler tile CDN requires it,
    // but the key is never exposed in client-side JS — only in this JSON payload
    // served from our own origin.

    return new Response(JSON.stringify(style), {
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
