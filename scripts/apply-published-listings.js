#!/usr/bin/env node
'use strict';

const { publishListedLocations, loadExport, paths } = require('../lib/map-export');

const result = publishListedLocations();
const data = loadExport();
const rowe = (data.locations || []).find((loc) => loc.id === 'rowe-farms-4505' || loc.name === 'Rowe Farms');
const rae = (data.locations || []).find((loc) => loc.id === '64592d71-7a78-43cd-8ea8-0d5ce152c47e' || /rae\s*sterling/i.test(loc.name || ''));
const teak = (data.locations || []).find((loc) => loc.id === '98933c18-defa-4333-be8e-6de416070ea4');
const acorn = (data.locations || []).find((loc) => loc.id === '4e0c4de9-e7e9-4ce5-929f-842f73538dc6' || /acorn\s*game\s*parlor/i.test(loc.name || ''));
const beeKing = (data.locations || []).find((loc) => loc.id === '758aad31-099f-4ece-bee7-4b22eb202334');

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
if (rae) {
  console.log(`Rae Sterling id=${rae.id} booth=${rae.booth || ''} lat=${rae.lat} lng=${rae.lng} hidden=${Boolean(rae.hidden)}`);
} else {
  console.warn('Rae Sterling was not present after publish.');
  process.exitCode = 1;
}
if (teak) {
  console.log(`Teak 22 id=${teak.id} hidden=${Boolean(teak.hidden)} (leftover 361-364 icon)`);
}
if (acorn) {
  console.log(`Acorn Game Parlor id=${acorn.id} booth=${acorn.booth || ''} category=${acorn.categoryName} lat=${acorn.lat} lng=${acorn.lng} hidden=${Boolean(acorn.hidden)}`);
} else {
  console.warn('Acorn Game Parlor was not present after publish.');
  process.exitCode = 1;
}
if (beeKing) {
  console.log(`Bee King’s Honey id=${beeKing.id} address=${beeKing.address} lat=${beeKing.lat} lng=${beeKing.lng} hidden=${Boolean(beeKing.hidden)} (left unchanged)`);
}
