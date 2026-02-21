const { chromium, devices } = require('playwright');

const TARGETS = [
  { key: 'ours', url: 'https://thefairmap.vercel.app' },
  { key: 'mapme', url: 'https://viewer.mapme.com/first-monday-finder' }
];

async function launch() {
  return chromium.launch({
    headless: true,
    args: ['--use-gl=swiftshader','--enable-webgl','--ignore-gpu-blocklist','--enable-unsafe-swiftshader']
  });
}

async function waitMarkers(page) {
  await page.waitForTimeout(4500);
  try {
    await page.waitForSelector('.maplibregl-canvas, .mapboxgl-canvas', { timeout: 12000 });
  } catch {}
  await page.waitForTimeout(2000);
}

async function openSidebar(page, key) {
  if (key === 'ours') {
    const btn = page.locator('#sidebar-toggle');
    if (await btn.count()) await btn.first().click();
    await page.waitForTimeout(700);
    return;
  }
  const candidates = [
    '[aria-label*="filter" i]',
    '[title*="filter" i]',
    'button:has-text("Filters")',
    'button:has-text(">")'
  ];
  for (const sel of candidates) {
    const el = page.locator(sel).first();
    if (!(await el.count())) continue;
    try { await el.click({ timeout: 1800 }); await page.waitForTimeout(900); return; } catch {}
  }
  await page.mouse.click(10, 70);
  await page.waitForTimeout(900);
}

async function clickFirstMarker(page) {
  const loc = page.locator('.maplibregl-marker, .mapboxgl-marker').first();
  if (await loc.count()) {
    try { await loc.click({ timeout: 1800 }); await page.waitForTimeout(1300); return; } catch {}
  }
  const canvas = page.locator('canvas').first();
  const box = await canvas.boundingBox();
  if (box) {
    await page.mouse.click(box.x + box.width * 0.56, box.y + box.height * 0.42);
    await page.waitForTimeout(1500);
  }
}

async function hoverMarker(page) {
  const loc = page.locator('.maplibregl-marker, .mapboxgl-marker').first();
  if (await loc.count()) {
    await loc.hover();
    await page.waitForTimeout(900);
    return;
  }
  const canvas = page.locator('canvas').first();
  const box = await canvas.boundingBox();
  if (box) {
    await page.mouse.move(box.x + box.width * 0.57, box.y + box.height * 0.45);
    await page.waitForTimeout(900);
  }
}

async function runDesktop(browser, target) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  await page.goto(target.url, { waitUntil: 'domcontentloaded', timeout: 90000 });
  await waitMarkers(page);
  await page.screenshot({ path: `tmp-${target.key}-desktop-default.png` });

  await openSidebar(page, target.key);
  await page.screenshot({ path: `tmp-${target.key}-desktop-sidebar.png` });

  await clickFirstMarker(page);
  await page.screenshot({ path: `tmp-${target.key}-desktop-detail.png` });

  await hoverMarker(page);
  await page.screenshot({ path: `tmp-${target.key}-desktop-hover.png` });

  const info = await page.evaluate(() => {
    const controls = Array.from(document.querySelectorAll('button, [role="button"]')).map((el) => {
      const t = (el.textContent || '').trim().replace(/\s+/g, ' ');
      const label = el.getAttribute('aria-label') || el.getAttribute('title') || '';
      return { t, label };
    }).filter((x) => x.t || x.label);
    return {
      controls: controls.slice(0, 60),
      markerCount: document.querySelectorAll('.maplibregl-marker, .mapboxgl-marker').length,
      popupCount: document.querySelectorAll('.maplibregl-popup, .mapboxgl-popup').length
    };
  });
  console.log('DESKTOP', target.key, JSON.stringify(info));
  await ctx.close();
}

async function runMobile(browser, target) {
  const ctx = await browser.newContext({ ...devices['iPhone 12'] });
  const page = await ctx.newPage();
  await page.goto(target.url, { waitUntil: 'domcontentloaded', timeout: 90000 });
  await waitMarkers(page);
  await page.screenshot({ path: `tmp-${target.key}-mobile-default.png` });

  if (target.key === 'ours') {
    const btn = page.locator('#floating-filters-btn');
    if (await btn.count()) await btn.click();
  } else {
    const btn = page.locator('button:has-text("Filters"), [aria-label*="filter" i], [title*="filter" i]').first();
    if (await btn.count()) {
      try { await btn.click({ timeout: 1800 }); } catch {}
    } else {
      await page.mouse.click(18, 82);
    }
  }
  await page.waitForTimeout(900);
  await page.screenshot({ path: `tmp-${target.key}-mobile-drawer.png` });

  await clickFirstMarker(page);
  await page.screenshot({ path: `tmp-${target.key}-mobile-detail.png` });

  const info = await page.evaluate(() => {
    const text = (document.body && document.body.innerText) ? document.body.innerText.slice(0, 500) : '';
    return {
      markerCount: document.querySelectorAll('.maplibregl-marker, .mapboxgl-marker').length,
      popupCount: document.querySelectorAll('.maplibregl-popup, .mapboxgl-popup').length,
      text
    };
  });
  console.log('MOBILE', target.key, JSON.stringify(info));
  await ctx.close();
}

(async () => {
  const browser = await launch();
  for (const t of TARGETS) {
    await runDesktop(browser, t);
    await runMobile(browser, t);
  }
  await browser.close();
})();
