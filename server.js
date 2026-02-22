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

// ── Stripe (optional — graceful if not configured) ─────────────────────────
let stripe = null;
const STRIPE_CONFIGURED = !!process.env.STRIPE_SECRET_KEY;
if (STRIPE_CONFIGURED) {
  try {
    stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
    console.log('💳 Stripe configured');
  } catch (e) {
    console.warn('⚠️  Stripe module not found — run npm install');
  }
}
const STRIPE_PRICES = {
  basic_monthly:    process.env.STRIPE_PRICE_BASIC_MONTHLY    || 'price_basic_monthly_placeholder',
  basic_annual:     process.env.STRIPE_PRICE_BASIC_ANNUAL     || 'price_basic_annual_placeholder',
  standout_monthly: process.env.STRIPE_PRICE_STANDOUT_MONTHLY || 'price_standout_monthly_placeholder',
  standout_annual:  process.env.STRIPE_PRICE_STANDOUT_ANNUAL  || 'price_standout_annual_placeholder',
  showoff_monthly:  process.env.STRIPE_PRICE_SHOWOFF_MONTHLY  || 'price_showoff_monthly_placeholder',
  showoff_annual:   process.env.STRIPE_PRICE_SHOWOFF_ANNUAL   || 'price_showoff_annual_placeholder',
};
const BASE_URL = process.env.BASE_URL || `http://localhost:${PORT}`;

// ── Directories ────────────────────────────────────────────────────────────
const UPLOADS_DIR = path.join(ROOT, 'uploads');
const DATA_DIR    = path.join(ROOT, 'data');
const LOCATIONS_FILE = path.join(DATA_DIR, 'locations.json');
const CLAIMS_FILE = path.join(DATA_DIR, 'claims.json');
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

// ── Claims helpers ─────────────────────────────────────────────────────────
function readClaims() {
  try { return JSON.parse(fs.readFileSync(CLAIMS_FILE, 'utf8')); }
  catch { return []; }
}
function writeClaims(claims) {
  fs.writeFileSync(CLAIMS_FILE, JSON.stringify(claims, null, 2), 'utf8');
}

// ── Auto-hash plaintext passwords on startup ───────────────────────────────
(function migratePasswords() {
  const users = readUsers();
  let changed = false;
  users.forEach(u => {
    if (u.password && !u.password.startsWith('$2')) {
      u.password = bcrypt.hashSync(u.password, 10);
      changed = true;
    }
  });
  if (changed) writeUsers(users);
})();

