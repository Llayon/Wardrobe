import type { WardrobeScan } from "../../shared/wardrobe.js";

/** Deterministic mock scan (tests/E2E, zero quota). Never mutated (cloned on use). */
export const MOCK_WARDROBE_SCAN: WardrobeScan = {
  items: [
    {
      canonicalName: "black_jeans",
      displayName: "Чёрные джинсы",
      category: "bottom",
      colors: ["black"],
      confidence: 0.93,
      bbox: { x: 0.1, y: 0.2, w: 0.35, h: 0.6 },
    },
    {
      canonicalName: "white_tshirt",
      displayName: "Белая футболка",
      category: "top",
      colors: ["white"],
      confidence: 0.89,
    },
    {
      canonicalName: "white_sneakers",
      displayName: "Белые кеды",
      category: "shoes",
      colors: ["white"],
      confidence: 0.86,
    },
  ],
  uncertainItems: [{ canonicalName: "belt", displayName: "Ремень", reason: "частично скрыт" }],
};
