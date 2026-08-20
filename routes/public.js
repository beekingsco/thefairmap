'use strict';

const express = require('express');
const path = require('path');
const { db, stmts } = require('../db');

const router = express.Router();
const ROOT = path.join(__dirname, '..');

// ── Public map API (tenant-scoped) ──────────────────────────────────────────

router.get('/api/locations', (req, res) => {
  const tenant = req.tenant;
  if (!tenant) return res.status(400).json({ ok: false, error: 'No tenant context' });

  const locations = stmts.getLocationsByTenant.all(tenant.id).map(loc => ({
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

  const categories = stmts.getCategoriesByTenant.all(tenant.id).map(c => ({
    id: c.id,
    name: c.name,
    color: c.color,
    shape: c.shape,
    icon: c.icon,
    count: locations.filter(l => l.categoryId === c.id).length
  }));

  const settings = JSON.parse(tenant.settings || '{}');

  res.json({
    map: {
      name: tenant.name,
      center: settings.mapCenter || [-95.8624, 32.5585],
      zoom: settings.mapZoom || 17,
      maxZoom: 20,
      pitch: settings.mapPitch || 60,
      bearing: 0,
      style: 'maptiler'
    },
    categories,
    locations
  });
});

// ── Categories API (public read) ────────────────────────────────────────────

router.get('/api/categories', (req, res) => {
  const tenant = req.tenant;
  if (!tenant) return res.status(400).json({ ok: false, error: 'No tenant context' });

  const locations = stmts.getLocationsByTenant.all(tenant.id);
  const categories = stmts.getCategoriesByTenant.all(tenant.id).map(c => ({
    id: c.id,
    name: c.name,
    color: c.color,
    shape: c.shape,
    icon: c.icon,
    count: locations.filter(l => l.category_id === c.id).length
  }));

  res.json({ ok: true, categories });
});

// ── Tenant info (public) ───────────────────────────────────────────────────

router.get('/api/tenant-info', (req, res) => {
  const tenant = req.tenant;
  if (!tenant) return res.status(400).json({ ok: false, error: 'No tenant context' });

  const settings = JSON.parse(tenant.settings || '{}');
  res.json({
    ok: true,
    tenant: {
      name: tenant.name,
      slug: tenant.slug,
      primaryColor: settings.primaryColor || '#2f3d4d',
      logoUrl: settings.logoUrl || null
    }
  });
});

// ── HTML pages ──────────────────────────────────────────────────────────────

router.get('/map', (req, res) => {
  res.sendFile(path.join(ROOT, 'public', 'map.html'));
});

// Tenant root shows the map
router.get('/', (req, res) => {
  if (req.tenant) {
    return res.sendFile(path.join(ROOT, 'public', 'map.html'));
  }
  // No tenant — marketing page
  res.sendFile(path.join(ROOT, 'public', 'index.html'));
});

module.exports = router;
