'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const {
  isVisitFirstMondayHost,
  VFM_VENDOR_PORTAL_URL,
  VFM_APP_DOWNLOAD_URL,
  VFM_APP_STORE_URL,
  VFM_PLAY_STORE_URL,
  VFM_APP_STORE_ID,
  VFM_PLAY_STORE_ID
} = require('../lib/vfm-host');

const root = path.join(__dirname, '..');
const publicDir = path.join(root, 'public');
const vercel = JSON.parse(fs.readFileSync(path.join(root, 'vercel.json'), 'utf8'));

const FAIR_MAP_SALES = /Let Us Transform Your Event|Get Your Map|Keyword-Searchable Maps for Events/;

assert.strictEqual(isVisitFirstMondayHost('visitfirstmonday.com'), true);
assert.strictEqual(isVisitFirstMondayHost('www.visitfirstmonday.com'), true);
assert.strictEqual(isVisitFirstMondayHost('www.visitfirstmonday.com:443'), true);
assert.strictEqual(isVisitFirstMondayHost('thefairmap.com'), false);
assert.strictEqual(isVisitFirstMondayHost('www.thefairmap.com'), false);
assert.strictEqual(isVisitFirstMondayHost('thefairmap.vercel.app'), false);
assert.strictEqual(isVisitFirstMondayHost('map.thefairmap.com'), false);

assert.strictEqual(VFM_VENDOR_PORTAL_URL, 'https://vfm.buzzonmarketing.com/vendors');
assert.strictEqual(VFM_APP_DOWNLOAD_URL, 'https://visitfirstmonday.com/app-download');
assert.ok(VFM_APP_STORE_URL.includes(VFM_APP_STORE_ID));
assert.ok(VFM_PLAY_STORE_URL.includes(VFM_PLAY_STORE_ID));

assert.ok(!fs.existsSync(path.join(root, 'natively.json')), 'Natively app config is not in this repo');
assert.ok(!fs.existsSync(path.join(publicDir, 'index.html')), 'index.html must not exist so Vercel cannot serve Fair Map marketing as /');
assert.ok(fs.existsSync(path.join(publicDir, 'marketing.html')), 'Fair Map marketing must live at marketing.html');
assert.ok(fs.existsSync(path.join(publicDir, 'vfm-home.html')));
assert.ok(fs.existsSync(path.join(publicDir, 'app-download.html')));
assert.ok(fs.existsSync(path.join(publicDir, 'vfm-guest.css')));

const marketing = fs.readFileSync(path.join(publicDir, 'marketing.html'), 'utf8');
assert.match(marketing, FAIR_MAP_SALES, 'marketing.html remains The Fair Map sales page');

const home = fs.readFileSync(path.join(publicDir, 'vfm-home.html'), 'utf8');
assert.match(home, /data-vfm-page="home"/);
assert.match(home, /Visit First Monday/);
assert.match(home, /First Monday Trade Days/);
assert.match(home, /\/first-monday-finder/);
assert.match(home, /\/app-download/);
assert.match(home, /vfm\.buzzonmarketing\.com\/vendors/);
assert.doesNotMatch(home, FAIR_MAP_SALES);

const download = fs.readFileSync(path.join(publicDir, 'app-download.html'), 'utf8');
assert.match(download, /data-vfm-page="app-download"/);
assert.match(download, /Download First Monday Finder/);
assert.match(download, /Buckaroo/);
assert.match(download, /id6746057595/);
assert.match(download, /com\.TnCzkYTWJRzX\.natively/);
assert.match(download, /\/first-monday-finder/);
assert.doesNotMatch(download, FAIR_MAP_SALES);
assert.doesNotMatch(download, /thefairmap\.com\/signup/);

function hasRewrite(source, dest, host) {
  return (vercel.rewrites || []).some((rule) => {
    if (rule.source !== source || rule.destination !== dest) return false;
    if (!host) return !rule.has;
    return (rule.has || []).some((cond) => cond.type === 'host' && cond.value === host);
  });
}

function hasRedirect(source, dest) {
  return (vercel.redirects || []).some((rule) => rule.source === source && rule.destination === dest);
}

assert.ok(hasRewrite('/', '/vfm-home.html', 'www.visitfirstmonday.com'));
assert.ok(hasRewrite('/', '/vfm-home.html', 'visitfirstmonday.com'));
assert.ok(hasRewrite('/', '/marketing.html'));
assert.ok(hasRewrite('/app-download', '/app-download.html'));
assert.ok(hasRewrite('/vfm-home', '/vfm-home.html'));
assert.ok(hasRewrite('/first-monday-finder', '/first-monday-finder.html'), 'must keep shopper finder rewrite');
assert.ok(hasRewrite('/api/locations', '/data/mapme-full-export.json'), 'must keep shopper locations rewrite');
assert.ok(hasRewrite('/embed', '/embed.html'), 'must keep embed rewrite');
assert.ok(hasRewrite('/location/:path*', '/map.html'), 'must rewrite booth share links to the shopper map');
assert.ok(hasRewrite('/location/:path*/', '/map.html'), 'must rewrite trailing-slash booth share links');
assert.ok(hasRedirect('/vendor-listing-info', VFM_VENDOR_PORTAL_URL));

