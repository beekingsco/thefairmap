#!/usr/bin/env node
'use strict';

const { ensureExportFiles, paths } = require('../lib/map-export');

const pubFile = ensureExportFiles();
console.log(`Map export ready at ${pubFile}`);
console.log(`Canonical shopper export: ${paths.canonicalFile}`);
