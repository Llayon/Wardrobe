/**
 * @vitest-environment node
 */
import { describe, it, expect } from "vitest";
import { PlatformClient } from "./client.js";
import { MockPlatformClient, createMockPlatformStore } from "./mock.js";
import { PlatformError } from "./errors.js";
import { buildClearedCookie, buildSessionCookie, readSessionCookie } from "./cookies.js";

describe("MockPlatformClient (wardrobe parity + cross-app)", () => {
  it("stable identity, namespaces split, welcome 10", async () => {
    const mock = new MockPlatformClient();
    const a = await mock.exchangePlatform({ platform: "telegram", initData: "p1" });
    expect(a.appSlug).toBe("wardrobe");
    expect(a.availableBalance).toBe(10);
    const b = await mock.exchangePlatform({ platform: "telegram", initData: "p1" });
    expect(b.userId).toBe(a.userId);
    expect(b.isNewUser).toBe(false);
    const mx = await mock.exchangePlatform({ platform: "max", initData: "p1" });
    expect(mx.userId).not.toBe(a.userId);
  });

  it("reserve → commit charges 1; same requestId is idempotent", async () => {
    const mock = new MockPlatformClient();
    const ex = await mock.exchangePlatform({ platform: "telegram", initData: "u" });
    const r1 = await mock.reserve(ex.sessionToken, {
      operation: "wardrobe.scan",
      requestId: "wardrobe.scan:1",
    });
    expect(r1.reservation.availableBalance).toBe(9);
    const r2 = await mock.reserve(ex.sessionToken, {
      operation: "wardrobe.scan",
      requestId: "wardrobe.scan:1",
    });
    expect(r2.reused).toBe(true);
    await mock.commit(ex.sessionToken, r1.reservation.reservationId);
    expect(mock.balanceOf(ex.userId)).toEqual({ available: 9, reserved: 0 });
  });

  it("CROSS-APP: fridge credential + wardrobe session cannot spend wardrobe ops", async () => {
    const store = createMockPlatformStore();
    const wardrobe = new MockPlatformClient({ store, appSlug: "wardrobe" });
    const fridge = new MockPlatformClient({ store, appSlug: "fridge" });
    // Same underlying user on both apps (shared account, one wallet).
    const wSess = await wardrobe.exchangePlatform({ platform: "telegram", initData: "shared" });
    const fSess = await fridge.exchangePlatform({ platform: "telegram", initData: "shared" });
    expect(wSess.userId).toBe(fSess.userId);

    // Fridge credential spending wardrobe.outfit with a wardrobe session → 403.
    await expect(
      fridge.reserve(wSess.sessionToken, {
        operation: "wardrobe.outfit",
        requestId: "wardrobe.scan:x1",
      }),
    ).rejects.toMatchObject({ status: 403 });

    // Wardrobe credential with a fridge session → 403 (session/service mismatch).
    await expect(
      wardrobe.reserve(fSess.sessionToken, {
        operation: "wardrobe.outfit",
        requestId: "wardrobe.scan:x2",
      }),
    ).rejects.toMatchObject({ status: 403 });

    // Fridge credential spending its own op with its own session → allowed.
    const ok = await fridge.reserve(fSess.sessionToken, {
      operation: "fridge.scan",
      requestId: "fridge.scan:x3",
    });
    expect(ok.reservation.status).toBe("reserved");
  });

  it("CROSS-APP: wardrobe credential cannot commit a fridge reservation", async () => {
    const store = createMockPlatformStore();
    const wardrobe = new MockPlatformClient({ store, appSlug: "wardrobe" });
    const fridge = new MockPlatformClient({ store, appSlug: "fridge" });
    const wSess = await wardrobe.exchangePlatform({ platform: "telegram", initData: "u2" });
    const fSess = await fridge.exchangePlatform({ platform: "telegram", initData: "u2" });
    const r = await fridge.reserve(fSess.sessionToken, {
      operation: "fridge.scan",
      requestId: "fridge.scan:r1",
    });
    await expect(
      wardrobe.commit(wSess.sessionToken, r.reservation.reservationId),
    ).rejects.toMatchObject({ status: 403 });
    await expect(
      wardrobe.release(wSess.sessionToken, r.reservation.reservationId),
    ).rejects.toMatchObject({ status: 403 });
    // Owner still settles.
    expect(
      (await fridge.commit(fSess.sessionToken, r.reservation.reservationId)).reservation.status,
    ).toBe("committed");
  });

  it("insufficient → 402 with zero movement; release refunds; timeouts honored", async () => {
    const poor = new MockPlatformClient({ initialBalance: 0 });
    const ex = await poor.exchangePlatform({ platform: "telegram", initData: "poor" });
    await expect(
      poor.reserve(ex.sessionToken, { operation: "wardrobe.scan", requestId: "wardrobe.scan:p" }),
    ).rejects.toMatchObject({ code: "INSUFFICIENT_CREDITS" });

    const flaky = new MockPlatformClient({ commitTimeouts: 1 });
    const fx = await flaky.exchangePlatform({ platform: "telegram", initData: "fl" });
    const r = await flaky.reserve(fx.sessionToken, {
      operation: "wardrobe.scan",
      requestId: "wardrobe.scan:f",
    });
    await expect(flaky.commit(fx.sessionToken, r.reservation.reservationId)).rejects.toMatchObject({
      code: "PLATFORM_UNAVAILABLE",
    });
    await flaky.commit(fx.sessionToken, r.reservation.reservationId);
    expect(flaky.balanceOf(fx.userId)).toEqual({ available: 9, reserved: 0 });
  });

  it("unknown session → 401; revoked → 401; unknown op → 404", async () => {
    const mock = new MockPlatformClient();
    await expect(mock.getMe("nope")).rejects.toMatchObject({ status: 401 });
    const ex = await mock.exchangePlatform({ platform: "telegram", initData: "rv" });
    await mock.revokeSession(ex.sessionToken);
    await expect(mock.getMe(ex.sessionToken)).rejects.toMatchObject({ status: 401 });
    const ex2 = await mock.exchangePlatform({ platform: "telegram", initData: "rv2" });
    await expect(
      mock.reserve(ex2.sessionToken, { operation: "nope.nope", requestId: "wardrobe.scan:z" }),
    ).rejects.toMatchObject({ status: 404 });
  });
});