const firstAppDownload = (vercel.rewrites || []).findIndex((rule) => rule.source === '/app-download');
const firstBareHome = (vercel.rewrites || []).findIndex((rule) => rule.source === '/' && !rule.has);
assert.ok(firstBareHome >= 0, 'bare / must fall back to marketing for thefairmap.com');
assert.ok(firstAppDownload >= 0);

function resolveHome(host) {
  const rules = vercel.rewrites || [];
  for (const rule of rules) {
    if (rule.source !== '/') continue;
    if (rule.has) {
      const matches = rule.has.every((cond) => cond.type === 'host' && cond.value === host);
      if (matches) return rule.destination;
      continue;
    }
    return rule.destination;
  }
  return null;
}

assert.strictEqual(resolveHome('www.visitfirstmonday.com'), '/vfm-home.html');
assert.strictEqual(resolveHome('visitfirstmonday.com'), '/vfm-home.html');
assert.strictEqual(resolveHome('thefairmap.com'), '/marketing.html');
assert.strictEqual(resolveHome('thefairmap.vercel.app'), '/marketing.html');

const mapHtml = fs.readFileSync(path.join(publicDir, 'map.html'), 'utf8');
assert.match(mapHtml, /LINKS \+ DEALS/);
assert.match(mapHtml, /Natively builder/);
assert.match(mapHtml, /href="https:\/\/vfm\.buzzonmarketing\.com\/vendors"/);
assert.match(mapHtml, /Vendor Map Listing Signup/);
assert.match(mapHtml, /href="https:\/\/visitfirstmonday\.com\/app-download"/);
assert.match(mapHtml, /Download the App/);
assert.doesNotMatch(mapHtml, /visitfirstmonday\.com\/vendor-listing-info/);
assert.doesNotMatch(mapHtml, /href="[^"]*thefairmap\.com\/signup/);

assert.ok(fs.existsSync(path.join(publicDir, 'first-monday-finder.html')));
assert.ok(fs.existsSync(path.join(publicDir, 'embed.html')));
assert.ok(fs.existsSync(path.join(publicDir, 'map.js')));

const mapJs = fs.readFileSync(path.join(publicDir, 'map.js'), 'utf8');
assert.match(
  mapJs,
  /const shareUrl = `\$\{window\.location\.origin\}\/location\/\$\{encodeURIComponent\(locId\)\}`/,
  'shareLocation() must keep the /location/<id> permalink'
);
assert.match(
  mapJs,
  /pathname\.match\(\/\^\\\/location\\\/\(\[\^\/\?#\]\+\)\/\)/,
  'getDeepLinkedLocationId() must read /location/<id> from the pathname'
);
assert.match(mapHtml, /src="\/map\.js/, 'map.html must load map.js so the rewrite can open the booth');

const CHRIS_SHARE_ID = 'b47d47ea-99be-4774-9534-fc9dc016c39b';
const exportData = JSON.parse(fs.readFileSync(path.join(publicDir, 'data', 'mapme-full-export.json'), 'utf8'));
const chris = exportData.locations.find((loc) => loc.id === CHRIS_SHARE_ID);
assert.ok(chris, 'Chris vendor share UUID must remain in the shopper export');
assert.match(String(chris.name), /Avon/i);

const locationRules = (vercel.rewrites || []).filter((rule) => String(rule.source || '').startsWith('/location/'));
assert.ok(locationRules.length >= 2, 'need /location/:path* and trailing-slash rewrites');
assert.ok(
  locationRules.every((rule) => rule.destination === '/map.html' && !rule.has),
  'location share rewrites must serve map.html on every host, including map.thefairmap.com'
);
assert.ok(
  !(vercel.rewrites || []).some((rule) => rule.source === '/' && rule.destination === '/map.html'),
  'must not put the shopper map on visitfirstmonday.com /'
);

const http = require('http');
const { URL } = require('url');

function destinationForSharePath(pathname) {
  if (/^\/location\/.+/.test(pathname)) return '/map.html';
  return null;
}

async function fetchLocalShare(pathname) {
  const server = http.createServer((req, res) => {
    const dest = destinationForSharePath(new URL(req.url, 'http://127.0.0.1').pathname);
    if (!dest) {
      res.writeHead(404);
      res.end('NOT_FOUND');
      return;
    }
    const body = fs.readFileSync(path.join(publicDir, dest.slice(1)));
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(body);
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  try {
    const res = await fetch(`http://127.0.0.1:${port}${pathname}`);
    const text = await res.text();
    return { status: res.status, text };
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

(async () => {
  const served = await fetchLocalShare(`/location/${CHRIS_SHARE_ID}`);
  assert.strictEqual(served.status, 200, 'rewritten /location/<uuid> must be 200');
  assert.match(served.text, /First Monday Finder — TheFairMap/);
  assert.match(served.text, /src="\/map\.js/);
  const slash = await fetchLocalShare(`/location/${CHRIS_SHARE_ID}/`);
  assert.strictEqual(slash.status, 200, 'trailing-slash share URL must also be 200');

  console.log('test-vfm-guest-pages: ok', {
    vendorPortal: VFM_VENDOR_PORTAL_URL,
    appDownload: VFM_APP_DOWNLOAD_URL,
    appStore: VFM_APP_STORE_ID,
    playStore: VFM_PLAY_STORE_ID,
    vfmHome: resolveHome('www.visitfirstmonday.com'),
    fairMapHome: resolveHome('thefairmap.com'),
    chrisShareId: CHRIS_SHARE_ID,
    chrisShareName: chris.name
  });
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
