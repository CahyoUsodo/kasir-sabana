import Dexie, { type Table } from 'dexie';
import { generateUUID } from './utils';

// === Permission keys (CR-multiuser) ===
export type PermissionKey =
  | 'create_transaction'
  | 'delete_transaction'
  | 'manage_products'
  | 'manage_categories_payments'
  | 'manage_stock_inout'
  | 'manage_supplier'
  | 'view_reports'
  | 'manage_backup'
  | 'manage_store_settings';

export const ALL_PERMISSIONS: PermissionKey[] = [
  'create_transaction',
  'delete_transaction',
  'manage_products',
  'manage_categories_payments',
  'manage_stock_inout',
  'manage_supplier',
  'view_reports',
  'manage_backup',
  'manage_store_settings',
];

// === Interfaces ===

export interface User {
  id?: number;
  username: string;       // unique, lowercase
  pinHash: string;        // SHA-256 hex
  name: string;           // display name
  role: 'owner' | 'staff';
  permissions: PermissionKey[]; // owner ignores this (has all)
  isActive: number;       // 0/1 — IndexedDB can't index booleans
  createdAt: Date;
  lastLoginAt: Date | null;
}

export interface Category {
  id?: number;
  name: string;
  color: string;
  icon: string;
  createdAt: Date;
  isDeleted: number; // 0 = active, 1 = deleted (IndexedDB can't index booleans)
  deletedAt: Date | null;
}

export interface Product {
  id?: number;
  name: string;
  sku: string;
  categoryId: number;
  price: number; // harga jual
  hpp: number; // harga pokok penjualan
  stock: number;
  unit: string; // satuan: pcs, kg, liter, dll
  description?: string; // deskripsi/catatan produk (opsional, multi-line)
  photo?: string; // base64 or blob URL
  barcode?: string;
  createdAt: Date;
  updatedAt: Date;
  isDeleted: number; // 0 = active, 1 = deleted
  deletedAt: Date | null;
  createdBy?: number; // userId (optional — undefined for legacy/single-user mode)
  updatedBy?: number; // userId
}

export interface Supplier {
  id?: number;
  name: string;
  phone: string;
  address: string;
  notes: string;
  createdAt: Date;
  isDeleted: number; // 0 = active, 1 = deleted
  deletedAt: Date | null;
}

export interface StockIn {
  id?: number;
  productId: number;
  supplierId: number;
  quantity: number;
  buyPrice: number; // harga beli per unit
  totalPrice: number;
  date: Date;
  notes: string;
  createdBy?: number; // userId
}

export interface StockOut {
  id?: number;
  productId: number;
  quantity: number;
  reason: string; // rusak, hilang, retur, dll
  date: Date;
  notes: string;
  createdBy?: number; // userId
}

export interface HppHistory {
  id?: number;
  productId: number;
  oldHpp: number;
  newHpp: number;
  source: 'stock_in' | 'manual';
  date: Date;
}

export interface PaymentMethod {
  id?: number;
  name: string;
  category: string; // tunai, transfer, e-wallet, qris
  isDefault: boolean;
  createdAt: Date;
}

export interface Transaction {
  id?: number;
  subtotal: number;
  discountType: 'percentage' | 'nominal' | null;
  discountValue: number;
  discountAmount: number;
  total: number;
  paymentMethodId: number;
  paymentAmount: number;
  change: number;
  profit: number;
  date: Date;
  receiptNumber: string;
  status: 'open' | 'completed';
  orderNumber?: string;
  customerName?: string;
  tableNumber?: string;
  remarks?: string;
  openedAt?: Date;
  closedAt?: Date;
  createdBy?: number; // userId — kasir pembuat transaksi
  serviceType?: 'dine_in' | 'take_away';
}

export interface TransactionItemRecord {
  id?: number;
  transactionId: number;
  productId: number;
  productName: string;
  quantity: number;
  price: number;
  hpp: number;
  discountType: 'percentage' | 'nominal' | null;
  discountValue: number;
  discountAmount: number;
  subtotal: number;
  notes?: string;
}