describe("PlatformClient (typed errors via stubbed fetch)", () => {
  const stubFetch = (status: number, body: unknown): typeof fetch =>
    (async () =>
      new Response(JSON.stringify(body), {
        status,
        headers: { "Content-Type": "application/json" },
      })) as typeof fetch;

  it("missing service token fails closed before network", async () => {
    const client = new PlatformClient({ baseUrl: "https://x", getServiceToken: () => undefined });
    await expect(
      client.reserve("sess", { operation: "wardrobe.scan", requestId: "wardrobe.scan:1" }),
    ).rejects.toBeInstanceOf(PlatformError);
  });

  it("402 → INSUFFICIENT_CREDITS; 5xx → PLATFORM_UNAVAILABLE", async () => {
    const poor = new PlatformClient({
      baseUrl: "https://x",
      getServiceToken: () => "tok",
      fetchImpl: stubFetch(402, { error: "No credits", code: "INSUFFICIENT_CREDITS" }),
    });
    await expect(
      poor.reserve("sess", { operation: "wardrobe.scan", requestId: "wardrobe.scan:1" }),
    ).rejects.toMatchObject({ code: "INSUFFICIENT_CREDITS" });
    const down = new PlatformClient({
      baseUrl: "https://x",
      getServiceToken: () => "tok",
      fetchImpl: stubFetch(502, { error: "bad gateway" }),
    });
    await expect(
      down.reserve("sess", { operation: "wardrobe.scan", requestId: "wardrobe.scan:1" }),
    ).rejects.toMatchObject({ code: "PLATFORM_UNAVAILABLE" });
  });
});

describe("session cookies (wardrobe_session)", () => {
  it("build → parse round-trips; cleared cookie expires immediately", () => {
    const set = buildSessionCookie("wardrobe_session", "tok-123", {
      isProduction: true,
      maxAgeSeconds: 3600,
    });
    expect(set).toContain("HttpOnly");
    expect(set).toContain("Secure");
    expect(set).toContain("SameSite=Lax");
    expect(readSessionCookie({ cookie: set.split(";")[0] }, "wardrobe_session")).toBe("tok-123");
    expect(buildClearedCookie("wardrobe_session", true)).toContain("Max-Age=0");
  });
});
