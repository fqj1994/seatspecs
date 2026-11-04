# SeatSpecs

**SeatSpecs — Seat Types, Legroom & WiFi for Google Flights**

A Chrome Manifest V3 extension that shows **seat types—including lie-flat, angled-flat, reclining and suite seats—alongside legroom and Wi-Fi** in collapsed Google Flights results. Details appear between emissions and price, so you can compare more than just seat pitch without expanding every flight.

Currently supports **Google Flights**. SeatSpecs is the product name; the descriptive title reflects the features and website actually supported today.

- **No expand/collapse probing:** no clicks, synthesized input, hidden expanded results, or auxiliary pages.
- **No extra data requests:** reads Google's existing page data and observes cloned native shopping responses. No API keys, backend, analytics, persistent storage, or third-party seat service.
- Supports all **72 languages/variants** currently offered by Google Flights. Seat and Wi-Fi classification use numeric codes, never English words. Measurements retain Google's localized formatting.
- Handles new searches, cabin changes, reused result nodes, incremental responses, sorting, and load more. Connecting flights retain every segment in order, including repeated values.
- Matches **187 Google domains**, limited to Travel/Flights paths. Requires Chrome 111+; no `tabs`, `debugger`, `webRequest`, or storage permissions.

## Build and install

```sh
npm ci
npm run package
```

Outputs:

- `dist/` — unpacked extension; select this folder in Chrome.
- `seatspecs-extension.zip` — transferable package; extract it before loading.
- `dist/BUILD_INFO.json` — product name, version, and deterministic build identifier.
- The package includes SeatSpecs icons at 16, 32, 48 and 128px.

In the browser where you want to use it:

1. Open `chrome://extensions` and enable **Developer mode**.
2. Choose **Load unpacked** and select `dist/`, or the extracted ZIP's folder containing `manifest.json`.
3. Reload an existing Google Flights tab, or open a new results page.
4. After updating the files, manually press **Reload** on the extension card, then reload the Flights page.

When updating from **Google Flights Seat Information**, replace the files in the existing unpacked-extension directory rather than loading a second copy. The archive is `seatspecs-extension.zip`. Reload both the extension and the Flights page: capture and rendering now use the SeatSpecs namespace throughout. Permissions and supported sites are unchanged.

The project directory can be renamed freely; scripts resolve project-relative files and do not depend on its original name. If you move the directory Chrome loaded unpacked, remove its old extension entry and use **Load unpacked** with the new `dist/` path, then refresh Flights. Do not leave two copies enabled.

**The connected automation browser may be remote.** Building here does not install or reload anything there. Transfer the ZIP/folder to that machine and perform the steps manually. Remote loading, reloading, and unloading must be done by the user. Browser automation must wait for confirmation and must not inject the feature's source as a substitute for testing the installed extension.

The Chrome extension card displays the SeatSpecs title and `1.0.0+<build-id>`. On a results page, each added host also exposes `data-seatspecs-version` and `data-seatspecs-build`, so validation can confirm the exact installed build. There is no extension popup.

## Display behavior

- Economy/premium seats: Google's pitch value, e.g. `32 in` or `81厘米`.
- Premium cabins: compact, distinct icons for extra-reclining, lie-flat, suite, standard-recliner, and angled-flat seats. Full localized seat-type descriptions remain available to assistive technology.
- Wi-Fi: an icon beside each segment's seat information **only when Wi-Fi is advertised**. A **check badge** means free; a **dollar ($) badge** means paid (a payment indicator, not a currency or price quote). Wi-Fi with a **question badge** means availability is known but pricing is unspecified. A combined check/dollar badge preserves explicitly listed free and paid service options. Missing, unlisted, or unknown Wi-Fi shows **nothing**—no crossed-out icon, standalone question mark, or placeholder badge.
- Connections: one seat/Wi-Fi row per segment, stacked vertically in flight order, including repetitions. All legs share the same content-sized columns, so seat/pitch values and Wi-Fi icons line up vertically even when a leg has no Wi-Fi badge. Each leg is an accessible group named by its airports and flight number. Seat/pitch and Wi-Fi are independently named items: the seat item describes only the seat, and the Wi-Fi item describes only availability/pricing, without regular/ultra-fast categories. There is no duplicate combined-summary announcement.
- `…`: waiting for data. `—`: Google does not supply recognizable seat information, capture failed, or the result cannot be matched safely. Loading is capped at ten seconds; later valid responses can still update a value.
- The column hides when **you** expand a result and returns when you collapse it. It never changes expansion state itself.
- The combined column is **56px wide**, with each seat/pitch value and its 16px Wi-Fi icon packed together with a **2px visible gap** (no padded seat subcolumn), directly before price, with no overrides to Google's native column widths, flex bases, shrink factors, or gaps. Measurements stay on one line; unusually long values are ellipsized with their full text retained in the accessible description. Long seat-type translations remain accessible metadata instead of consuming flight-information space. Google's compact grid retains its flight-time tracks; seat information and price share a small additional row after emissions.

