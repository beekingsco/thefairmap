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
assert.ok(hasRewrite('/location/:path*', '/map.html'), 'missing /location/:path* booth-share rewrite');
assert.ok(hasRewrite('/location/:path*/', '/map.html'), 'missing trailing-slash /location rewrite');

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
assert.strictEqual(data.locations.length, 712, `expected 712 locations, got ${data.locations.length}`);
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
const toys = (data.categories || []).find((cat) => cat.id === '46c82a58-7236-4d60-af2c-bb329173029b');
assert.ok(toys, 'Toys / Games / Puzzles category must remain');
assert.strictEqual(toys.name, 'Toys / Games / Puzzles');
assert.strictEqual(toys.count, 16, 'Acorn Game Parlor moves Toys / Games / Puzzles from 15 to 16');

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
  mapHtml.includes('/map.js?v=20260905-lids-tees-hidden'),
  'map.html must cache-bust map.js after hiding Lids & Tees'
);
assert.ok(
  !mapHtml.includes('/map.js?v=20260904-acorn-vine-oak-photos'),
  'Lids & Tees cache-bust must replace the Acorn photos tag, not keep both'
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
assert.strictEqual(afterExport.locations.length, 712);
assert.ok(afterExport.locations.some((loc) => loc.id === 'rowe-farms-4505'), 'Rowe Farms must remain after icon staging');
assert.ok(afterExport.locations.some((loc) => loc.id === '4e0c4de9-e7e9-4ce5-929f-842f73538dc6'), 'Acorn Game Parlor must remain after icon staging');

const RAE_ID = '64592d71-7a78-43cd-8ea8-0d5ce152c47e';
const TEAK_ID = '98933c18-defa-4333-be8e-6de416070ea4';
const rae = data.locations.find((loc) => loc.id === RAE_ID);
assert.ok(rae, 'Rae Sterling listing must remain');
assert.strictEqual(rae.name, 'Rae Sterling at White Cottage Mercantile');
assert.strictEqual(rae.lat, 32.5613006);
assert.strictEqual(rae.lng, -95.8607431);
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
assert.strictEqual(
  data.locations.filter((loc) => loc.hidden !== true).length,
  709,
  '712 listings with Teak 22, Vine & Oak, and Lids & Tees hidden leaves 709 visible pins'
);

const visibleOnRaeSpot = data.locations.filter((loc) => {
  if (loc.hidden === true) return false;
  return Math.abs(Number(loc.lat) - rae.lat) < 0.000015 && Math.abs(Number(loc.lng) - rae.lng) < 0.000015;
});
assert.deepStrictEqual(
  visibleOnRaeSpot.map((loc) => loc.id),
  [RAE_ID],
  'only Rae Sterling may keep a visible icon on the marked 362/363 spot'
);

const neighborPins = [
  { id: '335e3e69-88b4-40c2-b07a-caa59459c2ea', name: '368' },
  { id: '1bffeac9-1996-4d9f-991c-64da5c417321', name: 'Pish Posh T-Shirts' },
  { id: '58eea7d3-fdcb-4134-b09d-bbb96c40ca64', name: 'Silver Spoons' }
];
for (const neighbor of neighborPins) {
  const loc = data.locations.find((item) => item.id === neighbor.id);
  assert.ok(loc, `${neighbor.name} listing must remain`);
  assert.notStrictEqual(loc.hidden, true, `${neighbor.name} pin must stay visible`);
}

const leftoverBoothPins = data.locations.filter((loc) => {
  if (loc.hidden === true) return false;
  if (loc.id === RAE_ID) return false;
  const blob = `${loc.name || ''} ${loc.description || ''} ${loc.address || ''} ${loc.booth || ''}`;
  return /\b36[1-4]\b/.test(blob) && /arbor\s*3|ar3|ab3/i.test(blob);
});
assert.deepStrictEqual(leftoverBoothPins, [], 'no leftover visible booth/POI icons may remain on Arbor 3 361-364');

const ACORN_ID = '4e0c4de9-e7e9-4ce5-929f-842f73538dc6';
const BEE_KING_ID = '758aad31-099f-4ece-bee7-4b22eb202334';
const acorn = data.locations.find((loc) => loc.id === ACORN_ID);
assert.ok(acorn, 'Acorn Game Parlor listing must exist');
assert.strictEqual(acorn.name, 'Acorn Game Parlor');
assert.strictEqual(String(acorn.booth), '68');
assert.strictEqual(String(acorn.pavilion), 'Arbor 1');
assert.ok(/Arbor\s*1:\s*68/.test(String(acorn.address)), 'Acorn address must use Arbor 1: 68 colon style');
assert.ok(/Arbor\s*1:\s*68/.test(String(acorn.description)), 'Acorn description must list Arbor 1: 68');
assert.ok(String(acorn.description || '').replace(/<[^>]+>/g, ' ').trim().length > 40, 'Acorn description must not be blank');
assert.doesNotMatch(
  String(acorn.description),
  /Mahjong mats, mahjong gifts, mahjong totes and bags, vintage board games, replacement game pieces, mahjong tiles/,
  'Acorn description must not ship the keyword dump'
);
assert.ok(/Building memories one game at a time/.test(String(acorn.description)), 'Acorn blurb must use the shopper tagline');
assert.ok(/Mahjong mats, gifts, and totes/.test(String(acorn.description)), 'Acorn blurb must mention mahjong mats, gifts, and totes');
assert.ok(/vintage board games/.test(String(acorn.description)), 'Acorn description must mention vintage board games');
assert.ok(/replacement pieces/.test(String(acorn.description)), 'Acorn description must mention replacement pieces');
assert.ok(/mahjong tiles/.test(String(acorn.description)), 'Acorn description must mention mahjong tiles');
assert.ok(/cozy game-shop browse/.test(String(acorn.description)), 'Acorn blurb must invite a cozy browse');
assert.ok(/Canton First Monday/.test(String(acorn.description)), 'Acorn blurb must name Canton First Monday');
const acornPhotos = Array.isArray(acorn.photos) ? acorn.photos : [];
assert.strictEqual(acornPhotos.length, 6, 'Acorn Game Parlor must have 6 shopper photos');
assert.deepStrictEqual(acornPhotos, [
  '/uploads/acorn-1.jpg',
  '/uploads/acorn-2.jpg',
  '/uploads/acorn-3.jpg',
  '/uploads/acorn-4.jpg',
  '/uploads/acorn-5.jpg',
  '/uploads/acorn-6.jpg'
]);
assert.deepStrictEqual(acorn.images, acornPhotos, 'Acorn images must mirror photos');
for (const rel of acornPhotos) {
  const full = path.join(publicDir, rel.replace(/^\//, ''));
  assert.ok(fs.existsSync(full), `missing shopper photo ${rel}`);
  const magic = fs.readFileSync(full).subarray(0, 3);
  assert.deepStrictEqual(Array.from(magic), [0xff, 0xd8, 0xff], `${rel} must be a JPEG`);
}
assert.strictEqual(acorn.categoryId, '46c82a58-7236-4d60-af2c-bb329173029b');
assert.strictEqual(acorn.categoryName, 'Toys / Games / Puzzles');
assert.strictEqual(acorn.lat, 32.56093612, 'Acorn lat must reuse Vine & Oak’s previous coordinates');
assert.strictEqual(acorn.lng, -95.86143448, 'Acorn lng must reuse Vine & Oak’s previous coordinates');
assert.notStrictEqual(acorn.lat, 32.5609714, 'Acorn must leave the original halfway booth-68 coords');
assert.notStrictEqual(acorn.lng, -95.86139895, 'Acorn must leave the original halfway booth-68 coords');
assert.notStrictEqual(acorn.hidden, true, 'Acorn Game Parlor pin must stay visible');
assert.notStrictEqual(acorn.id, BEE_KING_ID, 'Acorn must be a new listing, not a rewrite of Bee King’s Honey');

const VINE_OAK_ID = '1c577da0-5720-43b6-92ec-db389069e470';
const vineOak = data.locations.find((loc) => loc.id === VINE_OAK_ID);
assert.ok(vineOak, 'Vine & Oak listing must stay in the export (do not delete the vendor record)');
assert.strictEqual(vineOak.name, 'Vine & Oak');
assert.strictEqual(vineOak.address, 'AB1-69B-70');
assert.strictEqual(vineOak.categoryName, 'Woodcraft');
assert.strictEqual(vineOak.hidden, true, 'Vine & Oak leftover icon on AB1-69B-70 must be hidden');
assert.strictEqual(vineOak.lat, 32.56093612);
assert.strictEqual(vineOak.lng, -95.86143448);

const LIDS_TEES_ID = 'a912a873-3204-4685-8169-90d5b5112bc7';
const lidsTees = data.locations.find((loc) => loc.id === LIDS_TEES_ID);
assert.ok(lidsTees, 'Lids & Tees listing must stay in the export (do not delete the vendor record)');
assert.strictEqual(lidsTees.name, 'Lids & Tees');
assert.strictEqual(lidsTees.address, 'PV 4000 - Booth 4313-14');
assert.strictEqual(lidsTees.hidden, true, 'Lids & Tees leftover icon on PV 4000 booth 4313-14 must be hidden');
assert.ok(
  !data.locations.some((loc) => loc.hidden !== true && loc.name === 'Lids & Tees'),
  'Lids & Tees must not appear in the shopper pin set'
);

const visibleOnVineOakSpot = data.locations.filter((loc) => {
  if (loc.hidden === true) return false;
  return Math.abs(Number(loc.lat) - 32.56093612) < 0.000015 && Math.abs(Number(loc.lng) - -95.86143448) < 0.000015;
});
assert.deepStrictEqual(
  visibleOnVineOakSpot.map((loc) => loc.id),
  [ACORN_ID],
  'only Acorn Game Parlor may keep a visible icon on Vine & Oak’s previous spot'
);

const beeKing = data.locations.find((loc) => loc.id === BEE_KING_ID);
assert.ok(beeKing, 'Bee King’s Honey listing must remain');
assert.strictEqual(beeKing.name, 'Bee King’s Honey');
assert.strictEqual(beeKing.address, 'Arbor 1, 65-68');
assert.strictEqual(beeKing.lat, 32.56100669);
assert.strictEqual(beeKing.lng, -95.86136341);
assert.ok(String(beeKing.description).includes('Arbor 1, 65-68'), 'Bee King description address must stay');
assert.ok(/Honey Dust/i.test(String(beeKing.description)), 'Bee King honey copy must stay');
assert.strictEqual(beeKing.categoryName, 'Gourmet Food / Seasonings');
assert.notStrictEqual(beeKing.hidden, true, 'Bee King’s Honey pin must stay visible');

const leftoverBooth68 = data.locations.filter((loc) => {
  if (loc.hidden === true) return false;
  if (loc.id === ACORN_ID || loc.id === BEE_KING_ID) return false;
  const blob = `${loc.name || ''} ${loc.description || ''} ${loc.address || ''} ${loc.booth || ''}`;
  return /\b68\b/.test(blob) && /arbor\s*1|ab1|ar1/i.test(blob) && !/65-68|69B-70|71-76/.test(blob);
});
assert.deepStrictEqual(leftoverBooth68, [], 'no leftover visible booth/POI icons may remain on only Arbor 1 booth 68');

console.log('test-shopper-output: ok', {
  locations: data.locations.length,
  visible: data.locations.filter((loc) => loc.hidden !== true).length,
  rowe: rowe.id,
  jt: jt.id,
  rae: rae.id,
  teakHidden: teak.hidden,
  acorn: acorn.id,
  acornLat: acorn.lat,
  acornLng: acorn.lng,
  acornPhotos: (acorn.photos || []).length,
  vineOakHidden: vineOak.hidden,
  lidsTeesHidden: lidsTees.hidden,
  beeKing: beeKing.id,
  gatesIcon: gatesIcon.file
});
