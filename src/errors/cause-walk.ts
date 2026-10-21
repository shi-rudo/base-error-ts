/**
 * The nodes of one walk over a cause graph, in the log and in `toString`.
 * `seen` holds every node that the walk already wrote, so each node is written
 * once and a later occurrence is the shared marker. The first occurrence can
 * have its subtree cut by the depth cap or masked by a sticky policy, and the
 * marker does not repeat it. `path` holds the ancestors of the current node,
 * so a node on it closes a cycle and is the circular marker. The log starts
 * with the root on both.
 */
export type CauseWalk = {
  readonly seen: Set<unknown>;
  readonly path: Set<unknown>;
};

/** A fresh cause walk that holds the root as the ancestor of its whole tree. */
export function rootCauseWalk(root: object): CauseWalk {
  return { seen: new Set([root]), path: new Set([root]) };
}
