/**
 * Prints the CHANGELOG.md section of one version, without its heading.
 * The publish workflow uses the output as the notes of the GitHub Release,
 * so the changelog stays the single owner of the release notes.
 *
 * Usage: node scripts/changelog-section.mjs 8.3.0
 */
import { readFileSync } from "node:fs";

const version = process.argv[2];
if (!version) {
  console.error("usage: node scripts/changelog-section.mjs <version>");
  process.exit(1);
}

const changelog = readFileSync(
  new URL("../CHANGELOG.md", import.meta.url),
  "utf8",
);
const lines = changelog.split("\n");

const start = lines.findIndex(
  (line) => line === `## ${version}` || line.startsWith(`## ${version} `),
);
if (start === -1) {
  console.error(
    `changelog-section: CHANGELOG.md has no section for version ${version}`,
  );
  process.exit(1);
}

let end = lines.length;
for (let index = start + 1; index < lines.length; index++) {
  if (lines[index].startsWith("## ")) {
    end = index;
    break;
  }
}

process.stdout.write(
  `${lines
    .slice(start + 1, end)
    .join("\n")
    .trim()}\n`,
);
