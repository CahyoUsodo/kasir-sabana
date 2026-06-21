import { useLiveQuery } from 'dexie-react-hooks';
import { db, type Product, type Category, type Transaction, type TransactionItemRecord, type CartOptionSnapshot, adjustConfiguredStock, buildStockKey, getAvailableStockForSelection, getConfiguredProductReceiptDetails, getActiveDailyPrepFormulas, getMainDailyPrepItems, getDefaultOptionSelection, getSelectedOptionIds, repairInventoryAnomalies } from '@/lib/db';
import { useState, useRef, useEffect } from 'react';
import { Search, Plus, Minus, ShoppingCart, X, Percent, Tag, CreditCard, Banknote, Check, Package as PackageIcon, Pencil, User, Hash, Utensils, ShoppingBag, Warehouse, ClipboardList } from 'lucide-react';
import Receipt from '@/components/Receipt';
import { useNavigate, useSearchParams } from 'react-router-dom';

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
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const editTxIdParam = searchParams.get('editTxId');
  const openBillsParam = searchParams.get('openBills');

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
  const [openBillsOpen, setOpenBillsOpen] = useState(false);
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
  const [isCheckoutSubmitting, setIsCheckoutSubmitting] = useState(false);
  const [isQuickAdding, setIsQuickAdding] = useState(false);
  const [receiptOpen, setReceiptOpen] = useState(false);
  const [lastTransaction, setLastTransaction] = useState<Transaction | null>(null);
  const [lastTxItems, setLastTxItems] = useState<TransactionItemRecord[]>([]);
  const [customerName, setCustomerName] = useState('');
  const [cashierNameInput, setCashierNameInput] = useState(currentUser?.name ?? '');
  const [tableNumber, setTableNumber] = useState('');
  const [remarks, setRemarks] = useState('');

  const [editingItemNotes, setEditingItemNotes] = useState<string | null>(null);
  const [tempItemNotes, setTempItemNotes] = useState('');
  const loadTransactionForEditingRef = useRef<((txId: number) => Promise<void>) | null>(null);
  const doFullResetRef = useRef<(() => void) | null>(null);
  const checkoutBatchRef = useRef(false);
  const autoOpenReceiptTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [prepModalOpen, setPrepModalOpen] = useState(false);
  const [prepCounts, setPrepCounts] = useState<Record<number, string>>({});
  const [optionProduct, setOptionProduct] = useState<Product | null>(null);
  const [selectedOptionIds, setSelectedOptionIds] = useState<Record<number, number[]>>({});

  const products = useLiveQuery(() => db.products.where('isDeleted').equals(0).toArray());
  const categories = useLiveQuery(() => db.categories.where('isDeleted').equals(0).toArray());
  const visibleWarehouseItems = useLiveQuery(() => db.warehouseItems.where('isDeleted').equals(0).toArray());
  const dailyPrepFormulas = useLiveQuery(() => db.dailyPrepFormulas.toArray());
  const paymentMethods = useLiveQuery(() => db.paymentMethods.toArray());
  const openBills = useLiveQuery(async () => {
    const rows = await db.transactions.where('status').equals('open').toArray();
    return rows.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  });
  const openBillItems = useLiveQuery(async () => {
    if (!openBills || openBills.length === 0) return {};
    const txIds = openBills.map(tx => tx.id!).filter(Boolean);
    const items = await db.transactionItems.where('transactionId').anyOf(txIds).toArray();
    const map: Record<number, TransactionItemRecord[]> = {};
    for (const item of items) {
      if (!map[item.transactionId]) map[item.transactionId] = [];
      map[item.transactionId].push(item);
    }
    return map;
  }, [openBills]);
  const storeSettings = useLiveQuery(() => db.storeSettings.toCollection().first());
  const allUsers = useLiveQuery(() => db.users.toArray());
  const productRecipes = useLiveQuery(() => db.productRecipes.toArray());
  const productOptionGroups = useLiveQuery(() => db.productOptionGroups.toArray());
  const productOptions = useLiveQuery(() => db.productOptions.toArray());
  const productOptionRecipes = useLiveQuery(() => db.productOptionRecipes.toArray());

  const clearAutoOpenReceiptTimer = () => {
    if (autoOpenReceiptTimerRef.current) {
      clearTimeout(autoOpenReceiptTimerRef.current);
      autoOpenReceiptTimerRef.current = null;
    }
  };

  const scheduleReceiptOpen = () => {
    clearAutoOpenReceiptTimer();
    autoOpenReceiptTimerRef.current = setTimeout(() => {
      autoOpenReceiptTimerRef.current = null;
      if (typeof window !== 'undefined' && typeof window.requestAnimationFrame === 'function') {
        window.requestAnimationFrame(() => {
          window.requestAnimationFrame(() => setReceiptOpen(true));
        });
        return;
      }
      setReceiptOpen(true);
    }, 450);
  };

  // Permission gate — kept render-side (not redirect) so the bottom nav stays
  // intact. All hooks above run unconditionally; we just swap the rendered tree.
  const allowed = can('create_transaction');

  const getProductGroups = (productId?: number) => (productOptionGroups ?? [])
    .filter(group => group.productId === productId && group.isDeleted === 0)
    .sort((a, b) => a.sortOrder - b.sortOrder);

  const getGroupOptions = (groupId?: number) => (productOptions ?? [])
    .filter(option => option.groupId === groupId && option.isDeleted === 0)
    .sort((a, b) => a.sortOrder - b.sortOrder);

  const normalizeText = (value?: string) =>
    (value || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

  const getCategoryName = (categoryId: number) =>
    categories?.find(category => category.id === categoryId)?.name || '';

  const getCashierProductFamilyRank = (product: Product) => {
    const name = normalizeText(product.name);
    const categoryName = normalizeText(getCategoryName(product.categoryId));

    if (product.categoryId === -99 || name.includes('plastik') || name.includes('box') || name.includes('kemasan')) {
      return 5;
    }

    if (
      categoryName.includes('minuman') ||
      name.includes('fruit tea') ||
      name.includes('teh') ||
      name.includes('kopi') ||
      name.includes('americano') ||
      name.includes('matcha') ||
      name.includes('thai tea') ||
      name.includes('cold brew') ||
      name.includes('cokelat') ||
      name.includes('butterscotch')
    ) {
      return 4;
    }

    if (
      categoryName.includes('add on') ||
      name.includes('saus') ||
      name.includes('sambal') ||
      name.includes('mentai') ||
      name.includes('blackpepper') ||
      name.includes('buldak') ||
      name.includes('geprek')
    ) {
      return 3;
    }

    if (
      name.includes('bakso') ||
      name.includes('chicken roll') ||
      name.includes('chicken strip') ||
      name.includes('kulit') ||
      name.includes('kentang') ||
      name.includes('chicken bun') ||
      name.includes('burger') ||
      name.includes('katsu')
    ) {
      return 2;
    }

    if (
      categoryName.includes('paket') ||
      name.includes('paket') ||
      name.includes('rice bowl') ||
      name.includes('ayam sambal')
    ) {
      return 1;
    }

    if (
      name.includes('ayam reguler') ||
      name.includes('ayam regular') ||
      name.includes('sayap') ||
      name.includes('paha bawah') ||
      name.includes('dada') ||
      name.includes('paha atas')
    ) {
      return 0;
    }

    return 2;
  };

  const getCashierProductSpecificRank = (product: Product) => {
    const name = normalizeText(product.name);
    if (name.includes('ayam reguler') || name.includes('ayam regular')) return 0;
    if (name.includes('sayap')) return 1;
    if (name.includes('paha bawah')) return 2;
    if (name.includes('dada')) return 3;
    if (name.includes('paha atas')) return 4;
    if (name.includes('paket bundling')) return 5;
    if (name.includes('rice bowl geprek')) return 6;
    if (name.includes('rice bowl bbq')) return 7;
    if (name.includes('rice bowl chicken katsu')) return 8;
    if (name.includes('ayam sambal geprek')) return 9;
    if (name.includes('ayam sambal ijo')) return 10;
    if (name.includes('ayam sambal hitam')) return 11;
    return 99;
  };

  const compareCashierProducts = (a: Product, b: Product) => {
    const familyDiff = getCashierProductFamilyRank(a) - getCashierProductFamilyRank(b);
    if (familyDiff !== 0) return familyDiff;

    const specificDiff = getCashierProductSpecificRank(a) - getCashierProductSpecificRank(b);
    if (specificDiff !== 0) return specificDiff;

    const categoryDiff = normalizeText(getCategoryName(a.categoryId)).localeCompare(normalizeText(getCategoryName(b.categoryId)));
    if (categoryDiff !== 0) return categoryDiff;

    return normalizeText(a.name).localeCompare(normalizeText(b.name), 'id');
  };

  const getDefaultSelectionForProduct = (product: Product) =>
    getDefaultOptionSelection(product.id, productOptionGroups ?? [], productOptions ?? []);

  const getGroupSelectionCandidates = (product: Product, groupId?: number) => {
    const group = getProductGroups(product.id).find(item => item.id === groupId);
    const optionsForGroup = getGroupOptions(groupId);

    if (!group) return [];

    const defaultSelection = optionsForGroup
      .filter(option => option.isDefault === 1)
      .map(option => option.id!)
      .filter(Boolean)
      .slice(0, Math.max(1, group.maxSelect || 1));

    const minSelect = group.required === 1 ? Math.max(1, group.minSelect || 1) : Math.max(0, group.minSelect || 0);
    const maxSelect = Math.max(minSelect, Math.min(group.maxSelect || optionsForGroup.length || minSelect, optionsForGroup.length));
    const candidates = new Map<string, number[]>();
    const push = (selection: number[]) => {
      const normalized = [...selection].sort((a, b) => a - b);
      candidates.set(normalized.join(':'), normalized);
    };

    const optionIds = optionsForGroup.map(option => option.id!).filter(Boolean);
    const walk = (startIndex: number, selected: number[]) => {
      if (selected.length >= minSelect && selected.length <= maxSelect) {
        push(selected);
      }

      if (selected.length === maxSelect) {
        return;
      }

      for (let index = startIndex; index < optionIds.length; index += 1) {
        selected.push(optionIds[index]);
        walk(index + 1, selected);
        selected.pop();
      }
    };

    if (defaultSelection.length > 0) {
      push(defaultSelection);
    }

    walk(0, []);
    return Array.from(candidates.values());
  };

  const getWarehouseUsageForConfiguration = (productId?: number, selectedOptionIds: number[] = []) => {
    const usage = new Map<number, number>();
    const recipes = (productRecipes ?? []).filter(recipe => recipe.productId === productId);
    const optionRecipes = (productOptionRecipes ?? []).filter(recipe => selectedOptionIds.includes(recipe.optionId));

    for (const recipe of recipes) {
      usage.set(recipe.warehouseItemId, (usage.get(recipe.warehouseItemId) || 0) + recipe.quantity);
    }
    for (const recipe of optionRecipes) {
      usage.set(recipe.warehouseItemId, (usage.get(recipe.warehouseItemId) || 0) + recipe.quantity);
    }

    return usage;
  };

  const getReservedWarehouseUsageFromCart = (cartItems: CartItem[], excludedStockKey?: string) => {
    const reservedUsage = new Map<number, number>();

    for (const cartItem of cartItems) {
      if (cartItem.stockKey === excludedStockKey) continue;

      const usagePerUnit = getWarehouseUsageForConfiguration(
        cartItem.product.id,
        cartItem.selectedOptions.map(option => option.optionId)
      );

      for (const [warehouseItemId, quantity] of usagePerUnit.entries()) {
        reservedUsage.set(
          warehouseItemId,
          (reservedUsage.get(warehouseItemId) || 0) + (quantity * cartItem.qty)
        );
      }
    }

    return reservedUsage;
  };

  const getAvailableStockForSelectionSync = (
    product: Product,
    selection: Record<number, number[]>,
    cartItems: CartItem[] = cart,
    excludedStockKey?: string
  ) => {
    const selectedOptionIds = getSelectedOptionIds(selection);
    const stockKey = buildStockKey(product.id!, selectedOptionIds);
    const usage = getWarehouseUsageForConfiguration(product.id, selectedOptionIds);

    if (usage.size === 0) {
      const reservedQty = cartItems
        .filter(item => item.stockKey === stockKey && item.stockKey !== excludedStockKey)
        .reduce((sum, item) => sum + item.qty, 0);

      return product.stock - reservedQty;
    }

    const reservedUsage = getReservedWarehouseUsageFromCart(cartItems, excludedStockKey);
    let minStock = Infinity;
    for (const [warehouseItemId, quantity] of usage.entries()) {
      if (quantity <= 0) continue;
      const whItem = visibleWarehouseItems?.find(item => item.id === warehouseItemId);
      if (!whItem) return 0;
      const isResetToday = whItem.isDailyReset === 1 && whItem.lastPreparedDate !== todayStr;
      const effectiveStock = isResetToday ? 0 : whItem.stock;
      const reserved = reservedUsage.get(warehouseItemId) || 0;
      const available = Math.floor((effectiveStock - reserved) / quantity);
      if (available < minStock) {
        minStock = available;
      }
    }

    return minStock === Infinity ? 0 : minStock;
  };

  const getDisplayStockForProduct = (product: Product) => {
    const groups = getProductGroups(product.id);
    const defaultSelection = getDefaultSelectionForProduct(product);

    if (groups.length === 0) {
      return getAvailableStockForSelectionSync(product, defaultSelection);
    }

    const groupSelections = groups.map(group => {
      const explicitDefaults = defaultSelection[group.id!] ?? [];
      const selections = getGroupSelectionCandidates(product, group.id);
      if (explicitDefaults.length === 0) {
        return { groupId: group.id!, selections };
      }

      const withDefaultsFirst = new Map<string, number[]>();
      const normalizedDefaults = [...explicitDefaults].sort((a, b) => a - b);
      withDefaultsFirst.set(normalizedDefaults.join(':'), normalizedDefaults);
      selections.forEach(selection => {
        const normalized = [...selection].sort((a, b) => a - b);
        withDefaultsFirst.set(normalized.join(':'), normalized);
      });
      return { groupId: group.id!, selections: Array.from(withDefaultsFirst.values()) };
    });

    const availability: number[] = [];
    const walk = (index: number, selection: Record<number, number[]>) => {
      if (index >= groupSelections.length) {
        availability.push(getAvailableStockForSelectionSync(product, selection));
        return;
      }

      const group = groupSelections[index];
      group.selections.forEach(optionIds => {
        walk(index + 1, {
          ...selection,
          [group.groupId]: optionIds,
        });
      });
    };

    walk(0, {});
    return availability.length > 0 ? Math.max(...availability) : 0;
  };

  const getSelectionWithOption = (groupId: number, optionId: number, maxSelect: number) => {
    const current = selectedOptionIds[groupId] ?? [];
    if (current.includes(optionId)) {
      return selectedOptionIds;
    }

    const nextGroupSelection = maxSelect <= 1
      ? [optionId]
      : [...current, optionId].slice(0, maxSelect);

    return {
      ...selectedOptionIds,
      [groupId]: nextGroupSelection,
    };
  };

  const buildOptionSnapshots = (selection: Record<number, number[]>): CartOptionSnapshot[] => {
    const snapshots: CartOptionSnapshot[] = [];
    getSelectedOptionIds(selection).forEach(optionId => {
      const option = productOptions?.find(o => o.id === optionId);
      const group = option ? productOptionGroups?.find(g => g.id === option.groupId) : undefined;
      if (!option || !group) return;
      snapshots.push({
        groupId: group.id!,
        groupName: group.name,
        groupPricingMode: group.pricingMode || 'add',
        optionId: option.id!,
        optionName: option.name,
        priceDelta: option.priceDelta || 0,
        hppDelta: option.hppDelta || 0,
      });
    });
    return snapshots;
  };

  const buildSelectionFromSnapshots = (selectedOptions: CartOptionSnapshot[]) => {
    return selectedOptions.reduce<Record<number, number[]>>((selection, option) => {
      selection[option.groupId] = [...(selection[option.groupId] ?? []), option.optionId];
      return selection;
    }, {});
  };

  const getConfiguredProduct = (product: Product, selectedOptions: CartOptionSnapshot[]) => {
    const optionLabel = selectedOptions.map(option => option.optionName).join(' / ');
    const overrideOptions = selectedOptions.filter(option => option.groupPricingMode === 'override');
    const additiveOptions = selectedOptions.filter(option => option.groupPricingMode !== 'override');
    const priceDelta = additiveOptions.reduce((sum, option) => sum + option.priceDelta, 0);
    const hppDelta = additiveOptions.reduce((sum, option) => sum + option.hppDelta, 0);
    const overridePrice = overrideOptions.reduce((sum, option) => sum + option.priceDelta, 0);
    const overrideHpp = overrideOptions.reduce((sum, option) => sum + option.hppDelta, 0);
    const basePrice = overrideOptions.length > 0 ? overridePrice : product.price;
    const baseHpp = overrideOptions.length > 0 ? overrideHpp : product.hpp;
    return {
      ...product,
      name: optionLabel ? `${product.name} - ${optionLabel}` : product.name,
      price: basePrice + priceDelta,
      hpp: baseHpp + hppDelta,
    };
  };

  const getCartItemTitle = (item: CartItem) => item.baseName || item.product.name;

  const getCartItemOptionSummary = (item: CartItem) =>
    item.selectedOptions
      .map(option => option.optionName)
      .filter(Boolean)
      .join(' • ');

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
      setCashierNameInput(tx.cashierName || currentUser?.name || '');
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
  loadTransactionForEditingRef.current = loadTransactionForEditing;

  const handleOpenBillsOpenChange = (open: boolean) => {
    setOpenBillsOpen(open);
    if (!open && openBillsParam) {
      const next = new URLSearchParams(searchParams);
      next.delete('openBills');
      setSearchParams(next, { replace: true });
    }
  };

  const handleLoadOpenBill = (txId: number) => {
    const next = new URLSearchParams(searchParams);
    next.delete('openBills');
    next.set('editTxId', String(txId));
    setSearchParams(next, { replace: true });
    setOpenBillsOpen(false);
  };

  useEffect(() => {
    if (editTxIdParam) {
      const txId = Number(editTxIdParam);
      if (!isNaN(txId) && txId !== editingTxId) {
        void loadTransactionForEditingRef.current?.(txId);
      }
    } else if (editingTxId !== null) {
      doFullResetRef.current?.();
    }
  }, [editTxIdParam, editingTxId]);

  useEffect(() => {
    if (openBillsParam === '1') {
      setOpenBillsOpen(true);
    }
  }, [openBillsParam]);

  useEffect(() => {
    if (editingTxId !== null) return;
    setCashierNameInput(prev => prev || currentUser?.name || '');
  }, [currentUser?.name, editingTxId]);

  useEffect(() => {
    // Remove any legacy cashier draft because draft persistence is disabled.
    window.localStorage.removeItem('kasir-draft-v1');
  }, []);

  useEffect(() => {
    return () => {
      clearAutoOpenReceiptTimer();
    };
  }, []);

  const todayStr = new Date().toLocaleDateString('en-CA');
  const activeDailyPrepFormulas = getActiveDailyPrepFormulas(dailyPrepFormulas ?? [], visibleWarehouseItems ?? []);
  const mainPrepItems = getMainDailyPrepItems(visibleWarehouseItems ?? [], activeDailyPrepFormulas);
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
      return {
        ...p,
        stock: getDisplayStockForProduct(p),
      };
    }),
    ...virtualProducts
  ];

  const filtered = allAvailableProducts.filter(p => {
    const matchSearch = p.name.toLowerCase().includes(search.toLowerCase());
    const matchCategory = filterCategory === 'all' || p.categoryId === Number(filterCategory);
    return matchSearch && matchCategory;
  }).sort(compareCashierProducts);

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
    setCashierNameInput(currentUser?.name ?? '');
    setTableNumber('');
    setRemarks('');
    setIsQuickAdding(false);
    if (searchParams.has('editTxId')) {
      setSearchParams({}, { replace: true });
    }
  };
  doFullResetRef.current = doFullReset;

  // === Cart Operations ===

  const addConfiguredToCart = async (product: Product, selectedOptions: CartOptionSnapshot[] = []) => {
    const selectedOptionIds = selectedOptions.map(option => option.optionId);
    const stockKey = buildStockKey(product.id!, selectedOptionIds);

    setCart(prev => {
      const availableStock = getAvailableStockForSelectionSync(
        product,
        buildSelectionFromSnapshots(selectedOptions),
        prev,
        stockKey
      );
      const configuredProduct = {
        ...getConfiguredProduct(product, selectedOptions),
        stock: availableStock,
      };
      const existing = prev.find(c => c.stockKey === stockKey);
      if (existing) {
        return prev.map(c => c.stockKey === stockKey ? { ...c, qty: c.qty + 1 } : c);
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
      const selection = getDefaultSelectionForProduct(product);
      setOptionProduct(product);
      setSelectedOptionIds(selection);
      return;
    }
    void addConfiguredToCart(product);
  };

  const handleUnavailableProductClick = (product: Product) => {
    if ((product.id ?? 0) < 0) {
      navigate(`/warehouse?tab=stok&filter=cashier&itemId=${Math.abs(product.id!)}`);
      return;
    }

    navigate(`/products?productId=${product.id}`);
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
      const selection = buildSelectionFromSnapshots(c.selectedOptions);
      const availableStock = getAvailableStockForSelectionSync(c.product, selection, prev, stockKey);
      return { ...c, qty: newQty, product: { ...c.product, stock: availableStock } };
    }));
  };

  const removeFromCart = (stockKey: string) => {
    setCart(prev => prev.filter(c => c.stockKey !== stockKey));
  };

  const applyStockDelta = async (productId: number, qtyDelta: number, selectedOptions: CartOptionSnapshot[] = []) => {
    await adjustConfiguredStock(
      productId,
      qtyDelta,
      selectedOptions.map(option => option.optionId),
      { skipRepair: checkoutBatchRef.current }
    );
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
  const isExactPayment = total > 0 && paidAmount === total;
  const totalItemDiscount = cart.reduce((sum, item) => sum + getItemDiscountAmount(item), 0);
  const totalProfit = cart.reduce((sum, item) => sum + (item.product.price - item.product.hpp) * item.qty, 0) - totalItemDiscount - txDiscountAmount;

  // === Checkout ===

  const openCheckoutPayment = () => {
    setCheckoutOpen(true);
    setPaymentMethodId('');
    setPaymentAmount('0');
    setIsQuickAdding(false);
  };

  const buildTransactionItemRecords = async (transactionId: number): Promise<TransactionItemRecord[]> => {
    const itemRecords: TransactionItemRecord[] = [];
    for (const cartItem of cart) {
      const receiptDetails = cartItem.selectedOptions.length > 0
        ? await getConfiguredProductReceiptDetails(
            cartItem.product.id!,
            cartItem.selectedOptions.map(option => option.optionId)
          )
        : [];
      itemRecords.push({
        transactionId,
        productId: cartItem.product.id!,
        productName: cartItem.product.name,
        productBaseName: cartItem.baseName,
        selectedOptions: cartItem.selectedOptions,
        receiptDetails,
        stockKey: cartItem.stockKey,
        quantity: cartItem.qty,
        price: cartItem.product.price,
        hpp: cartItem.product.hpp,
        discountType: cartItem.discountType,
        discountValue: cartItem.discountValue,
        discountAmount: getItemDiscountAmount(cartItem),
        subtotal: getItemSubtotal(cartItem),
        notes: cartItem.notes,
      });
    }
    return itemRecords;
  };

  const applyCartStockDeltaFromOldItems = async (oldItems: TransactionItemRecord[]) => {
    for (const cartItem of cart) {
      const oldItem = oldItems.find(oi => (oi.stockKey || buildStockKey(oi.productId, oi.selectedOptions?.map(option => option.optionId) ?? [])) === cartItem.stockKey);
      const oldQty = oldItem?.quantity ?? 0;
      const delta = cartItem.qty - oldQty;
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
  };

  const handleSaveOpenBill = async () => {
    if (isCheckoutSubmitting) return;
    if (editingTxId && originalTx?.status !== 'open') return;
    const openBillCashierName = cashierNameInput.trim() || currentUser?.name?.trim() || undefined;

    setIsCheckoutSubmitting(true);
    checkoutBatchRef.current = true;

    try {
      if (editingTxId) {
        const oldItems = await db.transactionItems.where('transactionId').equals(editingTxId).toArray();

        await db.transactions.update(editingTxId, {
          status: 'open',
          subtotal,
          discountType: txDiscountType,
          discountValue: Number(txDiscountValue) || 0,
          discountAmount: txDiscountAmount,
          total,
          paymentMethodId: 0,
          paymentAmount: 0,
          change: 0,
          profit: totalProfit,
          customerName: customerName.trim() || undefined,
          tableNumber: serviceType === 'take_away' ? undefined : (tableNumber.trim() || undefined),
          remarks: remarks.trim() || undefined,
          cashierName: openBillCashierName,
          serviceType,
        });

        await db.transactionItems.where('transactionId').equals(editingTxId).delete();
        const itemRecords = await buildTransactionItemRecords(editingTxId);
        await db.transactionItems.bulkAdd(itemRecords);
        await applyCartStockDeltaFromOldItems(oldItems);
      } else {
        const receiptNumber = `OB${Date.now()}`;
        const txData: Transaction = {
          subtotal,
          discountType: txDiscountType,
          discountValue: Number(txDiscountValue) || 0,
          discountAmount: txDiscountAmount,
          total,
          paymentMethodId: 0,
          paymentAmount: 0,
          change: 0,
          profit: totalProfit,
          date: new Date(),
          receiptNumber,
          status: 'open',
          customerName: customerName.trim() || undefined,
          tableNumber: serviceType === 'take_away' ? undefined : (tableNumber.trim() || undefined),
          remarks: remarks.trim() || undefined,
          openedAt: new Date(),
          createdBy: currentUser?.id,
          cashierName: openBillCashierName,
          serviceType,
        };

        const txId = await db.transactions.add(txData);
        const itemRecords = await buildTransactionItemRecords(txId as number);
        await db.transactionItems.bulkAdd(itemRecords);

        for (const item of cart) {
          await applyStockDelta(item.product.id!, item.qty, item.selectedOptions);
        }
      }

      await repairInventoryAnomalies();
      toast.success('Open bill berhasil disimpan');
      doFullReset();
      setCartOpen(false);
    } catch (error) {
      console.error(error);
      toast.error(error instanceof Error ? error.message : 'Gagal menyimpan open bill');
    } finally {
      checkoutBatchRef.current = false;
      setIsCheckoutSubmitting(false);
    }
  };

  const handleCheckout = async () => {
    if (isCheckoutSubmitting) return;
    if (!paymentMethodId || paidAmount < total) return;
    const finalCashierName = cashierNameInput.trim() || currentUser?.name?.trim() || '';
    if (!finalCashierName) {
      toast.error('Nama kasir wajib diisi');
      return;
    }

    setIsCheckoutSubmitting(true);
    checkoutBatchRef.current = true;

    await new Promise<void>(resolve => {
      if (typeof window !== 'undefined' && typeof window.requestAnimationFrame === 'function') {
        window.requestAnimationFrame(() => resolve());
        return;
      }

      setTimeout(resolve, 0);
    });

    try {

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
        cashierName: finalCashierName,
        closedAt: new Date(),
        serviceType,
      });

      await db.transactionItems.where('transactionId').equals(editingTxId).delete();
      const itemRecords: TransactionItemRecord[] = [];
      for (const cartItem of cart) {
        const receiptDetails = cartItem.selectedOptions.length > 0
          ? await getConfiguredProductReceiptDetails(
              cartItem.product.id!,
              cartItem.selectedOptions.map(option => option.optionId)
            )
          : [];
        itemRecords.push({
          transactionId: editingTxId,
          productId: cartItem.product.id!,
          productName: cartItem.product.name,
          productBaseName: cartItem.baseName,
          selectedOptions: cartItem.selectedOptions,
          receiptDetails,
          stockKey: cartItem.stockKey,
          quantity: cartItem.qty,
          price: cartItem.product.price,
          hpp: cartItem.product.hpp,
          discountType: cartItem.discountType,
          discountValue: cartItem.discountValue,
          discountAmount: getItemDiscountAmount(cartItem),
          subtotal: getItemSubtotal(cartItem),
          notes: cartItem.notes,
        });
      }
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

      await repairInventoryAnomalies();

      const updatedTx = await db.transactions.get(editingTxId);
      setLastTransaction(updatedTx || null);
      setLastTxItems(itemRecords);
      scheduleReceiptOpen();
      toast.success(`Transaksi berhasil! ${updatedTx?.receiptNumber}`, {
        action: {
          label: 'Lihat Struk',
          onClick: () => {
            clearAutoOpenReceiptTimer();
            setReceiptOpen(true);
          },
        },
      });
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
        cashierName: finalCashierName,
        serviceType,
      };

      const txId = await db.transactions.add(txData);

      const itemRecords: TransactionItemRecord[] = [];
      for (const cartItem of cart) {
        const receiptDetails = cartItem.selectedOptions.length > 0
          ? await getConfiguredProductReceiptDetails(
              cartItem.product.id!,
              cartItem.selectedOptions.map(option => option.optionId)
            )
          : [];
        itemRecords.push({
          transactionId: txId as number,
          productId: cartItem.product.id!,
          productName: cartItem.product.name,
          productBaseName: cartItem.baseName,
          selectedOptions: cartItem.selectedOptions,
          receiptDetails,
          stockKey: cartItem.stockKey,
          quantity: cartItem.qty,
          price: cartItem.product.price,
          hpp: cartItem.product.hpp,
          discountType: cartItem.discountType,
          discountValue: cartItem.discountValue,
          discountAmount: getItemDiscountAmount(cartItem),
          subtotal: getItemSubtotal(cartItem),
          notes: cartItem.notes,
        });
      }
      await db.transactionItems.bulkAdd(itemRecords);

      for (const item of cart) {
        await applyStockDelta(item.product.id!, item.qty, item.selectedOptions);
      }

      await repairInventoryAnomalies();

      setLastTransaction({ ...txData, id: txId as number });
      setLastTxItems(itemRecords);
      scheduleReceiptOpen();
      toast.success(`Transaksi berhasil! ${receiptNumber}`, {
        action: {
          label: 'Lihat Struk',
          onClick: () => {
            clearAutoOpenReceiptTimer();
            setReceiptOpen(true);
          },
        },
      });
    }

    doFullReset();
    setCheckoutOpen(false);
    setCartOpen(false);
    } catch (error) {
      console.error(error);
      toast.error(error instanceof Error ? error.message : 'Gagal menyimpan transaksi');
    } finally {
      checkoutBatchRef.current = false;
      setIsCheckoutSubmitting(false);
    }
  };

  const cartCount = cart.reduce((s, c) => s + c.qty, 0);
  const canSaveOpenBill = !editingTxId || originalTx?.status === 'open';
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
        <Button
          variant="outline"
          size="sm"
          className="h-9 gap-1.5 rounded-full px-3 text-xs font-semibold"
          onClick={() => setOpenBillsOpen(true)}
        >
          <ClipboardList className="w-4 h-4" />
          <span className="hidden sm:inline">Lihat Open Bill</span>
          <Badge variant="secondary" className="h-5 px-1.5 text-[10px]">
            {openBills?.length ?? 0}
          </Badge>
        </Button>
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
                ? 'Tidak ada produk yang cocok dengan pencarian atau kategori ini.'
                : 'Belum ada produk. Tambah produk dulu di menu Produk.'}
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2">
            {filtered.map(p => {
              const isOutOfStock = p.stock <= 0 && !cartProductIds.has(buildStockKey(p.id!));
              const showOutOfStockBadge = false;

              return (
              <Card
                key={p.id}
                className={cn(
                  "border-0 shadow-sm transition-all active:scale-[0.98] cursor-pointer",
                  isOutOfStock
                    ? "bg-muted/30 hover:shadow-sm"
                    : "hover:shadow-md"
                )}
                onClick={() => addToCart(p)}
              >
                <CardContent className="p-0 relative">
                  {showOutOfStockBadge && (
                    <div className="absolute inset-x-2 top-2 z-10 rounded-full bg-muted-foreground/85 px-2 py-1 text-center text-[10px] font-semibold text-background">
                      Stok habis • buka produk
                    </div>
                  )}
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
                    <p className={cn("text-[10px] mt-0.5", isOutOfStock ? "text-destructive font-semibold" : "text-muted-foreground")}>
                      {`Stok: ${p.stock} ${p.unit}`}
                    </p>
                  </div>
                </CardContent>
              </Card>
            )})}
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
                      <p className="text-sm font-semibold truncate">{getCartItemTitle(item)}</p>
                      {getCartItemOptionSummary(item) && (
                        <p className="text-[11px] text-muted-foreground truncate mt-0.5">
                          {getCartItemOptionSummary(item)}
                        </p>
                      )}
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
                {canSaveOpenBill && (
                  <Button
                    variant="outline"
                    className="h-12 flex-1 text-sm font-semibold"
                    onClick={handleSaveOpenBill}
                    disabled={isCheckoutSubmitting}
                  >
                    <ClipboardList className="w-4 h-4 mr-2" />
                    Simpan Bill
                  </Button>
                )}
                <Button
                  className="h-12 flex-1 text-sm font-semibold"
                  onClick={openCheckoutPayment}
                  disabled={isCheckoutSubmitting}
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
                      <p className="text-sm font-semibold truncate">{getCartItemTitle(item)}</p>
                      {getCartItemOptionSummary(item) && (
                        <p className="text-[11px] text-muted-foreground truncate mt-0.5">
                          {getCartItemOptionSummary(item)}
                        </p>
                      )}
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
                {canSaveOpenBill && (
                  <Button
                    variant="outline"
                    className="h-12 flex-1 text-sm font-semibold"
                    onClick={handleSaveOpenBill}
                    disabled={isCheckoutSubmitting}
                  >
                    <ClipboardList className="w-4 h-4 mr-2" />
                    Simpan Bill
                  </Button>
                )}
                <Button
                  className="h-12 flex-1 text-sm font-semibold"
                  onClick={openCheckoutPayment}
                  disabled={isCheckoutSubmitting}
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

      <Sheet open={openBillsOpen} onOpenChange={handleOpenBillsOpenChange}>
        <SheetContent side="right" className="w-full sm:max-w-md overflow-y-auto">
          <SheetHeader>
            <SheetTitle className="text-left flex items-center gap-2">
              <ClipboardList className="w-5 h-5 text-primary" />
              Open Bill
            </SheetTitle>
          </SheetHeader>

          <div className="mt-4 space-y-3">
            {!openBills || openBills.length === 0 ? (
              <div className="rounded-xl border border-dashed p-6 text-center">
                <p className="text-sm font-medium">Tidak ada open bill</p>
                <p className="mt-1 text-xs text-muted-foreground">Bill yang disimpan akan muncul di sini.</p>
              </div>
            ) : (
              openBills.map(tx => {
                const items = tx.id ? openBillItems?.[tx.id] ?? [] : [];
                const itemSummary = items.length > 0
                  ? items.map(item => `${item.quantity}x ${item.productName}`).join(', ')
                  : 'Item belum dimuat';

                return (
                  <button
                    key={tx.id ?? tx.receiptNumber}
                    type="button"
                    className="w-full rounded-xl border bg-card p-3 text-left shadow-sm transition hover:border-primary/40 hover:bg-primary/5"
                    onClick={() => {
                      if (tx.id) {
                        handleLoadOpenBill(tx.id);
                      }
                    }}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-xs text-muted-foreground">{tx.receiptNumber}</span>
                          <Badge variant="secondary" className="h-5 bg-warning/20 px-1.5 text-[10px] text-warning">
                            Open
                          </Badge>
                        </div>
                        <p className="mt-1 line-clamp-2 text-sm font-medium">{itemSummary}</p>
                        <div className="mt-1 flex flex-wrap gap-x-2 gap-y-1 text-[11px] text-muted-foreground">
                          <span>{new Date(tx.date).toLocaleString('id-ID', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}</span>
                          {tx.customerName && <span>{tx.customerName}</span>}
                          {tx.tableNumber && <span>Meja {tx.tableNumber}</span>}
                          {tx.serviceType && <span>{tx.serviceType === 'take_away' ? 'Take Away' : 'Dine In'}</span>}
                        </div>
                      </div>
                      <span className="shrink-0 text-sm font-bold text-primary">{rp(tx.total)}</span>
                    </div>
                  </button>
                );
              })
            )}
          </div>
        </SheetContent>
      </Sheet>

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
                        const optionSelection = getSelectionWithOption(group.id!, option.id!, group.maxSelect);
                        const optionStock = getAvailableStockForSelectionSync(optionProduct, optionSelection);
                        const outOfStock = optionStock <= 0;
                        return (
                          <button
                            key={option.id}
                            type="button"
                            onClick={() => toggleOptionSelection(group.id!, option.id!, group.maxSelect)}
                            className={cn(
                              'text-left p-3 rounded-xl border transition-colors min-h-[68px]',
                              active ? 'border-primary bg-primary/5 text-primary' : 'border-border bg-muted/30 text-foreground',
                              outOfStock && !active && 'border-amber-300 bg-amber-50 text-foreground'
                            )}
                          >
                            <span className="block text-sm font-semibold leading-tight">{option.name}</span>
                            <span className="block text-xs text-muted-foreground mt-1">
                              {(group.pricingMode || 'add') === 'override'
                                ? `Harga paket ${rp(option.priceDelta)}`
                                : option.priceDelta > 0
                                  ? `+${rp(option.priceDelta)}`
                                  : option.priceDelta < 0
                                  ? `-${rp(Math.abs(option.priceDelta))}`
                                    : 'Tanpa tambahan'}
                            </span>
                            <span className={cn(
                              'block text-[11px] mt-1 font-medium',
                              outOfStock ? 'text-amber-700' : 'text-emerald-600'
                            )}>
                              {outOfStock ? `Stok: ${optionStock} ${optionProduct.unit} • tetap bisa dipilih` : `Stok tersedia: ${optionStock} ${optionProduct.unit}`}
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
      <Dialog open={checkoutOpen} onOpenChange={(open) => { if (!isCheckoutSubmitting) setCheckoutOpen(open); }}>
        <DialogContent className="top-2 grid h-[calc(100dvh-1rem)] w-[95vw] max-w-3xl translate-y-0 grid-rows-[auto,minmax(0,1fr),auto] overflow-hidden rounded-xl p-0 sm:top-4 sm:h-[calc(100dvh-2rem)]">
          <DialogHeader className="px-4 pb-0 pt-4 sm:px-6 sm:pt-5">
            <DialogTitle>Pembayaran</DialogTitle>
          </DialogHeader>
          <div
            className="min-h-0 overflow-y-auto px-4 pb-4 pt-2 sm:px-6"
            style={{ WebkitOverflowScrolling: 'touch' }}
          >
            <div className="space-y-4">
              <div className="text-center py-3 bg-primary/5 rounded-xl">
                <p className="text-sm text-muted-foreground">Total Bayar</p>
                <p className="text-3xl font-bold text-primary">{rp(total)}</p>
              </div>

              <div className="space-y-1.5">
                <p className="text-sm font-medium">Metode Pembayaran</p>
                <div className="grid grid-cols-3 gap-2">
                  {paymentMethods?.map(pm => (
                    <button key={pm.id} disabled={isCheckoutSubmitting} onClick={() => setPaymentMethodId(pm.id!.toString())} className={cn('p-3 rounded-xl text-xs font-semibold border-2 transition-colors disabled:opacity-60', paymentMethodId === pm.id!.toString() ? 'border-primary bg-primary/5 text-primary' : 'border-muted bg-muted/50 text-muted-foreground')}>
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
                      if (isCheckoutSubmitting) return;
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
                        if (isCheckoutSubmitting) return;
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
                    onClick={() => { if (isCheckoutSubmitting) return; setPaymentAmount(total.toString()); setIsQuickAdding(false); }}
                    className={cn(
                      "flex-1 min-w-[calc(25%-6px)] h-9 rounded-lg border text-xs font-semibold active:scale-95 transition-all",
                      isExactPayment
                        ? "border-primary/30 bg-primary/5 text-primary hover:bg-primary/10"
                        : "border-border bg-muted/50 text-foreground hover:bg-primary/10 hover:border-primary hover:text-primary"
                    )}
                  >
                    Uang Pas
                  </button>
                </div>
                <button
                  onClick={() => { if (isCheckoutSubmitting) return; setPaymentAmount('0'); setIsQuickAdding(false); }}
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

                <div className="relative">
                  <User className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
                  <Input
                    placeholder="Nama kasir"
                    value={cashierNameInput}
                    onChange={e => setCashierNameInput(e.target.value)}
                    className="pl-8 h-10 text-sm"
                  />
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
            </div>
          </div>
          <div className="border-t bg-background px-4 pb-[max(1rem,env(safe-area-inset-bottom,1rem))] pt-3 sm:px-6">
            <Button className="w-full h-12 text-base font-semibold" onClick={handleCheckout} disabled={isCheckoutSubmitting || !paymentMethodId || paidAmount < total}>
              <Check className="w-5 h-5 mr-2" />
              {isCheckoutSubmitting ? 'Menyimpan Transaksi...' : 'Konfirmasi Transaksi'}
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
      {lastTransaction && receiptOpen && (
      <Receipt
        open={receiptOpen}
        onClose={() => setReceiptOpen(false)}
        transaction={lastTransaction}
        items={lastTxItems}
        storeSettings={storeSettings}
        paymentMethodName={paymentMethods?.find(pm => pm.id === lastTransaction.paymentMethodId)?.name || 'Tunai'}
        cashierName={lastTransaction.cashierName || (lastTransaction.createdBy ? allUsers?.find(u => u.id === lastTransaction.createdBy)?.name : undefined)}
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
            <div className="flex justify-end">
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-9 text-xs gap-1.5"
                onClick={() => {
                  setPrepModalOpen(false);
                  navigate('/warehouse?tab=daily');
                }}
              >
                <Warehouse className="w-4 h-4" />
                Buka Gudang & Resep
              </Button>
            </div>
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
