import { describe, expect, it } from "vitest";

import manifest from "../../package.json" with { type: "json" };

/**
 * One entry of the `exports` map, with the declaration file nested under the
 * condition it belongs to. A single `types` for both conditions hands a CJS
 * consumer the ESM declarations (TS1479, "masquerading as ESM").
 */
type ConditionalExport = {
  readonly import: { readonly types: string; readonly default: string };
  readonly require: { readonly types: string; readonly default: string };
};

const exportsMap = manifest.exports as Record<string, ConditionalExport>;
const subpaths = Object.keys(exportsMap);

describe("package exports", () => {
  it("declares both entry points", () => {
    expect(subpaths).toEqual([".", "./public-error"]);
  });

  for (const subpath of subpaths) {
    describe(`"${subpath}"`, () => {
      const entry = exportsMap[subpath] as ConditionalExport;

      it("pairs the ESM build with the ESM declarations", () => {
        expect(entry.import.default).toMatch(/\.js$/);
        expect(entry.import.types).toMatch(/\.d\.ts$/);
      });

      it("pairs the CJS build with the CJS declarations", () => {
        expect(entry.require.default).toMatch(/\.cjs$/);
        expect(entry.require.types).toMatch(/\.d\.cts$/);
      });
    });
  }

  it("resolves every subpath under node10 through typesVersions", () => {
    const fallbacks = manifest.typesVersions["*"] as Record<string, string[]>;

    for (const subpath of subpaths) {
      if (subpath === ".") continue;
      const declarations = fallbacks[subpath.replace(/^\.\//, "")];
      expect(declarations).toEqual([exportsMap[subpath]?.import.types]);
    }
  });
});
