import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { RunStatus, type LlmRun } from './RunFeedback.tsx';

function shown(run: LlmRun): string {
  return renderToStaticMarkup(createElement(RunStatus, { run, seconds: 3, onCancel: () => undefined }));
}

describe('the run status', () => {
  it('shows each kind of run', () => {
    expect(shown({ kind: 'idle' })).toBe('');
    expect(shown({ kind: 'running' })).toBe('<p>running for 3 s <button type="button">Cancel</button></p>');
    expect(shown({ kind: 'failed', error: 'down', note: 'kept' })).toBe('<p class="plan-dialog-error">down</p><output aria-label="note">kept</output>');
    expect(shown({ kind: 'done', ran: 'fake' })).toBe('<output aria-label="ran">fake</output>');
  });

  it('refuses a run of a kind it does not know', () => {
    expect(() => shown(JSON.parse('{"kind":"lost"}'))).toThrow('unexpected run {"kind":"lost"}');
  });
});
