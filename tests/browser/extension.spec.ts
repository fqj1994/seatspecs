import { test, expect, chromium, type BrowserContext, type Page } from '@playwright/test';
import { mkdtemp, rm, mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { dataFor, pageHTML, rowHTML, type FlightRow } from './fixture';
import { googleAmenities, googleSegment, itinerary, requestBody, shoppingData, shoppingRequest, transport, RPC } from '../fixtures';
import branding from '../../src/branding.json' with { type: 'json' };
import { labelsFor } from '../../src/i18n';
import { wifiDescription } from '../../src/wifi';
let context: BrowserContext, profile: string;
let page: Page;
const errors: string[] = [];
const base = 'https://www.google.com/travel/flights/search?tfs=fixture&hl=en-US';
// Sanitized facts from the reported return results: Google's emissions/search
// cabin is Business (3), but every actual ANA segment is First (4).
const anaReturnRows: FlightRow[] = [
  ['yJe0mc', '996'], ['R5CRx', '1096'], ['Dtzcvf', '1098'], ['rq8fdb', '478'],
  ['jRAThd', '1134'], ['y1uCKe', '460'], ['WqOu0e', '994'], ['K6cHnf', '464']
].map(([id, number]) => ({ id, number, from: 'OKA', to: 'HND', date: '2026-12-13', carrier: 'NH', cabin: 4, emissionsCabin: 3, code: 4, pitch: null }));
async function open(rows: FlightRow[], locale = 'en-US', bootstrap = true, cabin = 1) {
  await page.route('https://www.google.com/**', async route => {
    if (route.request().isNavigationRequest()) await route.fulfill({ contentType: 'text/html', body: pageHTML(rows, locale, bootstrap, cabin) });
    else await route.abort();
  });
  await page.goto(base.replace('hl=en-US', `hl=${locale}`));
}
const cells = () => page.locator('[data-seatspecs-cell]');
const texts = () => cells().locator('[data-seatspecs-value]'); // Includes full seat icon labels for verification.
const wifiIcons = () => cells().locator('[data-wifi-status]');
const seatLabels = () => cells().locator('.seat');
const wifiLabels = () => cells().locator('[data-seatspecs-wifi]');
async function replaceRows(rows: FlightRow[]) {
  await page.evaluate(html => (window as any).replaceRows(html), rows.map(rowHTML).join(''));
}
async function query(body: string, mode = 'request') {
  return page.evaluate(({ body, mode }) => (window as any).query(body, mode), { body, mode });
}
async function audit() { return page.evaluate(() => (window as any).audit); }
async function noExpansion() {
  const a = await audit(); expect(a.actions).toBe(0); expect(a.expansions).toBe(0);
  await expect(page.locator('[data-details][aria-expanded="true"]')).toHaveCount(0);
}
test.beforeAll(async () => {
  await mkdir('test-results', { recursive: true });
  profile = await mkdtemp(path.resolve('test-results/profile-'));
  context = await chromium.launchPersistentContext(profile, {
    executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || undefined,
    channel: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ? undefined : 'chromium',
    headless: true, viewport: { width: 1440, height: 900 },
    args: [`--disable-extensions-except=${path.resolve('dist')}`, `--load-extension=${path.resolve('dist')}`, '--no-sandbox']
  });
});
test.afterAll(async () => { await context?.close(); if (profile) await rm(profile, { recursive: true, force: true }); });
test.beforeEach(async () => { errors.length = 0; page = await context.newPage(); page.on('pageerror', e => errors.push(e.message)); });
test.afterEach(async () => { expect(errors).toEqual([]); await page.close(); });

test('installed manifest uses SeatSpecs branding and keeps the existing Google-only scope', async () => {
  await open([{ id: 'brand', wifi: 2 }]);
  await expect(texts()).toHaveText('32 in');
  const cdp = await context.newCDPSession(page);
  try {
    const worlds: Array<{ id: number; name: string; origin: string }> = [];
    cdp.on('Runtime.executionContextCreated', event => worlds.push(event.context));
    await cdp.send('Runtime.enable');
    const world = worlds.find(w => w.name === branding.title || w.origin.startsWith('chrome-extension://'));
    expect(world).toBeTruthy();
    const result = await cdp.send('Runtime.evaluate', { contextId: world!.id, expression: 'chrome.runtime.getManifest()', returnByValue: true });
    const manifest = result.result.value;
    expect(manifest.name).toBe(branding.title);
    expect(manifest.short_name).toBe(branding.name);
    expect(manifest.description).toBe(branding.description);
    expect(manifest.icons).toEqual(Object.fromEntries([16, 32, 48, 128].map(size => [size, `icons/icon${size}.png`])));
    for (const file of Object.values(manifest.icons) as string[]) expect(await readFile(path.resolve('dist', file))).toEqual(await readFile(path.resolve('assets', file)));
    await expect(cells()).toHaveAttribute('data-seatspecs-build', manifest.version_name.split('+')[1]);
    expect(manifest.version_name.split('+')[1]).toMatch(/^[0-9a-f]{12}$/);
    expect(manifest.content_scripts).toHaveLength(2);
    for (const script of manifest.content_scripts) {
      expect(script.matches).toHaveLength(374);
      expect(script.matches.every((match: string) => /^https:\/\/\*\.google\.[a-z.]+\/(?:travel\/\*|flights\*)$/.test(match))).toBe(true);
    }
    expect(manifest.permissions || []).toEqual([]);
    expect(manifest.host_permissions || []).toEqual([]);
  } finally { await cdp.detach(); }
  await noExpansion();
});

test('genuine installed extension: bootstrap, placement, no actions or requests, idle reconciliation', async () => {
  await open([{ id: 'a' }, { id: 'b', code: 5, pitch: null, cabin: 3 }]);
  await expect(texts()).toHaveText(['32 in', 'Lie flat seat']);
  await expect(cells().first()).toHaveAttribute('data-seatspecs-version', '1.0.0');
  const layout = await cells().first().evaluate(cell => {
    const parent = cell.parentElement!; const price = parent.querySelector('[data-seatspecs-price]')!;
    const co2 = parent.querySelector('[data-co2currentflight]')!;
    return { adjacent: cell.nextElementSibling === price, between: !!(co2.compareDocumentPosition(cell) & Node.DOCUMENT_POSITION_FOLLOWING), beforePrice: cell.getBoundingClientRect().right <= price.getBoundingClientRect().left + 1 };
  });
  expect(layout).toEqual({ adjacent: true, between: true, beforePrice: true });
  await noExpansion(); expect((await audit()).requests).toBe(0);
  await page.locator('input').focus(); const scroll = await page.evaluate(() => scrollY);
  await page.waitForTimeout(650); const count = (await audit()).mutations;
  await page.waitForTimeout(350);
  expect((await audit()).mutations).toBe(count);
  expect(await page.evaluate(() => scrollY)).toBe(scroll);
  await expect(page.locator('input')).toBeFocused();
  await page.locator('[data-details]').first().click(); await expect(cells().first()).toBeHidden();
  await page.locator('[data-details]').first().click(); await expect(cells().first()).toBeVisible();
});

test('56px combined column preserves native flight-detail sizing at desktop and tablet widths', async () => {
  const rows: FlightRow[] = [{ id: 'a', code: 6, pitch: null }];
  const native = await context.newPage();
  try {
    await native.route('https://fixture.test/**', route => route.fulfill({ contentType: 'text/html', body: pageHTML(rows) }));
    await native.goto('https://fixture.test/native');
    await open(rows);
    for (const width of [1440, 1024, 800]) {
      for (const p of [native, page]) {
        await p.setViewportSize({ width, height: 900 });
        // Match Google's proportional flight-details column. The previous
        // flex:1 1 0 override collapses this under fixed-width neighbors.
        await p.locator('.time').evaluate(e => { (e as HTMLElement).style.flex = '0 1 40%'; (e as HTMLElement).style.width = 'auto'; });
      }
      const original = await native.locator('.time').evaluate(e => ({ width: e.getBoundingClientRect().width, basis: getComputedStyle(e).flexBasis, shrink: getComputedStyle(e).flexShrink }));
      const added = await page.locator('.time').evaluate(e => ({ width: e.getBoundingClientRect().width, basis: getComputedStyle(e).flexBasis, shrink: getComputedStyle(e).flexShrink }));
      expect(added.basis).toBe(original.basis);
      expect(added.shrink).toBe(original.shrink);
      expect(added.width).toBeGreaterThanOrEqual(original.width * 0.85);
      expect(await cells().evaluate(e => e.getBoundingClientRect().width)).toBe(56);
      expect(await page.locator('.summary').evaluate(e => getComputedStyle(e).columnGap)).toBe(await native.locator('.summary').evaluate(e => getComputedStyle(e).columnGap));
      expect(await page.locator('.price').evaluate(e => getComputedStyle(e).flexShrink)).toBe(await native.locator('.price').evaluate(e => getComputedStyle(e).flexShrink));
    }
    await expect(cells().locator('svg[data-seat-code="6"]')).toBeVisible();
    await expect(seatLabels()).toHaveAccessibleName(/Individual suite/);
    await noExpansion();
  } finally { await native.close(); }
});

test('premium seat glyphs are distinct and retain full localized accessible descriptions', async () => {
  const codes = [4, 5, 6, 8, 9];
  await open(codes.map(code => ({ id: `type-${code}`, code, pitch: null })), 'ar');
  await expect(cells()).toHaveCount(codes.length);
  const paths: string[] = [];
  for (const [index, code] of codes.entries()) {
    const cell = cells().nth(index);
    await expect(cell.locator(`svg[data-seat-code="${code}"]`)).toBeVisible();
    await expect(cell.locator('.seat')).toHaveAccessibleName(new RegExp(labelsFor('ar')[String(code)]));
    expect(await cell.evaluate(e => e.getBoundingClientRect().width)).toBe(56);
    paths.push(await cell.locator('svg[data-seat-code]').evaluate(svg => [...svg.querySelectorAll('path')].map(p => p.getAttribute('d')).join('|')));
  }
  expect(new Set(paths).size).toBe(codes.length);
  await noExpansion();
});

test('connecting values stack vertically without widening the column', async () => {
  await open([{ id: 'a', emissions: false }], 'en-US', false);
  const data = shoppingData([itinerary('a', [googleSegment(3, '32 in'), googleSegment(3, '33 in', 1, 'ICN', 'LHR', '907')])]);
  await page.route(`https://www.google.com${RPC}*`, route => route.fulfill({ contentType: 'application/json', body: transport(data) }));
  await query(requestBody());
  await expect(texts()).toHaveText(['32 in / 33 in']);
  const dimensions = await cells().evaluate(cell => {
    const lines = [...cell.shadowRoot!.querySelectorAll('.segment .seat')].map(e => e.getBoundingClientRect());
    return { width: cell.getBoundingClientRect().width, stacked: lines[1].top >= lines[0].bottom, visible: lines.every(r => r.width > 0 && r.height > 0) };
  });
  expect(dimensions).toEqual({ width: 56, stacked: true, visible: true });
  expect(await cells().locator('.segment').evaluateAll(groups => groups.map(g => g.getAttribute('aria-label')).join('; '))).toMatch(/KE 752.*KE 907/);
  await noExpansion();
});

test('Wi-Fi uses distinct collapsed-view icons and localized accessible descriptions, never inline label text', async () => {
  const cases: Array<FlightRow & { expected: string | null; label: string }> = [
    { id: 'none', wifi: 0, expected: null, label: 'wifiNotListed' },
    { id: 'free', wifi: 2, expected: 'free', label: 'wifiFree' },
    { id: 'paid', wifi: 3, expected: 'paid', label: 'wifiPaid' },
    { id: 'unpriced', wifi: 1, expected: 'available', label: 'wifiPricingUnknown' },
    { id: 'unknown', expected: null, label: 'wifiUnknown' },
    { id: 'mixed', wifi: 2, ultraFastWifi: 3, expected: 'mixed', label: 'wifiPaid' },
    { id: 'ultra-free', ultraFastWifi: 2, expected: 'free', label: 'wifiFree' }
  ];
  await open(cases);
  await expect(texts()).toHaveText(cases.map(() => '32 in'));
  const glyphs = new Set<string>();
  for (const [i, state] of cases.entries()) {
    const icon = cells().nth(i).locator('[data-wifi-status]');
    await expect(cells().nth(i).locator('[data-seatspecs-wifi]')).toHaveAccessibleName(new RegExp(labelsFor('en-US')[state.label]));
    if (state.expected === null) {
      await expect(icon).toHaveCount(0);
      await expect(cells().nth(i).locator('.wifi')).toHaveCount(0);
      continue;
    }
    await expect(icon).toHaveAttribute('data-wifi-status', state.expected);
    await expect(icon.locator('svg')).toBeVisible();
    expect(await icon.textContent()).toBe(''); // No translated wording rendered inside the column.
    glyphs.add(await icon.locator('svg').evaluate(svg => svg.innerHTML));
  }
  expect(glyphs.size).toBe(4);
  expect(await wifiLabels().nth(5).getAttribute('aria-label')).toContain(labelsFor('en-US').wifiFree);
  expect((await audit()).requests).toBe(0);
  await noExpansion();
});

test('paid Wi-Fi uses a dollar badge, including mixed free/paid service options', async () => {
  await open([{ id: 'free', wifi: 2 }, { id: 'paid', wifi: 3 }, { id: 'mixed', wifi: 2, ultraFastWifi: 3 }, { id: 'unpriced', wifi: 1 }]);
  await expect(wifiIcons()).toHaveCount(4);
  for (const index of [1, 2]) {
    const icon = wifiIcons().nth(index);
    await expect(icon.locator('[data-wifi-badge="dollar"]')).toBeVisible();
    await expect(icon.locator('circle[r="4"]')).toHaveCount(0);
    expect(await icon.textContent()).toBe('');
  }
  for (const index of [0, 3]) await expect(wifiIcons().nth(index).locator('[data-wifi-badge="dollar"]')).toHaveCount(0);
  expect(await wifiLabels().nth(1).getAttribute('aria-label')).toContain(labelsFor('en-US').wifiPaid);
  expect(await wifiLabels().nth(2).getAttribute('aria-label')).toContain(labelsFor('en-US').wifiPaid);
  await noExpansion();
});

test('extension cells suppress native hover tooltips but retain complete accessible descriptions', async () => {
  const rows: FlightRow[] = [
    { id: 'seat', code: 5, pitch: null, wifi: 2, ultraFastWifi: 3 },
    { id: 'pitch', pitch: '７９ センチメートル', wifi: 3 }
  ];
  await open(rows);
  await expect(texts()).toHaveText(['Lie flat seat', '７９ センチメートル']);
  await page.locator('.summary').first().evaluate(parent => parent.setAttribute('title', 'Native Google tooltip'));
  const noTooltips = async () => {
    // An empty host title also prevents inheriting a native ancestor's tooltip.
    for (const cell of await cells().all()) await expect(cell).toHaveAttribute('title', '');
    expect(await cells().evaluateAll(nodes => nodes.every(cell => cell.shadowRoot!.querySelector('[title], title') === null))).toBe(true);
    await expect(page.locator('.summary').first()).toHaveAttribute('title', 'Native Google tooltip');
  };
  await noTooltips();
  await expect(seatLabels().first()).toHaveAccessibleName(/Lie flat seat/);
  await expect(wifiLabels().first()).toHaveAccessibleName('Free Wi-Fi; Wi-Fi for a fee');
  await expect(seatLabels().last()).toHaveAccessibleName(/７９ センチメートル/);
  await expect(wifiLabels().last()).toHaveAccessibleName(/Wi-Fi for a fee/);
  await page.route(`https://www.google.com${RPC}*`, route => route.fulfill({ body: transport(dataFor([{ ...rows[0], code: 8, wifi: 3, ultraFastWifi: 2 }, rows[1]])) }));
  await query(requestBody());
  await expect(seatLabels().first()).toHaveAccessibleName(/Standard recliner seat/);
  await expect(wifiLabels().first()).toHaveAccessibleName('Free Wi-Fi; Wi-Fi for a fee');
  await noTooltips();
  await cells().first().evaluate(cell => cell.remove());
  await expect(cells()).toHaveCount(2);
  await page.locator('[data-details]').first().click();
  await page.locator('[data-details]').first().click();
  await expect(cells().first()).toBeVisible();
  await noTooltips();
  expect((await audit()).actions).toBe(0);
});

test('Chrome exposes separate seat and Wi-Fi names per leg, without a combined summary or duplicate text', async () => {
  await open([{ id: 'ax', emissions: false }], 'en-US', false);
  const first = googleSegment(3, '32 in'); first[30] = 'Above average legroom (32 in)'; first[12] = googleAmenities(2);
  const second = googleSegment(5, null, 3, 'ICN', 'SFO', '907'); second[12] = googleAmenities(null, 3);
  const third = googleSegment(6, null, 4, 'SFO', 'LAX', '908');
  await page.route(`https://www.google.com${RPC}*`, route => route.fulfill({ body: transport(shoppingData([itinerary('ax', [first, second, third])])) }));
  await query(requestBody());
  await expect(texts()).toHaveText('32 in / Lie flat seat / Individual suite');
  const labels = labelsFor('en-US');
  const expected = [
    { flight: 'HND–ICN · KE 752', seat: `${labels.seat}: Above average legroom (32 in)`, wifi: labels.wifiFree },
    { flight: 'ICN–SFO · KE 907', seat: `${labels.seat}: ${labels['5']}`, wifi: labels.wifiPaid },
    { flight: 'SFO–LAX · KE 908', seat: `${labels.seat}: ${labels['6']}`, wifi: `${labels.wifi}: ${labels.wifiUnknown}` }
  ];
  for (const [i, leg] of expected.entries()) {
    const group = cells().locator('.segment').nth(i);
    await expect(group).toHaveAccessibleName(leg.flight);
    await expect(group.locator('.seat')).toHaveAccessibleName(leg.seat);
    await expect(group.locator('[data-seatspecs-wifi]')).toHaveAccessibleName(leg.wifi);
  }
  await expect(wifiIcons()).toHaveCount(2); // Unknown is accessible, never a visible badge.
  await expect(wifiLabels().last()).toHaveAttribute('role', 'note');
  const cdp = await context.newCDPSession(page);
  try {
    // Attribute-only assertions miss aria-hidden ancestors and atomic wrappers.
    // Verify Chrome's actual tree, including display:contents and Shadow DOM.
    const verifyTree = async () => {
      const { nodes } = await cdp.send('Accessibility.getFullAXTree');
      const byId = new Map(nodes.map(node => [node.nodeId, node]));
      for (const leg of expected) {
        const group = nodes.find(n => !n.ignored && n.role?.value === 'group' && n.name?.value === leg.flight);
        expect(group, `Accessible group ${leg.flight}`).toBeTruthy();
        const descend = (id: string): typeof nodes => { const node = byId.get(id)!; return [node, ...(node.childIds || []).flatMap(descend)]; };
        const children = descend(group!.nodeId).filter(node => !node.ignored);
        expect(children.filter(n => n.role?.value === 'image' || n.role?.value === 'note').map(n => n.name?.value)).toEqual([leg.seat, leg.wifi]);
        expect(children.filter(n => n.role?.value === 'StaticText')).toEqual([]);
      }
      expect(nodes.some(n => !n.ignored && n.name?.value?.includes(`${labels.seat} / ${labels.wifi}:`))).toBe(false);
    };
    await verifyTree();
    first[12] = null;
    await query(requestBody());
    await expect(wifiIcons()).toHaveCount(1);
    expected[0].wifi = `${labels.wifi}: ${labels.wifiUnknown}`;
    await verifyTree();
    await cells().evaluate(cell => cell.remove());
    await expect(cells()).toHaveCount(1);
    await verifyTree();
    await page.locator('[data-details]').click();
    await expect(cells()).toBeHidden();
    const hidden = await cdp.send('Accessibility.getFullAXTree');
    expect(hidden.nodes.some(node => !node.ignored && expected.some(leg => node.name?.value === leg.flight))).toBe(false);
    await page.locator('[data-details]').click();
    await expect(cells()).toBeVisible();
    await verifyTree();
  } finally { await cdp.detach(); }
  expect((await audit()).actions).toBe(0);
});

test('Wi-Fi-only responses update the existing cell and survive snapshot replay', async () => {
  await open([{ id: 'a', wifi: 2 }]);
  await expect(wifiIcons()).toHaveAttribute('data-wifi-status', 'free');
  await cells().evaluate(cell => (cell as HTMLElement).dataset.testIdentity = 'original');
  const body = transport(dataFor([{ id: 'a', wifi: 3 }]));
  await page.route(`https://www.google.com${RPC}*`, route => route.fulfill({ body }));
  expect(await query(requestBody())).toBe(body);
  await expect(wifiIcons()).toHaveAttribute('data-wifi-status', 'paid');
  await expect(texts()).toHaveText(['32 in']);
  await expect(cells()).toHaveAttribute('data-test-identity', 'original');
  const replay = await page.evaluate(async () => {
    const result = await new Promise<unknown[]>(resolve => {
      const records: unknown[] = [];
      const listener = (event: MessageEvent) => {
        if (event.source === window && event.origin === location.origin && event.data?.source === 'seatspecs-data' && event.data?.version === 2 && event.data?.type === 'results-upsert') records.push(...event.data.results);
      };
      addEventListener('message', listener);
      postMessage({ source: 'seatspecs-ui', version: 2, type: 'ready' }, location.origin);
      setTimeout(() => { removeEventListener('message', listener); resolve(records); }, 100);
    });
    return result;
  }) as Array<{ segments: Array<{ wifi: { standard: string } }> }>;
  expect(replay[0].segments[0].wifi.standard).toBe('paid');
  await expect(cells()).toHaveAttribute('data-test-identity', 'original');
  await expect(cells()).toHaveCount(1);
  expect((await audit()).requests).toBe(1);
  await noExpansion();
});

test('seat glyphs and pitch values sit only 2px from Wi-Fi in either text direction', async () => {
  await open([
    { id: 'premium', code: 5, pitch: null, wifi: 3 },
    { id: 'pitch', pitch: '32 in', wifi: 2 },
    { id: 'localized', pitch: '７９ 厘米', wifi: 2 }
  ]);
  await expect(wifiIcons()).toHaveCount(3);
  for (const direction of ['ltr', 'rtl']) {
    await page.evaluate(dir => document.documentElement.dir = dir, direction);
    const gaps = await cells().evaluateAll(nodes => nodes.map(cell => {
      const line = cell.shadowRoot!.querySelector('.segment')!;
      // Measure the visible content, not the padded seat wrapper. The old
      // 38px grid track hid another 10px of whitespace around an 18px icon.
      const seat = line.querySelector('.seat svg, .seat .measurement')!.getBoundingClientRect();
      const wifi = line.querySelector('.wifi')!.getBoundingClientRect();
      return getComputedStyle(line).direction === 'rtl' ? seat.left - wifi.right : wifi.left - seat.right;
    }));
    for (const gap of gaps) expect(gap).toBeCloseTo(2, 1);
  }
  await noExpansion();
});

test('connecting flight Wi-Fi stays aligned with its own seat value without increasing line height', async () => {
  await open([{ id: 'a', emissions: false }], 'en-US', false);
  const first = googleSegment(3, '32 in'), second = googleSegment(3, '33 in', 1, 'ICN', 'LHR', '907');
  first[12] = googleAmenities(2); second[12] = googleAmenities(null, 3);
  await page.route(`https://www.google.com${RPC}*`, route => route.fulfill({ body: transport(shoppingData([itinerary('a', [first, second])])) }));
  await query(requestBody());
  await expect(texts()).toHaveText(['32 in / 33 in']);
  expect(await wifiIcons().evaluateAll(icons => icons.map(i => (i as HTMLElement).dataset.wifiStatus))).toEqual(['free', 'paid']);
  for (const direction of ['ltr', 'rtl']) {
    await page.evaluate(dir => document.documentElement.dir = dir, direction);
    const layout = await cells().evaluate(cell => [...cell.shadowRoot!.querySelectorAll('.segment')].map(line => {
      const seat = line.querySelector('.seat')!.getBoundingClientRect(), wifi = line.querySelector('.wifi')!.getBoundingClientRect();
      return { height: seat.height, seatWidth: seat.width, wifiWidth: wifi.width, aligned: Math.abs(seat.top - wifi.top) < 1,
        separate: getComputedStyle(line).direction === 'rtl' ? wifi.right <= seat.left : seat.right <= wifi.left };
    }));
    for (const { seatWidth, ...geometry } of layout) {
      expect(seatWidth).toBeGreaterThan(0);
      expect(seatWidth).toBeLessThanOrEqual(38);
      expect(geometry).toEqual({ height: 18, wifiWidth: 16, aligned: true, separate: true });
    }
  }
  await expect(wifiLabels().nth(1)).toHaveAccessibleName(labelsFor('en-US').wifiPaid);
  await noExpansion();
});

for (const [name, pitches] of [
  ['pitch', ['32 in', '33 in']],
  ['localized pitch', ['７９ 厘米', '８１ 厘米']]
] as const) {
  test(`multi-leg ${name} and seat icons share columns when one leg has unknown Wi-Fi`, async () => {
    await open([{ id: 'a', emissions: false }], 'en-US', false);
    const first = googleSegment(3, pitches[0]), second = googleSegment(3, pitches[1], 1, 'ICN', 'SFO', '907');
    const third = googleSegment(5, null, 3, 'SFO', 'LAX', '908');
    first[12] = googleAmenities(2); third[12] = googleAmenities(3);
    await page.route(`https://www.google.com${RPC}*`, route => route.fulfill({ body: transport(shoppingData([itinerary('a', [first, second, third])])) }));
    await query(requestBody());
    await expect(cells().locator('.segment')).toHaveCount(3);
    await expect(cells().locator('.segment').nth(1).locator('.wifi')).toHaveCount(0);
    for (const width of [1440, 390]) for (const direction of ['ltr', 'rtl']) {
      await page.setViewportSize({ width, height: 900 });
      await page.evaluate(dir => document.documentElement.dir = dir, direction);
      const geometry = await cells().evaluate(cell => [...cell.shadowRoot!.querySelectorAll('.segment')].map(line => {
        const seat = line.querySelector('.seat')!.getBoundingClientRect();
        const content = line.querySelector('.seat svg, .seat .measurement')!.getBoundingClientRect();
        const wifi = line.querySelector('.wifi')?.getBoundingClientRect();
        const rtl = getComputedStyle(line).direction === 'rtl';
        return { left: seat.left, right: seat.right, top: seat.top, height: seat.height,
          contentEnd: rtl ? content.left : content.right,
          wifiStart: wifi ? rtl ? wifi.right : wifi.left : null,
          gap: wifi ? rtl ? content.left - wifi.right : wifi.left - content.right : null };
      }));
      for (const [index, row] of geometry.entries()) {
        expect(row.left).toBeCloseTo(geometry[0].left, 1);
        expect(row.right).toBeCloseTo(geometry[0].right, 1);
        expect(row.contentEnd).toBeCloseTo(geometry[0].contentEnd, 1);
        expect(row.top - geometry[0].top).toBeCloseTo(index * 18, 1);
        expect(row.height).toBe(18);
        if (row.gap !== null) {
          expect(row.gap).toBeCloseTo(2, 1);
          expect(row.wifiStart).toBeCloseTo(geometry[0].wifiStart!, 1);
        }
      }
    }
    await noExpansion();
  });
}

test('a missing Wi-Fi segment leaves only its own slot blank', async () => {
  await open([{ id: 'a', emissions: false }], 'en-US', false);
  const first = googleSegment(3, '32 in'), second = googleSegment(3, '33 in', 1, 'ICN', 'LHR', '907');
  first[12] = googleAmenities(2);
  await page.route(`https://www.google.com${RPC}*`, route => route.fulfill({ body: transport(shoppingData([itinerary('a', [first, second])])) }));
  await query(requestBody());
  await expect(texts()).toHaveText(['32 in / 33 in']);
  const lines = cells().locator('.segment');
  await expect(lines).toHaveCount(2);
  await expect(lines.nth(0).locator('[data-wifi-status]')).toHaveAttribute('data-wifi-status', 'free');
  await expect(lines.nth(1).locator('.wifi')).toHaveCount(0);
  expect(await lines.evaluateAll(nodes => nodes.map(line => line.querySelector('.seat')!.getBoundingClientRect().height))).toEqual([18, 18]);
  await noExpansion();
});

test('unlisted, missing, or malformed Wi-Fi leaves seats intact with no badge', async () => {
  await open([
    { id: 'missing', amenities: null }, { id: 'empty', amenities: [] }, { id: 'nulls', amenities: Array(13).fill(null) },
    { id: 'malformed', amenities: 'unknown' }, { id: 'future', amenities: googleAmenities(99, 99) },
    { id: 'unlisted', amenities: googleAmenities(null, null) }
  ]);
  await expect(texts()).toHaveText(Array(6).fill('32 in'));
  await expect(wifiIcons()).toHaveCount(0);
  await expect(cells().locator('.wifi')).toHaveCount(0);
  await noExpansion();
});

test('Wi-Fi badges disappear when data is removed and return for known availability', async () => {
  await open([{ id: 'a', wifi: 2 }]);
  await expect(wifiIcons()).toHaveAttribute('data-wifi-status', 'free');
  await cells().evaluate(cell => (cell as HTMLElement).dataset.testIdentity = 'original');
  const cases: Array<{ row: FlightRow; expected: string | null }> = [
    { row: { id: 'a', amenities: null }, expected: null },
    { row: { id: 'a', wifi: 0 }, expected: null },
    { row: { id: 'a', wifi: 3 }, expected: 'paid' },
    { row: { id: 'a', wifi: 1 }, expected: 'available' },
    { row: { id: 'a', amenities: googleAmenities(99, 99) }, expected: null }
  ];
  for (const { row, expected } of cases) {
    await page.route(`https://www.google.com${RPC}*`, route => route.fulfill({ body: transport(dataFor([row])) }));
    await query(requestBody());
    if (expected === null) await expect(wifiIcons()).toHaveCount(0);
    else await expect(wifiIcons()).toHaveAttribute('data-wifi-status', expected);
    await expect(texts()).toHaveText(['32 in']);
    await expect(cells()).toHaveCount(1);
    await expect(cells()).toHaveAttribute('data-test-identity', 'original');
    expect(await cells().evaluate(cell => cell.getBoundingClientRect().width)).toBe(56);
  }
  await noExpansion();
});

test('ANA First Class results retain Wi-Fi despite Business emissions metadata', async () => {
  await open(anaReturnRows.map(row => ({ ...row, wifi: 2 })), 'en-US', true, 3);
  await expect(texts()).toHaveText(Array(8).fill('Extra reclining seat'));
  expect(await wifiIcons().evaluateAll(icons => icons.map(i => (i as HTMLElement).dataset.wifiStatus))).toEqual(Array(8).fill('free'));
  await noExpansion();
});

test('captures Request and URL fetch inputs, untouched responses, pagination and 170 appended rows', async () => {
  await open([{ id: 'a' }]); await expect(texts()).toHaveText(['32 in']);
  const rows: FlightRow[] = Array.from({ length: 170 }, (_, n) => ({ id: n ? `page-${n}` : 'a', pitch: `${29 + n % 7} cm`, wifi: [0, 2, 3][n % 3] }));
  const body = transport(dataFor(rows));
  await page.route(`https://www.google.com${RPC}*`, route => route.fulfill({ contentType: 'application/json', body }));
  await page.evaluate(() => history.replaceState({}, '', location.href + '&tfu=more'));
  expect(await query(requestBody(shoppingRequest(1, '2026-12-04', 1)))).toBe(body);
  await replaceRows(rows);
  await expect(cells()).toHaveCount(170); await expect(texts().first()).toHaveText('29 cm'); await expect(texts().last()).toHaveText('30 cm');
  await expect(cells().first().locator('[data-wifi-status]')).toHaveCount(0);
  await expect(wifiIcons()).toHaveCount(113);
  await expect(cells().last().locator('[data-wifi-status]')).toHaveAttribute('data-wifi-status', 'free');
  expect(await query(requestBody(shoppingRequest(1, '2026-12-04', 1)), 'url')).toBe(body);
  expect((await audit()).requests).toBe(2); await noExpansion();
});

test('XHR text/json and missing data never consume or corrupt native responses', async () => {
  await open([{ id: 'a' }], 'en-US', false);
  const data = dataFor([{ id: 'a', code: 6, pitch: null, cabin: 1 }]);
  const body = transport(data);
  await page.route(`https://www.google.com${RPC}*`, route => route.fulfill({ contentType: 'application/json', body }));
  expect(await query(requestBody(), 'xhr')).toBe(body);
  await expect(texts()).toHaveText(['Individual suite']);
  await page.route(`https://www.google.com${RPC}*`, route => route.fulfill({ contentType: 'application/json', body: JSON.stringify(dataFor([{ id: 'a', code: null, pitch: null }])) }));
  await query(requestBody(), 'json'); await expect(texts()).toHaveText(['—']);
  await expect(seatLabels()).toHaveAccessibleName(/unavailable/); await noExpansion();
});

test('late bootstrap scripts and results arriving before rows are both observed', async () => {
  await open([{ id: 'late' }], 'en-US', false);
  await expect(texts()).toHaveText(['…']);
  await page.evaluate(data => (window as any).addBootstrap(data), dataFor([{ id: 'late', pitch: '34 in' }]));
  await expect(texts()).toHaveText(['34 in']);
  await replaceRows([]);
  await page.route(`https://www.google.com${RPC}*`, route => route.fulfill({ body: transport(dataFor([{ id: 'before', pitch: '35 in' }])) }));
  await query(requestBody()); await replaceRows([{ id: 'before' }]);
  await expect(texts()).toHaveText(['35 in']); await noExpansion();
});

for (const delayed of ['button', 'identity', 'price-token']) {
  test(`incrementally appended rows recover when their ${delayed} arrives later`, async () => {
    await open([], 'en-US', false);
    const row: FlightRow = { id: 'assembled', wifi: 2 };
    await page.evaluate(({ html, delayed }) => {
      const wrapper = document.createElement('div'); wrapper.innerHTML = (window as any).fixturePolicy.createHTML(html);
      const li = wrapper.firstElementChild!;
      if (delayed === 'button') { const button = li.querySelector('[data-details]')!; (window as any).lateButton = button; button.remove(); }
      else if (delayed === 'identity') li.querySelector('[data-id]')!.removeAttribute('data-id');
      else li.querySelector('[data-gs]')!.removeAttribute('data-gs');
      document.querySelector('main > ul')!.append(li);
    }, { html: rowHTML(row), delayed });
    // Allow discovery to encounter genuinely incomplete markup first.
    await page.evaluate(() => new Promise<void>(r => requestAnimationFrame(() => requestAnimationFrame(() => r()))));
    await expect(cells()).toHaveCount(0);
    await page.route(`https://www.google.com${RPC}*`, route => route.fulfill({ body: transport(dataFor([row])) }));
    await query(requestBody());
    await page.evaluate(delayed => {
      const li = document.querySelector('main > ul > li')!;
      if (delayed === 'button') li.firstElementChild!.append((window as any).lateButton);
      else if (delayed === 'identity') li.firstElementChild!.setAttribute('data-id', 'assembled');
      else li.querySelector('.price span')!.setAttribute('data-gs', 'synthetic');
    }, delayed);
    await expect(cells()).toHaveCount(1);
    await expect(texts()).toHaveText(['32 in']);
    await expect(wifiIcons()).toHaveAttribute('data-wifi-status', 'free');
    await noExpansion();
  });
}

test('failed native requests remain failures and loading settles without retries', async () => {
  await open([{ id: 'a' }], 'en-US', false);
  await page.route(`https://www.google.com${RPC}*`, route => route.abort('failed'));
  const failed = await page.evaluate(async body => {
    try { await (window as any).query(body); return false; } catch { return true; }
  }, requestBody());
  expect(failed).toBe(true);
  await expect(texts()).toHaveText(['—']);
  await expect(cells()).toHaveAccessibleName(labelsFor('en-US').unavailable);
  await expect(cells()).toHaveAttribute('role', 'note');
  await expect(seatLabels()).toHaveCount(0);
  await expect(wifiLabels()).toHaveCount(0);
  await page.waitForTimeout(200); expect((await audit()).requests).toBe(1); await noExpansion();
});

test('pitch strings are text, malformed bridge messages cannot alter displayed values', async () => {
  const pitch = '<img src=x onerror=alert(1)>';
  await open([{ id: 'a', pitch }]); await expect(texts()).toHaveText([pitch]);
  await expect(cells().locator('img')).toHaveCount(0);
  await page.evaluate(() => postMessage({ source: 'seatspecs-data', version: 1, type: 'results-upsert', generation: 9999, sequence: 99, results: [{ id: 'a', segments: [{ pitch: 'wrong' }] }] }, location.origin));
  await page.waitForTimeout(100); await expect(texts()).toHaveText([pitch]); await noExpansion();
});

test('reused row IDs update for cabins and stale responses cannot overwrite the new search', async () => {
  await open([{ id: 'a' }]); await expect(texts()).toHaveText(['32 in']);
  let release!: () => void;
  const gate = new Promise<void>(r => { release = r; });
  await page.route(`https://www.google.com${RPC}*`, async route => {
    const spec = JSON.parse(JSON.parse(new URLSearchParams(route.request().postData()!).get('f.req')!)[1]);
    const cabin = spec[1][5];
    if (cabin === 1) await gate;
    await route.fulfill({ contentType: 'application/json', body: transport(dataFor([{ id: 'a', code: cabin === 3 ? 5 : 1, pitch: cabin === 3 ? null : '99 in', cabin, wifi: cabin === 3 ? 2 : 3 }])) });
  });
  const old = query(requestBody());
  await expect.poll(async () => (await audit()).requests).toBe(1);
  await page.evaluate(() => history.pushState({}, '', '/travel/flights/search?tfs=business&hl=en-US'));
  // Reuse the very same Google row node, not just the itinerary identifier.
  await page.locator('[data-seatingclass]').evaluate(e => e.setAttribute('data-seatingclass', '3'));
  await query(requestBody(shoppingRequest(3)));
  await expect(texts()).toHaveText(['Lie flat seat']);
  await expect(wifiIcons()).toHaveAttribute('data-wifi-status', 'free');
  release(); await old; await page.waitForTimeout(100);
  await expect(texts()).toHaveText(['Lie flat seat']);
  await expect(wifiIcons()).toHaveAttribute('data-wifi-status', 'free');
  await noExpansion();
});

test('ANA First Class return seats are not rejected by Business emissions metadata', async () => {
  await open(anaReturnRows, 'en-US', true, 3);
  await expect(cells()).toHaveCount(8);
  await expect(texts()).toHaveText(anaReturnRows.map(() => 'Extra reclining seat'));
  for (const cell of await cells().all()) {
    await expect(cell.locator('svg[data-seat-code="4"]')).toBeVisible();
    await expect(cell.locator('.segment')).toHaveAccessibleName(/OKA–HND · NH /);
    await expect(cell.locator('.seat')).toHaveAccessibleName(/Extra reclining seat/);
  }
  expect(await page.locator('[data-seatingclass]').evaluateAll(nodes => nodes.map(n => n.getAttribute('data-seatingclass')))).toEqual(Array(8).fill('3'));
  expect((await audit()).requests).toBe(0);
  await noExpansion();
});

test('return selection replaces outbound data despite different search and actual cabins', async () => {
  const outbound: FlightRow = { id: 'yJe0mc', number: '1097', carrier: 'NH', from: 'HND', to: 'OKA', date: '2026-12-04', cabin: 3, pitch: '39 in', wifi: 3 };
  await open([outbound], 'en-US', true, 3);
  await expect(texts()).toHaveText(['39 in']);
  await page.route(`https://www.google.com${RPC}*`, route => route.fulfill({ contentType: 'application/json', body: transport(dataFor(anaReturnRows.map(row => ({ ...row, wifi: 2 })))) }));
  await page.evaluate(() => history.pushState({}, '', '/travel/flights/search?tfs=selected-outbound&hl=en-US'));
  await replaceRows(anaReturnRows);
  await query(requestBody(shoppingRequest(3, '2026-12-13')));
  await expect(texts()).toHaveText(anaReturnRows.map(() => 'Extra reclining seat'));
  expect(await wifiIcons().evaluateAll(icons => icons.map(i => (i as HTMLElement).dataset.wifiStatus))).toEqual(Array(8).fill('free'));
  await noExpansion();
});

for (const [name, wrong] of [
  ['date', 'OKA-HND-NH-996-20261204'],
  ['flight', 'OKA-HND-NH-995-20261213'],
  ['route', 'HND-OKA-NH-996-20261213']
]) {
  test(`accepting a cabin mismatch still rejects an incorrect ${name}`, async () => {
    await open(anaReturnRows.slice(0, 1), 'en-US', true, 3);
    await expect(texts()).toHaveText(['Extra reclining seat']);
    const emissions = page.locator('[data-travelimpactmodelwebsiteurl]');
    const original = await emissions.getAttribute('data-travelimpactmodelwebsiteurl');
    await emissions.evaluate((node, value) => node.setAttribute('data-travelimpactmodelwebsiteurl', value), `https://www.travelimpactmodel.org/lookup/flight?itinerary=${wrong}`);
    await expect(texts()).toHaveText(['—']);
    await emissions.evaluate((node, value) => node.setAttribute('data-travelimpactmodelwebsiteurl', value!), original);
    await expect(texts()).toHaveText(['Extra reclining seat']);
    await noExpansion();
  });
}

test('mixed connecting flights retain every segment and values survive Google replacement', async () => {
  await open([{ id: 'a', cabin: 3 }], 'zh-CN', false, 3);
  await page.locator('[data-travelimpactmodelwebsiteurl]').evaluate(e => e.setAttribute('data-travelimpactmodelwebsiteurl', 'https://www.travelimpactmodel.org/lookup/flight?itinerary=HND-ICN-KE-752-20261204,ICN-LHR-KE-907-20261204'));
  const data = shoppingData([itinerary('a', [googleSegment(5, null, 3), googleSegment(5, null, 3, 'ICN', 'LHR', '907')])]);
  await page.route(`https://www.google.com${RPC}*`, route => route.fulfill({ contentType: 'application/json', body: transport(data) }));
  await query(requestBody(shoppingRequest(3)));
  await expect(texts()).toHaveText(['平躺座椅 / 平躺座椅']);
  await page.locator('[data-seatspecs-cell]').evaluate(cell => cell.remove());
  await expect(cells()).toHaveCount(1); await expect(texts()).toHaveText(['平躺座椅 / 平躺座椅']);
  expect(await cells().locator('.segment').evaluateAll(groups => groups.map(g => g.getAttribute('aria-label')).join('; '))).toMatch(/KE 752.*KE 907/);
  await noExpansion();
});

for (const locale of ['en-US', 'zh-CN', 'ja', 'fr', 'de', 'ar', 'iw']) {
  test(`Google page locale ${locale}: premium types, native pitch, RTL, narrow and dark layouts`, async () => {
    await open([{ id: 'a', code: 6, pitch: null, cabin: 3, wifi: 2 }, { id: 'b', pitch: '７９ 厘米', wifi: 3 }], locale);
    await expect(texts()).toHaveText([labelsFor(locale)['6'], '７９ 厘米']);
    await expect(cells().first().locator('svg[data-seat-code="6"]')).toBeVisible();
    await expect(seatLabels().first()).toHaveAccessibleName(new RegExp(labelsFor(locale)['6']));
    await expect(wifiIcons().nth(0)).toHaveAttribute('data-wifi-status', 'free');
    await expect(wifiIcons().nth(1)).toHaveAttribute('data-wifi-status', 'paid');
    await expect(wifiLabels().nth(0)).toHaveAccessibleName(wifiDescription({ standard: 'free', ultraFast: 'not-listed' }, labelsFor(locale)));
    await expect(wifiLabels().nth(1)).toHaveAccessibleName(wifiDescription({ standard: 'paid', ultraFast: 'not-listed' }, labelsFor(locale)));
    for (const width of [1440, 800, 390]) {
      await page.setViewportSize({ width, height: 900 });
      const boxes = await cells().first().evaluate(cell => {
        const price = cell.nextElementSibling!;
        const a = cell.getBoundingClientRect(), b = price.getBoundingClientRect();
        const rtl = getComputedStyle(cell).direction === 'rtl';
        return { separate: rtl ? b.right <= a.left + 1 : a.right <= b.left + 1, inside: Math.min(a.left, b.left) >= 0 && Math.max(a.right, b.right) <= innerWidth };
      });
      expect(boxes).toEqual({ separate: true, inside: true });
    }
    await page.evaluate(() => document.body.classList.add('dark'));
    await expect(cells().first()).toHaveCSS('color', 'rgb(238, 238, 238)');
    await noExpansion();
  });
}

for (const direction of ['ltr', 'rtl']) {
  test(`compact explicit Google grid retains flight times and places seats before price (${direction})`, async () => {
    await open([{ id: 'a', code: 5, pitch: null }]);
    await page.setViewportSize({ width: 390, height: 900 });
    await page.evaluate(dir => document.documentElement.dir = dir, direction);
    const html = `<li><div data-id="a"><div jsname="HSrbLb" style="display:grid;grid-template-columns:32px max-content 24px max-content minmax(0,1fr) max-content;gap:4px">
      <div style="grid-area:1/1/span 5">KE</div><div class="departure" style="grid-area:1/2">09:00</div><div style="grid-area:2/2">HND</div>
      <div style="grid-area:1/3">→</div><div class="arrival" style="grid-area:1/4">12:00</div><div style="grid-area:2/4">ICN</div>
      <div class="price" style="grid-area:1/6"><span data-gs="synthetic">¥50,000</span></div><div class="caption" style="grid-area:2/6">Round trip</div>
      <div style="grid-area:4/2/auto/span 5"><span data-co2currentflight="100000" data-seatingclass="1">100 kg CO2e</span></div><div style="grid-area:5/2/auto/span 5"></div>
      </div><button data-details aria-expanded="false">⌄</button></div></li>`;
    await page.evaluate(html => (window as any).replaceRows(html), html);
    await expect(texts()).toHaveText(['Lie flat seat']);
    const layout = await cells().evaluate(cell => {
      const root = cell.parentElement!;
      const seat = cell.getBoundingClientRect(), price = root.querySelector('.price')!.getBoundingClientRect();
      const co2 = root.querySelector('[data-co2currentflight]')!.getBoundingClientRect();
      const dep = root.querySelector('.departure')!.getBoundingClientRect(), arr = root.querySelector('.arrival')!.getBoundingClientRect();
      return { timesPreserved: dep.width > 25 && arr.width > 25, afterEmissions: seat.top >= co2.bottom,
        separate: getComputedStyle(root).direction === 'rtl' ? price.right <= seat.left : seat.right <= price.left,
        inside: Math.min(seat.left, price.left) >= 0 && Math.max(seat.right, price.right) <= innerWidth };
    });
    expect(layout).toEqual({ timesPreserved: true, afterEmissions: true, separate: true, inside: true });
    await noExpansion();
  });
}

test('show-more initialization batches layout instead of forcing it once per flight', async () => {
  const cdp = await context.newCDPSession(page);
  await cdp.send('Performance.enable');
  const rows: FlightRow[] = Array.from({ length: 360 }, (_, i) => ({ id: `many-${i}`, wifi: i % 2 ? 2 : 3 }));
  await open(rows);
  await expect(cells()).toHaveCount(rows.length, { timeout: 20000 });
  await expect(texts().last()).toHaveText('32 in');
  await page.waitForTimeout(650);
  const metrics = Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map(m => [m.name, m.value]));
  console.log('show-more initialization metrics', JSON.stringify({ rows: rows.length, layouts: metrics.LayoutCount, stylePasses: metrics.RecalcStyleCount, scriptSeconds: metrics.ScriptDuration }));
  expect(metrics.LayoutCount).toBeLessThan(100);
  expect(metrics.RecalcStyleCount).toBeLessThan(160);
  await noExpansion();
  await cdp.detach();
});

