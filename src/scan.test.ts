import { statSync, symlinkSync, utimesSync } from 'node:fs';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { scanRepo, } from './scan.ts';

const made: string[] = [];

async function makeRepo(files: Record<string, string>): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'bw-scan-'));
  made.push(root);
  for (const [path, text] of Object.entries(files)) {
    const full = join(root, path);
    await mkdir(join(full, '..'), { recursive: true });
    await writeFile(full, text);
  }
  return root;
}

afterAll(async () => {
  await Promise.all(made.map(dir => rm(dir, { recursive: true, force: true })));
});

function edgeList(root: string, scan: { edges: { from: string; to: string; kind: string }[] }): string[] {
  return scan.edges.map(edge => `${edge.from}>${edge.to}:${edge.kind}`).sort();
}

function externalList(scan: { externals: { from: string; name: string; kind: string }[] }): string[] {
  return scan.externals.map(ext => `${ext.from}>${ext.name}:${ext.kind}`).sort();
}

const LAYERED_FILES: Record<string, string> = {
  'tsconfig.json': '{"compilerOptions":{"baseUrl":".","paths":{"@domain/*":["src/domain/*"]}}}',
  'notes/readme.md': '# notes\n',
  'src/app/a.ts': "import { b } from './b';\nimport { query } from '../infra/db';\nimport type { Model } from '@domain/model';\nexport const a: Model = b;\n",
  'src/app/b.ts': "import { a } from './a';\nimport { query } from '../infra/db';\nexport const b = query;\nexport const fromA = a;\n",
  'src/domain/model.ts': 'export class Model { id = 0; }\n',
  'src/infra/db.ts': "import { Model } from '../domain/model';\nexport const query = new Model();\n",
};

