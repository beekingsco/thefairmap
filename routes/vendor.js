'use strict';

const express = require('express');
const bcrypt = require('bcryptjs');
const multer = require('multer');
const path = require('path');
const { db, stmts, uuid } = require('../db');

const router = express.Router();
const ROOT = path.join(__dirname, '..');

// Multer for vendor uploads
const storage = multer.diskStorage({
  destination: path.join(ROOT, 'uploads'),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const safe = path.basename(file.originalname, ext).replace(/[^a-z0-9_-]/gi, '_').slice(0, 40);
    cb(null, `${Date.now()}-${safe}${ext}`);
  }
});
const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (/^image\/(jpeg|png|gif|webp|svg\+xml)$/.test(file.mimetype)) cb(null, true);
    else cb(new Error('Only image files allowed'));
  }
});

function requireVendor(req, res, next) {
  const user = req.session?.user;
  if (!user) return res.status(401).json({ ok: false, error: 'Not authenticated' });
  if (user.role === 'vendor' && user.tenantId === req.tenant?.id) return next();
  if (user.role === 'tenant_admin' || user.role === 'platform_admin') return next();
  res.status(403).json({ ok: false, error: 'Vendor access required' });
}

// ── Vendor claim flow ───────────────────────────────────────────────────────

// Step 1: Find locations matching email or search
router.get('/api/vendors/search-locations', (req, res) => {
  const tenant = req.tenant;
  if (!tenant) return res.status(400).json({ ok: false, error: 'No tenant context' });

  const q = (req.query.q || '').toLowerCase().trim();
  if (!q) return res.json({ ok: true, locations: [] });

  const all = stmts.getLocationsByTenant.all(tenant.id);
  const matches = all.filter(l => {
    const name = (l.name || '').toLowerCase();
    const desc = (l.description || '').toLowerCase();
    return name.includes(q) || desc.includes(q);
  }).slice(0, 20).map(l => ({
    id: l.id,
    name: l.name,
    description: l.description,
    lat: l.lat,
    lng: l.lng,
    categoryName: l.category_name,
    vendorId: l.vendor_id,
    claimed: !!l.vendor_id
  }));

  res.json({ ok: true, locations: matches });
});

// Step 2: Claim a location — register + pick plan
router.post('/api/vendors/claim', (req, res) => {
  const tenant = req.tenant;
  if (!tenant) return res.status(400).json({ ok: false, error: 'No tenant context' });

  const { email, name, password, locationId, plan, billingCycle } = req.body;
  if (!email || !password) return res.status(400).json({ ok: false, error: 'Email and password required' });
  if (password.length < 6) return res.status(400).json({ ok: false, error: 'Password must be at least 6 characters' });
  if (!locationId) return res.status(400).json({ ok: false, error: 'Location ID required' });

  // Check location exists and is unclaimed
  const loc = stmts.getLocation.get(locationId, tenant.id);
  if (!loc) return res.status(404).json({ ok: false, error: 'Location not found' });
  if (loc.vendor_id) return res.status(400).json({ ok: false, error: 'This location is already claimed' });

  // Check if vendor email already exists for this tenant
  const existingVendor = stmts.getVendorByEmail.get(email, tenant.id);
  if (existingVendor) return res.status(400).json({ ok: false, error: 'Email already registered. Please log in.' });

  const vendorId = uuid();
  const hashedPw = bcrypt.hashSync(password, 10);

  stmts.insertVendor.run({
    id: vendorId,
    tenant_id: tenant.id,
    location_id: locationId,
    email,
    name: name || email.split('@')[0],
    password: hashedPw,
    plan: plan || 'free',
    billing_cycle: billingCycle || 'monthly',
    status: 'active'
  });

  // Link vendor to location
  stmts.updateLocation.run({
    id: loc.id, tenant_id: tenant.id,
    vendor_id: vendorId,
    name: loc.name, description: loc.description,
    lat: loc.lat, lng: loc.lng,
    category_id: loc.category_id, category_name: loc.category_name,
    tier: plan || 'free',
    photos: loc.photos, logo_url: loc.logo_url,
    video_url: loc.video_url, website_url: loc.website_url,
    social_links: loc.social_links,
    approval_status: loc.approval_status,
    pending_edits: loc.pending_edits
  });

  // Auto-login
  req.session.user = {
    role: 'vendor',
    tenantId: tenant.id,
    vendorId,
    email,
    name: name || email.split('@')[0]
  };

  // Send welcome email (fire and forget)
  try {
    const { sendVendorWelcome } = require('../email');
    sendVendorWelcome(email, name || email, tenant.name);
  } catch (e) { /* email module may not be configured */ }

  res.json({ ok: true, vendorId, needsCheckout: plan && plan !== 'free' });
});

