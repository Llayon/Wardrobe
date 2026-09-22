/**
 * @vitest-environment node
 */
import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from "vitest";
import request from "supertest";
import { randomUUID } from "node:crypto";
import sharp from "sharp";
import { app } from "../app.js";
import {
  MemoryRateLimitStore,
  __resetRateLimitStoreForTests,
  __setRateLimitStoreForTests,
} from "../rateLimit.js";
import { WardrobeVisionChain } from "../vision/router.js";
import { MockPlatformClient } from "../platform/mock.js";
import { __clearSettlementForTests } from "../platform/settlement.js";
import { createMemoryStore, __setWardrobeStoreForTests } from "../store/items.js";
import { __resetPlatformMockForTests, __setPlatformClientForTests } from "./platform.js";

const ORIGINAL_FLAG = process.env.PLATFORM_INTEGRATION_ENABLED;
const ORIGINAL_MOCK = process.env.MOCK_MODE;

function makeImage(seed: number, size = 2000): string {
  return Buffer.alloc(size, seed % 256).toString("base64");
}

/** Real decodable source for confirm/thumbnail paths. */
async function makeRealImage(): Promise<string> {
  const buf = await sharp({
    create: { width: 800, height: 600, channels: 3, background: { r: 90, g: 120, b: 160 } },
  })
    .jpeg({ quality: 80 })
    .toBuffer();
  return buf.toString("base64");
}

let mock: MockPlatformClient;

beforeEach(() => {
  process.env.PLATFORM_INTEGRATION_ENABLED = "true";
  process.env.MOCK_MODE = "true";
  __setRateLimitStoreForTests(new MemoryRateLimitStore());
  __setWardrobeStoreForTests(createMemoryStore());
  __clearSettlementForTests();
  mock = new MockPlatformClient();
  __setPlatformClientForTests(mock);
});

afterEach(() => {
  __resetPlatformMockForTests();
  __resetRateLimitStoreForTests();
  __setWardrobeStoreForTests(createMemoryStore());
  vi.restoreAllMocks();
});

afterAll(() => {
  if (ORIGINAL_FLAG === undefined) delete process.env.PLATFORM_INTEGRATION_ENABLED;
  else process.env.PLATFORM_INTEGRATION_ENABLED = ORIGINAL_FLAG;
  if (ORIGINAL_MOCK === undefined) delete process.env.MOCK_MODE;
  else process.env.MOCK_MODE = ORIGINAL_MOCK;
  __resetPlatformMockForTests();
});

async function authedAgent(persona: string) {
  const agent = request.agent(app);
  const ex = await agent.post("/api/platform/dev/exchange").send({ persona });
  expect(ex.status).toBe(200);
  return agent;
}

const SELECTIONS = [
  {
    canonicalName: "black_jeans",
    displayName: "Чёрные джинсы",
    category: "bottom",
    colors: ["black"],
    season: "all",
  },
  {
    canonicalName: "white_tshirt",
    displayName: "Белая футболка",
    category: "top",
    colors: ["white"],
    season: "summer",
  },
];

