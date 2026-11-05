import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const SCRIPT = fileURLToPath(
  new URL("../../scripts/verify-tag-is-main-tip.mjs", import.meta.url),
);
const WORKFLOW = new URL(
  "../../.github/workflows/npm-publish.yml",
  import.meta.url,
);

// The git configuration of the machine can sign commits or run hooks.
const GIT_ENV = {
  ...process.env,
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_CONFIG_NOSYSTEM: "1",
  GIT_AUTHOR_NAME: "test",
  GIT_AUTHOR_EMAIL: "test@example.com",
  GIT_COMMITTER_NAME: "test",
  GIT_COMMITTER_EMAIL: "test@example.com",
};

describe("verify-tag-is-main-tip", () => {
  let work: string;
  let clone: string;

  const gitIn = (cwd: string, ...args: string[]): string =>
    execFileSync("git", args, { cwd, env: GIT_ENV, encoding: "utf8" }).trim();

  const git = (...args: string[]): string => gitIn(clone, ...args);

  const commit = (message: string): string => {
    git("commit", "--allow-empty", "-m", message);
    return git("rev-parse", "HEAD");
  };

  const commitToMain = (message: string): string => {
    const sha = commit(message);
    git("push", "origin", "main");
    return sha;
  };

  const checkOutAnnotatedTag = (target: string): void => {
    git("tag", "-a", "v1.0.0", "-m", "v1.0.0", target);
    git("checkout", "--detach", "v1.0.0");
  };

  const runCheck = () =>
    spawnSync(process.execPath, [SCRIPT], {
      cwd: clone,
      env: GIT_ENV,
      encoding: "utf8",
    });

  beforeEach(() => {
    work = mkdtempSync(join(tmpdir(), "verify-tag-is-main-tip-"));
    clone = join(work, "clone");
    gitIn(work, "init", "--bare", "-b", "main", "origin.git");
    gitIn(work, "init", "-b", "main", "clone");
    git("remote", "add", "origin", join(work, "origin.git"));
  });

  afterEach(() => {
    rmSync(work, { recursive: true, force: true });
  });

  it("accepts an annotated tag on the tip of main", () => {
    commitToMain("first");
    const tip = commitToMain("release");
    checkOutAnnotatedTag(tip);

    const { status } = runCheck();

    expect(status).toBe(0);
  });

  it("rejects an annotated tag on an older commit of main, and names both commits", () => {
    const older = commitToMain("release");
    const tip = commitToMain("later");
    checkOutAnnotatedTag(older);

    const { status, stdout } = runCheck();

    expect(status).toBe(1);
    expect(stdout).toContain("::error::");
    expect(stdout).toContain(older);
    expect(stdout).toContain(tip);
  });

  it("rejects a tag on a commit that never reached main", () => {
    commitToMain("first");
    checkOutAnnotatedTag(commit("not pushed"));

    const { status } = runCheck();

    expect(status).toBe(1);
  });

  it("rejects a tag when origin has no main", () => {
    checkOutAnnotatedTag(commit("not pushed"));

    const { status, stdout } = runCheck();

    expect(status).toBe(1);
    expect(stdout).toContain("::error::");
  });
});

describe("the publish workflow", () => {
  const workflow = readFileSync(WORKFLOW, "utf8");
  const publishJob = workflow.slice(
    workflow.indexOf("\n  publish:\n"),
    workflow.indexOf("\n  jsr:\n"),
  );
  const jsrJob = workflow.slice(workflow.indexOf("\n  jsr:\n"));
  const check = "node scripts/verify-tag-is-main-tip.mjs";

  it("runs the check before the npm job installs or publishes anything", () => {
    const position = publishJob.indexOf(check);

    expect(position).toBeGreaterThan(-1);
    expect(position).toBeLessThan(publishJob.indexOf("npm install -g"));
    expect(position).toBeLessThan(publishJob.indexOf("run: npm publish"));
  });

  it("keeps the manual JSR run of an existing tag free of the check", () => {
    expect(jsrJob).not.toContain(check);
  });
});