// ── Stripe webhook needs raw body BEFORE json parser ───────────────────────
app.post('/api/stripe/webhook', express.raw({ type: 'application/json' }), (req, res) => {
  if (!stripe) return res.status(503).json({ ok: false, error: 'Stripe not configured' });
  const sig = req.headers['stripe-signature'];
  let event;
  try {
    event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error('Stripe webhook signature failed:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  const users = readUsers();
  switch (event.type) {
    case 'checkout.session.completed': {
      const sess = event.data.object;
      const userId = sess.metadata?.userId;
      const tier = sess.metadata?.tier;
      const billingPeriod = sess.metadata?.billingPeriod;
      const user = users.find(u => u.id === userId);
      if (user) {
        user.stripeCustomerId = sess.customer;
        user.subscription = {
          tier,
          billingPeriod,
          stripeSubscriptionId: sess.subscription,
          status: 'active',
          currentPeriodEnd: null
        };
        writeUsers(users);
        console.log(`✅ Subscription activated: ${user.username} → ${tier}`);
      }
      break;
    }
    case 'customer.subscription.updated': {
      const sub = event.data.object;
      const user = users.find(u => u.stripeCustomerId === sub.customer);
      if (user && user.subscription) {
        user.subscription.status = sub.status;
        user.subscription.currentPeriodEnd = sub.current_period_end ? new Date(sub.current_period_end * 1000).toISOString() : null;
        writeUsers(users);
      }
      break;
    }
    case 'customer.subscription.deleted': {
      const sub = event.data.object;
      const user = users.find(u => u.stripeCustomerId === sub.customer);
      if (user && user.subscription) {
        user.subscription.status = 'canceled';
        writeUsers(users);
        console.log(`❌ Subscription canceled: ${user.username}`);
      }
      break;
    }
    case 'invoice.payment_failed': {
      const inv = event.data.object;
      const user = users.find(u => u.stripeCustomerId === inv.customer);
      if (user && user.subscription) {
        user.subscription.status = 'past_due';
        writeUsers(users);
      }
      break;
    }
  }
  res.json({ received: true });
});

// ── Middleware ─────────────────────────────────────────────────────────────
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
app.use(session({
  secret: process.env.SESSION_SECRET || 'fairmap-secret-2026',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 7 * 24 * 60 * 60 * 1000 }
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
  limits: { fileSize: 10 * 1024 * 1024 },
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
function requireBoothOwner(req, res, next) {
  const role = req.session?.user?.role;
  if (role === 'booth_owner' || role === 'admin') return next();
  res.status(403).json({ ok: false, error: 'Booth owner access required' });
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
  const valid = bcrypt.compareSync(password, user.password);
  if (!valid) return res.status(401).json({ ok: false, error: 'Invalid credentials' });
  req.session.user = { id: user.id, username: user.username, displayName: user.displayName, role: user.role };
  // Redirect booth owners to portal, admins to admin
  const redirect = user.role === 'booth_owner' ? '/portal' : '/admin';
  res.json({ ok: true, user: { username: user.username, displayName: user.displayName, role: user.role }, redirect });
});

app.post('/api/logout', (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

app.get('/api/me', (req, res) => {
  if (!req.session?.user) return res.status(401).json({ ok: false });
  const users = readUsers();
  const full = users.find(u => u.id === req.session.user.id);
  const userData = {
    id: req.session.user.id,
    username: req.session.user.username,
    displayName: req.session.user.displayName,
    role: req.session.user.role,
    email: full?.email || '',
    subscription: full?.subscription || null,
    claimedLocationIds: full?.claimedLocationIds || []
  };
  res.json({ ok: true, user: userData });
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
// REGISTRATION (public)
// ══════════════════════════════════════════════════════════════════════════

app.post('/api/register', (req, res) => {
  const { username, password, email, displayName } = req.body;
  if (!username || !password || !email) return res.status(400).json({ ok: false, error: 'Username, email, and password required' });
  if (password.length < 6) return res.status(400).json({ ok: false, error: 'Password must be at least 6 characters' });
  if (!/^[^@]+@[^@]+\.[^@]+$/.test(email)) return res.status(400).json({ ok: false, error: 'Invalid email address' });

  const users = readUsers();
  if (users.some(u => u.username === username)) return res.status(400).json({ ok: false, error: 'Username already taken' });
  if (users.some(u => u.email === email)) return res.status(400).json({ ok: false, error: 'Email already registered' });

  const newUser = {
    id: `user-${Date.now()}`,
    username,
    password: bcrypt.hashSync(password, 10),
    email,
    displayName: displayName || username,
    role: 'booth_owner',
    stripeCustomerId: null,
    subscription: null,
    claimedLocationIds: []
  };
  users.push(newUser);
  writeUsers(users);

  req.session.user = { id: newUser.id, username: newUser.username, displayName: newUser.displayName, role: newUser.role };
  res.json({ ok: true, user: { id: newUser.id, username: newUser.username, displayName: newUser.displayName, role: newUser.role } });
});

// ══════════════════════════════════════════════════════════════════════════
// STRIPE API (checkout + portal)
// ══════════════════════════════════════════════════════════════════════════

app.post('/api/stripe/create-checkout', requireAuth, (req, res) => {
  if (!stripe) return res.status(503).json({ ok: false, error: 'Stripe is not configured. Contact the map admin to enable payments.' });
  const { tier, billingPeriod } = req.body;
  const priceKey = `${tier}_${billingPeriod}`;
  const priceId = STRIPE_PRICES[priceKey];
  if (!priceId || priceId.includes('placeholder')) {
    return res.status(400).json({ ok: false, error: 'Stripe pricing not configured yet. Contact the map admin.' });
  }

  stripe.checkout.sessions.create({
    mode: 'subscription',
    line_items: [{ price: priceId, quantity: 1 }],
    success_url: `${BASE_URL}/portal?checkout=success`,
    cancel_url: `${BASE_URL}/portal?checkout=cancel`,
    metadata: {
      userId: req.session.user.id,
      tier,
      billingPeriod
    }
  }).then(session => {
    res.json({ ok: true, url: session.url });
  }).catch(err => {
    console.error('Stripe checkout error:', err.message);
    res.status(500).json({ ok: false, error: 'Failed to create checkout session' });
  });
});

app.get('/api/stripe/portal', requireAuth, (req, res) => {
  if (!stripe) return res.status(503).json({ ok: false, error: 'Stripe not configured' });
  const users = readUsers();
  const user = users.find(u => u.id === req.session.user.id);
  if (!user?.stripeCustomerId) return res.status(400).json({ ok: false, error: 'No billing account found' });

  stripe.billingPortal.sessions.create({
    customer: user.stripeCustomerId,
    return_url: `${BASE_URL}/portal`
  }).then(session => {
    res.json({ ok: true, url: session.url });
  }).catch(err => {
    console.error('Stripe portal error:', err.message);
    res.status(500).json({ ok: false, error: 'Failed to create billing portal session' });
  });
});

// ══════════════════════════════════════════════════════════════════════════
// BOOTH OWNER PORTAL API
// ══════════════════════════════════════════════════════════════════════════

// Get my listings
app.get('/api/portal/listings', requireAuth, requireBoothOwner, (req, res) => {
  const data = readLocations();
  const users = readUsers();
  const user = users.find(u => u.id === req.session.user.id);
  const claimedIds = new Set((user?.claimedLocationIds || []).map(String));
  const myListings = data.locations.filter(l => claimedIds.has(String(l.id)));
  res.json({ ok: true, listings: myListings });
});

// Get a single listing I own
app.get('/api/portal/listings/:id', requireAuth, requireBoothOwner, (req, res) => {
  const data = readLocations();
  const users = readUsers();
  const user = users.find(u => u.id === req.session.user.id);
  const claimedIds = new Set((user?.claimedLocationIds || []).map(String));
  const loc = data.locations.find(l => String(l.id) === req.params.id);
  if (!loc) return res.status(404).json({ ok: false, error: 'Location not found' });
  // Admin can view any, booth owners only their own
  if (req.session.user.role !== 'admin' && !claimedIds.has(String(loc.id))) {
    return res.status(403).json({ ok: false, error: 'You do not own this listing' });
  }
  res.json({ ok: true, listing: loc });
});

// Submit claim for existing location
app.post('/api/portal/claim', requireAuth, requireBoothOwner, (req, res) => {
  const { locationId, businessVerification, tier, billingPeriod } = req.body;
  if (!locationId) return res.status(400).json({ ok: false, error: 'Location ID required' });
  if (!businessVerification) return res.status(400).json({ ok: false, error: 'Please provide verification details' });
  if (!tier) return res.status(400).json({ ok: false, error: 'Please select a listing tier' });

  const data = readLocations();
  const loc = data.locations.find(l => String(l.id) === String(locationId));
  if (!loc) return res.status(404).json({ ok: false, error: 'Location not found' });
  if (loc.ownerId) return res.status(400).json({ ok: false, error: 'This location has already been claimed' });

  const claims = readClaims();
  const existing = claims.find(c => String(c.locationId) === String(locationId) && c.status === 'pending');
  if (existing) return res.status(400).json({ ok: false, error: 'There is already a pending claim for this location' });

  const claim = {
    id: `claim-${Date.now()}`,
    locationId: String(locationId),
    userId: req.session.user.id,
    status: 'pending',
    type: 'claim',
    newLocationData: null,
    businessVerification,
    tier,
    billingPeriod: billingPeriod || 'monthly',
    submittedAt: new Date().toISOString(),
    reviewedAt: null,
    reviewedBy: null,
    reviewNote: ''
  };
  claims.push(claim);
  writeClaims(claims);
  res.json({ ok: true, claim });
});

// Submit new location request
app.post('/api/portal/create-listing', requireAuth, requireBoothOwner, (req, res) => {
  const { name, description, address, categoryId, lat, lng, businessVerification, tier, billingPeriod } = req.body;
  if (!name) return res.status(400).json({ ok: false, error: 'Business name required' });
  if (!businessVerification) return res.status(400).json({ ok: false, error: 'Please provide verification details' });
  if (!tier) return res.status(400).json({ ok: false, error: 'Please select a listing tier' });

  const claims = readClaims();
  const claim = {
    id: `claim-${Date.now()}`,
    locationId: null,
    userId: req.session.user.id,
    status: 'pending',
    type: 'create',
    newLocationData: { name, description, address, categoryId, lat: lat || 0, lng: lng || 0 },
    businessVerification,
    tier,
    billingPeriod: billingPeriod || 'monthly',
    submittedAt: new Date().toISOString(),
    reviewedAt: null,
    reviewedBy: null,
    reviewNote: ''
  };
  claims.push(claim);
  writeClaims(claims);
  res.json({ ok: true, claim });
});

// Submit changes to own listing (pending approval)
app.put('/api/portal/listings/:id', requireAuth, requireBoothOwner, (req, res) => {
  const data = readLocations();
  const users = readUsers();
  const user = users.find(u => u.id === req.session.user.id);
  const claimedIds = new Set((user?.claimedLocationIds || []).map(String));

  const idx = data.locations.findIndex(l => String(l.id) === req.params.id);
  if (idx === -1) return res.status(404).json({ ok: false, error: 'Location not found' });
  if (req.session.user.role !== 'admin' && !claimedIds.has(String(data.locations[idx].id))) {
    return res.status(403).json({ ok: false, error: 'You do not own this listing' });
  }

  // Get the user's tier to validate allowed fields
  const userTier = user?.subscription?.tier || data.locations[idx].listingTier || 'basic';
  const allowed = { name: true, description: true, shortDescription: true, address: true, categoryId: true };
  if (userTier === 'standout' || userTier === 'showoff') {
    allowed.images = true;
    allowed.categoryIds = true; // up to 3
  }
  if (userTier === 'showoff') {
    allowed.videoUrl = true;
    allowed.website = true;
    allowed.socialLinks = true;
  }

  // Build pending changes with only allowed fields
  const pending = {};
  for (const [key, val] of Object.entries(req.body)) {
    if (allowed[key]) pending[key] = val;
  }

  // Validate category limits
  if (pending.categoryIds && Array.isArray(pending.categoryIds)) {
    const maxCats = userTier === 'basic' ? 1 : 3;
    if (pending.categoryIds.length > maxCats) {
      return res.status(400).json({ ok: false, error: `Your ${userTier} plan allows up to ${maxCats} categories` });
    }
  }

  // Validate image limits
  if (pending.images && Array.isArray(pending.images)) {
    if (pending.images.length > 3) {
      return res.status(400).json({ ok: false, error: 'Maximum 3 images allowed' });
    }
  }

  data.locations[idx].pendingChanges = pending;
  data.locations[idx].status = 'pending_approval';
  writeLocations(data);
  res.json({ ok: true, message: 'Changes submitted for review' });
});

// Upload image for own listing
app.post('/api/portal/listings/:id/upload', requireAuth, requireBoothOwner, upload.single('image'), (req, res) => {
  if (!req.file) return res.status(400).json({ ok: false, error: 'No file' });
  const users = readUsers();
  const user = users.find(u => u.id === req.session.user.id);
  const claimedIds = new Set((user?.claimedLocationIds || []).map(String));
  if (req.session.user.role !== 'admin' && !claimedIds.has(req.params.id)) {
    return res.status(403).json({ ok: false, error: 'You do not own this listing' });
  }
  const userTier = user?.subscription?.tier || 'basic';
  if (userTier === 'basic') {
    return res.status(403).json({ ok: false, error: 'Photo uploads require Stand Out plan or higher' });
  }
  const url = `/uploads/${req.file.filename}`;
  res.json({ ok: true, url });
});

// ══════════════════════════════════════════════════════════════════════════
// ADMIN: APPROVAL QUEUE
// ══════════════════════════════════════════════════════════════════════════

app.get('/api/admin/pending', requireAuth, requireAdmin, (req, res) => {
  const data = readLocations();
  const users = readUsers();
  const pending = data.locations
    .filter(l => l.pendingChanges && l.status === 'pending_approval')
    .map(l => {
      const owner = users.find(u => u.id === l.ownerId);
      return {
        id: l.id,
        name: l.name,
        currentData: { name: l.name, description: l.description, shortDescription: l.shortDescription, address: l.address, categoryId: l.categoryId, images: l.images, videoUrl: l.videoUrl, website: l.website, socialLinks: l.socialLinks },
        pendingChanges: l.pendingChanges,
        ownerName: owner?.displayName || owner?.username || 'Unknown',
        listingTier: l.listingTier || 'unclaimed',
        submittedAt: l.pendingChanges?._submittedAt || null
      };
    });
  res.json({ ok: true, pending });
});

app.post('/api/admin/approve/:id', requireAuth, requireAdmin, (req, res) => {
  const data = readLocations();
  const idx = data.locations.findIndex(l => String(l.id) === req.params.id);
  if (idx === -1) return res.status(404).json({ ok: false, error: 'Location not found' });
  const loc = data.locations[idx];
  if (!loc.pendingChanges) return res.status(400).json({ ok: false, error: 'No pending changes' });

  // Merge pending changes into live data
  const changes = { ...loc.pendingChanges };
  delete changes._submittedAt;
  Object.assign(data.locations[idx], changes);
  data.locations[idx].pendingChanges = null;
  data.locations[idx].status = 'active';
  writeLocations(data);
  res.json({ ok: true, message: 'Changes approved and published' });
});

app.post('/api/admin/reject/:id', requireAuth, requireAdmin, (req, res) => {
  const data = readLocations();
  const idx = data.locations.findIndex(l => String(l.id) === req.params.id);
  if (idx === -1) return res.status(404).json({ ok: false, error: 'Location not found' });
  data.locations[idx].pendingChanges = null;
  data.locations[idx].status = 'active';
  writeLocations(data);
  res.json({ ok: true, message: 'Changes rejected', note: req.body.note || '' });
});

// ══════════════════════════════════════════════════════════════════════════
// ADMIN: CLAIMS QUEUE
// ══════════════════════════════════════════════════════════════════════════

app.get('/api/admin/claims', requireAuth, requireAdmin, (req, res) => {
  const claims = readClaims();
  const users = readUsers();
  const data = readLocations();
  const enriched = claims.filter(c => c.status === 'pending').map(c => {
    const user = users.find(u => u.id === c.userId);
    const loc = c.locationId ? data.locations.find(l => String(l.id) === String(c.locationId)) : null;
    return {
      ...c,
      userName: user?.displayName || user?.username || 'Unknown',
      userEmail: user?.email || '',
      locationName: loc?.name || (c.newLocationData?.name ? `NEW: ${c.newLocationData.name}` : 'Unknown')
    };
  });
  res.json({ ok: true, claims: enriched });
});

app.post('/api/admin/claims/:id/approve', requireAuth, requireAdmin, (req, res) => {
  const claims = readClaims();
  const claim = claims.find(c => c.id === req.params.id);
  if (!claim) return res.status(404).json({ ok: false, error: 'Claim not found' });
  if (claim.status !== 'pending') return res.status(400).json({ ok: false, error: 'Claim already processed' });

  const data = readLocations();
  const users = readUsers();
  const user = users.find(u => u.id === claim.userId);

  if (claim.type === 'create') {
    // Create new location
    const newLoc = {
      ...claim.newLocationData,
      id: `loc-${Date.now()}`,
      listingTier: claim.tier || 'basic',
      ownerId: claim.userId,
      status: 'active',
      pendingChanges: null,
      images: [],
      videoUrl: '',
      website: '',
      socialLinks: { facebook: '', instagram: '', twitter: '', tiktok: '' }
    };
    data.locations.push(newLoc);
    claim.locationId = newLoc.id;
    if (user) {
      if (!user.claimedLocationIds) user.claimedLocationIds = [];
      user.claimedLocationIds.push(newLoc.id);
    }
  } else {
    // Claim existing location
    const locIdx = data.locations.findIndex(l => String(l.id) === String(claim.locationId));
    if (locIdx === -1) return res.status(404).json({ ok: false, error: 'Location no longer exists' });
    data.locations[locIdx].ownerId = claim.userId;
    data.locations[locIdx].listingTier = claim.tier || 'basic';
    if (user) {
      if (!user.claimedLocationIds) user.claimedLocationIds = [];
      user.claimedLocationIds.push(claim.locationId);
    }
  }

  claim.status = 'approved';
  claim.reviewedAt = new Date().toISOString();
  claim.reviewedBy = req.session.user.id;

  writeLocations(data);
  writeClaims(claims);
  writeUsers(users);
  res.json({ ok: true, message: 'Claim approved' });
});

app.post('/api/admin/claims/:id/reject', requireAuth, requireAdmin, (req, res) => {
  const claims = readClaims();
  const claim = claims.find(c => c.id === req.params.id);
  if (!claim) return res.status(404).json({ ok: false, error: 'Claim not found' });
  if (claim.status !== 'pending') return res.status(400).json({ ok: false, error: 'Claim already processed' });

  claim.status = 'rejected';
  claim.reviewedAt = new Date().toISOString();
  claim.reviewedBy = req.session.user.id;
  claim.reviewNote = req.body.note || '';
  writeClaims(claims);
  res.json({ ok: true, message: 'Claim rejected' });
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
  const users = readUsers().map(u => ({ id: u.id, username: u.username, displayName: u.displayName, role: u.role, email: u.email, subscription: u.subscription, claimedLocationIds: u.claimedLocationIds }));
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
  if (req.session?.user) {
    return res.redirect(req.session.user.role === 'booth_owner' ? '/portal' : '/admin');
  }
  res.sendFile(path.join(ROOT, 'login.html'));
});

app.get('/signup', (req, res) => res.sendFile(path.join(ROOT, 'signup.html')));

app.get('/portal', requireAuth, requireBoothOwner, (req, res) => res.sendFile(path.join(ROOT, 'portal.html')));
app.get('/portal/claim', requireAuth, requireBoothOwner, (req, res) => res.sendFile(path.join(ROOT, 'portal-claim.html')));
app.get('/portal/edit/:id', requireAuth, requireBoothOwner, (req, res) => res.sendFile(path.join(ROOT, 'portal-edit.html')));

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
  console.log(`   Portal: http://localhost:${PORT}/portal`);
  console.log(`   Signup: http://localhost:${PORT}/signup`);
  if (!STRIPE_CONFIGURED) console.log('   ⚠️  Stripe not configured — payments disabled');
});
