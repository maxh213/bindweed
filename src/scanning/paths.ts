import { extname, relative, sep } from 'node:path';
import { isTestPath, type ScannedFile } from '../domain/scan.ts';

const CODE_EXTENSIONS = new Set(['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs']);
const SKIPPED_SEGMENTS = new Set(['node_modules', 'dist', 'build', 'out', 'coverage', '.bindweed', '.marestail']);

function hasSkippedSegment(path: string): boolean {
  for (const segment of path.split('/')) {
    if (SKIPPED_SEGMENTS.has(segment)) return true;
  }
  return false;
}

export function repoPath(root: string, absolute: string): string {
  return relative(root, absolute).split(sep).join('/');
}

export function isInternalTarget(path: string): boolean {
  return !path.startsWith('..') && !hasSkippedSegment(path);
}

function isCodePath(path: string): boolean {
  return !path.endsWith('.d.ts') && CODE_EXTENSIONS.has(extname(path)) && !hasSkippedSegment(path);
}

function scannedFile(path: string): ScannedFile {
  return { path, test: isTestPath(path) };
}

export function filesToScan(paths: string[]): ScannedFile[] {
  return paths.filter(isCodePath).map(scannedFile);
}