describe('scanRepo over the layered fixture', () => {
  it('scans four files, resolves the alias as type-only, and skips non-code paths', async () => {
    const root = await makeRepo(LAYERED_FILES);
    const paths = [...Object.keys(LAYERED_FILES), 'gone.ts', 'src/a.d.ts', 'dist/x.ts', 'build/x.ts', 'out/x.ts', 'coverage/x.ts', 'node_modules/x.ts', '.bindweed/x.ts', '.marestail/x.ts'];
    const scan = scanRepo(root, paths);
    expect(scan.files).toEqual([
      { path: 'src/app/a.ts', test: false },
      { path: 'src/app/b.ts', test: false },
      { path: 'src/domain/model.ts', test: false },
      { path: 'src/infra/db.ts', test: false },
    ]);
    expect(edgeList(root, scan)).toEqual([
      'src/app/a.ts>src/app/b.ts:runtime',
      'src/app/a.ts>src/domain/model.ts:type',
      'src/app/a.ts>src/infra/db.ts:runtime',
      'src/app/b.ts>src/app/a.ts:runtime',
      'src/app/b.ts>src/infra/db.ts:runtime',
      'src/infra/db.ts>src/domain/model.ts:runtime',
    ]);
    expect(scan.externals).toEqual([]);
    expect(scan.workspaces).toEqual([]);
  });

  it('reuses the cache while stamps hold and re-parses after a change', async () => {
    const root = await makeRepo(LAYERED_FILES);
    const paths = Object.keys(LAYERED_FILES);
    const first = scanRepo(root, paths);
    const second = scanRepo(root, paths);
    expect(second).toEqual(first);
    const cacheText = await import('node:fs/promises').then(fs => fs.readFile(join(root, '.bindweed/cache/scan.json'), 'utf8'));
    expect(JSON.parse(cacheText).version).toBe(1);
    await writeFile(join(root, 'src/infra/db.ts'), "import { Model } from '../domain/model';\nimport { b } from '../app/b';\nexport const query = new Model();\n");
    const third = scanRepo(root, paths);
    expect(edgeList(root, third)).toContain('src/infra/db.ts>src/app/b.ts:runtime');
  });

  it('reuses cached imports while the stamp holds and stores fresh stamps', async () => {
    const root = await makeRepo(LAYERED_FILES);
    const paths = Object.keys(LAYERED_FILES);
    scanRepo(root, paths);
    const cacheFile = join(root, '.bindweed/cache/scan.json');
    const cache = JSON.parse(await readFile(cacheFile, 'utf8'));
    expect(cache.files['src/app/a.ts'].mtimeMs).toBeGreaterThan(0);
    expect(cache.files['src/app/a.ts'].imports).toHaveLength(3);
    cache.files['src/app/a.ts'].imports = [{ specifier: './b', typeOnly: false }];
    await writeFile(cacheFile, JSON.stringify(cache));
    expect(edgeList(root, scanRepo(root, paths))).toEqual([
      'src/app/a.ts>src/app/b.ts:runtime',
      'src/app/b.ts>src/app/a.ts:runtime',
      'src/app/b.ts>src/infra/db.ts:runtime',
      'src/infra/db.ts>src/domain/model.ts:runtime',
    ]);
  });

  it('re-parses when only the cached size differs', async () => {
    const root = await makeRepo({ 'src/a.ts': "import { b } from './b';\nexport const a = b;\n", 'src/b.ts': 'export const b = 1;\n' });
    utimesSync(join(root, 'src/a.ts'), new Date(1000), new Date(1000));
    const stamp = statSync(join(root, 'src/a.ts'));
    await mkdir(join(root, '.bindweed/cache'), { recursive: true });
    await writeFile(
      join(root, '.bindweed/cache/scan.json'),
      JSON.stringify({
        version: 1,
        files: {
          'src/a.ts': { mtimeMs: stamp.mtimeMs, size: stamp.size + 1, imports: [{ specifier: './gone', typeOnly: false }], abstract: false },
        },
      }),
    );
    expect(edgeList(root, scanRepo(root, ['src/a.ts', 'src/b.ts']))).toEqual(['src/a.ts>src/b.ts:runtime']);
  });

  it('re-parses when only the cached mtime differs', async () => {
    const root = await makeRepo({ 'src/a.ts': "import { b } from './b';\nexport const a = b;\n", 'src/b.ts': 'export const b = 1;\n' });
    utimesSync(join(root, 'src/a.ts'), new Date(1000), new Date(1000));
    const stamp = statSync(join(root, 'src/a.ts'));
    await mkdir(join(root, '.bindweed/cache'), { recursive: true });
    await writeFile(
      join(root, '.bindweed/cache/scan.json'),
      JSON.stringify({
        version: 1,
        files: {
          'src/a.ts': {
            mtimeMs: stamp.mtimeMs + 5,
            size: stamp.size,
            imports: [{ specifier: './gone', typeOnly: false, heritage: 2 }],
            abstract: false,
          },
        },
      }),
    );
    expect(edgeList(root, scanRepo(root, ['src/a.ts', 'src/b.ts']))).toEqual(['src/a.ts>src/b.ts:runtime']);
  });

  it('starts over when the cache is corrupt or oddly shaped', async () => {
    const root = await makeRepo(LAYERED_FILES);
    const paths = Object.keys(LAYERED_FILES);
    await mkdir(join(root, '.bindweed/cache'), { recursive: true });
    await writeFile(join(root, '.bindweed/cache/scan.json'), 'not json');
    expect(scanRepo(root, paths).files).toHaveLength(4);
    await writeFile(join(root, '.bindweed/cache/scan.json'), '{"version":2,"files":{}}');
    expect(scanRepo(root, paths).files).toHaveLength(4);
  });
});

