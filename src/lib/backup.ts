import { db } from './db';

export async function performBackup(): Promise<boolean> {
  if (!navigator.onLine) {
    throw new Error('Tidak ada koneksi internet. Pastikan perangkat Anda online.');
  }

  const settings = await db.storeSettings.toCollection().first();
  if (!settings) {
    throw new Error('Pengaturan toko tidak ditemukan.');
  }

  // Collect all data
  const allData = {
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

  const storeName = settings.storeName || 'Toko_Saya';

  // Jika aplikasi berjalan di Android (Capacitor), kita harus menembak URL Vercel langsung
  // karena '/api/backup' hanya ada di server Vercel.
  const isCapacitor = window.location.origin.includes('localhost') || window.location.protocol === 'capacitor:';
  const apiUrl = isCapacitor ? 'https://kasir-sabana-5bf1.vercel.app/api/backup' : '/api/backup';

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

  // Update lastBackupAt on success
  await db.storeSettings.update(settings.id!, {
    lastBackupAt: new Date()
  });

  return true;
}
