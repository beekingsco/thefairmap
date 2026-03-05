'use strict';
require('dotenv').config();

const express = require('express');
const session = require('express-session');
const path    = require('path');
const fs      = require('fs');

// Initialize database (runs schema + seed on first load)
const { db, stmts } = require('./db');

const app  = express();
const PORT = process.env.PORT || 4000;
const ROOT = __dirname;
const BASE_URL = process.env.BASE_URL || `http://localhost:${PORT}`;

// ── Stripe (optional) ───────────────────────────────────────────────────────
let stripe = null;
if (process.env.STRIPE_SECRET_KEY) {
  try {
    stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
    console.log('💳 Stripe configured');
  } catch (e) {
    console.warn('⚠️  Stripe module not found');
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

// Share with route modules
app.locals.stripe = stripe;
app.locals.STRIPE_PRICES = STRIPE_PRICES;
app.locals.BASE_URL = BASE_URL;

// ── Ensure directories ──────────────────────────────────────────────────────
const UPLOADS_DIR = path.join(ROOT, 'uploads');
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });

// ── Stripe webhook (raw body — BEFORE json parser) ──────────────────────────
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

  switch (event.type) {
    case 'checkout.session.completed': {
      const sess = event.data.object;
      const vendorId = sess.metadata?.vendorId;
      const plan = sess.metadata?.plan;
      const billingCycle = sess.metadata?.billingCycle;
      if (vendorId) {
        const vendor = stmts.getVendorById.get(vendorId);
        if (vendor) {
          stmts.updateVendor.run({
            id: vendor.id, name: vendor.name, plan: plan || vendor.plan,
            billing_cycle: billingCycle || vendor.billing_cycle,
            stripe_customer_id: sess.customer,
            stripe_subscription_id: sess.subscription,
            billing_status: 'active',
            renewal_date: null, status: 'active'
          });
          // Update location tier
          if (vendor.location_id) {
            const loc = stmts.getLocation.get(vendor.location_id, vendor.tenant_id);
            if (loc) {
              stmts.updateLocation.run({
                id: loc.id, tenant_id: loc.tenant_id, vendor_id: loc.vendor_id,
                name: loc.name, description: loc.description, lat: loc.lat, lng: loc.lng,
                category_id: loc.category_id, category_name: loc.category_name,
                tier: plan || loc.tier, photos: loc.photos, logo_url: loc.logo_url,
                video_url: loc.video_url, website_url: loc.website_url,
                social_links: loc.social_links, approval_status: loc.approval_status,
                pending_edits: loc.pending_edits
              });
            }
          }
          console.log(`✅ Vendor subscription: ${vendor.email} → ${plan}`);
        }
      }
      break;
    }
    case 'customer.subscription.updated': {
      const sub = event.data.object;
      const vendor = db.prepare('SELECT * FROM vendors WHERE stripe_customer_id = ?').get(sub.customer);
      if (vendor) {
        stmts.updateVendor.run({
          id: vendor.id, name: vendor.name, plan: vendor.plan,
          billing_cycle: vendor.billing_cycle,
          stripe_customer_id: vendor.stripe_customer_id,
          stripe_subscription_id: vendor.stripe_subscription_id,
          billing_status: sub.status,
          renewal_date: sub.current_period_end ? new Date(sub.current_period_end * 1000).toISOString() : null,
          status: vendor.status
        });
      }
      break;
    }
    case 'customer.subscription.deleted': {
      const sub = event.data.object;
      const vendor = db.prepare('SELECT * FROM vendors WHERE stripe_customer_id = ?').get(sub.customer);
      if (vendor) {
        stmts.updateVendor.run({
          id: vendor.id, name: vendor.name, plan: vendor.plan,
          billing_cycle: vendor.billing_cycle,
          stripe_customer_id: vendor.stripe_customer_id,
          stripe_subscription_id: vendor.stripe_subscription_id,
          billing_status: 'cancelled',
          renewal_date: null, status: vendor.status
        });
        console.log(`❌ Vendor subscription canceled: ${vendor.email}`);
      }
      break;
    }
    case 'invoice.payment_failed': {
      const inv = event.data.object;
      const vendor = db.prepare('SELECT * FROM vendors WHERE stripe_customer_id = ?').get(inv.customer);
      if (vendor) {
        stmts.updateVendor.run({
          id: vendor.id, name: vendor.name, plan: vendor.plan,
          billing_cycle: vendor.billing_cycle,
          stripe_customer_id: vendor.stripe_customer_id,
          stripe_subscription_id: vendor.stripe_subscription_id,
          billing_status: 'past_due',
          renewal_date: vendor.renewal_date, status: vendor.status
        });
      }
      break;
    }
  }
  res.json({ received: true });
});

