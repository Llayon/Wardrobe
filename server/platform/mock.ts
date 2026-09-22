import { createHash, randomUUID } from "node:crypto";
import { PlatformError, platformUnavailable } from "./errors.js";
import type { IPlatformClient } from "./client.js";
import type {
  HostPlatformName,
  PlatformExchangeInput,
  PlatformExchangeResult,
  PlatformMe,
  PlatformMutation,
} from "./types.js";

/**
 * Deterministic in-memory UserPlatform fake (tests/E2E only, never production).
 *
 * One MOCK INSTANCE models one service credential (one app). Instances share
 * a backing store to model the real shared platform: same initData on any
 * instance yields the same user (shared account, one wallet), while authority
 * (SERVICE APP == SESSION APP == OPERATION APP) is enforced per call —
 * exactly the cross-app red-team surface.
 */

export type MockAppSlug = "wardrobe" | "fridge";

const OPERATION_APP: Record<string, { app: MockAppSlug; cost: number }> = {
  "wardrobe.scan": { app: "wardrobe", cost: 1 },
  "wardrobe.outfit": { app: "wardrobe", cost: 1 },
  "fridge.scan": { app: "fridge", cost: 1 },
  "fridge.recipe": { app: "fridge", cost: 0 },
};

interface MockReservation {
  reservationId: string;
  requestId: string;
  operation: string;
  amount: number;
  status: "reserved" | "committed" | "released";
  appSlug: MockAppSlug;
}

export interface MockPlatformStore {
  wallets: Map<string, { available: number; reserved: number }>;
  sessions: Map<string, { userId: string; appSlug: MockAppSlug }>;
  reservations: Map<string, MockReservation>;
  byRequest: Map<string, MockReservation>;
}

export function createMockPlatformStore(): MockPlatformStore {
  return { wallets: new Map(), sessions: new Map(), reservations: new Map(), byRequest: new Map() };
}

export interface MockPlatformOptions {
  store?: MockPlatformStore;
  /** Which app this credential belongs to (default: wardrobe). */
  appSlug?: MockAppSlug;
  initialBalance?: number;
  exchangeFail?: boolean;
  commitTimeouts?: number;
  releaseTimeouts?: number;
}

export class MockPlatformClient implements IPlatformClient {
  private readonly store: MockPlatformStore;
  private readonly appSlug: MockAppSlug;
  private commitTimeouts: number;
  private releaseTimeouts: number;
  private exchangeFail: boolean;
  private initialBalance: number;

  constructor(opts: MockPlatformOptions = {}) {
    this.store = opts.store ?? createMockPlatformStore();
    this.appSlug = opts.appSlug ?? "wardrobe";
    this.initialBalance = opts.initialBalance ?? 10;
    this.exchangeFail = opts.exchangeFail ?? false;
    this.commitTimeouts = opts.commitTimeouts ?? 0;
    this.releaseTimeouts = opts.releaseTimeouts ?? 0;
  }

  /** Test hook: balances for assertions. */
  balanceOf(userId: string): { available: number; reserved: number } {
    return this.store.wallets.get(userId) ?? { available: 0, reserved: 0 };
  }

  /** Test/E2E hook: tune future behavior. */
  configure(opts: Partial<MockPlatformOptions> & { reset?: boolean }): void {
    if (opts.reset) {
      this.store.wallets.clear();
      this.store.sessions.clear();
      this.store.reservations.clear();
      this.store.byRequest.clear();
    }
    if (opts.initialBalance !== undefined) this.initialBalance = opts.initialBalance;
    if (opts.exchangeFail !== undefined) this.exchangeFail = opts.exchangeFail;
    if (opts.commitTimeouts !== undefined) this.commitTimeouts = opts.commitTimeouts;
    if (opts.releaseTimeouts !== undefined) this.releaseTimeouts = opts.releaseTimeouts;
  }

  private userIdFor(platform: HostPlatformName, key: string): string {
    // Deterministic UUID-shaped identity (mirrors real UUID user IDs so
    // downstream UUID-shape guards, like storage paths, behave identically).
    const hex = createHash("sha256").update(`mock:${platform}:${key}`).digest("hex");
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
  }

  private ensureWallet(userId: string): { available: number; reserved: number } {
    let w = this.store.wallets.get(userId);
    if (!w) {
      w = { available: this.initialBalance, reserved: 0 };
      this.store.wallets.set(userId, w);
    }
    return w;
  }

  async exchangePlatform(input: PlatformExchangeInput): Promise<PlatformExchangeResult> {
    if (this.exchangeFail) throw platformUnavailable();
    if (!input.initData) {
      throw new PlatformError(400, "INVALID_PLATFORM_DATA", "Invalid platform data");
    }
    const userId = this.userIdFor(input.platform, input.initData);
    const isNew = !this.store.wallets.has(userId);
    const wallet = this.ensureWallet(userId);
    const sessionToken = `mock-session-${randomUUID()}`;
    this.store.sessions.set(sessionToken, { userId, appSlug: this.appSlug });
    return {
      userId,
      userStatus: "active",
      isNewUser: isNew,
      availableBalance: wallet.available,
      appSlug: this.appSlug,
      sessionToken,
      sessionExpiresAt: new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString(),
    };
  }

