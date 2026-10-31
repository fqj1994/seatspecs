import { build } from 'esbuild';
import { mkdir, readFile, writeFile, copyFile, rm, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
const pkg = JSON.parse(await readFile('package.json', 'utf8'));
const branding = JSON.parse(await readFile('src/branding.json', 'utf8'));
if (branding.title.length > 75 || branding.name.length > 12 || branding.description.length > 132) throw new Error('Extension branding exceeds metadata length limits');
const domains = JSON.parse(await readFile('data/google-domains.json', 'utf8'));
const hash = createHash('sha256');
for (const file of (await readdir('src')).sort()) hash.update(await readFile(`src/${file}`));
hash.update(JSON.stringify(domains));
// Public metadata/build changes must also produce a new installed build ID.
hash.update(JSON.stringify({ name: pkg.name, version: pkg.version }));
hash.update(await readFile(new URL(import.meta.url), 'utf8'));
const buildId = hash.digest('hex').slice(0, 12);
const matches = domains.flatMap(domain => [`https://*.${domain}/travel/*`, `https://*.${domain}/flights*`]);
await rm('dist', { recursive: true, force: true });
await mkdir('dist', { recursive: true });
await build({ entryPoints: ['src/capture.ts', 'src/content.ts'], bundle: true, outdir: 'dist', format: 'iife', target: 'chrome111', legalComments: 'none', define: { __SEATSPECS_BUILD_ID__: JSON.stringify(buildId) } });
await copyFile('src/content.css', 'dist/content.css');
await writeFile('dist/manifest.json', JSON.stringify({
  manifest_version: 3,
  name: branding.title,
  short_name: branding.name,
  description: branding.description,
  version: pkg.version,
  version_name: `${pkg.version}+${buildId}`,
  minimum_chrome_version: '111',
  content_scripts: [
    { matches, js: ['capture.js'], run_at: 'document_start', world: 'MAIN' },
    { matches, js: ['content.js'], css: ['content.css'], run_at: 'document_start' }
  ],
  content_security_policy: { extension_pages: "script-src 'self'; object-src 'none'" }
}, null, 2) + '\n');
await writeFile('dist/BUILD_INFO.json', JSON.stringify({ name: branding.name, version: pkg.version, buildId }, null, 2) + '\n');
console.log(`Built ${branding.name} dist/ v${pkg.version}+${buildId} (${domains.length} Google domains)`);
