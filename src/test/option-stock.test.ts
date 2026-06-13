import { beforeEach, describe, expect, it } from "vitest";
import {
  adjustConfiguredStock,
  db,
  getAvailableStockForSelection,
  getConfiguredProductReceiptDetails,
  getDefaultOptionIdsForProduct,
  getProductStockUsage,
} from "@/lib/db";

describe("configured product stock", () => {
  beforeEach(async () => {
    await db.productOptionRecipes.clear();
    await db.productOptions.clear();
    await db.productOptionGroups.clear();
    await db.productRecipes.clear();
    await db.products.clear();
    await db.warehouseItems.clear();
  });

  it("includes selected option recipes in stock usage and deduction", async () => {
    const now = new Date();

    const riceId = await db.warehouseItems.add({
      name: "Nasi",
      stock: 10,
      unit: "pcs",
      isCashierVisible: 0,
      price: 0,
      isDailyReset: 0,
      lastPreparedDate: "",
      dailyPrepQty: 0,
      dailyPrepFactor: 1,
      isDeleted: 0,
      createdAt: now,
      updatedAt: now,
    });

    const wingId = await db.warehouseItems.add({
      name: "Sayap",
      stock: 5,
      unit: "pcs",
      isCashierVisible: 0,
      price: 0,
      isDailyReset: 0,
      lastPreparedDate: "",
      dailyPrepQty: 0,
      dailyPrepFactor: 1,
      isDeleted: 0,
      createdAt: now,
      updatedAt: now,
    });

    const sambalId = await db.warehouseItems.add({
      name: "Sambal Ijo",
      stock: 6,
      unit: "pcs",
      isCashierVisible: 0,
      price: 0,
      isDailyReset: 0,
      lastPreparedDate: "",
      dailyPrepQty: 0,
      dailyPrepFactor: 1,
      isDeleted: 0,
      createdAt: now,
      updatedAt: now,
    });

    const productId = await db.products.add({
      name: "Ayam Sambal Ijo",
      sku: "PKT-001",
      categoryId: 1,
      price: 18000,
      hpp: 10000,
      stock: 0,
      unit: "pcs",
      description: "Paket nasi ayam sambal ijo",
      isDeleted: 0,
      deletedAt: null,
      createdAt: now,
      updatedAt: now,
    });

    await db.productRecipes.add({
      productId,
      warehouseItemId: riceId,
      quantity: 1,
    });

    const cutGroupId = await db.productOptionGroups.add({
      productId,
      name: "Potongan Ayam",
      required: 1,
      minSelect: 1,
      maxSelect: 1,
      sortOrder: 1,
      isDeleted: 0,
      createdAt: now,
      updatedAt: now,
    });

    const sauceGroupId = await db.productOptionGroups.add({
      productId,
      name: "Sambal",
      required: 1,
      minSelect: 1,
      maxSelect: 1,
      sortOrder: 2,
      isDeleted: 0,
      createdAt: now,
      updatedAt: now,
    });

    const sayapOptionId = await db.productOptions.add({
      groupId: cutGroupId,
      name: "Sayap",
      priceDelta: 0,
      hppDelta: 0,
      sortOrder: 1,
      isDefault: 1,
      isDeleted: 0,
      createdAt: now,
      updatedAt: now,
    });

    const sambalIjoOptionId = await db.productOptions.add({
      groupId: sauceGroupId,
      name: "Sambal Ijo",
      priceDelta: 0,
      hppDelta: 0,
      sortOrder: 1,
      isDefault: 1,
      isDeleted: 0,
      createdAt: now,
      updatedAt: now,
    });

    await db.productOptionRecipes.bulkAdd([
      {
        optionId: sayapOptionId,
        warehouseItemId: wingId,
        quantity: 1,
      },
      {
        optionId: sambalIjoOptionId,
        warehouseItemId: sambalId,
        quantity: 1,
      },
    ]);

    const selectedOptionIds = [sayapOptionId, sambalIjoOptionId];

    await expect(getProductStockUsage(productId, selectedOptionIds)).resolves.toEqual({
      [riceId]: 1,
      [wingId]: 1,
      [sambalId]: 1,
    });

    await expect(getAvailableStockForSelection(productId, selectedOptionIds)).resolves.toBe(5);

    await adjustConfiguredStock(productId, 2, selectedOptionIds);

    await expect(db.warehouseItems.get(riceId)).resolves.toMatchObject({ stock: 8 });
    await expect(db.warehouseItems.get(wingId)).resolves.toMatchObject({ stock: 3 });
    await expect(db.warehouseItems.get(sambalId)).resolves.toMatchObject({ stock: 4 });
  });

  it("builds receipt details for package products from selected options and base recipe", async () => {
    const now = new Date();

    const riceId = await db.warehouseItems.add({
      name: "Nasi",
      stock: 10,
      unit: "pcs",
      isCashierVisible: 0,
      price: 0,
      isDailyReset: 0,
      lastPreparedDate: "",
      dailyPrepQty: 0,
      dailyPrepFactor: 1,
      isDeleted: 0,
      createdAt: now,
      updatedAt: now,
    });

    const productId = await db.products.add({
      name: "Ayam Sambal Ijo",
      sku: "PKT-002",
      categoryId: 1,
      price: 18000,
      hpp: 10000,
      stock: 0,
      unit: "pcs",
      description: "Paket ayam sambal ijo",
      isDeleted: 0,
      deletedAt: null,
      createdAt: now,
      updatedAt: now,
    });

    await db.productRecipes.add({
      productId,
      warehouseItemId: riceId,
      quantity: 1,
    });

    const groupId = await db.productOptionGroups.add({
      productId,
      name: "Pilihan",
      required: 1,
      minSelect: 1,
      maxSelect: 2,
      sortOrder: 1,
      isDeleted: 0,
      createdAt: now,
      updatedAt: now,
    });

    const sayapOptionId = await db.productOptions.add({
      groupId,
      name: "Sayap",
      priceDelta: 0,
      hppDelta: 0,
      sortOrder: 1,
      isDefault: 1,
      isDeleted: 0,
      createdAt: now,
      updatedAt: now,
    });

    const sambalOptionId = await db.productOptions.add({
      groupId,
      name: "Sambal Ijo",
      priceDelta: 0,
      hppDelta: 0,
      sortOrder: 2,
      isDefault: 0,
      isDeleted: 0,
      createdAt: now,
      updatedAt: now,
    });

    await expect(
      getConfiguredProductReceiptDetails(productId, [sayapOptionId, sambalOptionId])
    ).resolves.toEqual(["Sayap", "Sambal Ijo", "Nasi"]);
  });

  it("uses required default package options when calculating display stock", async () => {
    const now = new Date();

    const riceId = await db.warehouseItems.add({
      name: "Nasi",
      stock: 20,
      unit: "pcs",
      isCashierVisible: 0,
      price: 0,
      isDailyReset: 0,
      lastPreparedDate: "",
      dailyPrepQty: 0,
      dailyPrepFactor: 1,
      isDeleted: 0,
      createdAt: now,
      updatedAt: now,
    });

    const chickenId = await db.warehouseItems.add({
      name: "Paha Ayam",
      stock: 60,
      unit: "pcs",
      isCashierVisible: 0,
      price: 0,
      isDailyReset: 0,
      lastPreparedDate: "",
      dailyPrepQty: 0,
      dailyPrepFactor: 1,
      isDeleted: 0,
      createdAt: now,
      updatedAt: now,
    });

    const drinkId = await db.warehouseItems.add({
      name: "Fruit Tea",
      stock: 25,
      unit: "pcs",
      isCashierVisible: 0,
      price: 0,
      isDailyReset: 0,
      lastPreparedDate: "",
      dailyPrepQty: 0,
      dailyPrepFactor: 1,
      isDeleted: 0,
      createdAt: now,
      updatedAt: now,
    });

    const productId = await db.products.add({
      name: "Paket Ayam Nasi",
      sku: "PKT-003",
      categoryId: 1,
      price: 0,
      hpp: 0,
      stock: 999,
      unit: "pcs",
      description: "Paket ayam + nasi + minum",
      isDeleted: 0,
      deletedAt: null,
      createdAt: now,
      updatedAt: now,
    });

    await db.productRecipes.add({
      productId,
      warehouseItemId: riceId,
      quantity: 1,
    });

    const cutGroupId = await db.productOptionGroups.add({
      productId,
      name: "Potongan Ayam",
      required: 1,
      minSelect: 1,
      maxSelect: 1,
      sortOrder: 1,
      isDeleted: 0,
      createdAt: now,
      updatedAt: now,
    });

    const extrasGroupId = await db.productOptionGroups.add({
      productId,
      name: "Isi Paket",
      required: 1,
      minSelect: 2,
      maxSelect: 2,
      sortOrder: 2,
      isDeleted: 0,
      createdAt: now,
      updatedAt: now,
    });

    const chickenOptionId = await db.productOptions.add({
      groupId: cutGroupId,
      name: "Paha",
      priceDelta: 20000,
      hppDelta: 0,
      sortOrder: 1,
      isDefault: 0,
      isDeleted: 0,
      createdAt: now,
      updatedAt: now,
    });

    const drinkOptionId = await db.productOptions.add({
      groupId: extrasGroupId,
      name: "Fruit Tea",
      priceDelta: 0,
      hppDelta: 0,
      sortOrder: 1,
      isDefault: 0,
      isDeleted: 0,
      createdAt: now,
      updatedAt: now,
    });

    const riceOptionId = await db.productOptions.add({
      groupId: extrasGroupId,
      name: "Nasi Tambahan Paket",
      priceDelta: 0,
      hppDelta: 0,
      sortOrder: 2,
      isDefault: 0,
      isDeleted: 0,
      createdAt: now,
      updatedAt: now,
    });

    await db.productOptionRecipes.bulkAdd([
      {
        optionId: chickenOptionId,
        warehouseItemId: chickenId,
        quantity: 1,
      },
      {
        optionId: drinkOptionId,
        warehouseItemId: drinkId,
        quantity: 1,
      },
      {
        optionId: riceOptionId,
        warehouseItemId: riceId,
        quantity: 0,
      },
    ]);

    const groups = await db.productOptionGroups.toArray();
    const options = await db.productOptions.toArray();
    const defaultOptionIds = getDefaultOptionIdsForProduct(productId, groups, options);

    expect(defaultOptionIds).toEqual([chickenOptionId, drinkOptionId, riceOptionId]);
    await expect(getAvailableStockForSelection(productId, defaultOptionIds)).resolves.toBe(20);
  });
});
