# SeatSpecs store artwork

## Ready to upload

| File | Size / format | Use |
| --- | --- | --- |
| `../assets/icons/icon128.png` | 128 × 128, transparent PNG | Store icon; 96 × 96 artwork with 16px margins |
| `screenshots/01-overview.png` | 1280 × 800, opaque 24-bit PNG | First screenshot: seat types, legroom and Wi-Fi in collapsed results |
| `screenshots/02-seat-types.png` | 1280 × 800, opaque 24-bit PNG | Second screenshot: lie-flat versus reclining, including connecting legs |
| `screenshots/03-wifi.png` | 1280 × 800, opaque 24-bit PNG | Third screenshot: free, paid and pricing-unspecified indicators |
| `promotional/small-tile.png` | 440 × 280, opaque 24-bit PNG | Optional small promotional tile |

`preview.png` is a contact sheet for review, **not** a store upload.

The extension package includes 16, 32, 48 and 128px icons. The original editable mark is `../assets/icon.svg`: a reclining seat with specification marks, in cobalt, white and mint. Small exports have optical sizing so they remain readable in a toolbar. The mark does not incorporate Google's logo.

## What the images show

- Native **Google Flights** screens captured in a disposable, signed-out local Chrome profile with the actual extension installed.
- Public example searches: London Heathrow → Doha, Business and Economy. Dates, URLs, capture time, build ID and highlight geometry are recorded in `source/captures/provenance.json`.
- The overview is a contiguous block from **one genuine search**, including a mixed-cabin itinerary with numeric legroom alongside reclining, lie-flat and suite seats, plus paid and free Wi-Fi. Rows are not fabricated or spliced from unrelated searches. Capture fails rather than dropping one of these feature categories; recorded row values are in the provenance file.
- Flight details were never expanded automatically. Capture rejects missing-data dashes as a demonstration of seat types.
- Cobalt outlines are editorial highlights added to the artwork, **not** part of the extension UI. The browser-style frame is also editorial presentation.
- The large seat and Wi-Fi panels are explicitly labeled **icon guides**, not popups or controls. Their exact SVGs were extracted from the installed extension on sanitized browser-test fixtures and stored in `source/glyphs.json`.
- The screenshots do not advertise meals, other booking websites, speed tiers, measured Wi-Fi performance, or seat maps. A blank Wi-Fi slot is not presented as proof of no Wi-Fi.
- Flight prices, aircraft equipment, availability and Google markup can change. These are example captures, not live fare offers or guarantees.

Google Flights and airline logos appear only as part of genuine product screenshots. Their trademarks remain with their owners. SeatSpecs is an independent extension and is not affiliated with Google or the airlines.

## Editable sources and regeneration

`source/artboards.html` contains all layout, typography and copy. It uses locally installed Adwaita Sans with an Arial/sans-serif fallback. No font or image-generation service is contacted. Upload PNGs are already rendered, so end users do not need those fonts.

Normal builds simply copy the checked-in icons. They do **not** require a browser, public Google requests, or artwork regeneration.

To regenerate icons and composed screenshots **offline** from the checked-in captures:

```sh
PLAYWRIGHT_CHROMIUM_EXECUTABLE=/path/to/local/chromium npm run artwork
```

To render just the icon sizes:

```sh
PLAYWRIGHT_CHROMIUM_EXECUTABLE=/path/to/local/chromium npm run artwork -- --icons-only
```

To explicitly refresh the genuine Google Flights captures and symbol guide:

```sh
PLAYWRIGHT_CHROMIUM_EXECUTABLE=/path/to/local/chromium \
STORE_FLIGHTS_DATE=YYYY-MM-DD npm run artwork -- --capture
```

Capture mode builds the extension first and contacts public Google Flights. Omit `STORE_FLIGHTS_DATE` to use a date 45 days ahead. It creates and removes its own local profile; it never touches a connected remote browser. Google availability/consent/markup changes can make capture fail. The stored captures intentionally remain stable until an explicit refresh.

After changing the mark, run `npm run build` or `npm run package` to include the new PNGs. Icons participate in the deterministic build identifier.

Before publishing, review the images at both full and half size. Do not assume that assets have been uploaded or approved by the Chrome Web Store.

## Chrome guidance checked

- [Supplying images](https://developer.chrome.com/docs/webstore/images): 128px icon, preferred 1280 × 800 screenshots, full-bleed canvases and 440 × 280 promotional tile.
- [Manifest icons](https://developer.chrome.com/docs/extensions/reference/manifest/icons): raster PNGs in the package; SVG is only the editable source.
