import { useLiveQuery } from 'dexie-react-hooks';
import { db, type TransactionItemRecord } from '@/lib/db';
import { useState } from 'react';
import { BarChart3, TrendingUp, ShoppingCart, Package, DollarSign, ArrowDown, ArrowUp, Minus, Download, PackageMinus } from 'lucide-react';
import type { Border, Borders, Fill, Style } from 'exceljs';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { BarChart, Bar, XAxis, YAxis, ResponsiveContainer, Tooltip } from 'recharts';
import { format, subDays, startOfDay, endOfDay, addDays } from 'date-fns';
import { id as localeId } from 'date-fns/locale';
import { CalendarIcon, X } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Calendar as CalendarPicker } from '@/components/ui/calendar';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { useAuth } from '@/hooks/use-auth';
import LockedPage from '@/components/LockedPage';

export default function Laporan() {
  function rp(n: number) {
    return `Rp ${n.toLocaleString('id-ID')}`;
  }

  const { can } = useAuth();
  const [period, setPeriod] = useState<'today' | '7' | '30' | 'custom'>('today');
  const [dateFrom, setDateFrom] = useState<Date | undefined>(undefined);
  const [dateTo, setDateTo] = useState<Date | undefined>(undefined);
  const days = period === 'custom' || period === 'today' ? 0 : Number(period);
  const getPresetStartDate = () => period === 'today'
    ? startOfDay(new Date())
    : startOfDay(subDays(new Date(), days));

  const transactions = useLiveQuery(async () => {
    if (period === 'custom') {
      if (dateFrom && dateTo) {
        return db.transactions.where('date').between(startOfDay(dateFrom), endOfDay(dateTo), true, true).toArray();
      } else if (dateFrom) {
        return db.transactions.where('date').aboveOrEqual(startOfDay(dateFrom)).toArray();
      } else if (dateTo) {
        return db.transactions.where('date').belowOrEqual(endOfDay(dateTo)).toArray();
      }
      return []; // Return none if custom but no date selected to avoid pulling everything unnecessarily, or we could fetch all. Fetching all is bad for perf. Let's return none if no date filter.
    } else {
      const since = getPresetStartDate();
      return db.transactions.where('date').aboveOrEqual(since).toArray();
    }
  }, [days, period, dateFrom, dateTo]);

  // Query transaction items for the filtered transactions
  const txItems = useLiveQuery(async () => {
    if (!transactions || transactions.length === 0) return [];
    const txIds = transactions.map(t => t.id!).filter(Boolean);
    return db.transactionItems.where('transactionId').anyOf(txIds).toArray();
  }, [transactions]);

  const warehouseItems = useLiveQuery(() => db.warehouseItems.where('isDeleted').equals(0).toArray());
  const productRecipes = useLiveQuery(() => db.productRecipes.toArray());
  const productOptionRecipes = useLiveQuery(() => db.productOptionRecipes.toArray());
  const paymentMethods = useLiveQuery(() => db.paymentMethods.toArray());
  const dailyPrepFormulas = useLiveQuery(() => db.dailyPrepFormulas.toArray());
  const dailyExpenses = useLiveQuery(async () => {
    if (period === 'custom') {
      if (dateFrom && dateTo) {
        return db.dailyExpenses.where('date').between(startOfDay(dateFrom), endOfDay(dateTo), true, true).toArray();
      } else if (dateFrom) {
        return db.dailyExpenses.where('date').aboveOrEqual(startOfDay(dateFrom)).toArray();
      } else if (dateTo) {
        return db.dailyExpenses.where('date').belowOrEqual(endOfDay(dateTo)).toArray();
      }
      return [];
    }

    const since = getPresetStartDate();
    return db.dailyExpenses.where('date').aboveOrEqual(since).toArray();
  }, [days, period, dateFrom, dateTo]);
  const warehouseUsageLogs = useLiveQuery(async () => {
    if (period === 'custom') {
      if (dateFrom && dateTo) {
        return db.warehouseUsageLogs.where('date').between(startOfDay(dateFrom), endOfDay(dateTo), true, true).toArray();
      } else if (dateFrom) {
        return db.warehouseUsageLogs.where('date').aboveOrEqual(startOfDay(dateFrom)).toArray();
      } else if (dateTo) {
        return db.warehouseUsageLogs.where('date').belowOrEqual(endOfDay(dateTo)).toArray();
      }
      return [];
    }

    const since = getPresetStartDate();
    return db.warehouseUsageLogs.where('date').aboveOrEqual(since).toArray();
  }, [days, period, dateFrom, dateTo]);

  // Permission gate after all hooks have been called.
  if (!can('view_reports')) {
    return <LockedPage title="Laporan" permissionLabel="Lihat Laporan & Profit" />;
  }

  const allItems = txItems ?? [];

  const txCount = transactions?.length ?? 0;

  // P&L breakdown
  const totalRevenue = transactions?.reduce((s, t) => s + t.subtotal, 0) ?? 0;
  const totalDiscount = transactions?.reduce((s, t) => s + (t.discountAmount || 0), 0) ?? 0;
  const totalHpp = allItems.reduce((s, item) => s + item.hpp * item.quantity, 0);
  const netSales = totalRevenue - totalDiscount; // same as totalSales
  const grossProfit = netSales - totalHpp;
  const marginPercent = netSales > 0 ? (grossProfit / netSales * 100) : 0;
  const totalOperationalExpenses = (dailyExpenses ?? []).reduce((sum, item) => sum + item.amount, 0);
  const netProfitAfterExpenses = grossProfit - totalOperationalExpenses;
  const serviceTypeBreakdown = (transactions ?? []).reduce<Record<'dine_in' | 'take_away', { count: number; total: number }>>((acc, tx) => {
    const serviceType = tx.serviceType === 'take_away' ? 'take_away' : 'dine_in';
    acc[serviceType].count += 1;
    acc[serviceType].total += tx.total;
    return acc;
  }, {
    dine_in: { count: 0, total: 0 },
    take_away: { count: 0, total: 0 },
  });

  const txDiscountInfo: Record<number, { extraDiscount: number; itemSubtotalSum: number }> = {};
  transactions?.forEach(t => {
    const txItems = allItems.filter(item => item.transactionId === t.id);
    const itemDiscountSum = txItems.reduce((sum, item) => sum + (item.discountAmount || 0), 0);
    const itemSubtotalSum = txItems.reduce((sum, item) => sum + item.subtotal, 0);
    if (t.id) {
      txDiscountInfo[t.id] = {
        extraDiscount: Math.max(0, (t.discountAmount || 0) - itemDiscountSum),
        itemSubtotalSum,
      };
    }
  });

  const getAllocatedExtraDiscount = (item: TransactionItemRecord) => {
    const txId = item.transactionId;
    if (!txId) return 0;
    const info = txDiscountInfo[txId];
    if (!info || info.extraDiscount <= 0 || info.itemSubtotalSum <= 0) return 0;
    return (item.subtotal / info.itemSubtotalSum) * info.extraDiscount;
  };

  const paymentMethodById = new Map((paymentMethods ?? []).filter(pm => pm.id).map(pm => [pm.id!, pm]));
  const getPaymentBucket = (paymentMethodId: number): 'cash' | 'qris' | 'other' => {
    const method = paymentMethodById.get(paymentMethodId);
    const normalized = `${method?.name ?? ''} ${method?.category ?? ''}`.toLowerCase();
    if (normalized.includes('qris')) return 'qris';
    if (normalized.includes('tunai') || normalized.includes('cash')) return 'cash';
    return 'other';
  };

  const paymentSummary = (() => {
    const base = {
      cash: { txCount: 0, gross: 0, discount: 0, net: 0, hpp: 0, grossProfit: 0 },
      qris: { txCount: 0, gross: 0, discount: 0, net: 0, hpp: 0, grossProfit: 0 },
      other: { txCount: 0, gross: 0, discount: 0, net: 0, hpp: 0, grossProfit: 0 },
      total: { txCount, gross: totalRevenue, discount: totalDiscount, net: netSales, hpp: totalHpp, grossProfit },
    };

    const txById = new Map((transactions ?? []).filter(tx => tx.id).map(tx => [tx.id!, tx]));

    (transactions ?? []).forEach(tx => {
      const bucket = getPaymentBucket(tx.paymentMethodId);
      base[bucket].txCount += 1;
      base[bucket].gross += tx.subtotal;
      base[bucket].discount += tx.discountAmount || 0;
      base[bucket].net += tx.total;
    });

    allItems.forEach(item => {
      const tx = txById.get(item.transactionId);
      if (!tx) return;
      const bucket = getPaymentBucket(tx.paymentMethodId);
      base[bucket].hpp += item.hpp * item.quantity;
    });

    (['cash', 'qris', 'other'] as const).forEach(bucket => {
      base[bucket].grossProfit = base[bucket].net - base[bucket].hpp;
    });

    return base;
  })();

  const hasOtherPaymentMethods = paymentSummary.other.txCount > 0 || Math.abs(paymentSummary.other.net) > 0;
  const summaryTableRows = [
    {
      label: 'Transaksi',
      cash: paymentSummary.cash.txCount.toLocaleString('id-ID'),
      qris: paymentSummary.qris.txCount.toLocaleString('id-ID'),
      total: paymentSummary.total.txCount.toLocaleString('id-ID'),
      tone: 'neutral',
    },
    {
      label: 'Pendapatan Kotor',
      cash: rp(paymentSummary.cash.gross),
      qris: rp(paymentSummary.qris.gross),
      total: rp(paymentSummary.total.gross),
      tone: 'default',
    },
    {
      label: 'Diskon',
      cash: paymentSummary.cash.discount > 0 ? `-${rp(paymentSummary.cash.discount)}` : 'Rp 0',
      qris: paymentSummary.qris.discount > 0 ? `-${rp(paymentSummary.qris.discount)}` : 'Rp 0',
      total: paymentSummary.total.discount > 0 ? `-${rp(paymentSummary.total.discount)}` : 'Rp 0',
      tone: 'danger',
    },
    {
      label: 'Penjualan Bersih',
      cash: rp(paymentSummary.cash.net),
      qris: rp(paymentSummary.qris.net),
      total: rp(paymentSummary.total.net),
      tone: 'defaultStrong',
    },
    {
      label: 'HPP (Modal)',
      cash: paymentSummary.cash.hpp > 0 ? `-${rp(paymentSummary.cash.hpp)}` : 'Rp 0',
      qris: paymentSummary.qris.hpp > 0 ? `-${rp(paymentSummary.qris.hpp)}` : 'Rp 0',
      total: paymentSummary.total.hpp > 0 ? `-${rp(paymentSummary.total.hpp)}` : 'Rp 0',
      tone: 'danger',
    },
    {
      label: 'Laba Kotor',
      cash: rp(paymentSummary.cash.grossProfit),
      qris: rp(paymentSummary.qris.grossProfit),
      total: rp(paymentSummary.total.grossProfit),
      tone: 'success',
    },
    {
      label: 'Pengeluaran Operasional',
      cash: '-',
      qris: '-',
      total: totalOperationalExpenses > 0 ? `-${rp(totalOperationalExpenses)}` : 'Rp 0',
      tone: 'danger',
    },
    {
      label: 'Laba Bersih',
      cash: '-',
      qris: '-',
      total: rp(netProfitAfterExpenses),
      tone: 'successStrong',
    },
    {
      label: 'Margin',
      cash: '-',
      qris: '-',
      total: `${marginPercent.toFixed(1)}%`,
      tone: 'neutral',
    },
  ] as const;

  const buildProductAggregation = () => {
    const aggregated: Record<string, {
      name: string;
      qty: number;
      grossRevenue: number;
      allocatedDiscount: number;
      netRevenue: number;
      hpp: number;
      profit: number;
      productId: number;
    }> = {};

    allItems.forEach(item => {
      const key = item.productName;
      if (!aggregated[key]) {
        aggregated[key] = {
          name: key,
          qty: 0,
          grossRevenue: 0,
          allocatedDiscount: 0,
          netRevenue: 0,
          hpp: 0,
          profit: 0,
          productId: item.productId,
        };
      }

      const extraDiscount = getAllocatedExtraDiscount(item);
      const totalItemDiscount = (item.discountAmount || 0) + extraDiscount;
      const netRevenuePerItem = Math.max(0, item.subtotal - totalItemDiscount);
      const hpp = item.hpp * item.quantity;

      aggregated[key].qty += item.quantity;
      aggregated[key].grossRevenue += item.subtotal;
      aggregated[key].allocatedDiscount += totalItemDiscount;
      aggregated[key].netRevenue += netRevenuePerItem;
      aggregated[key].hpp += hpp;
      aggregated[key].profit += netRevenuePerItem - hpp;
    });

    return Object.values(aggregated);
  };

  // Chart data
  const chartData = (() => {
    const map: Record<string, number> = {};
    if (period === 'custom') {
      if (dateFrom && dateTo) {
        let current = startOfDay(dateFrom);
        const end = startOfDay(dateTo);
        while(current <= end) {
          map[format(current, 'dd/MM')] = 0;
          current = addDays(current, 1);
        }
      } else if (transactions && transactions.length > 0) {
        const sorted = [...transactions].sort((a,b) => new Date(a.date).getTime() - new Date(b.date).getTime());
        let current = startOfDay(new Date(sorted[0].date));
        const end = startOfDay(new Date(sorted[sorted.length-1].date));
        while(current <= end) {
          map[format(current, 'dd/MM')] = 0;
          current = addDays(current, 1);
        }
      }
    } else if (period === 'today') {
      const d = format(new Date(), 'dd/MM');
      map[d] = 0;
    } else {
      for (let i = days - 1; i >= 0; i--) {
        const d = format(subDays(new Date(), i), 'dd/MM');
        map[d] = 0;
      }
    }
    transactions?.forEach(t => {
      const d = format(new Date(t.date), 'dd/MM');
      if (map[d] !== undefined) map[d] += t.total;
      else if (period === 'custom') {
        // If out of bounds but in custom, dynamically add to avoid losing data point
        map[d] = (map[d] || 0) + t.total;
      }
    });
    return Object.entries(map).map(([date, sales]) => ({ date, sales }));
  })();

  // Top products
  const productSales = buildProductAggregation();
  const topProducts = [...productSales]
    .sort((a, b) => (b.qty - a.qty) || (b.netRevenue - a.netRevenue))
    .slice(0, 5);

  const getStockCategory = (name: string) => {
    const normalized = name.toLowerCase();

    if (
      normalized === 'dada' ||
      normalized === 'paha atas' ||
      normalized === 'paha bawah' ||
      normalized === 'sayap' ||
      normalized === 'nasi'
    ) return 'Utama';

    if (
      normalized === 'ayam potong 9' ||
      normalized === 'daging chicken strip' ||
      normalized === 'beras 10 liter' ||
      normalized === 'beras mentik wangi 10 kg' ||
      normalized.includes('sunco minyak goreng') ||
      normalized.includes('tepung fried chicken')
    ) return 'Bahan Produksi';

    if (
      normalized.includes('plastik') ||
      normalized.includes('box') ||
      normalized.includes('kemasan') ||
      normalized.includes('paper bowl')
    ) return 'Kemasan';

    if (
      normalized.includes('saus') ||
      normalized.includes('sambal') ||
      normalized.includes('mentai') ||
      normalized.includes('blackpepper') ||
      normalized.includes('buldak')
    ) return 'Saus & Bumbu';

    if (
      normalized.includes('fruit tea') ||
      normalized.includes('teh') ||
      normalized.includes('kopi') ||
      normalized.includes('americano') ||
      normalized.includes('cold brew') ||
      normalized.includes('butterscotch') ||
      normalized.includes('matcha') ||
      normalized.includes('green tea') ||
      normalized.includes('cokelat') ||
      normalized.includes('thai tea') ||
      normalized.includes('ice cream') ||
      normalized.includes('coca cola') ||
      normalized.includes('fanta') ||
      normalized.includes('sprite') ||
      normalized.includes('air mineral')
    ) return 'Minuman';

    if (
      normalized.includes('kentang') ||
      normalized.includes('chicken strip') ||
      normalized.includes('chicken roll') ||
      normalized.includes('chicken patty') ||
      normalized.includes('kulit') ||
      normalized === 'katsu' ||
      normalized.includes('bakso') ||
      normalized.includes('burger') ||
      normalized.includes('bun')
    ) return 'Snack';

    if (
      normalized.includes('ayam') ||
      normalized.includes('paha') ||
      normalized.includes('sayap')
    ) return 'Bahan Produksi';

    return 'Lain-lain';
  };

  const stockCategoryOrder = ['Utama', 'Bahan Produksi', 'Saus & Bumbu', 'Kemasan', 'Minuman', 'Snack', 'Lain-lain'];

  const isDateInSelectedPeriod = (dateStr?: string) => {
    if (!dateStr) return false;

    const date = startOfDay(new Date(`${dateStr}T00:00:00`));
    if (Number.isNaN(date.getTime())) return false;

    if (period === 'custom') {
      if (dateFrom && dateTo) {
        return date >= startOfDay(dateFrom) && date <= endOfDay(dateTo);
      }
      if (dateFrom) {
        return date >= startOfDay(dateFrom);
      }
      if (dateTo) {
        return date <= endOfDay(dateTo);
      }
      return false;
    }

    return date >= getPresetStartDate();
  };

  const stockReport = (() => {
    if (!warehouseItems) return [];
    
    // Map of warehouseItemId -> used qty
    const usedMap: Record<number, number> = {};
    warehouseItems.forEach(item => {
      usedMap[item.id!] = 0;
    });

    allItems.forEach(txItem => {
      if (txItem.productId < 0) {
        const warehouseItemId = Math.abs(txItem.productId);
        if (usedMap[warehouseItemId] !== undefined) {
          usedMap[warehouseItemId] += txItem.quantity;
        }
      } else {
        const recipes = productRecipes?.filter(r => r.productId === txItem.productId) ?? [];
        recipes.forEach(recipe => {
          if (usedMap[recipe.warehouseItemId] !== undefined) {
            usedMap[recipe.warehouseItemId] += txItem.quantity * recipe.quantity;
          }
        });

        const selectedOptionIds = txItem.selectedOptions?.map(option => option.optionId) ?? [];
        const optionRecipes = productOptionRecipes?.filter(recipe => selectedOptionIds.includes(recipe.optionId)) ?? [];
        optionRecipes.forEach(recipe => {
          if (usedMap[recipe.warehouseItemId] !== undefined) {
            usedMap[recipe.warehouseItemId] += txItem.quantity * recipe.quantity;
          }
        });
      }
    });

    const prepSourceIds = new Set((dailyPrepFormulas ?? []).map(formula => formula.prepItemId));
    warehouseItems.forEach(item => {
      if (!prepSourceIds.has(item.id!)) return;
      if (!isDateInSelectedPeriod(item.lastPreparedDate)) return;

      usedMap[item.id!] += item.dailyPrepQty || 0;
    });

    (warehouseUsageLogs ?? []).forEach(log => {
      if (usedMap[log.warehouseItemId] !== undefined) {
        usedMap[log.warehouseItemId] += log.quantity;
      }
    });

    return warehouseItems.map(item => {
      const terpakai = usedMap[item.id!] || 0;
      const sisa = item.stock;
      const awal = sisa + terpakai;
      return {
        id: item.id!,
        name: item.name,
        category: getStockCategory(item.name),
        unit: item.unit,
        awal,
        terpakai,
        sisa
      };
    }).sort((a, b) => {
      const categoryDiff = stockCategoryOrder.indexOf(a.category) - stockCategoryOrder.indexOf(b.category);
      if (categoryDiff !== 0) return categoryDiff;
      return a.name.localeCompare(b.name, 'id');
    });
  })();

  const groupedStockReport = stockReport.reduce<Record<string, typeof stockReport>>((groups, item) => {
    if (!groups[item.category]) groups[item.category] = [];
    groups[item.category].push(item);
    return groups;
  }, {});

  const recentExpenses = [...(dailyExpenses ?? [])]
    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
    .slice(0, 6);

  const recentUsageLogs = [...(warehouseUsageLogs ?? [])]
    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
    .slice(0, 6);

  // === Export to Excel ===
  const exportToExcel = async () => {
    if (!transactions || transactions.length === 0) return;

    const [{ default: ExcelJS }, { saveAs }] = await Promise.all([
      import('exceljs'),
      import('file-saver'),
    ]);
    const lightFill: Fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF9F9F9' } };
    const subtotalFill: Fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF9E5E5' } };
    const emphasizedFill: Fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF2D0D0' } };
    const dateHeaderFill: Fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF2D0D0' } };
    const strongRedFill: Fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFB42829' } };
    const thinRedBorder: Partial<Border> = { style: 'thin', color: { argb: 'FFB42829' } };
    const thinGrayBorder: Partial<Border> = { style: 'thin', color: { argb: 'FFE2E8F0' } };

    // Resolve payment method names
    const paymentMethods = await db.paymentMethods.toArray();
    const pmMap: Record<number, string> = {};
    paymentMethods.forEach(pm => { if (pm.id) pmMap[pm.id] = pm.name; });

    // Resolve product units
    const products = await db.products.toArray();
    const productUnitMap: Record<number, string> = {};
    products.forEach(p => { if (p.id) productUnitMap[p.id] = p.unit; });

    // Get store name
    const settings = await db.storeSettings.toArray();
    const storeName = settings[0]?.storeName || 'Toko Saya';

    // --- Period label ---
    let periodLabel = '';
    if (period === 'today') periodLabel = 'Hari Ini';
    if (period === '7') periodLabel = '7 Hari Terakhir';
    else if (period === '30') periodLabel = '30 Hari Terakhir';
    else if (period === 'custom') {
      const fromStr = dateFrom ? format(dateFrom, 'dd MMM yyyy', { locale: localeId }) : '-';
      const toStr = dateTo ? format(dateTo, 'dd MMM yyyy', { locale: localeId }) : '-';
      periodLabel = `${fromStr} s/d ${toStr}`;
    }

    // --- Payment method breakdown ---
    const pmBreakdown: Record<string, { count: number; total: number }> = {};
    transactions.forEach(t => {
      const name = pmMap[t.paymentMethodId] || 'Lainnya';
      if (!pmBreakdown[name]) pmBreakdown[name] = { count: 0, total: 0 };
      pmBreakdown[name].count += 1;
      pmBreakdown[name].total += t.total;
    });

    const wb = new ExcelJS.Workbook();
    wb.creator = storeName;
    wb.created = new Date();

    // Helper for styles
    const headerStyle: Partial<Style> = {
      font: { bold: true, color: { argb: 'FFFFFFFF' } },
      fill: strongRedFill,
      alignment: { vertical: 'middle', horizontal: 'center' },
      border: {
        top: thinRedBorder,
        left: thinRedBorder,
        bottom: thinRedBorder,
        right: thinRedBorder
      } as Partial<Borders>
    };
    
    const cellBorder: Partial<Borders> = {
      top: thinGrayBorder,
      left: thinGrayBorder,
      bottom: thinGrayBorder,
      right: thinGrayBorder
    };
    
    // Currency format
    const currencyFormat = 'Rp #,##0';
    // Percentage format
    const percentFormat = '0.0%';
    // ============================================
    // SHEET 1: Ringkasan
    // ============================================
    const wsRingkasan = wb.addWorksheet('Ringkasan', { views: [{ showGridLines: false }] });
    
    wsRingkasan.columns = Array.from({ length: 14 }).map(() => ({ width: 14 }));

    // Load Logo
    let logoId: number | null = null;
    try {
      const response = await fetch('/android-chrome-192x192.png');
      const blob = await response.blob();
      const reader = new FileReader();
      const base64data = await new Promise<string>((resolve) => {
        reader.onloadend = () => resolve(reader.result as string);
        reader.readAsDataURL(blob);
      });
      logoId = wb.addImage({
        base64: base64data,
        extension: 'png',
      });
      if (logoId !== null) {
        wsRingkasan.mergeCells('A1:B5');
        wsRingkasan.addImage(logoId, {
          tl: { col: 0.44, row: 0.1 },
          ext: { width: 110, height: 110 },
          editAs: 'oneCell'
        });
      }
    } catch (e) {
      console.warn('Could not load logo for excel');
    }

    // Title
    wsRingkasan.mergeCells('C3:H3');
    const titleCell = wsRingkasan.getCell('C3');
    titleCell.value = storeName;
    titleCell.font = { bold: true, size: 22, color: { argb: 'FFB42829' } };
    titleCell.alignment = { vertical: 'middle' };

    wsRingkasan.mergeCells('C4:H4');
    const subtitleCell = wsRingkasan.getCell('C4');
    subtitleCell.value = 'Laporan Penjualan';
    subtitleCell.font = { size: 14, color: { argb: 'FF555555' } };

    // Header info (Period, Printed)
    wsRingkasan.mergeCells('K3:L3'); wsRingkasan.getCell('K3').value = 'Periode';
    wsRingkasan.mergeCells('M3:N3'); wsRingkasan.getCell('M3').value = periodLabel;
    wsRingkasan.mergeCells('K4:L4'); wsRingkasan.getCell('K4').value = 'Dicetak';
    wsRingkasan.mergeCells('M4:N4'); wsRingkasan.getCell('M4').value = format(new Date(), 'dd MMM yyyy HH:mm', { locale: localeId });
    
    ['K3','L3','M3','N3','K4','L4','M4','N4'].forEach(cell => {
      wsRingkasan.getCell(cell).border = cellBorder;
      wsRingkasan.getCell(cell).alignment = { vertical: 'middle', horizontal: 'center' };
      if (cell.startsWith('K')) {
        wsRingkasan.getCell(cell).fill = lightFill;
      }
    });

    // Top border line
    wsRingkasan.mergeCells('A6:N6');
    wsRingkasan.getCell('A6').border = { bottom: { style: 'medium', color: { argb: 'FFB42829' } } };

    // Cards
    const cardData = [
      { label: 'Transaksi', val: txCount, fmt: null },
      { label: 'Pendapatan Kotor', val: totalRevenue, fmt: currencyFormat },
      { label: 'Diskon', val: totalDiscount, fmt: currencyFormat },
      { label: 'Penjualan Bersih', val: netSales, fmt: currencyFormat },
      { label: 'HPP (Modal)', val: totalHpp, fmt: currencyFormat },
      { label: 'Profit (Laba Kotor)', val: grossProfit, fmt: currencyFormat },
      { label: 'Margin', val: marginPercent / 100, fmt: percentFormat }
    ];

    const financialSummaryRows = [
      { label: 'Transaksi', val: txCount, fmt: null },
      { label: 'Pendapatan Kotor', val: totalRevenue, fmt: currencyFormat },
      { label: 'Diskon', val: totalDiscount, fmt: currencyFormat },
      { label: 'Penjualan Bersih', val: netSales, fmt: currencyFormat },
      { label: 'HPP (Modal)', val: totalHpp, fmt: currencyFormat },
      { label: 'Profit (Laba Kotor)', val: grossProfit, fmt: currencyFormat },
      { label: 'Pengeluaran Operasional', val: totalOperationalExpenses, fmt: currencyFormat },
      { label: 'Laba Bersih', val: netProfitAfterExpenses, fmt: currencyFormat },
      { label: 'Margin', val: marginPercent / 100, fmt: percentFormat }
    ];

    cardData.forEach((c, idx) => {
      const startLetter = String.fromCharCode(65 + (idx * 2)); // A, C, E, G, I, K, M
      const endLetter = String.fromCharCode(65 + (idx * 2) + 1); // B, D, F, H, J, L, N
      
      // Row 7 (Label)
      wsRingkasan.mergeCells(`${startLetter}7:${endLetter}7`);
      const labelCell = wsRingkasan.getCell(`${startLetter}7`);
      labelCell.value = c.label;
      labelCell.font = { bold: true, size: 14, color: { argb: 'FFFFFFFF' } };
      labelCell.fill = strongRedFill;
      labelCell.alignment = { horizontal: 'center', vertical: 'middle' };
      
      // Row 8-11 (Value)
      wsRingkasan.mergeCells(`${startLetter}8:${endLetter}11`);
      const valCell = wsRingkasan.getCell(`${startLetter}8`);
      valCell.value = c.val;
      valCell.font = { bold: true, size: 18, color: { argb: 'FFB42829' } };
      valCell.alignment = { horizontal: 'center', vertical: 'middle' };
      if (c.fmt) valCell.numFmt = c.fmt;

      // Card borders
      for (let r = 7; r <= 11; r++) {
        wsRingkasan.getCell(`${startLetter}${r}`).border = { top: { style: 'thin', color: { argb: 'FFE2E8F0' } }, bottom: { style: 'thin', color: { argb: 'FFE2E8F0' } }, left: { style: 'thin', color: { argb: 'FFE2E8F0' } } };
        wsRingkasan.getCell(`${endLetter}${r}`).border = { top: { style: 'thin', color: { argb: 'FFE2E8F0' } }, bottom: { style: 'thin', color: { argb: 'FFE2E8F0' } }, right: { style: 'thin', color: { argb: 'FFE2E8F0' } } };
      }
      wsRingkasan.getCell(`${startLetter}7`).border = { top: { style: 'medium', color: { argb: 'FFB42829' } }, left: { style: 'thin', color: { argb: 'FFE2E8F0' } } };
      wsRingkasan.getCell(`${endLetter}7`).border = { top: { style: 'medium', color: { argb: 'FFB42829' } }, right: { style: 'thin', color: { argb: 'FFE2E8F0' } } };
    });

    // Ringkasan Keuangan Table
    wsRingkasan.mergeCells('A13:F13');
    wsRingkasan.getCell('A13').value = 'RINGKASAN KEUANGAN';
    wsRingkasan.getCell('A13').style = headerStyle;
    
    wsRingkasan.mergeCells('A14:C14'); wsRingkasan.getCell('A14').value = 'Keterangan';
    wsRingkasan.mergeCells('D14:F14'); wsRingkasan.getCell('D14').value = 'Jumlah';
    ['A14','D14'].forEach(c => { wsRingkasan.getCell(c).font = { bold: true }; wsRingkasan.getCell(c).alignment = { horizontal: 'center' }; });

    let rRow = 15;
    financialSummaryRows.forEach(c => {
      wsRingkasan.mergeCells(`A${rRow}:C${rRow}`);
      wsRingkasan.mergeCells(`D${rRow}:F${rRow}`);
      
      wsRingkasan.getCell(`A${rRow}`).value = c.label;
      wsRingkasan.getCell(`D${rRow}`).value = c.val;
      if (c.fmt) wsRingkasan.getCell(`D${rRow}`).numFmt = c.fmt;
      wsRingkasan.getCell(`D${rRow}`).alignment = { horizontal: 'center' };
      
      if (rRow % 2 !== 0) {
        ['A','D'].forEach(col => {
          wsRingkasan.getCell(`${col}${rRow}`).fill = subtotalFill;
        });
      }
      if (c.label === 'Penjualan Bersih' || c.label === 'Laba Bersih') {
        ['A','D'].forEach(col => {
          wsRingkasan.getCell(`${col}${rRow}`).font = { bold: true, color: { argb: 'FFB42829' } };
          wsRingkasan.getCell(`${col}${rRow}`).fill = emphasizedFill;
        });
      }
      rRow++;
    });
    
    for (let i=14; i<rRow; i++) {
      ['A','B','C'].forEach(col => wsRingkasan.getCell(`${col}${i}`).border = { top: cellBorder.top, bottom: cellBorder.bottom, left: col==='A'?cellBorder.left:undefined, right: col==='C'?cellBorder.right:undefined });
      ['D','E','F'].forEach(col => wsRingkasan.getCell(`${col}${i}`).border = { top: cellBorder.top, bottom: cellBorder.bottom, left: col==='D'?cellBorder.left:undefined, right: col==='F'?cellBorder.right:undefined });
    }

    // Metode Pembayaran Table (Skip Chart)
    wsRingkasan.mergeCells('H13:N13');
    wsRingkasan.getCell('H13').value = 'METODE PEMBAYARAN';
    wsRingkasan.getCell('H13').style = headerStyle;

    wsRingkasan.mergeCells('H14:I14'); wsRingkasan.getCell('H14').value = 'Metode Pembayaran';
    wsRingkasan.getCell('J14').value = 'Jml Trx';
    wsRingkasan.mergeCells('K14:L14'); wsRingkasan.getCell('K14').value = 'Total';
    wsRingkasan.mergeCells('M14:N14'); wsRingkasan.getCell('M14').value = 'Persentase';
    
    ['H14','J14','K14','M14'].forEach(c => { 
      wsRingkasan.getCell(c).style = headerStyle; 
    });

    let pRow = 15;
    Object.entries(pmBreakdown).forEach(([name, data]) => {
      wsRingkasan.mergeCells(`H${pRow}:I${pRow}`);
      wsRingkasan.getCell(`H${pRow}`).value = name;
      wsRingkasan.getCell(`J${pRow}`).value = data.count;
      wsRingkasan.getCell(`J${pRow}`).alignment = { horizontal: 'center' };
      
      wsRingkasan.mergeCells(`K${pRow}:L${pRow}`);
      wsRingkasan.getCell(`K${pRow}`).value = data.total;
      wsRingkasan.getCell(`K${pRow}`).numFmt = currencyFormat;
      wsRingkasan.getCell(`K${pRow}`).alignment = { horizontal: 'center' };
      
      wsRingkasan.mergeCells(`M${pRow}:N${pRow}`);
      wsRingkasan.getCell(`M${pRow}`).value = data.total / totalRevenue;
      wsRingkasan.getCell(`M${pRow}`).numFmt = percentFormat;
      wsRingkasan.getCell(`M${pRow}`).alignment = { horizontal: 'center' };
      pRow++;
    });

    // PM Total Row
    wsRingkasan.mergeCells(`H${pRow}:I${pRow}`);
    wsRingkasan.getCell(`H${pRow}`).value = 'TOTAL';
    wsRingkasan.getCell(`J${pRow}`).value = txCount;
    wsRingkasan.getCell(`J${pRow}`).alignment = { horizontal: 'center' };
    wsRingkasan.mergeCells(`K${pRow}:L${pRow}`);
    wsRingkasan.getCell(`K${pRow}`).value = totalRevenue;
    wsRingkasan.getCell(`K${pRow}`).numFmt = currencyFormat;
    wsRingkasan.getCell(`K${pRow}`).alignment = { horizontal: 'center' };
    wsRingkasan.mergeCells(`M${pRow}:N${pRow}`);
    wsRingkasan.getCell(`M${pRow}`).value = 1;
    wsRingkasan.getCell(`M${pRow}`).numFmt = percentFormat;
    wsRingkasan.getCell(`M${pRow}`).alignment = { horizontal: 'center' };
    
    ['H','J','K','M'].forEach(col => {
      wsRingkasan.getCell(`${col}${pRow}`).font = { bold: true, color: { argb: 'FFB42829' } };
      wsRingkasan.getCell(`${col}${pRow}`).fill = subtotalFill;
    });

    for(let i=14; i<=pRow; i++) {
      ['H','I'].forEach(col => wsRingkasan.getCell(`${col}${i}`).border = { top: cellBorder.top, bottom: cellBorder.bottom, left: col==='H'?cellBorder.left:undefined, right: col==='I'?cellBorder.right:undefined });
      wsRingkasan.getCell(`J${i}`).border = cellBorder;
      ['K','L'].forEach(col => wsRingkasan.getCell(`${col}${i}`).border = { top: cellBorder.top, bottom: cellBorder.bottom, left: col==='K'?cellBorder.left:undefined, right: col==='L'?cellBorder.right:undefined });
      ['M','N'].forEach(col => wsRingkasan.getCell(`${col}${i}`).border = { top: cellBorder.top, bottom: cellBorder.bottom, left: col==='M'?cellBorder.left:undefined, right: col==='N'?cellBorder.right:undefined });
    }

    // Tipe Layanan Table
    const serviceHeaderRow = pRow + 2;
    wsRingkasan.mergeCells(`H${serviceHeaderRow}:N${serviceHeaderRow}`);
    wsRingkasan.getCell(`H${serviceHeaderRow}`).value = 'TIPE LAYANAN';
    wsRingkasan.getCell(`H${serviceHeaderRow}`).style = headerStyle;

    const serviceLabelRow = serviceHeaderRow + 1;
    wsRingkasan.mergeCells(`H${serviceLabelRow}:I${serviceLabelRow}`); wsRingkasan.getCell(`H${serviceLabelRow}`).value = 'Tipe';
    wsRingkasan.getCell(`J${serviceLabelRow}`).value = 'Jml Trx';
    wsRingkasan.mergeCells(`K${serviceLabelRow}:L${serviceLabelRow}`); wsRingkasan.getCell(`K${serviceLabelRow}`).value = 'Total';
    wsRingkasan.mergeCells(`M${serviceLabelRow}:N${serviceLabelRow}`); wsRingkasan.getCell(`M${serviceLabelRow}`).value = 'Persentase';
    ['H','J','K','M'].forEach(c => {
      wsRingkasan.getCell(`${c}${serviceLabelRow}`).style = headerStyle;
    });

    const serviceRows = [
      { label: 'Dine In', data: serviceTypeBreakdown.dine_in },
      { label: 'Take Away', data: serviceTypeBreakdown.take_away },
    ];

    let serviceRow = serviceLabelRow + 1;
    serviceRows.forEach(({ label, data }) => {
      wsRingkasan.mergeCells(`H${serviceRow}:I${serviceRow}`);
      wsRingkasan.getCell(`H${serviceRow}`).value = label;
      wsRingkasan.getCell(`J${serviceRow}`).value = data.count;
      wsRingkasan.getCell(`J${serviceRow}`).alignment = { horizontal: 'center' };

      wsRingkasan.mergeCells(`K${serviceRow}:L${serviceRow}`);
      wsRingkasan.getCell(`K${serviceRow}`).value = data.total;
      wsRingkasan.getCell(`K${serviceRow}`).numFmt = currencyFormat;
      wsRingkasan.getCell(`K${serviceRow}`).alignment = { horizontal: 'center' };

      wsRingkasan.mergeCells(`M${serviceRow}:N${serviceRow}`);
      wsRingkasan.getCell(`M${serviceRow}`).value = txCount > 0 ? data.count / txCount : 0;
      wsRingkasan.getCell(`M${serviceRow}`).numFmt = percentFormat;
      wsRingkasan.getCell(`M${serviceRow}`).alignment = { horizontal: 'center' };
      serviceRow++;
    });

    wsRingkasan.mergeCells(`H${serviceRow}:I${serviceRow}`);
    wsRingkasan.getCell(`H${serviceRow}`).value = 'TOTAL';
    wsRingkasan.getCell(`J${serviceRow}`).value = txCount;
    wsRingkasan.getCell(`J${serviceRow}`).alignment = { horizontal: 'center' };
    wsRingkasan.mergeCells(`K${serviceRow}:L${serviceRow}`);
    wsRingkasan.getCell(`K${serviceRow}`).value = totalRevenue;
    wsRingkasan.getCell(`K${serviceRow}`).numFmt = currencyFormat;
    wsRingkasan.getCell(`K${serviceRow}`).alignment = { horizontal: 'center' };
    wsRingkasan.mergeCells(`M${serviceRow}:N${serviceRow}`);
    wsRingkasan.getCell(`M${serviceRow}`).value = 1;
    wsRingkasan.getCell(`M${serviceRow}`).numFmt = percentFormat;
    wsRingkasan.getCell(`M${serviceRow}`).alignment = { horizontal: 'center' };

    ['H','J','K','M'].forEach(col => {
      wsRingkasan.getCell(`${col}${serviceRow}`).font = { bold: true, color: { argb: 'FFB42829' } };
      wsRingkasan.getCell(`${col}${serviceRow}`).fill = subtotalFill;
    });

    for (let i = serviceLabelRow; i <= serviceRow; i++) {
      ['H','I'].forEach(col => wsRingkasan.getCell(`${col}${i}`).border = { top: cellBorder.top, bottom: cellBorder.bottom, left: col==='H'?cellBorder.left:undefined, right: col==='I'?cellBorder.right:undefined });
      wsRingkasan.getCell(`J${i}`).border = cellBorder;
      ['K','L'].forEach(col => wsRingkasan.getCell(`${col}${i}`).border = { top: cellBorder.top, bottom: cellBorder.bottom, left: col==='K'?cellBorder.left:undefined, right: col==='L'?cellBorder.right:undefined });
      ['M','N'].forEach(col => wsRingkasan.getCell(`${col}${i}`).border = { top: cellBorder.top, bottom: cellBorder.bottom, left: col==='M'?cellBorder.left:undefined, right: col==='N'?cellBorder.right:undefined });
    }

    // ============================================
    // SHEET 2: Detail Transaksi
    // ============================================
    const wsDetail = wb.addWorksheet('Detail Transaksi', { views: [{ state: 'frozen', ySplit: 1 }] });
    wsDetail.columns = [
      { header: 'No', key: 'no', width: 6 },
      { header: 'Tanggal', key: 'date', width: 20 },
      { header: 'No Struk', key: 'receipt', width: 22 },
      { header: 'Metode Pembayaran', key: 'payment', width: 22 },
      { header: 'Tipe Layanan', key: 'serviceType', width: 18 },
      { header: 'Pendapatan Kotor', key: 'gross', width: 22, style: { numFmt: currencyFormat } },
      { header: 'Diskon', key: 'discount', width: 15, style: { numFmt: currencyFormat } },
      { header: 'Penjualan Bersih', key: 'net', width: 22, style: { numFmt: currencyFormat } },
      { header: 'HPP (Modal)', key: 'hpp', width: 22, style: { numFmt: currencyFormat } },
      { header: 'Profit (Laba Kotor)', key: 'profit', width: 22, style: { numFmt: currencyFormat } },
    ];

    wsDetail.getRow(1).eachCell(cell => {
      cell.style = headerStyle;
    });
    wsDetail.autoFilter = 'A1:J1';

    let sumGross = 0, sumDiscount = 0, sumNet = 0, sumHpp = 0, sumProfit = 0;

    transactions.forEach((t, i) => {
      const txHpp = allItems
        .filter(item => item.transactionId === t.id)
        .reduce((sum, item) => sum + (item.hpp || 0) * item.quantity, 0);
      const txNetSales = t.subtotal - (t.discountAmount || 0);
      const txProfit = txNetSales - txHpp;
      
      sumGross += t.subtotal;
      sumDiscount += (t.discountAmount || 0);
      sumNet += txNetSales;
      sumHpp += txHpp;
      sumProfit += txProfit;

      const row = wsDetail.addRow({
        no: i + 1,
        date: format(new Date(t.date), 'dd-MM-yyyy HH:mm', { locale: localeId }),
        receipt: t.receiptNumber,
        payment: pmMap[t.paymentMethodId] || 'Lainnya',
        serviceType: t.serviceType === 'take_away' ? 'Take Away' : 'Dine In',
        gross: t.subtotal,
        discount: (t.discountAmount || 0),
        net: txNetSales,
        hpp: txHpp,
        profit: txProfit
      });
      row.eachCell(cell => { cell.border = cellBorder; });
    });

    const totalRow = wsDetail.addRow({
      no: 'Total',
      gross: sumGross,
      discount: sumDiscount,
      net: sumNet,
      hpp: sumHpp,
      profit: sumProfit
    });
    wsDetail.mergeCells(`A${totalRow.number}:E${totalRow.number}`);
    totalRow.getCell('A').alignment = { horizontal: 'center', vertical: 'middle' };
    totalRow.getCell('A').font = { bold: true };
    totalRow.eachCell(cell => { 
      cell.border = cellBorder;
      if (cell.col > 5) {
        cell.font = { bold: true };
      }
    });

    // ============================================
    // SHEET 3: Produk Terlaris
    // ============================================
    const wsProduk = wb.addWorksheet('Produk Terlaris', { views: [{ state: 'frozen', ySplit: 1 }] });
    wsProduk.columns = [
      { header: 'No', key: 'no', width: 6 },
      { header: 'Nama Produk', key: 'name', width: 40 },
      { header: 'Jumlah Terjual', key: 'qty', width: 16 },
      { header: 'Satuan', key: 'unit', width: 12 },
      { header: 'Total Pendapatan Kotor', key: 'gross', width: 25, style: { numFmt: currencyFormat } },
      { header: 'Diskon Alokasi', key: 'discount', width: 18, style: { numFmt: currencyFormat } },
      { header: 'Penjualan Bersih', key: 'net', width: 22, style: { numFmt: currencyFormat } },
      { header: 'Total HPP (Modal)', key: 'hpp', width: 22, style: { numFmt: currencyFormat } },
      { header: 'Total Laba Kotor', key: 'profit', width: 22, style: { numFmt: currencyFormat } },
      { header: 'Margin', key: 'margin', width: 12, style: { numFmt: percentFormat } },
    ];

    wsProduk.getRow(1).eachCell(cell => {
      cell.style = headerStyle;
    });
    wsProduk.autoFilter = 'A1:J1';
    wsProduk.getColumn('name').alignment = { wrapText: true, vertical: 'top' };

    const prodSorted = [...productSales].sort((a, b) => (b.qty - a.qty) || (b.netRevenue - a.netRevenue));

    prodSorted.forEach((p, i) => {
      const margin = p.netRevenue > 0 ? (p.profit / p.netRevenue) : 0;
      const row = wsProduk.addRow({
        no: i + 1,
        name: p.name,
        qty: p.qty,
        unit: productUnitMap[p.productId] || 'pcs',
        gross: p.grossRevenue,
        discount: p.allocatedDiscount,
        net: p.netRevenue,
        hpp: p.hpp,
        profit: p.profit,
        margin: margin
      });
      row.alignment = { vertical: 'top' };
      row.eachCell(cell => { cell.border = cellBorder; });
    });

    // Footer: Subtotal Kotor, Diskon, Total Bersih
    const prodSubTotalProfit = prodSorted.reduce((s, p) => s + p.profit, 0);
    const prodSubTotalGross = prodSorted.reduce((s, p) => s + p.grossRevenue, 0);
    const prodSubTotalNet = prodSorted.reduce((s, p) => s + p.netRevenue, 0);
    const prodTotalDiscount = totalDiscount;

    const prodSubRow = wsProduk.addRow({ no: 'Subtotal Kotor', name: '', qty: '', unit: '', gross: prodSubTotalGross, discount: '', net: '', hpp: '', profit: '', margin: '' });
    wsProduk.mergeCells(`A${prodSubRow.number}:D${prodSubRow.number}`);
    prodSubRow.getCell('A').alignment = { horizontal: 'right', vertical: 'middle' };
    prodSubRow.eachCell(cell => {
      cell.border = cellBorder;
      cell.font = { bold: true };
      cell.fill = subtotalFill;
    });

    if (prodTotalDiscount > 0) {
      const prodDiscRow = wsProduk.addRow({ no: 'Diskon', name: '', qty: '', unit: '', gross: '', discount: prodTotalDiscount, net: '', hpp: '', profit: '', margin: '' });
      wsProduk.mergeCells(`A${prodDiscRow.number}:D${prodDiscRow.number}`);
      prodDiscRow.getCell('A').alignment = { horizontal: 'right', vertical: 'middle' };
      prodDiscRow.eachCell(cell => {
        cell.border = cellBorder;
        cell.font = { bold: true, color: { argb: 'FFB42829' } };
      });
    }

    const prodGrandRow = wsProduk.addRow({ no: 'Total Bersih', name: '', qty: '', unit: '', gross: '', discount: '', net: prodSubTotalNet, hpp: totalHpp, profit: prodSubTotalProfit, margin: netSales > 0 ? grossProfit / netSales : 0 });
    wsProduk.mergeCells(`A${prodGrandRow.number}:D${prodGrandRow.number}`);
    prodGrandRow.getCell('A').alignment = { horizontal: 'right', vertical: 'middle' };
    prodGrandRow.eachCell(cell => {
      cell.border = cellBorder;
      cell.font = { bold: true, size: 12, color: { argb: 'FFFFFFFF' } };
      cell.fill = strongRedFill;
    });

    // ============================================
    // SHEET 4: Detail Penjualan Harian
    // ============================================
    const wsHarian = wb.addWorksheet('Detail Penjualan Harian', { views: [{ state: 'frozen', ySplit: 1 }] });
    wsHarian.columns = [
      { header: 'Tanggal', key: 'date', width: 18 },
      { header: 'Nama Produk', key: 'name', width: 40 },
      { header: 'Jumlah Terjual', key: 'qty', width: 16 },
      { header: 'Satuan', key: 'unit', width: 12 },
      { header: 'Total Pendapatan Kotor', key: 'gross', width: 25, style: { numFmt: currencyFormat } },
      { header: 'Diskon Alokasi', key: 'discount', width: 18, style: { numFmt: currencyFormat } },
      { header: 'Penjualan Bersih', key: 'net', width: 22, style: { numFmt: currencyFormat } },
      { header: 'Total HPP (Modal)', key: 'hpp', width: 22, style: { numFmt: currencyFormat } },
      { header: 'Total Laba Kotor', key: 'profit', width: 22, style: { numFmt: currencyFormat } },
    ];

    wsHarian.getRow(1).eachCell(cell => {
      cell.style = headerStyle;
    });
    wsHarian.autoFilter = 'A1:I1';
    wsHarian.getColumn('name').alignment = { wrapText: true, vertical: 'top' };

    // Build daily per-product aggregation
    const dailyAgg: Record<string, Record<string, {
      name: string; qty: number; grossRevenue: number; allocatedDiscount: number;
      netRevenue: number; hpp: number; profit: number; productId: number;
    }>> = {};

    transactions.forEach(t => {
      const dateKey = format(new Date(t.date), 'dd-MM-yyyy', { locale: localeId });
      if (!dailyAgg[dateKey]) dailyAgg[dateKey] = {};

      const txItems = allItems.filter(item => item.transactionId === t.id);
      txItems.forEach(item => {
        const key = item.productName;
        if (!dailyAgg[dateKey][key]) {
          dailyAgg[dateKey][key] = {
            name: key,
            qty: 0,
            grossRevenue: 0,
            allocatedDiscount: 0,
            netRevenue: 0,
            hpp: 0,
            profit: 0,
            productId: item.productId
          };
        }
        const extraDiscount = getAllocatedExtraDiscount(item);
        const totalItemDiscount = (item.discountAmount || 0) + extraDiscount;
        const netRevenuePerItem = Math.max(0, item.subtotal - totalItemDiscount);
        dailyAgg[dateKey][key].qty += item.quantity;
        dailyAgg[dateKey][key].grossRevenue += item.subtotal;
        dailyAgg[dateKey][key].allocatedDiscount += totalItemDiscount;
        dailyAgg[dateKey][key].netRevenue += netRevenuePerItem;
        dailyAgg[dateKey][key].hpp += item.hpp * item.quantity;
        dailyAgg[dateKey][key].profit += netRevenuePerItem - (item.hpp * item.quantity);
      });
    });

    // Sort dates chronologically (dd-MM-yyyy -> parse back)
    const sortedDates = Object.keys(dailyAgg).sort((a, b) => {
      const [da, ma, ya] = a.split('-').map(Number);
      const [db, mb, yb] = b.split('-').map(Number);
      return new Date(ya, ma - 1, da).getTime() - new Date(yb, mb - 1, db).getTime();
    });

    let grandQty = 0, grandGrossRevenue = 0, grandDiscount = 0, grandNetRevenue = 0, grandHpp = 0, grandProfit = 0;

    sortedDates.forEach(dateKey => {
      const productsOfDay = Object.values(dailyAgg[dateKey]).sort((a, b) => (b.qty - a.qty) || (b.netRevenue - a.netRevenue));

      // Date header row
      const dateRow = wsHarian.addRow({ date: `Tanggal ${dateKey}`, name: '', qty: '', unit: '', gross: '', discount: '', net: '', hpp: '', profit: '' });
      wsHarian.mergeCells(`A${dateRow.number}:I${dateRow.number}`);
      dateRow.getCell('A').font = { bold: true, size: 12, color: { argb: 'FFB42829' } };
      dateRow.getCell('A').fill = dateHeaderFill;
      dateRow.getCell('A').alignment = { vertical: 'middle' };
      dateRow.height = 22;

      let dayQty = 0, dayGrossRevenue = 0, dayDiscount = 0, dayNetRevenue = 0, dayHpp = 0, dayProfit = 0;

      productsOfDay.forEach(p => {
        const row = wsHarian.addRow({
          date: '',
          name: p.name,
          qty: p.qty,
          unit: productUnitMap[p.productId] || 'pcs',
          gross: p.grossRevenue,
          discount: p.allocatedDiscount,
          net: p.netRevenue,
          hpp: p.hpp,
          profit: p.profit,
        });
        row.alignment = { vertical: 'top' };
        row.eachCell(cell => { cell.border = cellBorder; });

        dayQty += p.qty;
        dayGrossRevenue += p.grossRevenue;
        dayDiscount += p.allocatedDiscount;
        dayNetRevenue += p.netRevenue;
        dayHpp += p.hpp;
        dayProfit += p.profit;
      });

      // Subtotal row per date
      const subRow = wsHarian.addRow({
        date: '',
        name: `Subtotal Kotor ${dateKey}`,
        qty: dayQty,
        unit: '',
        gross: dayGrossRevenue,
        discount: '',
        net: '',
        hpp: dayHpp,
        profit: '',
      });
      subRow.eachCell(cell => {
        cell.border = cellBorder;
        cell.font = { bold: true, color: { argb: 'FFB42829' } };
        cell.fill = subtotalFill;
      });

      if (dayDiscount > 0) {
        const dayDiscRow = wsHarian.addRow({ date: '', name: `Diskon ${dateKey}`, qty: '', unit: '', gross: '', discount: dayDiscount, net: '', hpp: '', profit: '' });
        dayDiscRow.eachCell(cell => {
          cell.border = cellBorder;
          cell.font = { bold: true, color: { argb: 'FFB42829' } };
        });
      }

      const dayTotalRow = wsHarian.addRow({ date: '', name: `Total Bersih ${dateKey}`, qty: dayQty, unit: '', gross: '', discount: '', net: dayNetRevenue, hpp: dayHpp, profit: dayProfit });
      dayTotalRow.eachCell(cell => {
        cell.border = cellBorder;
        cell.font = { bold: true, color: { argb: 'FFB42829' } };
        cell.fill = subtotalFill;
      });

      grandQty += dayQty;
      grandGrossRevenue += dayGrossRevenue;
      grandDiscount += dayDiscount;
      grandNetRevenue += dayNetRevenue;
      grandHpp += dayHpp;
      grandProfit += dayProfit;
    });

    // Grand total footer
    const grandSubRow = wsHarian.addRow({ date: '', name: 'Subtotal Kotor', qty: grandQty, unit: '', gross: grandGrossRevenue, discount: '', net: '', hpp: '', profit: '' });
    grandSubRow.eachCell(cell => {
      cell.border = cellBorder;
      cell.font = { bold: true };
      cell.fill = subtotalFill;
    });

    if (grandDiscount > 0) {
      const grandDiscRow = wsHarian.addRow({ date: '', name: 'Diskon', qty: '', unit: '', gross: '', discount: grandDiscount, net: '', hpp: '', profit: '' });
      grandDiscRow.eachCell(cell => {
        cell.border = cellBorder;
        cell.font = { bold: true, color: { argb: 'FFB42829' } };
      });
    }

    const grandRow = wsHarian.addRow({ date: '', name: 'Grand Total Bersih', qty: grandQty, unit: '', gross: '', discount: '', net: grandNetRevenue, hpp: grandHpp, profit: grandProfit });
    grandRow.eachCell(cell => {
      cell.border = cellBorder;
      cell.font = { bold: true, size: 12, color: { argb: 'FFFFFFFF' } };
      cell.fill = strongRedFill;
    });

    // ============================================
    // SHEET 5: Laporan Stok Bahan
    // ============================================
    const wsStok = wb.addWorksheet('Laporan Stok Bahan', { views: [{ state: 'frozen', ySplit: 1 }] });
    wsStok.columns = [
      { header: 'No', key: 'no', width: 6 },
      { header: 'Nama Bahan', key: 'name', width: 30 },
      { header: 'Satuan', key: 'unit', width: 12 },
      { header: 'Stok Awal', key: 'awal', width: 15 },
      { header: 'Terpakai/Terjual', key: 'terpakai', width: 18 },
      { header: 'Sisa Stok', key: 'sisa', width: 15 },
    ];

    wsStok.getRow(1).eachCell(cell => {
      cell.style = headerStyle;
    });
    wsStok.autoFilter = 'A1:F1';

    let stockRowNumber = 1;
    stockCategoryOrder.filter(category => groupedStockReport[category]?.length).forEach(category => {
      const categoryRow = wsStok.addRow({
        no: '',
        name: category,
        unit: '',
        awal: '',
        terpakai: '',
        sisa: ''
      });
      wsStok.mergeCells(`B${categoryRow.number}:F${categoryRow.number}`);
      categoryRow.getCell('B').font = { bold: true, color: { argb: 'FFB42829' } };
      categoryRow.getCell('B').fill = dateHeaderFill;
      categoryRow.getCell('B').alignment = { horizontal: 'left', vertical: 'middle' };
      categoryRow.eachCell(cell => {
        cell.border = cellBorder;
      });

      groupedStockReport[category].forEach(item => {
        const row = wsStok.addRow({
          no: stockRowNumber++,
          name: item.name,
          unit: item.unit,
          awal: item.awal,
          terpakai: item.terpakai,
          sisa: item.sisa
        });
        row.eachCell(cell => { cell.border = cellBorder; });
      });
    });

    // ============================================
    // SHEET 6: Pengeluaran Harian
    // ============================================
    const wsPengeluaran = wb.addWorksheet('Pengeluaran Harian', { views: [{ state: 'frozen', ySplit: 1 }] });
    wsPengeluaran.columns = [
      { header: 'No', key: 'no', width: 6 },
      { header: 'Tanggal', key: 'date', width: 22 },
      { header: 'Keperluan', key: 'purpose', width: 42 },
      { header: 'Nominal', key: 'amount', width: 18, style: { numFmt: currencyFormat } },
    ];
    wsPengeluaran.getRow(1).eachCell(cell => {
      cell.style = headerStyle;
    });
    wsPengeluaran.autoFilter = 'A1:D1';

    (dailyExpenses ?? []).forEach((expense, index) => {
      const row = wsPengeluaran.addRow({
        no: index + 1,
        date: format(new Date(expense.date), 'dd-MM-yyyy HH:mm', { locale: localeId }),
        purpose: expense.purpose,
        amount: expense.amount,
      });
      row.eachCell(cell => { cell.border = cellBorder; });
    });

    const expenseTotalRow = wsPengeluaran.addRow({
      no: 'Total',
      amount: totalOperationalExpenses,
    });
    wsPengeluaran.mergeCells(`A${expenseTotalRow.number}:C${expenseTotalRow.number}`);
    expenseTotalRow.getCell('A').alignment = { horizontal: 'right', vertical: 'middle' };
    expenseTotalRow.eachCell(cell => {
      cell.border = cellBorder;
      cell.font = { bold: true };
      cell.fill = subtotalFill;
    });

    // ============================================
    // SHEET 7: Pemakaian Stok Barang
    // ============================================
    const wsPemakaian = wb.addWorksheet('Pemakaian Stok Barang', { views: [{ state: 'frozen', ySplit: 1 }] });
    wsPemakaian.columns = [
      { header: 'No', key: 'no', width: 6 },
      { header: 'Tanggal', key: 'date', width: 22 },
      { header: 'Nama Bahan', key: 'name', width: 32 },
      { header: 'Jumlah Pakai', key: 'qty', width: 16 },
      { header: 'Satuan', key: 'unit', width: 12 },
      { header: 'Keperluan', key: 'purpose', width: 38 },
    ];
    wsPemakaian.getRow(1).eachCell(cell => {
      cell.style = headerStyle;
    });
    wsPemakaian.autoFilter = 'A1:F1';

    (warehouseUsageLogs ?? []).forEach((log, index) => {
      const row = wsPemakaian.addRow({
        no: index + 1,
        date: format(new Date(log.date), 'dd-MM-yyyy HH:mm', { locale: localeId }),
        name: log.warehouseItemName,
        qty: log.quantity,
        unit: log.unit,
        purpose: log.purpose,
      });
      row.eachCell(cell => { cell.border = cellBorder; });
    });

    // ============================================
    // Trigger download
    // ============================================
    const fileName = `Laporan_${storeName.replace(/\s+/g, '_')}_${format(new Date(), 'yyyyMMdd_HHmm')}.xlsx`;
    const buffer = await wb.xlsx.writeBuffer();
    const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    saveAs(blob, fileName);
  };

  return (
    <div className="px-4 pt-6 pb-20 space-y-5">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold flex items-center gap-2">
          <BarChart3 className="w-5 h-5 text-primary" />
          Laporan
        </h1>
        <Button
          variant="outline"
          size="sm"
          className="gap-1.5 text-xs"
          onClick={exportToExcel}
          disabled={!transactions || transactions.length === 0}
        >
          <Download className="w-3.5 h-3.5" />
          Export Excel
        </Button>
      </div>

      <Tabs value={period} onValueChange={v => {
        setPeriod(v as 'today' | '7' | '30' | 'custom');
        if (v !== 'custom') {
          setDateFrom(undefined);
          setDateTo(undefined);
        }
      }}>
        <TabsList className="w-full">
          <TabsTrigger value="today" className="flex-1">Hari Ini</TabsTrigger>
          <TabsTrigger value="7" className="flex-1">7 Hari</TabsTrigger>
          <TabsTrigger value="30" className="flex-1">30 Hari</TabsTrigger>
          <TabsTrigger value="custom" className="flex-1">Pilih Tanggal</TabsTrigger>
        </TabsList>
      </Tabs>

      {period === 'custom' && (
        <div className="flex items-center gap-2">
          <Popover>
            <PopoverTrigger asChild>
              <Button variant="outline" size="sm" className={cn("h-9 text-xs gap-1.5 flex-1", dateFrom && "border-primary text-primary")}>
                <CalendarIcon className="w-3.5 h-3.5" />
                {dateFrom ? format(dateFrom, 'dd MMM yyyy', { locale: localeId }) : 'Dari tanggal'}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0" align="start">
              <CalendarPicker
                mode="single"
                selected={dateFrom}
                onSelect={setDateFrom}
                initialFocus
                className="p-3 pointer-events-auto"
              />
            </PopoverContent>
          </Popover>

          <span className="text-xs text-muted-foreground">-</span>

          <Popover>
            <PopoverTrigger asChild>
              <Button variant="outline" size="sm" className={cn("h-9 text-xs gap-1.5 flex-1", dateTo && "border-primary text-primary")}>
                <CalendarIcon className="w-3.5 h-3.5" />
                {dateTo ? format(dateTo, 'dd MMM yyyy', { locale: localeId }) : 'Sampai tanggal'}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0" align="end">
              <CalendarPicker
                mode="single"
                selected={dateTo}
                onSelect={setDateTo}
                initialFocus
                className="p-3 pointer-events-auto"
              />
            </PopoverContent>
          </Popover>

          {(dateFrom || dateTo) && (
            <Button variant="ghost" size="icon" className="h-9 w-9 shrink-0" onClick={() => { setDateFrom(undefined); setDateTo(undefined); }}>
              <X className="w-4 h-4" />
            </Button>
          )}
        </div>
      )}

      {/* Summary */}
      <Card className="border-0 shadow-sm overflow-hidden">
        <CardHeader className="pb-3">
          <div className="flex flex-col gap-1 md:flex-row md:items-end md:justify-between">
            <div>
              <CardTitle className="text-sm flex items-center gap-1.5">
                <BarChart3 className="w-4 h-4 text-primary" />
                Ringkasan Pembayaran
              </CardTitle>
              <p className="mt-1 text-xs text-muted-foreground">
                Cash dan QRIS dipisah agar lebih cepat dibaca. Pengeluaran operasional dan laba bersih tetap ditampilkan pada total keseluruhan.
              </p>
            </div>
            {hasOtherPaymentMethods && (
              <p className="text-[11px] text-muted-foreground">
                Total mencakup metode lain di luar Cash dan QRIS.
              </p>
            )}
          </div>
        </CardHeader>
        <CardContent className="pt-0">
          <div className="overflow-x-auto">
            <div className="min-w-[720px] rounded-xl border border-border bg-background">
              <div className="grid grid-cols-[1.4fr_1fr_1fr_1fr] bg-muted/30 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                <div className="border-b border-r border-border px-4 py-3">Keterangan</div>
                <div className="border-b border-r border-border px-4 py-3 text-center">Cash</div>
                <div className="border-b border-r border-border px-4 py-3 text-center">QRIS</div>
                <div className="border-b border-border px-4 py-3 text-center">Total</div>
              </div>

              {summaryTableRows.map((row) => {
                const rowToneClass = row.tone === 'danger'
                  ? 'text-destructive'
                  : row.tone === 'success' || row.tone === 'successStrong'
                    ? 'text-success'
                    : 'text-foreground';
                const rowWeightClass = row.tone === 'neutral'
                  ? 'font-semibold'
                  : row.tone === 'defaultStrong' || row.tone === 'successStrong'
                    ? 'font-bold'
                    : 'font-medium';

                return (
                  <div key={row.label} className="grid grid-cols-[1.4fr_1fr_1fr_1fr] text-sm">
                    <div
                      className={cn(
                        'border-b border-r border-border px-4 py-3',
                        rowWeightClass,
                        (row.label === 'Laba Bersih' || row.label === 'Margin') && 'bg-success/5',
                      )}
                    >
                      {row.label}
                    </div>
                    <div className={cn('border-b border-r border-border px-4 py-3 text-right tabular-nums', rowToneClass, rowWeightClass)}>
                      {row.cash}
                    </div>
                    <div className={cn('border-b border-r border-border px-4 py-3 text-right tabular-nums', rowToneClass, rowWeightClass)}>
                      {row.qris}
                    </div>
                    <div
                      className={cn(
                        'border-b border-border px-4 py-3 text-right tabular-nums',
                        rowToneClass,
                        rowWeightClass,
                        (row.label === 'Laba Bersih' || row.label === 'Margin') && 'bg-success/5',
                      )}
                    >
                      {row.total}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Chart */}
      <Card className="border-0 shadow-sm">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Tren Penjualan</CardTitle>
        </CardHeader>
        <CardContent className="pb-4">
          <ResponsiveContainer width="100%" height={180}>
            <BarChart data={chartData}>
              <XAxis dataKey="date" tick={{ fontSize: 10 }} axisLine={false} tickLine={false} />
              <YAxis hide />
              <Tooltip formatter={(v: number) => [`Rp ${v.toLocaleString('id-ID')}`, 'Penjualan']} contentStyle={{ fontSize: 12, borderRadius: 8 }} />
              <Bar dataKey="sales" fill="hsl(25, 95%, 53%)" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      <Card className="border-0 shadow-sm">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-1.5">
            <ShoppingCart className="w-4 h-4" />
            Tipe Layanan
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid gap-2 sm:grid-cols-2">
            <div className="rounded-xl border bg-muted/20 p-3">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold">Dine In</p>
                  <p className="text-[10px] text-muted-foreground">
                    {txCount > 0 ? ((serviceTypeBreakdown.dine_in.count / txCount) * 100).toFixed(1) : '0.0'}% dari transaksi
                  </p>
                </div>
                <div className="text-right">
                  <p className="text-lg font-bold">{serviceTypeBreakdown.dine_in.count}</p>
                  <p className="text-[10px] text-muted-foreground">{rp(serviceTypeBreakdown.dine_in.total)}</p>
                </div>
              </div>
            </div>
            <div className="rounded-xl border bg-muted/20 p-3">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold">Take Away</p>
                  <p className="text-[10px] text-muted-foreground">
                    {txCount > 0 ? ((serviceTypeBreakdown.take_away.count / txCount) * 100).toFixed(1) : '0.0'}% dari transaksi
                  </p>
                </div>
                <div className="text-right">
                  <p className="text-lg font-bold">{serviceTypeBreakdown.take_away.count}</p>
                  <p className="text-[10px] text-muted-foreground">{rp(serviceTypeBreakdown.take_away.total)}</p>
                </div>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Top Products */}
      <Card className="border-0 shadow-sm">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-1.5">
            <Package className="w-4 h-4" />
            Produk Terlaris
          </CardTitle>
        </CardHeader>
        <CardContent>
          {topProducts.length === 0 ? (
            <p className="text-xs text-muted-foreground py-4 text-center">Belum ada data penjualan</p>
          ) : (
            <div className="space-y-2">
              {topProducts.map((p, i) => (
                <div key={p.name} className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="w-5 h-5 rounded-full bg-primary/10 text-primary text-[10px] font-bold flex items-center justify-center">{i + 1}</span>
                    <div className="min-w-0">
                      <p className="text-sm leading-tight break-words">{p.name}</p>
                      <p className="text-[10px] text-muted-foreground">{p.qty} terjual</p>
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="text-xs font-bold">{rp(p.netRevenue)}</p>
                    <p className="text-[10px] text-muted-foreground">bersih - laba {rp(p.profit)}</p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="border-0 shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-1.5">
              <DollarSign className="w-4 h-4" />
              Pengeluaran Harian
            </CardTitle>
          </CardHeader>
          <CardContent>
            {recentExpenses.length === 0 ? (
              <p className="text-xs text-muted-foreground py-4 text-center">Belum ada pengeluaran pada periode ini</p>
            ) : (
              <div className="space-y-2">
                {recentExpenses.map(expense => (
                  <div key={expense.id} className="flex items-center justify-between gap-3 border-b last:border-0 pb-2 last:pb-0">
                    <div className="min-w-0">
                      <p className="text-sm break-words">{expense.purpose}</p>
                      <p className="text-[10px] text-muted-foreground">
                        {format(new Date(expense.date), 'dd MMM yyyy HH:mm', { locale: localeId })}
                      </p>
                    </div>
                    <p className="text-xs font-bold shrink-0">{rp(expense.amount)}</p>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="border-0 shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-1.5">
              <PackageMinus className="w-4 h-4" />
              Pemakaian Stok Manual
            </CardTitle>
          </CardHeader>
          <CardContent>
            {recentUsageLogs.length === 0 ? (
              <p className="text-xs text-muted-foreground py-4 text-center">Belum ada pemakaian stok manual pada periode ini</p>
            ) : (
              <div className="space-y-2">
                {recentUsageLogs.map(log => (
                  <div key={log.id} className="flex items-center justify-between gap-3 border-b last:border-0 pb-2 last:pb-0">
                    <div className="min-w-0">
                      <p className="text-sm break-words">{log.warehouseItemName}</p>
                      <p className="text-[10px] text-muted-foreground break-words">
                        {log.quantity} {log.unit} - {log.purpose}
                      </p>
                    </div>
                    <p className="text-[10px] text-muted-foreground shrink-0">
                      {format(new Date(log.date), 'dd MMM HH:mm', { locale: localeId })}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Laporan Stok Bahan */}
      <Card className="border-0 shadow-sm">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-1.5">
            <Package className="w-4 h-4 text-primary" />
            Laporan Stok Bahan
          </CardTitle>
        </CardHeader>
        <CardContent>
          {stockReport.length === 0 ? (
            <p className="text-xs text-muted-foreground py-4 text-center">Belum ada data stok</p>
          ) : (
            <div className="space-y-4">
              {stockCategoryOrder.filter(category => groupedStockReport[category]?.length).map(category => (
                <div key={category} className="space-y-3">
                  <div className="px-3 py-2 rounded-lg border bg-muted/20">
                    <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">{category}</p>
                  </div>
                  {groupedStockReport[category].map((item) => (
                    <div key={item.id} className="border-b last:border-0 pb-3 last:pb-0">
                      <div className="flex justify-between items-center mb-1.5">
                        <span className="text-sm font-semibold text-foreground">{item.name}</span>
                        <span className="text-xs text-muted-foreground font-medium bg-secondary/30 px-2.5 py-0.5 rounded-full">{item.unit}</span>
                      </div>
                      <div className="grid grid-cols-3 gap-2 text-center text-xs">
                        <div className="bg-muted/40 p-2 rounded">
                          <p className="text-[9px] text-muted-foreground uppercase font-bold tracking-wider mb-0.5">Stok Awal</p>
                          <p className="font-bold text-foreground text-sm">{item.awal}</p>
                        </div>
                        <div className="bg-primary/10 p-2 rounded">
                          <p className="text-[9px] text-primary uppercase font-bold tracking-wider mb-0.5">Terpakai</p>
                          <p className="font-bold text-primary text-sm">{item.terpakai}</p>
                        </div>
                        <div className="bg-success/15 p-2 rounded">
                          <p className="text-[9px] text-success uppercase font-bold tracking-wider mb-0.5">Sisa Stok</p>
                          <p className="font-bold text-success text-sm">{item.sisa}</p>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

