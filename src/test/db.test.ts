import { describe, it, expect, beforeEach } from "vitest";
import { db, deleteDailyExpenseEntry, duplicateProduct, recordDailyExpense, recordWarehouseUsage, revertWarehouseUsageLog } from "@/lib/db";

describe("duplicateProduct", () => {
  beforeEach(async () => {
    // Clear all tables involved in product duplication to ensure test isolation
    await db.products.clear();
    await db.productRecipes.clear();
    await db.productOptionGroups.clear();
    await db.productOptions.clear();
    await db.productOptionRecipes.clear();
    await db.warehouseItems.clear();
  });

  it("should duplicate a product and all of its related entities", async () => {
    // 1. Setup a product with category, recipe, option groups, options, and option recipes
    const now = new Date();
    
    // Add warehouse items
    await db.warehouseItems.add({
      id: 10,
      name: "Bahan 10",
      stock: 100, // stock of 100 / recipe quantity of 2 = computed product stock of 50
      unit: "pcs",
      isCashierVisible: 1,
      isDailyReset: 0,
      isDeleted: 0,
      createdAt: now,
      updatedAt: now,
    });

    await db.warehouseItems.add({
      id: 11,
      name: "Bahan 11",
      stock: 50,
      unit: "pcs",
      isCashierVisible: 1,
      isDailyReset: 0,
      isDeleted: 0,
      createdAt: now,
      updatedAt: now,
    });

    const product1Id = await db.products.add({
      name: "Original Product",
      sku: "PROD-001",
      categoryId: 1,
      price: 15000,
      hpp: 10000,
      stock: 50,
      unit: "pcs",
      description: "Original description",
      isDeleted: 0,
      deletedAt: null,
      createdAt: now,
      updatedAt: now,
    });

    // Add a product recipe
    await db.productRecipes.add({
      productId: product1Id,
      warehouseItemId: 10,
      quantity: 2,
    });

    // Add an option group
    const groupId = await db.productOptionGroups.add({
      productId: product1Id,
      name: "Ukuran",
      required: 1,
      minSelect: 1,
      maxSelect: 1,
      sortOrder: 1,
      isDeleted: 0,
      createdAt: now,
      updatedAt: now,
    });

    // Add options
    const option1Id = await db.productOptions.add({
      groupId,
      name: "Regular",
      priceDelta: 0,
      hppDelta: 0,
      sortOrder: 1,
      isDefault: 1,
      isDeleted: 0,
      createdAt: now,
      updatedAt: now,
    });

    const option2Id = await db.productOptions.add({
      groupId,
      name: "Large",
      priceDelta: 5000,
      hppDelta: 3000,
      sortOrder: 2,
      isDefault: 0,
      isDeleted: 0,
      createdAt: now,
      updatedAt: now,
    });

    // Add option recipe for the second option
    await db.productOptionRecipes.add({
      optionId: option2Id,
      warehouseItemId: 11,
      quantity: 1,
    });

    // 2. Perform duplication
    const duplicateId = await duplicateProduct(product1Id, 42);

    // 3. Verify duplicated product details
    const duplicatedProduct = await db.products.get(duplicateId);
    expect(duplicatedProduct).toBeDefined();
    expect(duplicatedProduct?.name).toBe("Original Product (Copy)");
    expect(duplicatedProduct?.sku).toBe("PROD-001-copy");
    expect(duplicatedProduct?.categoryId).toBe(1);
    expect(duplicatedProduct?.price).toBe(15000);
    expect(duplicatedProduct?.hpp).toBe(10000);
    expect(duplicatedProduct?.stock).toBe(50);
    expect(duplicatedProduct?.unit).toBe("pcs");
    expect(duplicatedProduct?.description).toBe("Original description");
    expect(duplicatedProduct?.createdBy).toBe(42);
    expect(duplicatedProduct?.updatedBy).toBe(42);

    // 4. Verify recipes were duplicated
    const duplicatedRecipes = await db.productRecipes.where("productId").equals(duplicateId).toArray();
    expect(duplicatedRecipes.length).toBe(1);
    expect(duplicatedRecipes[0].warehouseItemId).toBe(10);
    expect(duplicatedRecipes[0].quantity).toBe(2);

    // 5. Verify option groups were duplicated
    const duplicatedGroups = await db.productOptionGroups.where("productId").equals(duplicateId).toArray();
    expect(duplicatedGroups.length).toBe(1);
    expect(duplicatedGroups[0].name).toBe("Ukuran");
    expect(duplicatedGroups[0].required).toBe(1);
    expect(duplicatedGroups[0].minSelect).toBe(1);
    expect(duplicatedGroups[0].maxSelect).toBe(1);

    // 6. Verify options were duplicated under the new group
    const newGroupId = duplicatedGroups[0].id!;
    const duplicatedOptions = await db.productOptions.where("groupId").equals(newGroupId).toArray();
    expect(duplicatedOptions.length).toBe(2);

    const dupOptionRegular = duplicatedOptions.find(o => o.name === "Regular");
    const dupOptionLarge = duplicatedOptions.find(o => o.name === "Large");

    expect(dupOptionRegular).toBeDefined();
    expect(dupOptionRegular?.isDefault).toBe(1);
    expect(dupOptionRegular?.priceDelta).toBe(0);

    expect(dupOptionLarge).toBeDefined();
    expect(dupOptionLarge?.isDefault).toBe(0);
    expect(dupOptionLarge?.priceDelta).toBe(5000);
    expect(dupOptionLarge?.hppDelta).toBe(3000);

    // 7. Verify option recipe was duplicated under the new option ID
    const duplicatedOptionRecipes = await db.productOptionRecipes
      .where("optionId")
      .equals(dupOptionLarge!.id!)
      .toArray();
    expect(duplicatedOptionRecipes.length).toBe(1);
    expect(duplicatedOptionRecipes[0].warehouseItemId).toBe(11);
    expect(duplicatedOptionRecipes[0].quantity).toBe(1);
  });

  it("should handle suffix incrementing when multiple duplicates exist", async () => {
    const now = new Date();
    const product1Id = await db.products.add({
      name: "Original Product",
      sku: "PROD-001",
      categoryId: 1,
      price: 15000,
      hpp: 10000,
      stock: 50,
      unit: "pcs",
      isDeleted: 0,
      deletedAt: null,
      createdAt: now,
      updatedAt: now,
    });

    const dupId1 = await duplicateProduct(product1Id);
    const prod1 = await db.products.get(dupId1);
    expect(prod1?.sku).toBe("PROD-001-copy");

    const dupId2 = await duplicateProduct(product1Id);
    const prod2 = await db.products.get(dupId2);
    expect(prod2?.sku).toBe("PROD-001-copy2");

    const dupId3 = await duplicateProduct(product1Id);
    const prod3 = await db.products.get(dupId3);
    expect(prod3?.sku).toBe("PROD-001-copy3");
  });
});

