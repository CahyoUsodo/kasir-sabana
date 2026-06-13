import { useLiveQuery } from 'dexie-react-hooks';
import { db, type Product, type Category, type ProductOption, type ProductOptionGroup, autoLinkChickenRecipes, upsertProductOptionRecipe, duplicateProduct, getDefaultOptionIdsForProduct } from '@/lib/db';
import { useState, useRef } from 'react';
import { Plus, Search, Edit2, Trash2, Package as PackageIcon, Camera, X, Settings2, Layers, Link as LinkIcon, Copy } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { compressImage } from '@/lib/image-utils';
import { toast } from 'sonner';
import { useAuth } from '@/hooks/use-auth';

export default function Produk() {
  const { currentUser, can } = useAuth();
  const canManage = can('manage_products');
  const navigate = useNavigate();

  const [search, setSearch] = useState('');
  const [filterCategory, setFilterCategory] = useState<string>('all');
  const [dialogOpen, setDialogOpen] = useState(false);
  const [deleteId, setDeleteId] = useState<number | null>(null);
  const [editProduct, setEditProduct] = useState<Product | null>(null);
  const [optionProduct, setOptionProduct] = useState<Product | null>(null);
  const [optionGroupDialog, setOptionGroupDialog] = useState(false);
  const [optionDialog, setOptionDialog] = useState(false);
  const [recipeDialog, setRecipeDialog] = useState(false);
  const [editingGroup, setEditingGroup] = useState<ProductOptionGroup | null>(null);
  const [editingOption, setEditingOption] = useState<ProductOption | null>(null);
  const [recipeOption, setRecipeOption] = useState<ProductOption | null>(null);
  const [groupDeleteTarget, setGroupDeleteTarget] = useState<ProductOptionGroup | null>(null);
  const [optionDeleteTarget, setOptionDeleteTarget] = useState<ProductOption | null>(null);

  // Form state
  const [name, setName] = useState('');
  const [sku, setSku] = useState('');
  const [categoryId, setCategoryId] = useState<string>('');
  const [price, setPrice] = useState('');
  const [hpp, setHpp] = useState('');
  const [stock, setStock] = useState('');
  const [unit, setUnit] = useState('pcs');
  const [barcode, setBarcode] = useState('');
  const [description, setDescription] = useState('');
  const [photo, setPhoto] = useState<string | undefined>(undefined);
  const [groupName, setGroupName] = useState('');
  const [groupRequired, setGroupRequired] = useState(true);
  const [groupMin, setGroupMin] = useState('1');
  const [groupMax, setGroupMax] = useState('1');
  const [groupPricingMode, setGroupPricingMode] = useState<'add' | 'override'>('add');
  const [optionGroupId, setOptionGroupId] = useState('');
  const [optionName, setOptionName] = useState('');
  const [optionPriceDelta, setOptionPriceDelta] = useState('');
  const [optionHppDelta, setOptionHppDelta] = useState('');
  const [optionDefault, setOptionDefault] = useState(false);
  const [recipeWarehouseItemId, setRecipeWarehouseItemId] = useState('');
  const [recipeQty, setRecipeQty] = useState('1');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const products = useLiveQuery(() => db.products.where('isDeleted').equals(0).toArray());
  const categories = useLiveQuery(() => db.categories.where('isDeleted').equals(0).toArray());
  const units = useLiveQuery(() => db.units.where('isDeleted').equals(0).toArray());
  const productRecipes = useLiveQuery(() => db.productRecipes.toArray());
  const productOptionGroups = useLiveQuery(() => db.productOptionGroups.toArray());
  const productOptions = useLiveQuery(() => db.productOptions.toArray());
  const productOptionRecipes = useLiveQuery(() => db.productOptionRecipes.toArray());
  const visibleWarehouseItems = useLiveQuery(() => db.warehouseItems.where('isDeleted').equals(0).toArray());
  const dailyPrepFormulas = useLiveQuery(() => db.dailyPrepFormulas.toArray());

  // Compose dropdown options: active master units + current product's unit if it has been deleted/renamed
  const unitOptions = (() => {
    const names = (units ?? []).map(u => u.name);
    if (unit && !names.includes(unit)) names.push(unit);
    return names;
  })();

  const isLinkedToRecipe = editProduct ? (productRecipes?.some(r => r.productId === editProduct.id) ?? false) : false;
  const getProductRecipeCount = (productId?: number) => (productRecipes ?? []).filter(recipe => recipe.productId === productId).length;

  const rawFiltered = products?.filter(p => {
    const q = search.toLowerCase();
    const matchSearch =
      p.name.toLowerCase().includes(q) ||
      p.sku.toLowerCase().includes(q) ||
      (p.description?.toLowerCase().includes(q) ?? false);
    const matchCategory = filterCategory === 'all' || p.categoryId === Number(filterCategory);
    return matchSearch && matchCategory;
  }) ?? [];

  const getCategoryName = (catId: number) => categories?.find(c => c.id === catId)?.name ?? '-';
  const getCategoryColor = (catId: number) => categories?.find(c => c.id === catId)?.color ?? '#999';
  const normalizeText = (value?: string) =>
    (value || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

  const getProductGroups = (productId?: number) => (productOptionGroups ?? [])
    .filter(group => group.productId === productId && group.isDeleted === 0)
    .sort((a, b) => a.sortOrder - b.sortOrder);

  const getGroupOptions = (groupId?: number) => (productOptions ?? [])
    .filter(option => option.groupId === groupId && option.isDeleted === 0)
    .sort((a, b) => a.sortOrder - b.sortOrder);

  const getOptionRecipes = (optionId?: number) => (productOptionRecipes ?? [])
    .filter(recipe => recipe.optionId === optionId);

  const getDisplayStockForProduct = (product: Product) => {
    const selectedOptionIds = getDefaultOptionIdsForProduct(
      product.id,
      productOptionGroups ?? [],
      productOptions ?? []
    );
    const usage = new Map<number, number>();
    const recipes = (productRecipes ?? []).filter(recipe => recipe.productId === product.id);
    const optionRecipes = (productOptionRecipes ?? []).filter(recipe => selectedOptionIds.includes(recipe.optionId));

    for (const recipe of recipes) {
      usage.set(recipe.warehouseItemId, (usage.get(recipe.warehouseItemId) || 0) + recipe.quantity);
    }
    for (const recipe of optionRecipes) {
      usage.set(recipe.warehouseItemId, (usage.get(recipe.warehouseItemId) || 0) + recipe.quantity);
    }

    if (usage.size === 0) {
      return product.stock;
    }

    const todayStr = new Date().toLocaleDateString('en-CA');
    let minStock = Infinity;
    for (const [warehouseItemId, quantity] of usage.entries()) {
      if (quantity <= 0) continue;
      const whItem = visibleWarehouseItems?.find(wi => wi.id === warehouseItemId);
      if (!whItem) return 0;
      const isResetToday = whItem.isDailyReset === 1 && whItem.lastPreparedDate !== todayStr;
      const effectiveStock = isResetToday ? 0 : whItem.stock;
      const available = Math.floor(effectiveStock / quantity);
      if (available < minStock) {
        minStock = available;
      }
    }

    return minStock === Infinity ? 0 : minStock;
  };

  const getAdminCategoryRank = (product: Product) => {
    const categoryName = normalizeText(getCategoryName(product.categoryId));
    const name = normalizeText(product.name);

    if (categoryName.includes('makanan')) {
      if (name.includes('ayam reguler') || name.includes('ayam regular')) return 0;
      if (name.includes('paket') || name.includes('rice bowl') || name.includes('ayam sambal')) return 1;
      return 2;
    }
    if (categoryName.includes('add on')) return 3;
    if (categoryName.includes('minuman')) return 4;
    if (categoryName.includes('kemasan')) return 5;
    return 6;
  };

  const compareAdminProducts = (a: Product, b: Product) => {
    const aHasOptions = (productOptionGroups ?? []).some(group => group.productId === a.id && group.isDeleted === 0);
    const bHasOptions = (productOptionGroups ?? []).some(group => group.productId === b.id && group.isDeleted === 0);
    if (aHasOptions !== bHasOptions) return aHasOptions ? -1 : 1;

    const aHasRecipe = getProductRecipeCount(a.id) > 0;
    const bHasRecipe = getProductRecipeCount(b.id) > 0;
    if (aHasRecipe !== bHasRecipe) return aHasRecipe ? -1 : 1;

    const categoryDiff = getAdminCategoryRank(a) - getAdminCategoryRank(b);
    if (categoryDiff !== 0) return categoryDiff;

    const stockDiff = a.stock - b.stock;
    if (stockDiff !== 0 && (aHasRecipe || bHasRecipe)) return stockDiff;

    return normalizeText(a.name).localeCompare(normalizeText(b.name), 'id');
  };

  const filtered = rawFiltered.map(p => {
    return {
      ...p,
      stock: getDisplayStockForProduct(p),
    };
  }).sort(compareAdminProducts);

  const hasProductOptions = (productId?: number) => getProductGroups(productId).length > 0;
  const getProductOptionCount = (productId?: number) =>
    getProductGroups(productId).reduce((total, group) => total + getGroupOptions(group.id).length, 0);
  const getProductLinkedOptionCount = (productId?: number) =>
    getProductGroups(productId).reduce(
      (total, group) => total + getGroupOptions(group.id).filter(option => getOptionRecipes(option.id).length > 0).length,
      0
    );
  const getGroupLinkedRecipeCount = (groupId?: number) =>
    getGroupOptions(groupId).reduce((total, option) => total + getOptionRecipes(option.id).length, 0);
  const getOptionRecipeSummary = (optionId?: number) => {
    const recipes = getOptionRecipes(optionId);
    if (recipes.length === 0) return 'Belum terhubung ke stok gudang';
    if (recipes.length === 1) {
      const recipe = recipes[0];
      return `Mengurangi ${recipe.quantity} ${getWarehouseName(recipe.warehouseItemId)}`;
    }
    return `${recipes.length} bahan terhubung ke stok gudang`;
  };

  const getWarehouseName = (warehouseItemId: number) => {
    const item = visibleWarehouseItems?.find(wi => wi.id === warehouseItemId);
    return item ? `${item.name} (${item.unit})` : `Bahan #${warehouseItemId}`;
  };

  const getDisplayPhotoForProduct = (product: Product) => {
    if (product.photo) return product.photo;
    if (hasProductOptions(product.id)) return undefined;

    const linkedRecipes = (productRecipes ?? []).filter(recipe => recipe.productId === product.id);
    if (linkedRecipes.length !== 1) return undefined;

    return visibleWarehouseItems?.find(item => item.id === linkedRecipes[0].warehouseItemId)?.photo;
  };

  const getStockFieldMeta = () => {
    if (!editProduct?.id) {
      return {
        label: 'Stok Awal',
        disabled: false,
        description: 'Diisi untuk produk yang stoknya dikelola manual.',
      };
    }

    if (isLinkedToRecipe) {
      const recipeCount = getProductRecipeCount(editProduct.id);
      return {
        label: 'Stok Otomatis dari Resep',
        disabled: true,
        description: `Produk ini terhubung ke ${recipeCount} resep bahan. Stok dihitung otomatis dari stok gudang.`,
      };
    }

    return {
      label: 'Stok Awal',
      disabled: false,
      description: 'Bisa diedit karena produk ini belum terhubung ke resep bahan.',
    };
  };

  const getProductStockRedirect = (product?: Product | null) => {
    if (!product?.id) return null;

    const linkedRecipes = (productRecipes ?? []).filter(recipe => recipe.productId === product.id);
    if (linkedRecipes.length === 0) return null;

    const linkedWarehouseItemIds = new Set(linkedRecipes.map(recipe => recipe.warehouseItemId));
    const prepFormula = (dailyPrepFormulas ?? []).find(formula => linkedWarehouseItemIds.has(formula.targetItemId));

    if (prepFormula) {
      const prepSource = visibleWarehouseItems?.find(item => item.id === prepFormula.prepItemId);
      return {
        label: 'Buka Persiapan Harian',
        description: prepSource
          ? `Stok produk ini bertambah dari hasil persiapan ${prepSource.name}.`
          : 'Stok produk ini bertambah dari hasil persiapan harian.',
        go: () => {
          setDialogOpen(false);
          navigate(`/warehouse?tab=daily&itemId=${prepFormula.prepItemId}`);
        },
      };
    }

    const primaryWarehouseItem = visibleWarehouseItems?.find(item => item.id === linkedRecipes[0]?.warehouseItemId);
    const isManualSource = primaryWarehouseItem
      ? primaryWarehouseItem.isCashierVisible !== 1 && primaryWarehouseItem.isDailyReset !== 1
      : false;
    const filter = isManualSource ? 'manual' : 'all';

    return {
      label: 'Buka Stok Barang',
      description: primaryWarehouseItem
        ? `Cek dan ubah stok sumber di gudang: ${primaryWarehouseItem.name}.`
        : 'Cek stok sumber produk ini di gudang.',
      go: () => {
        setDialogOpen(false);
        navigate(`/warehouse?tab=stok&filter=${filter}&itemId=${linkedRecipes[0].warehouseItemId}`);
      },
    };
  };


  const openAdd = () => {
    setEditProduct(null);
    setName(''); setSku(''); setCategoryId(categories?.[0]?.id?.toString() ?? ''); setPrice(''); setHpp(''); setStock(''); setUnit('pcs'); setBarcode(''); setDescription(''); setPhoto(undefined);
    setDialogOpen(true);
  };

  const openEdit = (p: Product) => {
    setEditProduct(p);
    setName(p.name); setSku(p.sku); setCategoryId(p.categoryId.toString()); setPrice(p.price.toString()); setHpp(p.hpp.toString()); setStock(p.stock.toString()); setUnit(p.unit); setBarcode(p.barcode ?? ''); setDescription(p.description ?? ''); setPhoto(p.photo);
    setDialogOpen(true);
  };

  const openOptions = (p: Product) => {
    setOptionProduct(p);
  };

  const openGroupAdd = () => {
    if (!optionProduct?.id) return;
    setEditingGroup(null);
    setGroupName('');
    setGroupRequired(true);
    setGroupMin('1');
    setGroupMax('1');
    setGroupPricingMode((optionProduct.price || 0) === 0 ? 'override' : 'add');
    setOptionGroupDialog(true);
  };

  const openGroupEdit = (group: ProductOptionGroup) => {
    setEditingGroup(group);
    setGroupName(group.name);
    setGroupRequired(group.required === 1);
    setGroupMin(String(group.minSelect));
    setGroupMax(String(group.maxSelect));
    setGroupPricingMode(group.pricingMode || 'add');
    setOptionGroupDialog(true);
  };

  const saveOptionGroup = async () => {
    if (!optionProduct?.id || !groupName.trim()) return;
    const now = new Date();
    const minSelect = Math.max(0, Number(groupMin) || 0);
    const maxSelect = Math.max(minSelect || 1, Number(groupMax) || 1);

    if (editingGroup?.id) {
      await db.productOptionGroups.update(editingGroup.id, {
        name: groupName.trim(),
        required: groupRequired ? 1 : 0,
        minSelect: groupRequired ? Math.max(1, minSelect) : minSelect,
        maxSelect,
        pricingMode: groupPricingMode,
        updatedAt: now,
      });
    } else {
      const sortOrder = getProductGroups(optionProduct.id).length;
      await db.productOptionGroups.add({
        productId: optionProduct.id,
        name: groupName.trim(),
        required: groupRequired ? 1 : 0,
        minSelect: groupRequired ? Math.max(1, minSelect) : minSelect,
        maxSelect,
        pricingMode: groupPricingMode,
        sortOrder,
        isDeleted: 0,
        createdAt: now,
        updatedAt: now,
      });
    }
    setOptionGroupDialog(false);
  };

  const deleteOptionGroup = async (group: ProductOptionGroup) => {
    if (!group.id) return;
    setGroupDeleteTarget(group);
  };

  const confirmDeleteOptionGroup = async () => {
    const group = groupDeleteTarget;
    if (!group?.id) return;
    const optionIds = getGroupOptions(group.id).map(option => option.id!).filter(Boolean);
    await db.productOptionGroups.update(group.id, { isDeleted: 1, updatedAt: new Date() });
    for (const optionId of optionIds) {
      await db.productOptions.update(optionId, { isDeleted: 1, updatedAt: new Date() });
    }
    setGroupDeleteTarget(null);
    toast.success('Grup opsi dihapus');
  };

  const openOptionAdd = (group: ProductOptionGroup) => {
    setEditingOption(null);
    setOptionGroupId(String(group.id));
    setOptionName('');
    setOptionPriceDelta('');
    setOptionHppDelta('');
    setOptionDefault(false);
    setOptionDialog(true);
  };

  const openOptionEdit = (option: ProductOption) => {
    setEditingOption(option);
    setOptionGroupId(String(option.groupId));
    setOptionName(option.name);
    setOptionPriceDelta(String(option.priceDelta || 0));
    setOptionHppDelta(String(option.hppDelta || 0));
    setOptionDefault(option.isDefault === 1);
    setOptionDialog(true);
  };

  const saveOption = async () => {
    if (!optionGroupId || !optionName.trim()) return;
    const now = new Date();
    const groupId = Number(optionGroupId);

    if (optionDefault) {
      const siblingOptions = getGroupOptions(groupId);
      for (const sibling of siblingOptions) {
        if (sibling.id && sibling.id !== editingOption?.id) {
          await db.productOptions.update(sibling.id, { isDefault: 0, updatedAt: now });
        }
      }
    }

    const data = {
      groupId,
      name: optionName.trim(),
      priceDelta: Number(optionPriceDelta) || 0,
      hppDelta: Number(optionHppDelta) || 0,
      isDefault: optionDefault ? 1 : 0,
      updatedAt: now,
    };

    if (editingOption?.id) {
      await db.productOptions.update(editingOption.id, data);
    } else {
      const sortOrder = getGroupOptions(groupId).length;
      await db.productOptions.add({
        ...data,
        sortOrder,
        isDeleted: 0,
        createdAt: now,
      });
    }
    setOptionDialog(false);
  };

  const deleteOption = async (option: ProductOption) => {
    if (!option.id) return;
    setOptionDeleteTarget(option);
  };

  const confirmDeleteOption = async () => {
    const option = optionDeleteTarget;
    if (!option?.id) return;
    await db.productOptions.update(option.id, { isDeleted: 1, updatedAt: new Date() });
    await db.productOptionRecipes.where('optionId').equals(option.id).delete();
    setOptionDeleteTarget(null);
    toast.success('Opsi dihapus');
  };

  const openRecipeDialog = (option: ProductOption) => {
    setRecipeOption(option);
    setRecipeWarehouseItemId('');
    setRecipeQty('1');
    setRecipeDialog(true);
  };

  const saveOptionRecipe = async () => {
    if (!recipeOption?.id || !recipeWarehouseItemId) return;
    await upsertProductOptionRecipe(recipeOption.id, Number(recipeWarehouseItemId), Number(recipeQty) || 1);
    setRecipeWarehouseItemId('');
    setRecipeQty('1');
    toast.success('Bahan opsi disimpan');
  };

  const deleteOptionRecipe = async (recipeId?: number) => {
    if (!recipeId) return;
    await db.productOptionRecipes.delete(recipeId);
  };

  const handlePhotoSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      toast.error('File harus berupa gambar');
      return;
    }
    try {
      const compressed = await compressImage(file);
      setPhoto(compressed);
    } catch {
      toast.error('Gagal memproses gambar');
    }
    // Reset input so same file can be selected again
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleSave = async () => {
    if (!name.trim() || !categoryId || !sku.trim()) return;

    // Check SKU uniqueness
    const existing = await db.products
      .where('sku')
      .equals(sku.trim())
      .filter(p => p.isDeleted === 0)
      .first();
    if (existing && existing.id !== editProduct?.id) {
      toast.error(`SKU "${sku.trim()}" sudah digunakan oleh produk "${existing.name}"`);
      return;
    }

    const data = {
      name: name.trim(),
      sku: sku.trim(),
      categoryId: Number(categoryId),
      price: Number(price) || 0,
      hpp: Number(hpp) || 0,
      stock: editProduct?.id && isLinkedToRecipe ? editProduct.stock : (Number(stock) || 0),
      unit: unit.trim() || 'pcs',
      description: description.trim() || undefined,
      barcode: barcode.trim() || undefined,
      photo: photo || undefined,
      updatedAt: new Date(),
      updatedBy: currentUser?.id,
    };

    if (editProduct?.id) {
      await db.products.update(editProduct.id, data);
    } else {
      await db.products.add({
        ...data,
        createdAt: new Date(),
        createdBy: currentUser?.id,
        isDeleted: 0,
        deletedAt: null,
      } as Product);
    }
    await autoLinkChickenRecipes();
    setDialogOpen(false);
  };

  const handleDelete = async () => {
    if (deleteId) {
      const now = new Date();
      const relatedGroups = (productOptionGroups ?? []).filter(group => group.productId === deleteId);
      const relatedGroupIds = relatedGroups.map(group => group.id!).filter(Boolean);
      const relatedOptions = (productOptions ?? []).filter(option => relatedGroupIds.includes(option.groupId));
      const relatedOptionIds = relatedOptions.map(option => option.id!).filter(Boolean);

      await db.products.update(deleteId, {
        isDeleted: 1,
        deletedAt: now,
        updatedBy: currentUser?.id,
        updatedAt: now,
      });
      await db.productRecipes.where('productId').equals(deleteId).delete();
      for (const group of relatedGroups) {
        if (group.id) {
          await db.productOptionGroups.update(group.id, { isDeleted: 1, updatedAt: now });
        }
      }
      for (const option of relatedOptions) {
        if (option.id) {
          await db.productOptions.update(option.id, { isDeleted: 1, updatedAt: now });
        }
      }
      for (const optionId of relatedOptionIds) {
        await db.productOptionRecipes.where('optionId').equals(optionId).delete();
      }
      setDeleteId(null);
      toast.success('Produk dan konfigurasi terkait berhasil dihapus');
    }
  };

  const handleDuplicate = async (p: Product) => {
    if (!p.id) return;
    try {
      await duplicateProduct(p.id, currentUser?.id);
      toast.success(`Produk "${p.name}" berhasil diduplikasi`);
    } catch (err: any) {
      toast.error(`Gagal menduplikat produk: ${err.message}`);
    }
  };

  return (
    <div className="px-4 pt-6 pb-4 space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold flex items-center gap-2">
          <PackageIcon className="w-5 h-5 text-primary" />
          Produk
        </h1>
        {canManage && (
          <Button size="sm" onClick={openAdd} className="h-9 gap-1.5">
            <Plus className="w-4 h-4" />
            Tambah
          </Button>
        )}
      </div>

      {/* Search & Filter */}
      <div className="flex gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            placeholder="Cari produk..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="pl-9 h-10"
          />
        </div>
        <Select value={filterCategory} onValueChange={setFilterCategory}>
          <SelectTrigger className="w-[120px] h-10">
            <SelectValue placeholder="Kategori" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Semua</SelectItem>
            {categories?.map(c => (
              <SelectItem key={c.id} value={c.id!.toString()}>{c.icon} {c.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Product count */}
      <p className="text-xs text-muted-foreground">{filtered.length} produk ditemukan</p>

      {/* Product List */}
      {filtered.length === 0 ? (
        <div className="text-center py-12">
          <PackageIcon className="w-12 h-12 mx-auto text-muted-foreground/30 mb-3" />
          <p className="text-sm text-muted-foreground">Belum ada produk</p>
          {canManage && (
            <Button variant="outline" size="sm" className="mt-3" onClick={openAdd}>
              <Plus className="w-4 h-4 mr-1" /> Tambah Produk
            </Button>
          )}
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map(p => (
            <Card key={p.id} className="border-0 shadow-sm">
              <CardContent className="p-3">
                {(() => {
                  const recipeCount = getProductRecipeCount(p.id);
                  const hasRecipe = recipeCount > 0;
                  const hasOptions = hasProductOptions(p.id);
                  const optionGroupCount = getProductGroups(p.id).length;
                  const optionCount = getProductOptionCount(p.id);

                  return (
                <div className="flex items-start gap-3">
                  {/* Product thumbnail */}
                  <div className="w-12 h-12 rounded-lg bg-muted flex items-center justify-center shrink-0 overflow-hidden">
                    {getDisplayPhotoForProduct(p) ? (
                      <img src={getDisplayPhotoForProduct(p)} alt={p.name} className="w-full h-full object-cover" />
                    ) : (
                      <PackageIcon className="w-5 h-5 text-muted-foreground/40" />
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <h3 className="text-sm font-semibold truncate">{p.name}</h3>
                      <Badge variant="outline" className="text-[10px] shrink-0" style={{ borderColor: getCategoryColor(p.categoryId), color: getCategoryColor(p.categoryId) }}>
                        {getCategoryName(p.categoryId)}
                      </Badge>
                      {hasRecipe && (
                        <Badge className="text-[10px] shrink-0 bg-amber-100 text-amber-700 hover:bg-amber-100">
                          Stok Otomatis
                        </Badge>
                      )}
                      {hasOptions && (
                        <Badge className="text-[10px] shrink-0 bg-sky-100 text-sky-700 hover:bg-sky-100">
                          Paket/Opsi
                        </Badge>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground mt-0.5">SKU: {p.sku || '-'}</p>
                    {p.description && (
                      <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2 whitespace-pre-line">
                        {p.description}
                      </p>
                    )}
                    <div className="flex items-center gap-3 mt-1.5">
                      <span className="text-sm font-bold text-primary">Rp {p.price.toLocaleString('id-ID')}</span>
                      <span className="text-xs text-muted-foreground">HPP: Rp {p.hpp.toLocaleString('id-ID')}</span>
                    </div>
                    <div className="flex items-center gap-2 mt-1">
                      <span className={cn('text-xs font-medium px-1.5 py-0.5 rounded', p.stock <= 5 ? 'bg-destructive/10 text-destructive' : 'bg-success/10 text-success')}>
                        Stok: {p.stock} {p.unit}
                      </span>
                      {hasRecipe && (
                        <span className="text-[11px] text-muted-foreground">
                          {recipeCount} bahan resep
                        </span>
                      )}
                      {hasOptions && (
                        <span className="text-[11px] text-muted-foreground">
                          {optionGroupCount} grup • {optionCount} opsi
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-1 shrink-0">
                    {canManage ? (
                      <>
                        <Button variant="ghost" size="icon" className="h-8 w-8" aria-label={`Edit ${p.name}`} onClick={() => openEdit(p)}>
                          <Edit2 className="w-3.5 h-3.5" />
                        </Button>
                        <Button variant="ghost" size="icon" className="h-8 w-8" aria-label={`Duplikat ${p.name}`} onClick={() => handleDuplicate(p)}>
                          <Copy className="w-3.5 h-3.5" />
                        </Button>
                        <Button variant="ghost" size="icon" className="h-8 w-8" aria-label={`Opsi ${p.name}`} onClick={() => openOptions(p)}>
                          <Settings2 className="w-3.5 h-3.5" />
                        </Button>
                        <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive" aria-label={`Hapus ${p.name}`} onClick={() => setDeleteId(p.id!)}>
                          <Trash2 className="w-3.5 h-3.5" />
                        </Button>
                      </>
                    ) : null}
                  </div>
                </div>
                  );
                })()}
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Add/Edit Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-[95vw] rounded-xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editProduct ? 'Edit Produk' : 'Tambah Produk'}</DialogTitle>
          </DialogHeader>
          {(() => {
            const stockFieldMeta = getStockFieldMeta();
            const stockRedirect = getProductStockRedirect(editProduct);

            return (
          <div className="space-y-4 mt-2">
            {/* Photo picker */}
            <div className="space-y-1.5">
              <Label>Foto Produk</Label>
              <div className="flex items-center gap-3">
                <div
                  className="w-20 h-20 rounded-xl bg-muted border-2 border-dashed border-border flex items-center justify-center overflow-hidden cursor-pointer hover:border-primary/50 transition-colors"
                  onClick={() => fileInputRef.current?.click()}
                >
                  {photo ? (
                    <img src={photo} alt="Preview" className="w-full h-full object-cover" />
                  ) : (
                    <Camera className="w-6 h-6 text-muted-foreground/50" />
                  )}
                </div>
                <div className="flex flex-col gap-1.5">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-8 text-xs gap-1.5"
                    onClick={() => fileInputRef.current?.click()}
                  >
                    <Camera className="w-3.5 h-3.5" />
                    {photo ? 'Ganti Foto' : 'Pilih Foto'}
                  </Button>
                  {photo && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-8 text-xs text-destructive gap-1.5"
                      onClick={() => setPhoto(undefined)}
                    >
                      <X className="w-3.5 h-3.5" />
                      Hapus Foto
                    </Button>
                  )}
                </div>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={handlePhotoSelect}
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label>Nama Produk *</Label>
              <Input value={name} onChange={e => setName(e.target.value)} placeholder="Contoh: Nasi Goreng" className="h-11" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>SKU *</Label>
                <Input value={sku} onChange={e => setSku(e.target.value)} placeholder="Wajib diisi, contoh: NG001" className="h-11" />
              </div>
              <div className="space-y-1.5">
                <Label>Kategori *</Label>
                <Select value={categoryId} onValueChange={setCategoryId}>
                  <SelectTrigger className="h-11"><SelectValue placeholder="Pilih" /></SelectTrigger>
                  <SelectContent>
                    {categories?.map(c => (
                      <SelectItem key={c.id} value={c.id!.toString()}>{c.icon} {c.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Harga Jual *</Label>
                <Input type="number" value={price} onChange={e => setPrice(e.target.value)} placeholder="15000" className="h-11" />
              </div>
              <div className="space-y-1.5">
                <Label>HPP</Label>
                <Input type="number" value={hpp} onChange={e => setHpp(e.target.value)} placeholder="10000" className="h-11" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>{stockFieldMeta.label}</Label>
                <Input
                  type="number"
                  value={stock}
                  onChange={e => setStock(e.target.value)}
                  placeholder="0"
                  className={cn('h-11', stockFieldMeta.disabled && 'bg-muted text-muted-foreground')}
                  disabled={stockFieldMeta.disabled}
                />
                <p className="text-[11px] text-muted-foreground">{stockFieldMeta.description}</p>
                {stockRedirect && stockFieldMeta.disabled && (
                  <div className="rounded-xl border border-primary/15 bg-primary/5 p-2.5 space-y-2">
                    <p className="text-[11px] text-muted-foreground">{stockRedirect.description}</p>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="h-8 text-xs"
                      onClick={stockRedirect.go}
                    >
                      {stockRedirect.label}
                    </Button>
                  </div>
                )}
              </div>
              <div className="space-y-1.5">
                <Label>Satuan</Label>
                <Select value={unit} onValueChange={setUnit}>
                  <SelectTrigger className="h-11"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {unitOptions.length === 0 ? (
                      <SelectItem value="pcs">pcs</SelectItem>
                    ) : (
                      unitOptions.map(u => (
                        <SelectItem key={u} value={u}>{u}</SelectItem>
                      ))
                    )}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-1.5">
              <Label>Deskripsi</Label>
              <Textarea
                value={description}
                onChange={e => setDescription(e.target.value)}
                placeholder="Catatan/info tambahan, mis: isi 5 pcs, level pedas, supplier"
                rows={3}
                maxLength={500}
              />
              <p className="text-[10px] text-muted-foreground text-right">{description.length}/500</p>
            </div>
            <div className="rounded-xl border border-sky-200 bg-sky-50 p-3 text-[11px] text-sky-900 space-y-2">
              <p className="font-semibold">Produk paket dan produk ber-opsi diatur dari editor paket.</p>
              <p>
                Simpan produk dasar dulu, lalu susun grup seperti potongan ayam, pilihan sambal, atau tambahan nasi agar kasir bisa memilih kombinasi paket dengan benar.
              </p>
              {editProduct?.id ? (
                <Button type="button" variant="outline" size="sm" className="h-8 text-xs" onClick={() => { setDialogOpen(false); setOptionProduct(editProduct); }}>
                  Buka Editor Paket
                </Button>
              ) : (
                <p className="text-[10px] text-sky-700">Tombol editor paket akan aktif setelah produk pertama kali disimpan.</p>
              )}
            </div>
            <Button className="w-full h-12 text-base font-semibold" onClick={handleSave} disabled={!name.trim() || !categoryId || !sku.trim()}>
              {editProduct ? 'Simpan Perubahan' : 'Tambah Produk'}
            </Button>
          </div>
            );
          })()}
        </DialogContent>
      </Dialog>

      {/* Product Options Dialog */}
      <Dialog open={!!optionProduct} onOpenChange={(open) => { if (!open) setOptionProduct(null); }}>
        <DialogContent className="max-w-[95vw] rounded-xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Editor Paket & Opsi</DialogTitle>
          </DialogHeader>
          {optionProduct && (
            <div className="space-y-4 mt-2">
              <div className="rounded-2xl border border-primary/15 bg-primary/5 p-4 space-y-3">
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold truncate">{optionProduct.name}</p>
                    <p className="text-xs text-muted-foreground">
                      Harga dasar Rp {optionProduct.price.toLocaleString('id-ID')} • SKU {optionProduct.sku}
                    </p>
                  </div>
                  <Button size="sm" className="h-9 gap-1.5" onClick={openGroupAdd}>
                    <Plus className="w-4 h-4" />
                    Grup
                  </Button>
                </div>

                <div className="grid grid-cols-3 gap-2">
                  <div className="rounded-xl bg-white/80 border p-2.5">
                    <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Grup Opsi</p>
                    <p className="text-lg font-bold">{getProductGroups(optionProduct.id).length}</p>
                  </div>
                  <div className="rounded-xl bg-white/80 border p-2.5">
                    <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Total Opsi</p>
                    <p className="text-lg font-bold">{getProductOptionCount(optionProduct.id)}</p>
                  </div>
                  <div className="rounded-xl bg-white/80 border p-2.5">
                    <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Opsi ke Gudang</p>
                    <p className="text-lg font-bold">{getProductLinkedOptionCount(optionProduct.id)}</p>
                  </div>
                </div>

                <div className="text-[11px] text-muted-foreground leading-relaxed">
                  Susun paket per grup. Contohnya: grup <strong>Potongan Ayam</strong> berisi <strong>Sayap</strong>, <strong>Paha Bawah</strong>, lalu grup <strong>Sambal</strong> berisi <strong>Sambal Ijo</strong> atau <strong>Geprek</strong>. Tiap opsi bisa dihubungkan ke stok gudang agar pengurangan stok mengikuti pilihan kasir.
                </div>
              </div>
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-semibold truncate">Struktur Paket Saat Ini</p>
                  <p className="text-xs text-muted-foreground">Kelola grup pilihan, isi paket, dan kaitan stok per opsi.</p>
                </div>
              </div>

              {getProductGroups(optionProduct.id).length === 0 ? (
                <div className="rounded-2xl border border-dashed p-6 text-center text-xs text-muted-foreground space-y-2">
                  <p className="font-semibold text-foreground">Produk ini belum punya struktur paket.</p>
                  <p>Mulai dari tambah grup opsi, misalnya: Potongan Ayam, Pilihan Sambal, atau Tambahan.</p>
                </div>
              ) : (
                <div className="space-y-4">
                  <div className="space-y-2">
                    <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Preview Struktur Paket</p>
                    <div className="rounded-2xl border bg-muted/20 p-3 space-y-2">
                      {getProductGroups(optionProduct.id).map(group => (
                        <div key={`summary-${group.id}`} className="rounded-xl bg-background border px-3 py-2">
                          <div className="flex items-center justify-between gap-2 flex-wrap">
                            <div className="flex items-center gap-2 flex-wrap">
                              <p className="text-sm font-semibold">{group.name}</p>
                              <Badge variant="outline" className="text-[10px]">
                                {group.required ? 'Wajib' : 'Opsional'}
                              </Badge>
                              <Badge variant="outline" className="text-[10px]">
                                {(group.pricingMode || 'add') === 'override' ? 'Harga Paket' : 'Harga Tambahan'}
                              </Badge>
                            </div>
                            <span className="text-[11px] text-muted-foreground">
                              pilih {group.minSelect}-{group.maxSelect}
                            </span>
                          </div>
                          <div className="flex flex-wrap gap-1.5 mt-2">
                            {getGroupOptions(group.id).map(option => (
                              <Badge
                                key={`summary-option-${option.id}`}
                                variant="secondary"
                                className={cn(
                                  'text-[10px]',
                                  option.isDefault === 1 && 'bg-primary/10 text-primary'
                                )}
                              >
                                {option.name}
                                {option.isDefault === 1 ? ' • default' : ''}
                              </Badge>
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                  <div className="space-y-3">
                  {getProductGroups(optionProduct.id).map(group => (
                    <div key={group.id} className="border rounded-2xl p-4 space-y-3 bg-background">
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <p className="text-sm font-bold">{group.name}</p>
                          <p className="text-[11px] text-muted-foreground">
                            {group.required ? 'Wajib' : 'Opsional'} · pilih {group.minSelect}-{group.maxSelect}
                          </p>
                          <p className="text-[11px] text-muted-foreground">
                            {(group.pricingMode || 'add') === 'override'
                              ? 'Pilihan di grup ini menentukan harga final paket.'
                              : 'Pilihan di grup ini menambah atau mengurangi harga dasar produk.'}
                          </p>
                        </div>
                        <div className="flex gap-1">
                          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => openGroupEdit(group)}>
                            <Edit2 className="w-3.5 h-3.5" />
                          </Button>
                          <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive" onClick={() => deleteOptionGroup(group)}>
                            <Trash2 className="w-3.5 h-3.5" />
                          </Button>
                        </div>
                      </div>

                      <div className="space-y-2">
                        {getGroupOptions(group.id).map(option => {
                          const recipes = getOptionRecipes(option.id);
                          return (
                            <div key={option.id} className="rounded-xl bg-muted/40 p-3 space-y-2">
                              <div className="flex items-start justify-between gap-2">
                                <div className="min-w-0">
                                  <div className="flex items-center gap-1.5">
                                    <p className="text-xs font-semibold truncate">{option.name}</p>
                                    {option.isDefault === 1 && <Badge className="h-4 text-[9px]">Default</Badge>}
                                  </div>
                                  <p className="text-[11px] text-muted-foreground">
                                    {(group.pricingMode || 'add') === 'override'
                                      ? `Harga paket Rp ${(option.priceDelta || 0).toLocaleString('id-ID')} · HPP Rp ${(option.hppDelta || 0).toLocaleString('id-ID')}`
                                      : `+Rp ${(option.priceDelta || 0).toLocaleString('id-ID')} · HPP +Rp ${(option.hppDelta || 0).toLocaleString('id-ID')}`}
                                  </p>
                                  <p className="text-[11px] text-muted-foreground mt-1">
                                    {getOptionRecipeSummary(option.id)}
                                  </p>
                                </div>
                                <div className="flex gap-1">
                                  <Button variant="ghost" size="icon" className="h-7 w-7" title="Atur pengurangan stok opsi" onClick={() => openRecipeDialog(option)}>
                                    <LinkIcon className="w-3.5 h-3.5" />
                                  </Button>
                                  <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => openOptionEdit(option)}>
                                    <Edit2 className="w-3.5 h-3.5" />
                                  </Button>
                                  <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive" onClick={() => deleteOption(option)}>
                                    <Trash2 className="w-3.5 h-3.5" />
                                  </Button>
                                </div>
                              </div>
                              {recipes.length > 0 && (
                                <div className="flex flex-wrap gap-1">
                                  {recipes.map(recipe => (
                                    <Badge key={recipe.id} variant="outline" className="text-[10px]">
                                      {getWarehouseName(recipe.warehouseItemId)} -{recipe.quantity}
                                    </Badge>
                                  ))}
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>

                      <Button variant="outline" size="sm" className="w-full h-9 text-xs gap-1.5" onClick={() => openOptionAdd(group)}>
                        <Plus className="w-3.5 h-3.5" />
                        Tambah Opsi ke Grup Ini
                      </Button>
                    </div>
                  ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Option Group Dialog */}
      <Dialog open={optionGroupDialog} onOpenChange={setOptionGroupDialog}>
        <DialogContent className="max-w-[95vw] rounded-xl">
          <DialogHeader>
            <DialogTitle>{editingGroup ? 'Edit Grup Paket' : 'Tambah Grup Paket'}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 mt-2">
            <div className="space-y-1.5">
              <Label>Nama Grup</Label>
              <Input value={groupName} onChange={e => setGroupName(e.target.value)} placeholder="Contoh: Jenis Paket, Potongan Ayam" className="h-11" />
            </div>
            <button type="button" onClick={() => setGroupRequired(v => !v)} className={cn('w-full p-3 rounded-lg border text-left text-sm', groupRequired ? 'border-primary bg-primary/5' : 'border-border bg-muted/30')}>
              <span className="font-semibold">{groupRequired ? 'Wajib dipilih' : 'Opsional'}</span>
              <span className="block text-xs text-muted-foreground mt-0.5">Atur apakah kasir harus memilih isi paket dari grup ini.</span>
            </button>
            <div className="space-y-1.5">
              <Label>Mode Harga Grup</Label>
              <Select value={groupPricingMode} onValueChange={(value: 'add' | 'override') => setGroupPricingMode(value)}>
                <SelectTrigger className="h-11">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="add">Tambahkan ke harga produk</SelectItem>
                  <SelectItem value="override">Opsi menentukan harga paket</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-[11px] text-muted-foreground">
                Gunakan <strong>Opsi menentukan harga paket</strong> untuk grup seperti potongan ayam, agar harga pilihan menjadi harga final paket dan tidak ditambah ke harga dasar produk.
              </p>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Minimal Pilihan</Label>
                <Input type="number" value={groupMin} onChange={e => setGroupMin(e.target.value)} className="h-11" />
              </div>
              <div className="space-y-1.5">
                <Label>Maksimal Pilihan</Label>
                <Input type="number" value={groupMax} onChange={e => setGroupMax(e.target.value)} className="h-11" />
              </div>
            </div>
            <Button className="w-full h-11" onClick={saveOptionGroup} disabled={!groupName.trim()}>
              Simpan Grup
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Option Dialog */}
      <Dialog open={optionDialog} onOpenChange={setOptionDialog}>
        <DialogContent className="max-w-[95vw] rounded-xl">
          <DialogHeader>
            <DialogTitle>{editingOption ? 'Edit Isi Paket' : 'Tambah Isi Paket'}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 mt-2">
            <div className="space-y-1.5">
              <Label>Nama Opsi</Label>
              <Input value={optionName} onChange={e => setOptionName(e.target.value)} placeholder="Contoh: Paket Nasi, Paha Bawah, Sambal Ijo" className="h-11" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Tambah Harga</Label>
                <Input type="number" value={optionPriceDelta} onChange={e => setOptionPriceDelta(e.target.value)} className="h-11" />
              </div>
              <div className="space-y-1.5">
                <Label>Tambah HPP</Label>
                <Input type="number" value={optionHppDelta} onChange={e => setOptionHppDelta(e.target.value)} className="h-11" />
              </div>
            </div>
            <button type="button" onClick={() => setOptionDefault(v => !v)} className={cn('w-full p-3 rounded-lg border text-left text-sm', optionDefault ? 'border-primary bg-primary/5' : 'border-border bg-muted/30')}>
              <span className="font-semibold">Jadikan default</span>
              <span className="block text-xs text-muted-foreground mt-0.5">Opsi ini otomatis terpilih saat kasir membuka paket.</span>
            </button>
            <Button className="w-full h-11" onClick={saveOption} disabled={!optionName.trim()}>
              Simpan Opsi
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Option Recipe Dialog */}
      <Dialog open={recipeDialog} onOpenChange={setRecipeDialog}>
        <DialogContent className="max-w-[95vw] rounded-xl">
          <DialogHeader>
            <DialogTitle>Link Stok untuk Opsi</DialogTitle>
          </DialogHeader>
          {recipeOption && (
            <div className="space-y-4 mt-2">
              <div className="p-3 bg-muted/40 rounded-lg">
                <p className="text-xs text-muted-foreground">Opsi</p>
                <p className="text-sm font-semibold">{recipeOption.name}</p>
                <p className="text-[11px] text-muted-foreground mt-1">
                  Tambahkan bahan gudang yang harus berkurang saat opsi ini dipilih kasir.
                </p>
              </div>
              <div className="grid grid-cols-[1fr_90px] gap-2">
                <Select value={recipeWarehouseItemId} onValueChange={setRecipeWarehouseItemId}>
                  <SelectTrigger className="h-11"><SelectValue placeholder="Pilih bahan" /></SelectTrigger>
                  <SelectContent>
                    {visibleWarehouseItems?.map(item => (
                      <SelectItem key={item.id} value={item.id!.toString()}>{item.name} ({item.unit})</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Input type="number" value={recipeQty} onChange={e => setRecipeQty(e.target.value)} className="h-11" />
              </div>
              <Button variant="outline" className="w-full h-10 gap-1.5" onClick={saveOptionRecipe} disabled={!recipeWarehouseItemId}>
                <Layers className="w-4 h-4" />
                Tambah Bahan
              </Button>
              <div className="space-y-2">
                {getOptionRecipes(recipeOption.id).map(recipe => (
                  <div key={recipe.id} className="flex items-center justify-between p-2.5 rounded-lg bg-muted/40 text-xs">
                    <span>{getWarehouseName(recipe.warehouseItemId)}</span>
                    <div className="flex items-center gap-2">
                      <span className="font-semibold">-{recipe.quantity}</span>
                      <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive" onClick={() => deleteOptionRecipe(recipe.id)}>
                        <Trash2 className="w-3.5 h-3.5" />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation */}
      <AlertDialog open={!!deleteId} onOpenChange={() => setDeleteId(null)}>
        <AlertDialogContent className="max-w-[90vw] rounded-xl">
          <AlertDialogHeader>
            <AlertDialogTitle>Hapus Produk?</AlertDialogTitle>
            <AlertDialogDescription>Produk yang dihapus tidak bisa dikembalikan.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Batal</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete} className="bg-destructive text-destructive-foreground">Hapus</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <AlertDialog open={!!groupDeleteTarget} onOpenChange={(open) => { if (!open) setGroupDeleteTarget(null); }}>
        <AlertDialogContent className="max-w-[90vw] rounded-xl">
          <AlertDialogHeader>
            <AlertDialogTitle>Hapus Grup Opsi?</AlertDialogTitle>
            <AlertDialogDescription>
              Grup opsi "{groupDeleteTarget?.name}" akan disembunyikan beserta semua opsi di dalamnya.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Batal</AlertDialogCancel>
            <AlertDialogAction onClick={confirmDeleteOptionGroup} className="bg-destructive text-destructive-foreground">
              Hapus Grup
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <AlertDialog open={!!optionDeleteTarget} onOpenChange={(open) => { if (!open) setOptionDeleteTarget(null); }}>
        <AlertDialogContent className="max-w-[90vw] rounded-xl">
          <AlertDialogHeader>
            <AlertDialogTitle>Hapus Opsi?</AlertDialogTitle>
            <AlertDialogDescription>
              Opsi "{optionDeleteTarget?.name}" akan dihapus dari grup paket ini.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Batal</AlertDialogCancel>
            <AlertDialogAction onClick={confirmDeleteOption} className="bg-destructive text-destructive-foreground">
              Hapus Opsi
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
