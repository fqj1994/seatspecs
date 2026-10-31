import { describe, it, expect } from 'vitest';
import { CaptureSession } from '../../src/session';
import { extractResults } from '../../src/google-data';
import { type DataEvent } from '../../src/model';
import { googleSegment, itinerary, shoppingData } from '../fixtures';
const result = (id = 'same', code = 1) => extractResults(shoppingData([itinerary(id, [googleSegment(code, null)])]));
describe('search generations', () => {
  it('preserves pagination data and ignores older updates for an itinerary', () => {
    const events: DataEvent[] = []; const s = new CaptureSession(e => events.push(e));
    const initial = s.open('economy', 1)!; s.upsert(initial, result('same', 1)); s.end(initial);
    const generation = s.generation;
    const more = s.open('economy', 2)!; s.upsert(more, result('new', 3)); s.upsert(more, result('same', 3));
    s.upsert(initial, result('same', 2));
    expect(s.generation).toBe(generation);
    events.length = 0; s.snapshot();
    const values = events.filter(e => e.type === 'results-upsert').flatMap(e => e.results);
    expect(values.map(r => r.id).sort()).toEqual(['new', 'same']);
    expect(values.find(r => r.id === 'same')!.segments[0].code).toBe(3);
  });
  it('replaces reused IDs for cabin changes and discards all old frames', () => {
    const events: DataEvent[] = []; const s = new CaptureSession(e => events.push(e));
    const old = s.open('economy', 1)!; s.upsert(old, result());
    const current = s.open('business', 2)!; s.upsert(current, result('same', 5));
    const length = events.length; s.upsert(old, result('old', 1)); s.end(old);
    expect(events).toHaveLength(length);
    expect(s.open('economy', 0)).toBeNull();
  });
  it('invalidates old requests at navigation, including pending request-body decoding', () => {
    const events: DataEvent[] = []; const s = new CaptureSession(e => events.push(e));
    const a = s.open('old', 1)!; s.navigate();
    const length = events.length; s.upsert(a, result());
    expect(events).toHaveLength(length);
    expect(s.open('old', 1, 0)).toBeNull();
    const b = s.open('new', 2, 0)!; s.upsert(b, result('new'));
    expect(events.at(-1)?.type).toBe('results-upsert');
  });
  it('rebases a new request started immediately before Google changes history', () => {
    const events: DataEvent[] = []; const s = new CaptureSession(e => events.push(e));
    const a = s.open('old', 1)!;
    const b = s.open('new', 2)!; s.upsert(b, result('new'));
    s.navigate(); s.upsert(b, result('newest')); s.upsert(a, result('stale'));
    events.length = 0; s.snapshot();
    const ids = events.filter(e => e.type === 'results-upsert').flatMap(e => e.results.map(r => r.id));
    expect(ids).toEqual(['new', 'newest']);
  });
  it('keeps a bounded snapshot for late bridge handshakes', () => {
    const events: DataEvent[] = []; const s = new CaptureSession(e => events.push(e));
    const t = s.open('query', 1)!;
    for (let n = 0; n < 2010; n++) s.upsert(t, result(String(n)));
    events.length = 0; s.snapshot();
    expect(events.filter(e => e.type === 'results-upsert').flatMap(e => e.results)).toHaveLength(2000);
  });
});
