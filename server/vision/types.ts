import type { WardrobeScan } from "../../shared/wardrobe.js";

export type WardrobeProviderName = "mock" | "zai" | "groq";

export interface WardrobeVisionProvider {
  readonly name: WardrobeProviderName;
  readonly modelId: string;
  analyzeGarments(params: { imageBase64: string; mimeType: string }): Promise<WardrobeScan>;
}
