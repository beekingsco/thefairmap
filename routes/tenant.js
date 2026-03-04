'use strict';

const express = require('express');
const multer = require('multer');
const path = require('path');
const { db, stmts, uuid } = require('../db');

const router = express.Router();
const ROOT = path.join(__dirname, '..');

// ── Multer for image uploads ────────────────────────────────────────────────
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
    else cb(new Error('Only image files are allowed'));
  }
});

// ── Auth middleware ──────────────────────────────────────────────────────────

function requireTenantAdmin(req, res, next) {
  const user = req.session?.user;
  if (!user) return res.status(401).json({ ok: false, error: 'Not authenticated' });
  // Platform admin can impersonate
  if (user.role === 'platform_admin') return next();
  if (user.role === 'tenant_admin' && user.tenantId === req.tenant?.id) return next();
  res.status(403).json({ ok: false, error: 'Tenant admin access required' });
}

// ── Dashboard stats ─────────────────────────────────────────────────────────

router.get('/api/admin/stats', requireTenantAdmin, (req, res) => {
  const tid = req.tenant.id;
  const locCount = stmts.countLocationsByTenant.get(tid).cnt;
  const vendorCount = stmts.countVendorsByTenant.get(tid).cnt;
  const pendingCount = stmts.countPendingByTenant.get(tid).cnt;

  const vendors = stmts.getVendorsByTenant.all(tid);
  const paidVendors = vendors.filter(v => v.plan !== 'free' && v.billing_status === 'active');
  const monthlyRevenue = paidVendors.reduce((sum, v) => {
    const prices = { basic: 4.99, showoff: 9.99, standout: 19.99 };
    return sum + (prices[v.plan] || 0);
  }, 0);

  res.json({
    ok: true,
    stats: { locations: locCount, vendors: vendorCount, pending: pendingCount, monthlyRevenue: monthlyRevenue.toFixed(2) }
  });
});

// ── Location CRUD (admin) ───────────────────────────────────────────────────

router.get('/api/admin/locations', requireTenantAdmin, (req, res) => {
  const locations = stmts.getLocationsByTenant.all(req.tenant.id).map(loc => ({
    id: loc.id,
    name: loc.name,
    description: loc.description,
    lat: loc.lat,
    lng: loc.lng,
    categoryId: loc.category_id,
    categoryName: loc.category_name,
    tier: loc.tier,
    photos: JSON.parse(loc.photos || '[]'),
    images: JSON.parse(loc.photos || '[]'),
    logoUrl: loc.logo_url,
    videoUrl: loc.video_url,
    websiteUrl: loc.website_url,
    socialLinks: JSON.parse(loc.social_links || '{}'),
    approvalStatus: loc.approval_status,
    vendorId: loc.vendor_id
  }));
  res.json({ ok: true, locations });
});

router.post('/api/locations', requireTenantAdmin, (req, res) => {
  const tid = req.tenant.id;
  const loc = req.body;
  const id = loc.id || uuid();
  stmts.insertLocation.run({
    id,
    tenant_id: tid,
    vendor_id: loc.vendorId || null,
    name: loc.name || '',
    description: loc.description || '',
    lat: loc.lat || 0,
    lng: loc.lng || 0,
    category_id: loc.categoryId || '',
    category_name: loc.categoryName || '',
    tier: loc.tier || 'free',
    photos: JSON.stringify(loc.photos || loc.images || []),
    logo_url: loc.logoUrl || null,
    video_url: loc.videoUrl || null,
    website_url: loc.websiteUrl || null,
    social_links: JSON.stringify(loc.socialLinks || {}),
    approval_status: 'live'
  });
  res.json({ ok: true, location: { ...loc, id } });
});

