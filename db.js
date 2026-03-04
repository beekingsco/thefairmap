'use strict';

const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');

const DATA_DIR = path.join(__dirname, 'data');
const DB_PATH = path.join(DATA_DIR, 'thefairmap.db');

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// ── Schema ──────────────────────────────────────────────────────────────────

db.exec(`
  CREATE TABLE IF NOT EXISTS tenants (
    id TEXT PRIMARY KEY,
    slug TEXT UNIQUE NOT NULL,
    name TEXT NOT NULL,
    owner_email TEXT NOT NULL,
    owner_name TEXT,
    owner_password TEXT,
    plan TEXT DEFAULT 'manual',
    stripe_customer_id TEXT,
    stripe_subscription_id TEXT,
    status TEXT DEFAULT 'pending',
    settings TEXT DEFAULT '{}',
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS locations (
    id TEXT NOT NULL,
    tenant_id TEXT NOT NULL,
    vendor_id TEXT,
    name TEXT,
    description TEXT,
    lat REAL,
    lng REAL,
    category_id TEXT,
    category_name TEXT,
    tier TEXT DEFAULT 'free',
    photos TEXT DEFAULT '[]',
    logo_url TEXT,
    video_url TEXT,
    website_url TEXT,
    social_links TEXT DEFAULT '{}',
    pending_edits TEXT,
    approval_status TEXT DEFAULT 'live',
    PRIMARY KEY (id, tenant_id)
  );

  CREATE TABLE IF NOT EXISTS categories (
    id TEXT NOT NULL,
    tenant_id TEXT NOT NULL,
    name TEXT NOT NULL,
    color TEXT DEFAULT '#7a7a7a',
    shape TEXT DEFAULT 'circle',
    icon TEXT,
    sort_order INTEGER DEFAULT 0,
    PRIMARY KEY (id, tenant_id)
  );

  CREATE TABLE IF NOT EXISTS vendors (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    location_id TEXT,
    email TEXT NOT NULL,
    name TEXT,
    password TEXT,
    plan TEXT DEFAULT 'free',
    billing_cycle TEXT DEFAULT 'monthly',
    stripe_customer_id TEXT,
    stripe_subscription_id TEXT,
    billing_status TEXT DEFAULT 'active',
    migrated_from_cf INTEGER DEFAULT 0,
    renewal_date TEXT,
    status TEXT DEFAULT 'active',
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS pending_edits (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    location_id TEXT NOT NULL,
    vendor_id TEXT NOT NULL,
    submitted_at TEXT DEFAULT (datetime('now')),
    changes TEXT NOT NULL,
    status TEXT DEFAULT 'pending',
    reviewed_by TEXT,
    reviewed_at TEXT,
    review_note TEXT
  );

  CREATE INDEX IF NOT EXISTS idx_locations_tenant ON locations(tenant_id);
  CREATE INDEX IF NOT EXISTS idx_categories_tenant ON categories(tenant_id);
  CREATE INDEX IF NOT EXISTS idx_vendors_tenant ON vendors(tenant_id);
  CREATE INDEX IF NOT EXISTS idx_vendors_email ON vendors(email);
  CREATE INDEX IF NOT EXISTS idx_pending_edits_tenant ON pending_edits(tenant_id);
  CREATE INDEX IF NOT EXISTS idx_pending_edits_status ON pending_edits(status);
`);

// ── Helper functions ────────────────────────────────────────────────────────

function uuid() {
  return crypto.randomUUID();
}

// ── Tenant helpers ──────────────────────────────────────────────────────────

