import { useLiveQuery } from 'dexie-react-hooks';
import { db, type TransactionItemRecord } from '@/lib/db';
import { useState } from 'react';
import { BarChart3, TrendingUp, ShoppingCart, Package, DollarSign, ArrowDown, ArrowUp, Minus, Download } from 'lucide-react';
import ExcelJS from 'exceljs';
import { saveAs } from 'file-saver';
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
  const { can } = useAuth();
  const [period, setPeriod] = useState<'7' | '30' | 'custom'>('7');
  const [dateFrom, setDateFrom] = useState<Date | undefined>(undefined);
  const [dateTo, setDateTo] = useState<Date | undefined>(undefined);
  const days = period === 'custom' ? 0 : Number(period);

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
      const since = startOfDay(subDays(new Date(), days));
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

  // Permission gate after all hooks have been called.
  if (!can('view_reports')) {
    return <LockedPage title="Laporan" permissionLabel="Lihat Laporan & Profit" />;
  }

  const allItems = txItems ?? [];

  const totalSales = transactions?.reduce((s, t) => s + t.total, 0) ?? 0;
  const totalProfit = transactions?.reduce((s, t) => s + t.profit, 0) ?? 0;
  const txCount = transactions?.length ?? 0;

  // P&L breakdown
  const totalRevenue = transactions?.reduce((s, t) => s + t.subtotal, 0) ?? 0;
  const totalDiscount = transactions?.reduce((s, t) => s + (t.discountAmount || 0), 0) ?? 0;
  const totalHpp = allItems.reduce((s, item) => s + item.hpp * item.quantity, 0);
  const netSales = totalRevenue - totalDiscount; // same as totalSales
  const grossProfit = netSales - totalHpp;
  const marginPercent = netSales > 0 ? (grossProfit / netSales * 100) : 0;

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
  const productSales: Record<string, { name: string; qty: number; revenue: number; profit: number }> = {};
  allItems.forEach(item => {
    if (!productSales[item.productName]) productSales[item.productName] = { name: item.productName, qty: 0, revenue: 0, profit: 0 };
    productSales[item.productName].qty += item.quantity;
    productSales[item.productName].revenue += item.subtotal;
    productSales[item.productName].profit += (item.price - item.hpp) * item.quantity - (item.discountAmount || 0);
  });
  const topProducts = Object.values(productSales).sort((a, b) => b.revenue - a.revenue).slice(0, 5);

  const rp = (n: number) => `Rp ${n.toLocaleString('id-ID')}`;

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
      }
    });

    return warehouseItems.map(item => {
      const terpakai = usedMap[item.id!] || 0;
      const sisa = item.stock;
      const awal = sisa + terpakai;
      return {
        id: item.id!,
        name: item.name,
        unit: item.unit,
        awal,
        terpakai,
        sisa
      };
    });
  })();

  // === Export to Excel ===
  const exportToExcel = async () => {
    if (!transactions || transactions.length === 0) return;

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
    const headerStyle = {
      font: { bold: true, color: { argb: 'FFFFFFFF' } },
      fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFB42829' } }, // Red theme
      alignment: { vertical: 'middle', horizontal: 'center' },
      border: {
        top: { style: 'thin', color: { argb: 'FFB42829' } },
        left: { style: 'thin', color: { argb: 'FFB42829' } },
        bottom: { style: 'thin', color: { argb: 'FFB42829' } },
        right: { style: 'thin', color: { argb: 'FFB42829' } }
      }
    };
    
    const cellBorder = {
      top: { style: 'thin', color: { argb: 'FFE2E8F0' } },
      left: { style: 'thin', color: { argb: 'FFE2E8F0' } },
      bottom: { style: 'thin', color: { argb: 'FFE2E8F0' } },
      right: { style: 'thin', color: { argb: 'FFE2E8F0' } }
    };
    
    // Currency format
    const currencyFormat = 'Rp #,##0';
    // Percentage format
    const percentFormat = '0.0%';
    // Subtotal Fill
    const subtotalFill = { type: 'pattern' as const, pattern: 'solid' as const, fgColor: { argb: 'FFF9E5E5' } };

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
        // @ts-ignore
        wsRingkasan.getCell(cell).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF9F9F9' } };
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

    cardData.forEach((c, idx) => {
      const startLetter = String.fromCharCode(65 + (idx * 2)); // A, C, E, G, I, K, M
      const endLetter = String.fromCharCode(65 + (idx * 2) + 1); // B, D, F, H, J, L, N
      
      // Row 7 (Label)
      wsRingkasan.mergeCells(`${startLetter}7:${endLetter}7`);
      const labelCell = wsRingkasan.getCell(`${startLetter}7`);
      labelCell.value = c.label;
      labelCell.font = { bold: true, size: 14, color: { argb: 'FFFFFFFF' } };
      // @ts-ignore
      labelCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFB42829' } };
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
    // @ts-ignore
    wsRingkasan.getCell('A13').style = headerStyle;
    
    wsRingkasan.mergeCells('A14:C14'); wsRingkasan.getCell('A14').value = 'Keterangan';
    wsRingkasan.mergeCells('D14:F14'); wsRingkasan.getCell('D14').value = 'Jumlah';
    ['A14','D14'].forEach(c => { wsRingkasan.getCell(c).font = { bold: true }; wsRingkasan.getCell(c).alignment = { horizontal: 'center' }; });

    let rRow = 15;
    cardData.forEach(c => {
      wsRingkasan.mergeCells(`A${rRow}:C${rRow}`);
      wsRingkasan.mergeCells(`D${rRow}:F${rRow}`);
      
      wsRingkasan.getCell(`A${rRow}`).value = c.label;
      wsRingkasan.getCell(`D${rRow}`).value = c.val;
      if (c.fmt) wsRingkasan.getCell(`D${rRow}`).numFmt = c.fmt;
      wsRingkasan.getCell(`D${rRow}`).alignment = { horizontal: 'center' };
      
      if (rRow % 2 !== 0) {
        ['A','D'].forEach(col => {
          // @ts-ignore
          wsRingkasan.getCell(`${col}${rRow}`).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF9E5E5' } };
        });
      }
      if (c.label === 'Penjualan Bersih') {
        ['A','D'].forEach(col => {
          wsRingkasan.getCell(`${col}${rRow}`).font = { bold: true, color: { argb: 'FFB42829' } };
          // @ts-ignore
          wsRingkasan.getCell(`${col}${rRow}`).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF2D0D0' } };
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
    // @ts-ignore
    wsRingkasan.getCell('H13').style = headerStyle;

    wsRingkasan.mergeCells('H14:I14'); wsRingkasan.getCell('H14').value = 'Metode Pembayaran';
    wsRingkasan.getCell('J14').value = 'Jml Trx';
    wsRingkasan.mergeCells('K14:L14'); wsRingkasan.getCell('K14').value = 'Total';
    wsRingkasan.mergeCells('M14:N14'); wsRingkasan.getCell('M14').value = 'Persentase';
    
    ['H14','J14','K14','M14'].forEach(c => { 
      // @ts-ignore
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
      // @ts-ignore
      wsRingkasan.getCell(`${col}${pRow}`).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF9E5E5' } };
    });

    for(let i=14; i<=pRow; i++) {
      ['H','I'].forEach(col => wsRingkasan.getCell(`${col}${i}`).border = { top: cellBorder.top, bottom: cellBorder.bottom, left: col==='H'?cellBorder.left:undefined, right: col==='I'?cellBorder.right:undefined });
      wsRingkasan.getCell(`J${i}`).border = cellBorder;
      ['K','L'].forEach(col => wsRingkasan.getCell(`${col}${i}`).border = { top: cellBorder.top, bottom: cellBorder.bottom, left: col==='K'?cellBorder.left:undefined, right: col==='L'?cellBorder.right:undefined });
      ['M','N'].forEach(col => wsRingkasan.getCell(`${col}${i}`).border = { top: cellBorder.top, bottom: cellBorder.bottom, left: col==='M'?cellBorder.left:undefined, right: col==='N'?cellBorder.right:undefined });
    }

    // ============================================
    // SHEET 2: Detail Transaksi
    // ============================================
    const wsDetail = wb.addWorksheet('Detail Transaksi');
    wsDetail.columns = [
      { header: 'No', key: 'no', width: 6 },
      { header: 'Tanggal', key: 'date', width: 20 },
      { header: 'No Struk', key: 'receipt', width: 22 },
      { header: 'Metode Pembayaran', key: 'payment', width: 22 },
      { header: 'Pendapatan Kotor', key: 'gross', width: 22, style: { numFmt: currencyFormat } },
      { header: 'Diskon', key: 'discount', width: 15, style: { numFmt: currencyFormat } },
      { header: 'Penjualan Bersih', key: 'net', width: 22, style: { numFmt: currencyFormat } },
      { header: 'HPP (Modal)', key: 'hpp', width: 22, style: { numFmt: currencyFormat } },
      { header: 'Profit (Laba Kotor)', key: 'profit', width: 22, style: { numFmt: currencyFormat } },
    ];

    wsDetail.getRow(1).eachCell(cell => {
      // @ts-ignore
      cell.style = headerStyle;
    });

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
    wsDetail.mergeCells(`A${totalRow.number}:D${totalRow.number}`);
    totalRow.getCell('A').alignment = { horizontal: 'center', vertical: 'middle' };
    totalRow.getCell('A').font = { bold: true };
    totalRow.eachCell(cell => { 
      cell.border = cellBorder;
      if (cell.col > 4) {
        cell.font = { bold: true };
      }
    });

    // ============================================
    // SHEET 3: Produk Terlaris
    // ============================================
    const wsProduk = wb.addWorksheet('Produk Terlaris');
    wsProduk.columns = [
      { header: 'No', key: 'no', width: 6 },
      { header: 'Nama Produk', key: 'name', width: 30 },
      { header: 'Jumlah Terjual', key: 'qty', width: 16 },
      { header: 'Satuan', key: 'unit', width: 12 },
      { header: 'Total Pendapatan Kotor', key: 'gross', width: 25, style: { numFmt: currencyFormat } },
      { header: 'Total HPP (Modal)', key: 'hpp', width: 22, style: { numFmt: currencyFormat } },
      { header: 'Total Laba Kotor', key: 'profit', width: 22, style: { numFmt: currencyFormat } },
      { header: 'Margin', key: 'margin', width: 12, style: { numFmt: percentFormat } },
    ];

    wsProduk.getRow(1).eachCell(cell => {
      // @ts-ignore
      cell.style = headerStyle;
    });

    // Pre-compute transaction-level discount distribution
    // Discounts applied to the whole cart aren't in item.discountAmount,
    // so we distribute them proportionally across items by subtotal share.
    const txDiscountInfo: Record<number, { extraDiscount: number; itemSubtotalSum: number }> = {};
    transactions.forEach(t => {
      const txItems = allItems.filter(item => item.transactionId === t.id);
      const itemDiscountSum = txItems.reduce((s, item) => s + (item.discountAmount || 0), 0);
      const itemSubtotalSum = txItems.reduce((s, item) => s + item.subtotal, 0);
      if (t.id) txDiscountInfo[t.id] = { extraDiscount: (t.discountAmount || 0) - itemDiscountSum, itemSubtotalSum };
    });

    // Build per-product aggregation
    const prodAgg: Record<string, {
      name: string; qty: number; revenue: number;
      hpp: number; profit: number; productId: number;
    }> = {};
    allItems.forEach(item => {
      const key = item.productName;
      if (!prodAgg[key]) prodAgg[key] = { name: key, qty: 0, revenue: 0, hpp: 0, profit: 0, productId: item.productId };
      prodAgg[key].qty += item.quantity;
      prodAgg[key].revenue += item.subtotal;
      prodAgg[key].hpp += item.hpp * item.quantity;
      prodAgg[key].profit += item.subtotal - (item.hpp * item.quantity);
    });

    const prodSorted = Object.values(prodAgg).sort((a, b) => b.revenue - a.revenue);

    prodSorted.forEach((p, i) => {
      const margin = p.revenue > 0 ? (p.profit / p.revenue) : 0;
      const row = wsProduk.addRow({
        no: i + 1,
        name: p.name,
        qty: p.qty,
        unit: productUnitMap[p.productId] || 'pcs',
        gross: p.revenue,
        hpp: p.hpp,
        profit: p.profit,
        margin: margin
      });
      row.eachCell(cell => { cell.border = cellBorder; });
    });

    // Footer: Sub Total Laba Kotor, Diskon (conditional), Grand Total
    const prodSubTotalProfit = prodSorted.reduce((s, p) => s + p.profit, 0);
    const prodTotalDiscount = totalDiscount;

    const prodSubRow = wsProduk.addRow({ no: 'Sub Total Laba Kotor', name: '', qty: '', unit: '', gross: '', hpp: '', profit: prodSubTotalProfit, margin: '' });
    wsProduk.mergeCells(`A${prodSubRow.number}:F${prodSubRow.number}`);
    prodSubRow.getCell('A').alignment = { horizontal: 'right', vertical: 'middle' };
    prodSubRow.eachCell(cell => {
      cell.border = cellBorder;
      cell.font = { bold: true };
      // @ts-ignore
      cell.fill = subtotalFill;
    });

    if (prodTotalDiscount > 0) {
      const prodDiscRow = wsProduk.addRow({ no: 'Diskon', name: '', qty: '', unit: '', gross: '', hpp: '', profit: prodTotalDiscount, margin: '' });
      wsProduk.mergeCells(`A${prodDiscRow.number}:F${prodDiscRow.number}`);
      prodDiscRow.getCell('A').alignment = { horizontal: 'right', vertical: 'middle' };
      prodDiscRow.eachCell(cell => {
        cell.border = cellBorder;
        cell.font = { bold: true, color: { argb: 'FFB42829' } };
      });
    }

    const prodGrandRow = wsProduk.addRow({ no: 'Grand Total Laba Kotor', name: '', qty: '', unit: '', gross: '', hpp: '', profit: prodSubTotalProfit - prodTotalDiscount, margin: '' });
    wsProduk.mergeCells(`A${prodGrandRow.number}:F${prodGrandRow.number}`);
    prodGrandRow.getCell('A').alignment = { horizontal: 'right', vertical: 'middle' };
    prodGrandRow.eachCell(cell => {
      cell.border = cellBorder;
      cell.font = { bold: true, size: 12, color: { argb: 'FFFFFFFF' } };
      // @ts-ignore
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFB42829' } };
    });

    // ============================================
    // SHEET 4: Detail Penjualan Harian
    // ============================================
    const wsHarian = wb.addWorksheet('Detail Penjualan Harian');
    wsHarian.columns = [
      { header: 'Tanggal', key: 'date', width: 18 },
      { header: 'Nama Produk', key: 'name', width: 30 },
      { header: 'Jumlah Terjual', key: 'qty', width: 16 },
      { header: 'Satuan', key: 'unit', width: 12 },
      { header: 'Total Pendapatan Kotor', key: 'gross', width: 25, style: { numFmt: currencyFormat } },
      { header: 'Total HPP (Modal)', key: 'hpp', width: 22, style: { numFmt: currencyFormat } },
      { header: 'Total Laba Kotor', key: 'profit', width: 22, style: { numFmt: currencyFormat } },
    ];

    wsHarian.getRow(1).eachCell(cell => {
      // @ts-ignore
      cell.style = headerStyle;
    });

    // Build daily per-product aggregation: { 'dd-MM-yyyy': { productName: { qty, revenue, hpp, profit, productId } } }
    const dailyAgg: Record<string, Record<string, {
      name: string; qty: number; revenue: number;
      hpp: number; profit: number; productId: number;
    }>> = {};

    // Also build per-day discount totals
    const dailyDiscountMap: Record<string, number> = {};
    transactions.forEach(t => {
      const dateKey = format(new Date(t.date), 'dd-MM-yyyy', { locale: localeId });
      if (!dailyAgg[dateKey]) dailyAgg[dateKey] = {};
      if (!dailyDiscountMap[dateKey]) dailyDiscountMap[dateKey] = 0;
      dailyDiscountMap[dateKey] += (t.discountAmount || 0);

      const txItems = allItems.filter(item => item.transactionId === t.id);
      txItems.forEach(item => {
        const key = item.productName;
        if (!dailyAgg[dateKey][key]) {
          dailyAgg[dateKey][key] = { name: key, qty: 0, revenue: 0, hpp: 0, profit: 0, productId: item.productId };
        }
        dailyAgg[dateKey][key].qty += item.quantity;
        dailyAgg[dateKey][key].revenue += item.subtotal;
        dailyAgg[dateKey][key].hpp += item.hpp * item.quantity;
        dailyAgg[dateKey][key].profit += item.subtotal - (item.hpp * item.quantity);
      });
    });

    // Sort dates chronologically (dd-MM-yyyy -> parse back)
    const sortedDates = Object.keys(dailyAgg).sort((a, b) => {
      const [da, ma, ya] = a.split('-').map(Number);
      const [db, mb, yb] = b.split('-').map(Number);
      return new Date(ya, ma - 1, da).getTime() - new Date(yb, mb - 1, db).getTime();
    });

    const dateHeaderFill = { type: 'pattern' as const, pattern: 'solid' as const, fgColor: { argb: 'FFF2D0D0' } };

    let grandQty = 0, grandRevenue = 0, grandHpp = 0, grandProfit = 0;

    sortedDates.forEach(dateKey => {
      const productsOfDay = Object.values(dailyAgg[dateKey]).sort((a, b) => b.revenue - a.revenue);

      // Date header row
      const dateRow = wsHarian.addRow({ date: `📅 ${dateKey}`, name: '', qty: '', unit: '', gross: '', hpp: '', profit: '' });
      wsHarian.mergeCells(`A${dateRow.number}:G${dateRow.number}`);
      dateRow.getCell('A').font = { bold: true, size: 12, color: { argb: 'FFB42829' } };
      // @ts-ignore
      dateRow.getCell('A').fill = dateHeaderFill;
      dateRow.getCell('A').alignment = { vertical: 'middle' };
      dateRow.height = 22;

      let dayQty = 0, dayRevenue = 0, dayHpp = 0, dayProfit = 0;

      productsOfDay.forEach(p => {
        const row = wsHarian.addRow({
          date: '',
          name: p.name,
          qty: p.qty,
          unit: productUnitMap[p.productId] || 'pcs',
          gross: p.revenue,
          hpp: p.hpp,
          profit: p.profit,
        });
        row.eachCell(cell => { cell.border = cellBorder; });

        dayQty += p.qty;
        dayRevenue += p.revenue;
        dayHpp += p.hpp;
        dayProfit += p.profit;
      });

      // Subtotal row per date
      const subRow = wsHarian.addRow({
        date: '',
        name: `Sub Total Laba Kotor ${dateKey}`,
        qty: dayQty,
        unit: '',
        gross: dayRevenue,
        hpp: dayHpp,
        profit: dayProfit,
      });
      subRow.eachCell(cell => {
        cell.border = cellBorder;
        cell.font = { bold: true, color: { argb: 'FFB42829' } };
        // @ts-ignore
        cell.fill = subtotalFill;
      });

      // Per-day discount row (only if that day has discounts)
      const dayDiscount = dailyDiscountMap[dateKey] || 0;
      if (dayDiscount > 0) {
        const dayDiscRow = wsHarian.addRow({ date: '', name: `Diskon ${dateKey}`, qty: '', unit: '', gross: '', hpp: '', profit: dayDiscount });
        dayDiscRow.eachCell(cell => {
          cell.border = cellBorder;
          cell.font = { bold: true, color: { argb: 'FFB42829' } };
        });

        const dayTotalRow = wsHarian.addRow({ date: '', name: `Total ${dateKey}`, qty: dayQty, unit: '', gross: dayRevenue, hpp: dayHpp, profit: dayProfit - dayDiscount });
        dayTotalRow.eachCell(cell => {
          cell.border = cellBorder;
          cell.font = { bold: true, color: { argb: 'FFB42829' } };
          // @ts-ignore
          cell.fill = subtotalFill;
        });
      }

      grandQty += dayQty;
      grandRevenue += dayRevenue;
      grandHpp += dayHpp;
      grandProfit += dayProfit;
    });

    // Grand total footer: Sub Total, Diskon (conditional), Grand Total
    const grandTotalDiscount = totalDiscount;

    const grandSubRow = wsHarian.addRow({ date: '', name: 'Sub Total Laba Kotor', qty: grandQty, unit: '', gross: grandRevenue, hpp: grandHpp, profit: grandProfit });
    grandSubRow.eachCell(cell => {
      cell.border = cellBorder;
      cell.font = { bold: true };
      // @ts-ignore
      cell.fill = subtotalFill;
    });

    if (grandTotalDiscount > 0) {
      const grandDiscRow = wsHarian.addRow({ date: '', name: 'Diskon', qty: '', unit: '', gross: '', hpp: '', profit: grandTotalDiscount });
      grandDiscRow.eachCell(cell => {
        cell.border = cellBorder;
        cell.font = { bold: true, color: { argb: 'FFB42829' } };
      });
    }

    const grandRow = wsHarian.addRow({ date: '', name: 'Grand Total', qty: grandQty, unit: '', gross: grandRevenue, hpp: grandHpp, profit: grandProfit - grandTotalDiscount });
    grandRow.eachCell(cell => {
      cell.border = cellBorder;
      cell.font = { bold: true, size: 12, color: { argb: 'FFFFFFFF' } };
      // @ts-ignore
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFB42829' } };
    });

    // ============================================
    // SHEET 5: Laporan Stok Bahan
    // ============================================
    const wsStok = wb.addWorksheet('Laporan Stok Bahan');
    wsStok.columns = [
      { header: 'No', key: 'no', width: 6 },
      { header: 'Nama Bahan', key: 'name', width: 30 },
      { header: 'Satuan', key: 'unit', width: 12 },
      { header: 'Stok Awal', key: 'awal', width: 15 },
      { header: 'Terpakai/Terjual', key: 'terpakai', width: 18 },
      { header: 'Sisa Stok', key: 'sisa', width: 15 },
    ];

    wsStok.getRow(1).eachCell(cell => {
      // @ts-ignore
      cell.style = headerStyle;
    });

    stockReport.forEach((item, i) => {
      const row = wsStok.addRow({
        no: i + 1,
        name: item.name,
        unit: item.unit,
        awal: item.awal,
        terpakai: item.terpakai,
        sisa: item.sisa
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
        setPeriod(v as '7' | '30' | 'custom');
        if (v !== 'custom') {
          setDateFrom(undefined);
          setDateTo(undefined);
        }
      }}>
        <TabsList className="w-full">
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

          <span className="text-xs text-muted-foreground">—</span>

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
      <div className="grid grid-cols-3 gap-2">
        <Card className="border-0 shadow-sm">
          <CardContent className="p-3 text-center">
            <ShoppingCart className="w-4 h-4 mx-auto text-primary mb-1" />
            <p className="text-lg font-bold">{txCount}</p>
            <p className="text-[10px] text-muted-foreground">Transaksi</p>
          </CardContent>
        </Card>
        <Card className="border-0 shadow-sm">
          <CardContent className="p-3 text-center">
            <TrendingUp className="w-4 h-4 mx-auto text-success mb-1" />
            <p className="text-sm font-bold">{rp(totalSales)}</p>
            <p className="text-[10px] text-muted-foreground">Penjualan</p>
          </CardContent>
        </Card>
        <Card className="border-0 shadow-sm">
          <CardContent className="p-3 text-center">
            <TrendingUp className="w-4 h-4 mx-auto text-accent mb-1" />
            <p className="text-sm font-bold">{rp(totalProfit)}</p>
            <p className="text-[10px] text-muted-foreground">Profit</p>
          </CardContent>
        </Card>
      </div>

      {/* Profit & Loss */}
      <Card className="border-0 shadow-sm">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-1.5">
            <DollarSign className="w-4 h-4" />
            Laba Rugi
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <div className="flex justify-between items-center text-sm">
            <div className="flex items-center gap-2">
              <ArrowUp className="w-3.5 h-3.5 text-success" />
              <span>Pendapatan Kotor</span>
            </div>
            <span className="font-semibold">{rp(totalRevenue)}</span>
          </div>
          {totalDiscount > 0 && (
            <div className="flex justify-between items-center text-sm text-destructive">
              <div className="flex items-center gap-2">
                <Minus className="w-3.5 h-3.5" />
                <span>Diskon</span>
              </div>
              <span className="font-semibold">-{rp(totalDiscount)}</span>
            </div>
          )}
          <div className="flex justify-between items-center text-sm border-t pt-2">
            <span className="font-medium">Penjualan Bersih</span>
            <span className="font-bold">{rp(netSales)}</span>
          </div>
          <div className="flex justify-between items-center text-sm text-destructive">
            <div className="flex items-center gap-2">
              <ArrowDown className="w-3.5 h-3.5" />
              <span>HPP (Modal)</span>
            </div>
            <span className="font-semibold">-{rp(totalHpp)}</span>
          </div>
          <div className="flex justify-between items-center text-base border-t pt-2">
            <span className="font-bold">Laba Kotor</span>
            <span className={`font-bold ${grossProfit >= 0 ? 'text-success' : 'text-destructive'}`}>
              {rp(grossProfit)}
            </span>
          </div>
          <div className="flex justify-between items-center text-xs text-muted-foreground">
            <span>Margin</span>
            <span className="font-semibold">{marginPercent.toFixed(1)}%</span>
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
                    <span className="text-sm">{p.name}</span>
                  </div>
                  <div className="text-right">
                    <p className="text-xs font-bold">{rp(p.revenue)}</p>
                    <p className="text-[10px] text-muted-foreground">{p.qty} terjual · laba {rp(p.profit)}</p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

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
              {stockReport.map((item) => (
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
          )}
        </CardContent>
      </Card>
    </div>
  );
}
