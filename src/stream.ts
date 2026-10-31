import { MAX_RESPONSE } from './model';
/** Incremental, string-aware JSON framing; lengths are not JS character counts.
 * Keep chunk slices, not a new concatenated string for every character. Google
 * can send megabyte-size show-more frames; flatten each complete frame once.
 */
export class ShoppingStream {
  private parts: string[] = [];
  private depth = 0;
  private quoted = false;
  private escaped = false;
  private bytes = 0;
  private stopped = false;
  private encoder = new TextEncoder();
  constructor(private readonly consume: (data: unknown) => void, private readonly maxBytes = MAX_RESPONSE) {}
  push(text: string): void {
    if (this.stopped || !text.length) return;
    this.bytes += this.encoder.encode(text).byteLength;
    if (this.bytes > this.maxBytes) { this.stopped = true; this.parts = []; throw new Error('Flights response exceeds capture limit'); }
    let start = this.depth ? 0 : -1;
    for (let i = 0; i < text.length; i++) {
      const c = text.charCodeAt(i);
      if (!this.depth) {
        if (c !== 91) continue;
        this.depth = 1; start = i; this.quoted = false; this.escaped = false;
        continue;
      }
      if (this.quoted) {
        if (this.escaped) this.escaped = false;
        else if (c === 92) this.escaped = true;
        else if (c === 34) this.quoted = false;
      } else if (c === 34) this.quoted = true;
      else if (c === 91 || c === 123) this.depth++;
      else if (c === 93 || c === 125) {
        this.depth--;
        if (!this.depth) {
          this.parts.push(text.slice(start, i + 1));
          const frame = this.parts.length === 1 ? this.parts[0] : this.parts.join('');
          this.parts = []; start = -1;
          try { this.envelope(JSON.parse(frame)); } catch { /* Broken frames never reach the adapter. */ }
        }
      }
    }
    if (start >= 0 && this.depth) this.parts.push(text.slice(start));
  }
  private envelope(frame: unknown): void {
    if (!Array.isArray(frame)) return;
    for (const entry of frame) {
      if (!Array.isArray(entry) || entry[0] !== 'wrb.fr' || (entry[1] !== null && entry[1] !== 'LqxFAb') || typeof entry[2] !== 'string') continue;
      try { this.consume(JSON.parse(entry[2])); } catch { /* Isolate decoder and consumer errors. */ }
    }
  }
}
