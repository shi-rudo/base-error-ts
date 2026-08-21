/**
 * Shared hostile foreign values for the totality tests. The catch paths must
 * survive whatever a caller threw; these are the standard adversaries. One
 * definition, so a guard change is pinned against the same values everywhere.
 */

/** An Error whose `key` getter throws on every read. */
export function errorWithThrowingGetter(key: string): Error {
  const error = new Error("hostile");
  Object.defineProperty(error, key, {
    get() {
      throw new Error(`${key} getter`);
    },
    configurable: true,
  });
  return error;
}

type HostileTrap = "get" | "has" | "getPrototypeOf";

/**
 * A Proxy whose listed traps throw. The default set covers every operation
 * the guards and serializers perform on a foreign value; pass a subset to pin
 * one operation.
 */
export function hostileProxy(
  traps: readonly HostileTrap[] = ["get", "has", "getPrototypeOf"],
): object {
  const handler: ProxyHandler<object> = {};
  for (const trap of traps) {
    handler[trap] = () => {
      throw new Error(`${trap} trap`);
    };
  }
  return new Proxy({}, handler);
}
