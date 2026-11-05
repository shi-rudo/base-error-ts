/**
 * Fails when the checked-out commit is not the tip of main on origin. The
 * publish workflow runs it on the tagged commit. An older commit of main passes
 * the version check when it already carries the version, and npm has no restore
 * path for a published version. An ancestor check is not enough, because an old
 * commit of main is an ancestor too.
 *
 * Usage: node scripts/verify-tag-is-main-tip.mjs
 */
import { execFileSync } from "node:child_process";

function git(...args) {
  return execFileSync("git", args, { encoding: "utf8" }).trim();
}

const tagged = git("rev-parse", "HEAD");
const tip = git("ls-remote", "origin", "refs/heads/main").split("\t")[0];

if (tagged !== tip) {
  console.log(
    `::error::verify-tag-is-main-tip: the tag points at ${tagged}, and the tip of main on origin is ${tip || "absent"}. Set the tag on the tip of main.`,
  );
  process.exit(1);
}
