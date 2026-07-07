/** Per-batch cache: sessionId -> latest open deposit item id (or null). */
export type DepositItemCache = Map<string, string | null>;

export function createDepositItemCache(): DepositItemCache {
  return new Map();
}
