import * as ts from 'typescript';

export type RawImport = { specifier: string; typeOnly: boolean; heritage?: number };

export type ParsedFile = { imports: RawImport[]; abstract: boolean };

type Draft = { specifier: string; typeOnly: boolean; heritage: number };

type Binding = { name: string; index: number; namespace: boolean };

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

function recordImport(node: ts.Node, drafts: Draft[]): number | undefined {
  const hit = importOfNode(node);
  if (hit === undefined) return undefined;
  drafts.push({ specifier: hit.specifier, typeOnly: hit.typeOnly, heritage: 0 });
  return drafts.length - 1;
}

function bindNamed(named: ts.NamedImportBindings | undefined, index: number, bindings: Binding[]): void {
  if (named === undefined) return;
  if (ts.isNamespaceImport(named)) {
    bindings.push({ name: named.name.text, index, namespace: true });
    return;
  }
  for (const element of named.elements) bindings.push({ name: element.name.text, index, namespace: false });
}

function bindClause(clause: ts.ImportClause | undefined, index: number, bindings: Binding[]): void {
  if (clause === undefined) return;
  if (clause.name !== undefined) bindings.push({ name: clause.name.text, index, namespace: false });
  bindNamed(clause.namedBindings, index, bindings);
}

function recordBinding(node: ts.Node, index: number, bindings: Binding[]): void {
  if (ts.isImportDeclaration(node)) bindClause(node.importClause, index, bindings);
  else if (ts.isImportEqualsDeclaration(node)) bindings.push({ name: node.name.text, index, namespace: false });
}

function collectImports(node: ts.Node, drafts: Draft[], bindings: Binding[]): void {
  const index = recordImport(node, drafts);
  if (index !== undefined) recordBinding(node, index, bindings);
  node.forEachChild(child => collectImports(child, drafts, bindings));
}

function classOrFunctionName(node: ts.Node): string | undefined {
  if (!ts.isClassDeclaration(node) && !ts.isFunctionDeclaration(node)) return undefined;
  return node.name?.text;
}

function typeLikeName(node: ts.Node): string | undefined {
  if (ts.isInterfaceDeclaration(node) || ts.isTypeAliasDeclaration(node)) return node.name.text;
  if (!ts.isEnumDeclaration(node)) return undefined;
  return node.name.text;
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
  if (name !== undefined) names.add(name);
  node.forEachChild(child => collectDeclared(child, names));
}

function heritageClausesOf(node: ts.Node): ts.NodeArray<ts.HeritageClause> | undefined {
  if (ts.isClassLike(node) || ts.isInterfaceDeclaration(node)) return node.heritageClauses;
  return undefined;
}

function memberLabel(expr: ts.PropertyAccessExpression): string | undefined {
  if (!ts.isIdentifier(expr.expression)) return undefined;
  return `${expr.expression.text}.${expr.name.text}`;
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

function pushHeritage(node: ts.Node, names: string[]): void {
  const clauses = heritageClausesOf(node);
  if (clauses === undefined) return;
  for (const clause of clauses) pushTypes(clause, names);
}

function collectHeritageNames(node: ts.Node, names: string[]): void {
  pushHeritage(node, names);
  node.forEachChild(child => collectHeritageNames(child, names));
}

function valueIndex(name: string, bindings: Binding[], declared: Set<string>): number | undefined {
  if (declared.has(name)) return undefined;
  return bindings.find(binding => binding.name === name && !binding.namespace)?.index;
}

function namespaceIndex(ns: string, bindings: Binding[], declared: Set<string>): number | undefined {
  if (declared.has(ns)) return undefined;
  return bindings.find(binding => binding.namespace && binding.name === ns)?.index;
}

function bindingIndex(name: string, bindings: Binding[], declared: Set<string>): number | undefined {
  const dot = name.indexOf('.');
  if (dot === -1) return valueIndex(name, bindings, declared);
  return namespaceIndex(name.slice(0, dot), bindings, declared);
}

function countHeritage(name: string, bindings: Binding[], declared: Set<string>, drafts: Draft[]): void {
  const index = bindingIndex(name, bindings, declared);
  if (index === undefined) return;
  drafts[index].heritage += 1;
}

function stampHeritage(source: ts.SourceFile, drafts: Draft[], bindings: Binding[]): void {
  const declared = new Set<string>();
  collectDeclared(source, declared);
  const names: string[] = [];
  collectHeritageNames(source, names);
  for (const name of names) countHeritage(name, bindings, declared, drafts);
}

function modifierList(node: ts.Node): readonly ts.ModifierLike[] | undefined {
  if (!ts.canHaveModifiers(node)) return undefined;
  return ts.getModifiers(node);
}

function hasKind(node: ts.Node, kind: ts.SyntaxKind): boolean {
  return modifierList(node)?.some(modifier => modifier.kind === kind) ?? false;
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

function toRaw(draft: Draft): RawImport {
  if (draft.heritage === 0) return { specifier: draft.specifier, typeOnly: draft.typeOnly };
  return { specifier: draft.specifier, typeOnly: draft.typeOnly, heritage: draft.heritage };
}

export function parseSource(path: string, text: string): ParsedFile {
  const source = ts.createSourceFile(path, text, ts.ScriptTarget.Latest);
  const drafts: Draft[] = [];
  const bindings: Binding[] = [];
  collectImports(source, drafts, bindings);
  stampHeritage(source, drafts, bindings);
  return { imports: drafts.map(toRaw), abstract: fileIsAbstract(source) };
}
