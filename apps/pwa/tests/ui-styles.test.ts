import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const css = readFileSync(resolve(here, '../src/styles.css'), 'utf8');
const routes = resolve(here, '../src/routes');

describe('shared UI styling reaches the build', () => {
  it('Tailwind scans packages/ui, whose Button and Badge classes live outside the app', () => {
    const m = css.match(/@source\s+"([^"]*packages\/ui\/src)"/);
    expect(m, 'styles.css needs an @source for packages/ui/src').not.toBeNull();
    expect(existsSync(resolve(here, '../src', m![1]))).toBe(true);
  });

  it('no route renders a Button below the 44px touch target (size="sm" is h-9)', () => {
    const offenders = readdirSync(routes)
      .filter((f) => f.endsWith('.tsx'))
      .filter((f) => /<Button[^>]*size="sm"/.test(readFileSync(resolve(routes, f), 'utf8')));
    expect(offenders).toEqual([]);
  });
});
