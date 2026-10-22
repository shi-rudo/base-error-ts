/**
 * The built-in redaction policies over a log object: the deny-list of
 * `redact` and the allow-list of `redactAllow`. The log build copies every
 * value that it reads. The output of a cause's custom redactor and each
 * mask result pass through the same copier. The walk therefore meets plain
 * data only: plain objects, arrays and JSON primitives, as a finite tree
 * within the log budget. It needs no bounds, guards or markers of its own
 * (proposal 0017).
 */
import { ENVELOPE_KEYS, ROOT_ENVELOPE_LEAF_KEYS } from "./log-field-keys.js";
import { childRegion, type LogRegion } from "./log-position.js";
import { isCauseSpineMarker } from "./serializer-markers.js";

/** A mask as one walk applies it, to a value under its key. */
export type MaskApplier = (value: unknown, key: string) => unknown;

/** Sentinel returned by a redaction decision to mean "descend / keep as-is". */
const RECURSE: unique symbol = Symbol("redact.recurse");

type RedactionDecision = (
  key: string,
  value: unknown,
  region: LogRegion,
  leaf: boolean,
) => unknown;

/** The captured header fields of one envelope node, for the stack pass. */
type RedactionStackHeader = {
  target: Record<string, unknown>;
  name?: unknown;
  message?: unknown;
  stack?: unknown;
};

/**
 * Masks every key in `denied`, at any depth. When `name` or `message` is
 * denied and `stack` is not, the stack header of each envelope node is
 * rewritten from the masked fields.
 */
export function denyListRedaction(
  log: Record<string, unknown>,
  denied: ReadonlySet<string>,
  applyMask: MaskApplier,
): Record<string, unknown> {
  // A denied `stack` is masked whole by the walk, so the header pass is
  // needed only when a header component is denied without `stack`.
  const headers: RedactionStackHeader[] | undefined =
    (denied.has("name") || denied.has("message")) && !denied.has("stack")
      ? []
      : undefined;
  const masked = redactionWalk(
    log,
    (key, value) => (denied.has(key) ? applyMask(value, key) : RECURSE),
    "root",
    headers,
  ) as Record<string, unknown>;
  for (const header of headers ?? []) {
    if (typeof header.stack === "string") {
      header.target.stack = maskStackHeader(
        header.stack,
        header.name,
        header.message,
        header.target,
        applyMask,
      );
    }
  }
  return masked;
}

/**
 * Masks every data leaf whose key is not in `allow`. The root keeps its
 * scalar envelope fields, and a cause keeps its structural envelope keys.
 */
export function allowListRedaction(
  log: Record<string, unknown>,
  allow: ReadonlySet<string>,
  applyMask: MaskApplier,
): Record<string, unknown> {
  return redactionWalk(
    log,
    (key, value, region, leaf) => {
      if (!leaf) return RECURSE;
      // Leaf. Keep iff the region permits this key. The root writes its
      // cause slot without a cause too, and an absent cause is no data.
      const kept =
        (region === "root" &&
          (ROOT_ENVELOPE_LEAF_KEYS.has(key) ||
            (key === "cause" && value == null))) ||
        allow.has(key) ||
        (region === "cause" && ENVELOPE_KEYS.has(key));
      return kept ? value : applyMask(value, key);
    },
    "root",
  ) as Record<string, unknown>;
}

/**
 * Single deep-clone walk for redaction over plain data.
 *
 * `decide(key, value, region, leaf)` can replace a field before inspection.
 * `RECURSE` requests classification. For a leaf, the decision runs again
 * with `leaf: true`; `RECURSE` then keeps the value unchanged. Array elements
 * are classified first and only leaves reach the decision.
 *
 * `region` classifies where we are, so the allow-list can distinguish the
 * structural envelope from data:
 * - `"root"`: the top-level error envelope (kept verbatim by the allow-list);
 * - `"cause"`: at a `cause`'s top level; the structural envelope keys
 *   (`ENVELOPE_KEYS`) are kept, all other leaves are data;
 * - `"data"`: inside a `details` subtree or a cause's foreign subtree; every
 *   leaf is data.
 *
 * The transition is by key name only, not duck-typing, so a cause that
 * merely resembles a structured error cannot reclassify its data as envelope.
 * The deny-list ignores `region`. A serializer marker in a `cause` slot or in
 * a list of aggregate members stays readable (see `isCauseSpineMarker`).
 */
