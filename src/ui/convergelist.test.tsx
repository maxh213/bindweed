import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ConvergeList } from './ConvergeList.tsx';

const ROWS = [{ sentence: 'Move src/domain/model.ts to src/app' }, { sentence: 'Note on src/domain: "look here"' }];

function markup(verdict: Parameters<typeof ConvergeList>[0]['verdict']): string {
  return renderToStaticMarkup(createElement(ConvergeList, { rows: ROWS, verdict, onPick: () => undefined }));
}

describe('ConvergeList', () => {
  it('draws no mark for a note or for a row the verdict has not reached, and no rules heading without rules', () => {
    const html = markup({
      slug: 'gate',
      worktree: '/tmp/wt',
      pidAlive: true,
      header: '0 of 0 edits done · 0 of 0 rules hold',
      edits: [{ index: 1, status: 'note', sentence: 'Note on src/domain: "look here"' }],
      rules: [],
    });
    expect(html).toContain('<p class="converge-header">0 of 0 edits done · 0 of 0 rules hold</p>');
    expect(html).not.toContain('converge-mark');
    expect(html).not.toContain('Rules');
  });

  it('shows no header while the verdict is loading or failed', () => {
    for (const verdict of [undefined, { error: 'no such run' }]) {
      const html = markup(verdict);
      expect(html).not.toContain('converge-header');
      expect(html.match(/class="change"/g)).toHaveLength(2);
    }
  });
});