// ── Middleware ───────────────────────────────────────────────────────────────
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
app.use(session({
  secret: process.env.SESSION_SECRET || 'fairmap-secret-2026',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 7 * 24 * 60 * 60 * 1000 }
}));

// ── Subdomain / tenant resolution middleware ────────────────────────────────
app.use((req, res, next) => {
  req.tenant = null;

  // 1. Check ?tenant= query param (local dev fallback)
  const qTenant = req.query.tenant;
  if (qTenant) {
    req.tenant = stmts.getTenantBySlug.get(qTenant.toLowerCase().trim());
    return next();
  }

  // 2. Check subdomain
  const host = req.hostname || '';
  const baseDomain = (process.env.BASE_DOMAIN || 'thefairmap.com').replace(/^www\./, '');

  // localhost — no subdomain routing
  if (host === 'localhost' || host === '127.0.0.1') {
    return next();
  }

  // Strip base domain to get subdomain
  if (host.endsWith('.' + baseDomain)) {
    const slug = host.slice(0, -(baseDomain.length + 1));
    if (slug && slug !== 'www') {
      const tenant = stmts.getTenantBySlug.get(slug);
      if (tenant && tenant.status === 'active') {
        req.tenant = tenant;
      }
    }
  }

  next();
});

// ── Route imports ───────────────────────────────────────────────────────────
const authRoutes     = require('./routes/auth');
const publicRoutes   = require('./routes/public');
const tenantRoutes   = require('./routes/tenant');
const vendorRoutes   = require('./routes/vendor');
const platformRoutes = require('./routes/platform');

// ── Platform routes (no tenant needed) ──────────────────────────────────────
app.use(platformRoutes);

// ── Auth routes (work in both contexts) ─────────────────────────────────────
app.use(authRoutes);

// ── Tenant-scoped routes ────────────────────────────────────────────────────
app.use(vendorRoutes);
app.use(tenantRoutes);
app.use(publicRoutes);

// ── Marketing pages (no tenant) ─────────────────────────────────────────────
app.get('/signup', (req, res) => {
  res.sendFile(path.join(ROOT, 'public', 'signup.html'));
});

// ── Static files ────────────────────────────────────────────────────────────
app.use('/uploads', express.static(UPLOADS_DIR));
app.use('/data', express.static(path.join(ROOT, 'data')));
app.use(express.static(path.join(ROOT, 'public'), {
  index: false,
  extensions: ['html']
}));
// Legacy static files from root (config.js, map.js, style.css, admin.html, admin.js, etc.)
app.use(express.static(ROOT, {
  index: false,
  extensions: ['html']
}));

// ── Fallback: marketing landing page for bare domain ────────────────────────
app.get('/', (req, res) => {
  if (req.tenant) {
    return res.sendFile(path.join(ROOT, 'public', 'map.html'));
  }
  res.sendFile(path.join(ROOT, 'public', 'index.html'));
});

// ── 404 ─────────────────────────────────────────────────────────────────────
app.use((req, res) => res.status(404).send('Not found'));

// ── Error handler ───────────────────────────────────────────────────────────
app.use((err, req, res, next) => {
  console.error('[Error]', err.message);
  if (res.headersSent) return next(err);
  res.status(err.status || 500).json({ ok: false, error: err.message });
});

// ── Start ───────────────────────────────────────────────────────────────────
app.listen(PORT, '0.0.0.0', () => {
  console.log(`🗺️  TheFairMap SaaS running at http://localhost:${PORT}`);
  console.log(`   Marketing:  http://localhost:${PORT}`);
  console.log(`   Platform:   http://localhost:${PORT}/platform`);
  console.log(`   Map (dev):  http://localhost:${PORT}/?tenant=firstmonday`);
  console.log(`   Admin (dev): http://localhost:${PORT}/admin?tenant=firstmonday`);
  console.log(`   Vendor (dev): http://localhost:${PORT}/vendors/claim?tenant=firstmonday`);
  if (!stripe) console.log('   ⚠️  Stripe not configured — payments disabled');
});
