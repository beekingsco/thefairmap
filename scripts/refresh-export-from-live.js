#!/usr/bin/env node
'use strict';

const { saveExport, publishListedLocations, loadExport } = require('../lib/map-export');

const EXPORT_URL = process.env.SHOPPER_EXPORT_URL
  || 'https://www.visitfirstmonday.com/data/mapme-full-export.json';
const API_URL = process.env.SHOPPER_API_URL
  || 'https://www.visitfirstmonday.com/api/locations?tenant=firstmonday';

function photoCount(loc) {
  const photos = Array.isArray(loc?.photos) ? loc.photos : [];
  const images = Array.isArray(loc?.images) ? loc.images : [];
  return photos.length + images.length;
}

async function readJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url} → ${res.status}`);
  return res.json();
}

function mergeLiveSources(exported, apiData) {
  const byId = new Map((exported.locations || []).map((loc) => [String(loc.id), loc]));
  for (const loc of apiData.locations || []) {
    const id = String(loc.id);
    const prev = byId.get(id);
    if (!prev) {
      byId.set(id, loc);
      continue;
    }
    if (photoCount(loc) > photoCount(prev)) {
      byId.set(id, {
        ...prev,
        photos: loc.photos || prev.photos,
        images: loc.images || prev.images,
        logoUrl: loc.logoUrl || prev.logoUrl
      });
    }
  }
  exported.locations = [...byId.values()];
  return exported;
}

(async () => {
  const exported = await readJson(EXPORT_URL);
  let apiData = { locations: [] };
  try {
    apiData = await readJson(API_URL);
  } catch (err) {
    console.warn('Live /api/locations unavailable, using export only:', err.message);
  }

  const merged = mergeLiveSources(exported, apiData);
  saveExport(merged);
  publishListedLocations();
  const data = loadExport();
  const rowe = (data.locations || []).find((loc) => loc.name === 'Rowe Farms');
  console.log(`Refreshed shopper export from ${EXPORT_URL}`);
  console.log(`locations=${data.locations.length} categories=${data.categories.length} rowe=${rowe ? 'yes' : 'NO'}`);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
