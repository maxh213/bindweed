export function lineOf(runtime: number): 'solid' | 'dashed' {
  return runtime > 0 ? 'solid' : 'dashed';
}

export function headOf(heritage: number): 'filled' | 'hollow' {
  return heritage > 0 ? 'hollow' : 'filled';
}

export function edgeLabel(runtime: number, type: number): string | null {
  const total = runtime + type;
  return total > 1 ? String(total) : null;
}

export function countLine(runtime: number, type: number, heritage: number): string {
  return `${runtime} runtime · ${type} type-only · ${heritage} extends/implements`;
}

export function edgeTitle(
  up: boolean,
  fromName: string,
  toName: string,
  cycleText: string | undefined,
  runtime: number,
  type: number,
  heritage: number,
): string {
  if (up) return `points up: ${fromName} is drawn below ${toName}`;
  if (cycleText !== undefined) return cycleText;
  return countLine(runtime, type, heritage);
}

export function filesLabel(count: number): string {
  return count === 1 ? '1 file' : `${count} files`;
}

export function boxCenter(x: number, y: number, width: number, height: number): { x: number; y: number } {
  return { x: x + width / 2, y: y + height / 2 };
}

export function parentDir(id: string): string {
  const slash = id.lastIndexOf('/');
  return slash === -1 ? '' : id.slice(0, slash);
}

function keptId(id: string | null, ids: ReadonlySet<string>): string | null {
  if (ids.has(id as string)) return id;
  return null;
}

export function detailId(chosen: string | null): string {
  if (chosen === null) return '';
  return chosen;
}

export function detailOn(chosen: string | null): boolean {
  if (chosen === null) return false;
  return true;
}

export function chosenId(picked: string | null, armed: string | null, ids: ReadonlySet<string>): string | null {
  return keptId(picked, ids) ?? keptId(armed, ids);
}

export function arrowColor(red: boolean): string {
  return red ? '#dc2626' : '#64748b';
}