export interface Unit {
  id?: number;
  name: string; // satuan: pcs, kg, liter, dll
  isDefault: number; // 0 = user-added, 1 = seeded default
  createdAt: Date;
  isDeleted: number; // 0 = active, 1 = deleted
  deletedAt: Date | null;
}

export interface StoreSettings {
  id?: number;
  storeName: string;
  address: string;
  phone: string;
  receiptFooter: string;
  onboardingDone: boolean;
  lastBackupAt: Date | null;
  themeColor?: string; // HSL hue string e.g. "25" for orange
  logo?: string; // base64 JPEG compressed via compressImage()
  deviceId: string;
  multiUserEnabled?: boolean; // CR-multiuser: opt-in flag
  googleDriveFileId?: string; // CR-multi-branch: specific file ID for this branch
  securityPin?: string; // Hashed 6-digit security PIN
}

export interface WarehouseItem {
  id?: number;
  name: string; // e.g. "Paha Bawah", "Bungkus Kulit", "Plastik Kecil", "Saus Sambal"
  stock: number;
  unit: string;
  isCashierVisible: number; // 0 = no, 1 = yes
  price?: number; // selling price at cashier (default 0)
  isDailyReset: number; // 0 = no, 1 = yes (for chicken pieces or opening preps)
  lastPreparedDate?: string; // YYYY-MM-DD
  dailyPrepQty?: number; // total quantity of this batch/item prepped today
  dailyPrepFactor?: number; // formula factor per batch prepared (default 1)
  photo?: string; // base64 JPEG compressed via compressImage()
  isDeleted: number; // 0 = active, 1 = deleted
  createdAt: Date;
  updatedAt: Date;
}

export interface ProductRecipe {
  id?: number;
  productId: number;
  warehouseItemId: number;
  quantity: number; // quantity of warehouse item consumed
}

export interface DailyPrepFormula {
  id?: number;
  prepItemId: number;    // ID of the item being prepared (e.g. Ayam Potong 9)
  targetItemId: number;  // ID of the target warehouse item (e.g. Dada)
  factor: number;        // Quantity added per 1 unit of prepItem
}

// === Database ===

class PosDatabase extends Dexie {
  categories!: Table<Category>;
  products!: Table<Product>;
  suppliers!: Table<Supplier>;
  stockIns!: Table<StockIn>;
  stockOuts!: Table<StockOut>;
  hppHistory!: Table<HppHistory>;
  paymentMethods!: Table<PaymentMethod>;
  transactions!: Table<Transaction>;
  transactionItems!: Table<TransactionItemRecord>;
  storeSettings!: Table<StoreSettings>;
  users!: Table<User>;
  units!: Table<Unit>;
  warehouseItems!: Table<WarehouseItem>;
  productRecipes!: Table<ProductRecipe>;
  dailyPrepFormulas!: Table<DailyPrepFormula>;

