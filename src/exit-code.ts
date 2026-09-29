export function exitCode(code: number | null): number {
  if (code === null) return 1;
  return code;
}
