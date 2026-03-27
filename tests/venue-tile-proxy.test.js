// Test: venue-tile proxy Edge Function
// Tests handler input validation and upstream fetch logic.

import { strict as assert } from 'node:assert';
import { test } from 'node:test';

// Import handler directly for unit testing
const { default: handler } = await import('../api/venue-tile/[...slug].js');

// --- Input validation tests ---

test('rejects request with missing tile coordinates', async () => {
  const req = new Request('https://localhost/api/venue-tile/');
  const res = await handler(req);
  assert.equal(res.status, 400);
  const body = await res.text();
  assert.ok(body.includes('expected'), `body: ${body}`);
});

test('rejects request with only z coordinate', async () => {
  const req = new Request('https://localhost/api/venue-tile/5');
  const res = await handler(req);
  assert.equal(res.status, 400);
});

test('rejects request with only z/x coordinates', async () => {
  const req = new Request('https://localhost/api/venue-tile/5/10');
  const res = await handler(req);
  assert.equal(res.status, 400);
});

test('rejects non-numeric z coordinate', async () => {
  const req = new Request('https://localhost/api/venue-tile/abc/0/0');
  const res = await handler(req);
  assert.equal(res.status, 400);
  const body = await res.text();
  assert.ok(body.includes('invalid'), `body: ${body}`);
});

test('rejects non-numeric x coordinate', async () => {
  const req = new Request('https://localhost/api/venue-tile/0/abc/0');
  const res = await handler(req);
  assert.equal(res.status, 400);
});

test('rejects non-numeric y coordinate', async () => {
  const req = new Request('https://localhost/api/venue-tile/0/0/abc');
  const res = await handler(req);
  assert.equal(res.status, 400);
});

test('strips .png extension from y and still validates', async () => {
  const req = new Request('https://localhost/api/venue-tile/0/0/abc.png');
  const res = await handler(req);
  assert.equal(res.status, 400);
});

// --- Environment validation ---

test('returns 500 when MAPTILER_KEY is not set', async () => {
  const origKey = process.env.MAPTILER_KEY;
  delete process.env.MAPTILER_KEY;

  try {
    const req = new Request('https://localhost/api/venue-tile/0/0/0');
    const res = await handler(req);
    assert.equal(res.status, 500);
    const body = await res.text();
    assert.ok(body.includes('MAPTILER_KEY'), `body: ${body}`);
  } finally {
    if (origKey !== undefined) process.env.MAPTILER_KEY = origKey;
  }
});

// --- Upstream fetch (integration, requires MAPTILER_KEY) ---

test('fetches real tile when MAPTILER_KEY is set', { skip: !process.env.MAPTILER_KEY }, async () => {
  const req = new Request('https://localhost/api/venue-tile/0/0/0.png');
  const res = await handler(req);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('Content-Type'), 'image/png');
  assert.equal(res.headers.get('Access-Control-Allow-Origin'), '*');

  const buf = await res.arrayBuffer();
  assert.ok(buf.byteLength > 0, 'expected non-empty body');

  // PNG magic bytes: 0x89 0x50 0x4E 0x47
  const header = new Uint8Array(buf.slice(0, 4));
  assert.deepEqual([...header], [0x89, 0x50, 0x4e, 0x47], 'should be valid PNG');
});
