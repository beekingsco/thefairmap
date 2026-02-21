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

// ── Users file ─────────────────────────────────────────────────────────────
const USERS_FILE = path.join(DATA_DIR, 'users.json');
function readUsers() {
  try { return JSON.parse(fs.readFileSync(USERS_FILE, 'utf8')); }
  catch { return [{ id: 'admin', username: 'admin', displayName: 'Admin', role: 'admin', password: 'fairmap2026' }]; }
}
function writeUsers(users) {
  fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2), 'utf8');
}

// ── Auto-hash plaintext passwords on startup ───────────────────────────────
(function migratePasswords() {
  const users = readUsers();
  let changed = false;
  users.forEach(u => {
    // bcrypt hashes start with $2a$ or $2b$
    if (u.password && !u.password.startsWith('$2')) {
      u.password = bcrypt.hashSync(u.password, 10);
      changed = true;
    }
  });
  if (changed) writeUsers(users);
})();

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
function requireAdmin(req, res, next) {
  if (req.session?.user?.role === 'admin') return next();
  res.status(403).json({ ok: false, error: 'Admin only' });
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
// AUTH API
// ══════════════════════════════════════════════════════════════════════════

app.post('/api/login', (req, res) => {
  const { username, password } = req.body;
  const users = readUsers();
  const user = users.find(u => u.username === username);
  if (!user) return res.status(401).json({ ok: false, error: 'Invalid credentials' });

  // Compare with bcrypt
  const valid = bcrypt.compareSync(password, user.password);
  if (!valid) return res.status(401).json({ ok: false, error: 'Invalid credentials' });

  req.session.user = { id: user.id, username: user.username, displayName: user.displayName, role: user.role };
  res.json({ ok: true, user: { username: user.username, displayName: user.displayName, role: user.role } });
});

app.post('/api/logout', (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

app.get('/api/me', (req, res) => {
  if (req.session?.user) return res.json({ ok: true, user: req.session.user });
  res.status(401).json({ ok: false });
});

// Change password (any authenticated user)
app.post('/api/change-password', requireAuth, (req, res) => {
  const { oldPassword, newPassword } = req.body;
  if (!oldPassword || !newPassword) return res.status(400).json({ ok: false, error: 'Both old and new password required' });
  if (newPassword.length < 6) return res.status(400).json({ ok: false, error: 'Password must be at least 6 characters' });

  const users = readUsers();
  const user = users.find(u => u.id === req.session.user.id);
  if (!user) return res.status(404).json({ ok: false, error: 'User not found' });

  if (!bcrypt.compareSync(oldPassword, user.password)) {
    return res.status(401).json({ ok: false, error: 'Current password is incorrect' });
  }

  user.password = bcrypt.hashSync(newPassword, 10);
  writeUsers(users);
  res.json({ ok: true });
});

// ══════════════════════════════════════════════════════════════════════════
// LOCATIONS API (read = public, write = auth)
// ══════════════════════════════════════════════════════════════════════════

app.get('/api/locations', (req, res) => {
  res.json(readLocations());
});

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

// Bulk delete locations
app.post('/api/locations/bulk-delete', requireAuth, (req, res) => {
  const { ids } = req.body;
  if (!Array.isArray(ids) || ids.length === 0) return res.status(400).json({ ok: false, error: 'No IDs provided' });
  const data = readLocations();
  const idSet = new Set(ids.map(String));
  const before = data.locations.length;
  data.locations = data.locations.filter(l => !idSet.has(String(l.id)));
  const deleted = before - data.locations.length;
  writeLocations(data);
  res.json({ ok: true, deleted });
});

// Image upload
app.post('/api/upload-image', requireAuth, upload.single('image'), (req, res) => {
  if (!req.file) return res.status(400).json({ ok: false, error: 'No file' });
  const url = `/uploads/${req.file.filename}`;
  res.json({ ok: true, url });
});

// ══════════════════════════════════════════════════════════════════════════
// CATEGORIES API
// ══════════════════════════════════════════════════════════════════════════

app.get('/api/categories', (req, res) => {
  const data = readLocations();
  res.json({ ok: true, categories: data.categories || [] });
});

app.post('/api/categories', requireAuth, (req, res) => {
  const { name, color, shape } = req.body;
  if (!name) return res.status(400).json({ ok: false, error: 'Name is required' });
  const data = readLocations();
  const id = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
  if (data.categories.some(c => c.id === id)) return res.status(400).json({ ok: false, error: 'Category already exists' });
  const cat = { id, name, color: color || '#7a7a7a', shape: shape || 'circle', count: 0 };
  data.categories.push(cat);
  writeLocations(data);
  res.json({ ok: true, category: cat });
});

app.put('/api/categories/:id', requireAuth, (req, res) => {
  const data = readLocations();
  const idx = data.categories.findIndex(c => c.id === req.params.id);
  if (idx === -1) return res.status(404).json({ ok: false, error: 'Category not found' });
  const { name, color, shape } = req.body;
  if (name !== undefined) data.categories[idx].name = name;
  if (color !== undefined) data.categories[idx].color = color;
  if (shape !== undefined) data.categories[idx].shape = shape;
  writeLocations(data);
  res.json({ ok: true, category: data.categories[idx] });
});

app.delete('/api/categories/:id', requireAuth, (req, res) => {
  const data = readLocations();
  const usedCount = data.locations.filter(l => l.categoryId === req.params.id).length;
  if (usedCount > 0) {
    return res.status(400).json({ ok: false, error: `Category is used by ${usedCount} location(s). Reassign them first.` });
  }
  const before = data.categories.length;
  data.categories = data.categories.filter(c => c.id !== req.params.id);
  if (data.categories.length === before) return res.status(404).json({ ok: false, error: 'Category not found' });
  writeLocations(data);
  res.json({ ok: true });
});

// ══════════════════════════════════════════════════════════════════════════
// USER MANAGEMENT (admin-only)
// ══════════════════════════════════════════════════════════════════════════

app.get('/api/users', requireAuth, requireAdmin, (req, res) => {
  const users = readUsers().map(u => ({ id: u.id, username: u.username, displayName: u.displayName, role: u.role }));
  res.json({ ok: true, users });
});

app.post('/api/users', requireAuth, requireAdmin, (req, res) => {
  const { username, password, displayName, role } = req.body;
  if (!username || !password) return res.status(400).json({ ok: false, error: 'Username and password required' });
  if (password.length < 6) return res.status(400).json({ ok: false, error: 'Password must be at least 6 characters' });
  const users = readUsers();
  if (users.some(u => u.username === username)) return res.status(400).json({ ok: false, error: 'Username already exists' });
  const newUser = {
    id: `user-${Date.now()}`,
    username,
    password: bcrypt.hashSync(password, 10),
    displayName: displayName || username,
    role: role || 'editor'
  };
  users.push(newUser);
  writeUsers(users);
  res.json({ ok: true, user: { id: newUser.id, username: newUser.username, displayName: newUser.displayName, role: newUser.role } });
});

app.delete('/api/users/:id', requireAuth, requireAdmin, (req, res) => {
  if (req.params.id === 'admin') return res.status(400).json({ ok: false, error: 'Cannot delete the primary admin' });
  let users = readUsers();
  const before = users.length;
  users = users.filter(u => u.id !== req.params.id);
  if (users.length === before) return res.status(404).json({ ok: false, error: 'User not found' });
  writeUsers(users);
  res.json({ ok: true });
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
// HTML pages
// ══════════════════════════════════════════════════════════════════════════
app.get('/admin', requireAuth, (req, res) => res.sendFile(path.join(ROOT, 'admin.html')));
app.get('/admin.html', requireAuth, (req, res) => res.sendFile(path.join(ROOT, 'admin.html')));

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

app.use((req, res) => res.status(404).send('Not found'));

app.use((err, req, res, next) => {
  console.error('[Error]', err.message);
  if (res.headersSent) return next(err);
  res.status(err.status || 500).json({ ok: false, error: err.message });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`🗺️  TheFairMap running at http://localhost:${PORT}`);
  console.log(`   Admin: http://localhost:${PORT}/admin`);
});
