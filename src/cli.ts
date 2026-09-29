#!/usr/bin/env node
import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

type Out = { write(text: string): unknown };

export function main(argv: string[], out: Out): number {
  out.write(`bindweed ${argv.slice(2).join(' ')}`.trimEnd() + '\n');
  return 0;
}

export function isEntry(metaUrl: string, argv1: string | undefined): boolean {
  return argv1 !== undefined && realpathSync(fileURLToPath(metaUrl)) === realpathSync(argv1);
}

export function runIfMain(metaUrl: string, argv: string[], out: Out): number | undefined {
  return isEntry(metaUrl, argv[1]) ? main(argv, out) : undefined;
}

process.exitCode = runIfMain(import.meta.url, process.argv, process.stdout);
