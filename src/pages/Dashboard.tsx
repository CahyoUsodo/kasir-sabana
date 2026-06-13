import { useLiveQuery } from 'dexie-react-hooks';
import { db, type TransactionItemRecord } from '@/lib/db';
import { useState } from 'react';
import { ShoppingCart, Package, BarChart3, TrendingUp, AlertTriangle, Receipt, ChevronRight, ClipboardList, Warehouse } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Link } from 'react-router-dom';
import { format } from 'date-fns';
import { id } from 'date-fns/locale';
import { Button } from '@/components/ui/button';
import BackupReminder, { shouldShowBackupReminder } from '@/components/BackupReminder';
import { useAuth } from '@/hooks/use-auth';
import type { PermissionKey } from '@/lib/db';
import { performBackup } from '@/lib/backup';
import { toast } from 'sonner';

export default function Dashboard() {
  const { can } = useAuth();
  const [backupDismissed, setBackupDismissed] = useState(false);
  const [isCloudBackuping, setIsCloudBackuping] = useState(false);

  const storeSettings = useLiveQuery(() => db.storeSettings.toCollection().first());

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const todayTransactions = useLiveQuery(async () => {
    const all = await db.transactions.where('date').aboveOrEqual(today).toArray();
    return all.filter(t => t.status !== 'open');
  }, []);

  const openBillsCount = useLiveQuery(async () => {
    const open = await db.transactions.where('status').equals('open').toArray();
    return open.length;
  }, []);

  const lowStockProducts = useLiveQuery(async () => {
    const products = await db.products.where('isDeleted').equals(0).toArray();
    const productRecipes = await db.productRecipes.toArray();
    const visibleWarehouseItems = await db.warehouseItems.where('isDeleted').equals(0).toArray();
    const todayStr = new Date().toLocaleDateString('en-CA');
    const normalizedName = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

    const merged = new Map<string, { id: string; name: string; stock: number; unit: string; priority: number }>();
    const upsert = (entry: { id: string; name: string; stock: number; unit: string; priority: number }) => {
      const key = normalizedName(entry.name) || entry.id;
      const existing = merged.get(key);
      if (!existing || entry.priority > existing.priority || (entry.priority === existing.priority && entry.stock < existing.stock)) {
        merged.set(key, { ...entry, stock: Math.max(0, entry.stock) });
      }
    };

    for (const p of products) {
      const recipes = productRecipes.filter(r => r.productId === p.id);
      if (recipes.length > 0) {
        let minStock = Infinity;
        for (const recipe of recipes) {
          const whItem = visibleWarehouseItems.find(wi => wi.id === recipe.warehouseItemId);
          if (whItem) {
            const isResetToday = whItem.isDailyReset === 1 && whItem.lastPreparedDate !== todayStr;
            const effectiveStock = isResetToday ? 0 : whItem.stock;
            const available = Math.floor(effectiveStock / recipe.quantity);
            if (available < minStock) {
              minStock = available;
            }
          } else {
            minStock = 0;
          }
        }
        upsert({
          id: `product-${p.id}`,
          name: p.name,
          stock: minStock === Infinity ? 0 : minStock,
          unit: p.unit,
          priority: 3,
        });
        continue;
      }
      upsert({
        id: `product-${p.id}`,
        name: p.name,
        stock: p.stock,
        unit: p.unit,
        priority: 1,
      });
    }

    for (const item of visibleWarehouseItems.filter(wi => wi.isCashierVisible === 1)) {
      upsert({
        id: `warehouse-${item.id}`,
        name: item.name,
        stock: item.stock,
        unit: item.unit,
        priority: 4,
      });
    }

    return Array.from(merged.values()).filter(item => item.stock <= 5);
  }, []);

  const recentTransactions = useLiveQuery(async () => {
    const rows = await db.transactions.orderBy('date').reverse().toArray();
    return rows.filter(tx => tx.status !== 'open').slice(0, 5);
  });

  // Query items for recent transactions
  const recentTxItems = useLiveQuery(async () => {
    if (!recentTransactions || recentTransactions.length === 0) return {};
    const txIds = recentTransactions.map(t => t.id!).filter(Boolean);
    const items = await db.transactionItems.where('transactionId').anyOf(txIds).toArray();
    const map: Record<number, TransactionItemRecord[]> = {};
    for (const item of items) {
      if (!map[item.transactionId]) map[item.transactionId] = [];
      map[item.transactionId].push(item);
    }
    return map;
  }, [recentTransactions]);

  const paymentMethods = useLiveQuery(() => db.paymentMethods.toArray());

  // Show onboarding if not done yet
  if (storeSettings === undefined) return null; // loading

  const totalSales = todayTransactions?.reduce((sum, t) => sum + t.total, 0) ?? 0;
  const totalProfit = todayTransactions?.reduce((sum, t) => sum + t.profit, 0) ?? 0;
  const txCount = todayTransactions?.length ?? 0;

  const lastCloudBackupAt = storeSettings?.lastCloudBackupAt ?? storeSettings?.lastBackupAt ?? null;
  const showBackup = !backupDismissed && storeSettings && shouldShowBackupReminder(lastCloudBackupAt) && can('manage_backup');

  const handleCloudBackupReminder = async () => {
    if (isCloudBackuping) return;
    setIsCloudBackuping(true);
    try {
      await performBackup({ reason: 'manual' });
      setBackupDismissed(true);
      toast.success('Backup cloud berhasil disimpan');
    } catch (error: any) {
      console.error(error);
      toast.error(error?.message || 'Gagal melakukan backup cloud');
    } finally {
      setIsCloudBackuping(false);
    }
  };

  const quickActions: { to: string; icon: typeof ShoppingCart; label: string; color: string; perm?: PermissionKey }[] = [
    { to: '/cashier', icon: ShoppingCart, label: 'Kasir', color: 'bg-primary/10 text-primary', perm: 'create_transaction' },
    { to: '/products', icon: Package, label: 'Produk', color: 'bg-accent/10 text-accent' },
    { to: '/warehouse', icon: Warehouse, label: 'Gudang & Resep', color: 'bg-amber-100 text-amber-700' },
    { to: '/reports', icon: BarChart3, label: 'Laporan', color: 'bg-success/10 text-success', perm: 'view_reports' },
  ];
  const visibleActions = quickActions.filter((a) => !a.perm || can(a.perm));
  const getRecentTxLabel = (txId: number, receiptNumber: string) => {
    const names = (recentTxItems?.[txId] ?? []).map(item => item.productName).filter(Boolean);
    if (names.length > 0) return names.join(', ');
    return receiptNumber;
  };

  return (
    <div className="px-4 pt-6 space-y-5">
      {/* Header */}
      <div>
        <p className="text-sm text-muted-foreground">{format(new Date(), 'EEEE, d MMMM yyyy', { locale: id })}</p>
        <h1 className="text-2xl font-bold tracking-tight">{storeSettings?.storeName || 'Aplikasi Kasir'}</h1>
      </div>

      {/* Backup Reminder */}
      {showBackup && (
        <BackupReminder
          lastBackupAt={lastCloudBackupAt}
          onDismiss={() => setBackupDismissed(true)}
          onBackup={handleCloudBackupReminder}
          buttonLabel={isCloudBackuping ? 'Menyimpan Cloud...' : 'Backup Cloud Sekarang'}
        />
      )}

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card className="border-0 shadow-sm bg-primary text-primary-foreground">
          <CardContent className="p-4">
            <p className="text-xs opacity-80">Penjualan Hari Ini</p>
            <p className="text-xl font-bold mt-1">Rp {totalSales.toLocaleString('id-ID')}</p>
            <p className="text-xs opacity-70 mt-1">{txCount} transaksi</p>
          </CardContent>
        </Card>
        {can('view_reports') && (
          <Card className="border-0 shadow-sm">
            <CardContent className="p-4">
              <div className="flex items-center gap-1.5 text-success">
                <TrendingUp className="w-4 h-4" />
                <p className="text-xs font-medium">Profit Hari Ini</p>
              </div>
              <p className="text-xl font-bold mt-1">Rp {totalProfit.toLocaleString('id-ID')}</p>
            </CardContent>
          </Card>
        )}
      </div>

      {/* Open Bills */}
      {openBillsCount != null && openBillsCount > 0 && (
        <Link to="/cashier">
          <Card className="border-0 shadow-sm bg-warning/10 hover:shadow-md transition-shadow cursor-pointer mt-2">
            <CardContent className="p-4 flex items-center gap-4">
              <div className="w-10 h-10 rounded-xl bg-warning/20 text-warning flex items-center justify-center shrink-0">
                <ClipboardList className="w-5 h-5" />
              </div>
              <div className="flex-1">
                <p className="text-sm font-semibold">Open Bills</p>
                <p className="text-xs text-muted-foreground">{openBillsCount} bill menunggu pembayaran</p>
              </div>
              <ChevronRight className="w-4 h-4 text-muted-foreground" />
            </CardContent>
          </Card>
        </Link>
      )}

      {/* Quick Actions */}
      {visibleActions.length > 0 && (
        <div>
          <h2 className="text-sm font-semibold text-muted-foreground mb-3">Akses Cepat</h2>
          <div className={`grid gap-3 ${visibleActions.length === 1 ? 'grid-cols-1' : visibleActions.length === 2 ? 'grid-cols-2' : visibleActions.length === 3 ? 'grid-cols-3' : 'grid-cols-2 md:grid-cols-4'}`}>
            {visibleActions.map(({ to, icon: Icon, label, color }) => (
              <Link key={to} to={to}>
                <Card className="border-0 shadow-sm hover:shadow-md transition-shadow">
                  <CardContent className="p-4 flex flex-col items-center gap-2">
                    <div className={`w-11 h-11 rounded-xl flex items-center justify-center ${color}`}>
                      <Icon className="w-5 h-5" />
                    </div>
                    <span className="text-xs font-semibold">{label}</span>
                  </CardContent>
                </Card>
              </Link>
            ))}
          </div>
        </div>
      )}

      {/* Recent Transactions */}
      {recentTransactions && recentTransactions.length > 0 && (
        <div>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold text-muted-foreground flex items-center gap-1.5">
              <Receipt className="w-4 h-4 text-primary" />
              Transaksi Terakhir
            </h2>
            <Link to="/history">
              <Button variant="ghost" size="sm" className="h-7 text-xs gap-1 text-primary">
                Lihat Semua <ChevronRight className="w-3 h-3" />
              </Button>
            </Link>
          </div>
          <div className="space-y-2">
            {recentTransactions.map(tx => (
              <Link key={tx.id ?? tx.receiptNumber} to={`/history?txId=${tx.id ?? tx.receiptNumber}`}>
                <Card className="border-0 shadow-sm hover:shadow-md transition-shadow mb-2">
                  <CardContent className="p-3 flex items-center gap-3">
                    <div className="w-9 h-9 rounded-lg bg-primary/10 text-primary flex items-center justify-center shrink-0">
                      <Receipt className="w-4 h-4" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between">
                        <p className="text-xs text-muted-foreground truncate">{getRecentTxLabel(tx.id!, tx.receiptNumber)}</p>
                        <p className="text-[10px] text-muted-foreground shrink-0 ml-2">{format(new Date(tx.date), 'dd MMM, HH:mm', { locale: id })}</p>
                      </div>
                      <div className="flex items-center justify-between mt-0.5">
                        <p className="text-sm font-bold text-primary">Rp {tx.total.toLocaleString('id-ID')}</p>
                        <p className="text-[10px] text-muted-foreground">{paymentMethods?.find(pm => pm.id === tx.paymentMethodId)?.name || 'Tunai'}</p>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </Link>
            ))}
          </div>
        </div>
      )}

      {/* Low Stock Alert */}
      {lowStockProducts && lowStockProducts.length > 0 && (
        <div>
          <h2 className="text-sm font-semibold text-muted-foreground mb-3 flex items-center gap-1.5">
            <AlertTriangle className="w-4 h-4 text-warning" />
            Stok Menipis
          </h2>
          <div className="space-y-2">
            {lowStockProducts.slice(0, 5).map(product => (
              <Card key={product.id} className="border-0 shadow-sm">
                <CardContent className="p-3 flex items-center justify-between">
                  <span className="text-sm font-medium">{product.name}</span>
                  <span className="text-xs font-bold text-destructive bg-destructive/10 px-2 py-1 rounded-full">
                    Sisa {product.stock} {product.unit}
                  </span>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