describe('scanRepo path filtering', () => {
  it('skips declaration files and paths under tool directories', async () => {
    const files = {
      'src/a.ts': 'export const a = 1;\n',
      'src/a.d.ts': 'export const d: number;\n',
      'dist/x.ts': 'export const dx = 1;\n',
      'build/x.ts': 'export const bx = 1;\n',
      'out/x.ts': 'export const ox = 1;\n',
      'coverage/x.ts': 'export const cx = 1;\n',
      'node_modules/x.ts': 'export const nx = 1;\n',
      '.bindweed/x.ts': 'export const wx = 1;\n',
      '.marestail/x.ts': 'export const mx = 1;\n',
    };
    const root = await makeRepo(files);
    expect(scanRepo(root, Object.keys(files)).files).toEqual([{ path: 'src/a.ts', test: false }]);
  });

  it('treats a resolved sibling directory as external', async () => {
    const outside = await makeRepo({ 'x.ts': 'export const x = 1;\n' });
    const root = await makeRepo({ 'src/a.ts': `import { x } from '../../${basename(outside)}/x';\nexport const a = x;\n` });
    const scan = scanRepo(root, ['src/a.ts']);
    expect(scan.edges).toEqual([]);
    expect(externalList(scan)).toEqual([`src/a.ts>../../${basename(outside)}/x:runtime`]);
    await rm(outside, { recursive: true, force: true });
  });
});

const FORMS = [
  "import def from 'def-pkg';",
  "import sub from 'def-pkg/sub';",
  "import scoped from '@scope/pkg/sub';",
  "import { type A, b } from './mix';",
  "import * as ns from './ns';",
  "import {} from './empty';",
  "import './side';",
  "import type { T } from './ty';",
  "import { type A } from './ty2';",
  "import Def, { type A } from './mix3';",
  "import type Def from './ty3';",
  "import eq = require('./eq');",
  "const r = require('./req');",
  "const d = import('./dyn');",
  "const skip1 = require(name);",
  "const skip2 = import('./dyn', {});",
  "const skip3 = obj.require('./req');",
  "const skip4 = import('./two', {});",
  "const skip5 = import(`./tpl`);",
  "const skip6 = require();",
  "helper('./req2');",
  "export { x } from './re';",
  "export type { U } from './rety';",
  "export { type V, w } from './remix';",
  "export { type W } from './rety2';",
  "export * from './star';",
  "export * as starNs from './starns';",
  "export {} from './none';",
  "import local = Global.thing;",
  "import abs from '/abs/nope';",
  "import gone from '../gone';",
  "import bad from 5;",
  "export { b };",
].join('\n');

const FORMS_FILES: Record<string, string> = {
  'forms.ts': `${FORMS}\nexport const ok = 1;\n`,
  'mix.ts': 'export const b = 1;\n',
  'ns.ts': 'export const n = 1;\n',
  'empty.ts': 'export const e = 1;\n',
  'side.ts': 'export const s = 1;\n',
  'ty.ts': 'export type T = number;\n',
  'ty2.ts': 'export type A = number;\n',
  'ty3.ts': 'export default 1;\n',
  'mix3.ts': 'export type A = number;\nexport const b = 1;\n',
  'two.ts': 'export const two = 1;\n',
  'tpl.ts': 'export const tpl = 1;\n',
  'req2.ts': 'export const req2 = 1;\n',
  'rety2.ts': 'export type W = string;\n',
  'eq.ts': 'export = 1;\n',
  'req.ts': 'export const r = 1;\n',
  'dyn.ts': 'export const d = 1;\n',
  're.ts': 'export const x = 1;\n',
  'rety.ts': 'export type U = string;\n',
  'remix.ts': 'export const w = 1;\n',
  'star.ts': 'export const st = 1;\n',
  'starns.ts': 'export const sn = 1;\n',
  'none.ts': 'export const no = 1;\n',
  'comp.tsx': "import { useState } from 'react';\nexport const C = () => <div>{useState(0)}</div>;\n",
  'piece.jsx': "import j from 'jsx-dep';\nexport const P = () => <span>{j}</span>;\n",
  'mod.mjs': "import { readFileSync } from 'node:fs';\nexport const rf = readFileSync;\n",
  'cjs.cjs': "const path = require('path');\nmodule.exports = path;\n",
  'mts.mts': "export type { T } from './ty';\n",
  'cts.cts': "const fs = require('fs');\nmodule.exports = fs;\n",
  'f.js': "import { g } from './g.js';\nexport const h = g;\n",
  'g.js': 'export const g = 1;\n',
};

