/**
 * @vitest-environment node
 */
import { describe, it, expect } from "vitest";
import request from "supertest";
import { app } from "./app.js";

describe("wardrobe skeleton (Gauntlet 0)", () => {
  it("GET /api/health returns service liveness", async () => {
    const res = await request(app).get("/api/health");
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: "ok", service: "wardrobe" });
  });

  it("unknown routes never leak internals", async () => {
    const res = await request(app).get("/nope");
    if (res.status === 404) {
      // Vercel branch (no static): JSON 404, not HTML.
      expect(res.body.code).toBe("NOT_FOUND");
    } else {
      // Local branch with built dist: SPA fallback serves the app shell.
      expect(res.status).toBe(200);
      expect(res.headers["content-type"]).toMatch(/html/);
    }
  });
});