router.put('/api/locations/:id', requireTenantAdmin, (req, res) => {
  const tid = req.tenant.id;
  const existing = stmts.getLocation.get(req.params.id, tid);
  if (!existing) return res.status(404).json({ ok: false, error: 'Not found' });

  const loc = req.body;
  stmts.updateLocation.run({
    id: req.params.id,
    tenant_id: tid,
    vendor_id: loc.vendorId || existing.vendor_id || null,
    name: loc.name ?? existing.name,
    description: loc.description ?? existing.description,
    lat: loc.lat ?? existing.lat,
    lng: loc.lng ?? existing.lng,
    category_id: loc.categoryId ?? existing.category_id,
    category_name: loc.categoryName ?? existing.category_name,
    tier: loc.tier ?? existing.tier,
    photos: JSON.stringify(loc.photos || loc.images || JSON.parse(existing.photos || '[]')),
    logo_url: loc.logoUrl ?? existing.logo_url,
    video_url: loc.videoUrl ?? existing.video_url,
    website_url: loc.websiteUrl ?? existing.website_url,
    social_links: JSON.stringify(loc.socialLinks || JSON.parse(existing.social_links || '{}')),
    approval_status: loc.approvalStatus ?? existing.approval_status,
    pending_edits: existing.pending_edits
  });
  res.json({ ok: true, location: { id: req.params.id, ...loc } });
});

router.delete('/api/locations/:id', requireTenantAdmin, (req, res) => {
  const result = stmts.deleteLocation.run(req.params.id, req.tenant.id);
  if (result.changes === 0) return res.status(404).json({ ok: false, error: 'Not found' });
  res.json({ ok: true });
});

router.post('/api/locations/bulk-delete', requireTenantAdmin, (req, res) => {
  const { ids } = req.body;
  if (!Array.isArray(ids) || ids.length === 0) return res.status(400).json({ ok: false, error: 'No IDs' });
  const del = db.prepare('DELETE FROM locations WHERE id = ? AND tenant_id = ?');
  const batch = db.transaction((idList) => {
    let count = 0;
    for (const id of idList) {
      count += del.run(id, req.tenant.id).changes;
    }
    return count;
  });
  const deleted = batch(ids);
  res.json({ ok: true, deleted });
});

// ── Image upload ────────────────────────────────────────────────────────────

router.post('/api/upload-image', requireTenantAdmin, upload.single('image'), (req, res) => {
  if (!req.file) return res.status(400).json({ ok: false, error: 'No file' });
  res.json({ ok: true, url: `/uploads/${req.file.filename}` });
});

// ── Category CRUD ───────────────────────────────────────────────────────────

router.get('/api/admin/categories', requireTenantAdmin, (req, res) => {
  const cats = stmts.getCategoriesByTenant.all(req.tenant.id);
  const locs = stmts.getLocationsByTenant.all(req.tenant.id);
  const categories = cats.map(c => ({
    id: c.id, name: c.name, color: c.color, shape: c.shape, icon: c.icon,
    count: locs.filter(l => l.category_id === c.id).length
  }));
  res.json({ ok: true, categories });
});

router.post('/api/categories', requireTenantAdmin, (req, res) => {
  const { name, color, shape } = req.body;
  if (!name) return res.status(400).json({ ok: false, error: 'Name required' });
  const id = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
  const existing = stmts.getCategory.get(id, req.tenant.id);
  if (existing) return res.status(400).json({ ok: false, error: 'Category already exists' });
  stmts.insertCategory.run({
    id, tenant_id: req.tenant.id, name, color: color || '#7a7a7a',
    shape: shape || 'circle', icon: null, sort_order: 999
  });
  res.json({ ok: true, category: { id, name, color: color || '#7a7a7a', shape: shape || 'circle', count: 0 } });
});

router.put('/api/categories/:id', requireTenantAdmin, (req, res) => {
  const existing = stmts.getCategory.get(req.params.id, req.tenant.id);
  if (!existing) return res.status(404).json({ ok: false, error: 'Not found' });
  const { name, color, shape } = req.body;
  stmts.updateCategory.run({
    id: req.params.id, tenant_id: req.tenant.id,
    name: name ?? existing.name, color: color ?? existing.color, shape: shape ?? existing.shape
  });
  res.json({ ok: true, category: { id: req.params.id, name: name ?? existing.name, color: color ?? existing.color, shape: shape ?? existing.shape } });
});

router.delete('/api/categories/:id', requireTenantAdmin, (req, res) => {
  const cnt = stmts.countLocationsByCategory.get(req.params.id, req.tenant.id).cnt;
  if (cnt > 0) return res.status(400).json({ ok: false, error: `Used by ${cnt} location(s)` });
  const result = stmts.deleteCategory.run(req.params.id, req.tenant.id);
  if (result.changes === 0) return res.status(404).json({ ok: false, error: 'Not found' });
  res.json({ ok: true });
});

