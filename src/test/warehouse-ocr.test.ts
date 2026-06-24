import { describe, expect, it } from "vitest";
import { extractOcrDraftSuggestions } from "@/lib/warehouse-ocr";

describe("warehouse OCR draft extraction", () => {
  const warehouseItems = [
    { id: 1, name: "Ayam Boneless", unit: "pak" },
    { id: 2, name: "Ayam Potong 9", unit: "pcs" },
    { id: 3, name: "Air Mineral 330ML", unit: "pcs" },
  ];

  it("matches clean OCR lines to warehouse items", () => {
    const text = [
      "AYAM BONELESS 5 PAK 250.000",
      "AIR MINERAL 330ML 2",
    ].join("\n");

    const result = extractOcrDraftSuggestions(text, warehouseItems);

    expect(result).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          detectedName: "AYAM BONELESS",
          detectedQuantity: 5,
          warehouseItemId: 1,
          status: "matched",
        }),
        expect.objectContaining({
          detectedName: "AIR MINERAL 330ML",
          detectedQuantity: 2,
          warehouseItemId: 3,
          status: "matched",
        }),
      ])
    );
  });

  it("marks uncertain items for review and defaults missing quantity to 1", () => {
    const text = "AYAM POTONG";
    const result = extractOcrDraftSuggestions(text, warehouseItems);

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      detectedName: "AYAM POTONG",
      detectedQuantity: 1,
      status: "review",
    });
  });

  it("ignores total and payment lines", () => {
    const text = [
      "TOTAL 250.000",
      "TUNAI 300.000",
      "KEMBALIAN 50.000",
    ].join("\n");

    const result = extractOcrDraftSuggestions(text, warehouseItems);
    expect(result).toHaveLength(0);
  });
});
