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
assert.match(mapHtml, /href="https:\/\/vfm\.buzzonmarketing\.com\/vendors"/);
assert.match(mapHtml, /Vendor Map Listing Signup/);
assert.match(mapHtml, /href="https:\/\/visitfirstmonday\.com\/app-download"/);
assert.match(mapHtml, /Download the App/);
assert.doesNotMatch(mapHtml, /visitfirstmonday\.com\/vendor-listing-info/);
assert.doesNotMatch(mapHtml, /thefairmap\.com\/signup/);

assert.ok(fs.existsSync(path.join(publicDir, 'first-monday-finder.html')));
assert.ok(fs.existsSync(path.join(publicDir, 'embed.html')));
assert.ok(fs.existsSync(path.join(publicDir, 'map.js')));

console.log('test-vfm-guest-pages: ok', {
  vendorPortal: VFM_VENDOR_PORTAL_URL,
  appDownload: VFM_APP_DOWNLOAD_URL,
  appStore: VFM_APP_STORE_ID,
  playStore: VFM_PLAY_STORE_ID,
  vfmHome: resolveHome('www.visitfirstmonday.com'),
  fairMapHome: resolveHome('thefairmap.com')
});
