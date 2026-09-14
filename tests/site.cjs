const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const root = path.resolve(__dirname, '..');
process.chdir(root);
const mime = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.webp': 'image/webp', '.png': 'image/png', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.ico': 'image/x-icon' };
const server = http.createServer((request, response) => {
  const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
  const target = path.resolve(root, '.' + (pathname === '/' ? '/index.html' : pathname));
  if (!target.startsWith(root + path.sep)) { response.writeHead(403).end(); return; }
  fs.readFile(target, (error, data) => {
    if (error) { response.writeHead(404).end(); return; }
    response.setHeader('Content-Type', mime[path.extname(target)] || 'application/octet-stream');
    response.end(data);
  });
});
let browser;


(async () => {
  fs.mkdirSync('tmp/preview', { recursive: true });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const baseURL = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, permissions: ['clipboard-read', 'clipboard-write'], reducedMotion: 'reduce' });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('response', r => { if (r.status() >= 400) errors.push(`${r.status()} ${r.url()}`); });
  await page.goto(baseURL, { waitUntil: 'networkidle' });
  await page.evaluate(() => document.fonts.ready);
  assert.equal(await page.locator('.line').count(), 18);
  await page.locator('.pasta__image').scrollIntoViewIfNeeded();
  await page.locator('.pasta__image img').evaluate(img => img.decode());
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: 'tmp/preview/desktop-full.png', fullPage: true });
  await page.screenshot({ path: 'tmp/preview/desktop-hero.png' });
  await page.locator('[data-filter="fruits"]').click();
  assert.equal(await page.locator('[data-category]:visible').count(), 1);
  assert.equal(await page.locator('.catalogue-products .line:visible').count(), 3);
  await page.locator('[data-id="ananas"] button').click();
  assert.equal(await page.locator('[data-docket-total]').innerText(), '85');
  await page.locator('[data-filter="herbs"]').click();
  await page.locator('[data-id="menthe"] button').click();
  assert.equal(await page.locator('[data-docket-total]').innerText(), '285');
  await page.locator('[data-unit="kg"]').click();
  assert.equal(await page.locator('[data-docket-total]').innerText(), '485');
  await page.locator('[data-id="ravioli"] button').click();
  assert.equal(await page.locator('[data-docket-total]').innerText(), '485');
  assert.equal(await page.locator('[data-ask-note]').isVisible(), true);
  await page.getByRole('button', { name: 'More Ananas', exact: true }).click();
  assert.equal(await page.locator('[data-docket-total]').innerText(), '570');
  assert.equal(await page.evaluate(() => document.activeElement.getAttribute('aria-label')), 'More Ananas');
  await page.locator('[data-copy]').click();
  const copied = await page.evaluate(() => navigator.clipboard.readText());
  assert.match(copied, /Ananas ×2 pc/);
  assert.match(copied, /Menthe ×1 kg/);
  assert.match(copied, /Ravioli ×1 kg \(rate please\)/);
  assert.match(copied, /Estimated total: Rs 570/);
  const orderUrl = new URL(await page.locator('[data-wa-link]').getAttribute('href'));
  assert.equal(orderUrl.origin, 'https://wa.me');
  assert.equal(orderUrl.pathname, '/23057563134');
  assert.equal(orderUrl.searchParams.get('text'), copied.replace(/\r\n/g, '\n'));
  assert.equal(await page.locator('[data-wa-link]').getAttribute('target'), '_blank');
  assert.equal(await page.locator('[data-order-availability]').isVisible(), false);
  assert.equal(await page.locator('[data-placeholder-note]').isVisible(), false);
  await page.reload({ waitUntil: 'networkidle' });
  assert.equal(await page.locator('[data-docket-total]').innerText(), '570');
  assert.equal(await page.locator('.line.is-on').count(), 3);
  await page.getByRole('button', { name: 'Remove Ananas', exact: true }).click();
  assert.equal(await page.locator('[data-docket-total]').innerText(), '400');
  await page.locator('#order').screenshot({ path: 'tmp/preview/order-desktop.png' });
  const sizes = [320, 360, 390, 600, 768, 1024, 1440, 1920];
  for (const width of sizes) {
    await page.setViewportSize({ width, height: 900 });
    await page.evaluate(() => window.scrollTo(0, 0));
    const layout = await page.evaluate(() => ({ width: innerWidth, scroll: document.documentElement.scrollWidth, broken: [...document.images].filter(i => !i.complete || i.naturalWidth === 0).length }));
    assert.ok(layout.scroll <= width, `Horizontal overflow at ${width}: ${layout.scroll}`);
    assert.equal(layout.broken, 0);
    assert.ok(await page.locator('.hero__lede').evaluate(el => parseFloat(getComputedStyle(el).fontSize) >= 16));
    assert.ok(await page.locator('.line__unit').first().evaluate(el => parseFloat(getComputedStyle(el).fontSize) >= 12));
    if ([390, 768].includes(width)) await page.screenshot({ path: `tmp/preview/page-${width}.png`, fullPage: true });
    if (width === 390) {
      await page.screenshot({ path: 'tmp/preview/mobile-hero.png' });
      await page.locator('#order').screenshot({ path: 'tmp/preview/order-mobile.png' });
      await page.locator('[data-category="specialty"]').screenshot({ path: 'tmp/preview/prices-mobile.png' });
    }
  }

  // Search: translations, case/accent normalization, empty state and category interaction.
  await page.locator('[data-filter="all"]').click();
  await page.locator('[data-search]').fill('LETTUCE');
  assert.equal(await page.locator('.catalogue-products .line:visible').count(), 1);
  assert.equal(await page.locator('[data-id="laitue"]').isVisible(), true);
  await page.locator('[data-search]').fill('menthé');
  assert.equal(await page.locator('[data-id="menthe"]').isVisible(), true);
  await page.locator('[data-filter="fruits"]').click();
  assert.equal(await page.locator('[data-search-empty]').isVisible(), true);
  await page.locator('[data-search-reset]').click();
  assert.equal(await page.locator('.catalogue-products .line:visible').count(), 16);
  await page.locator('[data-search]').fill('cilantro');
  assert.equal(await page.locator('[data-id="coriandre"]').isVisible(), true);
  await page.locator('[data-search-clear]').click();
  assert.equal(await page.locator('.catalogue-products .line:visible').count(), 16);

  // One order workspace moves into the native modal, preserving quantities and input state.
  await page.setViewportSize({ width: 1440, height: 1000 });
  const opener = page.locator('.topnav__cta');
  await opener.click();
  const dialog = page.locator('[data-order-drawer]');
  assert.equal(await dialog.evaluate(el => el.open), true);
  assert.equal(await dialog.locator('[data-order-workspace]').count(), 1);
  assert.equal(await page.locator('[data-docket-lines]').count(), 1);
  await page.locator('[data-order-business]').fill('Café du Jardin & Co');
  await page.locator('[data-order-notes]').fill('Please confirm delivery on Friday.\nRavioli filling: please advise.');
  assert.ok(await page.locator('.drawer-close').evaluate(el => el.getBoundingClientRect().top >= 0));
  await page.getByRole('button', { name: 'More Menthe', exact: true }).click();
  assert.equal(await page.locator('[data-docket-total]').innerText(), '800');
  let message = new URL(await page.locator('[data-wa-link]').getAttribute('href')).searchParams.get('text');
  assert.match(message, /Name \/ business: Café du Jardin & Co/);
  assert.match(message, /Notes: Please confirm delivery on Friday./);
  assert.ok(message.includes('Friday.\nRavioli filling: please advise.'));
  assert.match(message, /Menthe ×2 kg/);
  await page.keyboard.press('Tab');
  assert.equal(await page.evaluate(() => document.querySelector('[data-order-drawer]').contains(document.activeElement)), true);
  await dialog.evaluate(el => { el.scrollTop = 0; });
  await page.screenshot({ path: 'tmp/preview/order-panel-desktop.png' });
  for (const width of [320, 390, 768]) {
    await page.setViewportSize({ width, height: 844 });
    assert.ok(await dialog.evaluate(el => el.scrollWidth <= el.clientWidth), `Drawer overflow at ${width}`);
    await dialog.evaluate(el => { el.scrollTop = 0; });
    if (width === 390) await page.screenshot({ path: 'tmp/preview/order-panel-mobile.png' });
  }
  await page.keyboard.press('Escape');
  await page.locator('[data-order-home] [data-order-workspace]').waitFor({ state: 'attached' });
  assert.equal(await dialog.evaluate(el => el.open), false);
  assert.equal(await opener.evaluate(el => el === document.activeElement), true);

  // Closing a panel opened from the floating summary keeps the browsing position.
  await page.locator('[data-category="herbs"]').scrollIntoViewIfNeeded();
  const browseY = await page.evaluate(() => scrollY);
  await page.locator('.tray__go').click();
  await page.keyboard.press('Escape');
  await page.locator('[data-order-home] [data-order-workspace]').waitFor({ state: 'attached' });
  assert.ok(Math.abs(await page.evaluate(() => scrollY) - browseY) < 5);
  assert.equal(await page.locator('[data-order-home] [data-order-workspace]').count(), 1);
  assert.equal(await page.locator('.tray__go').evaluate(el => el === document.activeElement), true);
  await page.reload({ waitUntil: 'networkidle' });
  assert.equal(await page.locator('[data-order-business]').inputValue(), 'Café du Jardin & Co');
  assert.equal(await page.locator('[data-docket-total]').innerText(), '800');
  await page.locator('.topnav__cta').click();
  await page.getByRole('button', { name: 'Continue browsing', exact: false }).click();
  await page.locator('[data-order-home] [data-order-workspace]').waitFor({ state: 'attached' });
  assert.equal(await dialog.evaluate(el => el.open), false);

  await page.locator('[data-clear]').click();
  assert.equal(await page.locator('.line.is-on').count(), 0);
  assert.equal(await page.locator('[data-order-business]').inputValue(), '');
  assert.equal(await page.locator('[data-copy]').isDisabled(), true);
  await page.locator('.topnav__cta').click();
  await dialog.locator('[data-docket-empty] a').click();
  await page.locator('[data-order-home] [data-order-workspace]').waitFor({ state: 'attached' });
  assert.equal(await dialog.evaluate(el => el.open), false);
  assert.equal(await page.locator('[data-search]').evaluate(el => el === document.activeElement), true);
  assert.equal(await page.locator('[data-docket-empty]').isVisible(), true);
  assert.equal(await page.locator('[data-wa-link]').getAttribute('aria-disabled'), null);
  assert.equal(await page.locator('[data-wa-plain]').isVisible(), true);
  assert.equal(await page.locator('[data-wa-plain]').getAttribute('href'), 'https://wa.me/23057563134');
  const emptyUrl = new URL(await page.locator('[data-wa-link]').getAttribute('href'));
  assert.equal(emptyUrl.pathname, '/23057563134');
  assert.match(emptyUrl.searchParams.get('text'), /I would like to place an order/);
  assert.deepEqual(errors, []);
  const nojs = await browser.newContext({ javaScriptEnabled: false });
  const staticPage = await nojs.newPage();
  await staticPage.goto(baseURL);
  assert.equal(await staticPage.locator('.line:visible').count(), 18);
  assert.equal(await staticPage.locator('[data-wa-link]').getAttribute('href'), 'https://wa.me/23057563134');
  await nojs.close();
  console.log('PASS: 18 products, categories, add/remove, herb units, totals, pasta exclusion, clipboard, persistence, WhatsApp number and exact message, empty-order WhatsApp link, no-JS ordering link, readable text at eight viewport widths, images and no browser errors. Search aliases, empty states, modal editing, focus restoration, optional details and persistence verified. No messages sent.');
})().catch(error => { console.error(error); process.exitCode = 1; }).finally(async () => {
  if (browser) await browser.close();
  server.close();
});