// ── Pending edits queue ─────────────────────────────────────────────────────

router.get('/api/admin/pending', requireTenantAdmin, (req, res) => {
  const edits = stmts.getPendingEditsByTenant.all(req.tenant.id).map(e => {
    const loc = stmts.getLocation.get(e.location_id, req.tenant.id);
    const vendor = e.vendor_id ? stmts.getVendorById.get(e.vendor_id) : null;
    return {
      id: e.id,
      locationId: e.location_id,
      locationName: loc?.name || 'Unknown',
      vendorName: vendor?.name || 'Unknown',
      vendorEmail: vendor?.email || '',
      changes: JSON.parse(e.changes || '{}'),
      submittedAt: e.submitted_at,
      status: e.status
    };
  });
  res.json({ ok: true, pending: edits });
});

router.post('/api/admin/pending/:id/approve', requireTenantAdmin, (req, res) => {
  const edit = stmts.getPendingEditById.get(req.params.id);
  if (!edit || edit.tenant_id !== req.tenant.id) return res.status(404).json({ ok: false, error: 'Not found' });
  if (edit.status !== 'pending') return res.status(400).json({ ok: false, error: 'Already processed' });

  const changes = JSON.parse(edit.changes || '{}');
  const loc = stmts.getLocation.get(edit.location_id, req.tenant.id);
  if (loc) {
    // Merge changes
    const updated = {
      id: loc.id, tenant_id: loc.tenant_id,
      vendor_id: loc.vendor_id,
      name: changes.name ?? loc.name,
      description: changes.description ?? loc.description,
      lat: changes.lat ?? loc.lat,
      lng: changes.lng ?? loc.lng,
      category_id: changes.categoryId ?? loc.category_id,
      category_name: changes.categoryName ?? loc.category_name,
      tier: loc.tier,
      photos: changes.photos ? JSON.stringify(changes.photos) : loc.photos,
      logo_url: changes.logoUrl ?? loc.logo_url,
      video_url: changes.videoUrl ?? loc.video_url,
      website_url: changes.websiteUrl ?? loc.website_url,
      social_links: changes.socialLinks ? JSON.stringify(changes.socialLinks) : loc.social_links,
      approval_status: 'live',
      pending_edits: null
    };
    stmts.updateLocation.run(updated);
  }

  stmts.updatePendingEditStatus.run({
    id: edit.id, status: 'approved',
    reviewed_by: req.session.user.email || 'admin',
    reviewed_at: new Date().toISOString(),
    review_note: req.body.note || ''
  });
  res.json({ ok: true });
});

router.post('/api/admin/pending/:id/reject', requireTenantAdmin, (req, res) => {
  const edit = stmts.getPendingEditById.get(req.params.id);
  if (!edit || edit.tenant_id !== req.tenant.id) return res.status(404).json({ ok: false, error: 'Not found' });
  if (edit.status !== 'pending') return res.status(400).json({ ok: false, error: 'Already processed' });

  stmts.updatePendingEditStatus.run({
    id: edit.id, status: 'rejected',
    reviewed_by: req.session.user.email || 'admin',
    reviewed_at: new Date().toISOString(),
    review_note: req.body.note || ''
  });
  res.json({ ok: true });
});

// ── Vendor list (for tenant admin) ──────────────────────────────────────────

router.get('/api/admin/vendors', requireTenantAdmin, (req, res) => {
  const vendors = stmts.getVendorsByTenant.all(req.tenant.id).map(v => ({
    id: v.id, email: v.email, name: v.name, plan: v.plan,
    billingCycle: v.billing_cycle, billingStatus: v.billing_status,
    renewalDate: v.renewal_date, status: v.status, locationId: v.location_id,
    createdAt: v.created_at
  }));
  res.json({ ok: true, vendors });
});

// ── Settings ────────────────────────────────────────────────────────────────

router.get('/api/admin/settings', requireTenantAdmin, (req, res) => {
  const tenant = req.tenant;
  const settings = JSON.parse(tenant.settings || '{}');
  res.json({ ok: true, settings, tenantName: tenant.name, ownerEmail: tenant.owner_email });
});

