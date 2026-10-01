import * as ts from 'typescript';

export type RawImport = { specifier: string; typeOnly: boolean };

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

function collectFrom(node: ts.Node, found: RawImport[]): void {
  const hit = importOfNode(node);
  if (hit !== undefined) found.push(hit);
  node.forEachChild(child => collectFrom(child, found));
}

export function importsOfText(path: string, text: string): RawImport[] {
  const source = ts.createSourceFile(path, text, ts.ScriptTarget.Latest);
  const found: RawImport[] = [];
  collectFrom(source, found);
  return found;
}