  constructor() {
    super('kasirgratisan-db');

    // Version 1 — original schema (must remain for migration path)
    this.version(1).stores({
      categories: '++id, name',
      products: '++id, name, sku, categoryId, barcode',
      suppliers: '++id, name',
      stockIns: '++id, productId, supplierId, date',
      stockOuts: '++id, productId, date',
      hppHistory: '++id, productId, date',
      paymentMethods: '++id, name, category',
      transactions: '++id, date, receiptNumber, paymentMethodId',
      storeSettings: '++id',
    });

    // Version 2 — CR-1 to CR-5
    this.version(2).stores({
      categories: '++id, name, isDeleted',
      products: '++id, name, sku, categoryId, barcode, isDeleted',
      suppliers: '++id, name, isDeleted',
      stockIns: '++id, productId, supplierId, date',
      stockOuts: '++id, productId, date',
      hppHistory: '++id, productId, date',
      paymentMethods: '++id, name, category',
      transactions: '++id, date, &receiptNumber, paymentMethodId',
      transactionItems: '++id, transactionId, productId',
      storeSettings: '++id',
    }).upgrade(async (tx) => {
      // CR-2: Set soft delete defaults on existing records
      const catTable = tx.table('categories');
      await catTable.toCollection().modify((cat: any) => {
        cat.isDeleted = 0;
        cat.deletedAt = null;
      });

      const prodTable = tx.table('products');
      await prodTable.toCollection().modify((prod: any) => {
        prod.isDeleted = 0;
        prod.deletedAt = null;
      });

      const supTable = tx.table('suppliers');
      await supTable.toCollection().modify((sup: any) => {
        sup.isDeleted = 0;
        sup.deletedAt = null;
      });

      // CR-1: Generate deviceId for existing storeSettings
      const storeTable = tx.table('storeSettings');
      await storeTable.toCollection().modify((s: any) => {
        s.deviceId = generateUUID();
      });

      // CR-5: Migrate embedded items[] from transactions to transactionItems table
      const txTable = tx.table('transactions');
      const itemsTable = tx.table('transactionItems');
      const allTx = await txTable.toArray();

      for (const t of allTx) {
        const items = (t as any).items;
        if (Array.isArray(items) && items.length > 0) {
          const records = items.map((item: any) => ({
            transactionId: t.id!,
            productId: item.productId,
            productName: item.productName,
            quantity: item.quantity,
            price: item.price,
            hpp: item.hpp,
            discountType: item.discountType,
            discountValue: item.discountValue,
            discountAmount: item.discountAmount,
            subtotal: item.subtotal,
          }));
          await itemsTable.bulkAdd(records);
        }
        // Remove embedded items field
        delete (t as any).items;
        await txTable.put(t);
      }
    });

    // Version 3 — Open Bill: status, orderNumber, customer/table, item notes
    this.version(3).stores({
      categories:       '++id, name, isDeleted',
      products:         '++id, name, sku, categoryId, barcode, isDeleted',
      suppliers:        '++id, name, isDeleted',
      stockIns:         '++id, productId, supplierId, date',
      stockOuts:        '++id, productId, date',
      hppHistory:       '++id, productId, date',
      paymentMethods:   '++id, name, category',
      transactions:     '++id, date, &receiptNumber, paymentMethodId, status, orderNumber',
      transactionItems: '++id, transactionId, productId',
      storeSettings:    '++id',
    }).upgrade(async (tx) => {
      // Set all existing transactions to 'completed' status
      await tx.table('transactions').toCollection().modify((t: any) => {
        t.status = 'completed';
      });
    });

    // Version 4 — SKU unique constraint
    this.version(4).stores({
      categories:       '++id, name, isDeleted',
      products:         '++id, name, &sku, categoryId, barcode, isDeleted',
      suppliers:        '++id, name, isDeleted',
      stockIns:         '++id, productId, supplierId, date',
      stockOuts:        '++id, productId, date',
      hppHistory:       '++id, productId, date',
      paymentMethods:   '++id, name, category',
      transactions:     '++id, date, &receiptNumber, paymentMethodId, status, orderNumber',
      transactionItems: '++id, transactionId, productId',
      storeSettings:    '++id',
    }).upgrade(async (tx) => {
      // Deduplicate SKUs before applying unique constraint
      const prodTable = tx.table('products');
      const allProducts = await prodTable.toArray();
      const seenSku = new Map<string, number>(); // sku -> first occurrence index

      for (const p of allProducts) {
        const sku = (p as any).sku as string | undefined;
        if (!sku || sku.trim() === '') continue;

        if (seenSku.has(sku)) {
          // Duplicate SKU found — append suffix to make unique
          let counter = 1;
          let newSku = `${sku}_dup${counter}`;
          while (seenSku.has(newSku)) {
            counter++;
            newSku = `${sku}_dup${counter}`;
          }
          seenSku.set(newSku, (p as any).id);
          await prodTable.update((p as any).id!, { sku: newSku });
        } else {
          seenSku.set(sku, (p as any).id);
        }
      }
    });

    // Version 5 — Units master table (CRUD-able from Settings)
    this.version(5).stores({
      categories:       '++id, name, isDeleted',
      products:         '++id, name, &sku, categoryId, barcode, isDeleted',
      suppliers:        '++id, name, isDeleted',
      stockIns:         '++id, productId, supplierId, date',
      stockOuts:        '++id, productId, date',
      hppHistory:       '++id, productId, date',
      paymentMethods:   '++id, name, category',
      transactions:     '++id, date, &receiptNumber, paymentMethodId, status, orderNumber',
      transactionItems: '++id, transactionId, productId',
      storeSettings:    '++id',
      units:            '++id, &name, isDeleted',
    }).upgrade(async (tx) => {
      // Seed default units + harvest unique units already used by products
      const unitsTable = tx.table('units');
      const prodTable = tx.table('products');
      const now = new Date();

      const defaults = ['pcs', 'porsi', 'botol'];
      const seen = new Set<string>();

      for (const name of defaults) {
        seen.add(name);
        await unitsTable.add({
          name,
          isDefault: 1,
          createdAt: now,
          isDeleted: 0,
          deletedAt: null,
        });
      }

      // Harvest custom units already used by existing products (e.g. 'mangkok', 'gelas')
      const allProducts = await prodTable.toArray();
      for (const p of allProducts) {
        const u = ((p as any).unit as string | undefined)?.trim();
        if (!u) continue;
        if (seen.has(u)) continue;
        seen.add(u);
        try {
          await unitsTable.add({
            name: u,
            isDefault: 0,
            createdAt: now,
            isDeleted: 0,
            deletedAt: null,
          });
        } catch {
          // ignore unique-constraint races
        }
      }
    });

    // Version 6 — Multi-user (opt-in) + audit trail (createdBy/updatedBy)
    // Notes:
    //   * `users` is a NEW table; existing data is untouched.
    //   * No createdBy/updatedBy is back-filled — existing rows keep undefined,
    //     UI handles that as "—" (legacy).
    //   * `multiUserEnabled` defaults to false → app behaves exactly like before
    //     until owner activates the feature from Settings.
    this.version(6).stores({
      categories:       '++id, name, isDeleted',
      products:         '++id, name, &sku, categoryId, barcode, isDeleted, createdBy, updatedBy',
      suppliers:        '++id, name, isDeleted',
      stockIns:         '++id, productId, supplierId, date, createdBy',
      stockOuts:        '++id, productId, date, createdBy',
      hppHistory:       '++id, productId, date',
      paymentMethods:   '++id, name, category',
      transactions:     '++id, date, &receiptNumber, paymentMethodId, status, orderNumber, createdBy',
      transactionItems: '++id, transactionId, productId',
      storeSettings:    '++id',
      units:            '++id, &name, isDeleted',
      users:            '++id, &username, role, isActive',
    }).upgrade(async (tx) => {
      // Default multiUserEnabled = false on existing storeSettings
      const storeTable = tx.table('storeSettings');
      await storeTable.toCollection().modify((s: Partial<StoreSettings>) => {
        if (s.multiUserEnabled === undefined) s.multiUserEnabled = false;
      });
    });

    // Version 7 — Security PIN for destructive actions
    this.version(7).stores({
      categories:       '++id, name, isDeleted',
      products:         '++id, name, &sku, categoryId, barcode, isDeleted, createdBy, updatedBy',
      suppliers:        '++id, name, isDeleted',
      stockIns:         '++id, productId, supplierId, date, createdBy',
      stockOuts:        '++id, productId, date, createdBy',
      hppHistory:       '++id, productId, date',
      paymentMethods:   '++id, name, category',
      transactions:     '++id, date, &receiptNumber, paymentMethodId, status, orderNumber, createdBy',
      transactionItems: '++id, transactionId, productId',
      storeSettings:    '++id',
      units:            '++id, &name, isDeleted',
      users:            '++id, &username, role, isActive',
    });

    // Version 8 — Warehouse & Recipe Mapping
    this.version(8).stores({
      categories:       '++id, name, isDeleted',
      products:         '++id, name, &sku, categoryId, barcode, isDeleted, createdBy, updatedBy',
      suppliers:        '++id, name, isDeleted',
      stockIns:         '++id, productId, supplierId, date, createdBy',
      stockOuts:        '++id, productId, date, createdBy',
      hppHistory:       '++id, productId, date',
      paymentMethods:   '++id, name, category',
      transactions:     '++id, date, &receiptNumber, paymentMethodId, status, orderNumber, createdBy',
      transactionItems: '++id, transactionId, productId',
      storeSettings:    '++id',
      units:            '++id, &name, isDeleted',
      users:            '++id, &username, role, isActive',
      warehouseItems:   '++id, name, isDeleted, isCashierVisible, isDailyReset',
      productRecipes:   '++id, productId, warehouseItemId',
    });

    // Version 9 — Warehouse photos & Prep Factors/Tracking
    this.version(9).stores({
      categories:       '++id, name, isDeleted',
      products:         '++id, name, &sku, categoryId, barcode, isDeleted, createdBy, updatedBy',
      suppliers:        '++id, name, isDeleted',
      stockIns:         '++id, productId, supplierId, date, createdBy',
      stockOuts:        '++id, productId, date, createdBy',
      hppHistory:       '++id, productId, date',
      paymentMethods:   '++id, name, category',
      transactions:     '++id, date, &receiptNumber, paymentMethodId, status, orderNumber, createdBy',
      transactionItems: '++id, transactionId, productId',
      storeSettings:    '++id',
      units:            '++id, &name, isDeleted',
      users:            '++id, &username, role, isActive',
      warehouseItems:   '++id, name, isDeleted, isCashierVisible, isDailyReset',
      productRecipes:   '++id, productId, warehouseItemId',
    }).upgrade(async (tx) => {
      const whTable = tx.table('warehouseItems');
      await whTable.toCollection().modify((item: Partial<WarehouseItem>) => {
        if (item.dailyPrepQty === undefined) item.dailyPrepQty = 0;
        if (item.dailyPrepFactor === undefined) {
          // Backward-compatible defaults for chicken items
          if (item.name === 'Paha Bawah') item.dailyPrepFactor = 2;
          else if (item.name === 'Paha Atas') item.dailyPrepFactor = 2;
          else if (item.name === 'Sayap') item.dailyPrepFactor = 2;
          else if (item.name === 'Dada') item.dailyPrepFactor = 3;
          else item.dailyPrepFactor = 1;
        }
      });
    });

    // Version 10 — Custom Daily Prep Formulas & renaming to Persiapan Harian
    this.version(10).stores({
      categories:       '++id, name, isDeleted',
      products:         '++id, name, &sku, categoryId, barcode, isDeleted, createdBy, updatedBy',
      suppliers:        '++id, name, isDeleted',
      stockIns:         '++id, productId, supplierId, date, createdBy',
      stockOuts:        '++id, productId, date, createdBy',
      hppHistory:       '++id, productId, date',
      paymentMethods:   '++id, name, category',
      transactions:     '++id, date, &receiptNumber, paymentMethodId, status, orderNumber, createdBy',
      transactionItems: '++id, transactionId, productId',
      storeSettings:    '++id',
      units:            '++id, &name, isDeleted',
      users:            '++id, &username, role, isActive',
      warehouseItems:   '++id, name, isDeleted, isCashierVisible, isDailyReset',
      productRecipes:   '++id, productId, warehouseItemId',
      dailyPrepFormulas: '++id, prepItemId, targetItemId',
    });

    // Version 11 - indexes for recipe/formula upserts
    this.version(11).stores({
      categories:       '++id, name, isDeleted',
      products:         '++id, name, &sku, categoryId, barcode, isDeleted, createdBy, updatedBy',
      suppliers:        '++id, name, isDeleted',
      stockIns:         '++id, productId, supplierId, date, createdBy',
      stockOuts:        '++id, productId, date, createdBy',
      hppHistory:       '++id, productId, date',
      paymentMethods:   '++id, name, category',
      transactions:     '++id, date, &receiptNumber, paymentMethodId, status, orderNumber, createdBy',
      transactionItems: '++id, transactionId, productId',
      storeSettings:    '++id',
      units:            '++id, &name, isDeleted',
      users:            '++id, &username, role, isActive',
      warehouseItems:   '++id, name, isDeleted, isCashierVisible, isDailyReset',
      productRecipes:   '++id, productId, warehouseItemId, [productId+warehouseItemId]',
      dailyPrepFormulas: '++id, prepItemId, targetItemId, [prepItemId+targetItemId]',
    }).upgrade(async (tx) => {
      const recipeTable = tx.table('productRecipes');
      const recipes = await recipeTable.toArray();
      const seenRecipes = new Set<string>();
      for (const recipe of recipes) {
        const key = `${recipe.productId}:${recipe.warehouseItemId}`;
        if (seenRecipes.has(key)) {
          await recipeTable.delete(recipe.id);
        } else {
          seenRecipes.add(key);
        }
      }

      const formulaTable = tx.table('dailyPrepFormulas');
      const formulas = await formulaTable.toArray();
      const seenFormulas = new Set<string>();
      for (const formula of formulas) {
        const key = `${formula.prepItemId}:${formula.targetItemId}`;
        if (seenFormulas.has(key)) {
          await formulaTable.delete(formula.id);
        } else {
          seenFormulas.add(key);
        }
      }
    });
  }
}