Wi-Fi flags are read independently for standard and ultra-fast service. When neither service is listed, the Wi-Fi slot stays blank; this is not a guarantee that the flight has no Wi-Fi. Missing, empty, all-null, or unrecognized amenity data also leaves the slot blank and does not suppress valid seat information. The itinerary uses one compact, centered grid with shared seat/pitch and Wi-Fi columns. Values align to the edge nearest Wi-Fi, preserving the 2px gap without padding between visible content. A leg with missing Wi-Fi leaves its shared Wi-Fi position empty instead of recentering its seat value. If every leg lacks Wi-Fi, the unused Wi-Fi column is omitted. The outer column width remains stable. Available Wi-Fi with unspecified pricing is never assumed paid or free. The Wi-Fi item's accessible description uses generic, deduplicated availability/pricing wording, just like the icon's scope. It does not announce regular/ultra-fast categories or an empty secondary field when Wi-Fi is already advertised. Explicit free, paid, and unspecified-pricing facts are preserved without speed labels. When there is no visible Wi-Fi badge, a separate screen-reader-only note preserves unknown/not-listed information without adding a graphic or taking up grid space.

Wi-Fi labels are **not inline text**: only icons appear in the column. Measurements are Google's original payload text. Seat-type labels and generic Wi-Fi availability/pricing labels preserve Google's original localized renderer wording, bundled in JSON for accessibility. Only generic missing-information and unspecified-pricing explanations are extension-authored.

The extension shows **no native hover tooltips**. An empty host `title` also prevents inheriting tooltips from Google's ancestors; full descriptions remain in separate seat and Wi-Fi `aria-label`s, not a single label hiding the whole column. Google's own controls/tooltips are unchanged. For full visual details, manually expand the Google Flights result.

The Google page language is authoritative, not the browser UI language. Alias/script handling includes Hebrew (`iw`/`he`), Serbian Latin/Cyrillic, Chinese variants, and regional English, Spanish, and Portuguese. English is only the fallback for a language not present in the current catalog.

## Icon and Chrome Web Store images

The editable icon is `assets/icon.svg`; checked-in raster exports are in `assets/icons/`. Three **1280 × 800** upload-ready screenshots are in `store/screenshots/`, plus a **440 × 280** promotional tile in `store/promotional/`. Review the full set in `store/preview.png`.

The screenshots use genuine, signed-out Google Flights captures with the extension installed. Blue outlines and the explicitly labeled icon guides are editorial annotations, not additional extension UI. Only current Google Flights features are advertised. See [`store/README.md`](store/README.md) for editable sources, capture provenance, Chrome image requirements and regeneration commands.

`npm run artwork` regenerates icons/compositions offline from checked-in sources and captures; `npm run artwork -- --capture` explicitly refreshes public example searches in a disposable local browser. These are maintainer commands, not part of the extension runtime or normal build.

## Project website and privacy policy (GitHub Pages)

`docs/` is a self-contained static landing page and privacy policy, using the existing SeatSpecs branding and screenshots. It focuses on seat types, legroom and Wi-Fi, with install links to the actual Chrome Web Store listing. There is no JavaScript, analytics, external font service, or site build dependency. The privacy policy distinguishes the extension's local-only processing from GitHub Pages' security logging.

After changing the artwork, run `npm run pages:sync` to refresh the site's checked-in assets. Preview with `python3 -m http.server 8000 --directory docs`.

To publish after pushing to GitHub, choose **Settings → Pages → Deploy from a branch → main → /docs**. Use the resulting `privacy.html` URL in the Web Store dashboard. The supplied Web Store URL is configured; no GitHub remote or Pages domain is assumed, and adding the files does not deploy them. See [`docs/README.md`](docs/README.md) for setup and pre-publication checks, including developer contact details.

