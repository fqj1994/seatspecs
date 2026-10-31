import type { SeatSegment } from './model';
import { seatDescription, segmentValue, type Labels } from './i18n';
import { createWifiIndicator, wifiDescription } from './wifi';

// Seat types are numeric Google data, not inferred from localized label text.
// Small, distinct glyphs keep long translations out of the column's layout.
const ICONS: Record<number, string[]> = {
  1: ['M5 3v12h10v3H3V3h2zm2 1h5v7h5v9h-2v-7H7V4z'],
  2: ['M5 3v12h10v3H3V3h2zm3 1h5v6h6l-4 7 3 4-2 1-4-6 2-4H8V4z'],
  3: ['M4 3v13h10v2H2V3h2zm3 1h5v7h4l5 8-2 1-5-7H7V4z'],
  4: ['M3 4h2v12h9v2H3V4zm4 1 5 2-2 5 6 2 5 6-2 1-5-5-7-2V5z'],
  5: ['M18 7H9v7h13v-3c0-2.21-1.79-4-4-4zm2 5h-9V9h7c1.1 0 2 .9 2 2v1zM2 15h20v2H2v-2zm3-1c1.66 0 3-1.34 3-3S6.66 8 5 8s-3 1.34-3 3 1.34 3 3 3zm0-4c.55 0 1 .45 1 1s-.45 1-1 1-1-.45-1-1 .45-1 1-1z'],
  6: ['M19 9c1.1 0 2 .9 2 2v4h-8V9h6m0-2h-8v8H3V7H1v10h22v-6c0-2.21-1.79-4-4-4zM7 10c.55 0 1 .45 1 1s-.45 1-1 1-1-.45-1-1 .45-1 1-1m0-2c-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3-1.34-3-3-3z'],
  8: ['M4 4h2v13h9v2H4V4zm4 1h5v8h5v8h-2v-6H8V5z'],
  9: ['M10 5 22 8l-2 7-12-3 2-7zm1 2-1 4 9 2 1-4-9-2zM3 14l18 5-.5 2-18-5 .5-2z', 'M5 8a3 3 0 1 0 0 6 3 3 0 0 0 0-6z']
};

// One content-sized grid for the entire itinerary keeps every leg in the same
// columns. Contents-only segment wrappers retain per-leg metadata without
// requiring CSS subgrid (the extension still supports Chrome 111).
export const SEAT_CELL_STYLE = `
:host{font:inherit;color:inherit;text-align:center}
[data-seatspecs-value]{display:grid;grid-template-columns:minmax(0,max-content) 16px;grid-auto-rows:minmax(18px,auto);column-gap:2px;justify-content:center;align-items:center;min-inline-size:0;font-size:12px;line-height:18px;font-variant-numeric:tabular-nums}
[data-seatspecs-value]:not(:has(.wifi)){grid-template-columns:minmax(0,max-content);column-gap:0}
.segment{display:contents}
.seat{display:flex;grid-column:1;align-items:center;justify-content:flex-end;min-inline-size:0;min-block-size:18px;max-inline-size:100%}
.wifi{display:flex;grid-column:2;align-items:center;justify-content:center;inline-size:16px;block-size:18px}
.wifi svg{inline-size:16px;block-size:16px;fill:none;stroke:currentColor;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round}
.measurement{display:block;max-inline-size:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;unicode-bidi:plaintext}
svg{display:block;inline-size:18px;block-size:18px;flex:none;fill:currentColor}
.sr-only{position:absolute;inline-size:1px;block-size:1px;overflow:hidden;clip-path:inset(50%);white-space:nowrap}
`;

export function renderSeatSegments(container: HTMLElement, segments: SeatSegment[], labels: Labels): void {
  const doc = container.ownerDocument;
  const fragment = doc.createDocumentFragment();
  for (const [index, segment] of segments.entries()) {
    if (index) {
      const separator = doc.createElement('span');
      separator.className = 'sr-only'; separator.textContent = ' / '; separator.setAttribute('aria-hidden', 'true');
      fragment.append(separator);
    }
    const line = doc.createElement('span');
    line.className = 'segment';
    line.setAttribute('role', 'group'); line.setAttribute('aria-label', `${segment.from}–${segment.to} · ${segment.flight}`);
    const seat = doc.createElement('span');
    seat.className = 'seat';
    seat.setAttribute('role', 'img'); seat.setAttribute('aria-label', `${labels.seat}: ${seatDescription(segment, labels)}`);
    const icon = !segment.pitch && segment.code !== null ? ICONS[segment.code] : undefined;
    if (icon) {
      const svg = doc.createElementNS('http://www.w3.org/2000/svg', 'svg');
      svg.setAttribute('viewBox', '0 0 24 24');
      svg.setAttribute('aria-hidden', 'true'); svg.setAttribute('focusable', 'false');
      svg.dataset.seatCode = String(segment.code);
      for (const d of icon) {
        const path = doc.createElementNS('http://www.w3.org/2000/svg', 'path');
        path.setAttribute('d', d); svg.append(path);
      }
      seat.append(svg);
    }
    const label = doc.createElement('span');
    label.className = icon ? 'sr-only' : 'measurement';
    label.textContent = segmentValue(segment, labels); label.setAttribute('aria-hidden', 'true');
    seat.append(label);
    line.append(seat);
    let wifi = createWifiIndicator(doc, segment.wifi, labels);
    if (!wifi) {
      // Preserve unknown/not-listed information for AT without a visible icon,
      // grid slot, or mixed seat label. This is a separate Wi-Fi-only item.
      wifi = doc.createElement('span'); wifi.className = 'sr-only';
      wifi.setAttribute('role', 'note'); wifi.setAttribute('aria-label', wifiDescription(segment.wifi, labels));
      wifi.setAttribute('data-seatspecs-wifi', '');
    }
    line.append(wifi);
    fragment.append(line);
  }
  container.replaceChildren(fragment);
}
