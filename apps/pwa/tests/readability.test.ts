import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const src = resolve(here, '../src');
const css = readFileSync(resolve(src, 'styles.css'), 'utf8');

function luminance(hex: string) {
  const c = hex.replace('#', '').match(/../g)!.map((h) => parseInt(h, 16) / 255)
    .map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}
const contrast = (a: string, b: string) => {
  const [l1, l2] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (l1 + 0.05) / (l2 + 0.05);
};
const token = (name: string) => css.match(new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{6})`))![1];

describe('readability floor (Impeccable audit, 19 Oct)', () => {
  it('--ink-dim meets WCAG AA 4.5:1 on the glass panel colour (#0c111e)', () => {
    expect(contrast(token('ink-dim'), '#0c111e')).toBeGreaterThanOrEqual(4.5);
  });

  it('no route or HUD label renders text below 12px', () => {
    const files = readdirSync(resolve(src, 'routes')).filter((f) => f.endsWith('.tsx'))
      .map((f) => resolve(src, 'routes', f)).concat(resolve(src, 'i18n/LanguageToggle.tsx'));
    const tiny = files.flatMap((f) =>
      [...readFileSync(f, 'utf8').matchAll(/fontSize:\s*(\d+)\b/g)].filter((m) => Number(m[1]) < 12).map((m) => `${f}: ${m[0]}`));
    expect(tiny).toEqual([]);
    for (const m of css.matchAll(/font-size:\s*(\d+)px/g)) expect(Number(m[1])).toBeGreaterThanOrEqual(12);
  });

  it('the status chip row shows that it scrolls and keeps the active chip in view', () => {
    const tickets = readFileSync(resolve(src, 'routes/tickets.tsx'), 'utf8');
    expect(tickets).toMatch(/className="[^"]*chip-row/);
    expect(css).toMatch(/\.chip-row\s*\{[^}]*mask-image/);
    expect(tickets).toMatch(/scrollIntoView\(/);
  });
});
