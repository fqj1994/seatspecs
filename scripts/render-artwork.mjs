// Maintainer-only artwork tooling. Normal builds use the checked-in PNGs.
// Live capture uses a disposable LOCAL profile, never a connected user browser.
import { chromium } from '@playwright/test';
import { build } from 'esbuild';
import { execFileSync } from 'node:child_process';
import { readFile, writeFile, mkdir, mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const at = (...parts) => path.join(root, ...parts);
const executable = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE;
const launch = { executablePath: executable || undefined, channel: executable ? undefined : 'chromium', headless: true, args: ['--no-sandbox'] };
const sizes = [16, 32, 48, 128];
const icon = await readFile(at('assets/icon.svg'), 'utf8');
const pngSize = bytes => ({ width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20), color: bytes[25], depth: bytes[24] });
async function ready(page) {
  await page.evaluate(async () => {
    await document.fonts.ready;
    await Promise.all([...document.images].map(image => image.decode()));
  });
}
async function exportPng(locator, filename, width, height) {
  const bytes = await locator.screenshot({ path: filename, animations: 'disabled' });
  const actual = pngSize(bytes);
  if (actual.width !== width || actual.height !== height || actual.color !== 2 || actual.depth !== 8) throw new Error(`Expected opaque 24-bit ${width}x${height} PNG: ${filename}, got ${JSON.stringify(actual)}`);
  console.log(path.relative(root, filename));
}

async function renderIcons() {
  const browser = await chromium.launch(launch);
  try {
    await mkdir(at('assets/icons'), { recursive: true });
    for (const size of sizes) {
      const page = await browser.newPage({ viewport: { width: size, height: size }, deviceScaleFactor: 1 });
      // Optical sizing: retain the store's 16px padding at 128px, but give the
      // smallest toolbar versions slightly more visual weight.
      const source = size <= 32 ? icon.replace('viewBox="0 0 128 128"', 'viewBox="8 8 112 112"').replace('stroke-width="8"', 'stroke-width="9"') : icon;
      await page.setContent(`<html><head><style>html,body{margin:0;width:100%;height:100%;background:transparent}svg{display:block;width:100%;height:100%}</style></head><body>${source}</body></html>`);
      const filename = at(`assets/icons/icon${size}.png`);
      const bytes = await page.screenshot({ path: filename, omitBackground: true });
      if (pngSize(bytes).color !== 6) throw new Error(`Icon must retain transparency: ${filename}`);
      console.log(path.relative(root, filename));
      await page.close();
    }
  } finally { await browser.close(); }
}

function searchUrl(from, to, date, cabin) {
  // A minimal public one-way Google Flights query. No auth/session fields.
  const field = (n, bytes) => Buffer.concat([Buffer.from([n * 8 + 2, bytes.length]), bytes]);
  const text = (n, value) => field(n, Buffer.from(value));
  const airport = code => Buffer.concat([Buffer.from([8, 1]), text(2, code)]);
  const leg = Buffer.concat([text(2, date), field(13, airport(from)), field(14, airport(to))]);
  const tfs = Buffer.concat([Buffer.from([8, 28, 16, 2]), field(3, leg), Buffer.from([64, 1, 72, cabin, 112, 1])]).toString('base64url');
  return `https://www.google.com/travel/flights/search?tfs=${tfs}&hl=en&curr=USD`;
}