const stmts = {
  getTenantBySlug: db.prepare('SELECT * FROM tenants WHERE slug = ?'),
  getTenantById: db.prepare('SELECT * FROM tenants WHERE id = ?'),
  getAllTenants: db.prepare('SELECT * FROM tenants ORDER BY created_at DESC'),
  insertTenant: db.prepare(`
    INSERT INTO tenants (id, slug, name, owner_email, owner_name, owner_password, plan, status, settings)
    VALUES (@id, @slug, @name, @owner_email, @owner_name, @owner_password, @plan, @status, @settings)
  `),
  updateTenantStatus: db.prepare('UPDATE tenants SET status = ? WHERE id = ?'),
  updateTenant: db.prepare(`
    UPDATE tenants SET name = @name, owner_email = @owner_email, owner_name = @owner_name,
    settings = @settings WHERE id = @id
  `),

  // Locations
  getLocationsByTenant: db.prepare('SELECT * FROM locations WHERE tenant_id = ?'),
  getLocation: db.prepare('SELECT * FROM locations WHERE id = ? AND tenant_id = ?'),
  insertLocation: db.prepare(`
    INSERT INTO locations (id, tenant_id, vendor_id, name, description, lat, lng, category_id, category_name, tier, photos, logo_url, video_url, website_url, social_links, approval_status)
    VALUES (@id, @tenant_id, @vendor_id, @name, @description, @lat, @lng, @category_id, @category_name, @tier, @photos, @logo_url, @video_url, @website_url, @social_links, @approval_status)
  `),
  updateLocation: db.prepare(`
    UPDATE locations SET name = @name, description = @description, lat = @lat, lng = @lng,
    category_id = @category_id, category_name = @category_name, tier = @tier, photos = @photos,
    logo_url = @logo_url, video_url = @video_url, website_url = @website_url, social_links = @social_links,
    vendor_id = @vendor_id, approval_status = @approval_status, pending_edits = @pending_edits
    WHERE id = @id AND tenant_id = @tenant_id
  `),
  deleteLocation: db.prepare('DELETE FROM locations WHERE id = ? AND tenant_id = ?'),

  // Categories
  getCategoriesByTenant: db.prepare('SELECT * FROM categories WHERE tenant_id = ? ORDER BY sort_order, name'),
  getCategory: db.prepare('SELECT * FROM categories WHERE id = ? AND tenant_id = ?'),
  insertCategory: db.prepare(`
    INSERT INTO categories (id, tenant_id, name, color, shape, icon, sort_order)
    VALUES (@id, @tenant_id, @name, @color, @shape, @icon, @sort_order)
  `),
  updateCategory: db.prepare(`
    UPDATE categories SET name = @name, color = @color, shape = @shape WHERE id = @id AND tenant_id = @tenant_id
  `),
  deleteCategory: db.prepare('DELETE FROM categories WHERE id = ? AND tenant_id = ?'),
  countLocationsByCategory: db.prepare('SELECT COUNT(*) as cnt FROM locations WHERE category_id = ? AND tenant_id = ?'),

  // Vendors
  getVendorsByTenant: db.prepare('SELECT * FROM vendors WHERE tenant_id = ? ORDER BY created_at DESC'),
  getVendorById: db.prepare('SELECT * FROM vendors WHERE id = ?'),
  getVendorByEmail: db.prepare('SELECT * FROM vendors WHERE email = ? AND tenant_id = ?'),
  insertVendor: db.prepare(`
    INSERT INTO vendors (id, tenant_id, location_id, email, name, password, plan, billing_cycle, status)
    VALUES (@id, @tenant_id, @location_id, @email, @name, @password, @plan, @billing_cycle, @status)
  `),
  updateVendor: db.prepare(`
    UPDATE vendors SET name = @name, plan = @plan, billing_cycle = @billing_cycle,
    stripe_customer_id = @stripe_customer_id, stripe_subscription_id = @stripe_subscription_id,
    billing_status = @billing_status, renewal_date = @renewal_date, status = @status
    WHERE id = @id
  `),
  updateVendorPassword: db.prepare('UPDATE vendors SET password = ? WHERE id = ?'),

  // Pending edits
  getPendingEditsByTenant: db.prepare("SELECT * FROM pending_edits WHERE tenant_id = ? AND status = 'pending' ORDER BY submitted_at DESC"),
  getPendingEditById: db.prepare('SELECT * FROM pending_edits WHERE id = ?'),
  insertPendingEdit: db.prepare(`
    INSERT INTO pending_edits (id, tenant_id, location_id, vendor_id, changes, status)
    VALUES (@id, @tenant_id, @location_id, @vendor_id, @changes, @status)
  `),
  updatePendingEditStatus: db.prepare(`
    UPDATE pending_edits SET status = @status, reviewed_by = @reviewed_by,
    reviewed_at = @reviewed_at, review_note = @review_note WHERE id = @id
  `),

  // Stats
  countLocationsByTenant: db.prepare('SELECT COUNT(*) as cnt FROM locations WHERE tenant_id = ?'),
  countVendorsByTenant: db.prepare('SELECT COUNT(*) as cnt FROM vendors WHERE tenant_id = ?'),
  countPendingByTenant: db.prepare("SELECT COUNT(*) as cnt FROM pending_edits WHERE tenant_id = ? AND status = 'pending'"),
};