describe('scanRepo import forms', () => {
  it('reads every import form with the right type-only flag', async () => {
    const root = await makeRepo(FORMS_FILES);
    const scan = scanRepo(root, Object.keys(FORMS_FILES));
    const fromForms = scan.edges.filter(edge => edge.from === 'forms.ts');
    expect(fromForms.map(edge => `${edge.to}:${edge.kind}`).sort()).toEqual([
      'dyn.ts:runtime',
      'empty.ts:runtime',
      'eq.ts:runtime',
      'mix.ts:runtime',
      'mix3.ts:runtime',
      'none.ts:runtime',
      'ns.ts:runtime',
      're.ts:runtime',
      'remix.ts:runtime',
      'req.ts:runtime',
      'rety.ts:type',
      'rety2.ts:type',
      'side.ts:runtime',
      'star.ts:runtime',
      'starns.ts:runtime',
      'ty.ts:type',
      'ty2.ts:type',
      'ty3.ts:type',
    ]);
    expect(edgeList(root, scan)).toContain('f.js>g.js:runtime');
    expect(edgeList(root, scan)).toContain('mts.mts>ty.ts:type');
  });

  it('names external packages by their root and builtins with the node prefix', async () => {
    const root = await makeRepo(FORMS_FILES);
    const scan = scanRepo(root, Object.keys(FORMS_FILES));
    const externals = externalList(scan);
    expect(externals).toContain('forms.ts>/abs/nope:runtime');
    expect(externals).toContain('forms.ts>../gone:runtime');
    expect(externals.filter(name => name === 'forms.ts>def-pkg:runtime')).toHaveLength(2);
    expect(externals).toContain('forms.ts>@scope/pkg:runtime');
    expect(externals).toContain('comp.tsx>react:runtime');
    expect(externals).toContain('piece.jsx>jsx-dep:runtime');
    expect(externals).toContain('mod.mjs>node:fs:runtime');
    expect(externals).toContain('cjs.cjs>node:path:runtime');
    expect(externals).toContain('cts.cts>node:fs:runtime');
    expect(externals).toHaveLength(10);
  });
});

describe('scanRepo script kinds', () => {
  it('parses jsx and tsx files with their own script kind', async () => {
    const root = await makeRepo({
      'jshold.js': "const el = <Foo>require('./hold');\nexport const e = el;\n",
      'tsxhold.tsx': "const el = <Foo>{require('./hold')}</Foo>;\nexport const e = el;\n",
      'hold.ts': 'export const hold = 1;\n',
    });
    const scan = scanRepo(root, ['jshold.js', 'tsxhold.tsx', 'hold.ts']);
    expect(edgeList(root, scan)).toEqual(['tsxhold.tsx>hold.ts:runtime']);
  });
});

