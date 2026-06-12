import { db } from './db';

const VERCEL_BACKUP_BASE_URL = 'https://kasir-sabana.vercel.app';

export interface BackupPayload {
  version: number;
  exportedAt: string;
  categories: Awaited<ReturnType<typeof db.categories.toArray>>;
  products: Awaited<ReturnType<typeof db.products.toArray>>;
  suppliers: Awaited<ReturnType<typeof db.suppliers.toArray>>;
  stockIns: Awaited<ReturnType<typeof db.stockIns.toArray>>;
  stockOuts: Awaited<ReturnType<typeof db.stockOuts.toArray>>;
  hppHistory: Awaited<ReturnType<typeof db.hppHistory.toArray>>;
  paymentMethods: Awaited<ReturnType<typeof db.paymentMethods.toArray>>;
  transactions: Awaited<ReturnType<typeof db.transactions.toArray>>;
  transactionItems: Awaited<ReturnType<typeof db.transactionItems.toArray>>;
  storeSettings: Awaited<ReturnType<typeof db.storeSettings.toArray>>;
  users: Awaited<ReturnType<typeof db.users.toArray>>;
  units: Awaited<ReturnType<typeof db.units.toArray>>;
  warehouseItems: Awaited<ReturnType<typeof db.warehouseItems.toArray>>;
  productRecipes: Awaited<ReturnType<typeof db.productRecipes.toArray>>;
  productOptionGroups: Awaited<ReturnType<typeof db.productOptionGroups.toArray>>;
  productOptions: Awaited<ReturnType<typeof db.productOptions.toArray>>;
  productOptionRecipes: Awaited<ReturnType<typeof db.productOptionRecipes.toArray>>;
  dailyPrepFormulas: Awaited<ReturnType<typeof db.dailyPrepFormulas.toArray>>;
}

export interface PerformBackupOptions {
  silent?: boolean;
  reason?: 'manual' | 'auto';
}

export interface PerformBackupResult {
  fileId?: string;
  backedUpAt: Date;
}

export function resolveCloudApiUrl(path: '/api/backup' | '/api/restore') {
  const hostname = window.location.hostname;
  const isDirectCloudTarget =
    hostname === 'localhost' ||
    hostname === '127.0.0.1' ||
    hostname === '0.0.0.0' ||
    hostname === '::1' ||
    window.location.protocol === 'capacitor:';

  return isDirectCloudTarget ? `${VERCEL_BACKUP_BASE_URL}${path}` : path;
}

export async function getBackupPayload(): Promise<BackupPayload> {
  return {
    version: 6,
    exportedAt: new Date().toISOString(),
    categories: await db.categories.toArray(),
    products: await db.products.toArray(),
    suppliers: await db.suppliers.toArray(),
    stockIns: await db.stockIns.toArray(),
    stockOuts: await db.stockOuts.toArray(),
    hppHistory: await db.hppHistory.toArray(),
    paymentMethods: await db.paymentMethods.toArray(),
    transactions: await db.transactions.toArray(),
    transactionItems: await db.transactionItems.toArray(),
    storeSettings: await db.storeSettings.toArray(),
    users: await db.users.toArray(),
    units: await db.units.toArray(),
    warehouseItems: await db.warehouseItems.toArray(),
    productRecipes: await db.productRecipes.toArray(),
    productOptionGroups: await db.productOptionGroups.toArray(),
    productOptions: await db.productOptions.toArray(),
    productOptionRecipes: await db.productOptionRecipes.toArray(),
    dailyPrepFormulas: await db.dailyPrepFormulas.toArray(),
  };
}

export async function performBackup(options: PerformBackupOptions = {}): Promise<PerformBackupResult> {
  if (!navigator.onLine) {
    throw new Error('Tidak ada koneksi internet. Pastikan perangkat Anda online.');
  }

  const settings = await db.storeSettings.toCollection().first();
  if (!settings) {
    throw new Error('Pengaturan toko tidak ditemukan.');
  }

  const allData = await getBackupPayload();

  const storeName = settings.storeName || 'Toko_Saya';

  // Jika aplikasi berjalan di Android (Capacitor), kita harus menembak URL Vercel langsung
  // karena '/api/backup' hanya ada di server Vercel.
  const apiUrl = resolveCloudApiUrl('/api/backup');

  const response = await fetch(apiUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      storeName,
      backupData: allData,
      fileId: settings.googleDriveFileId
    })
  });

  if (!response.ok) {
    let errorMessage = 'Gagal menyimpan backup ke server.';
    try {
      const errData = await response.json();
      if (errData.error) errorMessage = errData.error;
    } catch (e) {
      // Jika response gagal di-parse sebagai JSON (misal karena URL salah/404)
      errorMessage = `Error ${response.status}: ${response.statusText}. Gagal terhubung ke Vercel.`;
    }
    throw new Error(errorMessage);
  }

  const responseData = await response.json().catch(() => ({} as { fileId?: string }));
  const backedUpAt = new Date();

  await db.storeSettings.update(settings.id!, {
    lastBackupAt: backedUpAt,
    lastCloudBackupAt: backedUpAt,
    ...(responseData.fileId ? { googleDriveFileId: responseData.fileId } : {})
  });

  return {
    fileId: responseData.fileId,
    backedUpAt
  };
}
