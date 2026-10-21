import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { backendFor, DEFAULT_LIMITS, parseConfig, readConfig, routePick, runProcess, writeConfig, type RunPlace } from './llm.ts';

const ENV = { PATH: '/usr/bin:/bin', HOME: '/home/someone', CLAUDECODE: '1', CLAUDE_CODE_ENTRYPOINT: 'cli', KEEP: 'yes' };
const CLAUDE_ARGS = ['-p', '--model', 'claude-opus-5-5', '--effort', 'high', '--output-format', 'text', '--allowedTools', 'Read,Grep,Glob'];
const CLEAN = { PATH: '/usr/bin:/bin', HOME: '/home/someone', KEEP: 'yes' };

describe('DEFAULT_LIMITS', () => {
  it('stops the LLM after 15 minutes and marestail route after 60 seconds', () => {
    expect(DEFAULT_LIMITS).toEqual({ llmMs: 900_000, routeMs: 60_000 });
  });
});

describe('routePick', () => {
  it('reads "<model> <effort> <provider>" for claude', () => {
    expect(routePick('claude-fable-5-1 max claude\n', ENV)).toEqual({
      spec: { bin: 'claude', args: ['-p', '--model', 'claude-fable-5-1', '--effort', 'max', '--output-format', 'text', '--allowedTools', 'Read,Grep,Glob'], env: CLEAN },
      ran: 'route: claude-fable-5-1, effort max, provider claude',
    });
  });

  it('points claude-work at $HOME/.claude-work', () => {
    const picked = routePick('claude-opus-5-5 max claude-work', ENV);
    expect(picked.spec.env).toEqual({ ...CLEAN, CLAUDE_CONFIG_DIR: '/home/someone/.claude-work' });
    expect(picked.ran).toBe('route: claude-opus-5-5, effort max, provider claude-work');
    expect(routePick('m e claude-work', {}).spec.env).toEqual({ CLAUDE_CONFIG_DIR: '/.claude-work' });
  });

  it('falls back to claude for provider grok and says why', () => {
    expect(routePick('grok-5 high grok\n', ENV)).toEqual({
      spec: { bin: 'claude', args: CLAUDE_ARGS, env: CLEAN },
      ran: 'claude: claude-opus-5-5, effort high',
      note: 'route picked grok; bindweed speaks to claude only, so it used claude-opus-5-5',
    });
  });

  it('falls back when the line does not have three words', () => {
    expect(routePick('just one\n', ENV).note).toBe('marestail route printed "just one", which bindweed can\'t read, so it used claude-opus-5-5');
    expect(routePick('', ENV).note).toBe('marestail route printed "", which bindweed can\'t read, so it used claude-opus-5-5');
  });
});

describe('the config file', () => {
  let root = '';

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'bw-config-'));
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('accepts the three backends and a command beside any', () => {
    expect(parseConfig({ llm: { backend: 'route' } })).toEqual({ llm: { backend: 'route' } });
    expect(parseConfig({ llm: { backend: 'claude', command: '' } })).toEqual({ llm: { backend: 'claude', command: '' } });
    expect(parseConfig({ llm: { backend: 'command', command: 'echo hi' } })).toEqual({ llm: { backend: 'command', command: 'echo hi' } });
  });

  it('refuses anything else', () => {
    for (const raw of [null, {}, { llm: null }, { llm: { backend: 'command' } }, { llm: { backend: 'command', command: ' ' } }, { llm: { backend: 'x' } }, { llm: { backend: 'route', command: 1 } }, { llm: { backend: 'route' }, x: 1 }, { llm: { backend: 'route', x: 1 } }]) {
      expect(parseConfig(raw)).toBeUndefined();
    }
  });

  it('writes the file and reads it back, defaulting to route', async () => {
    expect(await readConfig(root)).toEqual({ llm: { backend: 'route' } });
    await writeConfig(root, { llm: { backend: 'claude' } });
    expect(await readFile(join(root, '.bindweed', 'config.json'), 'utf8')).toBe('{"llm":{"backend":"claude"}}');
    expect(await readConfig(root)).toEqual({ llm: { backend: 'claude' } });
    await writeFile(join(root, '.bindweed', 'config.json'), '[]');
    expect(await readConfig(root)).toEqual({ llm: { backend: 'route' } });
  });
});

describe('backends and processes', () => {
  function placeOf(signal: AbortSignal): RunPlace {
    return { root: tmpdir(), env: ENV, limits: { llmMs: 5000, routeMs: 5000 }, signal };
  }

  it('builds the claude and command backends', async () => {
    const place = placeOf(new AbortController().signal);
    expect(await backendFor({ llm: { backend: 'claude' } }, place)).toEqual({ spec: { bin: 'claude', args: CLAUDE_ARGS, env: CLEAN }, ran: 'claude: claude-opus-5-5, effort high' });
    expect(await backendFor({ llm: { backend: 'command', command: 'cat' } }, place)).toEqual({
      spec: { bin: 'sh', args: ['-c', 'cat'], env: { ...CLEAN, BINDWEED_ROOT: tmpdir() } },
      ran: 'command: cat',
    });
  });

  it('feeds stdin and reads stdout', async () => {
    expect(await runProcess({ bin: 'sh', args: ['-c', 'cat; pwd'], env: CLEAN }, 'hello\n', placeOf(new AbortController().signal), 5000)).toEqual({ kind: 'done', stdout: `hello\n${tmpdir()}\n` });
  });

  it('still finishes when the command closes stdin before the prompt is written', async () => {
    expect(await runProcess({ bin: 'true', args: [], env: CLEAN }, 'x'.repeat(1024 * 1024), placeOf(new AbortController().signal), 5000)).toEqual({ kind: 'done', stdout: '' });
  });

  it('starts nothing once cancelled, and survives a cancel before a missing binary fails', async () => {
    const controller = new AbortController();
    controller.abort();
    expect(await runProcess({ bin: 'sh', args: [], env: CLEAN }, '', placeOf(controller.signal), 5000)).toEqual({ kind: 'cancelled' });
    const late = new AbortController();
    const running = runProcess({ bin: 'no-such-binary-bindweed', args: [], env: CLEAN }, '', placeOf(late.signal), 5000);
    late.abort();
    expect(await running).toEqual({ kind: 'missing', bin: 'no-such-binary-bindweed' });
  });
});