describe('scanRepo tsconfig handling', () => {
  it('honours extends chains and default options without any tsconfig', async () => {
    const root = await makeRepo({
      'tsconfig.base.json': '{"compilerOptions":{"baseUrl":".","paths":{"@lib/*":["lib/*"]}}}',
      'tsconfig.json': '{"extends":"./tsconfig.base.json"}',
      'src/x.ts': "import { y } from '@lib/y';\nexport const x = y;\n",
      'lib/y.ts': 'export const y = 1;\n',
    });
    const scan = scanRepo(root, ['src/x.ts', 'lib/y.ts']);
    expect(edgeList(root, scan)).toEqual(['src/x.ts>lib/y.ts:runtime']);
  });

  it('gives each referenced project its own config', async () => {
    const root = await makeRepo({
      'tsconfig.json': '{"references":[{"path":"packages/a"},{"path":"packages/a"},{"path":"shared/tsconfig.shared.json"}]}',
      'packages/a/tsconfig.json': '{"compilerOptions":{"baseUrl":".","paths":{"@a/*":["src/*"]}}}',
      'packages/a/index.ts': "import { z } from '@a/z';\nexport const a = z;\n",
      'packages/a/src/z.ts': 'export const z = 1;\n',
      'shared/tsconfig.shared.json': '{"compilerOptions":{"baseUrl":".","paths":{"@s/*":["./*"]}}}',
      'shared/s.ts': "import { t } from '@s/t';\nexport const s = t;\n",
      'shared/t.ts': 'export const t = 1;\n',
      'src/x.ts': "import { q } from './q';\nexport const x = q;\n",
      'src/q.ts': 'export const q = 1;\n',
    });
    const scan = scanRepo(root, ['packages/a/index.ts', 'packages/a/src/z.ts', 'shared/s.ts', 'shared/t.ts', 'src/q.ts', 'src/x.ts']);
    expect(edgeList(root, scan)).toEqual(['packages/a/index.ts>packages/a/src/z.ts:runtime', 'shared/s.ts>shared/t.ts:runtime', 'src/x.ts>src/q.ts:runtime']);
  });

  it('follows references on to a shared config and back around a cycle', async () => {
    const root = await makeRepo({
      'tsconfig.json': '{"references":[{"path":"packages/a"}]}',
      'packages/a/tsconfig.json': '{"references":[{"path":"../../shared/tsconfig.shared.json"}]}',
      'shared/tsconfig.shared.json':
        '{"references":[{"path":"../packages/a/tsconfig.json"}],"compilerOptions":{"baseUrl":".","paths":{"@s/*":["./*"]}}}',
      'shared/s.ts': "import { t } from '@s/t';\nexport const s = t;\n",
      'shared/t.ts': 'export const t = 1;\n',
    });
    const scan = scanRepo(root, ['shared/s.ts', 'shared/t.ts']);
    expect(edgeList(root, scan)).toEqual(['shared/s.ts>shared/t.ts:runtime']);
  });

  it('treats a broken tsconfig as empty and an outside alias as external', async () => {
    const outside = await makeRepo({ 'x.ts': 'export const out = 1;\n' });
    const root = await makeRepo({
      'tsconfig.json': '{broken json',
      'src/x.ts': "import { y } from '@out/x';\nexport const xx = y;\n",
    });
    const scanA = scanRepo(root, ['src/x.ts']);
    expect(externalList(scanA)).toEqual(['src/x.ts>@out/x:runtime']);
    await writeFile(join(root, 'tsconfig.json'), JSON.stringify({ compilerOptions: { baseUrl: '.', paths: { '@out/*': ['../outside*'] } } }));
    const scanB = scanRepo(root, ['src/x.ts']);
    expect(edgeList(root, scanB)).toEqual([]);
    expect(externalList(scanB)).toEqual(['src/x.ts>@out/x:runtime']);
    await rm(outside, { recursive: true, force: true });
  });

  it('keeps a node_modules resolution external', async () => {
    const root = await makeRepo({
      'node_modules/dep/package.json': '{"name":"dep","main":"index.ts"}',
      'node_modules/dep/index.ts': 'export const dep = 1;\n',
      'src/x.ts': "import { dep } from 'dep';\nexport const x = dep;\n",
    });
    const scan = scanRepo(root, ['src/x.ts']);
    expect(scan.edges).toEqual([]);
    expect(externalList(scan)).toEqual(['src/x.ts>dep:runtime']);
  });
});