function redactionWalk(
  value: object,
  decide: RedactionDecision,
  region: LogRegion,
  headers?: RedactionStackHeader[],
  key = "",
): unknown {
  if (Array.isArray(value)) {
    const items: unknown[] = [];
    for (const item of value) {
      if (item !== null && typeof item === "object") {
        items.push(redactionWalk(item, decide, region, headers, key));
        continue;
      }
      // A leaf inside an array has no key of its own. So the walk judges it
      // under the key of the array that holds it, in every region. Without
      // this rule, an allow-list keeps every scalar element, which is the
      // opposite of what it promises. An aggregate's members are arbitrary
      // values (a `Promise.allSettled` reason need not be an `Error`).
      // `errors` is not an envelope key, so a string member is data like any
      // other.
      const decision =
        region === "cause" && isCauseSpineMarker(item)
          ? RECURSE
          : decide(key, item, region, true);
      items.push(decision === RECURSE ? item : decision);
    }
    return items;
  }
  // Null-prototype target, so an own `__proto__`/`constructor` key from
  // untrusted details is copied as ordinary data (and masked/recursed like
  // any other key). Such a key does not route through a prototype setter.
  // Matches the null-prototype clones used by the public-error catalog and
  // transport stage. (OWASP Prototype Pollution Prevention.)
  const out = Object.create(null) as Record<string, unknown>;
  const header: RedactionStackHeader | undefined =
    region !== "data" && headers !== undefined ? { target: out } : undefined;
  if (header !== undefined) headers?.push(header);
  for (const [field, val] of Object.entries(value)) {
    if (
      header !== undefined &&
      (field === "name" || field === "message" || field === "stack")
    ) {
      header[field] = val;
    }
    if (region !== "data" && field === "cause" && isCauseSpineMarker(val)) {
      out[field] = val;
      continue;
    }
    // A leaf's keep/mask decision is made in the region it *lives in* (the
    // parent); the child region only governs recursion. Conflating the two
    // wrongly masks a region-transition key that holds a leaf (e.g. a
    // top-level `cause: undefined`).
    const decision = decide(field, val, region, false);
    if (decision !== RECURSE) {
      out[field] = decision;
    } else if (val !== null && typeof val === "object") {
      out[field] = redactionWalk(
        val,
        decide,
        childRegion(region, field, val),
        headers,
        field,
      );
    } else {
      const leafDecision = decide(field, val, region, true);
      out[field] = leafDecision === RECURSE ? val : leafDecision;
    }
  }
  return out;
}

/**
 * The `stack` of one node whose name or message is deny-listed. The node's
 * own header is `name: message`, or the bare `name` that V8 writes for an
 * empty message. If the stack starts with that header, the function rebuilds
 * it from the masked fields, and the frames after it stay. Any other stack
 * goes to the mask as a whole, under the key `stack`. The library cannot
 * prove that the denied text is absent from such a stack. A foreign error can
 * carry a header from an earlier name or message, and some engines write no
 * header at all.
 */
function maskStackHeader(
  stack: string,
  name: unknown,
  message: unknown,
  masked: Record<string, unknown>,
  applyMask: MaskApplier,
): unknown {
  if (typeof name === "string" && typeof message === "string") {
    const headers =
      message === "" ? [`${name}: `, name] : [`${name}: ${message}`];
    for (const header of headers) {
      if (stack === header || stack.startsWith(`${header}\n`)) {
        try {
          return `${String(masked.name)}: ${String(masked.message)}${stack.slice(header.length)}`;
        } catch {
          // A custom mask can return a value that cannot render as text.
          return "[REDACTED]";
        }
      }
    }
  }
  return applyMask(stack, "stack");
}
