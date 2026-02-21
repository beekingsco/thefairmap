import { chromium } from 'playwright';

const targets = [
  { url: 'https://thefairmap.vercel.app', out: '.tmp/thefairmap.png' },
  { url: 'https://viewer.mapme.com/first-monday-finder', out: '.tmp/mapme.png' }
];

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
for (const t of targets) {
  await page.goto(t.url, { waitUntil: 'networkidle', timeout: 120000 });
  await page.waitForTimeout(3500);
  await page.screenshot({ path: t.out, fullPage: false });
  console.log('saved', t.out);
}
await browser.close();
