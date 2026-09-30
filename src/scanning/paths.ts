import { extname, relative, sep } from 'node:path';
import { isTestPath, type ScannedFile } from '../domain/scan.ts';

const CODE_EXTENSIONS = new Set(['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs']);
const SKIPPED_SEGMENT = /(^|\/)(node_modules|dist|build|out|coverage|\.bindweed|\.marestail)(\/|$)/;

export function repoPath(root: string, absolute: string): string {
  return relative(root, absolute).split(sep).join('/');
}

export function isInternalTarget(path: string): boolean {
  return !path.startsWith('..') && !SKIPPED_SEGMENT.test(path);
}

function isCodePath(path: string): boolean {
  return !path.endsWith('.d.ts') && CODE_EXTENSIONS.has(extname(path)) && !SKIPPED_SEGMENT.test(path);
}

function scannedFile(path: string): ScannedFile {
  return { path, test: isTestPath(path) };
}

export function filesToScan(paths: string[]): ScannedFile[] {
  return paths.filter(isCodePath).map(scannedFile);
}
