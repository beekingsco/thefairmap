'use strict';

const fs = require('fs');
const path = require('path');

const DEFAULT_ROOT = path.join(__dirname, '..');

function createMapExport(root = DEFAULT_ROOT) {
  const dataDir = path.join(root, 'data');
  const pubDir = path.join(root, 'pub');
  const canonicalFile = path.join(dataDir, 'mapme-full-export.json');
  const seedFile = path.join(dataDir, 'locations.json');
  const pubFile = path.join(pubDir, 'full-export.json');

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

  function loadExport() {
    return readJsonIfExists(pubFile)
      || readJsonIfExists(canonicalFile)
      || readJsonIfExists(seedFile)
      || emptyExport();
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

    const catId = next.categoryId;
    if (catId) {
      const cat = data.categories.find((c) => c.id === catId);
      if (cat) cat.count = data.locations.filter((loc) => loc.categoryId === catId).length;
    }

    ensureExportFiles();
    saveExport(data);
    return next;
  }

  return {
    paths: { root, dataDir, pubDir, canonicalFile, seedFile, pubFile },
    loadExport,
    saveExport,
    ensureExportFiles,
    upsertLocation
  };
}

const defaultStore = createMapExport();

module.exports = {
  createMapExport,
  loadExport: defaultStore.loadExport,
  saveExport: defaultStore.saveExport,
  ensureExportFiles: defaultStore.ensureExportFiles,
  upsertLocation: defaultStore.upsertLocation,
  paths: defaultStore.paths
};