async function capture() {
  const profile = await mkdtemp(path.join(os.tmpdir(), 'seatspecs-artwork-'));
  let context;
  try {
    const info = JSON.parse(await readFile(at('dist/BUILD_INFO.json'), 'utf8'));
    context = await chromium.launchPersistentContext(profile, {
      ...launch, viewport: { width: 1440, height: 1600 }, deviceScaleFactor: 2,
      args: [...launch.args, `--disable-extensions-except=${at('dist')}`, `--load-extension=${at('dist')}`]
    });
    await mkdir(at('store/source/captures'), { recursive: true });
    // Obtain the exact current glyphs from the genuinely INSTALLED extension on
    // the same sanitized fixture used by browser tests. These are an icon guide,
    // not fabricated live flight results or a feature-source injection.
    const fixtureModule = await build({ stdin: { contents: "export { pageHTML } from './tests/browser/fixture.ts';", resolveDir: root }, bundle: true, write: false, platform: 'node', format: 'esm' });
    const { pageHTML } = await import('data:text/javascript;base64,' + Buffer.from(fixtureModule.outputFiles[0].text).toString('base64'));
    const rows = [4, 5, 6, 8, 9].map(code => ({ id: `seat-${code}`, code, pitch: null, cabin: 3 }));
    rows.push(...[{ id: 'free', wifi: 2 }, { id: 'paid', wifi: 3 }, { id: 'available', wifi: 1 }]);
    const fixture = await context.newPage();
    await fixture.route('https://www.google.com/**', route => route.request().isNavigationRequest() ? route.fulfill({ contentType: 'text/html', body: pageHTML(rows) }) : route.abort());
    await fixture.goto('https://www.google.com/travel/flights/search?tfs=artwork-fixture&hl=en-US');
    await fixture.waitForFunction(count => document.querySelectorAll('[data-seatspecs-cell]').length === count && [...document.querySelectorAll('[data-seatspecs-cell]')].every(cell => cell.shadowRoot.querySelector('[data-seatspecs-value]').textContent !== '…'), rows.length);
    const glyphs = await fixture.evaluate(() => {
      const seats = {}, wifi = {};
      for (const cell of document.querySelectorAll('[data-seatspecs-cell]')) {
        const seat = cell.shadowRoot.querySelector('[data-seat-code]');
        if (seat) seats[seat.dataset.seatCode] = seat.outerHTML;
        const indicator = cell.shadowRoot.querySelector('[data-wifi-status]');
        if (indicator) wifi[indicator.dataset.wifiStatus] = indicator.querySelector('svg').outerHTML;
      }
      return { seats, wifi };
    });
    await fixture.close();
    const images = new Map(); // Don't overwrite checked-in captures on a failed refresh.

    const date = process.env.STORE_FLIGHTS_DATE || new Date(Date.now() + 45 * 86400000).toISOString().slice(0, 10);
    const provenance = { capturedAt: new Date().toISOString(), buildId: info.buildId, note: 'Public, signed-out example searches. Native Google Flights screenshots with the installed extension. No flight expansion or synthetic implementation injection.', captures: {} };
    async function search(from, to, cabin) {
      const page = await context.newPage();
      const url = searchUrl(from, to, date, cabin);
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
      await page.waitForFunction(() => [...document.querySelectorAll('[data-seatspecs-cell]')].filter(cell => cell.getClientRects().length).length >= 3, undefined, { timeout: 45000 });
      await page.waitForFunction(() => [...document.querySelectorAll('[data-seatspecs-cell]')].every(cell => cell.shadowRoot.querySelector('[data-seatspecs-value]').textContent !== '…'), undefined, { timeout: 20000 });
      await page.waitForTimeout(1600);
      // A missing-data dash is legitimate UI, but not a useful product demo.
      // Never capture it as evidence of the seat-type feature.
      if (cabin === 3) await page.waitForFunction(() => [...document.querySelectorAll('[data-seatspecs-cell]')].slice(0, 3).every(cell => cell.shadowRoot.querySelector('[data-seat-code]')), undefined, { timeout: 20000 });
      const searchCabin = await page.locator('[data-seatingclass]').first().getAttribute('data-seatingclass');
      if (Number(searchCabin) !== cabin) throw new Error(`Expected search cabin ${cabin}, got ${searchCabin}`);
      const facts = await page.evaluate(() => {
        const rect = node => { const r = node.getBoundingClientRect(); return { x: r.x + scrollX, y: r.y + scrollY, width: r.width, height: r.height }; };
        return [...document.querySelectorAll('[data-seatspecs-cell]')].filter(cell => cell.getClientRects().length).map(cell => ({
          id: cell.dataset.seatspecsId, buildId: cell.dataset.seatspecsBuild,
          row: rect(cell.closest('li')), cell: rect(cell),
          pitches: [...cell.shadowRoot.querySelectorAll('.measurement')].map(node => node.textContent).filter(value => /\d/.test(value)),
          seats: [...cell.shadowRoot.querySelectorAll('[data-seat-code]')].map(svg => svg.dataset.seatCode),
          wifi: [...cell.shadowRoot.querySelectorAll('[data-wifi-status]')].map(node => node.dataset.wifiStatus)
        }));
      });
      if (facts.some(f => f.buildId !== info.buildId)) throw new Error('Capture is not running the current installed build');
      if (await page.locator('li button[aria-expanded="true"]').count()) throw new Error('Capture must not expand a flight');
      return { page, url, facts, from, to, cabin };
    }
    async function crop(search, key, rows) {
      const clip = { x: Math.floor(rows[0].row.x - 10), y: Math.floor(rows[0].row.y - 10), width: Math.ceil(rows[0].row.width + 20), height: Math.ceil(rows.at(-1).row.y + rows.at(-1).row.height - rows[0].row.y + 20) };
      images.set(key, await search.page.screenshot({ clip, animations: 'disabled' }));
      provenance.captures[key] = { url: search.url, from: search.from, to: search.to, date, requestedCabin: search.cabin, width: clip.width, height: clip.height,
        highlights: rows.map(row => ({ x: row.cell.x - clip.x - 4, y: row.cell.y - clip.y - 5, width: row.cell.width + 8, height: row.cell.height + 10 })),
        rows: rows.map(({ id, pitches, seats, wifi }) => ({ id, pitches, seats, wifi })) };
      console.log(`Captured ${key}: ${search.from} → ${search.to}, ${date}, cabin ${search.cabin}`);
    }
    const business = await search('LHR', 'DOH', 3);
    // Keep a genuine contiguous block from ONE search, rather than splicing
    // cabins or inventing values. The overview must demonstrate all features.
    let overview;
    for (const count of [3, 4]) {
      for (let start = 0; start + count <= business.facts.length; start++) {
        const rows = business.facts.slice(start, start + count);
        const seats = new Set(rows.flatMap(row => row.seats));
        const wifi = new Set(rows.flatMap(row => row.wifi));
        const span = rows.at(-1).row.y + rows.at(-1).row.height - rows[0].row.y;
        const rowHeights = rows.reduce((sum, row) => sum + row.row.height, 0);
        if (rows.some(row => row.pitches.length) && seats.size >= 2 && seats.has('5') && wifi.has('free') && wifi.has('paid') && span <= 328 && span <= rowHeights + 4) {
          overview = rows;
          break;
        }
      }
      if (overview) break;
    }
    if (!overview) throw new Error('Overview needs contiguous real results with legroom, different seat types, and free/paid Wi-Fi');
    await crop(business, 'overview', overview);
    const representative = business.facts.find(f => f.seats.includes('5')) || business.facts.find(f => f.seats.includes('6')) || business.facts[0];
    await crop(business, 'business', [representative]);
    await business.page.close();
    const economy = await search('LHR', 'DOH', 1);
    let pair = economy.facts.slice(0, 2);
    for (let i = 0; i < Math.min(economy.facts.length - 1, 10); i++) {
      if (economy.facts[i].wifi[0] !== economy.facts[i + 1].wifi[0] && ['free', 'paid'].includes(economy.facts[i].wifi[0]) && ['free', 'paid'].includes(economy.facts[i + 1].wifi[0])) { pair = economy.facts.slice(i, i + 2); break; }
    }
    await crop(economy, 'wifi', pair);
    await economy.page.close();
    for (const [key, bytes] of images) await writeFile(at(`store/source/captures/${key}.png`), bytes);
    await writeFile(at('store/source/glyphs.json'), JSON.stringify(glyphs, null, 2) + '\n');
    await writeFile(at('store/source/captures/provenance.json'), JSON.stringify(provenance, null, 2) + '\n');
  } finally { await context?.close(); await rm(profile, { recursive: true, force: true }); }
}

