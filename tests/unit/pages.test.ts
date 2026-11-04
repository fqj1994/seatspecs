import { readFileSync, existsSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (file: string) => readFileSync(new URL(`../../${file}`, import.meta.url));

describe('self-contained GitHub Pages site', () => {
  it('publishes plain English HTML with no scripts or third-party embeds', () => {
    expect(existsSync(new URL('../../docs/.nojekyll', import.meta.url))).toBe(true);
    for (const file of ['index.html', 'privacy.html']) {
      const html = read(`docs/${file}`).toString();
      expect(html).toContain('<html lang="en">');
      expect(html).toContain('name="viewport"');
      expect(html).toContain('Content-Security-Policy');
      expect(html).toContain("default-src 'none'");
      expect(html).not.toMatch(/<(?:script|iframe|form)\b/i);
      expect(html).not.toMatch(/(?:src|href)=["'](?:\/\/|\/assets\/|https?:\/\/[^"']+\.(?:css|js|png|svg))["']/i);
    }
    expect(read('docs/styles.css').toString()).not.toMatch(/@import|url\(\s*['"]?https?:/i);
  });
  it('keeps published artwork identical to its editable originals and store exports', () => {
    expect(read('docs/assets/icon.svg')).toEqual(read('assets/icon.svg'));
    for (const file of ['01-overview.png', '02-seat-types.png', '03-wifi.png']) expect(read(`docs/assets/${file}`)).toEqual(read(`store/screenshots/${file}`));
  });
  it('links the actual store listing and explains local processing and hosting logs', () => {
    const home = read('docs/index.html').toString();
    const policy = read('docs/privacy.html').toString();
    expect(home).toContain('Know your seat.');
    expect(home).toContain('https://chromewebstore.google.com/detail/seatspecs-%E2%80%94-seat-types-le/ejaocnhjedaengiacnhlppbhgimfehog');
    expect(home).toContain('privacy.html');
    expect(policy).toContain('bounded, in-memory cache');
    expect(policy).toContain('does not transmit search information');
    expect(policy).toContain('IP addresses are logged and stored for security purposes');
    expect(policy).toContain('developer contact or support details');
  });
});
