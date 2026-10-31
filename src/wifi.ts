import type { WifiInfo, WifiServiceState } from './model';
import type { Labels } from './i18n';
export type WifiDisplayState = WifiServiceState | 'mixed';
const unknownWifi = (): WifiInfo => ({ standard: 'unknown', ultraFast: 'unknown' });
function knownFlag(value: unknown): boolean {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 3;
}
function serviceState(value: unknown): WifiServiceState {
  if (value === null || value === undefined || value === 0) return 'not-listed';
  if (value === 1) return 'available';
  if (value === 2) return 'free';
  if (value === 3) return 'paid';
  return 'unknown';
}
/** Google segment[12] is its amenity message; proto fields 12/13 are Wi-Fi.
 * Omission means "not listed" only when we recognize actual amenity metadata.
 * Absence of the whole message is not evidence of no Wi-Fi.
 */
export function normalizeWifi(amenities: unknown): WifiInfo {
  if (!Array.isArray(amenities)) return unknownWifi();
  const hasKnownAmenity = amenities.slice(1, 11).some(v => v === true || v === false || v === 0 || v === 1);
  if (!hasKnownAmenity && !knownFlag(amenities[11]) && !knownFlag(amenities[12])) return unknownWifi();
  return { standard: serviceState(amenities[11]), ultraFast: serviceState(amenities[12]) };
}
export function wifiDisplayState(wifi: WifiInfo): WifiDisplayState {
  const states = [wifi.standard, wifi.ultraFast];
  if (states.includes('free') && states.includes('paid')) return 'mixed';
  if (states.includes('free')) return 'free';
  if (states.includes('available')) return 'available';
  if (states.includes('paid')) return 'paid';
  if (states.every(s => s === 'not-listed')) return 'not-listed';
  return 'unknown';
}
export function wifiDescription(wifi: WifiInfo, labels: Labels): string {
  // Keep decoding both source fields, but never announce their speed categories.
  // Deduplicate generic pricing facts; an unlisted sibling field must not add
  // a contradictory "not listed" announcement when Wi-Fi is advertised.
  const states = [wifi.standard, wifi.ultraFast];
  const descriptions: string[] = [];
  if (states.includes('free')) descriptions.push(labels.wifiFree);
  if (states.includes('paid')) descriptions.push(labels.wifiPaid);
  if (states.includes('available')) descriptions.push(`${labels.wifi}: ${labels.wifiPricingUnknown}`);
  if (descriptions.length) return descriptions.join('; ');
  return `${labels.wifi}: ${states.every(s => s === 'not-listed') ? labels.wifiNotListed : labels.wifiUnknown}`;
}

/** Only advertised Wi-Fi gets a glyph; absent/unknown information stays blank. */
export function createWifiIndicator(doc: Document, wifi: WifiInfo, labels: Labels): HTMLElement | null {
  const state = wifiDisplayState(wifi);
  if (state === 'not-listed' || state === 'unknown') return null;
  const span = doc.createElement('span');
  span.className = 'wifi'; span.dataset.wifiStatus = state;
  span.setAttribute('data-seatspecs-wifi', ''); span.setAttribute('role', 'img');
  span.setAttribute('aria-label', wifiDescription(wifi, labels));
  const svg = doc.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true'); svg.setAttribute('focusable', 'false');
  const path = (d: string) => {
    const p = doc.createElementNS('http://www.w3.org/2000/svg', 'path');
    p.setAttribute('d', d); svg.append(p);
    return p;
  };
  // A larger S-and-stem dollar mark is easier to recognize than the old coin.
  // Keep it as a vector so no badge text enters the seat value's textContent.
  const dollar = () => path('M22 14c-1.7-1.5-7-1.5-7 1.5 0 3 7 1.5 7 4.5 0 3-5.5 3.5-7.5 1.5M18.5 11.5v12').setAttribute('data-wifi-badge', 'dollar');
  const circle = (cx: number, cy: number, r: number) => {
    const c = doc.createElementNS('http://www.w3.org/2000/svg', 'circle');
    c.setAttribute('cx', String(cx)); c.setAttribute('cy', String(cy)); c.setAttribute('r', String(r)); svg.append(c);
  };
  path('M2 6a17 17 0 0 1 20 0M5 10a12 12 0 0 1 14 0M8 14a7 7 0 0 1 8 0');
  if (state === 'free') {
    path('m13 19 3 3 6-7'); circle(9, 18, 0.8);
  } else if (state === 'paid') {
    dollar(); circle(9, 18, 0.8);
  } else if (state === 'mixed') {
    path('m2 19 3 3 5-6'); dollar();
  } else {
    path('M15 16a3 3 0 0 1 6 0c0 2-3 2-3 4M18 23h.01'); circle(9, 18, 0.8);
  }
  span.append(svg);
  return span;
}
