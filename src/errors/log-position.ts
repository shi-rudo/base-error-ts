/** The envelope or consumer-data region occupied by a log container. */
export type LogRegion = "root" | "cause" | "data";

export type WalkPosition = {
  region: LogRegion;
  depth: number;
  spine: number;
};

/** Shared position rule for serialization and redaction. */
export function childPosition(
  parent: WalkPosition,
  array: boolean,
  key: string,
  value: unknown,
): WalkPosition {
  const region = array ? parent.region : childRegion(parent.region, key, value);
  return {
    region,
    depth: region === "cause" ? parent.depth : parent.depth + 1,
    spine:
      parent.spine +
      (region === "cause" && (array || !Array.isArray(value)) ? 1 : 0),
  };
}

/**
 * Region a child **container** enters (a leaf never transitions; its
 * keep/mask decision is made in the region it lives in). Data is sticky for
 * the whole subtree. `details` → data. `cause`, and `errors` when it holds
 * a list → cause: they are the only containers on the cause spine. Every
 * other container, an object under `errors` included, drops
 * to data, at the root as well as inside a cause. That covers a foreign key
 * (a field a subclass added via `buildOwnLogFields`, a sibling a plain-object
 * cause carries) and also an **envelope-named** key: the envelope fields
 * (`name`/`message`/`stack`/`code`/`category`/`retryable`) are primitives,
 * so a container found under one of those names is not the envelope. It is
 * data, and an envelope-named leaf nested inside it stays masked.
 */
function childRegion(
  region: LogRegion,
  key: string,
  value: unknown,
): LogRegion {
  if (region === "data") return "data";
  if (key === "details") return "data";
  if (key === "cause") return "cause";
  // An aggregate's members are further cause nodes, so they keep the same
  // structural envelope a `cause` gets, at the root as well as inside a
  // cause. Only a list transitions: the serializer writes `errors` as a
  // list, so an object under that name is foreign data, and it is bounded
  // by the data depth like any other foreign subtree. `errors` is
  // deliberately **not** added to the root envelope: a scalar named
  // `errors` is still a data leaf and stays masked under an allow-list.
  if (key === "errors") return Array.isArray(value) ? "cause" : "data";
  return "data";
}
