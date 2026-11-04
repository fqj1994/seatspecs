// GitHub Pages publishes only docs/. Keep its assets self-contained and checked in.
// No build, browser, network access, or new dependencies are required.
import { copyFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const files = [
  ['assets/icon.svg', 'docs/assets/icon.svg'],
  ['store/screenshots/01-overview.png', 'docs/assets/01-overview.png'],
  ['store/screenshots/02-seat-types.png', 'docs/assets/02-seat-types.png'],
  ['store/screenshots/03-wifi.png', 'docs/assets/03-wifi.png']
];
for (const [source, destination] of files) {
  await mkdir(path.dirname(path.join(root, destination)), { recursive: true });
  await copyFile(path.join(root, source), path.join(root, destination));
  console.log(`${source} → ${destination}`);
}