router.put('/api/admin/settings', requireTenantAdmin, (req, res) => {
  const tenant = req.tenant;
  const current = JSON.parse(tenant.settings || '{}');
  const updated = { ...current, ...req.body.settings };
  db.prepare('UPDATE tenants SET settings = ?, name = ? WHERE id = ?').run(
    JSON.stringify(updated),
    req.body.tenantName || tenant.name,
    tenant.id
  );
  res.json({ ok: true });
});

// ── Import ──────────────────────────────────────────────────────────────────

router.post('/api/import-locations', requireTenantAdmin, (req, res) => {
  const { locations, categories, merge } = req.body;
  const tid = req.tenant.id;

  if (categories?.length) {
    // Delete existing and re-insert
    if (!merge) db.prepare('DELETE FROM categories WHERE tenant_id = ?').run(tid);
    for (let i = 0; i < categories.length; i++) {
      const c = categories[i];
      const existing = stmts.getCategory.get(c.id, tid);
      if (existing) {
        stmts.updateCategory.run({ id: c.id, tenant_id: tid, name: c.name, color: c.color || '#7a7a7a', shape: c.shape || 'circle' });
      } else {
        stmts.insertCategory.run({ id: c.id, tenant_id: tid, name: c.name, color: c.color || '#7a7a7a', shape: c.shape || 'circle', icon: c.icon || null, sort_order: i });
      }
    }
  }

  if (locations?.length) {
    if (!merge) db.prepare('DELETE FROM locations WHERE tenant_id = ?').run(tid);
    const batch = db.transaction((locs) => {
      for (const loc of locs) {
        const existing = stmts.getLocation.get(String(loc.id), tid);
        if (existing && merge) {
          stmts.updateLocation.run({
            id: String(loc.id), tenant_id: tid,
            vendor_id: existing.vendor_id,
            name: loc.name || existing.name,
            description: loc.description || existing.description,
            lat: loc.lat ?? existing.lat, lng: loc.lng ?? existing.lng,
            category_id: loc.categoryId || existing.category_id,
            category_name: loc.categoryName || existing.category_name,
            tier: existing.tier, photos: JSON.stringify(loc.images || loc.photos || JSON.parse(existing.photos || '[]')),
            logo_url: loc.logoUrl ?? existing.logo_url, video_url: loc.videoUrl ?? existing.video_url,
            website_url: loc.websiteUrl ?? existing.website_url,
            social_links: JSON.stringify(loc.socialLinks || JSON.parse(existing.social_links || '{}')),
            approval_status: existing.approval_status, pending_edits: existing.pending_edits
          });
        } else {
          stmts.insertLocation.run({
            id: String(loc.id), tenant_id: tid, vendor_id: null,
            name: loc.name || '', description: loc.description || '',
            lat: loc.lat || 0, lng: loc.lng || 0,
            category_id: loc.categoryId || '', category_name: loc.categoryName || '',
            tier: 'free', photos: JSON.stringify(loc.images || loc.photos || []),
            logo_url: loc.logoUrl || null, video_url: loc.videoUrl || null,
            website_url: loc.websiteUrl || null, social_links: JSON.stringify(loc.socialLinks || {}),
            approval_status: 'live'
          });
        }
      }
    });
    batch(locations);
  }

  const count = stmts.countLocationsByTenant.get(tid).cnt;
  res.json({ ok: true, count });
});

// ── HTML pages ──────────────────────────────────────────────────────────────

router.get('/admin', (req, res) => {
  if (!req.session?.user || (req.session.user.role !== 'tenant_admin' && req.session.user.role !== 'platform_admin')) {
    return res.redirect('/login');
  }
  res.sendFile(path.join(ROOT, 'admin.html'));
});

router.get('/login', (req, res) => {
  if (req.session?.user) {
    if (req.session.user.role === 'vendor') return res.redirect('/vendors/dashboard');
    if (req.session.user.role === 'tenant_admin') return res.redirect('/admin');
  }
  res.sendFile(path.join(ROOT, 'public', 'vendor-login.html'));
});

module.exports = router;