// ── Vendor dashboard API ────────────────────────────────────────────────────

router.get('/api/vendors/me', requireVendor, (req, res) => {
  const vendor = stmts.getVendorById.get(req.session.user.vendorId);
  if (!vendor) return res.status(404).json({ ok: false, error: 'Vendor not found' });

  const loc = vendor.location_id ? stmts.getLocation.get(vendor.location_id, vendor.tenant_id) : null;
  const pendingEdits = db.prepare("SELECT * FROM pending_edits WHERE vendor_id = ? AND status = 'pending'").all(vendor.id);

  res.json({
    ok: true,
    vendor: {
      id: vendor.id,
      email: vendor.email,
      name: vendor.name,
      plan: vendor.plan,
      billingCycle: vendor.billing_cycle,
      billingStatus: vendor.billing_status,
      renewalDate: vendor.renewal_date,
      status: vendor.status
    },
    location: loc ? {
      id: loc.id,
      name: loc.name,
      description: loc.description,
      lat: loc.lat,
      lng: loc.lng,
      categoryId: loc.category_id,
      categoryName: loc.category_name,
      tier: loc.tier,
      photos: JSON.parse(loc.photos || '[]'),
      logoUrl: loc.logo_url,
      videoUrl: loc.video_url,
      websiteUrl: loc.website_url,
      socialLinks: JSON.parse(loc.social_links || '{}')
    } : null,
    pendingEdits: pendingEdits.map(e => ({
      id: e.id,
      changes: JSON.parse(e.changes || '{}'),
      status: e.status,
      submittedAt: e.submitted_at,
      reviewNote: e.review_note
    }))
  });
});

// Submit edits (goes to pending queue)
router.post('/api/vendors/submit-edit', requireVendor, (req, res) => {
  const vendor = stmts.getVendorById.get(req.session.user.vendorId);
  if (!vendor || !vendor.location_id) return res.status(400).json({ ok: false, error: 'No location linked' });

  const loc = stmts.getLocation.get(vendor.location_id, vendor.tenant_id);
  if (!loc) return res.status(404).json({ ok: false, error: 'Location not found' });

  // Filter allowed fields by plan
  const allowed = { name: true, description: true };
  if (vendor.plan === 'showoff' || vendor.plan === 'standout') {
    allowed.photos = true;
    allowed.logoUrl = true;
  }
  if (vendor.plan === 'standout') {
    allowed.videoUrl = true;
    allowed.websiteUrl = true;
    allowed.socialLinks = true;
  }

  const changes = {};
  for (const [key, val] of Object.entries(req.body)) {
    if (allowed[key]) changes[key] = val;
  }

  if (Object.keys(changes).length === 0) {
    return res.status(400).json({ ok: false, error: 'No valid changes submitted' });
  }

  // Validate photo limit
  if (changes.photos && Array.isArray(changes.photos) && changes.photos.length > 10) {
    return res.status(400).json({ ok: false, error: 'Maximum 10 photos allowed' });
  }

  const editId = uuid();
  stmts.insertPendingEdit.run({
    id: editId,
    tenant_id: vendor.tenant_id,
    location_id: vendor.location_id,
    vendor_id: vendor.id,
    changes: JSON.stringify(changes),
    status: 'pending'
  });

  res.json({ ok: true, editId });
});