export const db = new PosDatabase();

export async function upsertProductRecipe(productId: number, warehouseItemId: number, quantity: number) {
  const existing = await db.productRecipes
    .where('[productId+warehouseItemId]')
    .equals([productId, warehouseItemId])
    .first();

  if (existing?.id) {
    await db.productRecipes.update(existing.id, { quantity });
    return existing.id;
  }

  return db.productRecipes.add({ productId, warehouseItemId, quantity });
}

export async function ensureProductWarehouseLink(product: Product) {
  const existingRecipes = await db.productRecipes.where('productId').equals(product.id!).toArray();
  const activeWarehouseItems = await db.warehouseItems.where('isDeleted').equals(0).toArray();
  const linkedWarehouseItem = existingRecipes
    .map(recipe => activeWarehouseItems.find(item => item.id === recipe.warehouseItemId))
    .find(Boolean);

  if (linkedWarehouseItem) return linkedWarehouseItem;

  const now = new Date();
  const matchingWarehouseItem = activeWarehouseItems.find(
    item => item.name.trim().toLowerCase() === product.name.trim().toLowerCase()
  );

  const warehouseItemId = matchingWarehouseItem?.id ?? await db.warehouseItems.add({
    name: product.name.trim(),
    stock: product.stock || 0,
    unit: product.unit || 'pcs',
    isCashierVisible: 0,
    price: 0,
    isDailyReset: 0,
    lastPreparedDate: '',
    dailyPrepQty: 0,
    dailyPrepFactor: 1,
    isDeleted: 0,
    createdAt: now,
    updatedAt: now,
  });

  await upsertProductRecipe(product.id!, warehouseItemId, 1);
  return db.warehouseItems.get(warehouseItemId);
}

