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
  };

  const storeName = settings.storeName || 'Toko_Saya';

  const response = await fetch('/api/backup', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      storeName,
      backupData: allData
    })
  });

  if (!response.ok) {
    let errorMessage = 'Gagal menyimpan backup ke server.';
    try {
      const errData = await response.json();
      if (errData.error) errorMessage = errData.error;
    } catch (e) {
      // Ignore JSON parse error
    }
    throw new Error(errorMessage);
  }

  // Update lastBackupAt on success
  await db.storeSettings.update(settings.id!, {
    lastBackupAt: new Date()
  });

  return true;
}
