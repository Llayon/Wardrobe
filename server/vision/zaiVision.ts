import type { WardrobeVisionProvider } from "./types.js";
import { wardrobeScanSchema, type WardrobeScan } from "../../shared/wardrobe.js";
import { WARDROBE_VISION_PROMPT } from "./prompt.js";
import { config, ZAI_MODEL_ID, ZAI_VISION_PROMPT_VERSION, ZAI_API_BASE } from "../config.js";

export class ZaiWardrobeVisionProvider implements WardrobeVisionProvider {
  readonly name = "zai" as const;
  readonly modelId = ZAI_MODEL_ID;
  readonly promptVersion = ZAI_VISION_PROMPT_VERSION;
  private apiKey: string;
  private apiBase: string;
  private timeoutMs: number;

  constructor(apiKey?: string, apiBase?: string, opts?: { timeoutMs?: number }) {
    const key = apiKey ?? config.zaiApiKey;
    if (!key) throw new Error("ZAI_API_KEY is required");
    this.apiKey = key;
    this.apiBase = apiBase ?? config.zaiApiBase ?? ZAI_API_BASE;
    this.timeoutMs = opts?.timeoutMs ?? config.zaiTimeoutMs ?? 10000;
  }

  async analyzeGarments(params: { imageBase64: string; mimeType: string }): Promise<WardrobeScan> {
    const base64Data = params.imageBase64.includes(",")
      ? params.imageBase64.split(",")[1]
      : params.imageBase64;
    const mimeType = params.mimeType || "image/jpeg";
    console.log(
      `[zaiVision] request mime=${mimeType} model=${this.modelId} version=${this.promptVersion} base=${this.apiBase}`,
    );
    const dataUrl = `data:${mimeType};base64,${base64Data}`;
    const messages = [
      {
        role: "user" as const,
        content: [
          { type: "text" as const, text: WARDROBE_VISION_PROMPT },
          { type: "image_url" as const, image_url: { url: dataUrl } },
        ],
      },
    ];

    const tryCall = async (withJsonObject: boolean) => {
      const body: Record<string, unknown> = {
        model: this.modelId,
        messages,
        temperature: 0.2,
        max_tokens: 2000,
      };
      if (withJsonObject) body.response_format = { type: "json_object" };
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.timeoutMs);
      try {
        const res = await fetch(`${this.apiBase}/chat/completions`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${this.apiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(body),
          signal: controller.signal,
        });
        const text = await res.text();
        let json: unknown;
        try {
          json = JSON.parse(text);
        } catch {
          throw new Error(`Invalid JSON from Z.AI HTTP ${res.status}: ${text.slice(0, 500)}`);
        }
        if (!res.ok) {
          const errObj = json as Record<string, unknown>;
          const code =
            (errObj.code as number | undefined) ??
            ((errObj.error as Record<string, unknown> | undefined)?.code as number | undefined);
          const msg =
            (errObj.message as string | undefined) ??
            ((errObj.error as Record<string, unknown> | undefined)?.message as
              string | undefined) ??
            text;
          const err = new Error(`${res.status} ZAI error code ${code ?? res.status}: ${msg}`);
          (err as unknown as { status?: number }).status = res.status;
          (err as unknown as { code?: number }).code = code;
          throw err;
        }
        return json as { choices?: Array<{ message?: { content?: string } }> };
      } finally {
        clearTimeout(timer);
      }
    };

    try {
      let raw: Awaited<ReturnType<typeof tryCall>>;
      try {
        raw = await tryCall(true);
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        if (
          msg.includes("1214") ||
          msg.toLowerCase().includes("response_format") ||
          msg.toLowerCase().includes("invalid api parameter")
        ) {
          raw = await tryCall(false);
        } else {
          throw e;
        }
      }
      const content = raw.choices?.[0]?.message?.content ?? "";
      if (!content) throw new Error("Empty response from Z.AI");
      return parseWardrobeJson(content, "Z.AI");
    } catch (err: unknown) {
      const rawMsg = err instanceof Error ? err.message : String(err);
      if (
        (err instanceof Error && err.name === "AbortError") ||
        rawMsg.toLowerCase().includes("abort")
      ) {
        throw new Error(`ZAI vision failed: timeout after ${this.timeoutMs}ms`);
      }
      throw new Error(`ZAI vision failed: ${rawMsg.slice(0, 500)}`);
    }
  }
}

/** Shared JSON extraction + zod validation (also used by the Groq provider). */
export function parseWardrobeJson(content: string, source: string): WardrobeScan {
  const stripped = content
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```\s*$/i, "")
    .trim();
  let parsed: unknown;
  try {
    parsed = JSON.parse(stripped);
  } catch {
    const m = stripped.match(/\{[\s\S]*\}/);
    if (m) parsed = JSON.parse(m[0]);
    else throw new Error(`Invalid JSON from ${source}: ${stripped.slice(0, 500)}`);
  }
  const validated = wardrobeScanSchema.parse(parsed);
  // Dedupe by canonicalName, cap counts (contract already bounds, belt first).
  const seen = new Set<string>();
  const items = validated.items.filter((ing) => {
    if (seen.has(ing.canonicalName)) return false;
    seen.add(ing.canonicalName);
    return true;
  });
  const uncertainItems = validated.uncertainItems.filter((u) => !seen.has(u.canonicalName));
  return { items, uncertainItems };
}
