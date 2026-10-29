import { describe, expect, it } from "vitest";

import manifest from "../../package.json" with { type: "json" };

/**
 * One entry of the `exports` map: its declarations and its one ES module.
 * `import` and `require` both resolve the module, so a process loads one
 * copy of each class.
 */
type ModuleExport = { readonly types: string; readonly default: string };

const exportsMap = manifest.exports as Record<string, ModuleExport>;
const subpaths = Object.keys(exportsMap);

describe("package exports", () => {
  it("declares the core, the public-error, the pino and the Sentry entry points", () => {
    expect(subpaths).toEqual([".", "./public-error", "./pino", "./sentry"]);
  });

  for (const subpath of subpaths) {
    describe(`"${subpath}"`, () => {
      const entry = exportsMap[subpath] as ModuleExport;

      it("names one ES module and its declarations, and no CommonJS build", () => {
        expect(Object.keys(entry)).toEqual(["types", "default"]);
        expect(entry.default).toMatch(/\.js$/);
        expect(entry.types).toMatch(/\.d\.ts$/);
      });
    });
  }

  it("names the ES module of the root entry as main", () => {
    expect(manifest.main).toBe(exportsMap["."]?.default.replace(/^\.\//, ""));
  });

  it("resolves every subpath under node10 through typesVersions", () => {
    const fallbacks = manifest.typesVersions["*"] as Record<string, string[]>;

    for (const subpath of subpaths) {
      if (subpath === ".") continue;
      const declarations = fallbacks[subpath.replace(/^\.\//, "")];
      expect(declarations).toEqual([exportsMap[subpath]?.types]);
    }
  });
});
