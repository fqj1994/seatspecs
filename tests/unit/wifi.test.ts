import { describe, expect, it } from 'vitest';
import locales from '../../data/google-locales.json' with { type: 'json' };
import { createWifiIndicator, normalizeWifi, wifiDescription, wifiDisplayState } from '../../src/wifi';
import { isBridgeMessage, isWifiInfo, PROTOCOL, SOURCE, WIFI_SERVICE_STATES } from '../../src/model';
import { labelsFor, segmentDescription } from '../../src/i18n';
import { extractResults } from '../../src/google-data';
import { googleAmenities, googleSegment, itinerary, shoppingData } from '../fixtures';

describe('Wi-Fi amenity decoding', () => {
  it.each([[0, 'not-listed'], [null, 'not-listed'], [undefined, 'not-listed'], [1, 'available'], [2, 'free'], [3, 'paid'], [99, 'unknown'], [-1, 'unknown'], ['2', 'unknown'], [true, 'unknown'], [{}, 'unknown']] as const)('decodes standard flag %s as %s', (flag, expected) => {
    expect(normalizeWifi(googleAmenities(flag))).toEqual({ standard: expected, ultraFast: 'not-listed' });
  });
  it.each([[0, 'not-listed'], [null, 'not-listed'], [1, 'available'], [2, 'free'], [3, 'paid'], [99, 'unknown'], ['3', 'unknown']] as const)('independently decodes ultra-fast flag %s as %s', (flag, expected) => {
    expect(normalizeWifi(googleAmenities(null, flag))).toEqual({ standard: 'not-listed', ultraFast: expected });
  });
  it.each([null, undefined, [], [null], Array(13).fill(null), [2], {}, 'Wi-Fi', true])('does not interpret missing/unrecognized metadata as no Wi-Fi (%j)', value => {
    expect(normalizeWifi(value)).toEqual({ standard: 'unknown', ultraFast: 'unknown' });
  });
  it('accepts explicit Wi-Fi flags even if no other amenity is supplied', () => {
    const block = Array(13).fill(null); block[12] = 2;
    expect(normalizeWifi(block)).toEqual({ standard: 'not-listed', ultraFast: 'free' });
    block[12] = 0;
    expect(normalizeWifi(block)).toEqual({ standard: 'not-listed', ultraFast: 'not-listed' });
  });
  it('never infers one service price from the other', () => {
    expect(normalizeWifi(googleAmenities(1, 2))).toEqual({ standard: 'available', ultraFast: 'free' });
    expect(normalizeWifi(googleAmenities(3, 2))).toEqual({ standard: 'paid', ultraFast: 'free' });
  });
  it.each([null, [], {}, googleAmenities(99, 99)])('keeps valid seat data when Wi-Fi is unknown (%j)', amenities => {
    const segment = googleSegment(); segment[12] = amenities;
    const result = extractResults(shoppingData([itinerary('a', [segment])]))[0];
    expect(result.segments[0]).toMatchObject({ pitch: '32 in', code: 3, wifi: { standard: 'unknown', ultraFast: 'unknown' } });
  });
});

