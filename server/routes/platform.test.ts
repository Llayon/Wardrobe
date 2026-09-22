/**
 * @vitest-environment node
 */
import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import request from "supertest";
import { app } from "../app.js";
import { MockPlatformClient } from "../platform/mock.js";
import { __resetPlatformMockForTests, __setPlatformClientForTests } from "./platform.js";

const ORIGINAL_FLAG = process.env.PLATFORM_INTEGRATION_ENABLED;

function cookieOf(res: request.Response): string {
  const raw = res.headers["set-cookie"];
  const list = Array.isArray(raw) ? raw : raw ? [raw] : [];
  return list.join(";");
}

beforeAll(() => {
  process.env.PLATFORM_INTEGRATION_ENABLED = "true";
});

afterEach(() => {
  __resetPlatformMockForTests();
  process.env.PLATFORM_INTEGRATION_ENABLED = "true";
});

afterAll(() => {
  if (ORIGINAL_FLAG === undefined) delete process.env.PLATFORM_INTEGRATION_ENABLED;
  else process.env.PLATFORM_INTEGRATION_ENABLED = ORIGINAL_FLAG;
  __resetPlatformMockForTests();
});

function injectMock(opts = {}) {
  const mock = new MockPlatformClient(opts);
  __setPlatformClientForTests(mock);
  return mock;
}

describe("platform auth bridge (integration enabled)", () => {
  it("GET /api/platform/status reports the flag", async () => {
    expect((await request(app).get("/api/platform/status")).body).toEqual({
      integrationEnabled: true,
    });
  });

  it("exchange sets wardrobe_session HttpOnly cookie, never leaks the token", async () => {
    injectMock();
    const res = await request(app)
      .post("/api/platform/exchange")
      .send({ platform: "telegram", initData: "tg-1" });
    expect(res.status).toBe(200);
    expect(res.body.authenticated).toBe(true);
    expect(res.body.balance.available).toBe(10);
    expect(res.body.appSlug).toBe("wardrobe");
    expect(res.body.sessionToken).toBeUndefined();
    expect(JSON.stringify(res.body)).not.toMatch(/sessionToken/);
    const setCookie = cookieOf(res);
    expect(setCookie).toContain("wardrobe_session=");
    expect(setCookie).toContain("HttpOnly");
  });

  it("bad payloads rejected before Platform; outage → 503 fail-closed", async () => {
    const mock = injectMock();
    let called = false;
    const orig = mock.exchangePlatform.bind(mock);
    mock.exchangePlatform = async (input) => {
      called = true;
      return orig(input);
    };
    expect(
      await request(app).post("/api/platform/exchange").send({ platform: "email", initData: "" }),
    ).toMatchObject({ status: 400 });
    expect(called).toBe(false);

    injectMock({ exchangeFail: true });
    const down = await request(app)
      .post("/api/platform/exchange")
      .send({ platform: "telegram", initData: "tg-down" });
    expect(down.status).toBe(503);
    expect(down.body.code).toBe("PLATFORM_UNAVAILABLE");
  });

  it("me restores from cookie; missing/tampered → 401; logout clears (204)", async () => {
    injectMock();
    const agent = request.agent(app);
    await agent.post("/api/platform/exchange").send({ platform: "telegram", initData: "tg-me" });
    const me = await agent.get("/api/platform/me");
    expect(me.status).toBe(200);
    expect(me.body.balance.available).toBe(10);
    expect(me.body.sessionToken).toBeUndefined();
    expect(await request(app).get("/api/platform/me")).toMatchObject({ status: 401 });
    expect(
      await request(app)
        .get("/api/platform/me")
        .set("Cookie", "wardrobe_session=forged-value-1234567890"),
    ).toMatchObject({ status: 401 });

    const out = await agent.delete("/api/platform/session");
    expect(out.status).toBe(204);
    expect(cookieOf(out)).toContain("Max-Age=0");
    expect(await agent.get("/api/platform/me")).toMatchObject({ status: 401 });
  });

  it("dev exchange + reset work outside production", async () => {
    injectMock();
    const res = await request(app).post("/api/platform/dev/exchange").send({ persona: "t-1" });
    expect(res.status).toBe(200);
    expect(res.body.balance.available).toBe(10);
    expect(await request(app).post("/api/platform/dev/exchange").send({})).toMatchObject({
      status: 400,
    });
  });
});

describe("platform auth bridge (integration disabled)", () => {
  it("exchange and me are not enumerable when the flag is off", async () => {
    process.env.PLATFORM_INTEGRATION_ENABLED = "false";
    expect((await request(app).get("/api/platform/status")).body).toEqual({
      integrationEnabled: false,
    });
    await request(app)
      .post("/api/platform/exchange")
      .send({ platform: "telegram", initData: "x" })
      .expect(404);
    await request(app).get("/api/platform/me").expect(404);
  });
});
