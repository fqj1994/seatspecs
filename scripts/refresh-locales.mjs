// Maintainer-only retrieval. Runtime extension never fetches or executes this JS.
// Extract Google's seat labels using numeric seat cases and the lie-flat SVG,
// not English words. Checked-in catalogs make builds entirely offline.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { parseExpressionAt } from 'acorn';
const locales = JSON.parse(await readFile('data/google-locales.json', 'utf8'));
const statuses = JSON.parse(await readFile('data/status-labels.json', 'utf8'));
const wifiStatuses = JSON.parse(await readFile('data/wifi-status-labels.json', 'utf8'));
const wifiKeys = ['wifi', 'wifiFree', 'wifiPaid', 'wifiUltraFast', 'wifiUltraFastFree', 'wifiUltraFastPaid', 'wifiNotListed', 'wifiUnknown', 'wifiPricingUnknown'];
let catalogs = {};
try { catalogs = JSON.parse(await readFile('src/catalogs.json', 'utf8')); } catch {}
const codes = [1, 2, 3, 4, 5, 6, 8, 9];
function template(node) {
  if (node.type === 'Literal' && typeof node.value === 'string') return node.value;
  if (node.type === 'Identifier') return '{pitch}';
  if (node.type === 'BinaryExpression' && node.operator === '+') return template(node.left) + template(node.right);
  if (node.type === 'ConditionalExpression') return template(node.alternate);
  throw new Error(`Unexpected label expression: ${node.type}`);
}
function labels(js) {
  const icon = js.indexOf('M18 7H9v7h13');
  if (icon < 0) throw new Error('Seat renderer not found');
  const start = js.lastIndexOf('case 1:', icon);
  const out = {};
  for (let i = 0; i < codes.length; i++) {
    const code = codes[i];
    const a = js.indexOf(`case ${code}:`, start);
    const b = i + 1 < codes.length ? js.indexOf(`case ${codes[i + 1]}:`, a + 1) : js.indexOf('switch(', a + 1);
    const section = js.slice(a, b > a ? b : a + 5000);
    const calls = [...section.matchAll(/_\.[PQ]\(/g)];
    if (!calls.length) throw new Error(`Missing label for code ${code}`);
    const expr = parseExpressionAt(section, calls[0].index + calls[0][0].length, { ecmaVersion: 'latest' });
    const label = template(expr).replace(/[（(][^()（）]*\{pitch\}[^()（）]*[)）]/g, '').replace(/\{pitch\}/g, '').trim();
    if (!label || label.includes('<') || label.includes('{pitch}')) throw new Error(`Invalid label ${code}: ${label}`);
    out[code] = label;
  }
  // The next two switches are standard / ultra-fast Wi-Fi. Their enum cases
  // use the same 1=available, 2=free, 3=paid ordering regardless of UI language.
  const regular = js.indexOf('switch(', js.indexOf('case 9:', start));
  const ultraFast = js.indexOf('switch(', regular + 7);
  const afterWifi = js.indexOf('switch(', ultraFast + 7);
  if (regular < 0 || ultraFast < 0) throw new Error('Wi-Fi renderer not found');
  for (const [a, b, keys] of [
    [regular, ultraFast, ['wifi', 'wifiFree', 'wifiPaid']],
    [ultraFast, afterWifi > ultraFast ? afterWifi : ultraFast + 5000, ['wifiUltraFast', 'wifiUltraFastFree', 'wifiUltraFastPaid']]
  ]) {
    const section = js.slice(a, b);
    for (const [index, key] of keys.entries()) {
      const c = section.indexOf(`case ${index + 1}:`);
      const call = c >= 0 ? /_\.[PQ]\(/.exec(section.slice(c)) : null;
      if (!call) throw new Error(`Missing Wi-Fi label: ${key}`);
      const expr = parseExpressionAt(section, c + call.index + call[0].length, { ecmaVersion: 'latest' });
      const label = template(expr);
      if (!label || /[<>{}]/u.test(label)) throw new Error(`Invalid Wi-Fi label: ${key}`);
      out[key] = label;
    }
  }
  return out;
}
async function get(url) {
  for (let n = 0; n < 3; n++) {
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(45000) });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return await r.text();
    } catch (e) { if (n === 2) throw e; }
  }
}
async function load(locale) {
  const page = await get(`https://www.google.com/travel/flights?hl=${locale}`);
  const tag = page.match(/<script\b[^>]*\bid="base-js"[^>]*>/)?.[0];
  const src = tag?.match(/\bsrc="([^"]+)"/)?.[1]?.replaceAll('&amp;', '&');
  if (!src) throw new Error(`Missing Google bundle for ${locale}`);
  const js = await get(src.replace(/\/m=[^/]+$/, '/m=hZsITe'));
  return {
    ...labels(js), seat: statuses[locale][0], loading: statuses[locale][1], unavailable: statuses[locale][2],
    wifiNotListed: wifiStatuses[locale][0], wifiUnknown: wifiStatuses[locale][1], wifiPricingUnknown: wifiStatuses[locale][2]
  };
}
const remaining = locales.filter(locale => process.argv.includes('--all') || !catalogs[locale] || wifiKeys.some(key => !catalogs[locale][key]));
await mkdir('src', { recursive: true });
let failed = false;
await Promise.all(Array.from({ length: 3 }, async () => {
  while (remaining.length) {
    const locale = remaining.shift();
    try {
      catalogs[locale] = await load(locale);
      // Atomic, sequential JS writes: each write includes all completed locales.
      console.log(locale, catalogs[locale].wifiFree, catalogs[locale].wifiUltraFastPaid);
    } catch (error) { console.error(locale, String(error)); failed = true; }
  }
}));
await writeFile('src/catalogs.json', JSON.stringify(Object.fromEntries(locales.filter(l => catalogs[l]).map(l => [l, catalogs[l]])), null, 2) + '\n');
if (failed || locales.some(l => !catalogs[l] || wifiKeys.some(key => !catalogs[l][key]))) process.exitCode = 1;
