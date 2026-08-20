#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createMapExport } = require('../lib/map-export');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'map-export-'));
const fixture = {
  map: { name: 'First Monday Trade Days' },
  categories: [{ id: 'home', name: 'Home', color: '#0b5c59ff', count: 0 }],
  locations: []
};

fs.mkdirSync(path.join(tmp, 'data'), { recursive: true });
fs.writeFileSync(
  path.join(tmp, 'data', 'mapme-full-export.json'),
  JSON.stringify(fixture, null, 2)
);
fs.writeFileSync(
  path.join(tmp, 'data', 'locations.json'),
  JSON.stringify(fixture, null, 2)
);

const store = createMapExport(tmp);
const pubFile = path.join(tmp, 'pub', 'full-export.json');

assert.strictEqual(fs.existsSync(path.join(tmp, 'pub')), false, 'pub/ must start missing');

const loaded = store.loadExport();
assert.strictEqual(loaded.map.name, 'First Monday Trade Days');
assert.strictEqual(loaded.locations.length, 0);

store.ensureExportFiles();
assert.ok(fs.existsSync(pubFile), 'ensureExportFiles must create pub/full-export.json');
assert.doesNotThrow(() => fs.readFileSync(pubFile, 'utf8'));

const added = store.upsertLocation({
  id: 'rowe-farms',
  name: 'Rowe Farms',
  description: '<strong>Pavilion 4500: Booth 4505</strong>',
  address: 'Pavilion 4500, Booth 4505',
  lat: 32.5660368,
  lng: -95.86080677,
  categoryId: 'home',
  categoryName: 'Home'
});
assert.strictEqual(added.name, 'Rowe Farms');

const afterWrite = JSON.parse(fs.readFileSync(pubFile, 'utf8'));
assert.ok(afterWrite.locations.some((loc) => loc.name === 'Rowe Farms'));
assert.strictEqual(
  afterWrite.categories.find((cat) => cat.id === 'home').count,
  1
);

fs.rmSync(path.join(tmp, 'pub'), { recursive: true, force: true });
assert.strictEqual(fs.existsSync(pubFile), false);
store.saveExport(afterWrite);
assert.ok(fs.existsSync(pubFile), 'saveExport must mkdir pub/ and write the file');
assert.doesNotThrow(() => fs.readFileSync(pubFile, 'utf8'));

fs.writeFileSync(
  path.join(tmp, 'data', 'published-listings.json'),
  JSON.stringify({
    locations: [{
      id: 'rowe-farms',
      name: 'Rowe Farms',
      booth: '4505',
      photos: ['/uploads/rowe-farms-1.jpg']
    }]
  }, null, 2)
);
const overlayStore = createMapExport(tmp);
const overlayLoaded = overlayStore.loadExport();
const overlayRowe = overlayLoaded.locations.find((loc) => loc.id === 'rowe-farms');
assert.ok(overlayRowe, 'loadExport must merge data/published-listings.json');
assert.strictEqual(overlayRowe.booth, '4505');
assert.deepStrictEqual(overlayRowe.photos, ['/uploads/rowe-farms-1.jpg']);

overlayStore.publishListedLocations();
const persisted = JSON.parse(fs.readFileSync(path.join(tmp, 'data', 'mapme-full-export.json'), 'utf8'));
assert.ok(persisted.locations.some((loc) => loc.id === 'rowe-farms' && loc.photos[0] === '/uploads/rowe-farms-1.jpg'));

fs.rmSync(tmp, { recursive: true, force: true });
console.log('test-map-export: ok');
