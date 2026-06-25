import { describe, expect, it } from "vitest";

import {
  definePublicErrors,
  project,
  type ProjectionOutcome,
} from "../public-error/index.js";
import type { FieldFault } from "../public-error/types.js";

type TimeoutLike = { kind: "timeout" };
const isTimeout = (error: unknown): error is TimeoutLike =>
  typeof error === "object" &&
  error !== null &&
  (error as TimeoutLike).kind === "timeout";

describe("onProject: one central observability point", () => {
  it("reports a code match, with via and projection status", () => {
    const seen: ProjectionOutcome[] = [];
    const catalog = definePublicErrors({
      fallback: { publicCode: "internal_error", status: 500, retryable: false },
      onProject: (_error, _view, outcome) => seen.push(outcome),
    }).registerByCode("db.deadlock", {
      publicCode: "temporarily_unavailable",
      status: 503,
      retryable: true,
    });

    project(catalog, { code: "db.deadlock" });

    expect(seen).toEqual([
      { kind: "matched", via: "code", projection: "none" },
    ]);
  });

  it("reports a predicate match", () => {
    const seen: ProjectionOutcome[] = [];
    const catalog = definePublicErrors({
      fallback: { publicCode: "internal_error", status: 500, retryable: false },
      onProject: (_error, _view, outcome) => seen.push(outcome),
    }).register({
      match: isTimeout,
      descriptor: { publicCode: "upstream_timeout", status: 504 },
    });

    project(catalog, { kind: "timeout" });
    expect(seen[0]).toMatchObject({ kind: "matched", via: "predicate" });
  });

  it("reports a plain fallback (no match)", () => {
    const seen: ProjectionOutcome[] = [];
    const catalog = definePublicErrors({
      fallback: { publicCode: "internal_error", status: 500, retryable: false },
      onProject: (_error, _view, outcome) => seen.push(outcome),
    });

    project(catalog, new Error("boom"));
    expect(seen[0]).toEqual({
      kind: "fallback",
      reason: "no_match",
      projection: "none",
    });
  });

  it("distinguishes a fallback caused by a throwing matcher", () => {
    const seen: ProjectionOutcome[] = [];
    const catalog = definePublicErrors({
      fallback: { publicCode: "internal_error", status: 500, retryable: false },
      onProject: (_error, _view, outcome) => seen.push(outcome),
    }).register({
      match: (_e: unknown): _e is never => {
        throw new Error("matcher blew up");
      },
      descriptor: { publicCode: "never", status: 500 },
    });

    project(catalog, { something: true });
    expect(seen[0]).toMatchObject({
      kind: "fallback",
      reason: "matcher_failed",
    });
  });

  it("surfaces projection success and failure for debugging", () => {
    const seen: ProjectionOutcome[] = [];
    const catalog = definePublicErrors({
      fallback: { publicCode: "internal_error", status: 500, retryable: false },
      onProject: (_error, _view, outcome) => seen.push(outcome),
    })
      .registerByCode("ok", {
        publicCode: "ok_pub",
        status: 200,
        projectDetails: (error: unknown): unknown =>
          (error as { details?: unknown }).details,
      })
      .registerByCode("boom", {
        publicCode: "boom_pub",
        status: 400,
        projectFields: (): readonly FieldFault[] => {
          throw new Error("projector blew up");
        },
      });

    project(catalog, { code: "ok", details: { a: 1 } });
    project(catalog, { code: "boom" });

    expect(seen[0]).toMatchObject({ projection: "succeeded" });
    expect(seen[1]).toMatchObject({ projection: "failed" });
  });

  it("swallows a throwing hook: telemetry never breaks projection", () => {
    const catalog = definePublicErrors({
      fallback: { publicCode: "internal_error", status: 500, retryable: false },
      onProject: () => {
        throw new Error("telemetry sink is down");
      },
    });

    expect(() => project(catalog, new Error("x"))).not.toThrow();
    expect(project(catalog, new Error("x")).code).toBe("internal_error");
  });
});