export async function upsertDailyPrepFormula(prepItemId: number, targetItemId: number, factor: number) {
  const existing = await db.dailyPrepFormulas
    .where('[prepItemId+targetItemId]')
    .equals([prepItemId, targetItemId])
    .first();

  if (existing?.id) {
    await db.dailyPrepFormulas.update(existing.id, { factor });
    return existing.id;
  }

  return db.dailyPrepFormulas.add({ prepItemId, targetItemId, factor });
}

// Helper to adjust warehouse stock during checkout or cancels
export async function adjustWarehouseStock(productId: number, qtyDelta: number) {
  if (productId < 0) {
    const warehouseItemId = Math.abs(productId);
    const item = await db.warehouseItems.get(warehouseItemId);
    if (item) {
      await db.warehouseItems.update(warehouseItemId, {
        stock: Math.max(0, item.stock - qtyDelta),
        updatedAt: new Date()
      });
    }
  } else {
    const recipes = await db.productRecipes.where('productId').equals(productId).toArray();
    for (const recipe of recipes) {
      const item = await db.warehouseItems.get(recipe.warehouseItemId);
      if (item) {
        await db.warehouseItems.update(recipe.warehouseItemId, {
          stock: Math.max(0, item.stock - (recipe.quantity * qtyDelta)),
          updatedAt: new Date()
        });
      }
    }
  }
}

