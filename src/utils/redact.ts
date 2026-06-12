import type { RedactMask } from "../errors/BaseError.js";

/**
 * Builds a {@link RedactMask} that reveals a prefix and/or suffix of a string
 * value and masks the middle (e.g. to show *which* API key it was without
 * exposing it, as in `sk_live…AbCd`).
 *
 * Safe by construction:
 * - a value too short to safely reveal (`length <= keepStart + keepEnd`) is
 *   masked **entirely**, never partially exposed;
 * - non-string values are masked entirely.
 *
 * @param options - `keepStart` (default 0), `keepEnd` (default 4), `fill`
 *   (default `"…"`, also used as the full mask for short/non-string values).
 *
 * @example
 * ```ts
 * err.redact(["apiKey"], { mask: partialMask({ keepStart: 7, keepEnd: 4 }) });
 * // "sk_live_51HxYz...AbCd" -> "sk_live…AbCd"
 * ```
 */
export function partialMask(options?: {
  keepStart?: number;
  keepEnd?: number;
  fill?: string;
}): RedactMask {
  const keepStart = options?.keepStart ?? 0;
  const keepEnd = options?.keepEnd ?? 4;
  const fill = options?.fill ?? "…";

  return (value) => {
    // Non-strings, and strings too short to safely reveal, are masked entirely.
    if (typeof value !== "string" || value.length <= keepStart + keepEnd) {
      return fill;
    }
    const start = value.slice(0, keepStart);
    // Use length - keepEnd (not slice(-keepEnd)) to avoid the keepEnd === 0
    // `-0` trap, which would otherwise reveal the whole string.
    const end = value.slice(value.length - keepEnd);
    return start + fill + end;
  };
}
