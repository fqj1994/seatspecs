// Sanitized structural fixtures based on inspected Google responses. No account,
// auth, session, booking, or signed pricing tokens are retained.
export function googleAmenities(standard: unknown = null, ultraFast: unknown = null): unknown[] {
  const amenities: unknown[] = Array(13).fill(null);
  amenities[1] = 1; // Recognizable power metadata, independent of Wi-Fi flags.
  amenities[11] = standard; amenities[12] = ultraFast;
  return amenities;
}
export function googleSegment(code: number | null = 3, pitch: string | null = '32 in', cabin = 1, from = 'HND', to = 'ICN', number = '752', date = '2026-12-04', carrier = 'KE'): unknown[] {
  const s: unknown[] = Array(33).fill(null);
  s[3] = from; s[6] = to; s[13] = code; s[14] = pitch; s[16] = cabin;
  s[20] = date.split('-').map(Number); s[21] = [...s[20] as number[]];
  s[22] = [carrier, number, null, carrier === 'KE' ? 'Korean Air' : carrier];
  s[30] = pitch; return s;
}
export function itinerary(id = 'flight-a', segments = [googleSegment()]): unknown[] {
  const r: unknown[] = Array(26).fill(null);
  r[0] = (segments[0][22] as unknown[])[0]; r[1] = [(segments[0][22] as unknown[])[3]]; r[2] = segments;
  r[3] = segments[0][3]; r[4] = segments[0][20]; r[6] = segments.at(-1)![6]; r[17] = id;
  return r;
}
export function shoppingData(rows = [itinerary()]): unknown[] {
  return [null, null, [rows.map(row => [row, ['not-a-price-token']])], [[], null, null, null, []]];
}
export function shoppingRequest(cabin = 1, date = '2026-12-04', pagination = 0): unknown[] {
  const spec: unknown[] = Array(18).fill(null);
  spec[2] = 1; spec[4] = []; spec[5] = cabin; spec[6] = [1, 0, 0, 0];
  spec[13] = [[[[[['/m/07dfk', 4]]]], [[[['/m/04jpl', 4]]]], null, 0, null, null, date]];
  return [[], spec, 0, pagination, 0, 1];
}
export function requestBody(request = shoppingRequest()): string {
  return new URLSearchParams({ 'f.req': JSON.stringify([null, JSON.stringify(request)]) }).toString();
}
export function transport(data: unknown): string {
  const frame = JSON.stringify([['wrb.fr', null, JSON.stringify(data)]]);
  return `)]}'\n\n${Buffer.byteLength(frame)}\n${frame}\n59\n[["di",1],["af.httprm",1,"metadata",5]]\n`;
}
export const RPC = '/_/FlightsFrontendUi/data/travel.frontend.flights.FlightsFrontendService/GetShoppingResults';
