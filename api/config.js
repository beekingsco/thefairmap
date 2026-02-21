// Vercel serverless function — serves config.js with env vars injected
export default function handler(req, res) {
  const key = process.env.MAPTILER_KEY || '';
  res.setHeader('Content-Type', 'application/javascript');
  res.setHeader('Cache-Control', 'public, max-age=3600');
  res.send(`window.MAPTILER_KEY = '${key}';`);
}
