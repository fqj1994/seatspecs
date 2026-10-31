import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import * as model from '../../src/model';

describe('SeatSpecs internal namespace', () => {
  it('uses SeatSpecs identifiers for both bridge directions', () => {
    expect(model.SOURCE).toBe('seatspecs-data');
    expect(model).toHaveProperty('UI_SOURCE', 'seatspecs-ui');
  });
  it('accepts the renamed bridge without changing the payload protocol', () => {
    expect(model.PROTOCOL).toBe(2);
    expect(model.isBridgeMessage({ source: 'seatspecs-data', version: 2, generation: 1, type: 'context-start' })).toBe(true);
  });
  it('does not accept a retired namespace as an alias', () => {
    // A negative fixture, never a runtime identifier or compatibility alias.
    expect(model.isBridgeMessage({ source: 'legroom-data', version: 2, generation: 1, type: 'context-start' })).toBe(false);
  });
  it('ships no retired identifiers in runtime code, tooling, browser fixtures, or docs', () => {
    const files = [
      ...readdirSync(new URL('../../src/', import.meta.url)).map(file => `src/${file}`),
      ...readdirSync(new URL('../../scripts/', import.meta.url)).filter(file => file.endsWith('.mjs')).map(file => `scripts/${file}`),
      'tests/browser/fixture.ts', 'tests/browser/extension.spec.ts', 'README.md', '.gitignore'
    ];
    const retired = /data-legroom-|--legroom-|__LEGROOM_|dataset\.legroom|['"]legroom-(?:data|ui)['"]|legroom-extension\.zip/;
    for (const file of files) expect(retired.test(readFileSync(new URL(`../../${file}`, import.meta.url), 'utf8')), file).toBe(false);
  });
});
