import * as ts from 'typescript';

export type RawImport = { specifier: string; typeOnly: boolean; heritage?: number };

type RawFunction = { name: string; line: number; endLine: number; cc: number };

export type ParsedFile = { imports: RawImport[]; abstract: boolean; functions: RawFunction[] };

type ImportDraft = { specifier: string; typeOnly: boolean; heritage: number };

type ImportBinding = { name: string; index: number; namespace: boolean };

function blank<T>(): T[] {
  return JSON.parse('[]');
}

function bindingsTypeOnly(clause: ts.ImportClause): boolean {
  const bindings = clause.namedBindings as ts.NamedImportBindings;
  return (
    clause.name === undefined &&
    ts.isNamedImports(bindings) &&
    bindings.elements.length > 0 &&
    bindings.elements.every(element => element.isTypeOnly)
  );
}

function isTypeOnlyImport(node: ts.ImportDeclaration): boolean {
  const clause = node.importClause;
  if (clause === undefined) return false;
  return clause.phaseModifier === ts.SyntaxKind.TypeKeyword || bindingsTypeOnly(clause);
}

function namedExportsTypeOnly(clause: ts.NamedExportBindings | undefined): boolean {
  return clause?.kind === ts.SyntaxKind.NamedExports && clause.elements.length > 0 && clause.elements.every(element => element.isTypeOnly);
}

function isTypeOnlyExport(node: ts.ExportDeclaration): boolean {
  return node.isTypeOnly || namedExportsTypeOnly(node.exportClause);
}

function stringArgOf(node: ts.CallExpression): string | undefined {
  const args = node.arguments;
  if (args.length !== 1) return undefined;
  const arg = args[0];
  if (!ts.isStringLiteral(arg)) return undefined;
  return arg.text;
}

function isRequireCall(node: ts.CallExpression): boolean {
  return ts.isIdentifier(node.expression) && node.expression.text === 'require';
}

function importOfCall(node: ts.CallExpression): RawImport | undefined {
  if (node.expression.kind !== ts.SyntaxKind.ImportKeyword && !isRequireCall(node)) return undefined;
  const specifier = stringArgOf(node);
  return specifier === undefined ? undefined : { specifier, typeOnly: false };
}

function importOfImportEquals(node: ts.ImportEqualsDeclaration): RawImport | undefined {
  const ref = node.moduleReference;
  if (!ts.isExternalModuleReference(ref) || !ts.isStringLiteral(ref.expression)) return undefined;
  return { specifier: ref.expression.text, typeOnly: node.isTypeOnly };
}

function importOfImportDecl(node: ts.ImportDeclaration): RawImport | undefined {
  if (!ts.isStringLiteral(node.moduleSpecifier)) return undefined;
  return { specifier: node.moduleSpecifier.text, typeOnly: isTypeOnlyImport(node) };
}

function importOfExportDecl(node: ts.ExportDeclaration): RawImport | undefined {
  const specifier = node.moduleSpecifier;
  if (specifier === undefined || !ts.isStringLiteral(specifier)) return undefined;
  return { specifier: specifier.text, typeOnly: isTypeOnlyExport(node) };
}

function importOfStatement(node: ts.Node): RawImport | undefined {
  if (ts.isImportDeclaration(node)) return importOfImportDecl(node);
  if (ts.isExportDeclaration(node)) return importOfExportDecl(node);
  if (ts.isImportEqualsDeclaration(node)) return importOfImportEquals(node);
  return undefined;
}

function importOfNode(node: ts.Node): RawImport | undefined {
  if (ts.isCallExpression(node)) return importOfCall(node);
  return importOfStatement(node);
}

function recordImport(node: ts.Node, drafts: ImportDraft[]): number | undefined {
  const hit = importOfNode(node);
  if (hit === undefined) return undefined;
  drafts.push({ specifier: hit.specifier, typeOnly: hit.typeOnly, heritage: 0 });
  return drafts.length - 1;
}

function bindNamed(named: ts.NamedImportBindings | undefined, index: number, bindings: ImportBinding[]): void {
  if (named === undefined) return;
  if (ts.isNamespaceImport(named)) {
    bindings.push({ name: named.name.text, index, namespace: true });
    return;
  }
  for (const element of named.elements) bindings.push({ name: element.name.text, index, namespace: false });
}

function bindClause(clause: ts.ImportClause | undefined, index: number, bindings: ImportBinding[]): void {
  if (clause === undefined) return;
  if (clause.name !== undefined) bindings.push({ name: clause.name.text, index, namespace: false });
  bindNamed(clause.namedBindings, index, bindings);
}

