/**
 * Checks the code snippets that the guide loads from the examples
 * (`<<< @/../examples/file.ts#region`). `pnpm docs:build` runs it before
 * VitePress. VitePress shows the whole file when the region is missing, and it
 * does not warn. So this check fails the build in three cases:
 *
 * - the snippet names a file that does not exist;
 * - the file marks no region with the name of the snippet;
 * - the region uses a name that the file imports, and the import block that
 *   the guide shows in front of the snippet does not import it.
 */
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

const docsDirectory = fileURLToPath(new URL("../docs/", import.meta.url));
const guideDirectory = fileURLToPath(
  new URL("../docs/guide/", import.meta.url),
);

const SNIPPET = /^<<< @\/(\S+?)#(\S+?)(?:\{\w+\})?[ \t]*$/gm;
const IMPORT = /^import\s+(?:type\s+)?([\s\S]*?)\s+from\s+"[^"]+";/gm;

function importedNames(source) {
  const names = [];
  for (const [, clause] of source.matchAll(IMPORT)) {
    for (const part of clause.replace(/[{}]/g, ",").split(",")) {
      const name = part
        .trim()
        .replace(/^type\s+/, "")
        .split(/\s+as\s+/)
        .pop();
      if (name) names.push(name);
    }
  }
  return names;
}

function readText(path) {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return undefined;
  }
}

const problems = [];
let snippets = 0;
for (const page of readdirSync(guideDirectory).filter((file) =>
  file.endsWith(".md"),
)) {
  const markdown = readFileSync(guideDirectory + page, "utf8");
  for (const match of markdown.matchAll(SNIPPET)) {
    snippets++;
    const [, path, region] = match;
    const source = readText(docsDirectory + path);
    if (source === undefined) {
      problems.push(`${page}: ${path} does not exist`);
      continue;
    }
    const body = source.match(
      new RegExp(
        `// #region ${region}\\n([\\s\\S]*?)// #endregion ${region}\\n`,
      ),
    )?.[1];
    if (body === undefined) {
      problems.push(`${page}: ${path} marks no region "${region}"`);
      continue;
    }
    const inFront = markdown.slice(0, match.index);
    const shown = inFront.slice(Math.max(inFront.lastIndexOf("```ts\n"), 0));
    const shownNames = new Set(importedNames(shown));
    for (const name of importedNames(source)) {
      if (new RegExp(`\\b${name}\\b`).test(body) && !shownNames.has(name)) {
        problems.push(
          `${page}: the import block in front of ${path}#${region} does not import ${name}`,
        );
      }
    }
  }
}

if (problems.length > 0) {
  console.error("verify-doc-snippets: the guide shows code that drifted:");
  for (const problem of problems) console.error(`  ${problem}`);
  process.exit(1);
}
console.log(`verify-doc-snippets: all ${snippets} snippets resolve`);
