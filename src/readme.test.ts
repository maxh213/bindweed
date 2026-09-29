import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('README routes', () => {
  it('lists every live route and BINDWEED_PORT', () => {
    const text = readFileSync(join(process.cwd(), 'README.md'), 'utf8');
    expect(text).toContain('| `/` | live |');
    expect(text).toContain('| `/assets/` | live |');
    expect(text).toContain('| `/api/tree` | live |');
    expect(text).toContain('| `/api/file` | live |');
    expect(text).toContain('BINDWEED_PORT');
  });
});
