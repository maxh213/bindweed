import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export function installDirFrom(metaUrl: string): string {
  return dirname(dirname(fileURLToPath(metaUrl)));
}

export function uiDistDir(installDir: string): string {
  return join(installDir, 'dist', 'ui');
}

export function uiIndexPath(installDir: string): string {
  return join(uiDistDir(installDir), 'index.html');
}
