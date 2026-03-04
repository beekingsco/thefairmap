'use strict';

const express = require('express');
const bcrypt = require('bcryptjs');
const { db, stmts, uuid } = require('../db');

const router = express.Router();

// Login rate limiting
const loginAttempts = new Map();
function checkRateLimit(ip) {
  const now = Date.now();
  const rec = loginAttempts.get(ip) || { count: 0, resetAt: now + 15 * 60 * 1000 };
  if (now > rec.resetAt) { rec.count = 0; rec.resetAt = now + 15 * 60 * 1000; }
  rec.count++;
  loginAttempts.set(ip, rec);
  return rec.count > 10;
}

// ── Platform admin login ────────────────────────────────────────────────────

router.post('/api/platform/login', (req, res) => {
  if (checkRateLimit(req.ip)) {
    return res.status(429).json({ ok: false, error: 'Too many attempts. Wait 15 minutes.' });
  }
  const { email, password } = req.body;
  const adminEmail = process.env.PLATFORM_ADMIN_EMAIL || 'chris@beekings.com';
  const adminPass = process.env.PLATFORM_ADMIN_PASS || 'fairmap2026';

  if (email !== adminEmail || password !== adminPass) {
    return res.status(401).json({ ok: false, error: 'Invalid credentials' });
  }

  req.session.platformAdmin = true;
  req.session.user = { role: 'platform_admin', email: adminEmail };
  res.json({ ok: true });
});

// ── Tenant owner login ──────────────────────────────────────────────────────

router.post('/api/login', (req, res) => {
  if (checkRateLimit(req.ip)) {
    return res.status(429).json({ ok: false, error: 'Too many attempts. Wait 15 minutes.' });
  }
  const { email, password } = req.body;
  const tenant = req.tenant;
  if (!tenant) return res.status(400).json({ ok: false, error: 'No tenant context' });

  // Check tenant owner
  if (email === tenant.owner_email && tenant.owner_password) {
    if (bcrypt.compareSync(password, tenant.owner_password)) {
      req.session.user = {
        role: 'tenant_admin',
        tenantId: tenant.id,
        email: tenant.owner_email,
        name: tenant.owner_name
      };
      return res.json({ ok: true, redirect: '/admin' });
    }
  }

  // Check vendor
  const vendor = stmts.getVendorByEmail.get(email, tenant.id);
  if (vendor && vendor.password && bcrypt.compareSync(password, vendor.password)) {
    req.session.user = {
      role: 'vendor',
      tenantId: tenant.id,
      vendorId: vendor.id,
      email: vendor.email,
      name: vendor.name
    };
    return res.json({ ok: true, redirect: '/vendors/dashboard' });
  }

  res.status(401).json({ ok: false, error: 'Invalid credentials' });
});

// ── Logout ──────────────────────────────────────────────────────────────────

router.post('/api/logout', (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

// ── Current user ────────────────────────────────────────────────────────────

router.get('/api/me', (req, res) => {
  if (!req.session?.user) return res.status(401).json({ ok: false });
  res.json({ ok: true, user: req.session.user });
});

// ── Change password ─────────────────────────────────────────────────────────

router.post('/api/change-password', (req, res) => {
  if (!req.session?.user) return res.status(401).json({ ok: false, error: 'Not authenticated' });
  const { oldPassword, newPassword } = req.body;
  if (!oldPassword || !newPassword) return res.status(400).json({ ok: false, error: 'Both passwords required' });
  if (newPassword.length < 6) return res.status(400).json({ ok: false, error: 'Min 6 characters' });

  const user = req.session.user;

  if (user.role === 'tenant_admin') {
    const tenant = stmts.getTenantById.get(user.tenantId);
    if (!tenant || !bcrypt.compareSync(oldPassword, tenant.owner_password)) {
      return res.status(401).json({ ok: false, error: 'Current password incorrect' });
    }
    db.prepare('UPDATE tenants SET owner_password = ? WHERE id = ?').run(bcrypt.hashSync(newPassword, 10), tenant.id);
    return res.json({ ok: true });
  }

  if (user.role === 'vendor') {
    const vendor = stmts.getVendorById.get(user.vendorId);
    if (!vendor || !bcrypt.compareSync(oldPassword, vendor.password)) {
      return res.status(401).json({ ok: false, error: 'Current password incorrect' });
    }
    stmts.updateVendorPassword.run(bcrypt.hashSync(newPassword, 10), vendor.id);
    return res.json({ ok: true });
  }

  res.status(400).json({ ok: false, error: 'Cannot change password for this account type' });
});

module.exports = router;
