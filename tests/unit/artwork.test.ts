import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

function png(file: string) {
  const bytes = readFileSync(new URL(`../../${file}`, import.meta.url));
  expect(bytes.subarray(0, 8)).toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  expect(bytes.toString('ascii', 12, 16)).toBe('IHDR');
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20), depth: bytes[24], color: bytes[25] };
}

describe('SeatSpecs icon and store artwork', () => {
  it('provides correctly sized transparent extension icons', () => {
    for (const size of [16, 32, 48, 128]) expect(png(`assets/icons/icon${size}.png`)).toEqual({ width: size, height: size, depth: 8, color: 6 });
    const svg = readFileSync(new URL('../../assets/icon.svg', import.meta.url), 'utf8');
    expect(svg).toContain('viewBox="0 0 128 128"');
    expect(svg).toContain('x="16" y="16" width="96" height="96"');
    expect(svg).not.toContain('<image'); // Original vector, no embedded third-party logo.
  });
  it('provides three opaque 24-bit 1280x800 screenshots', () => {
    for (const file of ['01-overview', '02-seat-types', '03-wifi']) expect(png(`store/screenshots/${file}.png`)).toEqual({ width: 1280, height: 800, depth: 8, color: 2 });
  });
  it('shows numeric legroom, distinct seat types and free/paid Wi-Fi together in the overview', () => {
    const source = JSON.parse(readFileSync(new URL('../../store/source/captures/provenance.json', import.meta.url), 'utf8')).captures.overview;
    const rows = source.rows as { id: string; pitches: string[]; seats: string[]; wifi: string[] }[];
    expect(rows.length).toBeGreaterThanOrEqual(3);
    expect(rows.length).toBeLessThanOrEqual(4);
    expect(new Set(rows.map(row => row.id)).size).toBe(rows.length);
    expect(rows.flatMap(row => row.pitches).some(pitch => /\d/.test(pitch))).toBe(true);
    const seats = new Set(rows.flatMap(row => row.seats));
    expect(seats.size).toBeGreaterThanOrEqual(2);
    expect(seats.has('5')).toBe(true);
    const wifi = new Set(rows.flatMap(row => row.wifi));
    expect(wifi.has('free')).toBe(true);
    expect(wifi.has('paid')).toBe(true);
    expect(source.highlights).toHaveLength(rows.length);
    expect(source.height).toBeLessThanOrEqual(348); // Entire native crop fits the overview frame.
  });
  it('provides an opaque promotional tile and review contact sheet', () => {
    expect(png('store/promotional/small-tile.png')).toEqual({ width: 440, height: 280, depth: 8, color: 2 });
    expect(png('store/preview.png')).toEqual({ width: 1344, height: 864, depth: 8, color: 2 });
  });
  it('keeps capture provenance and the real extension symbol guide', () => {
    const provenance = JSON.parse(readFileSync(new URL('../../store/source/captures/provenance.json', import.meta.url), 'utf8'));
    const glyphs = JSON.parse(readFileSync(new URL('../../store/source/glyphs.json', import.meta.url), 'utf8'));
    expect(provenance.buildId).toMatch(/^[0-9a-f]{12}$/);
    for (const key of ['overview', 'business', 'wifi']) {
      const source = provenance.captures[key];
      expect(new URL(source.url).hostname).toBe('www.google.com');
      expect(source.highlights.length).toBeGreaterThan(0);
      const capture = png(`store/source/captures/${key}.png`);
      expect(capture.width).toBe(source.width * 2);
      expect(capture.height).toBe(source.height * 2);
    }
    expect(Object.keys(glyphs.seats).sort()).toEqual(['4', '5', '6', '8', '9']);
    expect(Object.keys(glyphs.wifi).sort()).toEqual(['available', 'free', 'paid']);
    for (const svg of [...Object.values(glyphs.seats), ...Object.values(glyphs.wifi)] as string[]) expect(svg).toContain('viewBox="0 0 24 24"');
  });
});
