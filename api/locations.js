// Shopper GET /api/locations must return the public MapMe-format export.
// require() so Vercel file tracing packs the JSON; do not read Railway SQLite.
const base = require('../data/mapme-full-export.json');
const published = require('../data/published-listings.json');

const RAILWAY = 'https://thefairmap-production.up.railway.app';

function mergePublished(data, extras) {
  const locations = Array.isArray(data.locations) ? data.locations.slice() : [];
  const byId = new Map(locations.map((loc) => [String(loc.id), loc]));
  for (const loc of extras || []) {
    if (!loc || loc.id == null) continue;
    const id = String(loc.id);
    const prev = byId.get(id);
    const next = prev ? { ...prev, ...loc, id } : { ...loc, id };
    if (prev) locations[locations.findIndex((item) => String(item.id) === id)] = next;
    else locations.push(next);
    byId.set(id, next);
  }
  const categories = (data.categories || []).map((cat) => ({
    ...cat,
    count: locations.filter((item) => item.categoryId === cat.id).length
  }));
  return { ...data, locations, categories };
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');

  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Methods', 'GET,HEAD,POST,PUT,DELETE,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    return res.status(204).end();
  }

  if (req.method === 'GET' || req.method === 'HEAD') {
    const extras = Array.isArray(published) ? published : published.locations;
    const data = mergePublished(base, extras);
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Cache-Control', 'public, max-age=60, stale-while-revalidate=300');
    if (req.method === 'HEAD') return res.status(200).end();
    return res.status(200).json(data);
  }

  try {
    const dest = new URL(req.url, RAILWAY);
    const headers = { 'content-type': 'application/json' };
    if (req.headers.cookie) headers.cookie = req.headers.cookie;
    if (req.headers.authorization) headers.authorization = req.headers.authorization;
    const body = req.body == null ? undefined : (typeof req.body === 'string' ? req.body : JSON.stringify(req.body));
    const upstream = await fetch(dest, { method: req.method, headers, body });
    const text = await upstream.text();
    res.status(upstream.status);
    res.setHeader('Content-Type', upstream.headers.get('content-type') || 'application/json');
    return res.send(text);
  } catch (err) {
    return res.status(502).json({ ok: false, error: 'Upstream locations write failed', detail: err.message });
  }
};