// ── Seed First Monday tenant ────────────────────────────────────────────────

function seedFirstMonday() {
  const existing = stmts.getTenantBySlug.get('firstmonday');
  if (existing) return;

  console.log('🌱 Seeding First Monday tenant...');

  const tenantId = uuid();
  const hashedPw = bcrypt.hashSync('fairmap2026', 10);

  stmts.insertTenant.run({
    id: tenantId,
    slug: 'firstmonday',
    name: 'First Monday Trade Days',
    owner_email: 'howdy@visitfirstmonday.com',
    owner_name: 'First Monday Admin',
    owner_password: hashedPw,
    plan: 'pro',
    status: 'active',
    settings: JSON.stringify({
      mapCenter: [-95.8624, 32.5585],
      mapZoom: 17,
      mapPitch: 60,
      primaryColor: '#2f3d4d',
      logoUrl: '/data/icons/first-monday-finder-logo.png'
    })
  });

  // Import locations from existing JSON
  const locFile = path.join(DATA_DIR, 'locations.json');
  if (fs.existsSync(locFile)) {
    const raw = JSON.parse(fs.readFileSync(locFile, 'utf8'));

    // Import categories
    if (raw.categories && Array.isArray(raw.categories)) {
      const insertCat = db.transaction((cats) => {
        for (let i = 0; i < cats.length; i++) {
          const c = cats[i];
          stmts.insertCategory.run({
            id: c.id,
            tenant_id: tenantId,
            name: c.name,
            color: c.color || '#7a7a7a',
            shape: c.shape || 'circle',
            icon: c.icon || null,
            sort_order: i
          });
        }
      });
      insertCat(raw.categories);
      console.log(`   ✅ ${raw.categories.length} categories imported`);
    }

    // Import locations
    if (raw.locations && Array.isArray(raw.locations)) {
      const insertLocs = db.transaction((locs) => {
        for (const loc of locs) {
          stmts.insertLocation.run({
            id: String(loc.id),
            tenant_id: tenantId,
            vendor_id: null,
            name: loc.name || '',
            description: loc.description || '',
            lat: loc.lat || 0,
            lng: loc.lng || 0,
            category_id: loc.categoryId || '',
            category_name: loc.categoryName || '',
            tier: 'free',
            photos: JSON.stringify(loc.images || loc.photos || []),
            logo_url: loc.logoUrl || null,
            video_url: loc.videoUrl || null,
            website_url: loc.website || loc.websiteUrl || null,
            social_links: JSON.stringify(loc.socialLinks || {}),
            approval_status: 'live'
          });
        }
      });
      insertLocs(raw.locations);
      console.log(`   ✅ ${raw.locations.length} locations imported`);
    }
  }

  // Import existing users as admin/editors for the tenant
  const usersFile = path.join(DATA_DIR, 'users.json');
  if (fs.existsSync(usersFile)) {
    const users = JSON.parse(fs.readFileSync(usersFile, 'utf8'));
    console.log(`   ✅ ${users.length} legacy users noted (auth handled via tenant owner login)`);
  }

  console.log('🌱 First Monday seed complete');
}

// Run seed on module load if SEED_TENANT env is set or if no tenants exist
const tenantCount = db.prepare('SELECT COUNT(*) as cnt FROM tenants').get().cnt;
if (tenantCount === 0 || process.env.SEED_TENANT === 'true') {
  seedFirstMonday();
}

module.exports = { db, stmts, uuid };
