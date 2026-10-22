/**
 * The string form of an error and its cause graph, as `BaseError.toString()`
 * writes it: one line per node, aggregate members indented below their node.
 * A string render runs in catch paths, so it reads every foreign value through
 * the guarded reader and never throws.
 */
import type { CauseWalk } from "./cause-walk.js";
import { readCause, readMembers, readProperty } from "./guarded-read.js";
import { isNativeError } from "./native-error.js";
import {
  CIRCULAR_CAUSE_CHAIN_MARKER,
  MAX_CAUSE_DEPTH_MARKER,
  MAX_LOG_SIZE_MARKER,
  SHARED_CAUSE_MARKER,
  UNRENDERABLE_CAUSE_MARKER,
  moreAggregatedErrorsMarker,
} from "./serializer-markers.js";
import {
  MAX_AGGREGATE_MEMBERS,
  MAX_CAUSE_DEPTH,
  MAX_LOG_NODES,
} from "./walker-bounds.js";

/**
 * The line of a node that the caller renders itself, such as a `BaseError`
 * with a masked message, or `undefined` for the default line.
 */
export type OwnNodeLine = (node: unknown) => string | undefined;

/** One render: its cause walk, its line budget, and its output. */
type ChainRender = CauseWalk & {
  readonly budget: { nodes: number; readonly limit: number };
  readonly lines: string[];
  readonly ownNodeLine: OwnNodeLine;
  cut: boolean;
};

/**
 * Renders `root` and its cause graph. The render writes at most
 * {@link MAX_LOG_NODES} lines, and the next line is the size marker of the
 * log object.
 */
export function renderCauseChain(
  root: unknown,
  ownNodeLine: OwnNodeLine,
): string {
  const render: ChainRender = {
    seen: new Set<unknown>(),
    path: new Set<unknown>(),
    budget: { nodes: 0, limit: MAX_LOG_NODES },
    lines: [],
    ownNodeLine,
    cut: false,
  };
  renderChain(root, render, "", "", 0, 0);
  return render.lines.join("\n");
}

/**
 * Writes one line for one unit of the render budget. The first line past
 * the budget becomes the size marker, and the render stops at every level.
 * Returns whether the line was written.
 */
function renderLine(
  render: ChainRender,
  prefix: string,
  text: string,
): boolean {
  if (render.budget.nodes >= render.budget.limit) {
    render.lines.push(`${prefix}${MAX_LOG_SIZE_MARKER}`);
    render.cut = true;
    return false;
  }
  render.budget.nodes++;
  render.lines.push(`${prefix}${text}`);
  return true;
}

/**
 * Renders one cause chain into `render.lines`. A node that carries aggregate
 * members gets a count on its own line. Each member renders as its own
 * chain, indented one level deeper. `head` prefixes the first line: a
 * member starts with a bullet at the indent of its parent, and its own chain
 * keeps the deeper `indent`. The cause walk (see {@link CauseWalk}) spans the
 * whole tree, so a cycle and a shared node end with their marker instead of
 * recursing.
 *
 * `seen` bounds only repeated objects. The line budget bounds a tree that
 * grows while the render reads it, for example through a getter that returns
 * fresh members. Every line costs one unit of {@link MAX_LOG_NODES}, markers
 * and holes included, so the budget bounds the output.
 *
 * `depth` is the serializer depth of `start`, and `causeDepth` is the depth
 * at which its `cause` lands. The two differ only at the root. The log
 * serializer starts the root's `cause` at depth 0 and the root's members at
 * depth 1. Every cause node puts both one level below itself. Both counters
 * mirror the cause serializer of `BaseError`. So for a chain of error
 * objects, `toString()` shows the same nodes as `toLogObject()` and cuts at
 * the same marker. Near the budget the two differ: the log also
 * spends its allowance on data, and the render spends one unit per line.
 * For a plain-object cause, the serializer also copies its data fields and
 * cuts deep containers without a marker.
 */