function recordBinding(node: ts.Node, index: number, bindings: ImportBinding[]): void {
  const slot = Number(index.toFixed(0));
  if (ts.isImportDeclaration(node)) {
    bindClause(node.importClause, slot, bindings);
    return;
  }
  if (!ts.isImportEqualsDeclaration(node)) return;
  bindings.push({ name: node.name.text, index: slot, namespace: false });
}

function collectImports(node: ts.Node, drafts: ImportDraft[], bindings: ImportBinding[]): void {
  const index = recordImport(node, drafts);
  if (index !== undefined) recordBinding(node, index, bindings);
  node.forEachChild(child => collectImports(child, drafts, bindings));
}

function classOrFunctionName(node: ts.Node): string | undefined {
  if (!ts.isClassDeclaration(node) && !ts.isFunctionDeclaration(node)) return undefined;
  return node.name?.text;
}

function typeLikeName(node: ts.Node): string | undefined {
  if (ts.isInterfaceDeclaration(node) || ts.isTypeAliasDeclaration(node) || ts.isEnumDeclaration(node)) return node.name.text;
  return undefined;
}

function moduleIdent(node: ts.Node): string | undefined {
  if (!ts.isModuleDeclaration(node)) return undefined;
  return ts.isIdentifier(node.name) ? node.name.text : undefined;
}

function variableIdent(node: ts.Node): string | undefined {
  if (!ts.isVariableDeclaration(node)) return undefined;
  return ts.isIdentifier(node.name) ? node.name.text : undefined;
}

function declaredName(node: ts.Node): string | undefined {
  return classOrFunctionName(node) ?? typeLikeName(node) ?? moduleIdent(node) ?? variableIdent(node);
}

function collectDeclared(node: ts.Node, names: Set<string>): void {
  const name = declaredName(node);
  if (name !== undefined) names.add(name.slice(0));
  node.forEachChild(child => collectDeclared(child, names));
}

function memberLabel(expr: ts.PropertyAccessExpression): string | undefined {
  const base = expr.expression;
  if (!ts.isIdentifier(base)) return undefined;
  return `${ts.idText(base)}.${expr.name.text}`;
}

function heritageLabel(expr: ts.Expression): string | undefined {
  if (ts.isIdentifier(expr)) return expr.text;
  if (!ts.isPropertyAccessExpression(expr)) return undefined;
  return memberLabel(expr);
}

function pushTypes(clause: ts.HeritageClause, names: string[]): void {
  for (const type of clause.types) {
    const label = heritageLabel(type.expression);
    if (label !== undefined) names.push(label);
  }
}

function collectHeritageNames(node: ts.Node, names: string[]): void {
  if (ts.isHeritageClause(node)) pushTypes(node, names);
  node.forEachChild(child => collectHeritageNames(child, names));
}

function valueIndex(name: string, bindings: ImportBinding[], declared: Set<string>): number | undefined {
  if (declared.has(name)) return undefined;
  return bindings.find(binding => binding.name === name && !binding.namespace)?.index;
}

function namespaceIndex(ns: string, bindings: ImportBinding[], declared: Set<string>): number | undefined {
  if (declared.has(ns)) return undefined;
  return bindings.find(binding => binding.namespace && binding.name === ns)?.index;
}

function bindingIndex(name: string, bindings: ImportBinding[], declared: Set<string>): number | undefined {
  const dot = name.indexOf('.');
  if (dot === -1) return valueIndex(name, bindings, declared);
  return namespaceIndex(name.slice(0, dot), bindings, declared);
}

function countHeritage(name: string, bindings: ImportBinding[], declared: Set<string>, drafts: ImportDraft[]): void {
  const index = bindingIndex(name, bindings, declared);
  if (index === undefined) return;
  drafts[index].heritage += 1;
}

function markHeritage(source: ts.SourceFile, drafts: ImportDraft[], bindings: ImportBinding[]): void {
  const declared = new Set<string>();
  collectDeclared(source, declared);
  const names = blank<string>();
  collectHeritageNames(source, names);
  for (const name of names) countHeritage(name, bindings, declared, drafts);
}

function hasKind(node: ts.Node, kind: ts.SyntaxKind): boolean {
  return ts.getModifiers(node as ts.HasModifiers)?.some(modifier => modifier.kind === kind) ?? false;
}

function isTypeDeclaration(node: ts.Statement): boolean {
  return ts.isInterfaceDeclaration(node) || ts.isTypeAliasDeclaration(node);
}

