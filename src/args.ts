type PortChoice =
  | { mode: 'fixed'; port: number }
  | { mode: 'range'; port: number };

export type ParsedArgs =
  | { ok: true; pathArg: string | undefined; port: PortChoice }
  | { ok: false; message: string };

const USAGE = 'bindweed: usage: bindweed [path] [--port N]';

function portMessage(value: string): string {
  return `bindweed: port ${value} is not a number from 1 to 65535`;
}

function isPortDigits(value: string): boolean {
  return value === '0' || /^[1-9]\d*$/.test(value);
}

export function parsePortValue(value: string): number | undefined {
  if (!isPortDigits(value)) return undefined;
  const n = Number(value);
  if (n < 1) return undefined;
  if (n > 65535) return undefined;
  return n;
}

function takePortFlag(args: string[]): { rest: string[]; port?: string; error?: string } {
  const idx = args.indexOf('--port');
  if (idx < 0) return { rest: args };
  if (idx + 1 >= args.length) return { rest: args, error: USAGE };
  const port = args[idx + 1] as string;
  const rest = [...args.slice(0, idx), ...args.slice(idx + 2)];
  return { rest, port };
}

function onlyPaths(args: string[]): { paths: string[]; error?: string } {
  if (args.some(a => a.startsWith('-'))) return { paths: [], error: USAGE };
  if (args.length > 1) return { paths: [], error: USAGE };
  return { paths: args };
}

function portFromEnv(envPort: string | undefined): PortChoice | { error: string } {
  if (envPort === undefined) return { mode: 'range', port: 4477 };
  const n = parsePortValue(envPort);
  if (n === undefined) return { error: portMessage(envPort) };
  return { mode: 'range', port: n };
}

function fixedPortArgs(pathArg: string | undefined, portText: string): ParsedArgs {
  const n = parsePortValue(portText);
  if (n === undefined) return { ok: false, message: portMessage(portText) };
  return { ok: true, pathArg, port: { mode: 'fixed', port: n } };
}

function rangedPortArgs(pathArg: string | undefined, envPort: string | undefined): ParsedArgs {
  const fromEnv = portFromEnv(envPort);
  if ('error' in fromEnv) return { ok: false, message: fromEnv.error };
  return { ok: true, pathArg, port: fromEnv };
}

export function parseArgs(argv: string[], envPort: string | undefined): ParsedArgs {
  const taken = takePortFlag(argv.slice(2));
  if (taken.error) return { ok: false, message: taken.error };
  const paths = onlyPaths(taken.rest);
  if (paths.error) return { ok: false, message: paths.error };
  if (taken.port !== undefined) return fixedPortArgs(paths.paths[0], taken.port);
  return rangedPortArgs(paths.paths[0], envPort);
}

export function shownPath(pathArg: string | undefined, cwd: string): string {
  if (pathArg === undefined) return cwd;
  return pathArg;
}
