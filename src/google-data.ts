import { MAX_RESULTS, type SeatResult, type SeatSegment } from './model';
import { normalizeWifi } from './wifi';
const array = Array.isArray;
const airport = (x: unknown): x is string => typeof x === 'string' && /^[A-Z0-9]{3,4}$/.test(x);
const clean = (x: unknown): string | null => typeof x === 'string' && x.trim().length > 0 && x.length <= 500 ? x.trim() : null;
function date(x: unknown): string | null {
  if (!array(x) || x.length !== 3 || !x.every(Number.isInteger)) return null;
  const [y, m, d] = x;
  return y >= 2000 && y <= 2200 && m >= 1 && m <= 12 && d >= 1 && d <= 31 ? `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}` : null;
}
function segment(s: unknown): SeatSegment | null {
  if (!array(s) || !airport(s[3]) || !airport(s[6]) || !date(s[20]) || !array(s[22])) return null;
  const flight = s[22];
  if (typeof flight[0] !== 'string' || !/^[A-Z0-9]{2,3}$/.test(flight[0]) || !/^[A-Z0-9]{1,8}$/.test(String(flight[1]))) return null;
  return {
    from: s[3], to: s[6], flight: `${flight[0]} ${flight[1]}`, date: date(s[20])!,
    cabin: Number.isInteger(s[16]) && s[16] >= 0 && s[16] < 100 ? s[16] : null,
    code: Number.isInteger(s[13]) && s[13] >= 0 && s[13] < 100 ? s[13] : null,
    pitch: clean(s[14]), description: clean(s[30]), wifi: normalizeWifi(s[12])
  };
}
/** Undocumented Google schema, verified 2026-10-30. No text/locale inference. */
export function extractResults(data: unknown): SeatResult[] {
  const results = new Map<string, SeatResult>();
  let visits = 0;
  function visit(x: unknown, depth: number) {
    if (!array(x) || depth > 64 || ++visits > 200000 || results.size >= MAX_RESULTS) return;
    if (typeof x[17] === 'string' && x[17].length > 0 && x[17].length <= 200 && airport(x[3]) && airport(x[6]) && date(x[4]) && array(x[2]) && x[2].length > 0 && x[2].length <= 32) {
      const segments = x[2].map(segment);
      if (segments.every((s): s is SeatSegment => s !== null)) results.set(x[17], { id: x[17], segments });
      return;
    }
    for (const child of x) visit(child, depth + 1);
  }
  visit(data, 0);
  return [...results.values()];
}
/** Find the end of a JSON array/object without interpreting executable JS. */
export function jsonEnd(text: string, start: number): number {
  let depth = 0, quoted = false, escaped = false;
  for (let i = start; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (escaped) escaped = false;
      else if (c === '\\') escaped = true;
      else if (c === '"') quoted = false;
    } else if (c === '"') quoted = true;
    else if (c === '[' || c === '{') depth++;
    else if ((c === ']' || c === '}') && --depth === 0) return i + 1;
  }
  return -1;
}
export function bootstrapPayload(text: string): { key: string; data: unknown } | null {
  if (!/^\s*AF_initDataCallback\s*\(/.test(text)) return null;
  const key = text.match(/\bkey\s*:\s*['"]([^'"]+)['"]/u)?.[1];
  const m = /\bdata\s*:\s*([\[{])/.exec(text);
  if (!key || !m) return null;
  const start = m.index + m[0].lastIndexOf(m[1]);
  const end = jsonEnd(text, start);
  if (end < 0) return null;
  try { return { key, data: JSON.parse(text.slice(start, end)) }; } catch { return null; }
}
export function shoppingContext(request: unknown, locale: string): string | null {
  // Both bootstrap LqxFAb requests and RPC inner payloads begin [settings, spec].
  if (!array(request) || !array(request[0]) || !array(request[1]) || !array(request[1][13])) return null;
  const key = JSON.stringify([request[0], request[1], locale]);
  return key.length <= 1024 * 1024 ? key : null;
}
export function contextFromBody(body: string, locale: string): string | null {
  if (body.length > 1024 * 1024) return null;
  try {
    const outer = JSON.parse(new URLSearchParams(body).get('f.req') || 'null');
    if (!array(outer)) return null;
    if (typeof outer[1] === 'string') return shoppingContext(JSON.parse(outer[1]), locale);
    // batchexecute's RPC envelope, only the Flights shopping RPC is accepted.
    for (const batch of outer) if (array(batch)) for (const rpc of batch) {
      if (array(rpc) && rpc[0] === 'LqxFAb' && typeof rpc[1] === 'string') return shoppingContext(JSON.parse(rpc[1]), locale);
    }
  } catch { /* Unknown or malformed Google protocol: fail closed. */ }
  return null;
}
export function shoppingEndpoint(url: string, base: string): boolean {
  try {
    const u = new URL(url, base);
    return u.origin === new URL(base).origin && /^\/_\/FlightsFrontendUi\/data\/(?:travel\.frontend\.flights\.FlightsFrontendService\/GetShoppingResults|batchexecute)$/.test(u.pathname);
  } catch { return false; }
}