async function renderStore() {
  const glyphs = JSON.parse(await readFile(at('store/source/glyphs.json'), 'utf8'));
  const provenance = JSON.parse(await readFile(at('store/source/captures/provenance.json'), 'utf8'));
  const browser = await chromium.launch(launch);
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
    // No HTTP requests: all design sources, captures, and fonts are local.
    await page.route(/^https?:/, route => route.abort());
    await page.goto(pathToFileURL(at('store/source/artboards.html')).href);
    await page.evaluate(({ glyphs, captures }) => {
      for (const node of document.querySelectorAll('[data-seat]')) node.innerHTML = glyphs.seats[node.dataset.seat];
      for (const node of document.querySelectorAll('[data-wifi]')) node.innerHTML = glyphs.wifi[node.dataset.wifi];
      for (const node of document.querySelectorAll('[data-highlights]')) {
        const capture = captures[node.dataset.highlights];
        node.setAttribute('viewBox', `0 0 ${capture.width} ${capture.height}`);
        for (const box of capture.highlights) {
          const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
          for (const [key, value] of Object.entries(box)) rect.setAttribute(key, value);
          rect.setAttribute('rx', '7'); rect.setAttribute('fill', 'none'); rect.setAttribute('stroke', '#284bee'); rect.setAttribute('stroke-width', '2');
          node.append(rect);
        }
      }
    }, { glyphs, captures: provenance.captures });
    await ready(page);
    await mkdir(at('store/screenshots'), { recursive: true });
    await mkdir(at('store/promotional'), { recursive: true });
    for (const [id, name] of [['overview', '01-overview'], ['seat-types', '02-seat-types'], ['wifi', '03-wifi']]) await exportPng(page.locator(`#${id}`), at(`store/screenshots/${name}.png`), 1280, 800);
    await exportPng(page.locator('#promo'), at('store/promotional/small-tile.png'), 440, 280);

    const urls = ['store/screenshots/01-overview.png', 'store/screenshots/02-seat-types.png', 'store/screenshots/03-wifi.png'].map(file => pathToFileURL(at(file)).href);
    await page.setViewportSize({ width: 1344, height: 864 });
    await page.setContent(`<html><head><style>*{box-sizing:border-box}html,body{width:1344px;height:864px}body{margin:0;padding:24px;background:#dce2ec;font-family:Arial,sans-serif;display:grid;grid-template-columns:640px 640px;grid-template-rows:400px 400px;gap:16px;align-content:start}img.sheet{display:block;width:640px;height:400px}.icons{height:400px;border-radius:4px;background:#fff;padding:16px;display:flex;flex-direction:column;justify-content:space-between;overflow:hidden}.sizes{display:flex;align-items:center;gap:24px}.dark{background:#0b1530;padding:16px;border-radius:12px;display:flex;align-items:center;gap:24px;color:white}h1{font-size:26px;margin:0}p{color:#58637a;font-size:14px;margin:8px 0 0}</style></head><body>${urls.map(url => `<img class="sheet" src="${url}">`).join('')}<section class="icons"><div><h1>SeatSpecs</h1><p>Icon system · 16 / 32 / 48 / 128px</p></div><div class="sizes">${sizes.map(size => `<img width="${size}" height="${size}" src="${pathToFileURL(at(`assets/icons/icon${size}.png`)).href}">`).join('')}</div><div class="dark">${sizes.map(size => `<img width="${size}" height="${size}" src="${pathToFileURL(at(`assets/icons/icon${size}.png`)).href}">`).join('')}</div></section></body></html>`);
    await ready(page);
    await page.screenshot({ path: at('store/preview.png'), fullPage: true });
    console.log('store/preview.png');
  } finally { await browser.close(); }
}

await renderIcons();
if (!process.argv.includes('--icons-only')) {
  if (process.argv.includes('--capture')) {
    execFileSync(process.execPath, [at('scripts/build.mjs')], { cwd: root, stdio: 'inherit' });
    await capture();
  }
  await renderStore();
}
