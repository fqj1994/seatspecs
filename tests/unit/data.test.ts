import { describe, it, expect } from 'vitest';
import { bootstrapPayload, contextFromBody, extractResults, shoppingContext, shoppingEndpoint } from '../../src/google-data';
import { ShoppingStream } from '../../src/stream';
import { isBridgeMessage, navigationKey, PROTOCOL, SOURCE } from '../../src/model';
import { googleSegment, itinerary, requestBody, shoppingData, shoppingRequest, transport, RPC } from '../fixtures';

describe('Google schema adapter', () => {
  it('extracts ordered segments with native measurements and repeated values', () => {
    const data = shoppingData([itinerary('a', [googleSegment(3, '٨١ سم'), googleSegment(3, '٨١ سم', 1, 'ICN', 'LHR', '907')])]);
    const [r] = extractResults(data);
    expect(r.id).toBe('a');
    expect(r.segments.map(s => s.pitch)).toEqual(['٨١ سم', '٨١ سم']);
    expect(r.segments.map(s => s.flight)).toEqual(['KE 752', 'KE 907']);
    expect(r.segments[0].date).toBe('2026-12-04');
  });
  it.each([1, 2, 3, 4, 5, 6, 8, 9, 7, 99, null])('retains code %s without inferring text', code => {
    expect(extractResults(shoppingData([itinerary('a', [googleSegment(code, null, 3)])]))[0].segments[0]).toMatchObject({ code, pitch: null, cabin: 3 });
  });
  it('does not mistake arbitrary arrays or malformed segments for flights', () => {
    const bad = itinerary(); (bad[2] as unknown[][])[0][20] = null;
    expect(extractResults([bad, ['Emissions', '32 in']])).toEqual([]);
    expect(extractResults(shoppingData([itinerary('a', [googleSegment(null, null)])]))[0].segments[0].pitch).toBeNull();
  });
  it('safely parses bootstrap JSON but never executes expressions', () => {
    const data = shoppingData();
    expect(bootstrapPayload(`AF_initDataCallback({key: 'ds:42', hash: 'x', data:${JSON.stringify(data)}, sideChannel:{}});`)).toEqual({ key: 'ds:42', data });
    expect(bootstrapPayload(`AF_initDataCallback({key:'ds:1',data:[globalThis.malicious()],sideChannel:{}})`)).toBeNull();
    expect(bootstrapPayload('not an initializer')).toBeNull();
  });
});
describe('stream decoder', () => {
  it('decodes concatenated envelopes, Unicode, quoted brackets, and every chunk boundary', () => {
    const a = shoppingData([itinerary('quoted[]"', [googleSegment(1, '79厘米')])]);
    const b = shoppingData([itinerary('b', [googleSegment(5, null, 3)])]);
    const body = transport(a) + transport(b);
    for (const size of [1, 2, 3, 7, 1000, body.length]) {
      const out: unknown[] = [];
      const stream = new ShoppingStream(x => out.push(x));
      for (let i = 0; i < body.length; i += size) stream.push(body.slice(i, i + size));
      expect(out).toEqual([a, b]);
    }
  });
  it('decodes a large show-more frame across 64 KiB chunks without losing records', () => {
    const data = shoppingData(Array.from({ length: 1200 }, (_, i) => itinerary(`bulk-${i}`, [googleSegment(3, i % 2 ? '８１ 厘米' : '32 in')])));
    const body = transport(data), out: unknown[] = [];
    const stream = new ShoppingStream(value => out.push(value));
    for (let i = 0; i < body.length; i += 65536) stream.push(body.slice(i, i + 65536));
    expect(out).toHaveLength(1);
    const results = extractResults(out[0]);
    expect(results).toHaveLength(1200);
    expect(results[0].id).toBe('bulk-0');
    expect(results[1199].segments[0].pitch).toBe('８１ 厘米');
  });
  it('ignores unrelated RPCs, malformed envelopes, and unfinished data', () => {
    const out: unknown[] = []; const stream = new ShoppingStream(x => out.push(x));
    stream.push('[["wrb.fr","not-flights","[]"]]\n[["wrb.fr",null,"broken"]]\n[["wrb.fr",null,');
    expect(out).toEqual([]);
  });
  it('enforces a byte limit and stops processing after overflow', () => {
    const out: unknown[] = []; const stream = new ShoppingStream(x => out.push(x), 20);
    expect(() => stream.push('界'.repeat(8))).toThrow('limit');
    stream.push(transport([])); expect(out).toEqual([]);
  });
});
describe('context and bridge boundaries', () => {
  it('normalizes bootstrap and native requests, excluding pagination and tokens', () => {
    const key = shoppingContext(shoppingRequest(), 'ja');
    expect(contextFromBody(requestBody(shoppingRequest()) + '&at=secret', 'ja')).toBe(key);
    expect(contextFromBody(requestBody(shoppingRequest(1, '2026-12-04', 1)), 'ja')).toBe(key);
    expect(contextFromBody(requestBody(shoppingRequest(3)), 'ja')).not.toBe(key);
    expect(contextFromBody(requestBody(shoppingRequest()), 'ar')).not.toBe(key);
    expect(contextFromBody('bad', 'en')).toBeNull();
    const batch = new URLSearchParams({ 'f.req': JSON.stringify([[['LqxFAb', JSON.stringify(shoppingRequest()), null, 'generic']]]) });
    expect(contextFromBody(batch.toString(), 'ja')).toBe(key);
  });
  it('restricts capture to same-origin Flights shopping endpoints', () => {
    expect(shoppingEndpoint(RPC, 'https://www.google.co.jp/travel/flights')).toBe(true);
    expect(shoppingEndpoint('https://other.example' + RPC, 'https://www.google.com')).toBe(false);
    expect(shoppingEndpoint('/log', 'https://www.google.com')).toBe(false);
  });
  it('does not treat pagination as navigation but detects changed queries/locales', () => {
    const u = 'https://www.google.com/travel/flights/search?tfs=one&hl=en&tfu=page1';
    expect(navigationKey(u)).toBe(navigationKey(u.replace('page1', 'page2')));
    expect(navigationKey(u)).not.toBe(navigationKey(u.replace('tfs=one', 'tfs=two')));
    expect(navigationKey(u)).not.toBe(navigationKey(u.replace('hl=en', 'hl=ja')));
  });
  it('rejects unversioned, malformed, oversized, and invalid normalized messages', () => {
    const message = { source: SOURCE, version: PROTOCOL, generation: 1, type: 'results-upsert', sequence: 0, results: extractResults(shoppingData()) };
    expect(isBridgeMessage(message)).toBe(true);
    expect(isBridgeMessage({ ...message, version: 9 })).toBe(false);
    expect(isBridgeMessage({ ...message, generation: -1 })).toBe(false);
    expect(isBridgeMessage({ ...message, results: [{ id: 'a', segments: [{ pitch: '<script>' }] }] })).toBe(false);
    expect(isBridgeMessage({ ...message, results: Array(2001).fill(message.results[0]) })).toBe(false);
  });
});
