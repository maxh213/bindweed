export type ScannedFile = { path: string; test: boolean };

export type ScanEdge = { from: string; to: string; kind: 'runtime' | 'type' };

export type ExternalRef = { from: string; name: string; kind: 'runtime' | 'type' };

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
