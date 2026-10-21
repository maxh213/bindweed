import { describe, expect, it } from 'vitest';
import { launchBody, launchFocus, launchReason } from './domain/launch.ts';
import { planReport } from './domain/planned.ts';
import type { PlanDoc, PlanEdit } from './domain/plan.ts';

const files = ['src/app/a.ts', 'src/app/b.ts', 'src/domain/model.ts', 'src/infra/db.ts'];
const scan = { files: files.map(path => ({ path, test: false })), edges: [{ from: files[0], to: files[2], kind: 'runtime' as const }], workspaces: [], externals: [] };
const cut: PlanEdit = { kind: 'cut-edge', from: 'src/app', to: 'src/domain', files: [[files[0], files[2]]] };

function focus(edits: PlanEdit[]) {
  return launchFocus(files, edits, planReport(scan, edits, () => []).stale);
}

describe('launch fields', () => {
  it.each([
    { edits: [], result: '' },
    { edits: [cut], result: 'src/app/a.ts src/domain/model.ts' },
    { edits: [{ kind: 'move-file', file: files[1], to: 'src/infra' }], result: 'src/app/b.ts src/infra/b.ts' },
    { edits: [{ kind: 'rename-package', from: 'src/app', to: 'src/core' }], result: 'src/app/a.ts src/app/b.ts src/core/a.ts src/core/b.ts' },
    { edits: [{ kind: 'create-package', path: 'src/ports' }], result: 'src/ports' },
    { edits: [{ kind: 'fate', file: files[2], fate: 'delete' }], result: files[2] },
    { edits: [{ kind: 'fate', file: files[1], fate: 'fold', into: files[3] }], result: 'src/app/b.ts src/infra/db.ts' },
    { edits: [{ kind: 'add-edge', from: 'src/domain', to: 'src/app' }], result: 'src/app/a.ts src/app/b.ts src/domain/model.ts' },
    { edits: [{ kind: 'move-file', file: 'src/missing.ts', to: 'src/infra' }], result: '' },
    { edits: [{ kind: 'rename-file', from: files[0], to: 'z.ts' }], result: 'src/app/a.ts src/app/z.ts' },
    { edits: [{ kind: 'note', target: { node: 'src/app' }, text: 'hi' }], result: 'src/app/a.ts src/app/b.ts' },
    { edits: [{ kind: 'note', target: { edge: ['src/app', 'src/domain'] }, text: 'hi' }], result: 'src/app/a.ts src/app/b.ts src/domain/model.ts' },
    { edits: [{ kind: 'merge-packages', packages: ['src/app', 'src/domain'], into: 'src/core' }], result: 'src/app/a.ts src/app/b.ts src/core/a.ts src/core/b.ts src/core/model.ts src/domain/model.ts' },
    { edits: [{ kind: 'split-package', package: 'src/app', parts: [{ name: 'one', files: [files[0]] }, { name: 'two', files: [files[1]] }] }], result: 'src/app/a.ts src/app/b.ts src/app/one/a.ts src/app/two/b.ts' },
  ] as { edits: PlanEdit[]; result: string }[])('Focus joins the current files and the planned paths: $result', ({ edits, result }) => {
    expect(focus(edits)).toBe(result);
  });

  it('keeps current files after deletion, ignores stale moves and redo, and never revives a deleted path', () => {
    const edits: PlanEdit[] = [cut, { kind: 'fate', file: files[2], fate: 'delete' }, { kind: 'rename-package', from: 'src/app', to: 'src/core' }];
    expect(focus(edits)).toBe('src/app/a.ts src/app/b.ts src/core/a.ts src/core/b.ts src/domain/model.ts');
    expect(focus([{ kind: 'move-file', file: files[1], to: 'unknown' }])).toBe(files[1]);
    expect(focus([{ kind: 'create-package', path: 'src/app' }])).toBe('');
    expect(focus([{ kind: 'fate', file: files[1], fate: 'fold', into: files[3] }, { kind: 'note', target: { node: 'src/infra' }, text: 'hi' }])).toBe('src/app/b.ts src/infra/db.ts');
  });

  it('accepts only complete tool shapes and trims values', () => {
    const mare = { tool: 'marestail', model: ' a b ', scope: ' ', focus: ' x ', stopAt: ' qa ' };
    expect(launchBody(mare)).toEqual({ tool: 'marestail', model: 'a b', scope: '', focus: 'x', stopAt: 'qa' });
    expect(launchBody({ tool: 'slop-cannon', safety: 'off', ammo: ' 3 ', cartridge: ' wide ' })).toEqual({ tool: 'slop-cannon', safety: 'off', ammo: '3', cartridge: 'wide' });
    for (const bad of [null, [], 'marestail', { tool: 'toString' }, { tool: '__proto__' }, {}, { ...mare, tool: ['marestail'] }, { ...mare, tool: { toString: 'x' } }, { ...mare, tool: null }, { ...mare, extra: true }, { ...mare, scope: null }, { tool: 'marestail', scope: '' }, { tool: 'slop-cannon', safety: ' on ', ammo: '', cartridge: '' }]) expect(launchBody(bad)).toBeUndefined();
  });

  it('uses command, live pid and content reasons in that order', () => {
    const doc: PlanDoc = { version: 1, name: 'Gate', slug: 'gate', createdAt: '', baseCommit: '', edits: [], redo: [] };
    const info = { marestail: true, sc: true, alive: false, focus: '' };
    expect(launchReason(info, doc, 'marestail')).toBe('this plan has no tasks');
    expect(launchReason(info, doc, 'slop-cannon')).toBe('this plan has no brief');
    expect(launchReason({ ...info, alive: true }, doc, 'marestail')).toBe('a run for this plan is still alive');
    expect(launchReason({ ...info, marestail: false, alive: true }, doc, 'marestail')).toBe('marestail is not on PATH');
    expect(launchReason({ ...info, sc: false }, doc, 'slop-cannon')).toBe('sc is not on PATH');
    expect(launchReason(info, { ...doc, brief: 'Hi' }, 'slop-cannon')).toBeNull();
  });
});