describe("daily operational records", () => {
  beforeEach(async () => {
    await db.dailyExpenses.clear();
    await db.warehouseUsageLogs.clear();
    await db.warehouseItems.clear();
  });

  it("records daily expense entries", async () => {
    await recordDailyExpense({
      amount: 25000,
      purpose: "Beli es batu",
    });

    const expenses = await db.dailyExpenses.toArray();
    expect(expenses).toHaveLength(1);
    expect(expenses[0]).toMatchObject({
      amount: 25000,
      purpose: "Beli es batu",
    });

    await deleteDailyExpenseEntry(expenses[0].id!);
    await expect(db.dailyExpenses.toArray()).resolves.toHaveLength(0);
  });

  it("stores expense date separately from input time", async () => {
    const incidentDate = new Date("2026-06-20T12:00:00");
    const beforeInput = Date.now();

    await recordDailyExpense({
      amount: 18000,
      purpose: "Beli gas dadakan",
      date: incidentDate,
    });

    const expenses = await db.dailyExpenses.toArray();
    expect(expenses).toHaveLength(1);
    expect(new Date(expenses[0].date).toISOString()).toBe(incidentDate.toISOString());
    expect(new Date(expenses[0].createdAt).getTime()).toBeGreaterThanOrEqual(beforeInput);
  });

  it("deducts stock when recording manual warehouse usage and restores it when reverted", async () => {
    const now = new Date();
    const itemId = await db.warehouseItems.add({
      name: "Beras 10 Liter",
      stock: 5,
      unit: "pcs",
      isCashierVisible: 0,
      isDailyReset: 0,
      isDeleted: 0,
      createdAt: now,
      updatedAt: now,
    });

    const logId = await recordWarehouseUsage({
      warehouseItemId: itemId,
      quantity: 2,
      purpose: "Masak nasi siang",
    });

    await expect(db.warehouseItems.get(itemId)).resolves.toMatchObject({ stock: 3 });
    await expect(db.warehouseUsageLogs.get(logId)).resolves.toMatchObject({
      warehouseItemName: "Beras 10 Liter",
      quantity: 2,
      purpose: "Masak nasi siang",
    });

    await revertWarehouseUsageLog(logId);

    await expect(db.warehouseItems.get(itemId)).resolves.toMatchObject({ stock: 5 });
    await expect(db.warehouseUsageLogs.get(logId)).resolves.toBeUndefined();
  });
});
