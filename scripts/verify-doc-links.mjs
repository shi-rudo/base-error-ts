/**
 * Post-build check of the `{@link}` targets in the declaration bundles in
 * dist/. `pnpm build` runs it after tsup. It cannot run in tsup's `onSuccess`,
 * because that hook fires before tsup writes the declaration bundles.
 *
 * Typedoc resolves a link with the TypeScript checker, also in a doc comment
 * that a consumer's class inherits from a class of this package. A target
 * without a page in the consumer's docs costs one warning per inheriting
 * class. This check
 * resolves every link the same way and fails the build in three cases:
 *
 * - the target does not resolve;
 * - the target is not public API: no entry point exports it, and it is no
 *   non-private member of an export;
 * - the link sits in the doc of a class member, and the target is no member
 *   of that class. A subclass in another package documents the inherited
 *   member without the rest of this package.
 */
import { fileURLToPath } from "node:url";
import ts from "typescript";

const entryPoints = [
  "../dist/index.d.ts",
  "../dist/public-error/index.d.ts",
].map((path) => fileURLToPath(new URL(path, import.meta.url)));
const distDirectory = fileURLToPath(new URL("../dist/", import.meta.url));

const program = ts.createProgram(entryPoints, {
  noEmit: true,
  lib: ["lib.es2021.d.ts"],
  types: [],
  module: ts.ModuleKind.ESNext,
  moduleResolution: ts.ModuleResolutionKind.Bundler,
});
const checker = program.getTypeChecker();

const resolveAlias = (symbol) =>
  symbol.flags & ts.SymbolFlags.Alias
    ? checker.getAliasedSymbol(symbol)
    : symbol;

const isPrivateMember = (symbol) =>
  (symbol.declarations ?? []).some(
    (declaration) =>
      (declaration.name && ts.isPrivateIdentifier(declaration.name)) ||
      ts.getCombinedModifierFlags(declaration) & ts.ModifierFlags.Private,
  );

const membersOf = (symbol) => {
  const members = [];
  if (
    symbol.flags &
    (ts.SymbolFlags.Class | ts.SymbolFlags.Interface | ts.SymbolFlags.TypeAlias)
  ) {
    members.push(
      ...checker.getPropertiesOfType(checker.getDeclaredTypeOfSymbol(symbol)),
    );
  }
  if (symbol.flags & ts.SymbolFlags.Class) {
    members.push(
      ...checker.getPropertiesOfType(checker.getTypeOfSymbol(symbol)),
    );
  }
  return members.filter((member) => !isPrivateMember(member));
};

// An inherited member resolves to a new symbol per subclass, so the check
// compares declarations, not symbols.
const publicDeclarations = new Set();
for (const entryPoint of entryPoints) {
  const moduleSymbol = checker.getSymbolAtLocation(
    program.getSourceFile(entryPoint),
  );
  for (const exported of checker.getExportsOfModule(moduleSymbol)) {
    const symbol = resolveAlias(exported);
    for (const publicSymbol of [symbol, ...membersOf(symbol)]) {
      for (const declaration of publicSymbol.declarations ?? [])
        publicDeclarations.add(declaration);
    }
  }
}

// The checker resolves a bare member name only inside a class or an interface.
// Typedoc also resolves it against the members of an enclosing type literal.
const typeLiteralMember = (name) => {
  if (!ts.isIdentifier(name)) return undefined;
  for (let node = name.parent; node; node = node.parent) {
    if (!ts.isTypeLiteralNode(node)) continue;
    const member = node.members.find(
      (candidate) =>
        candidate.name &&
        ts.isIdentifier(candidate.name) &&
        candidate.name.text === name.text,
    );
    if (member) return member;
  }
  return undefined;
};

const memberDeclarationsByClass = new Map();
const memberDeclarationsOf = (classDeclaration) => {
  if (!memberDeclarationsByClass.has(classDeclaration)) {
    const members = membersOf(
      checker.getSymbolAtLocation(classDeclaration.name),
    );
    memberDeclarationsByClass.set(
      classDeclaration,
      new Set(members.flatMap((member) => member.declarations ?? [])),
    );
  }
  return memberDeclarationsByClass.get(classDeclaration);
};

const publicMemberClassOf = (link) => {
  for (let node = link.parent; node; node = node.parent) {
    if (ts.isClassDeclaration(node)) return undefined;
    if (ts.isClassElement(node) && ts.isClassDeclaration(node.parent)) {
      const isPublicMember = ts.isConstructorDeclaration(node)
        ? publicDeclarations.has(node.parent)
        : publicDeclarations.has(node);
      return isPublicMember ? node.parent : undefined;
    }
  }
  return undefined;
};

const targetDeclarations = (name) => {
  const symbol = checker.getSymbolAtLocation(name);
  if (symbol) return resolveAlias(symbol).declarations ?? [];
  const member = typeLiteralMember(name);
  return member ? [member] : undefined;
};

const isLink = (node) =>
  node.kind === ts.SyntaxKind.JSDocLink ||
  node.kind === ts.SyntaxKind.JSDocLinkCode ||
  node.kind === ts.SyntaxKind.JSDocLinkPlain;

const links = new Set();
const collectLinks = (node) => {
  if (isLink(node)) links.add(node);
  ts.forEachChild(node, collectLinks);
};
const visitDeclarations = (node) => {
  for (const jsDoc of ts.getJSDocCommentsAndTags(node)) collectLinks(jsDoc);
  ts.forEachChild(node, visitDeclarations);
};

const distFiles = program
  .getSourceFiles()
  .filter((sourceFile) => sourceFile.fileName.startsWith(distDirectory));
for (const sourceFile of distFiles) visitDeclarations(sourceFile);

const failures = [];
for (const link of links) {
  // `{@link https://example.com}` parses as the name `https` and the text `://example.com`.
  if (link.text.startsWith("://")) continue;
  const sourceFile = link.getSourceFile();
  const { line } = sourceFile.getLineAndCharacterOfPosition(
    link.getStart(sourceFile),
  );
  const where = `${sourceFile.fileName.slice(distDirectory.length)}:${line + 1}`;
  const target = link.name ? link.name.getText(sourceFile) : "(no target)";
  const declarations = link.name && targetDeclarations(link.name);
  const memberClass = publicMemberClassOf(link);
  if (!declarations) {
    failures.push(`${where} {@link ${target}} does not resolve`);
  } else if (
    !declarations.some((declaration) => publicDeclarations.has(declaration))
  ) {
    failures.push(
      `${where} {@link ${target}} resolves to a name that is not public API`,
    );
  } else if (
    memberClass &&
    !declarations.some((declaration) =>
      memberDeclarationsOf(memberClass).has(declaration),
    )
  ) {
    failures.push(
      `${where} {@link ${target}} is in the doc of a ${memberClass.name.text} member, but the target is no member of ${memberClass.name.text}`,
    );
  }
}

if (failures.length > 0) {
  console.error(
    `verify-doc-links: ${failures.length} link target(s) in the declaration bundles have no public page:\n  ${failures.join("\n  ")}`,
  );
  process.exit(1);
}

console.log(
  `verify-doc-links: all ${links.size} doc links resolve to public API`,
);
