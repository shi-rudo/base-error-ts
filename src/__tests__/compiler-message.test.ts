import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { describe, expect, it } from "vitest";

const TESTS_DIR = dirname(fileURLToPath(import.meta.url));

/**
 * The messages that the compiler prints for a source beside the tests. A type
 * test cannot pin these: a deferred type and a union with a rule accept and
 * reject the same values, and only the printed text differs.
 */
function compilerMessages(source: string): string[] {
  const fileName = join(TESTS_DIR, "compiler-message.virtual.ts");
  const options: ts.CompilerOptions = {
    strict: true,
    noEmit: true,
    target: ts.ScriptTarget.ES2020,
    lib: ["lib.es2021.d.ts"],
    module: ts.ModuleKind.NodeNext,
    moduleResolution: ts.ModuleResolutionKind.NodeNext,
    skipLibCheck: true,
    types: [],
  };
  const host = ts.createCompilerHost(options);
  const readFile = host.readFile.bind(host);
  const fileExists = host.fileExists.bind(host);
  const getSourceFile = host.getSourceFile.bind(host);
  host.readFile = (name) => (name === fileName ? source : readFile(name));
  host.fileExists = (name) => name === fileName || fileExists(name);
  host.getSourceFile = (name, languageVersion) =>
    name === fileName
      ? ts.createSourceFile(name, source, languageVersion)
      : getSourceFile(name, languageVersion);

  const program = ts.createProgram([fileName], options, host);

  return ts
    .getPreEmitDiagnostics(program, program.getSourceFile(fileName))
    .map((diagnostic) =>
      ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n"),
    );
}

function lastLine(message: string): string {
  const lines = message.split("\n");
  return lines[lines.length - 1]!.trim();
}

const GENERIC_CALLER_PRELUDE = `
  import { defineErrors, matchErrorCode, type CatalogError } from "../index.js";

  const UserErrors = defineErrors({
    USER_NOT_FOUND: { category: "NOT_FOUND", retryable: false },
    RATE_LIMITED: { category: "RATE_LIMIT", retryable: true },
  });
  type UserError = CatalogError<typeof UserErrors>;
`;

describe("the compiler message for an unknown code in a caller generic over the error", () => {
  it("ends with the reason next to a catch-all", { timeout: 60000 }, () => {
    const messages = compilerMessages(`${GENERIC_CALLER_PRELUDE}
      export function statusOf<G extends UserError>(caught: G): number {
        return matchErrorCode(caught, { USER_NOT_FUND: () => 404, _: () => 500 });
      }
    `);

    expect(messages).toHaveLength(1);
    expect(lastLine(messages[0]!)).toBe(
      `Type '() => 404' is not assignable to type '"matchErrorCode: USER_NOT_FUND is not a code of this error"'.`,
    );
  });

  it("ends with the reason in a complete table", { timeout: 60000 }, () => {
    const messages = compilerMessages(`${GENERIC_CALLER_PRELUDE}
      export function statusOf<G extends UserError>(caught: G): number {
        return matchErrorCode(caught, {
          USER_NOT_FOUND: () => 404,
          RATE_LIMITED: () => 429,
          USER_NOT_FUND: () => 500,
        });
      }
    `);

    expect(messages).toHaveLength(1);
    expect(lastLine(messages[0]!)).toBe(
      `Type '() => 500' is not assignable to type '"matchErrorCode: USER_NOT_FUND is not a code of this error"'.`,
    );
  });
});
