#!/usr/bin/env node
'use strict';

const { publishListedLocations, loadExport, paths } = require('../lib/map-export');

const result = publishListedLocations();
const data = loadExport();
const rowe = (data.locations || []).find((loc) => loc.id === 'rowe-farms-4505' || loc.name === 'Rowe Farms');

console.log(`Applied ${result.count} published listing(s) to:`);
console.log(`  ${paths.canonicalFile}`);
console.log(`  ${paths.seedFile}`);
console.log(`  ${paths.pubFile}`);
if (rowe) {
  console.log(`Rowe Farms id=${rowe.id} booth=${rowe.booth || ''} category=${rowe.categoryName} lat=${rowe.lat} lng=${rowe.lng} photos=${(rowe.photos || []).length}`);
} else {
  console.warn('Rowe Farms was not present after publish.');
  process.exitCode = 1;
}