// Seed default data
export async function seedDefaultData() {
  const categoryCount = await db.categories.count();
  if (categoryCount === 0) {
    await db.categories.bulkAdd([
      { name: 'Makanan', color: '#FF6B35', icon: '🍕', createdAt: new Date(), isDeleted: 0, deletedAt: null },
      { name: 'Minuman', color: '#4ECDC4', icon: '🥤', createdAt: new Date(), isDeleted: 0, deletedAt: null },
      { name: 'Lainnya', color: '#95A5A6', icon: '📦', createdAt: new Date(), isDeleted: 0, deletedAt: null },
    ]);
  }

  const warehouseCount = await db.warehouseItems.count();
  if (warehouseCount === 0) {
    const now = new Date();
    await db.warehouseItems.bulkAdd([
      { name: 'Paha Bawah', stock: 0, unit: 'pcs', isCashierVisible: 0, isDailyReset: 1, lastPreparedDate: '', isDeleted: 0, createdAt: now, updatedAt: now },
      { name: 'Paha Atas', stock: 0, unit: 'pcs', isCashierVisible: 0, isDailyReset: 1, lastPreparedDate: '', isDeleted: 0, createdAt: now, updatedAt: now },
      { name: 'Sayap', stock: 0, unit: 'pcs', isCashierVisible: 0, isDailyReset: 1, lastPreparedDate: '', isDeleted: 0, createdAt: now, updatedAt: now },
      { name: 'Dada', stock: 0, unit: 'pcs', isCashierVisible: 0, isDailyReset: 1, lastPreparedDate: '', isDeleted: 0, createdAt: now, updatedAt: now },
      { name: 'Plastik Kecil', stock: 100, unit: 'pcs', isCashierVisible: 1, price: 200, isDailyReset: 0, isDeleted: 0, createdAt: now, updatedAt: now },
      { name: 'Plastik Besar', stock: 100, unit: 'pcs', isCashierVisible: 1, price: 500, isDailyReset: 0, isDeleted: 0, createdAt: now, updatedAt: now },
      { name: 'Saus Sambal Saset', stock: 500, unit: 'pcs', isCashierVisible: 1, price: 300, isDailyReset: 0, isDeleted: 0, createdAt: now, updatedAt: now },
      { name: 'Saus Tomat Saset', stock: 500, unit: 'pcs', isCashierVisible: 1, price: 300, isDailyReset: 0, isDeleted: 0, createdAt: now, updatedAt: now },
    ]);
  }

  const pmCount = await db.paymentMethods.count();
  if (pmCount === 0) {
    await db.paymentMethods.bulkAdd([
      { name: 'Tunai', category: 'tunai', isDefault: true, createdAt: new Date() },
      { name: 'QRIS', category: 'qris', isDefault: false, createdAt: new Date() },
    ]);
  }

  const unitCount = await db.units.count();
  if (unitCount === 0) {
    const now = new Date();
    await db.units.bulkAdd([
      { name: 'pcs',     isDefault: 1, createdAt: now, isDeleted: 0, deletedAt: null },
      { name: 'porsi',   isDefault: 1, createdAt: now, isDeleted: 0, deletedAt: null },
      { name: 'botol',   isDefault: 1, createdAt: now, isDeleted: 0, deletedAt: null },
    ]);
  }

  const storeCount = await db.storeSettings.count();
  if (storeCount === 0) {
    await db.storeSettings.add({
      storeName: 'Toko Saya',
      address: '',
      phone: '',
      receiptFooter: 'Terima kasih atas kunjungan Anda!',
      onboardingDone: false,
      lastBackupAt: null,
      deviceId: generateUUID(),
    });
    // Fallback: if storeSettings exists but has no deviceId, generate one
    const settings = await db.storeSettings.toCollection().first();
    if (settings && !settings.deviceId) {
      await db.storeSettings.update(settings.id!, { deviceId: generateUUID() });
    }
  }

  // Auto-link chicken products to warehouse items if not already linked
  await autoLinkChickenRecipes();

  // Seed default daily prep formulas & Ayam Potong 9
  const now = new Date();
  const ayamPotongItem = await db.warehouseItems.where('name').equalsIgnoreCase('Ayam Potong 9').first();
  let ayamPotongId: number;
  if (!ayamPotongItem) {
    ayamPotongId = await db.warehouseItems.add({
      name: 'Ayam Potong 9',
      stock: 0,
      unit: 'ekor',
      isCashierVisible: 0,
      isDailyReset: 1,
      lastPreparedDate: '',
      dailyPrepQty: 0,
      dailyPrepFactor: 1,
      isDeleted: 0,
      createdAt: now,
      updatedAt: now
    });
  } else {
    ayamPotongId = ayamPotongItem.id!;
  }

  const formulaCount = await db.dailyPrepFormulas.count();
  if (formulaCount === 0) {
    const pahaBawah = await db.warehouseItems.where('name').equalsIgnoreCase('Paha Bawah').first();
    const pahaAtas = await db.warehouseItems.where('name').equalsIgnoreCase('Paha Atas').first();
    const sayap = await db.warehouseItems.where('name').equalsIgnoreCase('Sayap').first();
    const dada = await db.warehouseItems.where('name').equalsIgnoreCase('Dada').first();

    if (pahaBawah && pahaAtas && sayap && dada) {
      await db.dailyPrepFormulas.bulkAdd([
        { prepItemId: ayamPotongId, targetItemId: pahaBawah.id!, factor: 2 },
        { prepItemId: ayamPotongId, targetItemId: pahaAtas.id!, factor: 2 },
        { prepItemId: ayamPotongId, targetItemId: sayap.id!, factor: 2 },
        { prepItemId: ayamPotongId, targetItemId: dada.id!, factor: 3 },
      ]);
    }
  }
}

