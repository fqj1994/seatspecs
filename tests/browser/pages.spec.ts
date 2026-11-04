import { test, expect } from '@playwright/test';
import { createServer, type Server } from 'node:http';
import { once } from 'node:events';
import { mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import type { AddressInfo } from 'node:net';

// Exercise a project site, not just localhost's root. All site behavior is native HTML/CSS.
test.use({
  javaScriptEnabled: false,
  launchOptions: {
    executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || undefined,
    channel: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ? undefined : 'chromium',
    args: ['--no-sandbox']
  }
});
const root = path.resolve('docs');
const prefix = '/a-project-path/';
const mime: Record<string, string> = { '.html': 'text/html', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png' };
let server: Server, base: string;
test.beforeAll(async () => {
  await mkdir('test-results', { recursive: true });
  server = createServer(async (request, response) => {
    const url = new URL(request.url || '/', 'http://localhost');
    const relative = decodeURIComponent(url.pathname.slice(prefix.length)) || 'index.html';
    const file = path.resolve(root, relative);
    if (!url.pathname.startsWith(prefix) || !file.startsWith(root + path.sep)) { response.writeHead(404).end(); return; }
    try {
      const bytes = await readFile(file);
      response.writeHead(200, { 'Content-Type': mime[path.extname(file)] || 'application/octet-stream', 'Connection': 'close' }).end(bytes);
    } catch { response.writeHead(404).end(); }
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}${prefix}`;
});
test.afterAll(async () => { if (server) await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); });

for (const width of [360, 768, 1440]) {
  test(`Pages home and privacy work without JavaScript at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 960 });
    for (const file of ['index.html', 'privacy.html']) {
      await page.goto(base + file);
      await expect(page.locator('h1')).toHaveCount(1);
      await expect(page.locator('h1')).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      for (const image of await page.locator('img').all()) {
        await image.scrollIntoViewIfNeeded();
        await expect.poll(() => image.evaluate(node => (node as HTMLImageElement).complete && (node as HTMLImageElement).naturalWidth > 0)).toBe(true);
      }
      if (file === 'index.html' && width !== 768) await page.screenshot({ path: `test-results/pages-home-${width}.png`, fullPage: true });
    }
  });
}

test('Pages assets, links and anchors stay inside the published project directory', async ({ page }) => {
  for (const file of ['index.html', 'privacy.html']) {
    await page.goto(base + file);
    const references = await page.locator('a[href], img[src], link[href]').evaluateAll(nodes => nodes.map(node => node.getAttribute('href') || node.getAttribute('src')!));
    for (const reference of new Set(references)) {
      const url = new URL(reference, page.url());
      if (url.origin !== new URL(base).origin) continue; // Privacy-policy navigation links, not loaded resources.
      expect(url.pathname.startsWith(prefix)).toBe(true);
      const response = await page.request.get(url.href);
      expect(response.status(), url.href).toBe(200);
      if (url.hash) expect(await response.text()).toContain(`id="${decodeURIComponent(url.hash.slice(1))}"`);
    }
  }
});

test('Pages loads no external resources and stores no site cookies or browser data', async ({ page, context }) => {
  const requests: string[] = [];
  page.on('request', request => requests.push(request.url()));
  await page.goto(base + 'index.html');
  await expect(page.getByRole('link', { name: 'Add to Chrome', exact: true })).toHaveCount(2);
  for (const link of await page.getByRole('link', { name: 'Add to Chrome', exact: true }).all()) await expect(link).toHaveAttribute('href', 'https://chromewebstore.google.com/detail/seatspecs-%E2%80%94-seat-types-le/ejaocnhjedaengiacnhlppbhgimfehog');
  await page.goto(base + 'privacy.html');
  await expect(page.getByRole('heading', { name: 'Privacy policy', exact: true })).toBeVisible();
  await expect(page.locator('script, iframe, form')).toHaveCount(0);
  expect(requests.every(url => new URL(url).origin === new URL(base).origin)).toBe(true);
  expect(await context.cookies()).toEqual([]);
  expect(await page.evaluate(() => localStorage.length + sessionStorage.length)).toBe(0);
});

test('Pages keyboard skip link and privacy navigation work without scripts', async ({ page }) => {
  await page.goto(base);
  await page.keyboard.press('Tab');
  await expect(page.getByRole('link', { name: 'Skip to content' })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.locator('main')).toBeFocused();
  await page.getByRole('navigation').getByRole('link', { name: 'Privacy', exact: true }).click();
  await expect(page).toHaveURL(base + 'privacy.html');
  await page.getByRole('link', { name: /Back to SeatSpecs/ }).click();
  await expect(page).toHaveURL(base + 'index.html');
  await page.getByText('Prefer to install from source?', { exact: true }).click();
  await expect(page.locator('pre')).toBeVisible();
  await expect(page.locator('pre')).toContainText('npm run package');
});
