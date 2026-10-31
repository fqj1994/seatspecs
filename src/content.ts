import { BUILD_ID, MAX_RESULTS, PROTOCOL, UI_SOURCE, VERSION, isBridgeMessage, isFlightsPath, navigationKey, type RecordEntry, type SeatResult } from './model';
import { labelsFor, pageLanguage, type Labels } from './i18n';
import { renderSeatSegments, SEAT_CELL_STYLE } from './seat-cell';
const CELL = 'data-seatspecs-cell';
const LAYOUT = 'data-seatspecs-layout';
const PRICE = 'data-seatspecs-price';
const SUMMARY = '[jsname="HSrbLb"]';
const STRUCTURE = 1, VALUE = 2, EXPANSION = 4, CHECK_LAYOUT = 8;
const MAX_NEW_ROWS_PER_FRAME = 12, MAX_CACHED_ROWS_PER_FRAME = 256, READ_BUDGET_MS = 4;
interface GridPlan { column: number; priceRow: number; captionRow: number; nativePriceRow: number; nativeCaptionRow: number }
interface AnchorPlan { summary: Element; parent: HTMLElement; price: HTMLElement; caption: HTMLElement | null; layout: string; grid: GridPlan | null }
interface RowBinding extends AnchorPlan { host: HTMLElement; text: HTMLElement; rendered: string; generation: number; layoutEpoch: number; itinerary: string | null }
interface RowState { row: HTMLElement; id: string; idNode: Element | null; identityNode: Element | null; button: HTMLElement | null; summary: Element | null; identityUrl: string | null; itinerary: string | null; invalidIdentity: boolean; dormant: boolean; containers: Element[]; flags: number; binding: RowBinding | null }
interface DisplayRecord extends RecordEntry { signature: string; itinerary: string; revision: number; presentation?: Presentation }
interface Presentation { key: string; description: string; locale: string; record: DisplayRecord | null; fallback: string }
interface Prepared { state: RowState; expanded: boolean; anchor?: AnchorPlan; value?: Presentation; remove?: boolean; incomplete?: boolean }
function visible(element: Element): boolean {
  return element.getClientRects().length > 0 && getComputedStyle(element).visibility !== 'hidden' && getComputedStyle(element).display !== 'none';
}
/** Find disjoint emissions and price columns, never a localized text label. */
export function columnAnchor(summary: Element): { parent: HTMLElement; price: HTMLElement } | null {
  const prices = [...summary.querySelectorAll<HTMLElement>('[data-gs]')].filter(visible);
  const emissions = [...summary.querySelectorAll<HTMLElement>('[data-co2currentflight]')].filter(visible);
  for (const leaf of prices) {
    let price = leaf;
    while (price.parentElement && summary.contains(price.parentElement)) {
      const parent = price.parentElement;
      const layout = getComputedStyle(parent).display;
      if ((layout === 'flex' || layout === 'grid') && (emissions.some(e => parent.contains(e) && !price.contains(e)) || (!emissions.length && parent.children.length >= 3))) return { parent, price };
      price = parent;
    }
  }
  return null;
}
function flightIdentity(result: SeatResult): string {
  return result.segments.map(s => `${s.from}-${s.to}-${s.flight.replace(/\s+/g, '-')}-${s.date.replaceAll('-', '')}`).join(',');
}
export function matchesRow(row: Element, result: SeatResult): boolean {
  // Emissions' data-seatingclass is NOT the actual offered cabin (domestic
  // First can appear in Business searches). Search epochs isolate cabin changes.
  const url = row.querySelector('[data-travelimpactmodelwebsiteurl]')?.getAttribute('data-travelimpactmodelwebsiteurl');
  if (!url) return true;
  try { const listed = new URL(url).searchParams.get('itinerary'); return !listed || listed === flightIdentity(result); }
  catch { return false; }
}
export function installContent(win: Window): void {
  const doc = win.document;
  let generation = 0, pending = true, scheduled = false, cleanupPending = false, revision = 0, layoutEpoch = 0;
  let paintRepairs = new WeakMap<RowState, number>();
  let observedUrl = navigationKey(win.location.href), awaitingContext = false, startedAt = Date.now();
  let locale = pageLanguage(doc, win.location.href), labels: Labels = labelsFor(locale);
  let settleTimer: ReturnType<typeof setTimeout> | undefined, deadlineTimer: ReturnType<typeof setTimeout> | undefined;
  const records = new Map<string, DisplayRecord>();
  const rows = new Map<HTMLElement, RowState>();
  const rowsById = new Map<string, Set<RowState>>();
  const urgent = new Set<RowState>(), background = new Set<RowState>(), waiting = new Set<RowState>();
  const discoveries = new Set<Element | Document>();
  const resizeOwners = new Map<Element, Set<RowState>>();
  const dormantOwners = new WeakMap<Element, Set<RowState>>();
  const widths = new WeakMap<Element, number>();
  // Parse the identical static CSS once, not once for every flight's shadow root.
  let sheet: CSSStyleSheet | null = null;
  try { sheet = new CSSStyleSheet(); sheet.replaceSync(SEAT_CELL_STYLE); } catch { /* Static style element fallback. */ }
  const intersection = new IntersectionObserver(entries => {
    for (const entry of entries) {
      const state = rows.get(entry.target as HTMLElement);
      if (entry.isIntersecting && state && (!state.binding || state.dormant)) enqueue(state, STRUCTURE | VALUE, true);
    }
  }, { rootMargin: '800px' });
  const resize = new ResizeObserver(entries => {
    for (const entry of entries) {
      const width = entry.borderBoxSize[0]?.inlineSize ?? entry.contentRect.width;
      if (!width) {
        // Ignore expansion animations, but recover if a collapsed layout was
        // hidden/replaced by a different responsive summary at the same width.
        for (const state of resizeOwners.get(entry.target) || []) if (state.button?.getAttribute('aria-expanded') !== 'true') enqueue(state, CHECK_LAYOUT);
        continue;
      }
      const previous = widths.get(entry.target); widths.set(entry.target, width);
      if (previous !== undefined && Math.abs(width - previous) > 0.5) for (const state of resizeOwners.get(entry.target) || []) enqueue(state, CHECK_LAYOUT);
    }
  });
  function schedule() {
    if (!scheduled) { scheduled = true; win.requestAnimationFrame(flush); }
  }
  function enqueue(state: RowState, flags: number, priority = false) {
    state.flags |= flags;
    if (priority) { background.delete(state); urgent.add(state); }
    else if (!urgent.has(state)) background.add(state);
    schedule();
  }
  function setId(state: RowState, id: string) {
    if (state.id === id) return;
    const previous = rowsById.get(state.id); previous?.delete(state);
    if (previous?.size === 0) rowsById.delete(state.id);
    state.id = id;
    if (id) { const set = rowsById.get(id) || new Set<RowState>(); set.add(state); rowsById.set(id, set); }
  }
  function removeBinding(state: RowState) {
    const binding = state.binding;
    if (!binding) return;
    state.binding = null;
    binding.host.remove();
    binding.parent.removeAttribute(LAYOUT); binding.price.removeAttribute(PRICE);
    binding.caption?.removeAttribute('data-seatspecs-caption');
    binding.parent.style.removeProperty('--seatspecs-price-row'); binding.parent.style.removeProperty('--seatspecs-caption-row');
    const owners = resizeOwners.get(binding.parent); owners?.delete(state);
    if (!owners?.size) { resize.unobserve(binding.parent); resizeOwners.delete(binding.parent); widths.delete(binding.parent); }
  }
  function setDormant(state: RowState, dormant: boolean) {
    if (state.dormant === dormant && (!dormant || state.containers[0] === state.row.parentElement)) return;
    for (const container of state.containers) dormantOwners.get(container)?.delete(state);
    state.containers = []; state.dormant = dormant;
    if (dormant) {
      let container = state.row.parentElement;
      while (container && container !== doc.body && !container.matches('main,[role="main"]')) {
        const owners = dormantOwners.get(container) || new Set<RowState>(); owners.add(state); dormantOwners.set(container, owners);
        state.containers.push(container); container = container.parentElement;
      }
    }
  }
  function removeRow(state: RowState) {
    setDormant(state, false);
    removeBinding(state); setId(state, ''); intersection.unobserve(state.row);
    rows.delete(state.row); urgent.delete(state); background.delete(state); waiting.delete(state);
  }
  function reset(next: number) {
    generation = next; records.clear(); pending = true; startedAt = Date.now();
    clearTimeout(settleTimer); clearTimeout(deadlineTimer);
    // Hide stale values immediately without removing/rebuilding all columns or
    // performing any geometry reads. Replacement work is bounded below.
    for (const state of rows.values()) {
      state.binding?.host.setAttribute('data-seatspecs-pending', '');
      enqueue(state, VALUE);
    }
    deadlineTimer = setTimeout(() => settle(), 10000);
    schedule();
  }
  function settle() {
    pending = false;
    for (const state of waiting) enqueue(state, VALUE);
  }
  function register(summary: Element) {
    const row = summary.closest<HTMLElement>('li');
    if (!row) return;
    let state = rows.get(row);
    if (!state) {
      state = { row, id: '', idNode: null, identityNode: null, button: null, summary: null, identityUrl: null, itinerary: null, invalidIdentity: false, dormant: false, containers: [], flags: 0, binding: null };
      rows.set(row, state); intersection.observe(row);
    }
    enqueue(state, STRUCTURE | VALUE);
  }
  function discover() {
    const roots = new Set(discoveries); discoveries.clear();
    for (const root of roots) {
      if (!root.isConnected) continue;
      let ancestor = root.parentElement, covered = false;
      while (ancestor) { if (roots.has(ancestor)) { covered = true; break; } ancestor = ancestor.parentElement; }
      if (covered) continue;
      if (root instanceof Element && root.matches(SUMMARY)) register(root);
      else root.querySelectorAll(SUMMARY).forEach(register);
    }
  }
  function refresh(state: RowState) {
    state.button = state.row.querySelector<HTMLElement>('button[aria-expanded]');
    state.summary = state.row.querySelector(SUMMARY);
    state.idNode = state.row.querySelector('[data-slice-id]') || state.row.querySelector('[data-id]');
    setId(state, state.idNode?.getAttribute('data-slice-id') || state.idNode?.getAttribute('data-id') || '');
    state.itinerary = null; state.invalidIdentity = false;
    state.identityNode = state.row.querySelector('[data-travelimpactmodelwebsiteurl]');
    const url = state.identityNode?.getAttribute('data-travelimpactmodelwebsiteurl') || null;
    state.identityUrl = url;
    if (url) {
      try { state.itinerary = new URL(url).searchParams.get('itinerary'); }
      catch { state.invalidIdentity = true; }
    }
  }
  /** This entire phase is read-only with respect to the DOM. */
  function readAnchor(state: RowState): AnchorPlan | null {
    // Unpriced results have no anchor yet. Native rerenders can touch hundreds
    // of these rows; don't read layout for them on every expand/collapse.
    if (!state.row.querySelector('[data-gs]') || !visible(state.row)) return null;
    const summary = [...state.row.querySelectorAll(SUMMARY)].find(visible);
    if (!summary) return null;
    const anchor = columnAnchor(summary);
    if (!anchor) return null;
    const layout = getComputedStyle(anchor.parent).display, priceStyle = getComputedStyle(anchor.price);
    let grid: GridPlan | null = null, caption: HTMLElement | null = null;
    if (layout === 'grid') {
      const column = Number(priceStyle.gridColumnStart);
      if (!Number.isInteger(column) || column < 2) return null;
      const old = state.binding?.parent === anchor.parent ? state.binding : null;
      const nativePriceRow = old?.grid?.nativePriceRow ?? Number(priceStyle.gridRowStart);
      const children = [...anchor.parent.children].filter((e): e is HTMLElement => e instanceof HTMLElement && !e.hasAttribute(CELL));
      caption = old?.caption?.isConnected ? old.caption : children.find(e => e !== anchor.price && Number(getComputedStyle(e).gridColumnStart) === column && Number(getComputedStyle(e).gridRowStart) === nativePriceRow + 1) || null;
      const nativeCaptionRow = old?.grid?.nativeCaptionRow ?? (caption ? Number(getComputedStyle(caption).gridRowStart) : nativePriceRow + 1);
      const last = Math.max(1, ...children.map(e => e === anchor.price ? nativePriceRow : e === caption ? nativeCaptionRow : Number(getComputedStyle(e).gridRowStart) || 0));
      grid = { column, priceRow: last + 1, captionRow: last + 2, nativePriceRow, nativeCaptionRow };
    }
    return { ...anchor, summary, caption, layout, grid };
  }
  function presentation(state: RowState): Presentation {
    const record = records.get(state.id);
    if (record && !state.invalidIdentity && (!state.itinerary || state.itinerary === record.itinerary)) {
      waiting.delete(state);
      if (!record.presentation || record.presentation.locale !== locale) record.presentation = {
        key: `${generation}:${record.revision}:${locale}`, locale, record, fallback: '',
        description: '' // Each exposed seat/Wi-Fi item supplies its own name.
      };
      return record.presentation;
    }
    const loading = pending && Date.now() - startedAt < 10000;
    if (loading) waiting.add(state); else waiting.delete(state);
    return { key: `${generation}:${locale}:${loading ? 'loading' : 'unavailable'}`, locale, record: null, fallback: loading ? '…' : '—', description: loading ? labels.loading : labels.unavailable };
  }
  function prepare(state: RowState): Prepared {
    const flags = state.flags; state.flags = 0;
    if (!state.row.isConnected) return { state, expanded: false, remove: true };
    if ((flags & STRUCTURE) || !state.row.contains(state.button) || !state.row.contains(state.summary)
      || !state.row.contains(state.idNode) || state.identityNode && !state.row.contains(state.identityNode)) refresh(state);
    if (!state.button || !state.summary || !state.id) {
      // Google can append a summary, then its identity/button in later tasks.
      // Keep tracking the row: removing it here loses subsequent additions
      // which do not themselves contain another summary node.
      setDormant(state, true); waiting.delete(state);
      return { state, expanded: false, incomplete: true };
    }
    const expanded = state.button.getAttribute('aria-expanded') === 'true';
    // Preserve the collapsed column while Google animates/renders details.
    // Never bind to the expanded header, read hidden geometry, or render SVGs.
    if (expanded) return { state, expanded };
    const binding = state.binding;
    let anchor: AnchorPlan | undefined;
    const valid = binding && state.row.contains(binding.parent) && binding.parent.contains(binding.price) && state.summary.contains(binding.parent);
    // Native list animations change every summary's classes, not its columns.
    // Only verify cached geometry for structural/direct layout changes or a
    // real resize; cached reattachments and value updates need no layout reads.
    if (!valid || state.dormant || ((flags & (CHECK_LAYOUT | STRUCTURE)) && (getComputedStyle(binding!.parent).display !== binding!.layout || !visible(binding!.parent) || !visible(binding!.price)))) {
      const next = readAnchor(state);
      if (!next) { setDormant(state, true); return { state, expanded: false }; }
      anchor = next;
    }
    setDormant(state, false);
    return { state, expanded: false, anchor, value: presentation(state) };
  }
  function setAttribute(element: Element, name: string, value: string) { if (element.getAttribute(name) !== value) element.setAttribute(name, value); }
  function applyMarkers(binding: RowBinding) {
    setAttribute(binding.parent, LAYOUT, binding.layout); setAttribute(binding.price, PRICE, '');
    if (binding.grid) {
      if (binding.caption) setAttribute(binding.caption, 'data-seatspecs-caption', '');
      for (const [name, value] of [['--seatspecs-price-row', String(binding.grid.priceRow)], ['--seatspecs-caption-row', String(binding.grid.captionRow)]]) {
        if (binding.parent.style.getPropertyValue(name) !== value) binding.parent.style.setProperty(name, value);
      }
    }
  }
  /** Restore already-rendered, unchanged cells during mutation delivery, before
   * paint. Deferring this to rAF leaves a visible hole when Google patches its
   * list inside an rAF callback. No geometry reads, SVG creation, or global scan.
   */
  function restoreBeforePaint(state: RowState) {
    const binding = state.binding;
    if (!binding || !binding.rendered || awaitingContext || binding.generation !== generation || binding.layoutEpoch !== layoutEpoch || !state.row.isConnected) return;
    const id = state.idNode?.getAttribute('data-slice-id') || state.idNode?.getAttribute('data-id') || '';
    if (!state.row.contains(state.button) || !state.row.contains(state.idNode)
      || state.identityNode && !state.row.contains(state.identityNode) || id !== state.id
      || (state.identityNode?.getAttribute('data-travelimpactmodelwebsiteurl') || null) !== state.identityUrl) refresh(state);
    // Recycled IDs/dates and replaced anchors are not a cached-reattachment
    // case. Let normal reconciliation validate and render their new data.
    if (!state.button || !state.row.contains(state.button) || state.invalidIdentity || binding.host.dataset.seatspecsId !== state.id
      || binding.itinerary !== state.itinerary || !state.row.contains(binding.summary)
      || !binding.summary.contains(binding.parent) || !binding.parent.contains(binding.price)) return;
    if (state.button.getAttribute('aria-expanded') === 'true') {
      if (!binding.host.hidden) binding.host.hidden = true;
      return;
    }
    if (binding.host.parentElement !== binding.parent || binding.host.nextElementSibling !== binding.price) {
      const attempts = paintRepairs.get(state) || 0;
      // Bound observer-to-observer fights: never create an unbounded microtask
      // loop if a future Google renderer immediately removes our insertion.
      if (attempts >= 2) return;
      paintRepairs.set(state, attempts + 1);
      applyMarkers(binding);
      binding.parent.insertBefore(binding.host, binding.price);
    }
    if (binding.host.hidden) binding.host.hidden = false;
  }
  /** No geometry reads below this point: all writes for the batch stay together. */
  function commit(update: Prepared) {
    const { state } = update;
    if (update.remove || !state.row.isConnected) { removeRow(state); return; }
    if (update.incomplete) { removeBinding(state); return; }
    if (update.expanded) { if (state.binding && !state.binding.host.hidden) state.binding.host.hidden = true; return; }
    if (update.anchor) {
      removeBinding(state);
      const host = doc.createElement('span'); host.setAttribute(CELL, ''); host.dataset.seatspecsVersion = VERSION; host.dataset.seatspecsBuild = BUILD_ID; host.setAttribute('role', 'note');
      // Disable native tooltips, including inheritance from Google's ancestors.
      // Localized descriptions live on separate accessible seat/Wi-Fi items.
      host.title = '';
      const shadow = host.attachShadow({ mode: 'open' });
      if (sheet) shadow.adoptedStyleSheets = [sheet];
      else { const style = doc.createElement('style'); style.textContent = SEAT_CELL_STYLE; shadow.append(style); }
      const text = doc.createElement('span'); text.setAttribute('data-seatspecs-value', ''); text.setAttribute('aria-hidden', 'true'); shadow.append(text);
      if (update.anchor.grid) { host.style.gridColumn = `2 / ${update.anchor.grid.column}`; host.style.gridRow = String(update.anchor.grid.priceRow); }
      state.summary = update.anchor.summary;
      state.binding = { ...update.anchor, host, text, rendered: '', generation, layoutEpoch, itinerary: state.itinerary };
      const owners = resizeOwners.get(update.anchor.parent) || new Set<RowState>();
      owners.add(state); resizeOwners.set(update.anchor.parent, owners); resize.observe(update.anchor.parent);
    }
    const binding = state.binding;
    if (!binding || !update.value) return;
    applyMarkers(binding);
    // Reattach the same cached host when Google's reconciler removes it. Do not
    // rebuild its stylesheet/SVG subtree on every expand/collapse animation.
    if (binding.host.parentElement !== binding.parent || binding.host.nextElementSibling !== binding.price) binding.parent.insertBefore(binding.host, binding.price);
    const value = update.value;
    binding.generation = generation; binding.layoutEpoch = layoutEpoch; binding.itinerary = state.itinerary;
    if (binding.rendered !== value.key) {
      if (value.record) renderSeatSegments(binding.text, value.record.segments, labels);
      else binding.text.textContent = value.fallback;
      binding.rendered = value.key;
    }
    if (binding.host.hidden) binding.host.hidden = false;
    binding.host.removeAttribute('data-seatspecs-pending');
    // A combined host name plus aria-hidden content merges both fields for AT.
    // Expose the per-leg groups and independently named items instead. Only
    // loading/missing-result placeholders use a single named note.
    setAttribute(binding.host, 'role', value.record ? 'group' : 'note');
    if (value.record) {
      if (binding.host.hasAttribute('aria-label')) binding.host.removeAttribute('aria-label');
      if (binding.text.hasAttribute('aria-hidden')) binding.text.removeAttribute('aria-hidden');
    } else {
      setAttribute(binding.host, 'aria-label', value.description);
      setAttribute(binding.text, 'aria-hidden', 'true');
    }
    if (binding.host.lang !== value.locale) binding.host.lang = value.locale;
    if (binding.host.dataset.seatspecsId !== state.id) binding.host.dataset.seatspecsId = state.id;
  }
  function flush() {
    scheduled = false; paintRepairs = new WeakMap();
    const key = navigationKey(win.location.href);
    if (key !== observedUrl) { observedUrl = key; awaitingContext = true; reset(generation); }
    if (!isFlightsPath(win.location.pathname)) {
      for (const state of [...rows.values()]) removeRow(state);
      discoveries.clear(); return;
    }
    const language = pageLanguage(doc, win.location.href);
    if (language !== locale) { locale = language; labels = labelsFor(locale); for (const state of rows.values()) enqueue(state, VALUE); }
    if (cleanupPending) { cleanupPending = false; for (const state of [...rows.values()]) if (!state.row.isConnected) removeRow(state); }
    if (discoveries.size) discover();
    const prepared: Prepared[] = [], start = performance.now();
    let newValues = 0;
    while (urgent.size || background.size) {
      const queue = urgent.size ? urgent : background;
      const state = queue.values().next().value!; queue.delete(state);
      if (rows.get(state.row) === state) {
        const update = prepare(state); prepared.push(update);
        if (update.anchor || update.value && update.value.key !== state.binding?.rendered) newValues++;
      }
      // Reattaching cached hosts is cheap and should finish in one write pass,
      // not stretch a native full-list rerender across dozens of layout passes.
      if (newValues >= MAX_NEW_ROWS_PER_FRAME || prepared.length >= MAX_CACHED_ROWS_PER_FRAME || performance.now() - start >= READ_BUDGET_MS) break;
    }
    for (const update of prepared) commit(update);
    if (urgent.size || background.size || discoveries.size || cleanupPending) schedule();
  }
  function owner(element: Element): RowState | undefined {
    let row = element.closest<HTMLElement>('li');
    while (row) { const state = rows.get(row); if (state) return state; row = row.parentElement?.closest<HTMLElement>('li') || null; }
    return undefined;
  }
  win.addEventListener('message', event => {
    if (event.source !== win || event.origin !== win.location.origin || !isBridgeMessage(event.data)) return;
    const message = event.data;
    if (message.generation < generation) return;
    if (message.type === 'context-start' || message.type === 'navigation') {
      observedUrl = navigationKey(win.location.href); awaitingContext = false;
      if (message.generation > generation) reset(message.generation);
      return;
    }
    if (message.generation !== generation || awaitingContext) return;
    if (message.type === 'results-upsert') {
      for (const result of message.results) {
        const previous = records.get(result.id);
        if (previous && previous.sequence > message.sequence) continue;
        const signature = JSON.stringify(result.segments);
        if (previous?.signature === signature) { previous.sequence = message.sequence; continue; }
        records.delete(result.id);
        records.set(result.id, { ...result, sequence: message.sequence, signature, itinerary: flightIdentity(result), revision: ++revision });
        for (const state of rowsById.get(result.id) || []) enqueue(state, VALUE);
        if (records.size > MAX_RESULTS) {
          const id = records.keys().next().value!; records.delete(id);
          for (const state of rowsById.get(id) || []) enqueue(state, VALUE);
        }
      }
    } else if (message.type === 'request-end') {
      clearTimeout(settleTimer);
      if (!message.pending) settleTimer = setTimeout(settle, 500);
    }
  });
  const observer = new MutationObserver(mutations => {
    const attributes = new Map<Element, Set<string>>();
    const restore = new Set<RowState>();
    for (const mutation of mutations) {
      const target = mutation.target instanceof Element ? mutation.target : mutation.target.parentElement;
      if (!target || !target.isConnected || target.hasAttribute(CELL)) continue;
      if (mutation.type === 'attributes') {
        // Compare the first old value with the final value for the whole batch.
        // Google sometimes removes/reapplies identical classes in one render.
        const names = attributes.get(target) || new Set<string>();
        if (names.has(mutation.attributeName!)) continue;
        names.add(mutation.attributeName!); attributes.set(target, names);
        if (mutation.oldValue === target.getAttribute(mutation.attributeName!)) continue;
        if (mutation.attributeName === 'lang') { for (const state of rows.values()) enqueue(state, VALUE); continue; }
        const state = owner(target);
        if (state && mutation.attributeName === 'aria-expanded') restore.add(state);
        if (mutation.attributeName === 'class' || mutation.attributeName === 'style') {
          // A summary can become visible after its row was appended. Watch
          // only that row's layout/ancestors, never unrelated ripple styles.
          for (const dormant of dormantOwners.get(target) || []) enqueue(dormant, VALUE);
          if (state) {
            const layoutNode = target === state.binding?.parent || target === state.binding?.price;
            const ancestor = !!state.summary && target.contains(state.summary);
            const relevant = target === state.row || ancestor || layoutNode || state.dormant && !!state.summary?.contains(target);
            const visibility = mutation.attributeName === 'style' && /display|visibility/.test((mutation.oldValue || '') + (target.getAttribute('style') || ''));
            if (relevant) enqueue(state, VALUE | (layoutNode || visibility ? CHECK_LAYOUT : 0));
          }
          continue;
        }
        if (state && (mutation.attributeName === 'data-gs' || mutation.attributeName === 'data-co2currentflight')) {
          if (!state.binding || state.dormant) enqueue(state, VALUE);
        } else if (state) enqueue(state, mutation.attributeName === 'aria-expanded' ? EXPANSION : STRUCTURE | VALUE, mutation.attributeName === 'aria-expanded');
        else if (target.matches(SUMMARY)) { discoveries.add(target); schedule(); }
        continue;
      }
      const state = owner(target);
      const removedHost = state?.binding && [...mutation.removedNodes].some(n => n === state.binding!.host);
      const elements = [...mutation.addedNodes, ...mutation.removedNodes].filter((n): n is Element => n instanceof Element && !n.hasAttribute(CELL));
      if (!removedHost && !elements.length) continue;
      if (state) {
        // Detail-list population and ripple animations do not affect a collapsed
        // summary. In particular, never rescan every result for these changes.
        const changed = !state.id || !state.button?.isConnected || !state.summary?.isConnected
          || !!state.idNode && !state.idNode.isConnected || !!state.identityNode && !state.identityNode.isConnected
          || !!state.binding && (!state.binding.parent.isConnected || !state.binding.price.isConnected);
        if (removedHost || changed || target === state.row || state.summary?.contains(target) || !!state.summary && target.contains(state.summary)) {
          // Incremental DOM can move the SAME native price around a removed
          // column. Connected anchor/identity refs remain valid: reattach the
          // cached host without querying or measuring every unchanged summary.
          const structure = changed || target === state.row || elements.some(e => e.matches(SUMMARY) || !!e.querySelector(SUMMARY)
            || !state.identityNode && (e.hasAttribute('data-travelimpactmodelwebsiteurl') || !!e.querySelector('[data-travelimpactmodelwebsiteurl]')));
          enqueue(state, (structure ? STRUCTURE : 0) | VALUE, !!removedHost);
          if (removedHost) restore.add(state);
        }
      } else {
        for (const node of mutation.addedNodes) if (node instanceof Element && !node.hasAttribute(CELL)) discoveries.add(node);
        if ([...mutation.removedNodes].some(n => n instanceof Element && !n.hasAttribute(CELL))) cleanupPending = true;
        schedule();
      }
    }
    // All paint-critical repairs are write-only and grouped after inspection.
    for (const state of restore) restoreBeforePaint(state);
  });
  // Ignore unchanged attributes and route class/style changes only to their
  // owning summary. Never rescan the document for animation or text churn.
  observer.observe(doc, { childList: true, subtree: true, attributes: true, attributeOldValue: true, attributeFilter: ['aria-expanded', 'data-id', 'data-slice-id', 'data-seatingclass', 'data-travelimpactmodelwebsiteurl', 'data-gs', 'data-co2currentflight', 'lang', 'jsname', 'class', 'style'] });
  win.addEventListener('resize', () => { layoutEpoch++; for (const state of rows.values()) enqueue(state, CHECK_LAYOUT); }, { passive: true });
  win.addEventListener('popstate', schedule);
  win.addEventListener('pageshow', () => { for (const state of rows.values()) enqueue(state, CHECK_LAYOUT | VALUE); schedule(); });
  reset(0); discoveries.add(doc); schedule();
  win.postMessage({ source: UI_SOURCE, version: PROTOCOL, type: 'ready' }, win.location.origin);
}
if (typeof window !== 'undefined') installContent(window);