export async function autoLinkChickenRecipes() {
  const products = await db.products.where('isDeleted').equals(0).toArray();
  const whItems = await db.warehouseItems.where('isDeleted').equals(0).toArray();
  const recipes = await db.productRecipes.toArray();

  for (const p of products) {
    const pName = p.name.toLowerCase();
    const pDesc = (p.description || '').toLowerCase();
    const pSku = p.sku.toLowerCase();

    let matchedWhItemName: string | null = null;
    if (pName.includes('paha bawah') || pDesc.includes('paha bawah') || pSku.includes('pb')) {
      matchedWhItemName = 'Paha Bawah';
    } else if (pName.includes('paha atas') || pDesc.includes('paha atas') || pSku.includes('pa')) {
      matchedWhItemName = 'Paha Atas';
    } else if (pName.includes('sayap') || pDesc.includes('sayap') || pSku.includes('syp')) {
      matchedWhItemName = 'Sayap';
    } else if (pName.includes('dada') || pDesc.includes('dada') || pSku.includes('dd')) {
      matchedWhItemName = 'Dada';
    }

    if (matchedWhItemName) {
      const whItem = whItems.find(item => item.name.toLowerCase() === matchedWhItemName!.toLowerCase());
      if (whItem) {
        // Check if this specific link already exists
        const hasSpecificRecipe = recipes.some(r => r.productId === p.id && r.warehouseItemId === whItem.id);
        if (!hasSpecificRecipe) {
          // Check if there are other recipes for this product that link to DIFFERENT chicken items, and delete them
          const chickenWhItemIds = whItems
            .filter(item => ['paha bawah', 'paha atas', 'sayap', 'dada'].includes(item.name.toLowerCase()))
            .map(item => item.id!);
          
          const wrongChickenRecipes = recipes.filter(r => r.productId === p.id && chickenWhItemIds.includes(r.warehouseItemId) && r.warehouseItemId !== whItem.id);
          for (const wr of wrongChickenRecipes) {
            await db.productRecipes.delete(wr.id!);
          }

          await db.productRecipes.add({
            productId: p.id!,
            warehouseItemId: whItem.id!,
            quantity: 1
          });
        }
      }
    }
  }
}

