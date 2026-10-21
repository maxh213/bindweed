import { describe, expect, it } from 'vitest';
import type { GraphNode, GraphView } from '../domain/graph.ts';
import type { PlanEdit } from '../domain/plan.ts';
import { proposalInk, type ProposalInput } from './proposalpicture.ts';

describe('proposalInk', () => {
  function placed(id: string, kind: 'file' | 'package', row: number, order: number): GraphNode {
    const name = id.slice(id.lastIndexOf('/') + 1);
    if (kind === 'package') return { id, kind, name, path: id, row, order, cycle: false, files: 1 };
    return { id, kind, name, path: id, row, order, cycle: false };
  }

  function view(nodes: GraphNode[]): GraphView {
    return { at: '', crumbs: [], nodes, edges: [], crapMax: 4, coverage: 'off', mutation: 'off' };
  }

  function ink(over: Partial<ProposalInput> = {}) {
    return proposalInk({ shown: 'planned', planned: [], pins: {}, proposal: view([]), children: [], edits: [], hover: null, ...over });
  }

  const empty = { boxes: [], rows: [], strikes: [], cuts: [], arrows: [] };
  const app = placed('src/app', 'package', 0, 0);
  const infra = placed('src/infra', 'package', 1, 0);
  const domain = placed('src/domain', 'package', 2, 0);

  it('draws nothing for the current graph, a missing proposal, a note, or an edit that owns no box', () => {
    const note: PlanEdit = { kind: 'note', target: { node: 'src/app' }, text: 'three jobs' };
    expect(ink({ shown: 'now', edits: [{ index: 0, edit: note }] })).toEqual(empty);
    expect(ink({ proposal: null, edits: [{ index: 0, edit: note }] })).toEqual(empty);
    expect(ink({ proposal: view([placed('src/ports', 'package', 0, 1)]), edits: [] })).toEqual(empty);
    expect(ink({ planned: [app], proposal: view([app, placed('src/extra', 'package', 0, 1)]), edits: [{ index: 0, edit: note }] })).toEqual(empty);
  });

  it('places a new box at its cell, then steps right off a taken cell and off an earlier new box', () => {
    const ports = placed('src/ports', 'package', 0, 1);
    const extra = placed('src/extra', 'package', 0, 1);
    const create: PlanEdit = { kind: 'create-package', path: 'src/ports' };
    const move: PlanEdit = { kind: 'move-file', file: 'src/app/b.ts', to: 'src/ports' };
    const other: PlanEdit = { kind: 'create-package', path: 'src/extra' };
    const planned = [app, infra, domain];
    const open = ink({
      planned,
      proposal: view([...planned, ports]),
      edits: [{ index: 1, edit: create }, { index: 2, edit: move }],
      hover: 1,
      children: [{ id: 'src/ports', planned: null, proposed: view([placed('src/ports/b.ts', 'file', 0, 0)]) }],
    });
    expect(open.boxes).toEqual([{ id: 'src/ports', name: 'ports', x: 260, y: 0, highlight: true, rows: [{ path: 'src/ports/b.ts', name: 'b.ts', highlight: false }] }]);
    const pinned = ink({
      planned,
      pins: { 'src/ports': { x: 10, y: 20 } },
      proposal: view([...planned, ports]),
      edits: [{ index: 0, edit: create }],
    });
    expect(pinned.boxes.map(box => [box.x, box.y])).toEqual([[270, 20]]);
    const both = ink({
      planned,
      proposal: view([...planned, ports, extra]),
      edits: [{ index: 0, edit: create }, { index: 1, edit: other }],
      hover: 0,
    });
    expect(both.boxes.map(box => [box.id, box.x, box.y, box.highlight])).toEqual([
      ['src/ports', 260, 0, true],
      ['src/extra', 520, 0, false],
    ]);
  });

  it('draws a cut and an added arrow only when both ends are in view, and a strike once', () => {
    const cut: PlanEdit = { kind: 'cut-edge', from: 'src/app', to: 'src/domain', files: [['src/app/a.ts', 'src/domain/model.ts']] };
    const add: PlanEdit = { kind: 'add-edge', from: 'src/domain', to: 'src/app' };
    const away: PlanEdit = { kind: 'cut-edge', from: 'src/missing', to: 'src/app', files: [] };
    const planned = [app, infra, domain];
    const marks = ink({
      planned,
      proposal: view(planned),
      edits: [{ index: 0, edit: cut }, { index: 2, edit: add }, { index: 3, edit: away }],
      hover: 2,
    });
    expect(marks.cuts).toEqual([{ from: 'src/app', to: 'src/domain', highlight: false }]);
    expect(marks.arrows).toEqual([{ from: 'src/domain', to: 'src/app', highlight: true }]);
    const deleted: PlanEdit = { kind: 'fate', file: 'src/infra/db.ts', fate: 'delete' };
    const again: PlanEdit = { kind: 'fate', file: 'src/infra/db.ts', fate: 'delete' };
    const folded: PlanEdit = { kind: 'fate', file: 'src/app/b.ts', fate: 'fold', into: 'src/app/a.ts' };
    const strikes = ink({
      planned: [placed('src/infra/db.ts', 'file', 0, 0), placed('src/app/b.ts', 'file', 0, 1)],
      proposal: view([]),
      edits: [{ index: 0, edit: deleted }, { index: 1, edit: again }, { index: 4, edit: folded }],
      hover: 4,
      children: [{
        id: 'src/infra',
        planned: view([]),
        proposed: view([placed('src/infra/db.ts', 'file', 0, 0), placed('src/infra/extra.ts', 'file', 0, 1)]),
      }],
    });
    expect(strikes.strikes).toEqual([
      { id: 'src/infra/db.ts', highlight: false },
      { id: 'src/app/b.ts', highlight: true },
    ]);
    expect(strikes.rows).toEqual([]);
    expect(strikes.boxes).toEqual([]);
  });

  it('draws a split as rows inside the new box, a move as a row in an existing box, and a merge or rename as a new box', () => {
    const split: PlanEdit = { kind: 'split-package', package: 'src/app', parts: [{ name: 'scan', files: [] }, { name: 'jobs', files: ['src/app/a.ts', 'src/app/b.ts'] }] };
    const jobs = placed('src/app/jobs', 'package', 0, 1);
    const splitInk = ink({
      planned: [app],
      proposal: view([app, jobs]),
      edits: [{ index: 0, edit: split }],
      hover: 0,
      children: [{
        id: 'src/app/jobs',
        planned: null,
        proposed: null,
      }, {
        id: 'src/app/jobs',
        planned: view([]),
        proposed: view([placed('src/app/jobs/a.ts', 'file', 0, 0), placed('src/app/jobs/b.ts', 'file', 1, 0)]),
      }],
    });
    expect(splitInk.boxes[0].rows.map(row => row.path)).toEqual(['src/app/jobs/a.ts', 'src/app/jobs/b.ts']);
    expect(splitInk.boxes[0].highlight).toBe(true);
    expect(splitInk.strikes).toEqual([{ id: 'src/app', highlight: true }]);
    const moved: PlanEdit = { kind: 'move-file', file: 'src/app/a.ts', to: 'src/infra' };
    const loose = ink({
      planned: [app, infra],
      proposal: view([app, infra]),
      edits: [{ index: 3, edit: moved }],
      hover: 3,
      children: [{ id: 'src/infra', planned: view([placed('src/infra/db.ts', 'file', 0, 0)]), proposed: view([placed('src/infra/db.ts', 'file', 0, 0), placed('src/infra/a.ts', 'file', 1, 0)]) }],
    });
    expect(loose.boxes).toEqual([]);
    expect(loose.rows).toEqual([{ boxId: 'src/infra', path: 'src/infra/a.ts', name: 'a.ts', highlight: true }]);
    const renamed: PlanEdit = { kind: 'rename-package', from: 'src/infra', to: 'src/store' };
    const store = placed('src/store', 'package', 1, 1);
    const renameInk = ink({
      planned: [infra],
      proposal: view([store, placed('src/other', 'package', 0, 2)]),
      edits: [{ index: 0, edit: renamed }],
      pins: {},
    });
    expect(renameInk.boxes.map(box => box.id)).toEqual(['src/store']);
    expect(renameInk.strikes).toEqual([{ id: 'src/infra', highlight: false }]);
    const merged: PlanEdit = { kind: 'merge-packages', packages: ['src/infra', 'src/kept'], into: 'src/kept' };
    const kept = placed('src/kept', 'package', 0, 1);
    const mergeInk = ink({
      planned: [infra, domain],
      proposal: view([domain, kept]),
      edits: [{ index: 2, edit: merged }],
      hover: 2,
    });
    expect(mergeInk.boxes.map(box => [box.id, box.highlight])).toEqual([['src/kept', true]]);
    expect(mergeInk.strikes.map(mark => mark.id)).toEqual(['src/infra']);
    const fileRename: PlanEdit = { kind: 'rename-file', from: 'src/infra/db.ts', to: 'store.ts' };
    const renamedFile = ink({
      planned: [infra],
      proposal: view([infra]),
      edits: [{ index: 1, edit: fileRename }],
      children: [{ id: 'src/infra', planned: view([placed('src/infra/db.ts', 'file', 0, 0)]), proposed: view([placed('src/infra/store.ts', 'file', 0, 1)]) }],
    });
    expect(renamedFile.rows.map(row => row.path)).toEqual(['src/infra/store.ts']);
    expect(renamedFile.strikes).toEqual([{ id: 'src/infra/db.ts', highlight: false }]);
  });
});
