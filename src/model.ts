declare const __SEATSPECS_BUILD_ID__: string;
export const VERSION = '1.0.0';
export const BUILD_ID = typeof __SEATSPECS_BUILD_ID__ === 'undefined' ? 'development' : __SEATSPECS_BUILD_ID__;
export const PROTOCOL = 2;
export const SOURCE = 'seatspecs-data';
export const UI_SOURCE = 'seatspecs-ui';
export const MAX_RESULTS = 2000;
export const MAX_RESPONSE = 16 * 1024 * 1024;
export const WIFI_SERVICE_STATES = ['not-listed', 'available', 'free', 'paid', 'unknown'] as const;
export type WifiServiceState = typeof WIFI_SERVICE_STATES[number];
export interface WifiInfo { standard: WifiServiceState; ultraFast: WifiServiceState }
export interface SeatSegment {
  from: string;
  to: string;
  flight: string;
  date: string;
  cabin: number | null;
  code: number | null;
  pitch: string | null;
  description: string | null;
  wifi: WifiInfo;
}
export interface SeatResult { id: string; segments: SeatSegment[] }
export interface RecordEntry extends SeatResult { sequence: number }
export type DataEvent =
  | { type: 'context-start'; generation: number }
  | { type: 'results-upsert'; generation: number; sequence: number; results: SeatResult[] }
  | { type: 'request-end'; generation: number; pending: number }
  | { type: 'navigation'; generation: number };
export type BridgeMessage = DataEvent & { source: typeof SOURCE; version: typeof PROTOCOL };
const text = (x: unknown, max = 500): x is string => typeof x === 'string' && x.length <= max;
const maybeText = (x: unknown) => x === null || text(x);
const maybeNumber = (x: unknown) => x === null || (Number.isInteger(x) && Number(x) >= 0 && Number(x) < 1000);
export function isWifiInfo(value: unknown): value is WifiInfo {
  if (!value || typeof value !== 'object') return false;
  const wifi = value as WifiInfo;
  return WIFI_SERVICE_STATES.includes(wifi.standard) && WIFI_SERVICE_STATES.includes(wifi.ultraFast);
}
export function isSeatResult(value: unknown): value is SeatResult {
  if (!value || typeof value !== 'object') return false;
  const r = value as SeatResult;
  return text(r.id, 200) && r.id.length > 0 && Array.isArray(r.segments) && r.segments.length > 0 && r.segments.length <= 32 && r.segments.every(s =>
    s && text(s.from, 8) && text(s.to, 8) && text(s.flight, 100) && text(s.date, 30) && maybeNumber(s.cabin) && maybeNumber(s.code) && maybeText(s.pitch) && maybeText(s.description) && isWifiInfo(s.wifi)
  );
}
export function isBridgeMessage(x: unknown): x is BridgeMessage {
  if (!x || typeof x !== 'object') return false;
  const m = x as BridgeMessage;
  if (m.source !== SOURCE || m.version !== PROTOCOL || !Number.isSafeInteger(m.generation) || m.generation < 1) return false;
  if (m.type === 'context-start' || m.type === 'navigation') return true;
  if (m.type === 'request-end') return Number.isInteger(m.pending) && m.pending >= 0 && m.pending <= MAX_RESULTS;
  return m.type === 'results-upsert' && Number.isSafeInteger(m.sequence) && m.sequence >= 0 && Array.isArray(m.results) && m.results.length <= MAX_RESULTS && m.results.every(isSeatResult);
}
export function isFlightsPath(path: string): boolean {
  return /^\/(?:travel\/flights|flights)(?:\/|$)/.test(path);
}
export function navigationKey(href: string): string {
  const u = new URL(href);
  // tfu includes pagination, presentation, and selections. Actual selected-flight
  // changes are detected from the shopping request specification instead.
  return JSON.stringify([isFlightsPath(u.pathname), u.searchParams.get('tfs'), u.searchParams.get('q'), u.searchParams.get('hl')]);
}
