/**
 * Minimal mirrors of the stable UserPlatform HTTP contract (frozen 18f37a5).
 * Local copies (strategy D): no `@user-platform/*` dependency, no
 * sibling-filesystem imports. Mock-parity tests catch drift.
 */

export type HostPlatformName = "telegram" | "max";

export interface PlatformExchangeInput {
  platform: HostPlatformName;
  initData: string;
  startParam?: string;
}

export interface PlatformBalance {
  available: number;
  reserved: number;
}

export interface PlatformExchangeResult {
  userId: string;
  userStatus: string;
  isNewUser: boolean;
  availableBalance: number;
  appSlug: string;
  /** Raw opaque app session — server memory / HttpOnly cookie ONLY. Never JSON to browser. */
  sessionToken: string;
  sessionExpiresAt: string;
}

export interface PlatformMe {
  userId: string;
  userStatus: string;
  availableBalance: number;
  reservedBalance: number;
}

export interface PlatformReservation {
  reservationId: string;
  requestId: string;
  operation: string;
  amount: number;
  status: "reserved" | "committed" | "released";
  availableBalance: number;
  reservedBalance: number;
}

export interface PlatformMutation {
  reservation: PlatformReservation;
  reused: boolean;
}

export type PlatformErrorCode =
  | "INSUFFICIENT_CREDITS"
  | "SESSION_EXPIRED"
  | "SESSION_FORBIDDEN"
  | "SERVICE_UNAUTHORIZED"
  | "INVALID_PLATFORM_DATA"
  | "PLATFORM_DATA_EXPIRED"
  | "NOT_FOUND"
  | "RESERVATION_CONFLICT"
  | "PLATFORM_UNAVAILABLE"
  | "UNKNOWN";
