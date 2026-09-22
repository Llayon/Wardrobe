/**
 * Settlement replay + in-flight dedupe, keyed by Platform requestId.
 * Memory-only, bounded (200 entries). A restart loses replays, but
 * idempotent reserve bounds the damage to one repeated AI call — never a
 * double charge.
 */

export interface SettledScan {
  reservationId: string;
  empty: boolean;
  provider: string;
  modelId: string;
  /** Wardrobe MVP runs every action fresh (no vision cache); replays reuse. */
  cached?: boolean;
  /** Opaque successful result payload (vision candidates). */
  result: unknown;
}

const MAX_ENTRIES = 200;

const settled = new Map<string, SettledScan>();
const inFlight = new Map<string, Promise<SettledScan>>();

export function recallSettlement(key: string): SettledScan | undefined {
  return settled.get(key);
}

export function storeSettlement(key: string, scan: SettledScan): void {
  if (settled.size >= MAX_ENTRIES) {
    const first = settled.keys().next().value;
    if (first) settled.delete(first);
  }
  settled.set(key, scan);
}

export function runExclusive<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const ongoing = inFlight.get(key) as Promise<T> | undefined;
  if (ongoing) return ongoing;
  const p = fn().finally(() => {
    if (inFlight.get(key) === p) inFlight.delete(key);
  });
  inFlight.set(key, p as Promise<SettledScan>);
  return p;
}

/** Test hook: clear both maps. */
export function __clearSettlementForTests(): void {
  settled.clear();
  inFlight.clear();
}
