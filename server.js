'use strict';
require('dotenv').config();

const express = require('express');
const session = require('express-session');
const multer  = require('multer');
const bcrypt  = require('bcryptjs');
const path    = require('path');
const fs      = require('fs');

const app  = express();
const PORT = process.env.PORT || 4000;
const ROOT = __dirname;

// ── Directories ────────────────────────────────────────────────────────────
const UPLOADS_DIR = path.join(ROOT, 'uploads');
const DATA_DIR    = path.join(ROOT, 'data');
const LOCATIONS_FILE = path.join(DATA_DIR, 'locations.json');
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });

// ── Admin credentials (plain-text comparison for simplicity) ───────────────
const ADMIN_USER = process.env.ADMIN_USER || 'admin';
const ADMIN_PASS = process.env.ADMIN_PASS || 'fairmap2026';

// ── Middleware ─────────────────────────────────────────────────────────────
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
app.use(session({
  secret: process.env.SESSION_SECRET || 'fairmap-secret-2026',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 7 * 24 * 60 * 60 * 1000 } // 7 days
}));

// ── Image upload (multer) ──────────────────────────────────────────────────
const storage = multer.diskStorage({
  destination: UPLOADS_DIR,
  filename: (req, file, cb) => {
    const ext  = path.extname(file.originalname).toLowerCase();
    const safe = path.basename(file.originalname, ext).replace(/[^a-z0-9_-]/gi, '_').slice(0, 40);
    cb(null, `${Date.now()}-${safe}${ext}`);
  }
});
const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB
  fileFilter: (req, file, cb) => {
    if (/^image\/(jpeg|png|gif|webp|svg\+xml)$/.test(file.mimetype)) cb(null, true);
    else cb(new Error('Only image files are allowed'));
  }
});

// ── Auth helpers ───────────────────────────────────────────────────────────
function requireAuth(req, res, next) {
  if (req.session?.user) return next();
  if (req.xhr || req.headers.accept?.includes('application/json')) {
    return res.status(401).json({ ok: false, error: 'Not authenticated' });
  }
  res.redirect('/login');
}

// ── Locations helpers ──────────────────────────────────────────────────────
function readLocations() {
  try { return JSON.parse(fs.readFileSync(LOCATIONS_FILE, 'utf8')); }
  catch { return { map: {}, categories: [], locations: [] }; }
}
function writeLocations(data) {
  fs.writeFileSync(LOCATIONS_FILE, JSON.stringify(data, null, 2), 'utf8');
}

// ══════════════════════════════════════════════════════════════════════════
// API Routes
// ══════════════════════════════════════════════════════════════════════════

// Auth
app.post('/api/login', (req, res) => {
  const { username, password } = req.body;
  if (username === ADMIN_USER && password === ADMIN_PASS) {
    req.session.user = { username };
    return res.json({ ok: true });
  }
  res.status(401).json({ ok: false, error: 'Invalid credentials' });
});

app.post('/api/logout', (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

app.get('/api/me', (req, res) => {
  if (req.session?.user) return res.json({ ok: true, user: req.session.user });
  res.status(401).json({ ok: false });
});

// Locations (read — public for the map viewer)
app.get('/api/locations', (req, res) => {
  res.json(readLocations());
});

// Locations CRUD (write — admin only)
app.post('/api/locations', requireAuth, (req, res) => {
  const data = readLocations();
  const loc  = { ...req.body, id: req.body.id || `loc-${Date.now()}` };
  data.locations.push(loc);
  writeLocations(data);
  res.json({ ok: true, location: loc });
});

app.put('/api/locations/:id', requireAuth, (req, res) => {
  const data = readLocations();
  const idx  = data.locations.findIndex(l => String(l.id) === req.params.id);
  if (idx === -1) return res.status(404).json({ ok: false, error: 'Not found' });
  data.locations[idx] = { ...data.locations[idx], ...req.body, id: req.params.id };
  writeLocations(data);
  res.json({ ok: true, location: data.locations[idx] });
});

app.delete('/api/locations/:id', requireAuth, (req, res) => {
  const data = readLocations();
  const before = data.locations.length;
  data.locations = data.locations.filter(l => String(l.id) !== req.params.id);
  if (data.locations.length === before) return res.status(404).json({ ok: false, error: 'Not found' });
  writeLocations(data);
  res.json({ ok: true });
});

// Image upload
app.post('/api/upload-image', requireAuth, upload.single('image'), (req, res) => {
  if (!req.file) return res.status(400).json({ ok: false, error: 'No file' });
  const url = `/uploads/${req.file.filename}`;
  res.json({ ok: true, url });
});

// Bulk import (replace locations array, keep categories + map config)
app.post('/api/import-locations', requireAuth, (req, res) => {
  const { locations, categories, merge } = req.body;
  const data = readLocations();
  if (categories?.length) data.categories = categories;
  if (merge) {
    const existingIds = new Set(data.locations.map(l => String(l.id)));
    (locations || []).forEach(l => {
      if (existingIds.has(String(l.id))) {
        const idx = data.locations.findIndex(x => String(x.id) === String(l.id));
        data.locations[idx] = l;
      } else {
        data.locations.push(l);
      }
    });
  } else {
    if (locations?.length) data.locations = locations;
  }
  writeLocations(data);
  res.json({ ok: true, count: data.locations.length });
});

// ══════════════════════════════════════════════════════════════════════════
// Admin auth guard for HTML pages
// ══════════════════════════════════════════════════════════════════════════
app.get('/admin', requireAuth, (req, res) => res.sendFile(path.join(ROOT, 'admin.html')));
app.get('/admin.html', requireAuth, (req, res) => res.sendFile(path.join(ROOT, 'admin.html')));

// Login page
app.get('/login', (req, res) => {
  if (req.session?.user) return res.redirect('/admin');
  res.sendFile(path.join(ROOT, 'login.html'));
});

// ══════════════════════════════════════════════════════════════════════════
// Static files
// ══════════════════════════════════════════════════════════════════════════
app.use('/uploads', express.static(UPLOADS_DIR));
app.use(express.static(ROOT, {
  index: 'index.html',
  extensions: ['html']
}));

// Catch-all 404
app.use((req, res) => res.status(404).send('Not found'));

// Global error handler
app.use((err, req, res, next) => {
  console.error('[Error]', err.message);
  if (res.headersSent) return next(err);
  res.status(err.status || 500).json({ ok: false, error: err.message });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`🗺️  TheFairMap running at http://localhost:${PORT}`);
  console.log(`   Admin: http://localhost:${PORT}/admin  (user: ${ADMIN_USER})`);
});
