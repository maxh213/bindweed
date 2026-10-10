export const SMALL = { packages: 10, perPackage: 20, deep: 20 };
export const BIG = { packages: 20, perPackage: 200, deep: 100 };
export const SPLIT = 'pkg7';
export const ROOT_NAME = 'perf-repo';

export function fileName(shape, pkg, index) {
  return `pkg${pkg}/f${pkg * shape.perPackage + index}.ts`;
}

function packageFiles(shape, files, edges) {
  for (let i = 0; i < shape.packages; i += 1) {
    for (let j = 0; j < shape.perPackage; j += 1) {
      const from = fileName(shape, i, j);
      files.push({ path: from, test: j % 50 === 0 });
      for (let k = 1; k <= 5; k += 1) {
        const to =
          k <= 3
            ? fileName(shape, i, (j + k * 7) % shape.perPackage)
            : fileName(shape, (i + k) % shape.packages, (j + k * 3) % shape.perPackage);
        edges.push({ from, to, kind: k === 5 ? 'type' : 'runtime' });
      }
    }
  }
}

function deepFiles(shape, files, edges) {
  for (let j = 0; j < shape.deep; j += 1) {
    const from = `deep/d${j}.ts`;
    files.push({ path: from, test: false });
    for (let k = 1; k <= 5; k += 1) {
      edges.push({ from, to: `deep/d${(j + k * 7) % shape.deep}.ts`, kind: k === 5 ? 'type' : 'runtime' });
    }
  }
}

export function buildScan(shape) {
  const files = [];
  const edges = [];
  packageFiles(shape, files, edges);
  deepFiles(shape, files, edges);
  const workspaces = [];
  for (let i = 0; i < 8; i += 1) workspaces.push({ dir: `pkg${i}`, name: `@acme/pkg${i}` });
  return { files, edges, externals: [], workspaces };
}

export function oldEdits(shape, scan) {
  const cuts = [];
  const seen = new Set();
  for (const edge of scan.edges) {
    if (!edge.from.startsWith('pkg1/') || !edge.to.startsWith('pkg1/')) continue;
    const key = `${edge.from}\n${edge.to}`;
    if (seen.has(key)) continue;
    seen.add(key);
    cuts.push({ kind: 'cut-edge', from: edge.from, to: edge.to, files: [[edge.from, edge.to]] });
    if (cuts.length === 10) break;
  }
  const moves = [];
  for (let i = 1; i <= Math.min(20, shape.perPackage / 2); i += 1) moves.push({ kind: 'move-file', file: fileName(shape, 0, i), to: '.' });
  const half = shape.packages / 2;
  const adds = [];
  for (let i = 0; i < half; i += 1) adds.push({ kind: 'add-edge', from: `pkg${i}`, to: `pkg${(i + half + 1) % shape.packages}` });
  const notes = [];
  for (let i = 0; i < 5; i += 1) notes.push({ kind: 'note', target: { node: `pkg${i + half}` }, text: `note ${i}` });
  for (let i = 0; i < 4; i += 1) notes.push({ kind: 'note', target: { edge: [`pkg${i + half}`, `pkg${(i + half + 4) % shape.packages}`] }, text: `edge ${i}` });
  const clear = edit => !JSON.stringify(edit).includes(`"${SPLIT}"`);
  return [...cuts, ...moves, ...adds.filter(clear), ...notes.filter(clear)];
}

function halves(files) {
  const half = Math.floor(files.length / 2);
  return [
    { name: 'read', files: files.slice(0, half) },
    { name: 'write', files: files.slice(half) },
  ];
}

function packageList(shape, pkg) {
  const files = [];
  for (let j = 0; j < shape.perPackage; j += 1) files.push(fileName(shape, pkg, j));
  return files;
}

function deepList(shape) {
  const files = [];
  for (let j = 0; j < shape.deep; j += 1) files.push(`deep/d${j}.ts`);
  return files;
}

export function reshapeEdits(shape) {
  return [
    { kind: 'create-package', path: 'ports' },
    { kind: 'move-file', file: fileName(shape, 2, 1), to: 'ports' },
    { kind: 'rename-package', from: 'pkg3', to: 'adapters' },
    { kind: 'rename-file', from: fileName(shape, 4, 1), to: 'g1.ts' },
    { kind: 'merge-packages', packages: ['pkg5', 'pkg6'], into: 'infra' },
    { kind: 'split-package', package: SPLIT, parts: halves(packageList(shape, 7)) },
    { kind: 'split-package', package: 'deep', parts: halves(deepList(shape)) },
    { kind: 'fate', file: fileName(shape, 8, 1), fate: 'delete' },
    { kind: 'fate', file: fileName(shape, 9, 1), fate: 'fold', into: fileName(shape, 9, 2) },
    { kind: 'create-package', path: 'spare' },
  ];
}

export function requireView(view, count, label) {
  if (view === null || view === undefined || view.nodes.length < count) throw new Error(`${label} did not draw`);
  return view;
}

export function allFresh(reasons, label) {
  if (reasons.some(reason => reason !== null)) throw new Error(`${label} fixture is stale: ${JSON.stringify(reasons)}`);
}

export function warningCount(report) {
  return report.warnings.reduce((sum, list) => sum + list.length, 0);
}

export function plannedRequest(fns, scan, edits, label) {
  const report = fns.planReport(scan, edits, fns.cycleTexts);
  const view = requireView(fns.graphView(report.scan, '', ROOT_NAME), 10, label);
  const body = { ...view, stale: report.stale };
  return report.warnings.every(list => list.length === 0) ? body : { ...body, warnings: report.warnings };
}

export function reshapeFresh(staleReasons, scan, edits) {
  try {
    const reasons = staleReasons(scan, edits);
    return reasons.every(reason => reason === null);
  } catch {
    return false;
  }
}