test('appending show-more results and rapid user toggles never rescan unrelated flights', async () => {
  const cdp = await context.newCDPSession(page);
  const worlds: Array<{ id: number; name: string; origin: string }> = [];
  cdp.on('Runtime.executionContextCreated', event => worlds.push(event.context));
  await cdp.send('Runtime.enable');
  const rows: FlightRow[] = Array.from({ length: 300 }, (_, i) => ({ id: `stress-${i}`, wifi: 2 }));
  await open(rows);
  await expect(cells()).toHaveCount(rows.length, { timeout: 20000 });
  await expect(texts().last()).toHaveText('32 in');
  await page.waitForTimeout(650);
  const world = worlds.find(w => w.name === branding.title || w.origin.startsWith('chrome-extension://'));
  expect(world, JSON.stringify(worlds)).toBeTruthy();
  // Diagnostic counters run in the actual installed content-script world.
  // They do not inject, replace, or simulate the extension implementation.
  await cdp.send('Runtime.evaluate', { contextId: world!.id, expression: `
    globalThis.__layoutAudit = { queries: 0, rects: 0, styles: 0 };
    const nativeQuery = Document.prototype.querySelectorAll;
    Document.prototype.querySelectorAll = function(...args) { __layoutAudit.queries++; return Reflect.apply(nativeQuery, this, args); };
    const nativeRects = Element.prototype.getClientRects;
    Element.prototype.getClientRects = function(...args) { __layoutAudit.rects++; return Reflect.apply(nativeRects, this, args); };
    const nativeStyle = getComputedStyle;
    globalThis.getComputedStyle = function(...args) { __layoutAudit.styles++; return Reflect.apply(nativeStyle, this, args); };
  ` });
  const counts = async () => (await cdp.send('Runtime.evaluate', { contextId: world!.id, expression: 'JSON.stringify(__layoutAudit)', returnByValue: true })).result.value as string;
  // Google mutates ripple/animation classes outside the result identity. Those
  // changes must not trigger a full result scan or reread every row's geometry.
  await page.evaluate(async () => {
    for (let i = 0; i < 12; i++) {
      document.querySelector('#other')!.setAttribute('style', `opacity:${i % 2 ? '.99' : '1'}`);
      for (const summary of document.querySelectorAll('[jsname="HSrbLb"]')) { summary.classList.add('transient'); summary.classList.remove('transient'); }
      await new Promise<void>(r => requestAnimationFrame(() => r()));
    }
  });
  const unrelated = JSON.parse(await counts());
  console.log('unrelated-animation extension work', JSON.stringify(unrelated));
  expect(unrelated.queries).toBe(0);
  expect(unrelated.rects).toBe(0);
  // Simulate Google's details subtree creation/removal, driven by real user
  // clicks. No source under test is injected and no extension probes a result.
  await page.evaluate(() => {
    document.addEventListener('click', event => {
      const button = (event.target as Element).closest('[data-details]');
      if (!button) return;
      const row = button.closest('li')!;
      const expanded = button.getAttribute('aria-expanded') === 'true';
      (row.querySelector('[jsname="HSrbLb"]') as HTMLElement).style.display = expanded ? 'none' : '';
      const details = row.querySelector('[jsname="XxAJue"]')!;
      details.replaceChildren();
      if (expanded) {
        const list = document.createElement('ul');
        for (let i = 0; i < 100; i++) { const li = document.createElement('li'); li.textContent = `Flight amenity ${i}`; list.append(li); }
        details.append(list);
      }
    });
  });
  await cdp.send('Runtime.evaluate', { contextId: world!.id, expression: '__layoutAudit = { queries: 0, rects: 0, styles: 0 }' });
  const toggled = page.locator('[data-details]').first();
  for (let i = 0; i < 24; i++) await toggled.click({ force: true });
  await expect(cells().first()).toBeVisible();
  const toggles = JSON.parse(await counts());
  console.log('24 user toggles extension work', JSON.stringify(toggles));
  expect(toggles.queries).toBe(0);
  expect(toggles.rects).toBeLessThan(200);
  expect(toggles.styles).toBeLessThan(200);
  await cdp.send('Runtime.evaluate', { contextId: world!.id, expression: '__layoutAudit = { queries: 0, rects: 0, styles: 0 }' });
  const extra: FlightRow[] = Array.from({ length: 180 }, (_, i) => ({ id: `append-${i}`, wifi: 3 }));
  await page.evaluate(async batches => {
    for (const html of batches) {
      const wrapper = document.createElement('div');
      wrapper.innerHTML = (window as any).fixturePolicy.createHTML(html);
      document.querySelector('main > ul')!.append(...wrapper.children);
      await new Promise<void>(r => requestAnimationFrame(() => r()));
    }
  }, Array.from({ length: 12 }, (_, i) => extra.slice(i * 15, (i + 1) * 15).map(rowHTML).join('')));
  await expect(cells()).toHaveCount(rows.length + extra.length, { timeout: 20000 });
  await page.route(`https://www.google.com${RPC}*`, route => route.fulfill({ body: transport(dataFor([...rows, ...extra])) }));
  await query(requestBody());
  await expect(texts().last()).toHaveText('32 in');
  await expect(cells().last().locator('[data-wifi-status]')).toHaveAttribute('data-wifi-status', 'paid');
  const append = JSON.parse(await counts());
  console.log('180 appended rows extension work', JSON.stringify(append));
  expect(append.queries).toBe(0);
  expect(append.rects).toBeLessThan(extra.length * 20 + 200);
  // Live Google also removes columns from EVERY result on a single toggle.
  // Include unpriced rows: their missing anchor must not cause repeated layout
  // reads, and cached hosts must return in large, read-before-write batches.
  await page.evaluate(html => {
    const wrapper = document.createElement('div'); wrapper.innerHTML = (window as any).fixturePolicy.createHTML(html);
    for (const row of wrapper.children) { row.setAttribute('data-unpriced', ''); row.querySelector('[data-gs]')!.removeAttribute('data-gs'); }
    document.querySelector('main > ul')!.append(...wrapper.children);
    document.addEventListener('click', event => {
      if (!(event.target as Element).closest('[data-details]')) return;
      document.querySelectorAll('[data-seatspecs-cell]').forEach(cell => {
        const price = cell.nextElementSibling!;
        cell.remove();
        // Google's keyed renderer can move/reinsert an unchanged native price.
        price.parentElement!.append(price);
      });
      document.querySelectorAll('[data-unpriced] [jsname="HSrbLb"]').forEach(summary => summary.classList.toggle('native-update'));
    });
  }, Array.from({ length: 150 }, (_, i) => rowHTML({ id: `unpriced-${i}` })).join(''));
  await page.waitForTimeout(150);
  await cdp.send('Performance.enable');
  const before = Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map(m => [m.name, m.value]));
  await cdp.send('Runtime.evaluate', { contextId: world!.id, expression: '__layoutAudit = { queries: 0, rects: 0, styles: 0 }' });
  for (let i = 0; i < 24; i++) await toggled.click({ force: true });
  await expect(cells()).toHaveCount(rows.length + extra.length);
  const rerender = JSON.parse(await counts());
  const after = Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map(m => [m.name, m.value]));
  console.log('24 full-list native rerenders extension work', JSON.stringify({ ...rerender, layouts: after.LayoutCount - before.LayoutCount }));
  expect(rerender.queries).toBe(0);
  expect(rerender.rects).toBeLessThan(200);
  expect(rerender.styles).toBeLessThan(300);
  expect(after.LayoutCount - before.LayoutCount).toBeLessThan(140);
  expect((await audit()).actions).toBe(0);
  await cdp.detach();
});