// Upload image (vendor)
router.post('/api/vendors/upload-image', requireVendor, upload.single('image'), (req, res) => {
  if (!req.file) return res.status(400).json({ ok: false, error: 'No file' });
  const vendor = stmts.getVendorById.get(req.session.user.vendorId);
  if (!vendor || (vendor.plan !== 'showoff' && vendor.plan !== 'standout')) {
    return res.status(403).json({ ok: false, error: 'Photo uploads require Show Off plan or higher' });
  }
  res.json({ ok: true, url: `/uploads/${req.file.filename}` });
});

// ── Stripe checkout for vendor ──────────────────────────────────────────────

router.post('/api/vendors/create-checkout', requireVendor, (req, res) => {
  const stripe = req.app.locals.stripe;
  if (!stripe) return res.status(503).json({ ok: false, error: 'Stripe not configured' });

  const { plan, billingCycle } = req.body;
  const STRIPE_PRICES = req.app.locals.STRIPE_PRICES;
  const priceKey = `${plan}_${billingCycle || 'monthly'}`;
  const priceId = STRIPE_PRICES?.[priceKey];
  if (!priceId || priceId.includes('placeholder')) {
    return res.status(400).json({ ok: false, error: 'Pricing not configured yet' });
  }

  const vendor = stmts.getVendorById.get(req.session.user.vendorId);
  const BASE_URL = req.app.locals.BASE_URL;
  const tenantSlug = req.tenant.slug;

  stripe.checkout.sessions.create({
    mode: 'subscription',
    line_items: [{ price: priceId, quantity: 1 }],
    success_url: `${BASE_URL}/vendors/dashboard?checkout=success`,
    cancel_url: `${BASE_URL}/vendors/dashboard?checkout=cancel`,
    metadata: {
      vendorId: vendor.id,
      tenantId: vendor.tenant_id,
      plan,
      billingCycle: billingCycle || 'monthly'
    }
  }).then(session => {
    res.json({ ok: true, url: session.url });
  }).catch(err => {
    console.error('Stripe checkout error:', err.message);
    res.status(500).json({ ok: false, error: 'Failed to create checkout' });
  });
});

router.get('/api/vendors/billing-portal', requireVendor, (req, res) => {
  const stripe = req.app.locals.stripe;
  if (!stripe) return res.status(503).json({ ok: false, error: 'Stripe not configured' });

  const vendor = stmts.getVendorById.get(req.session.user.vendorId);
  if (!vendor?.stripe_customer_id) return res.status(400).json({ ok: false, error: 'No billing account' });

  const BASE_URL = req.app.locals.BASE_URL;
  stripe.billingPortal.sessions.create({
    customer: vendor.stripe_customer_id,
    return_url: `${BASE_URL}/vendors/dashboard`
  }).then(session => {
    res.json({ ok: true, url: session.url });
  }).catch(err => {
    console.error('Stripe portal error:', err.message);
    res.status(500).json({ ok: false, error: 'Failed to open billing portal' });
  });
});

// ── HTML pages ──────────────────────────────────────────────────────────────

router.get('/vendors/claim', (req, res) => {
  res.sendFile(path.join(ROOT, 'public', 'vendor-claim.html'));
});

router.get('/vendors/login', (req, res) => {
  if (req.session?.user?.role === 'vendor') return res.redirect('/vendors/dashboard');
  res.sendFile(path.join(ROOT, 'public', 'vendor-login.html'));
});

router.get('/vendors/dashboard', (req, res) => {
  if (!req.session?.user || (req.session.user.role !== 'vendor' && req.session.user.role !== 'tenant_admin' && req.session.user.role !== 'platform_admin')) {
    return res.redirect('/vendors/login');
  }
  res.sendFile(path.join(ROOT, 'public', 'vendor-dash.html'));
});

module.exports = router;