describe("credit-aware item scans (authenticated)", () => {
  it("new scan charges exactly 1 with authoritative balance", async () => {
    const agent = await authedAgent("it-1");
    const res = await agent.post("/api/items/scan").send({
      imageBase64: makeImage(11),
      mimeType: "image/jpeg",
      requestId: randomUUID(),
    });
    expect(res.status).toBe(200);
    expect(res.body.meta.charged).toBe(true);
    expect(res.body.meta.balance).toEqual({ available: 9, reserved: 0 });
    expect(res.body.data.items.length).toBeGreaterThan(0);
  });

  it("same requestId ×3 → one charge", async () => {
    const agent = await authedAgent("it-2");
    const id = randomUUID();
    for (let i = 0; i < 3; i++) {
      const res = await agent.post("/api/items/scan").send({
        imageBase64: makeImage(12),
        mimeType: "image/jpeg",
        requestId: id,
      });
      expect(res.status).toBe(200);
      expect(res.body.meta.balance.available).toBe(9);
    }
  });

  it("missing requestId in auth mode → 400", async () => {
    const agent = await authedAgent("it-3");
    const res = await agent
      .post("/api/items/scan")
      .send({ imageBase64: makeImage(13), mimeType: "image/jpeg" });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("MISSING_REQUEST_ID");
  });

  it("zero balance → 402 with zero AI calls", async () => {
    __setPlatformClientForTests(new MockPlatformClient({ initialBalance: 0 }));
    const agent = await authedAgent("it-4");
    const spy = vi.spyOn(WardrobeVisionChain.prototype, "analyze");
    const res = await agent.post("/api/items/scan").send({
      imageBase64: makeImage(14),
      mimeType: "image/jpeg",
      requestId: randomUUID(),
    });
    expect(res.status).toBe(402);
    expect(res.body.code).toBe("INSUFFICIENT_CREDITS");
    expect(spy).not.toHaveBeenCalled();
  });

  it("AI failure releases → balance whole", async () => {
    const agent = await authedAgent("it-5");
    vi.spyOn(WardrobeVisionChain.prototype, "analyze").mockRejectedValueOnce(
      new Error("Groq 503 overloaded"),
    );
    const res = await agent.post("/api/items/scan").send({
      imageBase64: makeImage(15),
      mimeType: "image/jpeg",
      requestId: randomUUID(),
    });
    expect(res.status).toBe(429);
    const me = await agent.get("/api/platform/me");
    expect(me.body.balance).toEqual({ available: 10, reserved: 0 });
  });

  it("commit timeout → COMMIT_UNCERTAIN; retry reuses one AI result, one charge", async () => {
    const flaky = new MockPlatformClient({ commitTimeouts: 1 });
    __setPlatformClientForTests(flaky);
    const agent = await authedAgent("it-6");
    const spy = vi.spyOn(WardrobeVisionChain.prototype, "analyze");
    const id = randomUUID();
    const body = { imageBase64: makeImage(16), mimeType: "image/jpeg", requestId: id };
    const first = await agent.post("/api/items/scan").send(body);
    expect(first.status).toBe(503);
    expect(first.body.code).toBe("COMMIT_UNCERTAIN");
    const retry = await agent.post("/api/items/scan").send(body);
    expect(retry.status).toBe(200);
    expect(retry.body.meta.balance.available).toBe(9);
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("balance 1 + 10 parallel unique scans → exactly one reserve", async () => {
    __setPlatformClientForTests(new MockPlatformClient({ initialBalance: 1 }));
    const agent = await authedAgent("it-7");
    const results = await Promise.all(
      Array.from({ length: 10 }, (_, i) =>
        agent.post("/api/items/scan").send({
          imageBase64: makeImage(100 + i, 2000 + i),
          mimeType: "image/jpeg",
          requestId: randomUUID(),
        }),
      ),
    );
    expect(results.filter((r) => r.status === 200)).toHaveLength(1);
    expect(results.filter((r) => r.status === 402)).toHaveLength(9);
  });

  it("smuggled operation is inert (route hardcodes wardrobe.scan)", async () => {
    const agent = await authedAgent("it-8");
    const res = await agent.post("/api/items/scan").send({
      imageBase64: makeImage(17),
      mimeType: "image/jpeg",
      requestId: randomUUID(),
      operation: "fridge.scan",
      userId: "attacker",
    });
    expect(res.status).toBe(200);
    expect(res.body.meta.balance.available).toBe(9);
  });

  it("oversized image costs 0 (413 before reserve)", async () => {
    const agent = await authedAgent("it-9");
    const big = Buffer.alloc(400 * 1024, 0x02).toString("base64");
    const res = await agent
      .post("/api/items/scan")
      .send({ imageBase64: big, mimeType: "image/jpeg", requestId: randomUUID() });
    expect(res.status).toBe(413);
    expect((await agent.get("/api/platform/me")).body.balance.available).toBe(10);
  });

  it("forged cookie never downgrades to anonymous AI", async () => {
    const spy = vi.spyOn(WardrobeVisionChain.prototype, "analyze");
    const res = await request(app)
      .post("/api/items/scan")
      .set("Cookie", "wardrobe_session=forged-value-1234567890")
      .send({ imageBase64: makeImage(18), mimeType: "image/jpeg", requestId: randomUUID() });
    expect(res.status).toBe(401);
    expect(spy).not.toHaveBeenCalled();
  });

  it("anonymous scan works (legacy, no balance meta)", async () => {
    const res = await request(app)
      .post("/api/items/scan")
      .send({ imageBase64: makeImage(19), mimeType: "image/jpeg" });
    expect(res.status).toBe(200);
    expect(res.body.meta.charged).toBe(false);
    expect(res.body.meta.balance).toBeUndefined();
  });
});

describe("confirm + grid + ownership (authenticated persistence)", () => {
  async function scanAndConfirm(persona: string, requestId: string, image?: string) {
    const agent = await authedAgent(persona);
    const src = image ?? (await makeRealImage());
    const scan = await agent.post("/api/items/scan").send({
      imageBase64: makeImage(50),
      mimeType: "image/jpeg",
      requestId,
    });
    expect(scan.status).toBe(200);
    const confirm = await agent.post("/api/items/confirm").send({
      requestId,
      imageBase64: src,
      selections: SELECTIONS,
    });
    return { agent, confirm };
  }

  it("confirm persists items + thumbnails; reconfirm is idempotent", async () => {
    const id = randomUUID();
    const { agent, confirm } = await scanAndConfirm("cf-1", id);
    expect(confirm.status).toBe(200);
    expect(confirm.body.items).toHaveLength(2);
    expect(confirm.body.items[0].thumbnail.byteSize).toBeGreaterThan(0);

    const again = await agent.post("/api/items/confirm").send({
      requestId: id,
      imageBase64: await makeRealImage(),
      selections: SELECTIONS,
    });
    expect(again.status).toBe(200);
    expect(again.body.items).toHaveLength(0);

    const grid = await agent.get("/api/items");
    expect(grid.status).toBe(200);
    expect(grid.body.items).toHaveLength(2);
    // Grid carries metadata only, never bulk bytes.
    expect(JSON.stringify(grid.body).length).toBeLessThan(20000);
  });

  it("confirm without scan → 409, balance untouched", async () => {
    const agent = await authedAgent("cf-2");
    const res = await agent.post("/api/items/confirm").send({
      requestId: randomUUID(),
      imageBase64: await makeRealImage(),
      selections: SELECTIONS,
    });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe("SCAN_NOT_FOUND");
    expect((await agent.get("/api/platform/me")).body.balance.available).toBe(10);
  });

  it("confirm requires auth even for anonymous scanners", async () => {
    const scan = await request(app)
      .post("/api/items/scan")
      .send({ imageBase64: makeImage(51), mimeType: "image/jpeg" });
    expect(scan.status).toBe(200);
    const res = await request(app)
      .post("/api/items/confirm")
      .send({
        requestId: randomUUID(),
        imageBase64: await makeRealImage(),
        selections: SELECTIONS,
      });
    expect(res.status).toBe(401);
  });

  it("cross-user IDOR: foreign items invisible, undeletable, image 404", async () => {
    const id = randomUUID();
    const { agent } = await scanAndConfirm("cf-3a", id);
    const grid = await agent.get("/api/items");
    const victimId = grid.body.items[0].id as string;

    const other = await authedAgent("cf-3b");
    expect((await other.get("/api/items")).body.items).toHaveLength(0);
    expect(await other.delete(`/api/items/${victimId}`)).toMatchObject({ status: 404 });
    expect(await other.get(`/api/items/${victimId}/image`)).toMatchObject({ status: 404 });

    // Owner reads bytes + deletes (cascades).
    const img = await agent.get(`/api/items/${victimId}/image`);
    expect(img.status).toBe(200);
    expect(img.headers["content-type"]).toMatch(/image\/webp/);
    expect(await agent.delete(`/api/items/${victimId}`)).toMatchObject({ status: 204 });
    expect(await agent.get(`/api/items/${victimId}/image`)).toMatchObject({ status: 404 });
  });

  it("grid paginates (limit respected, newest first)", async () => {
    const agent = await authedAgent("cf-4");
    for (const n of ["ga", "gb", "gc"]) {
      const id = randomUUID();
      await agent
        .post("/api/items/scan")
        .send({ imageBase64: makeImage(60 + n.length), mimeType: "image/jpeg", requestId: id });
      const c = await agent.post("/api/items/confirm").send({
        requestId: id,
        imageBase64: await makeRealImage(),
        selections: [SELECTIONS[0]],
      });
      expect(c.status).toBe(200);
    }
    const limited = await agent.get("/api/items?limit=2");
    expect(limited.body.items).toHaveLength(2);
    const all = await agent.get("/api/items?limit=50");
    expect(all.body.items).toHaveLength(3);
  });
});

describe("authenticated abuse caps (separate namespace)", () => {
  it("exhausted anonymous quota does not block credit holders", async () => {
    const device = "w-quota-device-1";
    for (let i = 0; i < 5; i++) {
      const r = await request(app)
        .post("/api/items/scan")
        .set("X-Wardrobe-Device-Id", device)
        .send({ imageBase64: makeImage(200 + i, 2000 + i), mimeType: "image/jpeg" });
      expect(r.status).toBe(200);
    }
    const blocked = await request(app)
      .post("/api/items/scan")
      .set("X-Wardrobe-Device-Id", device)
      .send({ imageBase64: makeImage(299, 2999), mimeType: "image/jpeg" });
    expect(blocked.status).toBe(429);

    const agent = await authedAgent("cf-5");
    const ok = await agent.post("/api/items/scan").send({
      imageBase64: makeImage(300, 3000),
      mimeType: "image/jpeg",
      requestId: randomUUID(),
    });
    expect(ok.status).toBe(200);
  });
});