function renderChain(
  start: unknown,
  render: ChainRender,
  head: string,
  indent: string,
  depth: number,
  causeDepth: number,
): void {
  // Aggregates recurse, and a string render must never throw. This check
  // bounds the nesting with the same cap the log serializer uses. A
  // pathologically deep tree then degrades to a marker instead of overflowing
  // the host stack. The host stack is far smaller on an edge isolate than on
  // Node.
  if (depth >= MAX_CAUSE_DEPTH) {
    renderLine(render, head, MAX_CAUSE_DEPTH_MARKER);
    return;
  }
  let current: unknown = start;
  let prefix = head;
  let nodeDepth = depth;
  let nextCauseDepth = causeDepth;
  // Each spine node of this chain is an ancestor of the nodes after it.
  const entered: object[] = [];
  try {
    while (current != null) {
      // A primitive has no links and cannot close a cycle, so it renders
      // each time it repeats.
      if (typeof current === "object") {
        if (render.path.has(current)) {
          renderLine(render, prefix, CIRCULAR_CAUSE_CHAIN_MARKER);
          return;
        }
        if (render.seen.has(current)) {
          renderLine(render, prefix, SHARED_CAUSE_MARKER);
          return;
        }
        render.seen.add(current);
        render.path.add(current);
        entered.push(current);
      }

      const aggregate = readMembers(current, MAX_AGGREGATE_MEMBERS);
      const total = aggregate === undefined ? 0 : aggregate.total;
      const suffix = total > 0 ? ` (+${total} aggregated)` : "";
      const node = `${renderNode(current, render.ownNodeLine)}${suffix}`;
      if (!renderLine(render, prefix, node)) return;

      const shown = aggregate === undefined ? [] : aggregate.members;
      for (const member of shown) {
        // A hole reads as undefined. It keeps its slot, as in the log, so the
        // count on the node line matches the list.
        if (member === undefined || member === null) {
          if (!renderLine(render, `${indent}  - `, String(member))) {
            return;
          }
          continue;
        }
        renderChain(
          member,
          render,
          `${indent}  - `,
          `${indent}    `,
          nodeDepth + 1,
          nodeDepth + 2,
        );
        if (render.cut) return;
      }
      if (
        total > shown.length &&
        !renderLine(
          render,
          `${indent}  `,
          moreAggregatedErrorsMarker(total - shown.length),
        )
      ) {
        return;
      }

      // This render bounds the linear spine the way the serializer bounds it.
      // A cause that would land past the cap is the depth marker, and a
      // missing or null cause ends the chain without one. Only the hops up to
      // the cap are read, so the length of the chain never sets the cost.
      const cause = readCause(current);
      if (cause !== undefined && nextCauseDepth >= MAX_CAUSE_DEPTH) {
        renderLine(render, `${indent}Caused by: `, MAX_CAUSE_DEPTH_MARKER);
        return;
      }
      current = cause;
      prefix = `${indent}Caused by: `;
      nodeDepth = nextCauseDepth;
      nextCauseDepth++;
    }
  } finally {
    for (const node of entered) render.path.delete(node);
  }
}

/**
 * One node as a single line. The caller's own line wins, which honors a
 * deny-listed `message` of a `BaseError`. A native error and an error-shaped
 * plain object (string `name` and `message`) render as `name: message`. A
 * string render runs in catch paths and must not throw. A foreign
 * `name`/`message` that throws falls back to the `Error.prototype` defaults.
 * Any other value renders through {@link renderValue}. A value whose tag
 * cannot be read (a revoked Proxy) renders as a marker.
 */
function renderNode(node: unknown, ownNodeLine: OwnNodeLine): string {
  try {
    const own = ownNodeLine(node);
    if (own !== undefined) return own;
    if (isNativeError(node)) {
      const name = readProperty(node, "name") ?? "Error";
      const message = readProperty(node, "message") ?? "";
      return `${renderValue(name)}: ${renderValue(message)}`;
    }
    // A plain object shaped like an error reads as its name and message, not
    // as "[object Object]". An example is a revived or cloned error at a
    // worker boundary.
    const name = readProperty(node, "name");
    const message = readProperty(node, "message");
    if (typeof name === "string" && typeof message === "string") {
      return `${name}: ${message}`;
    }
    return renderValue(node);
  } catch {
    return UNRENDERABLE_CAUSE_MARKER;
  }
}

/**
 * The text of a value that the render did not create. A primitive renders
 * with `String`. An object renders by its tag, such as `[object Array]`,
 * and its own conversion never runs: that conversion can be any work, and
 * the one of an array joins every element up to its `length`.
 */
function renderValue(value: unknown): string {
  return (typeof value === "object" && value !== null) ||
    typeof value === "function"
    ? Object.prototype.toString.call(value)
    : String(value);
}
