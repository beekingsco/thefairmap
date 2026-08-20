'use strict';

const fs = require('fs');
const path = require('path');

const DEFAULT_ROOT = path.join(__dirname, '..');

function createMapExport(root = DEFAULT_ROOT) {
  const dataDir = path.join(root, 'data');
  const pubDir = path.join(root, 'pub');
  const publicDataDir = path.join(root, 'public', 'data');
  const canonicalFile = path.join(dataDir, 'mapme-full-export.json');
  const seedFile = path.join(dataDir, 'locations.json');
  const pubFile = path.join(pubDir, 'full-export.json');
  const publicFile = path.join(publicDataDir, 'mapme-full-export.json');

  function readJsonIfExists(file) {
    try {
      return JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch (err) {
      if (err && err.code === 'ENOENT') return null;
      throw err;
    }
  }

  function emptyExport() {
    return { map: {}, categories: [], locations: [] };
  }

  function publishedListingsFile() {
    return path.join(dataDir, 'published-listings.json');
  }

  function loadPublishedListings() {
    const raw = readJsonIfExists(publishedListingsFile());
    if (!raw) return [];
    if (Array.isArray(raw)) return raw;
    return Array.isArray(raw.locations) ? raw.locations : [];
  }

  function mergeLocationList(baseLocations, extras) {
    const locations = Array.isArray(baseLocations) ? baseLocations.slice() : [];
    const byId = new Map(locations.map((loc) => [String(loc.id), loc]));
    for (const loc of extras || []) {
      if (!loc || typeof loc !== 'object' || loc.id == null) continue;
      const id = String(loc.id);
      const prev = byId.get(id);
      const next = prev ? { ...prev, ...loc, id } : { ...loc, id };
      if (prev) {
        locations[locations.findIndex((item) => String(item.id) === id)] = next;
      } else {
        locations.push(next);
      }
      byId.set(id, next);
    }
    return locations;
  }

  function refreshCategoryCounts(data) {
    const locations = Array.isArray(data.locations) ? data.locations : [];
    data.categories = Array.isArray(data.categories) ? data.categories : [];
    for (const cat of data.categories) {
      if (!cat || !cat.id) continue;
      cat.count = locations.filter((loc) => loc.categoryId === cat.id).length;
    }
    return data;
  }

  function applyPublishedListings(data) {
    const extras = loadPublishedListings();
    if (!extras.length) return data;
    data.locations = mergeLocationList(data.locations, extras);
    return refreshCategoryCounts(data);
  }

  function loadExport() {
    const raw = readJsonIfExists(pubFile)
      || readJsonIfExists(canonicalFile)
      || readJsonIfExists(seedFile)
      || emptyExport();
    return applyPublishedListings(raw);
  }

  function resolveWriteTarget(file) {
    try {
      if (fs.lstatSync(file).isSymbolicLink()) {
        return path.resolve(path.dirname(file), fs.readlinkSync(file));
      }
    } catch (err) {
      if (!err || err.code !== 'ENOENT') throw err;
    }
    return file;
  }

  function writeJson(file, data) {
    const target = resolveWriteTarget(file);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    const payload = JSON.stringify(data, null, 2);
    const tmp = target + '.tmp';
    fs.writeFileSync(tmp, payload, 'utf8');
    fs.renameSync(tmp, target);
  }

  function saveExport(data) {
    writeJson(canonicalFile, data);
    writeJson(seedFile, data);
    writeJson(pubFile, data);
    writeJson(publicFile, data);
    return pubFile;
  }

  function ensureExportFiles() {
    const data = loadExport();
    fs.mkdirSync(pubDir, { recursive: true });
    fs.mkdirSync(dataDir, { recursive: true });

    if (!fs.existsSync(canonicalFile) && (data.locations || []).length) {
      writeJson(canonicalFile, data);
    }
    if (!fs.existsSync(seedFile) && (data.locations || []).length) {
      writeJson(seedFile, data);
    }
    if (!fs.existsSync(pubFile)) {
      if (fs.existsSync(canonicalFile)) {
        try {
          fs.copyFileSync(canonicalFile, pubFile);
        } catch (err) {
          if (err && err.code !== 'ENOENT') throw err;
          writeJson(pubFile, data);
        }
      } else {
        writeJson(pubFile, data);
      }
    }
    if (!fs.existsSync(publicFile) && (data.locations || []).length) {
      writeJson(publicFile, data);
    }
    return pubFile;
  }

  function upsertLocation(location) {
    if (!location || typeof location !== 'object') {
      throw new Error('location is required');
    }
    const data = loadExport();
    data.locations = Array.isArray(data.locations) ? data.locations : [];
    data.categories = Array.isArray(data.categories) ? data.categories : [];

    const id = String(location.id || `loc-${Date.now()}`);
    const next = { ...location, id };
    const idx = data.locations.findIndex((loc) => String(loc.id) === id);
    if (idx >= 0) data.locations[idx] = { ...data.locations[idx], ...next };
    else data.locations.push(next);

    refreshCategoryCounts(data);
    ensureExportFiles();
    saveExport(data);
    return next;
  }

  function publishListedLocations() {
    const extras = loadPublishedListings();
    let last = null;
    for (const loc of extras) {
      last = upsertLocation(loc);
    }
    return { count: extras.length, last };
  }

  return {
    paths: { root, dataDir, pubDir, publicDataDir, canonicalFile, seedFile, pubFile, publicFile, publishedFile: publishedListingsFile() },
    loadExport,
    saveExport,
    ensureExportFiles,
    upsertLocation,
    loadPublishedListings,
    mergeLocationList,
    applyPublishedListings,
    publishListedLocations
  };
}

const defaultStore = createMapExport();

module.exports = {
  createMapExport,
  loadExport: defaultStore.loadExport,
  saveExport: defaultStore.saveExport,
  ensureExportFiles: defaultStore.ensureExportFiles,
  upsertLocation: defaultStore.upsertLocation,
  loadPublishedListings: defaultStore.loadPublishedListings,
  mergeLocationList: defaultStore.mergeLocationList,
  applyPublishedListings: defaultStore.applyPublishedListings,
  publishListedLocations: defaultStore.publishListedLocations,
  paths: defaultStore.paths
};