describe('Wi-Fi presentation combinations', () => {
  const states = WIFI_SERVICE_STATES;
  const matrix = [
    ['not-listed', 'available', 'free', 'paid', 'unknown'],
    ['available', 'available', 'free', 'available', 'available'],
    ['free', 'free', 'free', 'mixed', 'free'],
    ['paid', 'available', 'mixed', 'paid', 'paid'],
    ['unknown', 'available', 'free', 'paid', 'unknown']
  ];
  for (const [i, standard] of states.entries()) for (const [j, ultraFast] of states.entries()) {
    it(`${standard} + ${ultraFast} → ${matrix[i][j]}`, () => {
      expect(wifiDisplayState({ standard, ultraFast })).toBe(matrix[i][j]);
    });
  }
  it.each([
    { standard: 'unknown', ultraFast: 'unknown' },
    { standard: 'not-listed', ultraFast: 'not-listed' },
    { standard: 'unknown', ultraFast: 'not-listed' },
    { standard: 'not-listed', ultraFast: 'unknown' }
  ] as const)('creates no badge or placeholder DOM for $standard / $ultraFast', wifi => {
    const doc = { createElement() { throw new Error('No Wi-Fi information must not create a badge'); } } as unknown as Document;
    expect(createWifiIndicator(doc, wifi, labelsFor('en-US'))).toBeNull();
  });
  it('preserves free/paid information without naming speed categories', () => {
    const labels = labelsFor('en-US');
    const text = wifiDescription({ standard: 'free', ultraFast: 'paid' }, labels);
    expect(text).toBe(`${labels.wifiFree}; ${labels.wifiPaid}`);
  });
  it('announces the same generic Wi-Fi description regardless of which field supplies it', () => {
    const labels = labelsFor('en-US');
    for (const state of states) for (const other of states) {
      expect(wifiDescription({ standard: state, ultraFast: other }, labels)).toBe(wifiDescription({ standard: other, ultraFast: state }, labels));
    }
    expect(wifiDescription({ standard: 'free', ultraFast: 'not-listed' }, labels)).toBe(labels.wifiFree);
    expect(wifiDescription({ standard: 'not-listed', ultraFast: 'free' }, labels)).toBe(labels.wifiFree);
    expect(wifiDescription({ standard: 'paid', ultraFast: 'paid' }, labels)).toBe(labels.wifiPaid);
    expect(wifiDescription({ standard: 'available', ultraFast: 'paid' }, labels)).toBe(`${labels.wifiPaid}; ${labels.wifi}: ${labels.wifiPricingUnknown}`);
  });
  it('never uses speed-specific labels in any locale or service combination', () => {
    for (const locale of locales) {
      const labels = { ...labelsFor(locale), wifiUltraFast: 'UNEXPECTED_SPEED_LABEL', wifiUltraFastFree: 'UNEXPECTED_SPEED_LABEL', wifiUltraFastPaid: 'UNEXPECTED_SPEED_LABEL' };
      for (const standard of states) for (const ultraFast of states) expect(wifiDescription({ standard, ultraFast }, labels)).not.toContain('UNEXPECTED_SPEED_LABEL');
    }
  });
  it('explains price uncertainty independently from availability uncertainty', () => {
    const labels = labelsFor('ja');
    expect(wifiDescription({ standard: 'available', ultraFast: 'not-listed' }, labels)).toContain(labels.wifiPricingUnknown);
    expect(wifiDescription({ standard: 'unknown', ultraFast: 'unknown' }, labels)).toBe(`${labels.wifi}: ${labels.wifiUnknown}`);
    expect(wifiDescription({ standard: 'not-listed', ultraFast: 'not-listed' }, labels)).toBe(`${labels.wifi}: ${labels.wifiNotListed}`);
  });
  it('includes flight identity and Wi-Fi in the complete segment description', () => {
    const s = googleSegment(5, null, 4); s[12] = googleAmenities(null, 2);
    const normalized = extractResults(shoppingData([itinerary('a', [s])]))[0].segments[0];
    const text = segmentDescription(normalized, labelsFor('zh-CN'));
    expect(text).toContain('HND–ICN · KE 752');
    expect(text).toContain('平躺座椅');
    expect(text).toContain(labelsFor('zh-CN').wifiFree);
  });
});

describe('versioned Wi-Fi bridge validation', () => {
  it('requires both independently valid service states', () => {
    for (const standard of WIFI_SERVICE_STATES) for (const ultraFast of WIFI_SERVICE_STATES) expect(isWifiInfo({ standard, ultraFast })).toBe(true);
    for (const value of [null, [], { standard: 'free' }, { standard: 'free', ultraFast: 'constructor' }, { standard: 2, ultraFast: 3 }]) expect(isWifiInfo(value)).toBe(false);
  });
  it('rejects legacy/malformed messages without coercing missing Wi-Fi', () => {
    const result = extractResults(shoppingData())[0];
    const message = { source: SOURCE, version: PROTOCOL, generation: 1, sequence: 1, type: 'results-upsert', results: [result] };
    expect(PROTOCOL).toBe(2);
    expect(isBridgeMessage(message)).toBe(true);
    expect(isBridgeMessage({ ...message, version: 1 })).toBe(false);
    for (const wifi of [undefined, null, { standard: 'free' }, { standard: 'free', ultraFast: 'invalid' }]) {
      expect(isBridgeMessage({ ...message, results: [{ ...result, segments: [{ ...result.segments[0], wifi }] }] })).toBe(false);
    }
  });
});
