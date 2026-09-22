import type { WardrobeVisionProvider } from "./types.js";
import { MockWardrobeVisionProvider } from "./mockVision.js";
import { ZaiWardrobeVisionProvider } from "./zaiVision.js";
import { GroqWardrobeVisionProvider } from "./groqVision.js";
import { isGroqAvailable, isZaiAvailable, isMockMode } from "../config.js";
import type { WardrobeScan } from "../../shared/wardrobe.js";

export interface WardrobeChainResult {
  result: WardrobeScan;
  provider: string;
  modelId: string;
}

// Z.AI transient/rate-limit codes (1302/1303/1304/1305/1308/1113) trigger fast
// Groq fallback — matched inline below.
export function isRetryableProviderError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  const lower = msg.toLowerCase();
  if (
    msg.includes("429") ||
    lower.includes("quota") ||
    lower.includes("resource_exhausted") ||
    msg.includes("503") ||
    msg.includes("500") ||
    lower.includes("unavailable") ||
    lower.includes("high demand") ||
    lower.includes("rate limit") ||
    lower.includes("temporarily") ||
    lower.includes("overloaded") ||
    lower.includes("timeout") ||
    lower.includes("aborted") ||
    lower.includes("abort") ||
    lower.includes("fetch failed") ||
    lower.includes("network")
  ) {
    return true;
  }
  if (/\b(1302|1303|1304|1305|1308|1113)\b/.test(msg)) return true;
  if (
    lower.includes("invalid json from z.ai") ||
    lower.includes("empty response from z.ai") ||
    lower.includes("empty response")
  ) {
    if (msg.includes("401") || lower.includes("invalid zai_api_key")) return false;
    return true;
  }
  return false;
}

/** Vision chain: ZAI primary → Groq fallback, one call each max, no loops. */
export class WardrobeVisionChain {
  private primary: WardrobeVisionProvider;
  private fallback?: WardrobeVisionProvider;

  constructor(opts?: { primary?: WardrobeVisionProvider; fallback?: WardrobeVisionProvider }) {
    if (opts?.primary) {
      this.primary = opts.primary;
      this.fallback = opts.fallback;
      return;
    }
    if (isMockMode()) {
      this.primary = new MockWardrobeVisionProvider();
      return;
    }
    if (isZaiAvailable()) {
      this.primary = new ZaiWardrobeVisionProvider();
      if (isGroqAvailable()) this.fallback = new GroqWardrobeVisionProvider();
    } else if (isGroqAvailable()) {
      this.primary = new GroqWardrobeVisionProvider();
    } else {
      this.primary = new MockWardrobeVisionProvider();
    }
  }

  getPrimaryName(): string {
    return this.primary.name;
  }
  getFallbackName(): string | undefined {
    return this.fallback?.name;
  }

  async analyze(params: { imageBase64: string; mimeType: string }): Promise<WardrobeChainResult> {
    const startedAt = Date.now();
    try {
      const res = await this.primary.analyzeGarments(params);
      return { result: res, provider: this.primary.name, modelId: this.primary.modelId };
    } catch (err) {
      const latencyMs = Date.now() - startedAt;
      if (!this.fallback || !isRetryableProviderError(err)) throw err;
      console.warn(
        `[visionChain] primary ${this.primary.name} failed (${latencyMs}ms), trying fallback ${this.fallback.name}`,
      );
      const res2 = await this.fallback.analyzeGarments(params);
      return { result: res2, provider: this.fallback.name, modelId: this.fallback.modelId };
    }
  }
}
