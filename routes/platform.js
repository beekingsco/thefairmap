'use strict';

const express = require('express');
const bcrypt = require('bcryptjs');
const path = require('path');
const { db, stmts, uuid } = require('../db');

const router = express.Router();
const ROOT = path.join(__dirname, '..');

function requirePlatformAdmin(req, res, next) {
  if (req.session?.platformAdmin || req.session?.user?.role === 'platform_admin') return next();
  if (req.xhr || req.headers.accept?.includes('application/json')) {
    return res.status(403).json({ ok: false, error: 'Platform admin only' });
  }
  res.redirect('/platform/login');
}

// ── Platform login page ─────────────────────────────────────────────────────

router.get('/platform/login', (req, res) => {
  if (req.session?.platformAdmin) return res.redirect('/platform');
  res.send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Platform Admin — TheFairMap</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: system-ui, sans-serif; background: #f8f9fa; display: flex; align-items: center; justify-content: center; min-height: 100vh; }
    .card { background: #fff; border-radius: 12px; padding: 40px; width: 380px; box-shadow: 0 4px 24px rgba(0,0,0,0.08); }
    h1 { font-size: 20px; margin-bottom: 24px; text-align: center; }
    label { display: block; font-size: 13px; font-weight: 600; margin-bottom: 4px; color: #374151; }
    input { width: 100%; padding: 10px 12px; border: 1px solid #d1d5db; border-radius: 8px; font-size: 14px; margin-bottom: 16px; }
    input:focus { outline: none; border-color: #2563eb; box-shadow: 0 0 0 3px rgba(37,99,235,0.1); }
    button { width: 100%; padding: 12px; background: #1a1f2e; color: #fff; border: none; border-radius: 8px; font-size: 14px; font-weight: 600; cursor: pointer; }
    button:hover { background: #2d3548; }
    .error { color: #ef4444; font-size: 13px; margin-bottom: 12px; display: none; }
  </style>
</head>
<body>
  <div class="card">
    <h1>Platform Admin</h1>
    <div class="error" id="error"></div>
    <form id="form">
      <label>Email</label>
      <input type="email" id="email" required>
      <label>Password</label>
      <input type="password" id="password" required>
      <button type="submit">Sign In</button>
    </form>
  </div>
  <script>
    document.getElementById('form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const err = document.getElementById('error');
      err.style.display = 'none';
      try {
        const res = await fetch('/api/platform/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: document.getElementById('email').value, password: document.getElementById('password').value })
        });
        const data = await res.json();
        if (data.ok) { window.location.href = '/platform'; }
        else { err.textContent = data.error; err.style.display = 'block'; }
      } catch (e) { err.textContent = 'Network error'; err.style.display = 'block'; }
    });
  </script>
</body>
</html>`);
});

// ── Platform dashboard ──────────────────────────────────────────────────────

router.get('/platform', requirePlatformAdmin, (req, res) => {
  res.sendFile(path.join(ROOT, 'public', 'platform.html'));
});

// ── Platform API ────────────────────────────────────────────────────────────

router.get('/api/platform/tenants', requirePlatformAdmin, (req, res) => {
  const tenants = stmts.getAllTenants.all().map(t => {
    const locCount = stmts.countLocationsByTenant.get(t.id).cnt;
    const vendorCount = stmts.countVendorsByTenant.get(t.id).cnt;
    return {
      id: t.id, slug: t.slug, name: t.name,
      ownerEmail: t.owner_email, ownerName: t.owner_name,
      plan: t.plan, status: t.status,
      locationCount: locCount, vendorCount: vendorCount,
      createdAt: t.created_at
    };
  });
  res.json({ ok: true, tenants });
});

router.get('/api/platform/stats', requirePlatformAdmin, (req, res) => {
  const tenantCount = db.prepare('SELECT COUNT(*) as cnt FROM tenants').get().cnt;
  const activeCount = db.prepare("SELECT COUNT(*) as cnt FROM tenants WHERE status = 'active'").get().cnt;
  const vendorCount = db.prepare('SELECT COUNT(*) as cnt FROM vendors').get().cnt;
  const locationCount = db.prepare('SELECT COUNT(*) as cnt FROM locations').get().cnt;

  const vendors = db.prepare("SELECT plan FROM vendors WHERE billing_status = 'active' AND plan != 'free'").all();
  const prices = { basic: 4.99, showoff: 9.99, standout: 19.99 };
  const monthlyRevenue = vendors.reduce((sum, v) => sum + (prices[v.plan] || 0), 0);

  res.json({
    ok: true,
    stats: {
      tenants: tenantCount, active: activeCount,
      vendors: vendorCount, locations: locationCount,
      monthlyRevenue: monthlyRevenue.toFixed(2)
    }
  });
});

// Approve/reject tenant
router.post('/api/platform/tenants/:id/approve', requirePlatformAdmin, (req, res) => {
  const tenant = stmts.getTenantById.get(req.params.id);
  if (!tenant) return res.status(404).json({ ok: false, error: 'Tenant not found' });
  stmts.updateTenantStatus.run('active', tenant.id);
  res.json({ ok: true });
});

router.post('/api/platform/tenants/:id/suspend', requirePlatformAdmin, (req, res) => {
  const tenant = stmts.getTenantById.get(req.params.id);
  if (!tenant) return res.status(404).json({ ok: false, error: 'Tenant not found' });
  stmts.updateTenantStatus.run('suspended', tenant.id);
  res.json({ ok: true });
});

// Create tenant manually
router.post('/api/platform/tenants', requirePlatformAdmin, (req, res) => {
  const { slug, name, ownerEmail, ownerName, ownerPassword } = req.body;
  if (!slug || !name || !ownerEmail) return res.status(400).json({ ok: false, error: 'Slug, name, and email required' });

  const existing = stmts.getTenantBySlug.get(slug);
  if (existing) return res.status(400).json({ ok: false, error: 'Slug already taken' });

  const id = uuid();
  const hashedPw = ownerPassword ? bcrypt.hashSync(ownerPassword, 10) : null;

  stmts.insertTenant.run({
    id, slug, name, owner_email: ownerEmail,
    owner_name: ownerName || '', owner_password: hashedPw,
    plan: 'manual', status: 'active',
    settings: JSON.stringify({ mapCenter: [0, 0], mapZoom: 15, mapPitch: 0 })
  });

  res.json({ ok: true, tenant: { id, slug, name } });
});

// ── Signup (public — creates pending tenant) ────────────────────────────────

router.post('/api/signup', (req, res) => {
  const { name, email, organization, slug, message } = req.body;
  if (!name || !email || !organization || !slug) {
    return res.status(400).json({ ok: false, error: 'All fields required' });
  }

  const cleanSlug = slug.toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 30);
  if (cleanSlug.length < 3) return res.status(400).json({ ok: false, error: 'Slug must be at least 3 characters' });

  const existing = stmts.getTenantBySlug.get(cleanSlug);
  if (existing) return res.status(400).json({ ok: false, error: 'That subdomain is already taken' });

  const id = uuid();
  stmts.insertTenant.run({
    id, slug: cleanSlug, name: organization,
    owner_email: email, owner_name: name,
    owner_password: null,
    plan: 'manual', status: 'pending',
    settings: JSON.stringify({ message: message || '' })
  });

  // Send notification email to platform admin
  try {
    const { sendSignupNotification } = require('../email');
    sendSignupNotification(organization, email, cleanSlug);
  } catch (e) { /* email module may not be configured */ }

  res.json({ ok: true });
});

module.exports = router;
