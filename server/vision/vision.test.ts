/**
 * @vitest-environment node
 */
import { describe, it, expect } from "vitest";
import { MockWardrobeVisionProvider } from "./mockVision.js";
import { WardrobeVisionChain, isRetryableProviderError } from "./router.js";
import { parseWardrobeJson } from "./zaiVision.js";
import { WARDROBE_VISION_PROMPT } from "./prompt.js";

describe("mock vision (deterministic)", () => {
  it("returns 3 garments + 1 uncertain, cloned per call", async () => {
    const mock = new MockWardrobeVisionProvider();
    const a = await mock.analyzeGarments({ imageBase64: "x", mimeType: "image/jpeg" });
    expect(a.items).toHaveLength(3);
    expect(a.uncertainItems).toHaveLength(1);
    expect(a.items[0].category).toBe("bottom");
    a.items[0].canonicalName = "mutated";
    const b = await mock.analyzeGarments({ imageBase64: "x", mimeType: "image/jpeg" });
    expect(b.items[0].canonicalName).not.toBe("mutated");
  });
});

describe("isRetryableProviderError", () => {
  it("retries quota/overload/timeout/network, not auth/validation", () => {
    expect(isRetryableProviderError(new Error("429 quota"))).toBe(true);
    expect(isRetryableProviderError(new Error("1305 overloaded"))).toBe(true);
    expect(isRetryableProviderError(new Error("timeout after 10000ms"))).toBe(true);
    expect(isRetryableProviderError(new Error("Empty response from Z.AI"))).toBe(true);
    expect(isRetryableProviderError(new Error("401 Invalid ZAI_API_KEY"))).toBe(false);
    expect(isRetryableProviderError(new Error("400 invalid_argument"))).toBe(false);
  });
});

describe("WardrobeVisionChain (injected fakes, no quota)", () => {
  const garment = (name: string) => ({
    items: [
      {
        canonicalName: name,
        displayName: name,
        category: "top" as const,
        colors: [],
        confidence: 0.9,
      },
    ],
    uncertainItems: [],
  });

  it("primary success, no fallback call", async () => {
    let fallbackCalls = 0;
    const chain = new WardrobeVisionChain({
      primary: {
        name: "mock",
        modelId: "mock",
        analyzeGarments: async () => garment("a"),
      },
      fallback: {
        name: "mock",
        modelId: "mock",
        analyzeGarments: async () => {
          fallbackCalls += 1;
          return garment("b");
        },
      },
    });
    const out = await chain.analyze({ imageBase64: "x", mimeType: "image/jpeg" });
    expect(out.result.items[0].canonicalName).toBe("a");
    expect(fallbackCalls).toBe(0);
  });

  it("retryable primary failure falls back once; non-retryable surfaces", async () => {
    const flaky = new WardrobeVisionChain({
      primary: {
        name: "zai",
        modelId: "z",
        analyzeGarments: async () => {
          throw new Error("1305 overloaded");
        },
      },
      fallback: {
        name: "groq",
        modelId: "g",
        analyzeGarments: async () => garment("fallback-win"),
      },
    });
    expect((await flaky.analyze({ imageBase64: "x", mimeType: "image/jpeg" })).provider).toBe(
      "groq",
    );

    const authFail = new WardrobeVisionChain({
      primary: {
        name: "zai",
        modelId: "z",
        analyzeGarments: async () => {
          throw new Error("401 Invalid ZAI_API_KEY");
        },
      },
      fallback: {
        name: "groq",
        modelId: "g",
        analyzeGarments: async () => garment("nope"),
      },
    });
    await expect(authFail.analyze({ imageBase64: "x", mimeType: "image/jpeg" })).rejects.toThrow(
      /401/,
    );
  });
});

describe("parseWardrobeJson (shared validation)", () => {
  it("parses fenced JSON, validates ontology, dedupes", () => {
    const out = parseWardrobeJson(
      '```json\n{"items": [{"canonicalName": "x", "displayName": "X", "category": "top", "colors": ["red"], "confidence": 1}, {"canonicalName": "x", "displayName": "X2", "category": "top", "colors": [], "confidence": 1}], "uncertainItems": []}\n```',
      "test",
    );
    expect(out.items).toHaveLength(1);
  });

  it("rejects unknown categories (no silent misclassification)", () => {
    expect(() =>
      parseWardrobeJson(
        '{"items": [{"canonicalName": "x", "displayName": "X", "category": "hat", "confidence": 1}], "uncertainItems": []}',
        "test",
      ),
    ).toThrow();
  });

  it("prompt pins categories, colors, bbox contract", () => {
    expect(WARDROBE_VISION_PROMPT).toMatch(/outerwear/);
    expect(WARDROBE_VISION_PROMPT).toMatch(/bbox/);
    expect(WARDROBE_VISION_PROMPT).toMatch(/uncertainItems/);
  });
});
