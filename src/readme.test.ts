import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

function routesTable(text: string): string {
  const start = text.indexOf('## Routes');
  const next = text.indexOf('\n## ', start + 1);
  return text.slice(start, next);
}

describe('README routes', () => {
  it('The README lists the new routes beside the old ones', () => {
    const table = routesTable(readFileSync(join(process.cwd(), 'README.md'), 'utf8'));
    expect(table).toContain('| `/` | live |');
    expect(table).toContain('| `/assets/` | live |');
    expect(table).toContain('| `/api/tree` | live |');
    expect(table).toContain('| `/api/file` | live |');
    expect(table).toContain('| `/api/graph` | live |');
    expect(table).toContain('| `/api/rescan` | live |');
    expect(table).toContain('| `/api/layout` | live |');
    expect(table).toContain('| `/api/detail` | live |');
  });

  it('lists every live route and BINDWEED_PORT', () => {
    const text = readFileSync(join(process.cwd(), 'README.md'), 'utf8');
    expect(text).toContain('| `/` | live |');
    expect(text).toContain('| `/assets/` | live |');
    expect(text).toContain('| `/api/tree` | live |');
    expect(text).toContain('| `/api/file` | live |');
    expect(text).toContain('| `/api/graph` | live |');
    expect(text).toContain('| `/api/rescan` | live |');
    expect(text).toContain('| `/api/layout` | live |');
    expect(text).toContain('| `/api/detail` | live |');
    expect(text).toContain('BINDWEED_PORT');
  });
});
