import { describe, expect, it } from 'vitest';
import branding from '../../src/branding.json' with { type: 'json' };

describe('SeatSpecs public metadata', () => {
  it('uses SeatSpecs without a premium-edition suffix', () => {
    expect(branding.name).toBe('SeatSpecs');
    expect(branding.archive).toBe('seatspecs-extension.zip');
  });
  it('makes seat types as explicit as legroom and WiFi in the title', () => {
    expect(branding.title).toBe('SeatSpecs — Seat Types, Legroom & WiFi for Google Flights');
    expect(branding.description).toContain('lie-flat');
    expect(branding.description).toContain('reclining');
    expect(branding.description).toContain('suite seats');
    expect(branding.description).toContain('free/paid Wi-Fi');
    expect(branding.description).not.toMatch(/Kayak|Trip\.com|meals/i);
  });
  it('fits extension metadata length limits', () => {
    expect(branding.name.length).toBeLessThanOrEqual(12);
    expect(branding.title.length).toBeLessThanOrEqual(75);
    expect(branding.description.length).toBeLessThanOrEqual(132);
  });
});
