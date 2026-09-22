import type { WardrobeVisionProvider } from "./types.js";
import type { WardrobeScan } from "../../shared/wardrobe.js";
import { MOCK_WARDROBE_SCAN } from "./mockData.js";

export class MockWardrobeVisionProvider implements WardrobeVisionProvider {
  readonly name = "mock" as const;
  readonly modelId = "mock";

  async analyzeGarments(_params: { imageBase64: string; mimeType: string }): Promise<WardrobeScan> {
    await new Promise((r) => setTimeout(r, 800));
    return JSON.parse(JSON.stringify(MOCK_WARDROBE_SCAN)) as WardrobeScan;
  }
}
