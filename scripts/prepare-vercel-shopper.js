#!/usr/bin/env node
'use strict';

/**
 * Copy shopper map files into public/ so a Git-connected Vercel project
 * that publishes outputDirectory=public actually serves the live map routes.
 * The Aug 3 CLI upload included these files; GitHub main did not.
 */

const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const publicDir = path.join(root, 'public');
const dataDir = path.join(root, 'data');
const publicDataDir = path.join(publicDir, 'data');

function copyFile(src, dest) {
  if (!fs.existsSync(src)) return false;
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(src, dest);
  return true;
}

function copyDir(src, dest) {
  if (!fs.existsSync(src)) return 0;
  fs.mkdirSync(dest, { recursive: true });
  let count = 0;
  for (const ent of fs.readdirSync(src, { withFileTypes: true })) {
    const from = path.join(src, ent.name);
    const to = path.join(dest, ent.name);
    if (ent.isDirectory()) count += copyDir(from, to);
    else {
      fs.copyFileSync(from, to);
      count += 1;
    }
  }
  return count;
}

fs.mkdirSync(publicDataDir, { recursive: true });

const exportCopied = copyFile(
  path.join(dataDir, 'mapme-full-export.json'),
  path.join(publicDataDir, 'mapme-full-export.json')
);
const iconCount = copyDir(path.join(dataDir, 'icons'), path.join(publicDataDir, 'icons'));

for (const name of [
  'shop-search-banner.jpg',
  'shop-food-button-icon.jpg',
  'shop-search-helper-strip.jpg',
  'venue-overlay.svg'
]) {
  copyFile(path.join(dataDir, name), path.join(publicDataDir, name));
}

copyFile(path.join(root, 'manifest.json'), path.join(publicDir, 'manifest.json'));

const required = [
  'first-monday-finder.html',
  'embed.html',
  'map.html',
  'map.js',
  'style.css',
  path.join('data', 'mapme-full-export.json')
];
const missing = required.filter((rel) => !fs.existsSync(path.join(publicDir, rel)));
if (missing.length) {
  console.error('prepare-vercel-shopper: missing required public/ files:', missing.join(', '));
  process.exit(1);
}

console.log(`prepare-vercel-shopper: export=${exportCopied} icons=${iconCount} output=${publicDir}`);
