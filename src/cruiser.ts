import * as ts from 'typescript';
import { CONTRACT_RULE_PREFIX, type ContractRule } from './domain/plan.ts';
import { unifiedDiff } from './linediff.ts';

export type CruiserPreview = { text: string; diff: string } | { error: string; snippet: string };

type Forbidden = { source: string; array: ts.ArrayLiteralExpression; elements: ts.ObjectLiteralExpression[] };

type Splice = { start: number; end: number; text: string };

const CRUISER_NAME = '.dependency-cruiser.cjs';
const REFUSAL = "bindweed can't merge into this .dependency-cruiser.cjs: forbidden is not a plain array";
const RULE_INDENT = '    ';

function quoted(text: string): string {
  const escapedText = text.replace(/[\\']/g, String.raw`\$&`);
  return `'${escapedText}'`;
}

function endText(end: ContractRule['from'] | ContractRule['to']): string {
  if ('circular' in end) return '{ circular: true }';
  return 'path' in end ? `{ path: ${quoted(end.path)} }` : '{}';
}

function ruleText(rule: ContractRule, indent: string): string {
  const fields = [
    `name: ${quoted(rule.name)},`,
    `severity: ${quoted(rule.severity)},`,
    `comment: ${quoted(rule.comment)},`,
    `from: ${endText(rule.from)},`,
    `to: ${endText(rule.to)}`,
  ];
  const body = fields.map(field => indent + '  ' + field + '\n').join('');
  return `{\n${body}${indent}}`;
}

function snippetOf(rules: ContractRule[]): string {
  if (rules.length === 0) return '';
  return `${rules.map(rule => RULE_INDENT + ruleText(rule, RULE_INDENT)).join(',\n')}\n`;
}

function freshArray(rules: ContractRule[]): string {
  if (rules.length === 0) return '[]';
  return `[\n${snippetOf(rules)}  ]`;
}

function canonicalFile(rules: ContractRule[], tsconfig: boolean): string {
  const options = ["doNotFollow: { path: 'node_modules' }", 'tsPreCompilationDeps: true'];
  if (tsconfig) options.push("tsConfig: { fileName: 'tsconfig.json' }");
  const optionLines = options.map(line => '    ' + line).join(',\n');
  return `module.exports = {\n  forbidden: ${freshArray(rules)},\n  options: {\n${optionLines}\n  }\n};\n`;
}

function parsesCleanly(source: string): boolean {
  return ts.transpileModule(source, { reportDiagnostics: true, fileName: 'cruiser.js' }).diagnostics?.length === 0;
}

function isModuleExports(node: ts.Expression): boolean {
  return ts.isPropertyAccessExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'module' && node.name.text === 'exports';
}

function assignedToExports(expression: ts.Expression): ts.Expression | undefined {
  if (!ts.isBinaryExpression(expression) || expression.operatorToken.kind !== ts.SyntaxKind.EqualsToken) return undefined;
  return isModuleExports(expression.left) ? expression.right : undefined;
}

function exportsAssignment(statement: ts.Statement): ts.Expression | undefined {
  return ts.isExpressionStatement(statement) ? assignedToExports(statement.expression) : undefined;
}

function exportDefault(statement: ts.Statement): ts.Expression | undefined {
  return ts.isExportAssignment(statement) ? statement.expression : undefined;
}

function exportedValue(file: ts.SourceFile): ts.Expression | undefined {
  const assigned = file.statements.map(exportsAssignment).find(value => value !== undefined);
  return assigned ?? file.statements.map(exportDefault).find(value => value !== undefined);
}

function keyText(name: ts.PropertyName): string | undefined {
  return ts.isIdentifier(name) || ts.isStringLiteral(name) ? name.text : undefined;
}

function propertyNamed(object: ts.ObjectLiteralExpression, name: string): ts.Expression | undefined {
  return object.properties.filter(ts.isPropertyAssignment).find(prop => keyText(prop.name) === name)?.initializer;
}

function plainArray(value: ts.Expression | undefined): Omit<Forbidden, 'source'> | undefined {
  if (value === undefined || !ts.isArrayLiteralExpression(value)) return undefined;
  const elements = value.elements.filter(ts.isObjectLiteralExpression);
  return elements.length === value.elements.length ? { array: value, elements } : undefined;
}

function forbiddenOf(source: string): Forbidden | undefined {
  const file = ts.createSourceFile('cruiser.js', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  const value = exportedValue(file);
  if (value === undefined || !ts.isObjectLiteralExpression(value)) return undefined;
  const plain = plainArray(propertyNamed(value, 'forbidden'));
  return plain === undefined ? undefined : { source, ...plain };
}

function readForbidden(source: string): Forbidden | undefined {
  return parsesCleanly(source) ? forbiddenOf(source) : undefined;
}

function isBindweed(element: ts.ObjectLiteralExpression): boolean {
  const name = propertyNamed(element, 'name');
  return name !== undefined && ts.isStringLiteral(name) && name.text.startsWith(CONTRACT_RULE_PREFIX);
}

function forbidsCycles(element: ts.ObjectLiteralExpression): boolean {
  const to = propertyNamed(element, 'to');
  if (to === undefined || !ts.isObjectLiteralExpression(to)) return false;
  return propertyNamed(to, 'circular')?.kind === ts.SyntaxKind.TrueKeyword;
}

export function keepsCycleRule(source: string | null): boolean {
  const forbidden = source === null ? undefined : readForbidden(source);
  if (forbidden === undefined) return false;
  return forbidden.elements.filter(element => !isBindweed(element)).some(forbidsCycles);
}

function commaEnd(source: string, from: number): number {
  const scanner = ts.createScanner(ts.ScriptTarget.Latest, true, ts.LanguageVariant.Standard, source, undefined, from);
  scanner.scan();
  return scanner.getTokenEnd();
}

function removal(forbidden: Forbidden, index: number): Splice {
  const element = forbidden.elements[index];
  const kept = forbidden.elements.slice(0, index).findLast(item => !isBindweed(item));
  if (kept !== undefined) return { start: kept.end, end: element.end, text: '' };
  return { start: forbidden.array.getStart() + 1, end: commaEnd(forbidden.source, element.end), text: '' };
}

function widest(splices: Splice[]): Splice[] {
  const ends = new Map<number, number>();
  for (const splice of splices) ends.set(splice.start, Math.max(ends.get(splice.start) ?? 0, splice.end));
  return [...ends].map(([start, end]) => ({ start, end, text: '' }));
}

function lineIndent(source: string, at: number): string {
  const line = source.slice(source.lastIndexOf('\n', at - 1) + 1, at);
  return line.slice(0, line.length - line.replace(/^[ \t]+/, '').length);
}

function insertion(source: string, last: ts.ObjectLiteralExpression, rules: ContractRule[]): Splice {
  const indent = lineIndent(source, last.getStart());
  return { start: last.end, end: last.end, text: rules.map(rule => `,\n${indent}${ruleText(rule, indent)}`).join('') };
}

function byStartDescending(a: Splice, b: Splice): number {
  return b.start - a.start || b.end - a.end;
}

function spliced(source: string, splices: Splice[]): string {
  return splices.toSorted(byStartDescending).reduce((text, splice) => text.slice(0, splice.start) + splice.text + text.slice(splice.end), source);
}

function mergedInto(forbidden: Forbidden, rules: ContractRule[]): string {
  const kept = forbidden.elements.filter(element => !isBindweed(element));
  const last = kept.at(-1);
  if (last === undefined) return spliced(forbidden.source, [{ start: forbidden.array.getStart(), end: forbidden.array.end, text: freshArray(rules) }]);
  const removals = forbidden.elements.map((element, index) => (isBindweed(element) ? removal(forbidden, index) : null)).filter(splice => splice !== null);
  return spliced(forbidden.source, [...widest(removals), insertion(forbidden.source, last, rules)]);
}

function previewOf(before: string, text: string): CruiserPreview {
  return { text, diff: unifiedDiff(before, text, CRUISER_NAME) };
}

export function previewCruiser(source: string | null, rules: ContractRule[], tsconfig: boolean): CruiserPreview {
  if (source === null) return previewOf('', canonicalFile(rules, tsconfig));
  const forbidden = readForbidden(source);
  if (forbidden === undefined) return { error: REFUSAL, snippet: snippetOf(rules) };
  return previewOf(source, mergedInto(forbidden, rules));
}
