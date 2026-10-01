export type RawFunction = { name: string; line: number; endLine: number; cc: number };

export type ScannedFile = { path: string; test: boolean; abstract?: true; functions?: RawFunction[] };

export type ScanEdge = { from: string; to: string; kind: 'runtime' | 'type'; heritage?: number };

export type ExternalRef = { from: string; name: string; kind: 'runtime' | 'type'; heritage?: number };

export type WorkspacePackage = { dir: string; name: string };

export type ScanResult = {
  files: ScannedFile[];
  edges: ScanEdge[];
  externals: ExternalRef[];
  workspaces: WorkspacePackage[];
};

const TEST_DIR = /(^|\/)(__tests__|test|tests|e2e)(\/|$)/;
const TEST_FILE = /\.(test|spec)\./;

export function isTestPath(path: string): boolean {
  return TEST_DIR.test(path) || TEST_FILE.test(path);
}