for (const layout of ['flex', 'grid'] as const) {
  test(`native ${layout} rerenders restore cached columns before paint, not the next frame`, async () => {
    const count = layout === 'flex' ? 600 : 60;
    await open(Array.from({ length: count }, (_, i) => ({ id: `paint-${i}`, wifi: i % 2 ? 2 : 3 })));
    await expect(cells()).toHaveCount(count, { timeout: 20000 });
    await expect(texts().last()).toHaveText('32 in');
    if (layout === 'grid') {
      await page.evaluate(() => {
        document.documentElement.dir = 'rtl';
        for (const parent of document.querySelectorAll<HTMLElement>('.summary')) {
          parent.style.display = 'grid'; parent.style.gridTemplateColumns = '180px 100px 100px 150px 100px';
          const price = parent.querySelector<HTMLElement>('.price')!; price.style.gridColumn = '5'; price.style.gridRow = '1';
        }
      });
      await expect.poll(() => cells().evaluateAll(nodes => nodes.every(cell => (cell as HTMLElement).style.gridColumn === '2 / 5'))).toBe(true);
    }
    await page.evaluate(layout => {
      const cached = [...document.querySelectorAll<HTMLElement>('[data-seatspecs-cell]')].map(host => ({ host, row: host.closest('li')!, parent: host.parentElement!, price: host.nextElementSibling! }));
      (window as any).paintAudit = { frames: 0, gaps: [] };
      document.addEventListener('click', event => {
        if (!(event.target as Element).closest('[data-details]')) return;
        // Model a native patch during the rendering step. A requestAnimationFrame
        // queued by its mutation observer cannot run until the NEXT frame.
        requestAnimationFrame(() => {
          for (const { host, row, parent, price } of cached) {
            host.remove(); parent.append(price);
            const button = row.querySelector('[data-details]')!; button.replaceWith(button.cloneNode(true));
            if (layout === 'grid') {
              parent.removeAttribute('data-seatspecs-layout'); price.removeAttribute('data-seatspecs-price');
              parent.style.removeProperty('--seatspecs-price-row'); parent.style.removeProperty('--seatspecs-caption-row');
            }
          }
          // Sample after mutation delivery but before the current frame can
          // paint. Waiting for a later locator assertion would miss the blink.
          queueMicrotask(() => queueMicrotask(() => {
            const audit = (window as any).paintAudit;
            for (const { host, row, parent, price } of cached) {
              if (row.querySelector('[data-details]')!.getAttribute('aria-expanded') === 'true') continue;
              if (!host.isConnected || host.hidden || host.nextElementSibling !== price || layout === 'grid' && (parent.getAttribute('data-seatspecs-layout') !== 'grid' || !price.hasAttribute('data-seatspecs-price'))) audit.gaps.push(host.dataset.seatspecsId);
            }
            audit.frames++;
          }));
        });
      });
    }, layout);
    for (let i = 0; i < 8; i++) {
      await page.locator('[data-details]').first().click({ force: true });
      await page.waitForFunction(n => (window as any).paintAudit.frames >= n, i + 1);
    }
    const gaps = await page.evaluate(() => (window as any).paintAudit.gaps as string[]);
    expect(gaps.length, `Before-paint gaps (sample): ${gaps.slice(0, 5).join(', ')}`).toBe(0);
    await expect(cells()).toHaveCount(count);
    expect((await audit()).actions).toBe(0);
  });
}