## Development and tests

```sh
npm run typecheck
npm test                 # deterministic adapter, stream, context, and locale tests
npx playwright install chromium  # once, if a local Playwright Chromium is absent
npm run test:browser     # builds and loads the actual extension in a separate local profile
npm run build
npm run package
```

To use an existing **local Chromium** executable:

```sh
PLAYWRIGHT_CHROMIUM_EXECUTABLE=/absolute/path/to/chromium npm run test:browser
```

Do not point this at a user profile. Tests create and remove their own profile under `test-results/`. The remote Chrome connection is separate and is not configured by these tests.

Browser fixtures include strict CSP and Trusted Types, actual MAIN/isolated-world extension loading, original fetch/XHR response preservation, Request/URL inputs, rejected requests, delayed bootstrap data, late/reused rows, out-of-order responses, 170-row pagination, repeated connecting segments, no-emissions results, RTL/compact layouts, theme changes, manual expansion, and idle-reconciliation checks. Layout regression tests compare native flight-detail sizing with a page without the extension, enforce the 56px width and same-line pairing without taller segment rows, and verify stacked legs and distinct seat/Wi-Fi icons. Tests also cover all Wi-Fi service/pricing combinations, Wi-Fi-only updates, missing metadata, and cached replay. Actual Chrome accessibility-tree checks verify separate seat/Wi-Fi names, per-leg context, unknown Wi-Fi notes, no duplicate text/summary, updates, cache reattachment, and user expand/collapse. They assert that passive acquisition causes **zero programmatic expansion actions or flight-detail expansion transitions**.

### Show-more performance regressions

Rendering is indexed by result row and itinerary ID. Mutation callbacks enqueue affected rows instead of querying every result. Unrelated animations and net-unchanged class/style updates do no layout work. Data-only changes reuse cached anchors, descriptions, and shared Shadow DOM stylesheets. If Google's renderer removes columns from the entire list, the same cached hosts are reattached without rebuilding their SVGs.

Each normal batch completes layout reads before DOM writes. The read phase targets a 4ms budget, with at most 12 new values/columns or 256 cheap cached updates per frame. Unchanged columns removed during a native render have a separate **before-paint** path: mutation delivery reattaches their existing hosts and restores compact-grid markers without geometry reads, SVG rebuilding, or a document-wide scan. This prevents an empty frame between removal and the next animation-frame batch, including lists larger than the batch limit. Reuse verifies the row identity, search generation, and viewport-layout epoch; recycled IDs/dates and replaced anchors still use validated reconciliation. At most two immediate reattachments per row per frame prevent observer feedback from starving input.

Partially constructed rows stay tracked until their identity, button, and price token arrive. Unpriced rows do not repeatedly trigger layout reads. Large response frames retain chunk slices instead of concatenating each character; buffered fetch capture yields real tasks so input can run.

Local installed-extension regressions cover 360 initial rows, 180 appended rows, and 24 rapid user toggles with full-list native removal/reinsertion across 480 priced plus 150 unpriced rows. The 360-row reproduction dropped from **722 to 32 layout passes**. The full-list-toggle fixture performs zero document-wide queries, only 24 geometry reads, and 24 layout passes, not a rescan of all results per click. Additional pre-paint regressions check 600 cached desktop columns, RTL compact grids, replaced buttons, stale identity rejection, and bounded observer feedback. These are deterministic fixture measurements, not a promise about Google's own rendering time or remote-browser performance.

### Opt-in live smoke test (separate local browser)

This contacts public Google Flights and loads `dist/` in a disposable **local** Chromium profile. It does not access the signed-in remote browser or make bookings. By default it never expands a flight. Explicitly setting `FLIGHTS_TOGGLE_COUNT` enables deliberate local user-input stress testing; it does not change the extension's passive acquisition behavior.

```sh
npm run build
FLIGHTS_URL='https://www.google.com/travel/flights/search?...' node scripts/live-smoke.mjs
# Optional: FLIGHTS_WIDTH=390, FLIGHTS_LOAD_MORE=1,
# PLAYWRIGHT_CHROMIUM_EXECUTABLE=/absolute/path/to/chromium
# Local interaction profiling: FLIGHTS_TOGGLE_COUNT=24,
# FLIGHTS_MIN_RESULTS=100, FLIGHTS_FULL_PAGE=0
# Add FLIGHTS_PAINT_AUDIT=1 to check visible collapsed columns before paint.
# FLIGHTS_AX_AUDIT=1 checks independent seat/Wi-Fi items in Chrome's AX tree.
```

