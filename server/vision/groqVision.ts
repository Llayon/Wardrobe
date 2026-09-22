import Groq from "groq-sdk";
import type { WardrobeVisionProvider } from "./types.js";
import type { WardrobeScan } from "../../shared/wardrobe.js";
import { WARDROBE_VISION_PROMPT } from "./prompt.js";
import { parseWardrobeJson } from "./zaiVision.js";
import { config, GROQ_MODEL_ID, GROQ_VISION_MAX_COMPLETION_TOKENS } from "../config.js";

/**
 * Groq wardrobe vision. Uses `json_object` mode (NOT strict structured
 * outputs): strict mode demands every property in `required` (the known
 * OTPM/400 pitfall class), while `bbox` is genuinely optional. Zod
 * validation + brace-extract fallback keep the contract tight instead.
 */
export class GroqWardrobeVisionProvider implements WardrobeVisionProvider {
  readonly name = "groq" as const;
  readonly modelId = GROQ_MODEL_ID;
  private client: Groq;

  constructor(apiKey?: string, opts?: { timeoutMs?: number }) {
    const key = apiKey ?? config.groqApiKey;
    if (!key) throw new Error("GROQ_API_KEY is required");
    this.client = new Groq({ apiKey: key, timeout: opts?.timeoutMs ?? config.groqTimeoutMs });
  }

  async analyzeGarments(params: { imageBase64: string; mimeType: string }): Promise<WardrobeScan> {
    const base64Data = params.imageBase64.includes(",")
      ? params.imageBase64.split(",")[1]
      : params.imageBase64;
    const mimeType = params.mimeType || "image/jpeg";
    console.log(`[groqVision] request mime=${mimeType} model=${this.modelId}`);
    const completion = await this.client.chat.completions.create({
      model: this.modelId,
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: WARDROBE_VISION_PROMPT },
            { type: "image_url", image_url: { url: `data:${mimeType};base64,${base64Data}` } },
          ],
        },
      ],
      temperature: 0.2,
      max_completion_tokens: GROQ_VISION_MAX_COMPLETION_TOKENS,
      response_format: { type: "json_object" },
    });
    const content = completion.choices?.[0]?.message?.content ?? "";
    if (!content) throw new Error("Empty response from Groq");
    return parseWardrobeJson(content, "Groq");
  }
}
