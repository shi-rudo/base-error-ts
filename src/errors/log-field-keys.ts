/** Cause envelope leaves retained by an allow-list. */
export const ENVELOPE_KEYS: ReadonlySet<string> = new Set([
  "name",
  "message",
  "stack",
  "code",
  "category",
  "retryable",
]);

/** Root envelope fields, including the links to causes and details. */
export const ROOT_ENVELOPE_KEYS: ReadonlySet<string> = new Set([
  ...ENVELOPE_KEYS,
  "timestamp",
  "timestampIso",
  "cause",
  "details",
]);

/** Own fields cannot replace envelope fields or prototype machinery. */
export const RESERVED_NODE_KEYS: ReadonlySet<string> = new Set([
  ...ROOT_ENVELOPE_KEYS,
  "errors",
  "__proto__",
]);
