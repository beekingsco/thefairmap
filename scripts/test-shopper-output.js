#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const root = path.join(__dirname, '..');
const publicDir = path.join(root, 'public');
const vercel = JSON.parse(fs.readFileSync(path.join(root, 'vercel.json'), 'utf8'));

assert.strictEqual(vercel.framework, null, 'framework must be null so Vercel does not treat this as Express-only');
assert.strictEqual(vercel.outputDirectory, 'public', 'Git deploys must publish public/, matching the live CLI artifact');
assert.ok(vercel.buildCommand && vercel.buildCommand.includes('prepare-vercel-shopper'), 'build must stage shopper files into public/');

function hasRewrite(source, dest) {
  return (vercel.rewrites || []).some((rule) => rule.source === source && rule.destination === dest);
}

assert.ok(hasRewrite('/first-monday-finder', '/first-monday-finder.html'), 'missing /first-monday-finder rewrite');
assert.ok(hasRewrite('/api/locations', '/data/mapme-full-export.json'), 'missing /api/locations rewrite');
assert.ok(hasRewrite('/embed', '/embed.html'), 'missing /embed rewrite');

const requiredFiles = [
  'first-monday-finder.html',
  'embed.html',
  'map.html',
  'map.js',
  'style.css',
  'maplibre-gl.js',
  'maplibre-gl.css',
  path.join('data', 'mapme-full-export.json'),
  path.join('data', 'icons', 'first-monday-finder-logo.png')
];
for (const rel of requiredFiles) {
  const full = path.join(publicDir, rel);
  assert.ok(fs.existsSync(full), `Vercel output missing ${rel}`);
}

const finder = fs.readFileSync(path.join(publicDir, 'first-monday-finder.html'), 'utf8');
assert.ok(finder.includes('First Monday Finder'));
assert.ok(finder.includes('/embed.html'));

const embed = fs.readFileSync(path.join(publicDir, 'embed.html'), 'utf8');
assert.ok(embed.includes('/map.html'), 'embed.html must hand off to the shopper map SPA');

const data = JSON.parse(fs.readFileSync(path.join(publicDir, 'data', 'mapme-full-export.json'), 'utf8'));
assert.ok(Array.isArray(data.locations));
assert.strictEqual(data.locations.length, 711, `expected 711 locations, got ${data.locations.length}`);
assert.strictEqual((data.categories || []).length, 68, 'category catalog must stay intact');
assert.ok(data.locations.every((loc) => Number.isFinite(loc.lat) && Number.isFinite(loc.lng)), 'every listing must keep GPS coordinates');