for (const changed of ['id', 'date'] as const) {
  test(`paint-critical restoration never flashes cached data after the row ${changed} changes`, async () => {
    await open([{ id: 'old', wifi: 2 }]);
    await expect(texts()).toHaveText('32 in');
    const restored = await page.evaluate(changed => new Promise<boolean>(resolve => requestAnimationFrame(() => {
      const host = document.querySelector('[data-seatspecs-cell]')!, row = host.closest('li')!;
      host.remove();
      if (changed === 'id') row.querySelector('[data-id]')!.setAttribute('data-id', 'new');
      else {
        const identity = row.querySelector('[data-travelimpactmodelwebsiteurl]')!;
        identity.setAttribute('data-travelimpactmodelwebsiteurl', identity.getAttribute('data-travelimpactmodelwebsiteurl')!.replace('20261204', '20261205'));
      }
      queueMicrotask(() => queueMicrotask(() => resolve(host.isConnected)));
    })), changed);
    expect(restored).toBe(false);
    await expect(texts()).not.toHaveText('32 in');
    await noExpansion();
  });
}

test('paint-critical repair cannot starve input with an observer reinsertion loop', async () => {
  await open([{ id: 'a', wifi: 2 }]);
  await expect(texts()).toHaveText('32 in');
  const removals = await page.evaluate(() => new Promise<number>(resolve => {
    let removals = 0;
    const parent = document.querySelector('[data-seatspecs-cell]')!.parentElement!;
    const adversarialRenderer = new MutationObserver(records => {
      for (const record of records) for (const node of record.addedNodes) {
        if (node instanceof Element && node.hasAttribute('data-seatspecs-cell') && ++removals <= 1000) node.remove();
      }
    });
    adversarialRenderer.observe(parent, { childList: true });
    parent.querySelector('[data-seatspecs-cell]')!.remove();
    setTimeout(() => { adversarialRenderer.disconnect(); resolve(removals); }, 0);
  }));
  expect(removals).toBeLessThanOrEqual(5);
  await expect(cells()).toHaveCount(1);
  await expect(texts()).toHaveText('32 in');
  await noExpansion();
});

test('missing emissions, malformed data, unchanged prices and unsupported markup fail safely', async () => {
  await open([{ id: 'a', emissions: false, code: 7, pitch: null }, { id: 'b', code: 4, pitch: null }]);
  await expect(texts()).toHaveText(['—', 'Extra reclining seat']);
  await expect(seatLabels().first()).toHaveAccessibleName(/unavailable/);
  await page.locator('.price').first().evaluate(e => e.querySelector('span')!.textContent = '¥51,000');
  await expect(texts()).toHaveText(['—', 'Extra reclining seat']);
  await page.route(`https://www.google.com${RPC}*`, route => route.fulfill({ body: 'not-json' }));
  await query(requestBody()); await expect(texts()).toHaveText(['—', 'Extra reclining seat']);
  await page.locator('[jsname="HSrbLb"]').first().evaluate(e => e.removeAttribute('jsname'));
  // Trigger a real Google row mutation after the adapter is no longer recognizable.
  await page.locator('li').first().evaluate(e => e.classList.add('changed'));
  await expect(cells()).toHaveCount(1); await noExpansion();
});