describe('scanRepo workspaces', () => {
  it('discovers npm workspaces in array form and resolves through main', async () => {
    const root = await makeRepo({
      'package.json': '{"name":"acme","private":true,"workspaces":["packages/*"]}',
      'packages/core/package.json': '{"name":"@acme/core","version":"1.0.0","main":"src/index.ts"}',
      'packages/core/src/index.ts': "export const greet = 'hi';\n",
      'packages/web/package.json': '{"name":"@acme/web","version":"1.0.0","main":"src/index.ts"}',
      'packages/web/src/index.ts': "import { greet } from '@acme/core';\nexport const msg = greet;\n",
    });
    const scan = scanRepo(root, ['packages/core/src/index.ts', 'packages/web/src/index.ts']);
    expect(scan.workspaces).toEqual([
      { dir: 'packages/core', name: '@acme/core' },
      { dir: 'packages/web', name: '@acme/web' },
    ]);
    expect(edgeList(root, scan)).toEqual(['packages/web/src/index.ts>packages/core/src/index.ts:runtime']);
  });

  it('skips symlinked directories when expanding glob patterns', async () => {
    const root = await makeRepo({
      'package.json': '{"workspaces":["packages/*"]}',
      'packages/real/package.json': '{"name":"real","main":"index.ts"}',
      'packages/real/index.ts': 'export const r = 1;\n',
    });
    symlinkSync(join(root, 'packages/real'), join(root, 'packages/shadow'));
    expect(scanRepo(root, ['packages/real/index.ts']).workspaces).toEqual([{ dir: 'packages/real', name: 'real' }]);
  });

  it('reads the packages-object form, pnpm yaml, exclusions and exact dirs', async () => {
    const objectForm = await makeRepo({
      'package.json': '{"workspaces":{"packages":["pkg/*"]}}',
      'pkg/a/package.json': '{"name":"a","main":"index.ts"}',
      'pkg/a/index.ts': 'export const a = 1;\n',
    });
    expect(scanRepo(objectForm, ['pkg/a/index.ts']).workspaces).toEqual([{ dir: 'pkg/a', name: 'a' }]);
    const pnpm = await makeRepo({
      'package.json': '{"name":"root"}',
      'pnpm-workspace.yaml': "notpackages:\npackages:\n  - solo\n  - 'libs/*'\n  - \"quoted\"\n",
      'libs/a/package.json': '{"name":"lib-a","main":"index.ts"}',
      'libs/a/index.ts': 'export const la = 1;\n',
      'solo/package.json': '{"name":"solo","main":"index.ts"}',
      'solo/index.ts': 'export const so = 1;\n',
      'quoted/package.json': '{"name":"quoted-pkg","main":"index.ts"}',
      'quoted/index.ts': 'export const q = 1;\n',
    });
    expect(scanRepo(pnpm, ['libs/a/index.ts', 'solo/index.ts', 'quoted/index.ts']).workspaces).toEqual([
      { dir: 'libs/a', name: 'lib-a' },
      { dir: 'quoted', name: 'quoted-pkg' },
      { dir: 'solo', name: 'solo' },
    ]);
    const excluding = await makeRepo({
      'package.json': '{"workspaces":["packages/*","!packages/secret"]}',
      'packages/keep/package.json': '{"name":"keep","main":"index.ts"}',
      'packages/keep/index.ts': 'export const k = 1;\n',
      'packages/secret/package.json': '{"name":"secret","main":"index.ts"}',
      'packages/secret/index.ts': 'export const s = 1;\n',
    });
    expect(scanRepo(excluding, ['packages/keep/index.ts', 'packages/secret/index.ts']).workspaces).toEqual([{ dir: 'packages/keep', name: 'keep' }]);
  });

  it('skips workspace dirs without a usable package.json name', async () => {
    const root = await makeRepo({
      'package.json': '{"workspaces":["packages/*"]}',
      'packages/nonrecord/package.json': '[1,2]',
      'packages/noname/package.json': '{"version":"1.0.0"}',
      'packages/badname/package.json': '{"name":5}',
      'packages/badjson/package.json': '{nope',
      'packages/emptyname/package.json': '{"name":""}',
      'packages/nullpkg/package.json': 'null',
      'packages/good/package.json': '{"name":"good","main":"index.ts"}',
      'packages/good/index.ts': 'export const g = 1;\n',
      'packages/nopkg/index.ts': 'export const n = 1;\n',
    });
    expect(scanRepo(root, ['packages/good/index.ts', 'packages/nopkg/index.ts']).workspaces).toEqual([{ dir: 'packages/good', name: 'good' }]);
  });

  it('ignores malformed workspace fields', async () => {
    const mixedArray = await makeRepo({ 'package.json': '{"workspaces":[5,"packages/*"]}' });
    expect(scanRepo(mixedArray, []).workspaces).toEqual([]);
    const numberForm = await makeRepo({ 'package.json': '{"workspaces":5}' });
    expect(scanRepo(numberForm, []).workspaces).toEqual([]);
    const packagesNotArray = await makeRepo({ 'package.json': '{"workspaces":{"packages":"x/*"}}' });
    expect(scanRepo(packagesNotArray, []).workspaces).toEqual([]);
    const pnpmNoPackages = await makeRepo({
      'package.json': '{"name":"r"}',
      'pnpm-workspace.yaml': '- solo\nother:\n  - solo\n',
      'solo/package.json': '{"name":"solo","main":"index.ts"}',
    });
    expect(scanRepo(pnpmNoPackages, []).workspaces).toEqual([]);
    const noManifest = await makeRepo({ 'src/x.ts': 'export const x = 1;\n' });
    expect(scanRepo(noManifest, ['src/x.ts']).workspaces).toEqual([]);
    const fileAsParent = await makeRepo({ 'package.json': '{"workspaces":["weird/*","gone/*","ghost"]}', 'weird': 'not a dir\n' });
    expect(scanRepo(fileAsParent, []).workspaces).toEqual([]);
  });

  it('resolves entries through exports, module, main and types with dir fallback', async () => {
    const root = await makeRepo({
      'package.json': '{"workspaces":["pkgs/*"]}',
      'pkgs/expstr/package.json': '{"name":"expstr","exports":"./entry.ts"}',
      'pkgs/expstr/entry.ts': 'export const e1 = 1;\n',
      'pkgs/expobj/package.json': '{"name":"expobj","exports":{".":{"import":"./imp.ts","default":"./def.ts"}}}',
      'pkgs/expobj/imp.ts': 'export const e2 = 1;\n',
      'pkgs/expnonstr/package.json': '{"name":"expnonstr","exports":{".":{"import":5,"default":"./d.ts-entry"}}}',
      'pkgs/expnonstr/d.ts-entry.ts': 'export const e3 = 1;\n',
      'pkgs/expdot/package.json': '{"name":"expdot","exports":{".":"./dot.ts"}}',
      'pkgs/expdot/dot.ts': 'export const e4 = 1;\n',
      'pkgs/mod/package.json': '{"name":"mod","module":"esm/main"}',
      'pkgs/mod/esm/main.ts': 'export const e5 = 1;\n',
      'pkgs/mainidx/package.json': '{"name":"mainidx","main":"lib"}',
      'pkgs/mainidx/lib/index.ts': 'export const e6 = 1;\n',
      'pkgs/typesonly/package.json': '{"name":"typesonly","types":"types.d.ts"}',
      'pkgs/typesonly/types.d.ts': 'export type T7 = number;\n',
      'pkgs/noentry/package.json': '{"name":"noentry"}',
      'pkgs/noentry/src/x.ts': 'export const e8 = 1;\n',
      'pkgs/allexp/package.json': '{"name":"allexp","exports":{".":{"import":5}}}',
      'pkgs/allexp/src/w.ts': 'export const e10 = 1;\n',
      'pkgs/expnum/package.json': '{"name":"expnum","exports":{".":5}}',
      'pkgs/expnum/src/v.ts': 'export const e11 = 1;\n',
      'pkgs/goneentry/package.json': '{"name":"goneentry","main":"gone.js"}',
      'pkgs/goneentry/src/y.ts': 'export const e9 = 1;\n',
      'pkgs/emptyentry/package.json': '{"name":"emptyentry","main":""}',
      'pkgs/emptyentry/index.ts': 'export const e12 = 1;\n',
      'pkgs/emptyexports/package.json': '{"name":"emptyexports","exports":{}}',
      'pkgs/emptyexports/src/z.ts': 'export const e13 = 1;\n',
      'pkgs/reqcond/package.json': '{"name":"reqcond","exports":{".":{"require":"./req.ts"}}}',
      'pkgs/reqcond/req.ts': 'export const e14 = 1;\n',
      'pkgs/typescond/package.json': '{"name":"typescond","exports":{".":{"types":"./typed.d.ts"}}}',
      'pkgs/typescond/typed.d.ts': 'export type T15 = number;\n',
      'app.ts': [
        "import { e1 } from 'expstr';",
        "import { e2 } from 'expobj';",
        "import { e3 } from 'expnonstr';",
        "import { e4 } from 'expdot';",
        "import { e5 } from 'mod';",
        "import { e6 } from 'mainidx';",
        "import { T7 } from 'typesonly';",
        "import { e8 } from 'noentry';",
        "import { e9 } from 'goneentry';",
        "import { e10 } from 'allexp';",
        "import { e11 } from 'expnum';",
        "import { e12 } from 'emptyentry';",
        "import { e13 } from 'emptyexports';",
        "import { e14 } from 'reqcond';",
        "import { T15 } from 'typescond';",
        'export const all = [e1, e2, e3, e4, e5, e6, e8, e9, e10, e11, e12, e13, e14];',
      ].join('\n'),
    });
    const scan = scanRepo(root, [
      'app.ts',
      'pkgs/expstr/entry.ts',
      'pkgs/expobj/imp.ts',
      'pkgs/expnonstr/d.ts-entry.ts',
      'pkgs/expdot/dot.ts',
      'pkgs/mod/esm/main.ts',
      'pkgs/mainidx/lib/index.ts',
      'pkgs/noentry/src/x.ts',
      'pkgs/allexp/src/w.ts',
      'pkgs/expnum/src/v.ts',
      'pkgs/goneentry/src/y.ts',
    ]);
    expect(edgeList(root, scan)).toEqual([
      'app.ts>pkgs/allexp:runtime',
      'app.ts>pkgs/emptyentry:runtime',
      'app.ts>pkgs/emptyexports:runtime',
      'app.ts>pkgs/expdot/dot.ts:runtime',
      'app.ts>pkgs/expnonstr/d.ts-entry.ts:runtime',
      'app.ts>pkgs/expnum:runtime',
      'app.ts>pkgs/expobj/imp.ts:runtime',
      'app.ts>pkgs/expstr/entry.ts:runtime',
      'app.ts>pkgs/goneentry:runtime',
      'app.ts>pkgs/mainidx/lib/index.ts:runtime',
      'app.ts>pkgs/mod/esm/main.ts:runtime',
      'app.ts>pkgs/noentry:runtime',
      'app.ts>pkgs/reqcond/req.ts:runtime',
      'app.ts>pkgs/typescond/typed.d.ts:runtime',
      'app.ts>pkgs/typesonly/types.d.ts:runtime',
    ]);
  });

  it('resolves extensionless entries through every supported extension', async () => {
    const cases = [
      ['xtsx', '.tsx'],
      ['xjs', '.js'],
      ['xjsx', '.jsx'],
      ['xmts', '.mts'],
      ['xcts', '.cts'],
      ['xmjs', '.mjs'],
      ['xcjs', '.cjs'],
    ] as const;
    const files: Record<string, string> = {
      'package.json': '{"workspaces":["pkgs/*"]}',
      'app.ts': [...cases.map(([name], i) => `import { v${i} } from '${name}';`), 'export const all = 1;'].join('\n'),
    };
    for (const [name, ext] of cases) {
      files[`pkgs/${name}/package.json`] = JSON.stringify({ name, main: 'entry' });
      files[`pkgs/${name}/entry${ext}`] = 'export const v = 1;\n';
    }
    const root = await makeRepo(files);
    expect(edgeList(root, scanRepo(root, ['app.ts']))).toEqual([
      'app.ts>pkgs/xcjs/entry.cjs:runtime',
      'app.ts>pkgs/xcts/entry.cts:runtime',
      'app.ts>pkgs/xjs/entry.js:runtime',
      'app.ts>pkgs/xjsx/entry.jsx:runtime',
      'app.ts>pkgs/xmjs/entry.mjs:runtime',
      'app.ts>pkgs/xmts/entry.mts:runtime',
      'app.ts>pkgs/xtsx/entry.tsx:runtime',
    ]);
  });
});
