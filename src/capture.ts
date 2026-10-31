import { bootstrapPayload, contextFromBody, extractResults, shoppingContext, shoppingEndpoint } from './google-data';
import { MAX_RESPONSE, PROTOCOL, SOURCE, UI_SOURCE, isFlightsPath, navigationKey, type DataEvent } from './model';
import { CaptureSession, type Ticket } from './session';
import { ShoppingStream } from './stream';

declare global { interface Window { AF_dataServiceRequests?: Record<string, { id?: string; request?: unknown }>; } }
export function installCapture(win: Window): void {
  let ready = false, sequence = 0;
  const origin = win.location.origin;
  const emit = (event: DataEvent) => {
    if (ready) win.postMessage({ ...event, source: SOURCE, version: PROTOCOL }, origin);
  };
  const session = new CaptureSession(emit);
  let routeKey = navigationKey(win.location.href);
  const locale = () => win.document.documentElement?.lang || new URL(win.location.href).searchParams.get('hl') || 'en';
  const checkNavigation = () => {
    const key = navigationKey(win.location.href);
    if (key !== routeKey) { routeKey = key; session.navigate(); }
  };
  win.addEventListener('message', event => {
    if (event.source !== win || event.origin !== origin || event.data?.source !== UI_SOURCE || event.data?.version !== PROTOCOL || event.data?.type !== 'ready') return;
    ready = true; session.snapshot();
  });
  for (const name of ['pushState', 'replaceState'] as const) {
    const original = win.history[name];
    win.history[name] = new Proxy(original, {
      apply(target, receiver, args) {
        const result = Reflect.apply(target, receiver, args);
        checkNavigation(); return result;
      }
    });
  }
  win.addEventListener('popstate', checkNavigation);
  win.addEventListener('pageshow', () => { checkNavigation(); if (ready) session.snapshot(); });

  async function ticketFor(input: RequestInfo | URL, init: RequestInit | undefined, seq: number, route: number, language: string): Promise<Ticket | null> {
    let body = '';
    try {
      if (typeof init?.body === 'string') body = init.body;
      else if (init?.body instanceof URLSearchParams) body = init.body.toString();
      else if (!init?.body && input instanceof Request) body = await input.clone().text();
    } catch { return null; }
    const key = contextFromBody(body, language);
    return key ? session.open(key, seq, route) : null;
  }
  const originalFetch = win.fetch;
  if (originalFetch) win.fetch = new Proxy(originalFetch, {
    apply(target, receiver, args: Parameters<typeof fetch>) {
      // Snapshot a Request body before native fetch marks the original body used.
      // Never await this work or replace Google's original returned Promise.
      let ticket: Promise<Ticket | null> | null = null;
      try {
        const [input, init] = args;
        const url = input instanceof Request ? input.url : String(input);
        if (shoppingEndpoint(url, win.location.href)) ticket = ticketFor(input, init, ++sequence, session.route, locale());
      } catch { /* Capture is optional; native fetch still runs unchanged. */ }
      const original: Promise<Response> = Reflect.apply(target, receiver, args);
      if (!ticket) return original;
      try {
        void original.then(async response => {
          if (!response.ok) { const t = await ticket; if (t) session.end(t); return; }
          // Clone immediately, before Google's consumer can lock its body.
          const clone = response.clone();
          const reader = clone.body?.getReader();
          let timer: ReturnType<typeof setTimeout> | undefined;
          let t: Ticket | null = null;
          try {
            t = await ticket;
            if (!t || !reader) return;
            const stream = new ShoppingStream(data => session.upsert(t!, extractResults(data)));
            const decoder = new TextDecoder();
            timer = setTimeout(() => { void reader.cancel().catch(() => {}); }, 30000);
            let sliceStarted = performance.now();
            while (true) {
              const chunk = await reader.read();
              if (chunk.done) break;
              stream.push(decoder.decode(chunk.value, { stream: true }));
              // Buffered read() promises may all resolve in microtasks. Yield a
              // real task so large show-more streams cannot starve user input.
              if (performance.now() - sliceStarted >= 4) {
                await new Promise<void>(resolve => win.setTimeout(resolve, 0));
                sliceStarted = performance.now();
              }
            }
            stream.push(decoder.decode());
          } catch { /* All diagnostic failures are isolated from Google. */ }
          finally {
            clearTimeout(timer);
            if (reader) { void reader.cancel().catch(() => {}); }
            if (t) session.end(t);
          }
        }, async () => { const t = await ticket; if (t) session.end(t); }).catch(() => {});
      } catch { /* Preserve native fetch even if observation cannot start. */ }
      return original;
    }
  });

  const xhrMeta = new WeakMap<XMLHttpRequest, { url: string }>();
  const xhrPrototype = XMLHttpRequest.prototype;
  const nativeOpen = xhrPrototype.open, nativeSend = xhrPrototype.send;
  xhrPrototype.open = new Proxy(nativeOpen, {
    apply(target, receiver: XMLHttpRequest, args) {
      const result = Reflect.apply(target, receiver, args);
      xhrMeta.set(receiver, { url: String(args[1]) }); return result;
    }
  });
  xhrPrototype.send = new Proxy(nativeSend, {
    apply(target, xhr: XMLHttpRequest, args) {
      const url = xhrMeta.get(xhr)?.url;
      if (url && shoppingEndpoint(url, win.location.href)) {
        try {
          const body = args[0];
          const key = contextFromBody(typeof body === 'string' ? body : body instanceof URLSearchParams ? body.toString() : '', locale());
          const ticket = key ? session.open(key, ++sequence) : null;
          if (ticket) {
            let offset = 0;
            const stream = new ShoppingStream(data => session.upsert(ticket, extractResults(data)));
            const progress = () => {
              try {
                if ((xhr.responseType === '' || xhr.responseType === 'text') && xhr.status >= 200 && xhr.status < 300) {
                  const text = xhr.responseText;
                  stream.push(text.slice(offset)); offset = text.length;
                }
              } catch { /* Not all XHR response types expose responseText. */ }
            };
            const finish = () => {
              progress();
              try {
                if (xhr.responseType === 'json' && xhr.status >= 200 && xhr.status < 300) session.upsert(ticket, extractResults(xhr.response));
              } catch { /* Missing/unsupported response. */ }
              xhr.removeEventListener('progress', progress);
              xhr.removeEventListener('loadend', finish);
              session.end(ticket);
            };
            xhr.addEventListener('progress', progress);
            xhr.addEventListener('loadend', finish);
          }
        } catch { /* Observation cannot prevent sending Google's request. */ }
      }
      return Reflect.apply(target, xhr, args);
    }
  });

  const processed = new WeakSet<HTMLScriptElement>();
  function inspectScript(script: HTMLScriptElement) {
    if (processed.has(script) || script.src || !isFlightsPath(win.location.pathname)) return;
    const text = script.textContent || '';
    if (!text || text.length > MAX_RESPONSE) return;
    const payload = bootstrapPayload(text);
    if (!payload) return;
    processed.add(script);
    const request = win.AF_dataServiceRequests?.[payload.key];
    if (request && request.id !== 'LqxFAb') return;
    const results = extractResults(payload.data);
    if (!results.length) return;
    const key = shoppingContext(request?.request, locale()) || `bootstrap:${routeKey}:${locale()}`;
    const ticket = session.open(key, 0);
    if (ticket) { session.upsert(ticket, results); session.end(ticket); }
  }
  const observer = new MutationObserver(records => {
    for (const record of records) {
      const target = record.target instanceof Element ? record.target : record.target.parentElement;
      if (target instanceof HTMLScriptElement) inspectScript(target);
      const renderingFlight = target?.closest('[jsname="HSrbLb"], [jsname="XxAJue"]');
      for (const node of record.addedNodes) if (node instanceof Element) {
        if (node instanceof HTMLScriptElement) inspectScript(node);
        else if (!renderingFlight && !node.hasAttribute('data-seatspecs-cell')) node.querySelectorAll('script').forEach(inspectScript);
      }
    }
  });
  observer.observe(win.document, { childList: true, subtree: true, characterData: true });
  [...win.document.scripts].forEach(inspectScript);
}
if (typeof window !== 'undefined') installCapture(window);
