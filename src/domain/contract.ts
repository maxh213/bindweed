import { byStrings, CONTRACT_RULE_PREFIX, within, type ContractRule } from './plan.ts';
import type { ScanResult } from './scan.ts';

type Cut = { from: string; to: string };

type Shape = { scan: ScanResult; cuts: Cut[] };

const REGEX_SPECIAL = /[\\^$.*+?()[\]{}|]/g;

function escaped(path: string): string {
  return path.replace(REGEX_SPECIAL, String.raw`\$&`);
}

function spelled(path: string): string {
  return path.replace(/[/.]/g, '-');
}

function endPattern(end: string, files: Set<string>): string {
  return files.has(end) ? `^${escaped(end)}$` : `^${escaped(end)}/`;
}

function cutRule(cut: Cut, files: Set<string>): ContractRule {
  return {
    name: `${CONTRACT_RULE_PREFIX}no-${spelled(cut.from)}-to-${spelled(cut.to)}`,
    severity: 'error',
    comment: `${cut.from} must not import ${cut.to}`,
    from: { path: endPattern(cut.from, files) },
    to: { path: endPattern(cut.to, files) },
  };
}

function apart(cut: Cut): boolean {
  return !within(cut.from, cut.to) && !within(cut.to, cut.from);
}

function distinctRules(rules: ContractRule[]): ContractRule[] {
  return [...new Map(rules.map(rule => [JSON.stringify(rule), rule])).values()];
}

function cutRules(shape: Shape): ContractRule[] {
  const files = new Set(shape.scan.files.map(file => file.path));
  return distinctRules(shape.cuts.filter(apart).map(cut => cutRule(cut, files)));
}

function ancestorsOf(path: string): string[] {
  const parts = path.split('/');
  return parts.slice(1).map((_, index) => parts.slice(0, index + 1).join('/'));
}

function packagesOf(scan: ScanResult): Set<string> {
  const code = scan.files.filter(file => !file.test).flatMap(file => ancestorsOf(file.path));
  return new Set([...(scan.declared ?? []), ...code]);
}

function siblingPair(from: string, to: string): [string, string] | null {
  const left = from.split('/');
  const right = to.split('/');
  const split = left.findIndex((part, index) => part !== right[index]);
  if (split === -1 || split >= right.length) return null;
  return [left.slice(0, split + 1).join('/'), right.slice(0, split + 1).join('/')];
}

function pairKey(first: string, second: string): string {
  return JSON.stringify([first, second]);
}

function packagePair(pair: [string, string] | null, packages: Set<string>): pair is [string, string] {
  return pair !== null && packages.has(pair[0]) && packages.has(pair[1]);
}

function usesOf(scan: ScanResult, packages: Set<string>): [string, string][] {
  const pairs = [...scan.edges, ...(scan.planned ?? [])].map(edge => siblingPair(edge.from, edge.to));
  const found = new Map(pairs.filter(pair => packagePair(pair, packages)).map(pair => [pairKey(pair[0], pair[1]), pair]));
  return [...found.values()].filter(([user, used]) => !found.has(pairKey(used, user)));
}

function directionRule(user: string, used: string): ContractRule {
  return {
    name: `${CONTRACT_RULE_PREFIX}${spelled(used)}-does-not-use-${spelled(user)}`,
    severity: 'error',
    comment: `${used} does not use ${user}`,
    from: { path: `^${escaped(used)}/` },
    to: { path: `^${escaped(user)}/` },
  };
}

function byRuleName(a: ContractRule, b: ContractRule): number {
  return byStrings(a.name, b.name);
}

function directionRules(scan: ScanResult): ContractRule[] {
  return usesOf(scan, packagesOf(scan))
    .map(([user, used]) => directionRule(user, used))
    .sort(byRuleName);
}

function noCircular(): ContractRule {
  return { name: `${CONTRACT_RULE_PREFIX}no-circular`, severity: 'error', comment: 'No circular dependencies', from: {}, to: { circular: true } };
}

export function contractRules(shape: Shape, cycles: boolean): ContractRule[] {
  const rules = [...cutRules(shape), ...directionRules(shape.scan)];
  return cycles ? [...rules, noCircular()] : rules;
}