const mapJs = fs.readFileSync(path.join(publicDir, 'map.js'), 'utf8');
assert.match(mapJs, /const DEFAULT_PITCH = 0/, 'shopper default pitch must be 0');
assert.match(mapJs, /function flattenShopperMap/, 'must hide 3D buildings / terrain');
assert.match(mapJs, /cluster:\s*false/, 'vendor pins must not cluster into one pile');
assert.match(mapJs, /maxPitch:\s*85/, 'two-finger and desktop pitch must be allowed');
assert.doesNotMatch(mapJs, /maxPitch:\s*0/, 'maxPitch 0 locks MapLibre tilt');
assert.match(mapJs, /touchPitch/, 'must enable two-finger pitch');
assert.match(mapJs, /fill-extrusion/, 'must hide 3D building extrusions');
assert.match(mapJs, /setTerrain\(null\)/, 'must keep 3D terrain disabled');
const flattenFn = mapJs.match(/function flattenShopperMap\(\) \{[\s\S]*?\n\}/);
assert.ok(flattenFn, 'flattenShopperMap body must be present');
assert.doesNotMatch(flattenFn[0], /setPitch\(0\)/, 'flatten must not slam pitch after the user can tilt');
assert.doesNotMatch(mapJs, /setTerrain\(\{\s*source:/, 'must not enable 3D terrain on the shopper map');
assert.doesNotMatch(mapJs, /beeKings\?\.pitch/, 'must not inherit Bee King 3D booth pitch');
assert.match(mapJs, /\/api\/tile\?z=\{z\}&x=\{x\}&y=\{y\}/, 'venue overlay must use the working /api/tile proxy');
assert.doesNotMatch(mapJs, /\/api\/mt\?path=tiles\//, 'venue overlay must not request /api/mt tiles (404s on production)');
assert.ok(hasRewrite('/api/tile', '/api/tile'), 'Vercel must keep /api/tile on the local tile proxy');
const garden = (data.categories || []).find((cat) => cat.id === '5dd4803e-9cff-4d80-99a1-98d86ef1c1af');
const plants = (data.categories || []).find((cat) => cat.id === 'b8f1b4b4-9d3e-4c66-96d3-4f1d53e3d4f4');
assert.ok(garden, 'Garden / Patio category must remain');
assert.strictEqual(garden.name, 'Garden / Patio');
assert.strictEqual(garden.count, 26, 'Rowe Farms moves Garden / Patio from 25 to 26');
assert.strictEqual(plants && plants.count, 0, 'unused Plants category must stay empty');

const jt = data.locations.find((loc) => loc.id === 'abcefc40-da73-4346-8105-47d847c24a68');
assert.ok(jt, 'JT Jewelry pin must remain');
assert.strictEqual(jt.name, 'JT Jewelry');
assert.strictEqual(jt.lat, 32.56605027);
assert.strictEqual(jt.lng, -95.86080482);
assert.strictEqual(jt.categoryName, 'Jewelry / Watches');
assert.ok(String(jt.description || '').includes('PV45-4504-4505'));

const rowe = data.locations.find((loc) => loc.id === 'rowe-farms-4505');
assert.ok(rowe, 'Rowe Farms must be a new location');
assert.strictEqual(rowe.name, 'Rowe Farms');
assert.strictEqual(String(rowe.booth), '4505');
assert.strictEqual(String(rowe.pavilion), '4500');
assert.strictEqual(rowe.categoryId, '5dd4803e-9cff-4d80-99a1-98d86ef1c1af');
assert.strictEqual(rowe.categoryName, 'Garden / Patio');
assert.notStrictEqual(rowe.categoryId, 'b8f1b4b4-9d3e-4c66-96d3-4f1d53e3d4f4', 'do not use unused Plants category');
assert.strictEqual(rowe.lat, 32.5660368);
assert.strictEqual(rowe.lng, -95.86080677);
assert.notStrictEqual(rowe.id, jt.id, 'Rowe Farms must not reuse the JT Jewelry id');
const rowePhotos = Array.isArray(rowe.photos) ? rowe.photos : [];
assert.strictEqual(rowePhotos.length, 11, 'Rowe Farms must have 11 shopper photos');
assert.deepStrictEqual(rowePhotos, [
  '/uploads/rowe-farms-1.jpg',
  '/uploads/rowe-farms-2.jpg',
  '/uploads/rowe-farms-3.jpg',
  '/uploads/rowe-farms-4.jpg',
  '/uploads/rowe-farms-5.jpg',
  '/uploads/rowe-farms-6.jpg',
  '/uploads/rowe-farms-7.jpg',
  '/uploads/rowe-farms-8.jpg',
  '/uploads/rowe-farms-9.jpg',
  '/uploads/rowe-farms-10.jpg',
  '/uploads/rowe-farms-11.jpg'
]);
for (const rel of rowePhotos) {
  const full = path.join(publicDir, rel.replace(/^\//, ''));
  assert.ok(fs.existsSync(full), `missing shopper photo ${rel}`);
  const magic = fs.readFileSync(full).subarray(0, 3);
  assert.deepStrictEqual(Array.from(magic), [0xff, 0xd8, 0xff], `${rel} must be a JPEG`);
}

const exportPaths = [
  path.join(root, 'data', 'mapme-full-export.json'),
  path.join(publicDir, 'data', 'mapme-full-export.json'),
  path.join(root, 'data', 'locations.json')
];
const exportSnapshots = new Map(
  exportPaths.map((file) => [file, fs.readFileSync(file)])
);

const GATES_CATEGORY_ID = '47008a43-b024-4c2b-aaac-9ea4312521f9';
const iconManifest = JSON.parse(
  fs.readFileSync(path.join(root, 'data', 'icons', 'manifest.json'), 'utf8')
);
const gatesIcon = iconManifest[GATES_CATEGORY_ID];
assert.ok(gatesIcon, 'Gates category must be in the icon manifest');
assert.strictEqual(gatesIcon.name, 'Gates');
assert.strictEqual(gatesIcon.file, 'icons/gates.svg');
assert.strictEqual(gatesIcon.bgColor, '#7d2553');
assert.strictEqual(gatesIcon.fgColor, '#ffffff');

const gatesSvgPath = path.join(root, 'data', 'icons', 'gates.svg');
assert.ok(fs.existsSync(gatesSvgPath), 'missing data/icons/gates.svg');
const gatesSvg = fs.readFileSync(gatesSvgPath, 'utf8');
assert.ok(
  /<svg[^>]*viewBox="0 0 100 100"/i.test(gatesSvg),
  'gates.svg must use the nested MapMe 100×100 artwork wrapper'
);
const innerMatch = gatesSvg.match(/<svg[^>]*viewBox="0 0 100 100"[^>]*>([\s\S]*?)<\/svg>/i);
assert.ok(innerMatch && innerMatch[1].includes('<path'), 'gates.svg must expose inner path art for compositing');

assert.ok(/\bgate:\s+'<path fill="#fff"/.test(mapJs), 'ICON_SVGS must include a gate fallback glyph');
assert.ok(
  /value\.includes\('gate'\)\s*\|\|\s*value\.includes\('entrance'\)\)\s*return 'gate'/.test(mapJs),
  'mapCategoryToIconType must map gate/entrance to gate, not pin'
);

const mapFnStart = mapJs.indexOf('function mapCategoryToIconType');
const mapFnEnd = mapJs.indexOf('\nfunction iconTypeForCategory');
assert.ok(mapFnStart >= 0 && mapFnEnd > mapFnStart, 'mapCategoryToIconType must be extractable');
const mapCategoryToIconType = new Function(`${mapJs.slice(mapFnStart, mapFnEnd)}; return mapCategoryToIconType;`)();
assert.strictEqual(mapCategoryToIconType('Gates'), 'gate');
assert.strictEqual(mapCategoryToIconType('Entrance'), 'gate');
assert.strictEqual(mapCategoryToIconType('East Gate Entrance'), 'gate');
assert.strictEqual(mapCategoryToIconType('Restroom'), 'restroom');
assert.notStrictEqual(mapCategoryToIconType('Gates'), 'pin');

const gatesListings = data.locations.filter((loc) => loc.categoryId === GATES_CATEGORY_ID);
assert.strictEqual(gatesListings.length, 8, 'Gates category must still have 8 listings');
for (const name of ['Historic Main Gate', 'East Gate', 'North Gate', 'Arbors Entrance', 'Pavilion Entrance 1', 'Pavilion Entrance 2']) {
  assert.ok(gatesListings.some((loc) => loc.name === name), `missing Gates listing ${name}`);
}

const mapHtml = fs.readFileSync(path.join(publicDir, 'map.html'), 'utf8');
assert.ok(
  mapHtml.includes('/map.js?v=20260903-rae-sterling'),
  'map.html must cache-bust map.js after the Rae Sterling booth move'
);
assert.ok(
  !mapHtml.includes('/map.js?v=20260825-gate-icons'),
  'Rae Sterling cache-bust must replace the gate-icon tag, not keep both'
);
assert.match(mapJs, /loc\.hidden === true/, 'shopper map must skip hidden leftover icons');

const prepared = spawnSync(process.execPath, [path.join(__dirname, 'prepare-vercel-shopper.js')], {
  cwd: root,
  encoding: 'utf8'
});
assert.strictEqual(prepared.status, 0, prepared.stderr || prepared.stdout);
assert.ok(fs.existsSync(path.join(publicDir, 'data', 'mapme-full-export.json')));
assert.ok(
  fs.existsSync(path.join(publicDir, 'data', 'icons', 'gates.svg')),
  'prepare-vercel-shopper must copy gates.svg into public/data/icons'
);
const publicManifest = JSON.parse(
  fs.readFileSync(path.join(publicDir, 'data', 'icons', 'manifest.json'), 'utf8')
);
assert.deepStrictEqual(publicManifest[GATES_CATEGORY_ID], gatesIcon);

for (const [file, before] of exportSnapshots) {
  const after = fs.readFileSync(file);
  assert.ok(before.equals(after), `${path.relative(root, file)} must stay untouched`);
}

const afterExport = JSON.parse(fs.readFileSync(path.join(publicDir, 'data', 'mapme-full-export.json'), 'utf8'));
assert.strictEqual(afterExport.locations.length, 711);
assert.ok(afterExport.locations.some((loc) => loc.id === 'rowe-farms-4505'), 'Rowe Farms must remain after icon staging');

const RAE_ID = '64592d71-7a78-43cd-8ea8-0d5ce152c47e';
const TEAK_ID = '98933c18-defa-4333-be8e-6de416070ea4';
const rae = data.locations.find((loc) => loc.id === RAE_ID);
assert.ok(rae, 'Rae Sterling listing must remain');
assert.strictEqual(rae.name, 'Rae Sterling at White Cottage Mercantile');
assert.strictEqual(rae.lat, 32.56124371);
assert.strictEqual(rae.lng, -95.86078502);
assert.strictEqual(String(rae.booth), '361-364');
assert.strictEqual(String(rae.pavilion), 'Arbor 3');
assert.ok(/Arbor\s*3/i.test(String(rae.description)), 'Rae Sterling description must say Arbor 3');
assert.ok(/361-364/.test(String(rae.description)), 'Rae Sterling description must list booths 361-364');
assert.ok(/361-364/.test(String(rae.address)), 'Rae Sterling address must list Arbor 3 361-364');
assert.ok(!/Arbor2 162-166A/.test(String(rae.description)), 'old Arbor 2 booth text must be gone');
assert.notStrictEqual(rae.hidden, true, 'Rae Sterling pin must stay visible');

const teak = data.locations.find((loc) => loc.id === TEAK_ID);
assert.ok(teak, 'Teak 22 listing must stay in the export (do not delete the vendor record)');
assert.strictEqual(teak.hidden, true, 'Teak 22 leftover icon on Arbor 3 361-364 must be hidden');

const visibleOnRaeSpot = data.locations.filter((loc) => {
  if (loc.hidden === true) return false;
  return Math.abs(Number(loc.lat) - rae.lat) < 0.00004 && Math.abs(Number(loc.lng) - rae.lng) < 0.00004;
});
assert.deepStrictEqual(
  visibleOnRaeSpot.map((loc) => loc.id),
  [RAE_ID],
  'only Rae Sterling may keep a visible icon on Arbor 3 361-364'
);

const leftoverBoothPins = data.locations.filter((loc) => {
  if (loc.hidden === true) return false;
  if (loc.id === RAE_ID) return false;
  const blob = `${loc.name || ''} ${loc.description || ''} ${loc.address || ''} ${loc.booth || ''}`;
  return /\b36[1-4]\b/.test(blob) && /arbor\s*3|ar3|ab3/i.test(blob);
});
assert.deepStrictEqual(leftoverBoothPins, [], 'no leftover visible booth/POI icons may remain on Arbor 3 361-364');

console.log('test-shopper-output: ok', {
  locations: data.locations.length,
  visible: data.locations.filter((loc) => loc.hidden !== true).length,
  rowe: rowe.id,
  jt: jt.id,
  rae: rae.id,
  teakHidden: teak.hidden,
  gatesIcon: gatesIcon.file
});