Use a current results URL. Output and screenshots go under `test-results/`. Live availability, consent pages, connectivity, and Google markup can change; deterministic tests remain the normal test command. Report local fixture, local live, and manually installed remote validation separately.

## Implementation

- `src/branding.json`: SeatSpecs product name, descriptive title, summary, and archive filename. Branding and packaged icon artwork participate in the build hash; build-script and package-version/name changes also produce a new build ID.
- `src/capture.ts`: MAIN-world bootstrap/response observation and History API notifications. Returns Google's native fetch Promise unchanged, clones Requests before their body is consumed, reads cloned response streams, and preserves original XHR callbacks.
- `src/google-data.ts`, `src/stream.ts`: bounded safe-JSON parsing and one validated adapter for Google's undocumented arrays. No `eval`, dynamically executed remote code, or localized-word classification.
- `src/session.ts`: search generations, stale-response rejection, per-itinerary ordering, bounded handshake snapshots, and pagination merging.
- `src/content.ts`: validated, data-only bridge; flight-identity checks; indexed affected-row reconciliation, bounded read/write phases, cached host reattachment, and accessible Shadow DOM cells. No background polling.
- `src/wifi.ts`: independent standard/ultra-fast decoding, conservative availability/pricing summaries, localized descriptions, and monochrome status glyphs.
- `src/i18n.ts`, `src/catalogs.json`: bundled page-locale catalogs. Builds and runtime do not fetch translations.
- Internal identifiers use `data-seatspecs-*`, `dataset.seatspecs*`, `--seatspecs-*`, and `__SEATSPECS_BUILD_ID__`. The data/UI bridge sources are `seatspecs-data` and `seatspecs-ui`, with no aliases for the retired namespace.
- The internal data-only bridge uses **protocol version 2**, including required per-segment Wi-Fi states. Version 1 or malformed Wi-Fi messages are ignored. Reload both the extension and Flights page after updating; no persistent-data migration is needed.

Capture is restricted to same-origin Flights shopping endpoints/RPCs. Auth/session fields are neither forwarded across the bridge nor persisted. Response copies are limited to 16 MiB, caches to 2,000 itineraries, and traversal depth/size is bounded. Unsupported page layouts are left alone. Missing values are never inferred from aircraft, airline averages, emissions, or duration. Google's emissions `data-seatingclass` is not treated as the actual segment cabin: Business searches can legitimately return domestic First Class seats. Cabin changes are isolated by search generations; matching still verifies the airports, flight numbers, and departure dates.

### Maintaining Google compatibility

Schema/host/language snapshots were checked on **2026-10-30**. Google provides no stable public contract for this data or DOM. If it changes, update the centralized adapter and sanitized fixtures; never add expand/collapse probing as a fallback.

- Domains: `data/google-domains.json`, from `https://www.google.com/supported_domains`.
- Offered locales: `data/google-locales.json`, from the Flights language-selector data.
- Seat-code and standard/ultra-fast Wi-Fi labels: `src/catalogs.json`, extracted from the corresponding localized Google renderer during development. Generic seat-status strings are in `data/status-labels.json`; Wi-Fi missing-information/pricing explanations are in `data/wifi-status-labels.json`.
- Wi-Fi source fields: amenities at `segment[12]`, standard at `[11]` and ultra-fast at `[12]`. Recognized enum values are `1` (available, price unspecified), `2` (free), and `3` (paid). Default/omitted flags mean not listed only when the amenity message has recognizable metadata; unsupported values remain unknown.

```sh
npm run refresh:locales          # fetch only missing catalogs (maintainer action)
npm run refresh:locales -- --all # refresh existing catalogs too
```

This opt-in maintenance script fetches Google pages/bundles, parses string expressions with Acorn using numeric cases and seat-icon structure, and **does not execute the fetched JavaScript**. Review resulting translations before committing. Runtime never fetches these bundles. Add any newly offered locale to both language/status snapshots and rerun completeness tests.

Google Flights and Google are trademarks of Google LLC. This project is not affiliated with Google.
