export function bad(n: number): number {
  if (n > 0 && n < 3) return 1;
  if (n > 3 || n < 0) return 2;
  if (n === 9) return 9;
  return 0;
}
