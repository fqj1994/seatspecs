import { describe, it, expect } from 'vitest';
import catalogs from '../../src/catalogs.json';
import locales from '../../data/google-locales.json';
import { labelsFor, pageLanguage, resolveLocale, seatDescription, segmentValue } from '../../src/i18n';
import { extractResults } from '../../src/google-data';
import { googleSegment, itinerary, shoppingData } from '../fixtures';
describe('every Google Flights locale', () => {
  it.each(locales)('%s has every seat/Wi-Fi code and status translated', locale => {
    expect(Object.keys(catalogs)).toContain(locale);
    const labels = labelsFor(locale);
    for (const key of ['1', '2', '3', '4', '5', '6', '8', '9', 'seat', 'loading', 'unavailable', 'wifi', 'wifiFree', 'wifiPaid', 'wifiUltraFast', 'wifiUltraFastFree', 'wifiUltraFastPaid', 'wifiNotListed', 'wifiUnknown', 'wifiPricingUnknown']) {
      expect(labels[key]?.length).toBeGreaterThan(0);
      expect(labels[key]).not.toContain('{pitch}');
      expect(labels[key]).not.toContain('<');
    }
  });
  it.each([['he', 'iw'], ['he-IL', 'iw'], ['sr-Latn-RS', 'sr-Latn'], ['pt', 'pt-PT'], ['pt-BR', 'pt-BR'], ['en', 'en-US'], ['nb-NO', 'no'], ['zh_HK', 'zh-HK'], ['zh-Hant', 'zh-TW'], ['zh-Hans', 'zh-CN'], ['xx', 'en-US']])('resolves %s as %s', (input, expected) => {
    expect(resolveLocale(input)).toBe(expected);
  });
  it('uses the Google page locale instead of the browser locale', () => {
    expect(pageLanguage({ documentElement: { lang: 'ar' } } as Document, 'https://www.google.com/travel/flights?hl=ja')).toBe('ar');
  });
  it('keeps seat descriptions independent of Wi-Fi in every locale', () => {
    const segment = extractResults(shoppingData())[0].segments[0];
    for (const locale of locales) {
      const labels = labelsFor(locale);
      expect(seatDescription({ ...segment, description: 'Above average legroom (32 in)', wifi: { standard: 'paid', ultraFast: 'free' } }, labels)).toBe('Above average legroom (32 in)');
      expect(seatDescription({ ...segment, pitch: null, description: null, code: 5 }, labels)).toBe(labels['5']);
      expect(seatDescription({ ...segment, pitch: null, description: null, code: 7 }, labels)).toBe(labels.unavailable);
    }
  });
  it('preserves localized measurements and renders unknown codes safely', () => {
    const pitch = extractResults(shoppingData([itinerary('a', [googleSegment(1, '７９ 厘米')])]))[0].segments[0];
    expect(segmentValue(pitch, labelsFor('ja'))).toBe('７９ 厘米');
    expect(segmentValue({ ...pitch, code: 7, pitch: null }, labelsFor('ja'))).toBe('—');
    expect(segmentValue({ ...pitch, code: 5, pitch: null }, labelsFor('zh-CN'))).toBe('平躺座椅');
  });
});