  /** Dev/E2E persona exchange (never production). */
  async exchangeDev(persona: string): Promise<PlatformExchangeResult> {
    return this.exchangePlatform({ platform: "telegram", initData: `dev:${persona}` });
  }

  private requireSession(sessionToken: string): { userId: string; appSlug: MockAppSlug } {
    const session = this.store.sessions.get(sessionToken);
    if (!session) throw new PlatformError(401, "SESSION_EXPIRED", "Session expired");
    return session;
  }

  async getMe(sessionToken: string): Promise<PlatformMe> {
    const { userId } = this.requireSession(sessionToken);
    const w = this.ensureWallet(userId);
    return {
      userId,
      userStatus: "active",
      availableBalance: w.available,
      reservedBalance: w.reserved,
    };
  }

  async reserve(
    sessionToken: string,
    input: { operation: string; requestId: string },
  ): Promise<PlatformMutation> {
    const session = this.requireSession(sessionToken);
    const op = OPERATION_APP[input.operation];
    if (!op) throw new PlatformError(404, "NOT_FOUND", "Unknown operation");
    // SERVICE APP == SESSION APP == OPERATION APP (registry is authoritative).
    if (op.app !== this.appSlug || session.appSlug !== this.appSlug) {
      throw new PlatformError(
        403,
        "SESSION_FORBIDDEN",
        "Operation does not belong to this application",
      );
    }
    const key = `${session.userId}:${input.requestId}`;
    const seen = this.store.byRequest.get(key);
    const wallet = this.ensureWallet(session.userId);
    if (seen) return { reservation: this.view(seen, wallet), reused: true };
    if (wallet.available < op.cost) {
      throw new PlatformError(402, "INSUFFICIENT_CREDITS", "Insufficient credits");
    }
    wallet.available -= op.cost;
    wallet.reserved += op.cost;
    const r: MockReservation = {
      reservationId: randomUUID(),
      requestId: input.requestId,
      operation: input.operation,
      amount: op.cost,
      status: "reserved",
      appSlug: this.appSlug,
    };
    this.store.reservations.set(r.reservationId, r);
    this.store.byRequest.set(key, r);
    return { reservation: this.view(r, wallet), reused: false };
  }

  async commit(sessionToken: string, reservationId: string): Promise<PlatformMutation> {
    if (this.commitTimeouts > 0) {
      this.commitTimeouts -= 1;
      throw platformUnavailable("Commit acknowledgement lost");
    }
    const session = this.requireSession(sessionToken);
    const r = this.store.reservations.get(reservationId);
    const wallet = this.ensureWallet(session.userId);
    if (!r) throw new PlatformError(404, "NOT_FOUND", "Reservation not found");
    // Reservation ownership by application: foreign-app IDs are forbidden.
    if (r.appSlug !== this.appSlug) {
      throw new PlatformError(
        403,
        "SESSION_FORBIDDEN",
        "Reservation does not belong to this application",
      );
    }
    if (r.status === "committed") return { reservation: this.view(r, wallet), reused: true };
    if (r.status !== "reserved") {
      throw new PlatformError(409, "RESERVATION_CONFLICT", "Cannot commit released reservation");
    }
    r.status = "committed";
    wallet.reserved -= r.amount;
    return { reservation: this.view(r, wallet), reused: false };
  }

  async release(sessionToken: string, reservationId: string): Promise<PlatformMutation> {
    if (this.releaseTimeouts > 0) {
      this.releaseTimeouts -= 1;
      throw platformUnavailable("Release acknowledgement lost");
    }
    const session = this.requireSession(sessionToken);
    const r = this.store.reservations.get(reservationId);
    const wallet = this.ensureWallet(session.userId);
    if (!r) throw new PlatformError(404, "NOT_FOUND", "Reservation not found");
    if (r.appSlug !== this.appSlug) {
      throw new PlatformError(
        403,
        "SESSION_FORBIDDEN",
        "Reservation does not belong to this application",
      );
    }
    if (r.status === "released") return { reservation: this.view(r, wallet), reused: true };
    if (r.status !== "reserved") {
      throw new PlatformError(409, "RESERVATION_CONFLICT", "Cannot release committed reservation");
    }
    r.status = "released";
    wallet.available += r.amount;
    wallet.reserved -= r.amount;
    return { reservation: this.view(r, wallet), reused: false };
  }

  async revokeSession(sessionToken: string): Promise<void> {
    this.store.sessions.delete(sessionToken);
  }

  private view(
    r: MockReservation,
    wallet: { available: number; reserved: number },
  ): PlatformMutation["reservation"] {
    return {
      reservationId: r.reservationId,
      requestId: r.requestId,
      operation: r.operation,
      amount: r.amount,
      status: r.status,
      availableBalance: wallet.available,
      reservedBalance: wallet.reserved,
    };
  }
}
