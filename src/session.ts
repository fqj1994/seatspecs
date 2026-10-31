import { MAX_RESULTS, type DataEvent, type RecordEntry, type SeatResult } from './model';
export interface Ticket { sequence: number; route: number; key: string; generation: number }
/** Owns search epochs independently of recycled DOM nodes and response timing. */
export class CaptureSession {
  generation = 1;
  route = 0;
  private key = '';
  private invalidatedKey = '';
  private routeBaselineKey = '';
  private newestContextSequence = -1;
  private records = new Map<string, RecordEntry>();
  private pending = new Set<number>();
  constructor(private readonly emit: (event: DataEvent) => void) {}
  navigate(): void {
    this.route++;
    const alreadyChanged = !!this.key && !!this.routeBaselineKey && this.key !== this.routeBaselineKey;
    this.invalidatedKey = this.routeBaselineKey || this.key || this.invalidatedKey;
    this.routeBaselineKey = this.key;
    if (!alreadyChanged) this.key = '';
    this.generation++;
    if (!alreadyChanged) this.records.clear();
    this.pending.clear();
    this.emit({ type: 'navigation', generation: this.generation });
    this.snapshot();
  }
  open(key: string, sequence: number, route = this.route): Ticket | null {
    if (route < this.route && key === this.invalidatedKey) return null;
    if (key !== this.key) {
      if (sequence < this.newestContextSequence) return null;
      this.newestContextSequence = sequence;
      if (!this.key) this.routeBaselineKey = key;
      this.key = key; this.generation++;
      this.records.clear(); this.pending.clear();
      this.emit({ type: 'context-start', generation: this.generation });
    }
    this.pending.add(sequence);
    return { sequence, route, key, generation: this.generation };
  }
  private current(ticket: Ticket): boolean {
    // A new search request can start just before Google commits its History API
    // navigation. Rebase only a different, newest context; never revive old data.
    if (ticket.generation !== this.generation && (!this.key || this.key === ticket.key) && ticket.key !== this.invalidatedKey && ticket.sequence >= this.newestContextSequence) {
      this.key = ticket.key;
      ticket.generation = this.generation;
      this.pending.add(ticket.sequence);
    }
    return ticket.generation === this.generation && ticket.key === this.key;
  }
  upsert(ticket: Ticket, results: SeatResult[]): void {
    if (!this.current(ticket)) return;
    const accepted: SeatResult[] = [];
    for (const result of results) {
      if ((this.records.get(result.id)?.sequence ?? -1) > ticket.sequence) continue;
      this.records.delete(result.id);
      this.records.set(result.id, { ...result, sequence: ticket.sequence });
      accepted.push(result);
      if (this.records.size > MAX_RESULTS) this.records.delete(this.records.keys().next().value!);
    }
    if (accepted.length) this.emit({ type: 'results-upsert', generation: this.generation, sequence: ticket.sequence, results: accepted });
  }
  end(ticket: Ticket): void {
    if (!this.current(ticket)) return;
    this.pending.delete(ticket.sequence);
    this.emit({ type: 'request-end', generation: this.generation, pending: this.pending.size });
  }
  snapshot(): void {
    this.emit({ type: 'context-start', generation: this.generation });
    const bySequence = new Map<number, SeatResult[]>();
    for (const r of this.records.values()) {
      const group = bySequence.get(r.sequence) || [];
      group.push({ id: r.id, segments: r.segments }); bySequence.set(r.sequence, group);
    }
    for (const [sequence, results] of bySequence) this.emit({ type: 'results-upsert', generation: this.generation, sequence, results });
    this.emit({ type: 'request-end', generation: this.generation, pending: this.pending.size });
  }
}
