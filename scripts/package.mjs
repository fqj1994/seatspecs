import { execFileSync } from 'node:child_process';
import { readFile, rm } from 'node:fs/promises';
const branding = JSON.parse(await readFile('src/branding.json', 'utf8'));
await rm(branding.archive, { force: true });
execFileSync('zip', ['-q', '-r', `../${branding.archive}`, '.'], { cwd: 'dist', stdio: 'inherit' });
console.log(`Packaged ${branding.archive} (extract before Load unpacked)`);