function isAbstractClass(node: ts.Statement): boolean {
  return ts.isClassDeclaration(node) && hasKind(node, ts.SyntaxKind.AbstractKeyword);
}

function isDeclared(node: ts.Statement): boolean {
  return hasKind(node, ts.SyntaxKind.DeclareKeyword);
}

function isTypePort(node: ts.Statement): boolean {
  if (ts.isImportDeclaration(node)) return isTypeOnlyImport(node);
  return ts.isExportDeclaration(node) && isTypeOnlyExport(node);
}

function isAbstractStatement(node: ts.Statement): boolean {
  return isTypeDeclaration(node) || isAbstractClass(node) || isDeclared(node) || isTypePort(node);
}

function fileIsAbstract(source: ts.SourceFile): boolean {
  if (source.statements.length === 0) return false;
  return source.statements.every(isAbstractStatement);
}

function toRawImport(draft: ImportDraft): RawImport {
  if (draft.heritage === 0) return { specifier: draft.specifier, typeOnly: draft.typeOnly };
  return { specifier: draft.specifier, typeOnly: draft.typeOnly, heritage: draft.heritage };
}

const BRANCH_KINDS = new Set<ts.SyntaxKind>([
  ts.SyntaxKind.IfStatement,
  ts.SyntaxKind.ConditionalExpression,
  ts.SyntaxKind.ForStatement,
  ts.SyntaxKind.ForInStatement,
  ts.SyntaxKind.ForOfStatement,
  ts.SyntaxKind.WhileStatement,
  ts.SyntaxKind.DoStatement,
  ts.SyntaxKind.CaseClause,
  ts.SyntaxKind.CatchClause,
]);

const SHORT_CIRCUIT = new Set<ts.SyntaxKind>([
  ts.SyntaxKind.AmpersandAmpersandToken,
  ts.SyntaxKind.BarBarToken,
  ts.SyntaxKind.QuestionQuestionToken,
]);

const FUNCTION_KINDS = new Set<ts.SyntaxKind>([
  ts.SyntaxKind.FunctionDeclaration,
  ts.SyntaxKind.FunctionExpression,
  ts.SyntaxKind.ArrowFunction,
  ts.SyntaxKind.MethodDeclaration,
  ts.SyntaxKind.Constructor,
  ts.SyntaxKind.GetAccessor,
  ts.SyntaxKind.SetAccessor,
]);

type Cc = { value: number };

function isFunctionNode(node: ts.Node): boolean {
  return FUNCTION_KINDS.has(node.kind);
}

function isShortCircuit(node: ts.Node): boolean {
  if (node.kind !== ts.SyntaxKind.BinaryExpression) return false;
  return SHORT_CIRCUIT.has((node as ts.BinaryExpression).operatorToken.kind);
}

function bumpCc(node: ts.Node, cc: Cc): void {
  if (BRANCH_KINDS.has(node.kind)) cc.value += 1;
  if (isShortCircuit(node)) cc.value += 1;
}

function countBranches(node: ts.Node, cc: Cc): void {
  node.forEachChild(child => {
    if (isFunctionNode(child)) return;
    bumpCc(child, cc);
    countBranches(child, cc);
  });
}

function parentName(parent: ts.Node): string {
  if (ts.isVariableDeclaration(parent) || ts.isPropertyAssignment(parent)) return parent.name.getText();
  return '<anonymous>';
}

function functionName(fn: ts.Node): string {
  const name = (fn as { name?: ts.Node }).name;
  if (name === undefined) return parentName(fn.parent);
  return name.getText();
}

function measureFunction(fn: ts.Node, source: ts.SourceFile): RawFunction {
  const cc: Cc = { value: 1 };
  countBranches(fn, cc);
  return {
    name: functionName(fn),
    line: source.getLineAndCharacterOfPosition(fn.getStart(source)).line + 1,
    endLine: source.getLineAndCharacterOfPosition(fn.getEnd()).line + 1,
    cc: cc.value,
  };
}

function collectFunctions(node: ts.Node, source: ts.SourceFile, found: RawFunction[]): void {
  if (isFunctionNode(node)) found.push(measureFunction(node, source));
  node.forEachChild(child => collectFunctions(child, source, found));
}

export function parseSource(path: string, text: string): ParsedFile {
  const source = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true);
  const drafts = blank<ImportDraft>();
  const bindings = blank<ImportBinding>();
  const functions = blank<RawFunction>();
  collectImports(source, drafts, bindings);
  markHeritage(source, drafts, bindings);
  collectFunctions(source, source, functions);
  return { imports: drafts.map(toRawImport), abstract: fileIsAbstract(source), functions };
}
