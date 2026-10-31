// Opt-in public Google Flights smoke test in a SEPARATE local profile.
// This never installs/reloads anything in the connected remote Chrome browser.
import { chromium } from '@playwright/test';
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
const branding = JSON.parse(await readFile(new URL('../src/branding.json', import.meta.url), 'utf8'));
await mkdir('test-results', { recursive: true });
const profile = await mkdtemp(path.resolve('test-results/live-profile-'));
let browser, page;
try {
  browser = await chromium.launchPersistentContext(profile, {
    executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || undefined,
    channel: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ? undefined : 'chromium',
    headless: true, viewport: { width: Number(process.env.FLIGHTS_WIDTH || 1920), height: 1080 },
    args: [`--disable-extensions-except=${path.resolve('dist')}`, `--load-extension=${path.resolve('dist')}`, '--no-sandbox']
  });
  page = await browser.newPage();
  const togglesRequested = Math.min(200, Math.max(0, Number(process.env.FLIGHTS_TOGGLE_COUNT || 0)));
  const minimum = Number(process.env.FLIGHTS_MIN_RESULTS || 0);
  page.on('pageerror', error => console.error('Page error:', error.message));
  await page.addInitScript(() => {
    window.__seatAudit = { expansions: 0, programmaticActions: 0 };
    const click = HTMLElement.prototype.click;
    HTMLElement.prototype.click = function (...args) {
      if (this.matches('li button[aria-expanded]') && this.closest('li')?.querySelector('[data-id]')) window.__seatAudit.programmaticActions++;
      return Reflect.apply(click, this, args);
    };
    new MutationObserver(records => {
      for (const r of records) if (r.target instanceof Element && r.target.matches('li button[aria-expanded="true"]') && r.target.closest('li')?.querySelector('[jsname="HSrbLb"]')) window.__seatAudit.expansions++;
    }).observe(document, { attributes: true, subtree: true, attributeFilter: ['aria-expanded'] });
  });
  const url = process.env.FLIGHTS_URL;
  if (!url) throw new Error('Set FLIGHTS_URL to a current public Google Flights results URL; no bookings are made.');
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForSelector('[data-seatspecs-cell]', { timeout: 30000 });
  await page.waitForFunction(() => [...document.querySelectorAll('[data-seatspecs-cell]')].some(cell => !['…', '—', ''].includes(cell.shadowRoot?.querySelector('span')?.textContent || '')), undefined, { timeout: 20000 });
  await page.waitForTimeout(1200);
  if (process.env.FLIGHTS_LOAD_MORE === '1') {
    const before = await page.locator('[data-seatspecs-cell]').count();
    await page.locator('button[jsname="ornU0b"]:visible').first().click();
    await page.waitForFunction(n => document.querySelectorAll('[data-seatspecs-cell]').length > n, before, { timeout: 30000 });
    await page.waitForTimeout(1000);
    console.log(`Load more: ${before} → ${await page.locator('[data-seatspecs-cell]').count()} cells`);
  }
  if (minimum > 0) await page.waitForFunction(n => document.querySelectorAll('[data-seatspecs-cell]').length >= n, minimum, { timeout: 30000 });
  await page.waitForFunction(() => {
    const cells = [...document.querySelectorAll('[data-seatspecs-cell]')];
    return cells.length > 0 && cells.every(c => c.shadowRoot?.querySelector('span')?.textContent !== '…');
  }, undefined, { timeout: 20000 });
  if (!await page.locator('[data-seatspecs-cell]').evaluateAll(cells => cells.some(c => !['—', '…', ''].includes(c.shadowRoot?.querySelector('span')?.textContent || '')))) throw new Error('No usable seat values after search settled');
  if (process.env.FLIGHTS_AX_AUDIT === '1') {
    const expected = await page.locator('[data-seatspecs-cell]').evaluateAll(cells => cells.filter(cell => !cell.hidden && cell.getClientRects().length).slice(0, 6).flatMap(cell => [...cell.shadowRoot.querySelectorAll('.segment')].map(group => ({
      flight: group.getAttribute('aria-label'), seat: group.querySelector('.seat').getAttribute('aria-label'), wifi: group.querySelector('[data-seatspecs-wifi]').getAttribute('aria-label')
    }))));
    if (!expected.length) throw new Error('No populated flight segments for accessibility audit');
    const cdp = await browser.newCDPSession(page);
    const { nodes } = await cdp.send('Accessibility.getFullAXTree');
    const byId = new Map(nodes.map(node => [node.nodeId, node]));
    const items = id => { const node = byId.get(id); return !node ? [] : [...(!node.ignored && (node.role?.value === 'image' || node.role?.value === 'note') ? [node.name?.value] : []), ...(node.childIds || []).flatMap(items)]; };
    for (const leg of expected) {
      const found = nodes.some(node => !node.ignored && node.role?.value === 'group' && node.name?.value === leg.flight && JSON.stringify(items(node.nodeId)) === JSON.stringify([leg.seat, leg.wifi]));
      if (!found) throw new Error(`Seat and Wi-Fi not separately exposed in Chrome AX tree: ${leg.flight}`);
    }
    await cdp.detach();
    console.log(`Chrome accessibility audit: ${expected.length} legs expose separate seat and Wi-Fi items`);
  }
  if (togglesRequested) {
    const cdp = await browser.newCDPSession(page);
    const worlds = [];
    cdp.on('Runtime.executionContextCreated', ({ context }) => worlds.push(context));
    await cdp.send('Runtime.enable');
    const world = worlds.find(w => w.name === branding.title || w.origin.startsWith('chrome-extension://'));
    if (!world) throw new Error('Installed extension execution context not found');
    await cdp.send('Runtime.evaluate', { contextId: world.id, expression: `
      globalThis.__layoutAudit = { queries: 0, rects: 0, styles: 0 };
      const query = Document.prototype.querySelectorAll;
      Document.prototype.querySelectorAll = function(...args) { __layoutAudit.queries++; return Reflect.apply(query, this, args); };
      const rects = Element.prototype.getClientRects;
      Element.prototype.getClientRects = function(...args) { __layoutAudit.rects++; return Reflect.apply(rects, this, args); };
      const style = getComputedStyle;
      globalThis.getComputedStyle = function(...args) { __layoutAudit.styles++; return Reflect.apply(style, this, args); };
    ` });
    if (process.env.FLIGHTS_PAINT_AUDIT === '1') await page.evaluate(() => {
      window.__paintAudit = { samples: 0, gaps: 0, examples: [] };
      const affected = new Set();
      let scheduled = false;
      new MutationObserver(records => {
        for (const record of records) {
          if (!(record.target instanceof Element)) continue;
          const row = record.target.closest('li');
          if (!row || !row.querySelector('[jsname="HSrbLb"]')) continue;
          if ([...record.removedNodes].some(node => node instanceof Element && (node.hasAttribute('data-seatspecs-cell') || node.querySelector('[data-seatspecs-cell]')))) affected.add(row);
        }
        if (!affected.size || scheduled) return;
        scheduled = true;
        queueMicrotask(() => queueMicrotask(() => {
          scheduled = false;
          for (const row of affected) {
            if (!row.isConnected || row.querySelector('button[aria-expanded]')?.getAttribute('aria-expanded') !== 'false' || !row.querySelector('[data-gs]') || ![...row.querySelectorAll('[jsname="HSrbLb"]')].some(summary => summary.getClientRects().length)) continue;
            const audit = window.__paintAudit, host = row.querySelector('[data-seatspecs-cell]');
            audit.samples++;
            if (!host || host.hidden) { audit.gaps++; if (audit.examples.length < 5) audit.examples.push({ id: row.querySelector('[data-id]')?.getAttribute('data-id'), missing: !host, hidden: host?.hidden, summaries: [...row.querySelectorAll('[jsname="HSrbLb"]')].map(s => ({ display: getComputedStyle(s).display, visibility: getComputedStyle(s).visibility, opacity: getComputedStyle(s).opacity })) }); }
          }
          affected.clear();
        }));
      }).observe(document, { childList: true, subtree: true });
    });
    const details = page.locator('li:has([jsname="HSrbLb"]) button[jsname="LgbsSe"][aria-expanded]:visible').first();
    const started = Date.now();
    for (let i = 0; i < togglesRequested; i++) await details.click({ force: true });
    if (await details.getAttribute('aria-expanded') === 'true') await details.click({ force: true });
    await page.waitForTimeout(300);
    await page.waitForFunction(() => [...document.querySelectorAll('li')].filter(row => row.querySelector('[jsname="HSrbLb"]') && row.querySelector('button[aria-expanded]') && row.querySelector('[data-gs]') && row.getClientRects().length).every(row => row.querySelector('[data-seatspecs-cell]')), undefined, { timeout: 20000 });
    const work = (await cdp.send('Runtime.evaluate', { contextId: world.id, expression: 'JSON.stringify(__layoutAudit)', returnByValue: true })).result.value;
    console.log(`Deliberate local user toggles: ${togglesRequested}; elapsed ${Date.now() - started}ms; extension work ${work}`);
    if (process.env.FLIGHTS_PAINT_AUDIT === '1') {
      const paint = await page.evaluate(() => window.__paintAudit);
      console.log('Before-paint column audit:', JSON.stringify(paint));
      if (!paint.samples || paint.gaps) throw new Error('Missing cached column before paint');
    }
    if (process.env.FLIGHTS_DEBUG_STATE === '1') {
      const source = await readFile('dist/content.js', 'utf8');
      const line = source.split('\n').findIndex(text => text.includes('function flush()')) + 1;
      await cdp.send('Debugger.enable');
      const breakpoint = await cdp.send('Debugger.setBreakpointByUrl', { urlRegex: 'chrome-extension://.*/content\\.js', lineNumber: line });
      const paused = new Promise(resolve => cdp.once('Debugger.paused', async event => {
        const state = await cdp.send('Debugger.evaluateOnCallFrame', { callFrameId: event.callFrames[0].callFrameId, returnByValue: true, expression: `JSON.stringify({tracked:rows.size,records:records.size,urgent:urgent.size,background:background.size,counts:[...rows.values()].reduce((a,s)=>{const k=!s.binding?'unbound':s.binding.host.isConnected?'bound':'detached';a[k]=(a[k]||0)+1;return a},{}),missing:[...rows.values()].filter(s=>!s.binding||!s.binding.host.isConnected).slice(0,8).map(s=>({id:s.id,dormant:s.dormant,flags:s.flags,connected:s.row.isConnected,summary:s.summary?.className,summaryConnected:s.summary?.isConnected,expanded:s.button?.getAttribute('aria-expanded'),priceTokens:s.row.querySelectorAll('[data-gs]').length,parent:s.binding?.parent.className,parentConnected:s.binding?.parent.isConnected,priceConnected:s.binding?.price.isConnected,record:records.has(s.id)}))})` });
        console.log('Renderer diagnostic state:', state.result.value);
        await cdp.send('Debugger.resume'); resolve();
      }));
      await page.evaluate(() => dispatchEvent(new Event('resize')));
      await paused;
      await cdp.send('Debugger.removeBreakpoint', { breakpointId: breakpoint.breakpointId });
      await cdp.send('Debugger.disable');
    }
    await cdp.detach();
  }
  console.log(JSON.stringify(await page.evaluate(() => ({
    url: location.href, audit: window.__seatAudit,
    layout: (() => {
      const parent = document.querySelector('[data-seatspecs-cell]')?.parentElement;
      if (!parent) return null;
      return { className: parent.className, display: getComputedStyle(parent).display, columns: getComputedStyle(parent).gridTemplateColumns,
        children: [...parent.children].map(e => ({ tag: e.tagName, className: e.className, text: e.textContent.slice(0, 100), area: getComputedStyle(e).gridArea, display: getComputedStyle(e).display, rect: e.getBoundingClientRect().toJSON() })) };
    })(),
    nativeRows: [...document.querySelectorAll('li')].filter(r => r.querySelector('[jsname="HSrbLb"]') && r.querySelector('button[aria-expanded]') && r.getClientRects().length).length,
    pricedRows: [...document.querySelectorAll('li')].filter(r => r.querySelector('[jsname="HSrbLb"]') && r.querySelector('button[aria-expanded]') && r.querySelector('[data-gs]') && r.getClientRects().length).length,
    total: document.querySelectorAll('[data-seatspecs-cell]').length,
    wifiStates: (() => {
      const counts = {};
      for (const cell of document.querySelectorAll('[data-seatspecs-cell]')) for (const icon of cell.shadowRoot?.querySelectorAll('[data-wifi-status]') || []) {
        const state = icon.dataset.wifiStatus;
        counts[state] = (counts[state] || 0) + 1;
      }
      return counts;
    })(),
    unavailable: [...document.querySelectorAll('[data-seatspecs-cell]')].filter(c => ['—', '…'].includes(c.shadowRoot?.querySelector('span')?.textContent)).length,
    cells: [...document.querySelectorAll('[data-seatspecs-cell]')].slice(0, 12).map(cell => ({
      id: cell.dataset.seatspecsId, value: cell.shadowRoot?.querySelector('span')?.textContent,
      segments: [...cell.shadowRoot?.querySelectorAll('.segment') || []].map(group => ({ flight: group.getAttribute('aria-label'), seat: group.querySelector('.seat')?.getAttribute('aria-label'), wifi: group.querySelector('[data-seatspecs-wifi]')?.getAttribute('aria-label') })),
      wifi: [...cell.shadowRoot?.querySelectorAll('[data-wifi-status]') || []].map(icon => ({ state: icon.dataset.wifiStatus })),
      rect: cell.getBoundingClientRect().toJSON(), price: cell.nextElementSibling?.getBoundingClientRect().toJSON(), build: cell.dataset.seatspecsBuild
    }))
  })), null, 2));
  await page.screenshot({ path: 'test-results/live-smoke.png', fullPage: process.env.FLIGHTS_FULL_PAGE !== '0' });
  const audit = await page.evaluate(() => window.__seatAudit);
  if ((!togglesRequested && audit.expansions) || audit.programmaticActions) throw new Error('Unexpected flight-detail expansion or programmatic click');
} catch (error) {
  if (page && !page.isClosed()) {
    console.error('Live smoke failure state:', JSON.stringify(await page.evaluate(() => {
      const rows = [...document.querySelectorAll('li')].filter(r => r.querySelector('[jsname="HSrbLb"]') && r.querySelector('button[aria-expanded]'));
      return { title: document.title, rows: rows.length, visibleRows: rows.filter(r => r.getClientRects().length).length, cells: document.querySelectorAll('[data-seatspecs-cell]').length,
        sample: rows.filter(r => r.getClientRects().length && !r.querySelector('[data-seatspecs-cell]')).slice(0, 6).map(r => ({ id: r.querySelector('[data-id]')?.getAttribute('data-id'), expanded: r.querySelector('button[aria-expanded]')?.getAttribute('aria-expanded'), prices: r.querySelectorAll('[data-gs]').length, text: r.innerText.slice(-100), summaryDisplay: getComputedStyle(r.querySelector('[jsname="HSrbLb"]')).display })) };
    }).catch(() => null)));
    await page.screenshot({ path: 'test-results/live-smoke-failure.png' }).catch(() => {});
  }
  throw error;
} finally {
  await browser?.close(); await rm(profile, { recursive: true, force: true });
}
