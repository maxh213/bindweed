import { describe, expect, it } from 'vitest';
import { installDirFrom, uiDistDir, uiIndexPath } from './install-dir.ts';
import { pathToFileURL } from 'node:url';

describe('installDirFrom', () => {
  it('resolves the install directory from the real entry module url', () => {
    const meta = pathToFileURL('/tmp/qa/unbuilt/src/cli.ts').href;
    expect(installDirFrom(meta)).toBe('/tmp/qa/unbuilt');
    expect(uiDistDir('/tmp/qa/unbuilt')).toBe('/tmp/qa/unbuilt/dist/ui');
    expect(uiIndexPath('/tmp/qa/unbuilt')).toBe('/tmp/qa/unbuilt/dist/ui/index.html');
  });
});
