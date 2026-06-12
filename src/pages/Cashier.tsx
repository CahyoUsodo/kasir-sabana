import { useLiveQuery } from 'dexie-react-hooks';
import { db, type Product, type Category, type Transaction, type TransactionItemRecord, type CartOptionSnapshot, adjustConfiguredStock, buildStockKey, getAvailableStockForSelection } from '@/lib/db';
import { useState, useRef, useEffect } from 'react';
import { Search, Plus, Minus, ShoppingCart, X, Percent, Tag, CreditCard, Banknote, Check, Package as PackageIcon, Pencil, User, Hash, Utensils, ShoppingBag } from 'lucide-react';
import Receipt from '@/components/Receipt';
import { useSearchParams } from 'react-router-dom';

import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import { useAuth } from '@/hooks/use-auth';
import LockedPage from '@/components/LockedPage';

interface CartItem {
  product: Product;
  stockKey: string;
  baseName: string;
  selectedOptions: CartOptionSnapshot[];
  qty: number;
  discountType: 'percentage' | 'nominal' | null;
  discountValue: number;
  notes?: string;
}

export default function Kasir() {
  const { currentUser, can } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const editTxIdParam = searchParams.get('editTxId');

  const [search, setSearch] = useState('');
  const [filterCategory, setFilterCategory] = useState<string>('all');
  const [cart, setCart] = useState<CartItem[]>([]);
  const [editingTxId, setEditingTxId] = useState<number | null>(null);
  const [originalQuantities, setOriginalQuantities] = useState<Record<string, number>>({});
  const [originalTx, setOriginalTx] = useState<Transaction | null>(null);
  const [originalItems, setOriginalItems] = useState<TransactionItemRecord[]>([]);
  const [serviceType, setServiceType] = useState<'dine_in' | 'take_away'>('dine_in');

  const [cartOpen, setCartOpen] = useState(false);
  const [checkoutOpen, setCheckoutOpen] = useState(false);
  const [txDiscountType, setTxDiscountType] = useState<'percentage' | 'nominal' | null>(null);
  const [txDiscountValue, setTxDiscountValue] = useState('');
  const [discountDialogOpen, setDiscountDialogOpen] = useState(false);
  const [tempDiscountType, setTempDiscountType] = useState<'percentage' | 'nominal'>('nominal');
  const [tempDiscountValue, setTempDiscountValue] = useState('');
  // Item-level discount dialog state
  const [itemDiscountTargetId, setItemDiscountTargetId] = useState<number | null>(null);
  const [itemDiscountType, setItemDiscountType] = useState<'percentage' | 'nominal'>('nominal');
  const [itemDiscountValue, setItemDiscountValue] = useState('');
  const [paymentMethodId, setPaymentMethodId] = useState<string>('');
  const [paymentAmount, setPaymentAmount] = useState('');
  const [isQuickAdding, setIsQuickAdding] = useState(false);
  const [receiptOpen, setReceiptOpen] = useState(false);
  const [lastTransaction, setLastTransaction] = useState<Transaction | null>(null);
  const [lastTxItems, setLastTxItems] = useState<TransactionItemRecord[]>([]);
  const [customerName, setCustomerName] = useState('');
  const [tableNumber, setTableNumber] = useState('');
  const [remarks, setRemarks] = useState('');

  const [editingItemNotes, setEditingItemNotes] = useState<string | null>(null);
  const [tempItemNotes, setTempItemNotes] = useState('');

  const [prepModalOpen, setPrepModalOpen] = useState(false);
  const [prepCounts, setPrepCounts] = useState<Record<number, string>>({});
  const [optionProduct, setOptionProduct] = useState<Product | null>(null);
  const [selectedOptionIds, setSelectedOptionIds] = useState<Record<number, number[]>>({});

  const products = useLiveQuery(() => db.products.where('isDeleted').equals(0).toArray());
  const categories = useLiveQuery(() => db.categories.where('isDeleted').equals(0).toArray());
  const visibleWarehouseItems = useLiveQuery(() => db.warehouseItems.where('isDeleted').equals(0).toArray());
  const chickenItems = useLiveQuery(() => db.warehouseItems.where('isDailyReset').equals(1).toArray());
  const dailyPrepFormulas = useLiveQuery(() => db.dailyPrepFormulas.toArray());
  const paymentMethods = useLiveQuery(() => db.paymentMethods.toArray());
  const storeSettings = useLiveQuery(() => db.storeSettings.toCollection().first());
  const allUsers = useLiveQuery(() => db.users.toArray());
  const productRecipes = useLiveQuery(() => db.productRecipes.toArray());
  const productOptionGroups = useLiveQuery(() => db.productOptionGroups.toArray());
  const productOptions = useLiveQuery(() => db.productOptions.toArray());

  // Permission gate — kept render-side (not redirect) so the bottom nav stays
  // intact. All hooks above run unconditionally; we just swap the rendered tree.
  const allowed = can('create_transaction');

  const getProductGroups = (productId?: number) => (productOptionGroups ?? [])
    .filter(group => group.productId === productId && group.isDeleted === 0)
    .sort((a, b) => a.sortOrder - b.sortOrder);

  const getGroupOptions = (groupId?: number) => (productOptions ?? [])
    .filter(option => option.groupId === groupId && option.isDeleted === 0)
    .sort((a, b) => a.sortOrder - b.sortOrder);

  const getDefaultOptionSelection = (product: Product) => {
    const selection: Record<number, number[]> = {};
    getProductGroups(product.id).forEach(group => {
      const options = getGroupOptions(group.id);
      const defaults = options.filter(option => option.isDefault === 1).map(option => option.id!).filter(Boolean);
      if (defaults.length > 0) {
        selection[group.id!] = defaults.slice(0, group.maxSelect);
      } else if (group.required === 1 && options[0]?.id) {
        selection[group.id!] = [options[0].id];
      } else {
        selection[group.id!] = [];
      }
    });
    return selection;
  };

  const getSelectionOptionIds = (selection: Record<number, number[]>) =>
    Object.values(selection).flat().filter(Boolean);

  const buildOptionSnapshots = (selection: Record<number, number[]>): CartOptionSnapshot[] => {
    const snapshots: CartOptionSnapshot[] = [];
    getSelectionOptionIds(selection).forEach(optionId => {
      const option = productOptions?.find(o => o.id === optionId);
      const group = option ? productOptionGroups?.find(g => g.id === option.groupId) : undefined;
      if (!option || !group) return;
      snapshots.push({
        groupId: group.id!,
        groupName: group.name,
        optionId: option.id!,
        optionName: option.name,
        priceDelta: option.priceDelta || 0,
        hppDelta: option.hppDelta || 0,
      });
    });
    return snapshots;
  };

  const getConfiguredProduct = (product: Product, selectedOptions: CartOptionSnapshot[]) => {
    const optionLabel = selectedOptions.map(option => option.optionName).join(' / ');
    const priceDelta = selectedOptions.reduce((sum, option) => sum + option.priceDelta, 0);
    const hppDelta = selectedOptions.reduce((sum, option) => sum + option.hppDelta, 0);
    return {
      ...product,
      name: optionLabel ? `${product.name} - ${optionLabel}` : product.name,
      price: product.price + priceDelta,
      hpp: product.hpp + hppDelta,
    };
  };

  const validateSelection = (product: Product, selection: Record<number, number[]>) => {
    for (const group of getProductGroups(product.id)) {
      const selected = selection[group.id!] ?? [];
      if (group.required === 1 && selected.length < group.minSelect) {
        toast.error(`Pilih ${group.name}`);
        return false;
      }
      if (selected.length > group.maxSelect) {
        toast.error(`${group.name} maksimal ${group.maxSelect} pilihan`);
        return false;
      }
    }
    return true;
  };

  const loadTransactionForEditing = async (txId: number) => {
    try {
      const tx = await db.transactions.get(txId);
      if (!tx) {
        toast.error('Transaksi tidak ditemukan');
        doFullReset();
        return;
      }
      const items = await db.transactionItems.where('transactionId').equals(txId).toArray();
      const allProducts = await db.products.toArray(); // load all products

      const cartItems: CartItem[] = [];
      const qtyMap: Record<string, number> = {};

      for (const item of items) {
        let product = allProducts.find(p => p.id === item.productId);
        if (!product && item.productId < 0) {
          const whId = Math.abs(item.productId);
          const whItem = await db.warehouseItems.get(whId);
          if (whItem) {
            product = {
              id: item.productId,
              name: whItem.name,
              sku: `WH-${whItem.id}`,
              categoryId: -99,
              price: item.price,
              hpp: item.hpp,
              stock: whItem.stock,
              unit: whItem.unit,
              createdAt: whItem.createdAt,
              updatedAt: whItem.updatedAt,
              isDeleted: whItem.isDeleted,
              deletedAt: null
            };
          }
        }
        if (!product) {
          product = {
            id: item.productId,
            name: item.productName,
            sku: '',
            categoryId: 0,
            price: item.price,
            hpp: item.hpp,
            stock: 0,
            unit: 'pcs',
            createdAt: new Date(),
            updatedAt: new Date(),
            isDeleted: 1,
            deletedAt: new Date()
          };
        }
        const selectedOptions = item.selectedOptions ?? [];
        const selectedOptionIds = selectedOptions.map(option => option.optionId);
        const stockKey = item.stockKey || buildStockKey(item.productId, selectedOptionIds);
        const configuredProduct = {
          ...product,
          name: item.productName,
          price: item.price,
          hpp: item.hpp,
        };
        cartItems.push({
          product: configuredProduct,
          stockKey,
          baseName: item.productBaseName || product.name,
          selectedOptions,
          qty: item.quantity,
          discountType: item.discountType as 'percentage' | 'nominal' | null,
          discountValue: item.discountValue,
          notes: item.notes,
        });
        qtyMap[stockKey] = item.quantity;
      }

      setCart(cartItems);
      setEditingTxId(txId);
      setOriginalTx(tx);
      setOriginalItems(items);
      setOriginalQuantities(qtyMap);
      setTxDiscountType(tx.discountType);
      setTxDiscountValue(tx.discountType ? String(tx.discountValue) : '');
      setCustomerName(tx.customerName || '');
      setTableNumber(tx.tableNumber || '');
      setRemarks(tx.remarks || '');
      setServiceType(tx.serviceType || 'dine_in');
      setOpenBillsOpen(false);
      setCartOpen(true);
    } catch (err) {
      console.error(err);
      toast.error('Gagal memuat transaksi');
    }
  };

  useEffect(() => {
    if (editTxIdParam) {
      const txId = Number(editTxIdParam);
      if (!isNaN(txId) && txId !== editingTxId) {
        loadTransactionForEditing(txId);
      }
    } else {
      if (editingTxId !== null) {
        doFullReset();
      }
    }
  }, [editTxIdParam]);

  const todayStr = new Date().toLocaleDateString('en-CA');
  const activeDailyPrepFormulas = (dailyPrepFormulas ?? []).filter(formula =>
    visibleWarehouseItems?.some(item => item.id === formula.prepItemId) &&
    visibleWarehouseItems?.some(item => item.id === formula.targetItemId)
  );
  const prepTargetItemIds = new Set(activeDailyPrepFormulas.map(formula => formula.targetItemId));
  const mainPrepItems = (chickenItems ?? []).filter(item => !prepTargetItemIds.has(item.id!));
  const needsPrep = mainPrepItems.length > 0 && mainPrepItems.some(item => item.lastPreparedDate !== todayStr);

  useEffect(() => {
    if (needsPrep) {
      setPrepModalOpen(true);
    } else {
      setPrepModalOpen(false);
    }
  }, [needsPrep]);

  useEffect(() => {
    if (!prepModalOpen || mainPrepItems.length === 0) return;

    setPrepCounts(prev => {
      const next: Record<number, string> = {};
      for (const item of mainPrepItems) {
        const currentPrep = item.lastPreparedDate === todayStr ? (item.dailyPrepQty || 0) : 0;
        next[item.id!] = prev[item.id!] ?? (currentPrep > 0 ? String(currentPrep) : '');
      }
      return next;
    });
  }, [prepModalOpen, mainPrepItems, todayStr]);

  const applyDailyPrepDelta = async (prepItemId: number, delta: number) => {
    const prepItem = await db.warehouseItems.get(prepItemId);
    if (!prepItem) return;

    const isNewDay = prepItem.lastPreparedDate !== todayStr;
    const currentPrep = isNewDay ? 0 : (prepItem.dailyPrepQty || 0);
    const newPrep = currentPrep + delta;

    if (newPrep < 0) {
      throw new Error(`Jumlah persiapan ${prepItem.name} tidak bisa kurang dari 0`);
    }

    const itemFormulas = activeDailyPrepFormulas.filter(formula => formula.prepItemId === prepItemId);
    if (itemFormulas.length > 0) {
      const newPrepItemStock = Math.max(0, prepItem.stock - delta);
      await db.warehouseItems.update(prepItemId, {
        stock: newPrepItemStock,
        dailyPrepQty: newPrep,
        lastPreparedDate: todayStr,
        updatedAt: new Date()
      });

      for (const formula of itemFormulas) {
        const targetItem = await db.warehouseItems.get(formula.targetItemId);
        if (!targetItem) continue;

        const isTargetNewDay = targetItem.lastPreparedDate !== todayStr;
        let newTargetStock = targetItem.stock + (delta * formula.factor);
        let newTargetPrepQty = (targetItem.dailyPrepQty || 0) + (delta * formula.factor);

        if (isTargetNewDay) {
          newTargetStock = newPrep * formula.factor;
          newTargetPrepQty = newPrep * formula.factor;
        } else {
          newTargetStock = Math.max(0, newTargetStock);
          newTargetPrepQty = Math.max(0, newTargetPrepQty);
        }

        await db.warehouseItems.update(targetItem.id!, {
          stock: newTargetStock,
          dailyPrepQty: newTargetPrepQty,
          lastPreparedDate: todayStr,
          updatedAt: new Date()
        });
      }
      return;
    }

    const factor = prepItem.dailyPrepFactor || 1;
    const newStock = isNewDay
      ? Math.max(0, newPrep * factor)
      : Math.max(0, prepItem.stock + (delta * factor));

    await db.warehouseItems.update(prepItemId, {
      stock: newStock,
      dailyPrepQty: newPrep,
      lastPreparedDate: todayStr,
      updatedAt: new Date()
    });
  };

  const handleDailyPrep = async () => {
    const prepEntries = mainPrepItems.map(item => ({
      item,
      desiredQty: Math.max(0, parseInt(prepCounts[item.id!] || '0') || 0)
    }));

    if (prepEntries.every(entry => entry.desiredQty === 0)) {
      toast.error('Isi minimal satu jumlah persiapan harian');
      return;
    }

    try {
      for (const { item, desiredQty } of prepEntries) {
        const currentPrep = item.lastPreparedDate === todayStr ? (item.dailyPrepQty || 0) : 0;
        const delta = desiredQty - currentPrep;

        if (delta !== 0) {
          await applyDailyPrepDelta(item.id!, delta);
        } else if (item.lastPreparedDate !== todayStr) {
          await db.warehouseItems.update(item.id!, {
            dailyPrepQty: desiredQty,
            lastPreparedDate: todayStr,
            updatedAt: new Date()
          });
        }
      }

      toast.success('Persiapan harian berhasil diproses');
      setPrepModalOpen(false);
    } catch (err) {
      console.error(err);
      toast.error(err instanceof Error ? err.message : 'Gagal memproses persiapan harian');
    }
  };

  const cartProductIds = new Set(cart.map(c => c.stockKey));

  const cashierVisibleItems = visibleWarehouseItems?.filter(item => item.isCashierVisible === 1) ?? [];
  const virtualProducts: Product[] = cashierVisibleItems.map(item => ({
    id: -item.id!,
    name: item.name,
    sku: `WH-${item.id}`,
    categoryId: -99,
    price: item.price || 0,
    hpp: 0,
    stock: item.stock,
    unit: item.unit,
    photo: item.photo, // Maps photo from warehouse item
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
    isDeleted: 0,
    deletedAt: null
  }));

  const allAvailableProducts = [
    ...(products ?? []).map(p => {
      const recipes = productRecipes?.filter(r => r.productId === p.id) ?? [];
      if (recipes.length > 0) {
        let minStock = Infinity;
        const todayStr = new Date().toLocaleDateString('en-CA');
        for (const recipe of recipes) {
          const whItem = visibleWarehouseItems?.find(wi => wi.id === recipe.warehouseItemId);
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
        return {
          ...p,
          stock: minStock === Infinity ? 0 : minStock
        };
      }
      return p;
    }),
    ...virtualProducts
  ];

  const filtered = allAvailableProducts.filter(p => {
    const matchSearch = p.name.toLowerCase().includes(search.toLowerCase());
    const matchCategory = filterCategory === 'all' || p.categoryId === Number(filterCategory);
    const baseStockKey = buildStockKey(p.id!);
    const origQty = originalQuantities[baseStockKey] || 0;
    const allowedStock = p.stock + origQty;
    const hasConfigOptions = getProductGroups(p.id).length > 0;
    return matchSearch && matchCategory && (hasConfigOptions || allowedStock > 0 || cartProductIds.has(baseStockKey));
  });

  const doFullReset = () => {
    setCart([]);
    setEditingTxId(null);
    setOriginalTx(null);
    setOriginalItems([]);
    setOriginalQuantities({});
    setServiceType('dine_in');
    setTxDiscountType(null);
    setTxDiscountValue('');
    setPaymentMethodId('');
    setPaymentAmount('');
    setCustomerName('');
    setTableNumber('');
    setRemarks('');
    setIsQuickAdding(false);
    if (searchParams.has('editTxId')) {
      setSearchParams({}, { replace: true });
    }
  };

  // === Cart Operations ===

  const addConfiguredToCart = async (product: Product, selectedOptions: CartOptionSnapshot[] = []) => {
    const selectedOptionIds = selectedOptions.map(option => option.optionId);
    const stockKey = buildStockKey(product.id!, selectedOptionIds);
    const availableStock = product.id! < 0
      ? product.stock
      : await getAvailableStockForSelection(product.id!, selectedOptionIds);
    const configuredProduct = {
      ...getConfiguredProduct(product, selectedOptions),
      stock: availableStock,
    };

    setCart(prev => {
      const existing = prev.find(c => c.stockKey === stockKey);
      const origQty = originalQuantities[stockKey] || 0;
      const allowedStock = availableStock + origQty;
      if (existing) {
        if (existing.qty >= allowedStock) {
          toast.error('Stok tidak cukup');
          return prev;
        }
        return prev.map(c => c.stockKey === stockKey ? { ...c, qty: c.qty + 1 } : c);
      }
      if (allowedStock <= 0) {
        toast.error('Stok tidak cukup');
        return prev;
      }
      return [...prev, {
        product: configuredProduct,
        stockKey,
        baseName: product.name,
        selectedOptions,
        qty: 1,
        discountType: null,
        discountValue: 0
      }];
    });
  };

  const addToCart = (product: Product) => {
    const groups = getProductGroups(product.id);
    if (groups.length > 0) {
      const selection = getDefaultOptionSelection(product);
      setOptionProduct(product);
      setSelectedOptionIds(selection);
      return;
    }
    void addConfiguredToCart(product);
  };

  const confirmOptionProduct = () => {
    if (!optionProduct) return;
    if (!validateSelection(optionProduct, selectedOptionIds)) return;
    const snapshots = buildOptionSnapshots(selectedOptionIds);
    void addConfiguredToCart(optionProduct, snapshots);
    setOptionProduct(null);
    setSelectedOptionIds({});
  };

  const toggleOptionSelection = (groupId: number, optionId: number, maxSelect: number) => {
    setSelectedOptionIds(prev => {
      const current = prev[groupId] ?? [];
      const exists = current.includes(optionId);
      if (maxSelect <= 1) {
        return { ...prev, [groupId]: exists ? [] : [optionId] };
      }
      if (exists) {
        return { ...prev, [groupId]: current.filter(id => id !== optionId) };
      }
      if (current.length >= maxSelect) {
        toast.error(`Maksimal ${maxSelect} pilihan`);
        return prev;
      }
      return { ...prev, [groupId]: [...current, optionId] };
    });
  };

  const updateQty = (stockKey: string, delta: number) => {
    setCart(prev => prev.map(c => {
      if (c.stockKey !== stockKey) return c;
      const newQty = c.qty + delta;
      if (newQty <= 0) return c;
      const origQty = originalQuantities[stockKey] || 0;
      const allowedStock = c.product.stock + origQty;
      if (newQty > allowedStock) { toast.error('Stok tidak cukup'); return c; }
      return { ...c, qty: newQty };
    }));
  };

  const removeFromCart = (stockKey: string) => {
    setCart(prev => prev.filter(c => c.stockKey !== stockKey));
  };

  const applyStockDelta = async (productId: number, qtyDelta: number, selectedOptions: CartOptionSnapshot[] = []) => {
    await adjustConfiguredStock(productId, qtyDelta, selectedOptions.map(option => option.optionId));
  };

  const updateItemNotes = (stockKey: string, notes: string) => {
    setCart(prev => prev.map(c => c.stockKey === stockKey ? { ...c, notes: notes.trim() || undefined } : c));
  };

  const openItemDiscount = (item: CartItem) => {
    setItemDiscountTargetId(cart.findIndex(c => c.stockKey === item.stockKey));
    if (item.discountType) {
      setItemDiscountType(item.discountType);
      setItemDiscountValue(String(item.discountValue));
    } else {
      setItemDiscountType('nominal');
      setItemDiscountValue('');
    }
  };

  const saveItemDiscount = () => {
    if (itemDiscountTargetId == null) return;
    const raw = Number(itemDiscountValue) || 0;
    setCart(prev => prev.map(c => {
      if (prev.findIndex(item => item.stockKey === c.stockKey) !== itemDiscountTargetId) return c;
      if (raw <= 0) {
        return { ...c, discountType: null, discountValue: 0 };
      }
      const base = c.product.price * c.qty;
      const clamped = itemDiscountType === 'percentage'
        ? Math.min(100, raw)
        : Math.min(base, raw);
      return { ...c, discountType: itemDiscountType, discountValue: clamped };
    }));
    setItemDiscountTargetId(null);
  };

  const clearItemDiscount = () => {
    if (itemDiscountTargetId == null) return;
    setCart(prev => prev.map((c, index) =>
      index === itemDiscountTargetId
        ? { ...c, discountType: null, discountValue: 0 }
        : c
    ));
    setItemDiscountTargetId(null);
  };

  const getItemDiscountAmount = (item: CartItem) => {
    const base = item.product.price * item.qty;
    if (item.discountType === 'percentage') {
      const pct = Math.min(100, Math.max(0, item.discountValue));
      return base * pct / 100;
    }
    if (item.discountType === 'nominal') {
      return Math.min(base, Math.max(0, item.discountValue));
    }
    return 0;
  };

  const getItemSubtotal = (item: CartItem) => {
    const base = item.product.price * item.qty;
    return Math.max(0, base - getItemDiscountAmount(item));
  };

  const subtotal = cart.reduce((sum, item) => sum + getItemSubtotal(item), 0);
  const txDiscountAmount = txDiscountType === 'percentage'
    ? subtotal * Math.min(100, Math.max(0, Number(txDiscountValue) || 0)) / 100
    : txDiscountType === 'nominal'
      ? Math.min(subtotal, Math.max(0, Number(txDiscountValue) || 0))
      : 0;
  const total = Math.max(0, subtotal - txDiscountAmount);
  const paidAmount = Number(paymentAmount) || 0;
  const change = paidAmount - total;
  const totalItemDiscount = cart.reduce((sum, item) => sum + getItemDiscountAmount(item), 0);
  const totalProfit = cart.reduce((sum, item) => sum + (item.product.price - item.product.hpp) * item.qty, 0) - totalItemDiscount - txDiscountAmount;

  // === Checkout ===

  const handleCheckout = async () => {
    if (!paymentMethodId || paidAmount < total) return;

    if (editingTxId) {
      // Update existing open bill → paid
      const oldItems = await db.transactionItems.where('transactionId').equals(editingTxId).toArray();

      await db.transactions.update(editingTxId, {
        status: 'completed',
        subtotal,
        discountType: txDiscountType,
        discountValue: Number(txDiscountValue) || 0,
        discountAmount: txDiscountAmount,
        total,
        paymentMethodId: Number(paymentMethodId),
        paymentAmount: paidAmount,
        change,
        profit: totalProfit,
        customerName: customerName.trim() || undefined,
        tableNumber: serviceType === 'take_away' ? undefined : (tableNumber.trim() || undefined),
        remarks: remarks.trim() || undefined,
        closedAt: new Date(),
        serviceType,
      });

      await db.transactionItems.where('transactionId').equals(editingTxId).delete();
      const itemRecords: TransactionItemRecord[] = cart.map(c => ({
        transactionId: editingTxId,
        productId: c.product.id!,
        productName: c.product.name,
        productBaseName: c.baseName,
        selectedOptions: c.selectedOptions,
        stockKey: c.stockKey,
        quantity: c.qty,
        price: c.product.price,
        hpp: c.product.hpp,
        discountType: c.discountType,
        discountValue: c.discountValue,
        discountAmount: getItemDiscountAmount(c),
        subtotal: getItemSubtotal(c),
        notes: c.notes,
      }));
      await db.transactionItems.bulkAdd(itemRecords);

      // Adjust stock deltas safely by fetching fresh database stock
      for (const cartItem of cart) {
        const oldItem = oldItems.find(oi => (oi.stockKey || buildStockKey(oi.productId, oi.selectedOptions?.map(option => option.optionId) ?? [])) === cartItem.stockKey);
        const oldQty = oldItem?.quantity ?? 0;
        const newQty = cartItem.qty;
        const delta = newQty - oldQty;
        if (delta !== 0) {
          await applyStockDelta(cartItem.product.id!, delta, cartItem.selectedOptions);
        }
      }
      for (const oldItem of oldItems) {
        const oldStockKey = oldItem.stockKey || buildStockKey(oldItem.productId, oldItem.selectedOptions?.map(option => option.optionId) ?? []);
        const stillInCart = cart.find(c => c.stockKey === oldStockKey);
        if (!stillInCart) {
          await applyStockDelta(oldItem.productId, -oldItem.quantity, oldItem.selectedOptions ?? []);
        }
      }

      const updatedTx = await db.transactions.get(editingTxId);
      toast.success(`Transaksi berhasil! ${updatedTx?.receiptNumber}`);
      setLastTransaction(updatedTx || null);
      setLastTxItems(itemRecords);
      setReceiptOpen(true);
    } else {
      const receiptNumber = `TX${Date.now()}`;

      const txData: Transaction = {
        subtotal,
        discountType: txDiscountType,
        discountValue: Number(txDiscountValue) || 0,
        discountAmount: txDiscountAmount,
        total,
        paymentMethodId: Number(paymentMethodId),
        paymentAmount: paidAmount,
        change,
        profit: totalProfit,
        date: new Date(),
        receiptNumber,
        status: 'completed',
        customerName: customerName.trim() || undefined,
        tableNumber: serviceType === 'take_away' ? undefined : (tableNumber.trim() || undefined),
        remarks: remarks.trim() || undefined,
        createdBy: currentUser?.id,
        serviceType,
      };

      const txId = await db.transactions.add(txData);

      const itemRecords: TransactionItemRecord[] = cart.map(c => ({
        transactionId: txId as number,
        productId: c.product.id!,
        productName: c.product.name,
        productBaseName: c.baseName,
        selectedOptions: c.selectedOptions,
        stockKey: c.stockKey,
        quantity: c.qty,
        price: c.product.price,
        hpp: c.product.hpp,
        discountType: c.discountType,
        discountValue: c.discountValue,
        discountAmount: getItemDiscountAmount(c),
        subtotal: getItemSubtotal(c),
        notes: c.notes,
      }));
      await db.transactionItems.bulkAdd(itemRecords);

      for (const item of cart) {
        await applyStockDelta(item.product.id!, item.qty, item.selectedOptions);
      }

      toast.success(`Transaksi berhasil! ${receiptNumber}`);
      setLastTransaction({ ...txData, id: txId as number });
      setLastTxItems(itemRecords);
      setReceiptOpen(true);
    }

    doFullReset();
    setCheckoutOpen(false);
    setCartOpen(false);
  };

  const cartCount = cart.reduce((s, c) => s + c.qty, 0);
  const rp = (n: number) => `Rp ${n.toLocaleString('id-ID')}`;

  // After all hooks: if user can't create transactions, render the locked
  // placeholder instead of the kasir UI. Bottom nav stays visible.
  if (!allowed) {
    return <LockedPage title="Kasir" permissionLabel="Buat Transaksi" />;
  }

  return (
    <div className="px-4 pt-6 pb-4 h-[calc(100vh-4rem)]">
      <div className="flex flex-col md:flex-row gap-0 md:gap-4 h-full">
        <div className="flex-1 min-w-0 flex flex-col overflow-hidden">
          {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-xl font-bold flex items-center gap-2">
          <ShoppingCart className="w-5 h-5 text-primary" />
          Kasir
          {editingTxId && (
            <Badge variant="secondary" className="text-[10px] font-normal">
              Editing Transaksi
            </Badge>
          )}
        </h1>
      </div>

      {/* Edit Notice Banner */}
      {editingTxId && (
        <div className="flex items-center justify-between gap-3 px-4 py-2.5 mb-3 bg-primary/10 border border-primary/20 rounded-xl text-xs text-primary font-medium animate-in fade-in slide-in-from-top-2 duration-200">
          <div className="flex items-center gap-2">
            <Pencil className="w-3.5 h-3.5 shrink-0" />
            <span>
              Mengedit Transaksi <strong>#{originalTx?.receiptNumber}</strong>
            </span>
          </div>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 px-2.5 text-xs text-primary hover:bg-primary/20"
            onClick={doFullReset}
          >
            Batal Edit
          </Button>
        </div>
      )}

      {/* Search */}
      <div className="flex gap-2 mb-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input placeholder="Cari produk..." value={search} onChange={e => setSearch(e.target.value)} className="pl-9 h-10" />
        </div>
      </div>

      {/* Category chips */}
      <div className="flex gap-2 overflow-x-auto scrollbar-hide mb-3 pb-1 pr-4" style={{ WebkitOverflowScrolling: 'touch', touchAction: 'pan-x' }}>
        <button onClick={() => setFilterCategory('all')} className={cn('shrink-0 px-3 py-1.5 rounded-full text-xs font-semibold transition-colors', filterCategory === 'all' ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground')}>
          Semua
        </button>
        {categories?.map(c => (
          <button key={c.id} onClick={() => setFilterCategory(c.id!.toString())} className={cn('shrink-0 px-3 py-1.5 rounded-full text-xs font-semibold transition-colors', filterCategory === c.id!.toString() ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground')}>
            {c.icon} {c.name}
          </button>
        ))}
        {cashierVisibleItems.length > 0 && (
          <button onClick={() => setFilterCategory('-99')} className={cn('shrink-0 px-3 py-1.5 rounded-full text-xs font-semibold transition-colors', filterCategory === '-99' ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground')}>
            📦 Kemasan & Ekstra
          </button>
        )}
      </div>

      {/* Product Grid */}
      <div className="flex-1 overflow-y-auto scrollbar-hide">
        {filtered.length === 0 ? (
          <div className="text-center py-12">
            <p className="text-sm text-muted-foreground">
              {products && products.length > 0
                ? 'Semua produk stoknya habis. Tambah stok dulu di menu Stok Masuk.'
                : 'Belum ada produk. Tambah produk dulu di menu Produk.'}
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2">
            {filtered.map(p => (
              <Card key={p.id} className="border-0 shadow-sm cursor-pointer hover:shadow-md transition-shadow active:scale-[0.98]" onClick={() => addToCart(p)}>
                <CardContent className="p-0">
                  <div className="w-full aspect-square bg-muted rounded-t-lg overflow-hidden flex items-center justify-center">
                    {p.photo ? (
                      <img src={p.photo} alt={p.name} className="w-full h-full object-cover" />
                    ) : (
                      <PackageIcon className="w-8 h-8 text-muted-foreground/30" />
                    )}
                  </div>
                  <div className="p-2.5">
                    <h3 className="text-xs font-semibold truncate">{p.name}</h3>
                    <p className="text-sm font-bold text-primary mt-0.5">Rp {p.price.toLocaleString('id-ID')}</p>
                    {p.description && (
                      <p className="text-[10px] text-muted-foreground mt-0.5 truncate" title={p.description}>
                        {p.description}
                      </p>
                    )}
                    <p className="text-[10px] text-muted-foreground mt-0.5">Stok: {p.stock} {p.unit}</p>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
        </div>
      </div>

      {/* Desktop Cart Panel */}
      <div className="hidden md:flex md:w-80 lg:w-96 flex-col overflow-hidden bg-card rounded-xl border border-border shrink-0">
        <div className="p-4 border-b border-border shrink-0">
          <h3 className="text-base font-bold flex items-center gap-2">
            <ShoppingCart className="w-4 h-4 text-primary" />
            Keranjang ({cartCount} item)
            {editingTxId && <span className="text-xs font-normal text-muted-foreground">— edit</span>}
          </h3>
        </div>
        {cart.length === 0 ? (
          <div className="flex-1 flex items-center justify-center p-8">
            <p className="text-sm text-muted-foreground">Keranjang kosong</p>
          </div>
        ) : (
          <div className="flex flex-col flex-1 overflow-hidden">
            <div className="flex-1 overflow-y-auto space-y-3 p-4">
              {cart.map(item => (
                <div key={item.stockKey} className="bg-muted/50 p-3 rounded-xl space-y-1.5">
                  <div className="flex items-center gap-3">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold truncate">{item.product.name}</p>
                      <p className="text-xs text-muted-foreground">Rp {item.product.price.toLocaleString('id-ID')} × {item.qty}</p>
                      {item.discountType && getItemDiscountAmount(item) > 0 && (
                        <p className="text-[10px] text-destructive">
                          Diskon: {item.discountType === 'percentage' ? `${item.discountValue}%` : rp(item.discountValue)} (-{rp(getItemDiscountAmount(item))})
                        </p>
                      )}
                      <p className="text-sm font-bold text-primary">{rp(getItemSubtotal(item))}</p>
                    </div>
                    <div className="flex items-center gap-1">
                      <Button variant="outline" size="icon" className="h-8 w-8 rounded-full" onClick={() => item.qty === 1 ? removeFromCart(item.stockKey) : updateQty(item.stockKey, -1)}>
                        {item.qty === 1 ? <X className="w-3 h-3" /> : <Minus className="w-3 h-3" />}
                      </Button>
                      <span className="w-8 text-center text-sm font-bold">{item.qty}</span>
                      <Button variant="outline" size="icon" className="h-8 w-8 rounded-full" onClick={() => updateQty(item.stockKey, 1)}>
                        <Plus className="w-3 h-3" />
                      </Button>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 flex-wrap">
                    {item.notes ? (
                      <button
                        className="flex items-center gap-1 text-[10px] text-accent bg-accent/10 px-2 py-0.5 rounded-full"
                        onClick={() => { setEditingItemNotes(item.stockKey); setTempItemNotes(item.notes || ''); }}
                      >
                        <Pencil className="w-2.5 h-2.5" />
                        {item.notes}
                      </button>
                    ) : (
                      <button
                        className="flex items-center gap-1 text-[10px] text-muted-foreground hover:text-primary transition-colors"
                        onClick={() => { setEditingItemNotes(item.stockKey); setTempItemNotes(''); }}
                      >
                        <Pencil className="w-2.5 h-2.5" />
                        Tambah catatan
                      </button>
                    )}
                    {item.discountType ? (
                      <button
                        className="flex items-center gap-1 text-[10px] text-destructive bg-destructive/10 px-2 py-0.5 rounded-full"
                        onClick={() => openItemDiscount(item)}
                      >
                        <Tag className="w-2.5 h-2.5" />
                        Ubah diskon
                      </button>
                    ) : (
                      <button
                        className="flex items-center gap-1 text-[10px] text-muted-foreground hover:text-primary transition-colors"
                        onClick={() => openItemDiscount(item)}
                      >
                        <Tag className="w-2.5 h-2.5" />
                        Tambah diskon
                      </button>
                    )}
                  </div>
                  {editingItemNotes === item.stockKey && (
                    <div className="flex gap-2 items-center">
                      <Input
                        autoFocus
                        value={tempItemNotes}
                        onChange={e => setTempItemNotes(e.target.value)}
                        placeholder="Contoh: less sugar..."
                        className="h-8 text-xs"
                        onKeyDown={e => {
                          if (e.key === 'Enter') { updateItemNotes(item.stockKey, tempItemNotes); setEditingItemNotes(null); }
                          if (e.key === 'Escape') setEditingItemNotes(null);
                        }}
                      />
                      <Button size="sm" className="h-8 text-xs" onClick={() => { updateItemNotes(item.stockKey, tempItemNotes); setEditingItemNotes(null); }}>OK</Button>
                    </div>
                  )}
                </div>
              ))}
            </div>

            <div className="px-4 mb-2.5 space-y-2">
              {/* Service Type Toggle */}
              <div className="grid grid-cols-2 gap-1 p-1 bg-muted rounded-xl">
                <button
                  type="button"
                  onClick={() => setServiceType('dine_in')}
                  className={cn(
                    "flex items-center justify-center gap-1.5 py-1.5 rounded-lg text-xs font-semibold transition-all",
                    serviceType === 'dine_in'
                      ? "bg-background text-foreground shadow-sm"
                      : "text-muted-foreground hover:text-foreground"
                  )}
                >
                  <Utensils className="w-3.5 h-3.5" />
                  Dine In
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setServiceType('take_away');
                    setTableNumber('');
                  }}
                  className={cn(
                    "flex items-center justify-center gap-1.5 py-1.5 rounded-lg text-xs font-semibold transition-all",
                    serviceType === 'take_away'
                      ? "bg-background text-foreground shadow-sm"
                      : "text-muted-foreground hover:text-foreground"
                  )}
                >
                  <ShoppingBag className="w-3.5 h-3.5" />
                  Take Away
                </button>
              </div>

              <div className="flex gap-2">
                <div className="relative flex-1">
                  <User className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
                  <Input
                    placeholder="Nama pelanggan"
                    value={customerName}
                    onChange={e => setCustomerName(e.target.value)}
                    className="pl-8 h-9 text-xs"
                  />
                </div>
                {serviceType === 'dine_in' && (
                  <div className="relative flex-[0.6] animate-in fade-in zoom-in-95 duration-150">
                    <Hash className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
                    <Input
                      placeholder="Meja"
                      value={tableNumber}
                      onChange={e => setTableNumber(e.target.value)}
                      className="pl-8 h-9 text-xs"
                    />
                  </div>
                )}
              </div>
            </div>

            <div className="border-t pt-4 space-y-3 px-4 pb-4">
              {txDiscountAmount > 0 ? (
                <button
                  onClick={() => { setTempDiscountType(txDiscountType!); setTempDiscountValue(txDiscountValue); setDiscountDialogOpen(true); }}
                  className="flex items-center gap-1.5 text-xs text-destructive font-medium"
                >
                  <Tag className="w-3.5 h-3.5" />
                  Diskon: {txDiscountType === 'percentage' ? `${txDiscountValue}%` : `Rp ${Number(txDiscountValue).toLocaleString('id-ID')}`}
                  <span className="text-[10px] underline ml-1">Ubah</span>
                </button>
              ) : (
                <button
                  onClick={() => { setTempDiscountType('nominal'); setTempDiscountValue(''); setDiscountDialogOpen(true); }}
                  className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-primary transition-colors"
                >
                  <Tag className="w-3.5 h-3.5" />
                  <span>Tambah Diskon</span>
                </button>
              )}

              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Subtotal</span>
                <span className="font-medium">{rp(subtotal)}</span>
              </div>
              {txDiscountAmount > 0 && (
                <div className="flex justify-between text-sm text-destructive">
                  <span>Diskon</span>
                  <span>-{rp(txDiscountAmount)}</span>
                </div>
              )}
              <div className="flex justify-between text-lg font-bold">
                <span>Total</span>
                <span className="text-primary">{rp(total)}</span>
              </div>

              <div className="flex gap-2">
                <Button
                  className="w-full h-12 text-sm font-semibold"
                  onClick={() => { setCheckoutOpen(true); setPaymentMethodId(paymentMethods?.[0]?.id?.toString() ?? ''); setPaymentAmount(total.toString()); setIsQuickAdding(false); }}
                >
                  <CreditCard className="w-4 h-4 mr-2" />
                  Bayar
                </Button>
              </div>
            </div>
          </div>
        )}
      </div>
      </div>{/* end flex row */}

      {/* Cart FAB (mobile only) */}
      {cartCount > 0 && (
        <button
          onClick={() => setCartOpen(true)}
          className="md:hidden fixed bottom-24 right-4 flex items-center gap-2 bg-primary text-primary-foreground px-5 py-3 rounded-full shadow-xl active:scale-95 transition-transform z-40"
        >
          <ShoppingCart className="w-5 h-5" />
          <span className="font-bold text-sm">{cartCount} item</span>
          <span className="text-sm font-bold">• Rp {total.toLocaleString('id-ID')}</span>
        </button>
      )}

      {/* Cart Sheet (mobile only) */}
      <div className="md:hidden">
      <Sheet open={cartOpen} onOpenChange={(open) => { setCartOpen(open); if (!open) setEditingItemNotes(null); }}>
        <SheetContent side="bottom" className="h-[85vh] rounded-t-2xl max-w-lg mx-auto">
          <SheetHeader>
            <SheetTitle className="text-left">Keranjang ({cartCount} item)</SheetTitle>
          </SheetHeader>
          <div className="flex flex-col h-full mt-4">
            <div className="flex-1 overflow-y-auto space-y-3 pb-4">
              {cart.map(item => (
                <div key={item.stockKey} className="bg-muted/50 p-3 rounded-xl space-y-1.5">
                  <div className="flex items-center gap-3">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold truncate">{item.product.name}</p>
                      <p className="text-xs text-muted-foreground">Rp {item.product.price.toLocaleString('id-ID')} × {item.qty}</p>
                      {item.discountType && getItemDiscountAmount(item) > 0 && (
                        <p className="text-[10px] text-destructive">
                          Diskon: {item.discountType === 'percentage' ? `${item.discountValue}%` : rp(item.discountValue)} (-{rp(getItemDiscountAmount(item))})
                        </p>
                      )}
                      <p className="text-sm font-bold text-primary">{rp(getItemSubtotal(item))}</p>
                    </div>
                    <div className="flex items-center gap-1">
                      <Button variant="outline" size="icon" className="h-8 w-8 rounded-full" onClick={() => item.qty === 1 ? removeFromCart(item.stockKey) : updateQty(item.stockKey, -1)}>
                        {item.qty === 1 ? <X className="w-3 h-3" /> : <Minus className="w-3 h-3" />}
                      </Button>
                      <span className="w-8 text-center text-sm font-bold">{item.qty}</span>
                      <Button variant="outline" size="icon" className="h-8 w-8 rounded-full" onClick={() => updateQty(item.stockKey, 1)}>
                        <Plus className="w-3 h-3" />
                      </Button>
                    </div>
                  </div>
                  {/* Item notes & discount row */}
                  <div className="flex items-center gap-2 flex-wrap">
                    {item.notes ? (
                      <button
                        className="flex items-center gap-1 text-[10px] text-accent bg-accent/10 px-2 py-0.5 rounded-full"
                        onClick={() => { setEditingItemNotes(item.stockKey); setTempItemNotes(item.notes || ''); }}
                      >
                        <Pencil className="w-2.5 h-2.5" />
                        {item.notes}
                      </button>
                    ) : (
                      <button
                        className="flex items-center gap-1 text-[10px] text-muted-foreground hover:text-primary transition-colors"
                        onClick={() => { setEditingItemNotes(item.stockKey); setTempItemNotes(''); }}
                      >
                        <Pencil className="w-2.5 h-2.5" />
                        Tambah catatan
                      </button>
                    )}
                    {item.discountType ? (
                      <button
                        className="flex items-center gap-1 text-[10px] text-destructive bg-destructive/10 px-2 py-0.5 rounded-full"
                        onClick={() => openItemDiscount(item)}
                      >
                        <Tag className="w-2.5 h-2.5" />
                        Ubah diskon
                      </button>
                    ) : (
                      <button
                        className="flex items-center gap-1 text-[10px] text-muted-foreground hover:text-primary transition-colors"
                        onClick={() => openItemDiscount(item)}
                      >
                        <Tag className="w-2.5 h-2.5" />
                        Tambah diskon
                      </button>
                    )}
                  </div>
                  {/* Inline notes editor */}
                  {editingItemNotes === item.stockKey && (
                    <div className="flex gap-2 items-center">
                      <Input
                        autoFocus
                        value={tempItemNotes}
                        onChange={e => setTempItemNotes(e.target.value)}
                        placeholder="Contoh: less sugar..."
                        className="h-8 text-xs"
                        onKeyDown={e => {
                          if (e.key === 'Enter') { updateItemNotes(item.stockKey, tempItemNotes); setEditingItemNotes(null); }
                          if (e.key === 'Escape') setEditingItemNotes(null);
                        }}
                      />
                      <Button size="sm" className="h-8 text-xs" onClick={() => { updateItemNotes(item.stockKey, tempItemNotes); setEditingItemNotes(null); }}>OK</Button>
                    </div>
                  )}
                </div>
              ))}
            </div>

            {/* Customer / Table quick inputs */}
            <div className="space-y-2 mb-2">
              {/* Service Type Toggle */}
              <div className="grid grid-cols-2 gap-1 p-1 bg-muted rounded-xl">
                <button
                  type="button"
                  onClick={() => setServiceType('dine_in')}
                  className={cn(
                    "flex items-center justify-center gap-1.5 py-1.5 rounded-lg text-xs font-semibold transition-all",
                    serviceType === 'dine_in'
                      ? "bg-background text-foreground shadow-sm"
                      : "text-muted-foreground hover:text-foreground"
                  )}
                >
                  <Utensils className="w-3.5 h-3.5" />
                  Dine In
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setServiceType('take_away');
                    setTableNumber('');
                  }}
                  className={cn(
                    "flex items-center justify-center gap-1.5 py-1.5 rounded-lg text-xs font-semibold transition-all",
                    serviceType === 'take_away'
                      ? "bg-background text-foreground shadow-sm"
                      : "text-muted-foreground hover:text-foreground"
                  )}
                >
                  <ShoppingBag className="w-3.5 h-3.5" />
                  Take Away
                </button>
              </div>

              <div className="flex gap-2">
                <div className="relative flex-1">
                  <User className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
                  <Input
                    placeholder="Nama pelanggan"
                    value={customerName}
                    onChange={e => setCustomerName(e.target.value)}
                    className="pl-8 h-9 text-xs"
                  />
                </div>
                {serviceType === 'dine_in' && (
                  <div className="relative flex-[0.6] animate-in fade-in zoom-in-95 duration-150">
                    <Hash className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
                    <Input
                      placeholder="Meja"
                      value={tableNumber}
                      onChange={e => setTableNumber(e.target.value)}
                      className="pl-8 h-9 text-xs"
                    />
                  </div>
                )}
              </div>
            </div>

            {/* Summary */}
            <div className="border-t pt-4 space-y-3 pb-6">
              {txDiscountAmount > 0 ? (
                <button
                  onClick={() => { setTempDiscountType(txDiscountType!); setTempDiscountValue(txDiscountValue); setDiscountDialogOpen(true); }}
                  className="flex items-center gap-1.5 text-xs text-destructive font-medium"
                >
                  <Tag className="w-3.5 h-3.5" />
                  Diskon: {txDiscountType === 'percentage' ? `${txDiscountValue}%` : `Rp ${Number(txDiscountValue).toLocaleString('id-ID')}`}
                  <span className="text-[10px] underline ml-1">Ubah</span>
                </button>
              ) : (
                <button
                  onClick={() => { setTempDiscountType('nominal'); setTempDiscountValue(''); setDiscountDialogOpen(true); }}
                  className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-primary transition-colors"
                >
                  <Tag className="w-3.5 h-3.5" />
                  <span>Tambah Diskon</span>
                </button>
              )}

              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Subtotal</span>
                <span className="font-medium">{rp(subtotal)}</span>
              </div>
              {txDiscountAmount > 0 && (
                <div className="flex justify-between text-sm text-destructive">
                  <span>Diskon</span>
                  <span>-{rp(txDiscountAmount)}</span>
                </div>
              )}
              <div className="flex justify-between text-lg font-bold">
                <span>Total</span>
                <span className="text-primary">{rp(total)}</span>
              </div>

              {/* Action buttons */}
              <div className="flex gap-2">
                <Button
                  className="w-full h-12 text-sm font-semibold"
                  onClick={() => { setCheckoutOpen(true); setPaymentMethodId(paymentMethods?.[0]?.id?.toString() ?? ''); setPaymentAmount(total.toString()); setIsQuickAdding(false); }}
                >
                  <CreditCard className="w-4 h-4 mr-2" />
                  Bayar
                </Button>
              </div>
            </div>
          </div>
        </SheetContent>
      </Sheet>
      </div>{/* end mobile cart wrapper */}


      {/* Product Options Dialog */}
      <Dialog open={!!optionProduct} onOpenChange={(open) => { if (!open) { setOptionProduct(null); setSelectedOptionIds({}); } }}>
        <DialogContent className="max-w-[95vw] rounded-xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Pilih Opsi</DialogTitle>
          </DialogHeader>
          {optionProduct && (
            <div className="space-y-4 mt-2">
              <div className="p-3 bg-muted/40 rounded-xl">
                <p className="text-sm font-semibold">{optionProduct.name}</p>
                <p className="text-xs text-muted-foreground">Harga dasar {rp(optionProduct.price)}</p>
              </div>

              {getProductGroups(optionProduct.id).map(group => {
                const selected = selectedOptionIds[group.id!] ?? [];
                return (
                  <div key={group.id} className="space-y-2">
                    <div className="flex items-center justify-between">
                      <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">{group.name}</p>
                      <Badge variant="outline" className="text-[10px]">
                        {group.required ? 'Wajib' : 'Opsional'} {group.minSelect}-{group.maxSelect}
                      </Badge>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      {getGroupOptions(group.id).map(option => {
                        const active = selected.includes(option.id!);
                        return (
                          <button
                            key={option.id}
                            type="button"
                            onClick={() => toggleOptionSelection(group.id!, option.id!, group.maxSelect)}
                            className={cn(
                              'text-left p-3 rounded-xl border transition-colors min-h-[68px]',
                              active ? 'border-primary bg-primary/5 text-primary' : 'border-border bg-muted/30 text-foreground'
                            )}
                          >
                            <span className="block text-sm font-semibold leading-tight">{option.name}</span>
                            <span className="block text-xs text-muted-foreground mt-1">
                              {option.priceDelta > 0 ? `+${rp(option.priceDelta)}` : option.priceDelta < 0 ? `-${rp(Math.abs(option.priceDelta))}` : 'Tanpa tambahan'}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                );
              })}

              {(() => {
                const snapshots = buildOptionSnapshots(selectedOptionIds);
                const previewProduct = getConfiguredProduct(optionProduct, snapshots);
                return (
                  <div className="flex items-center justify-between p-3 bg-primary/5 rounded-xl">
                    <span className="text-sm font-medium">Harga</span>
                    <span className="text-lg font-bold text-primary">{rp(previewProduct.price)}</span>
                  </div>
                );
              })()}

              <Button className="w-full h-12 font-semibold" onClick={confirmOptionProduct}>
                <Plus className="w-5 h-5 mr-2" />
                Tambah ke Keranjang
              </Button>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Checkout Dialog */}
      <Dialog open={checkoutOpen} onOpenChange={setCheckoutOpen}>
        <DialogContent className="max-w-[95vw] rounded-xl">
          <DialogHeader>
            <DialogTitle>Pembayaran</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 mt-2">
            <div className="text-center py-3 bg-primary/5 rounded-xl">
              <p className="text-sm text-muted-foreground">Total Bayar</p>
              <p className="text-3xl font-bold text-primary">{rp(total)}</p>
            </div>

            <div className="space-y-1.5">
              <p className="text-sm font-medium">Metode Pembayaran</p>
              <div className="grid grid-cols-3 gap-2">
                {paymentMethods?.map(pm => (
                  <button key={pm.id} onClick={() => setPaymentMethodId(pm.id!.toString())} className={cn('p-3 rounded-xl text-xs font-semibold border-2 transition-colors', paymentMethodId === pm.id!.toString() ? 'border-primary bg-primary/5 text-primary' : 'border-muted bg-muted/50 text-muted-foreground')}>
                    {pm.name}
                  </button>
                ))}
              </div>
            </div>

            <div className="space-y-1.5">
              <p className="text-sm font-medium">Jumlah Bayar</p>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground font-bold text-lg select-none">Rp</span>
                <Input
                  type="text"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  className="pl-10 pr-3 h-12 text-lg font-bold text-center w-full"
                  value={paymentAmount ? Number(paymentAmount).toLocaleString('id-ID') : ''}
                  onChange={(e) => {
                    const cleanVal = e.target.value.replace(/\D/g, '');
                    const finalVal = cleanVal ? String(Number(cleanVal)) : '';
                    setPaymentAmount(finalVal);
                    setIsQuickAdding(!!finalVal);
                  }}
                  onFocus={(e) => e.target.select()}
                  placeholder="0"
                />
              </div>
              <div className="flex flex-wrap gap-1.5">
                {[1000, 2000, 5000, 10000, 20000, 50000, 100000].map(nom => (
                  <button
                    key={nom}
                    onClick={() => {
                      if (!isQuickAdding) {
                        setPaymentAmount(String(nom));
                        setIsQuickAdding(true);
                      } else {
                        setPaymentAmount(prev => String((Number(prev) || 0) + nom));
                      }
                    }}
                    className="flex-1 min-w-[calc(25%-6px)] h-9 rounded-lg border border-border bg-muted/50 text-xs font-semibold text-foreground hover:bg-primary/10 hover:border-primary hover:text-primary active:scale-95 transition-all"
                  >
                    {nom >= 1000 ? `${(nom / 1000)}K` : nom}
                  </button>
                ))}
                <button
                  onClick={() => { setPaymentAmount(total.toString()); setIsQuickAdding(false); }}
                  className="flex-1 min-w-[calc(25%-6px)] h-9 rounded-lg border border-primary/30 bg-primary/5 text-xs font-semibold text-primary hover:bg-primary/10 active:scale-95 transition-all"
                >
                  Uang Pas
                </button>
              </div>
              <button
                onClick={() => { setPaymentAmount('0'); setIsQuickAdding(false); }}
                className="w-full text-xs text-muted-foreground hover:text-destructive transition-colors py-1"
              >
                Reset
              </button>
            </div>

            <div className="space-y-2">
              {/* Service Type Toggle */}
              <div className="grid grid-cols-2 gap-1 p-1 bg-muted rounded-xl">
                <button
                  type="button"
                  onClick={() => setServiceType('dine_in')}
                  className={cn(
                    "flex items-center justify-center gap-1.5 py-1.5 rounded-lg text-xs font-semibold transition-all",
                    serviceType === 'dine_in'
                      ? "bg-background text-foreground shadow-sm"
                      : "text-muted-foreground hover:text-foreground"
                  )}
                >
                  <Utensils className="w-3.5 h-3.5" />
                  Dine In
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setServiceType('take_away');
                    setTableNumber('');
                  }}
                  className={cn(
                    "flex items-center justify-center gap-1.5 py-1.5 rounded-lg text-xs font-semibold transition-all",
                    serviceType === 'take_away'
                      ? "bg-background text-foreground shadow-sm"
                      : "text-muted-foreground hover:text-foreground"
                  )}
                >
                  <ShoppingBag className="w-3.5 h-3.5" />
                  Take Away
                </button>
              </div>

              <div className="flex gap-2">
                <div className="relative flex-1">
                  <User className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
                  <Input
                    placeholder="Nama pelanggan"
                    value={customerName}
                    onChange={e => setCustomerName(e.target.value)}
                    className="pl-8 h-10 text-sm"
                  />
                </div>
                {serviceType === 'dine_in' && (
                  <div className="relative flex-[0.7] animate-in fade-in zoom-in-95 duration-150">
                    <Hash className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
                    <Input
                      placeholder="Meja"
                      value={tableNumber}
                      onChange={e => setTableNumber(e.target.value)}
                      className="pl-8 h-10 text-sm"
                    />
                  </div>
                )}
              </div>
              <Input
                placeholder="Catatan tambahan (opsional)"
                value={remarks}
                onChange={e => setRemarks(e.target.value)}
                className="h-10"
              />
            </div>

            {paidAmount >= total && (
              <div className="flex justify-between items-center bg-success/10 p-3 rounded-xl">
                <span className="text-sm font-medium">Kembalian</span>
                <span className="text-lg font-bold text-success">Rp {change.toLocaleString('id-ID')}</span>
              </div>
            )}

            <Button className="w-full h-12 text-base font-semibold" onClick={handleCheckout} disabled={!paymentMethodId || paidAmount < total}>
              <Check className="w-5 h-5 mr-2" />
              Konfirmasi Transaksi
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Discount Dialog */}
      <Dialog open={discountDialogOpen} onOpenChange={setDiscountDialogOpen}>
        <DialogContent className="max-w-[95vw] rounded-xl">
          <DialogHeader>
            <DialogTitle>Diskon Transaksi</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 mt-2">
            <div className="space-y-1.5">
              <p className="text-sm font-medium">Jenis Diskon</p>
              <div className="grid grid-cols-2 gap-2">
                <button
                  onClick={() => setTempDiscountType('nominal')}
                  className={cn('p-3 rounded-xl text-sm font-semibold border-2 transition-colors', tempDiscountType === 'nominal' ? 'border-primary bg-primary/5 text-primary' : 'border-muted bg-muted/50 text-muted-foreground')}
                >
                  Nominal (Rp)
                </button>
                <button
                  onClick={() => setTempDiscountType('percentage')}
                  className={cn('p-3 rounded-xl text-sm font-semibold border-2 transition-colors', tempDiscountType === 'percentage' ? 'border-primary bg-primary/5 text-primary' : 'border-muted bg-muted/50 text-muted-foreground')}
                >
                  Persen (%)
                </button>
              </div>
            </div>

            <div className="space-y-1.5">
              <p className="text-sm font-medium">{tempDiscountType === 'percentage' ? 'Persentase Diskon' : 'Jumlah Diskon'}</p>
              <Input
                type="number"
                value={tempDiscountValue}
                onChange={e => setTempDiscountValue(e.target.value)}
                placeholder={tempDiscountType === 'percentage' ? 'Contoh: 10' : 'Contoh: 5000'}
                className="h-12 text-lg font-bold text-center"
              />
              {tempDiscountType === 'percentage' && Number(tempDiscountValue) > 0 && (
                <p className="text-xs text-muted-foreground text-center">
                  = Rp {(subtotal * Number(tempDiscountValue) / 100).toLocaleString('id-ID')} dari Rp {subtotal.toLocaleString('id-ID')}
                </p>
              )}
            </div>

            <div className="flex gap-2">
              {txDiscountType && (
                <Button variant="outline" className="h-11 text-destructive border-destructive/30" onClick={() => {
                  setTxDiscountType(null);
                  setTxDiscountValue('');
                  setDiscountDialogOpen(false);
                }}>
                  Hapus
                </Button>
              )}
              <Button className="flex-1 h-11 font-semibold" onClick={() => {
                if (Number(tempDiscountValue) > 0) {
                  setTxDiscountType(tempDiscountType);
                  setTxDiscountValue(tempDiscountValue);
                } else {
                  setTxDiscountType(null);
                  setTxDiscountValue('');
                }
                setDiscountDialogOpen(false);
              }}>
                Simpan Diskon
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Item Discount Dialog */}
      <Dialog open={itemDiscountTargetId !== null} onOpenChange={(open) => { if (!open) setItemDiscountTargetId(null); }}>
        <DialogContent className="max-w-[95vw] rounded-xl">
          <DialogHeader>
            <DialogTitle>Diskon Item</DialogTitle>
          </DialogHeader>
          {(() => {
            const target = itemDiscountTargetId == null ? undefined : cart[itemDiscountTargetId];
            if (!target) return null;
            const base = target.product.price * target.qty;
            const rawValue = Number(itemDiscountValue) || 0;
            const previewAmount = itemDiscountType === 'percentage'
              ? base * Math.min(100, Math.max(0, rawValue)) / 100
              : Math.min(base, Math.max(0, rawValue));
            const exceedsCap = itemDiscountType === 'percentage' ? rawValue > 100 : rawValue > base;
            return (
              <div className="space-y-4 mt-2">
                <div className="bg-muted/50 rounded-xl p-3">
                  <p className="text-xs text-muted-foreground">Item</p>
                  <p className="text-sm font-semibold">{target.product.name}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Rp {target.product.price.toLocaleString('id-ID')} × {target.qty} = {rp(base)}
                  </p>
                </div>

                <div className="space-y-1.5">
                  <p className="text-sm font-medium">Jenis Diskon</p>
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      onClick={() => setItemDiscountType('nominal')}
                      className={cn('p-3 rounded-xl text-sm font-semibold border-2 transition-colors', itemDiscountType === 'nominal' ? 'border-primary bg-primary/5 text-primary' : 'border-muted bg-muted/50 text-muted-foreground')}
                    >
                      Nominal (Rp)
                    </button>
                    <button
                      onClick={() => setItemDiscountType('percentage')}
                      className={cn('p-3 rounded-xl text-sm font-semibold border-2 transition-colors', itemDiscountType === 'percentage' ? 'border-primary bg-primary/5 text-primary' : 'border-muted bg-muted/50 text-muted-foreground')}
                    >
                      Persen (%)
                    </button>
                  </div>
                </div>

                <div className="space-y-1.5">
                  <p className="text-sm font-medium">{itemDiscountType === 'percentage' ? 'Persentase Diskon' : 'Jumlah Diskon'}</p>
                  <Input
                    type="number"
                    inputMode="decimal"
                    value={itemDiscountValue}
                    onChange={e => setItemDiscountValue(e.target.value)}
                    placeholder={itemDiscountType === 'percentage' ? 'Contoh: 10' : 'Contoh: 5000'}
                    className="h-12 text-lg font-bold text-center"
                    autoFocus
                  />
                  {rawValue > 0 && (
                    <p className={cn('text-xs text-center', exceedsCap ? 'text-destructive' : 'text-muted-foreground')}>
                      {exceedsCap
                        ? `Dibatasi otomatis ke ${itemDiscountType === 'percentage' ? '100%' : rp(base)}`
                        : `Diskon: -${rp(previewAmount)} → subtotal ${rp(Math.max(0, base - previewAmount))}`}
                    </p>
                  )}
                </div>

                <div className="flex gap-2">
                  {target.discountType && (
                    <Button
                      variant="outline"
                      className="h-11 text-destructive border-destructive/30"
                      onClick={clearItemDiscount}
                    >
                      Hapus
                    </Button>
                  )}
                  <Button className="flex-1 h-11 font-semibold" onClick={saveItemDiscount}>
                    Simpan Diskon
                  </Button>
                </div>
              </div>
            );
          })()}
        </DialogContent>
      </Dialog>

      {/* Receipt Dialog */}
      {lastTransaction && (
        <Receipt
          open={receiptOpen}
          onClose={() => setReceiptOpen(false)}
          transaction={lastTransaction}
          items={lastTxItems}
          storeSettings={storeSettings}
          paymentMethodName={paymentMethods?.find(pm => pm.id === lastTransaction.paymentMethodId)?.name || 'Tunai'}
          cashierName={lastTransaction.createdBy ? allUsers?.find(u => u.id === lastTransaction.createdBy)?.name : undefined}
        />
      )}


      {/* Daily Prep Dialog */}
      <Dialog open={prepModalOpen} onOpenChange={() => {}}>
        <DialogContent className="max-w-[95vw] rounded-xl [&>button]:hidden" onPointerDownOutside={(e) => e.preventDefault()} onEscapeKeyDown={(e) => e.preventDefault()}>
          <DialogHeader>
            <DialogTitle>Persiapan Harian Hari Ini</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 mt-2">
            <p className="text-sm text-muted-foreground">
              Masukkan jumlah untuk setiap bahan persiapan utama. Item turunan akan dihitung otomatis sesuai rumus yang sudah diset.
            </p>
            <div className="space-y-3 max-h-[60vh] overflow-y-auto pr-1">
              {mainPrepItems.map(item => {
                const desiredQty = Math.max(0, parseInt(prepCounts[item.id!] || '0') || 0);
                const currentPrep = item.lastPreparedDate === todayStr ? (item.dailyPrepQty || 0) : 0;
                const itemFormulas = activeDailyPrepFormulas.filter(formula => formula.prepItemId === item.id);

                return (
                  <div key={item.id} className="rounded-xl border bg-card p-3 space-y-3">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="font-semibold text-foreground">{item.name}</p>
                        <p className="text-xs text-muted-foreground">
                          Stok saat ini: {item.stock} {item.unit}
                          {currentPrep > 0 ? ` • Sudah dipersiapkan ${currentPrep} ${item.unit}` : ''}
                        </p>
                      </div>
                      <Badge variant="secondary" className="rounded-full">
                        {itemFormulas.length > 0 ? 'Punya Rumus' : 'Stok Langsung'}
                      </Badge>
                    </div>

                    <div className="space-y-1.5">
                      <label className="text-xs font-semibold text-muted-foreground">
                        Jumlah disiapkan ({item.unit})
                      </label>
                      <Input
                        type="number"
                        min="0"
                        value={prepCounts[item.id!] ?? ''}
                        onChange={e => setPrepCounts(prev => ({ ...prev, [item.id!]: e.target.value }))}
                        placeholder={`Contoh: ${item.dailyPrepFactor || 1}`}
                        className="h-11 text-base font-semibold text-center"
                      />
                    </div>

                    <div className="text-xs bg-muted p-3 rounded-lg space-y-1">
                      <p className="font-semibold">
                        {itemFormulas.length > 0 ? 'Estimasi output persiapan:' : 'Estimasi stok siap jual:'}
                      </p>
                      {itemFormulas.length > 0 ? (
                        <ul className="list-disc pl-4 space-y-0.5">
                          {itemFormulas.map(formula => {
                            const targetItem = visibleWarehouseItems?.find(wi => wi.id === formula.targetItemId);
                            return (
                              <li key={formula.id}>
                                {targetItem?.name || `Bahan #${formula.targetItemId}`}: {desiredQty * formula.factor} {targetItem?.unit || 'pcs'}
                              </li>
                            );
                          })}
                        </ul>
                      ) : (
                        <p>
                          {item.name}: {desiredQty * (item.dailyPrepFactor || 1)} {item.unit}
                        </p>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
            <Button className="w-full h-12 text-base font-semibold" onClick={handleDailyPrep}>
              <Check className="w-5 h-5 mr-2" />
              Mulai Hari Baru
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
