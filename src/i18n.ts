import catalogs from './catalogs.json' with { type: 'json' };
import type { SeatSegment } from './model';
import { wifiDescription } from './wifi';
export interface Labels {
  [key: string]: string;
  seat: string; loading: string; unavailable: string;
  wifi: string; wifiFree: string; wifiPaid: string;
  wifiUltraFast: string; wifiUltraFastFree: string; wifiUltraFastPaid: string;
  wifiNotListed: string; wifiUnknown: string; wifiPricingUnknown: string;
}
const available: Record<string, Labels> = catalogs;
export function resolveLocale(language: string): string {
  const requested = language.replaceAll('_', '-').toLowerCase();
  const aliases: Record<string, string> = { en: 'en-US', he: 'iw', nb: 'no', nn: 'no', tl: 'fil', 'sr-cyrl': 'sr', pt: 'pt-PT', zh: 'zh-CN', 'zh-hans': 'zh-CN', 'zh-hant': 'zh-TW' };
  const exact = Object.keys(available).find(key => key.toLowerCase() === requested);
  if (exact) return exact;
  if (aliases[requested]) return aliases[requested];
  if (requested.startsWith('zh-hant-hk')) return 'zh-HK';
  if (requested.startsWith('zh-hant')) return 'zh-TW';
  if (requested.startsWith('zh-hans')) return 'zh-CN';
  if (requested.startsWith('sr-latn')) return 'sr-Latn';
  const base = requested.split('-')[0];
  return Object.keys(available).find(key => key.toLowerCase() === base) || aliases[base] || 'en-US';
}
export function labelsFor(language: string): Labels { return available[resolveLocale(language)]; }
export function pageLanguage(doc: Document, href: string): string {
  return doc.documentElement.lang || new URL(href).searchParams.get('hl') || 'en-US';
}
export function segmentValue(segment: SeatSegment, labels: Labels): string {
  return segment.pitch || (segment.code !== null ? labels[String(segment.code)] : undefined) || '—';
}
export function seatDescription(segment: SeatSegment, labels: Labels): string {
  const value = segmentValue(segment, labels);
  return segment.description || (value === '—' ? labels.unavailable : value);
}
/** Combined diagnostic summary only, not the accessible name of either field. */
export function segmentDescription(segment: SeatSegment, labels: Labels): string {
  return `${segment.from}–${segment.to} · ${segment.flight}: ${seatDescription(segment, labels)} · ${wifiDescription(segment.wifi, labels)}`;
}
