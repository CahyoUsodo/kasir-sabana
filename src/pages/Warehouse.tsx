import { useLiveQuery } from 'dexie-react-hooks';
import { db, type WarehouseItem, type Product } from '@/lib/db';
import { useState, useEffect, useRef } from 'react';
import { 
  Warehouse, Plus, Trash2, Edit2, ChevronLeft, ArrowRight,
  TrendingDown, Check, Scale, X, Layers, AlertCircle, ShoppingBag,
  Camera, Minus
} from 'lucide-react';
import { Link } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { 
  Select, 
  SelectContent, 
  SelectItem, 
  SelectTrigger, 
  SelectValue 
} from '@/components/ui/select';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { toast } from 'sonner';
import { compressImage } from '@/lib/image-utils';

export default function WarehousePage() {
  const warehouseItems = useLiveQuery(() => 
    db.warehouseItems.where('isDeleted').equals(0).toArray()
  );
  
  const cashierProducts = useLiveQuery(() => 
    db.products.where('isDeleted').equals(0).toArray()
  );

  const recipes = useLiveQuery(() => 
    db.productRecipes.toArray()
  );

  // Daily Reset check (can be chicken or custom opening preps)
  const chickenItems = useLiveQuery(() => 
    db.warehouseItems.where('isDailyReset').equals(1).toArray()
  );

  // States
  const [activeTab, setActiveTab] = useState<'stok' | 'resep' | 'daily'>('stok');
  
  // Item Dialog states
  const [itemDialog, setItemDialog] = useState(false);
  const [itemName, setItemName] = useState('');
  const [itemStock, setItemStock] = useState('0');
  const [itemUnit, setItemUnit] = useState('pcs');
  const [isCashierVisible, setIsCashierVisible] = useState(false);
  const [itemPrice, setItemPrice] = useState('0');
  const [isDailyReset, setIsDailyReset] = useState(false);
  const [dailyPrepFactor, setDailyPrepFactor] = useState('1');
  const [photo, setPhoto] = useState<string | undefined>(undefined);
  const [itemEditId, setItemEditId] = useState<number | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);

  // Recipe Dialog states
  const [recipeDialog, setRecipeDialog] = useState(false);
  const [selectedProductId, setSelectedProductId] = useState<string>('');
  const [selectedWarehouseItemId, setSelectedWarehouseItemId] = useState<string>('');
  const [recipeQty, setRecipeQty] = useState('1');

  // Daily Prep states
  const [prepDialog, setPrepDialog] = useState(false);
  const [prepCount, setPrepCount] = useState('1');
  const [prepItemId, setPrepItemId] = useState<number | null>(null);

  // Photo change handler
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
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  // Handle Item Save
  const saveItem = async () => {
    if (!itemName.trim()) return;
    const now = new Date();
    const parsedStock = parseFloat(itemStock) || 0;
    const parsedPrice = parseFloat(itemPrice) || 0;
    const parsedFactor = parseFloat(dailyPrepFactor) || 1;

    try {
      if (itemEditId) {
        await db.warehouseItems.update(itemEditId, {
          name: itemName.trim(),
          stock: parsedStock,
          unit: itemUnit,
          isCashierVisible: isCashierVisible ? 1 : 0,
          price: parsedPrice,
          isDailyReset: isDailyReset ? 1 : 0,
          dailyPrepFactor: parsedFactor,
          photo: photo,
          updatedAt: now
        });
        toast.success('Stok barang berhasil diperbarui');
      } else {
        await db.warehouseItems.add({
          name: itemName.trim(),
          stock: parsedStock,
          unit: itemUnit,
          isCashierVisible: isCashierVisible ? 1 : 0,
          price: parsedPrice,
          isDailyReset: isDailyReset ? 1 : 0,
          dailyPrepFactor: parsedFactor,
          photo: photo,
          lastPreparedDate: '',
          dailyPrepQty: 0,
          isDeleted: 0,
          createdAt: now,
          updatedAt: now
        });
        toast.success('Stok barang baru ditambahkan');
      }
      setItemDialog(false);
      resetItemForm();
    } catch (err) {
      console.error(err);
      toast.error('Gagal menyimpan barang gudang');
    }
  };

  const openItemAdd = () => {
    setItemEditId(null);
    resetItemForm();
    setItemDialog(true);
  };

  const openItemEdit = (item: WarehouseItem) => {
    setItemEditId(item.id!);
    setItemName(item.name);
    setItemStock(item.stock.toString());
    setItemUnit(item.unit);
    setIsCashierVisible(item.isCashierVisible === 1);
    setItemPrice((item.price || 0).toString());
    setIsDailyReset(item.isDailyReset === 1);
    setDailyPrepFactor((item.dailyPrepFactor || 1).toString());
    setPhoto(item.photo);
    setItemDialog(true);
  };

  const deleteItem = async (id: number) => {
    if (!confirm('Apakah Anda yakin ingin menghapus barang ini dari gudang? Resep yang terhubung dengannya akan tetap ada namun tidak berfungsi.')) return;
    try {
      await db.warehouseItems.update(id, { isDeleted: 1, updatedAt: new Date() });
      // Clean up recipes with this item
      await db.productRecipes.where('warehouseItemId').equals(id).delete();
      toast.success('Barang gudang berhasil dihapus');
    } catch (err) {
      console.error(err);
      toast.error('Gagal menghapus barang');
    }
  };

  const resetItemForm = () => {
    setItemName('');
    setItemStock('0');
    setItemUnit('pcs');
    setIsCashierVisible(false);
    setItemPrice('0');
    setIsDailyReset(false);
    setDailyPrepFactor('1');
    setPhoto(undefined);
  };

  // Recipe logic
  const saveRecipeLink = async () => {
    if (!selectedProductId || !selectedWarehouseItemId) return;
    const qty = parseFloat(recipeQty) || 1;
    
    try {
      // Check if link already exists
      const existing = await db.productRecipes
        .where('[productId+warehouseItemId]')
        .equals([parseInt(selectedProductId), parseInt(selectedWarehouseItemId)])
        .first();

      if (existing) {
        await db.productRecipes.update(existing.id!, { quantity: qty });
        toast.success('Jumlah bahan resep diperbarui');
      } else {
        await db.productRecipes.add({
          productId: parseInt(selectedProductId),
          warehouseItemId: parseInt(selectedWarehouseItemId),
          quantity: qty
        });
        toast.success('Bahan resep berhasil dihubungkan ke produk');
      }
      setRecipeDialog(false);
      setSelectedWarehouseItemId('');
      setRecipeQty('1');
    } catch (err) {
      // Fallback if composite index isn't fully ready in v8
      try {
        const all = await db.productRecipes
          .where('productId')
          .equals(parseInt(selectedProductId))
          .toArray();
        const dup = all.find(r => r.warehouseItemId === parseInt(selectedWarehouseItemId));
        if (dup) {
          await db.productRecipes.update(dup.id!, { quantity: qty });
          toast.success('Jumlah bahan resep diperbarui');
        } else {
          await db.productRecipes.add({
            productId: parseInt(selectedProductId),
            warehouseItemId: parseInt(selectedWarehouseItemId),
            quantity: qty
          });
          toast.success('Bahan resep berhasil dihubungkan ke produk');
        }
        setRecipeDialog(false);
        setSelectedWarehouseItemId('');
        setRecipeQty('1');
      } catch (nestedErr) {
        console.error(nestedErr);
        toast.error('Gagal menghubungkan resep');
      }
    }
  };

  const deleteRecipeLink = async (id: number) => {
    try {
      await db.productRecipes.delete(id);
      toast.success('Bahan resep dilepas dari produk');
    } catch (err) {
      console.error(err);
      toast.error('Gagal melepaskan bahan resep');
    }
  };

  // Formula Edit states
  const [formulaDialog, setFormulaDialog] = useState(false);
  const [formulaPrepItem, setFormulaPrepItem] = useState<WarehouseItem | null>(null);
  const [newFormulaTargetId, setNewFormulaTargetId] = useState<string>('');
  const [newFormulaFactor, setNewFormulaFactor] = useState('1');

  // Load all prep formulas
  const formulas = useLiveQuery(() => db.dailyPrepFormulas.toArray());

  // Add item to formula
  const addFormulaItem = async () => {
    if (!formulaPrepItem || !newFormulaTargetId) return;
    const factor = parseFloat(newFormulaFactor) || 1;
    try {
      await db.dailyPrepFormulas.add({
        prepItemId: formulaPrepItem.id!,
        targetItemId: parseInt(newFormulaTargetId),
        factor: factor
      });
      setNewFormulaTargetId('');
      setNewFormulaFactor('1');
      toast.success('Bahan berhasil ditambahkan ke rumus');
    } catch (err) {
      console.error(err);
      toast.error('Gagal menambahkan bahan ke rumus');
    }
  };

  // Delete item from formula
  const deleteFormulaItem = async (id: number) => {
    try {
      await db.dailyPrepFormulas.delete(id);
      toast.success('Bahan dihapus dari rumus');
    } catch (err) {
      console.error(err);
      toast.error('Gagal menghapus bahan dari rumus');
    }
  };

  // Update formula multiplier factor
  const updateFormulaFactor = async (id: number, factorStr: string) => {
    const factor = parseFloat(factorStr) || 0;
    try {
      await db.dailyPrepFormulas.update(id, { factor });
    } catch (err) {
      console.error(err);
    }
  };

  // Unified Prep Adjustment (Handles delta increment/decrement)
  const handlePrepAdjustment = async (prepItemId: number, delta: number) => {
    const todayStr = new Date().toLocaleDateString('en-CA');
    const prepItem = await db.warehouseItems.get(prepItemId);
    if (!prepItem) return;

    const isNewDay = prepItem.lastPreparedDate !== todayStr;
    const currentPrep = isNewDay ? 0 : (prepItem.dailyPrepQty || 0);
    const newPrep = currentPrep + delta;

    if (newPrep < 0) {
      toast.error('Jumlah persiapan tidak bisa kurang dari 0');
      return;
    }

    try {
      // Find formula targets
      const itemFormulas = formulas?.filter(f => f.prepItemId === prepItemId) || [];

      if (itemFormulas.length > 0) {
        // 1. Update prepItem dailyPrepQty and decrement its stock by delta
        const newPrepItemStock = Math.max(0, prepItem.stock - delta);
        await db.warehouseItems.update(prepItemId, {
          stock: newPrepItemStock,
          dailyPrepQty: newPrep,
          lastPreparedDate: todayStr,
          updatedAt: new Date()
        });

        // 2. Update target items
        for (const f of itemFormulas) {
          const targetItem = await db.warehouseItems.get(f.targetItemId);
          if (targetItem) {
            const isTargetNewDay = targetItem.lastPreparedDate !== todayStr;
            let newTargetStock = targetItem.stock + (delta * f.factor);
            let newTargetPrepQty = (targetItem.dailyPrepQty || 0) + (delta * f.factor);

            if (isTargetNewDay) {
              newTargetStock = newPrep * f.factor;
              newTargetPrepQty = newPrep * f.factor;
            } else {
              newTargetStock = Math.max(0, newTargetStock);
              newTargetPrepQty = Math.max(0, newTargetPrepQty);
            }

            await db.warehouseItems.update(f.targetItemId, {
              stock: newTargetStock,
              dailyPrepQty: newTargetPrepQty,
              lastPreparedDate: todayStr,
              updatedAt: new Date()
            });
          }
        }
      } else {
        // Simple prep item (like Es Batu) with no target items - adds to itself
        const factor = prepItem.dailyPrepFactor || 1;
        let newStock = prepItem.stock + (delta * factor);
        if (isNewDay) {
          newStock = Math.max(0, delta * factor);
        } else {
          newStock = Math.max(0, newStock);
        }

        await db.warehouseItems.update(prepItemId, {
          stock: newStock,
          dailyPrepQty: newPrep,
          lastPreparedDate: todayStr,
          updatedAt: new Date()
        });
      }
      toast.success(`Berhasil memperbarui persiapan ${prepItem.name}`);
    } catch (err) {
      console.error(err);
      toast.error('Gagal memperbarui persiapan');
    }
  };

  // Process Daily Prep from set quantity dialog
  const processDailyPrep = async () => {
    if (!prepItemId) return;
    const counts = parseInt(prepCount) || 0;
    
    try {
      const todayStr = new Date().toLocaleDateString('en-CA');
      const prepItem = await db.warehouseItems.get(prepItemId);
      if (prepItem) {
        const isNewDay = prepItem.lastPreparedDate !== todayStr;
        const currentPrep = isNewDay ? 0 : (prepItem.dailyPrepQty || 0);
        const delta = counts - currentPrep;
        
        await handlePrepAdjustment(prepItemId, delta);
      }
      setPrepDialog(false);
    } catch (err) {
      console.error(err);
      toast.error('Gagal memproses persiapan harian');
    }
  };

  const todayStr = new Date().toLocaleDateString('en-CA');
  
  // Calculate target item IDs from formulas to filter main list
  const targetItemIds = new Set(formulas?.map(f => f.targetItemId) || []);

  // Main prep items are those marked with isDailyReset === 1 and NOT a target of any formula
  const mainPrepItems = warehouseItems?.filter(item => 
    item.isDailyReset === 1 && !targetItemIds.has(item.id!)
  ) || [];

  const needsPrep = mainPrepItems.some(item => item.lastPreparedDate !== todayStr);

  const prepItemName = prepItemId ? warehouseItems?.find(wi => wi.id === prepItemId)?.name : '';
  const prepItemUnit = prepItemId ? warehouseItems?.find(wi => wi.id === prepItemId)?.unit : '';
  const prepItemFactor = prepItemId ? (warehouseItems?.find(wi => wi.id === prepItemId)?.dailyPrepFactor || 1) : 1;

  // Render main body
  return (
    <div className="px-4 pt-6 pb-24 space-y-5">
      <div className="flex items-center gap-3">
        <Link to="/settings" className="p-1.5 rounded-lg bg-muted text-muted-foreground hover:bg-muted/80">
          <ChevronLeft className="w-5 h-5" />
        </Link>
        <div>
          <h1 className="text-xl font-bold flex items-center gap-2">
            <Warehouse className="w-5 h-5 text-primary" />
            Stok Gudang & Resep
          </h1>
          <p className="text-xs text-muted-foreground">Kelola stok bahan baku gudang dan resep produk kasir</p>
        </div>
      </div>

      {needsPrep && (
        <Card className="border-warning/30 bg-warning/5 shadow-none">
          <CardContent className="p-4 flex items-start gap-3">
            <AlertCircle className="w-5 h-5 text-warning shrink-0 mt-0.5" />
            <div className="flex-1 space-y-1">
              <p className="text-sm font-semibold text-warning-foreground">Persiapan Hari Ini Belum Lengkap</p>
              <p className="text-xs text-muted-foreground leading-relaxed">
                Beberapa stok persiapan harian belum dimasukkan untuk hari ini. Pastikan untuk melakukan persiapan opening toko.
              </p>
              <div className="flex gap-2 mt-2">
                <Button size="sm" className="text-xs bg-warning text-warning-foreground hover:bg-warning/95" onClick={() => { setPrepItemId(null); setPrepCount('1'); setPrepDialog(true); }}>
                  Persiapan Ayam Potong 9
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as any)} className="w-full">
        <TabsList className="grid grid-cols-3 w-full max-w-md h-10 p-1 bg-muted rounded-xl">
          <TabsTrigger value="stok" className="rounded-lg text-xs font-semibold">Stok Barang</TabsTrigger>
          <TabsTrigger value="resep" className="rounded-lg text-xs font-semibold">Resep Produk</TabsTrigger>
          <TabsTrigger value="daily" className="rounded-lg text-xs font-semibold">Persiapan Harian</TabsTrigger>
        </TabsList>

        {/* Tab 1: Stok Barang */}
        <TabsContent value="stok" className="mt-4 space-y-4">
          <div className="flex justify-between items-center">
            <h3 className="text-sm font-bold text-muted-foreground">Daftar Bahan Baku</h3>
            <Button size="sm" className="h-9 text-xs font-semibold gap-1.5" onClick={openItemAdd}>
              <Plus className="w-4 h-4" /> Tambah Barang
            </Button>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            {warehouseItems?.map(item => (
              <Card key={item.id} className="border-0 shadow-sm overflow-hidden">
                <CardContent className="p-4 flex items-center justify-between">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="w-12 h-12 rounded-lg bg-muted border flex items-center justify-center overflow-hidden shrink-0">
                      {item.photo ? (
                        <img src={item.photo} alt={item.name} className="w-full h-full object-cover" />
                      ) : (
                        <Warehouse className="w-5 h-5 text-muted-foreground" />
                      )}
                    </div>
                    <div className="space-y-1 min-w-0">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <p className="text-sm font-semibold truncate">{item.name}</p>
                        {item.isDailyReset === 1 && (
                          <Badge className="text-[9px] h-4 bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400 border-0">Harian</Badge>
                        )}
                        {item.isCashierVisible === 1 && (
                          <Badge className="text-[9px] h-4 bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400 border-0">Kasir</Badge>
                        )}
                      </div>
                      <div className="flex items-center gap-1 text-xs text-muted-foreground">
                        <span>Stok:</span>
                        <span className="font-bold text-foreground">{item.stock} {item.unit}</span>
                        {item.isCashierVisible === 1 && item.price && (
                          <>
                            <span className="mx-1">•</span>
                            <span>Harga:</span>
                            <span className="font-semibold text-foreground">Rp {item.price.toLocaleString('id-ID')}</span>
                          </>
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-1 shrink-0 ml-3">
                    <Button variant="ghost" size="icon" className="w-8 h-8 text-muted-foreground hover:text-foreground" onClick={() => openItemEdit(item)}>
                      <Edit2 className="w-3.5 h-3.5" />
                    </Button>
                    <Button variant="ghost" size="icon" className="w-8 h-8 text-destructive hover:text-destructive/80" onClick={() => deleteItem(item.id!)}>
                      <Trash2 className="w-3.5 h-3.5" />
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))}

            {warehouseItems?.length === 0 && (
              <div className="col-span-full py-8 text-center text-xs text-muted-foreground">
                Gudang Anda kosong. Tambahkan bahan baku baru.
              </div>
            )}
          </div>
        </TabsContent>

        {/* Tab 2: Resep Produk */}
        <TabsContent value="resep" className="mt-4 space-y-4">
          <div className="flex justify-between items-center">
            <div>
              <h3 className="text-sm font-bold text-muted-foreground">Hubungkan Resep</h3>
              <p className="text-[11px] text-muted-foreground leading-tight mt-0.5">Tentukan bahan baku gudang yang akan berkurang otomatis ketika produk kasir terjual</p>
            </div>
            <Button size="sm" className="h-9 text-xs font-semibold gap-1.5" onClick={() => setRecipeDialog(true)}>
              <Plus className="w-4 h-4" /> Hubungkan Produk
            </Button>
          </div>

          <div className="space-y-4">
            {cashierProducts?.map(prod => {
              const prodRecipes = recipes?.filter(r => r.productId === prod.id) || [];
              if (prodRecipes.length === 0) return null;

              return (
                <Card key={prod.id} className="border-0 shadow-sm">
                  <CardHeader className="p-4 pb-2">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <ShoppingBag className="w-4 h-4 text-primary" />
                        <CardTitle className="text-sm font-bold">{prod.name}</CardTitle>
                      </div>
                      <span className="text-[10px] text-muted-foreground font-mono">SKU: {prod.sku}</span>
                    </div>
                  </CardHeader>
                  <CardContent className="p-4 pt-0">
                    <div className="divide-y divide-border">
                      {prodRecipes.map(r => {
                        const warehouseItem = warehouseItems?.find(wi => wi.id === r.warehouseItemId);
                        return (
                          <div key={r.id} className="flex items-center justify-between py-2.5 text-xs first:pt-1 last:pb-1">
                            <div className="flex items-center gap-2">
                              <ArrowRight className="w-3.5 h-3.5 text-muted-foreground" />
                              <span className="font-medium">{warehouseItem ? warehouseItem.name : `Bahan #${r.warehouseItemId}`}</span>
                            </div>
                            <div className="flex items-center gap-3">
                              <span className="font-semibold text-muted-foreground">
                                Mengurangi {r.quantity} {warehouseItem?.unit || 'pcs'}
                              </span>
                              <Button variant="ghost" size="icon" className="w-7 h-7 text-destructive hover:bg-destructive/10" onClick={() => deleteRecipeLink(r.id!)}>
                                <Trash2 className="w-3 h-3" />
                              </Button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </CardContent>
                </Card>
              );
            })}

            {(!recipes || recipes.length === 0) && (
              <div className="py-8 text-center text-xs text-muted-foreground">
                Belum ada produk yang dihubungkan dengan resep stok gudang.
              </div>
            )}
          </div>
        </TabsContent>        {/* Tab 3: Persiapan Harian */}
        <TabsContent value="daily" className="mt-4 space-y-4">
          <div className="bg-white dark:bg-card p-4 rounded-xl shadow-sm border border-muted/40 space-y-1">
            <h3 className="text-xs font-semibold text-foreground flex items-center gap-1.5">
              <Scale className="w-4 h-4 text-primary" />
              Persiapan Harian Mandiri
            </h3>
            <p className="text-[11px] text-muted-foreground">
              Daftar barang gudang custom yang perlu dipersiapkan saat opening toko.
            </p>
          </div>
          <div className="space-y-4">
            {mainPrepItems.map(item => {
              const prepQty = item.lastPreparedDate === todayStr ? (item.dailyPrepQty || 0) : 0;
              const itemFormulas = formulas?.filter(f => f.prepItemId === item.id) || [];

              return (
                <Card key={item.id} className="border-0 shadow-sm overflow-hidden">
                  <CardHeader className="p-4 pb-3">
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-lg bg-muted border flex items-center justify-center overflow-hidden shrink-0">
                          {item.photo ? (
                            <img src={item.photo} alt={item.name} className="w-full h-full object-cover" />
                          ) : (
                            <Layers className="w-5 h-5 text-primary" />
                          )}
                        </div>
                        <div>
                          <CardTitle className="text-sm font-bold">{item.name}</CardTitle>
                          <CardDescription className="text-xs">
                            Sisa Stok Bahan: <strong className="text-foreground">{item.stock} {item.unit}</strong>
                          </CardDescription>
                        </div>
                      </div>
                      <div className="flex gap-1">
                        <Button 
                          variant="outline" 
                          size="sm" 
                          className="h-8 text-xs font-semibold gap-1"
                          onClick={() => {
                            setFormulaPrepItem(item);
                            setFormulaDialog(true);
                          }}
                        >
                          <Edit2 className="w-3 h-3" /> Edit Rumus
                        </Button>
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent className="p-4 pt-0 space-y-4">
                    <div className="flex items-center justify-between p-3 bg-muted/40 rounded-xl">
                      <div className="space-y-0.5">
                        <span className="text-[10px] text-muted-foreground uppercase tracking-wider font-semibold">Total Dipersiapkan</span>
                        <p className="text-lg font-bold">{prepQty} Kali</p>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <Button 
                          variant="outline" 
                          size="icon" 
                          onClick={() => handlePrepAdjustment(item.id!, -1)}
                          className="w-9 h-9"
                          disabled={prepQty <= 0}
                        >
                          <Minus className="w-4 h-4" />
                        </Button>
                        <Button 
                          variant="outline" 
                          size="icon" 
                          onClick={() => handlePrepAdjustment(item.id!, 1)}
                          className="w-9 h-9"
                        >
                          <Plus className="w-4 h-4" />
                        </Button>
                        <Button 
                          variant="ghost"
                          size="sm" 
                          onClick={() => { 
                            setPrepItemId(item.id!); 
                            setPrepCount(prepQty.toString()); 
                            setPrepDialog(true); 
                          }}
                          className="text-xs h-9 px-2.5 hover:bg-muted"
                        >
                          Set Qty
                        </Button>
                      </div>
                    </div>

                    <div className="space-y-1.5">
                      <span className="text-[10px] text-muted-foreground uppercase tracking-wider font-semibold">Hasil Output Persiapan:</span>
                      {itemFormulas.length > 0 ? (
                        <div className="grid grid-cols-2 gap-2">
                          {itemFormulas.map(f => {
                            const targetItem = warehouseItems?.find(wi => wi.id === f.targetItemId);
                            return (
                              <div key={f.id} className="p-2.5 bg-muted/20 border rounded-lg flex flex-col justify-between">
                                <span className="text-[11px] font-semibold text-muted-foreground truncate">{targetItem?.name || `Bahan #${f.targetItemId}`}</span>
                                <div className="flex justify-between items-baseline mt-1">
                                  <span className="text-xs font-bold">{targetItem?.stock || 0} {targetItem?.unit || 'pcs'}</span>
                                  <Badge className="text-[9px] bg-primary/10 text-primary hover:bg-primary/20 border-0">
                                    +{prepQty * f.factor} ({f.factor}x)
                                  </Badge>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      ) : (
                        <div className="p-3 bg-muted/20 border rounded-lg flex justify-between items-center text-xs text-muted-foreground">
                          <span>Menambahkan stok ke diri sendiri</span>
                          <span className="font-semibold text-foreground">+{prepQty * (item.dailyPrepFactor || 1)} {item.unit}</span>
                        </div>
                      )}
                    </div>
                  </CardContent>
                </Card>
              );
            })}

            {mainPrepItems.length === 0 && (
              <div className="py-12 text-center text-xs text-muted-foreground">
                Belum ada bahan baku untuk Persiapan Harian. Edit bahan baku pada tab "Stok Barang" lalu aktifkan switch "Masuk Persiapan Harian?".
              </div>
            )}
          </div>
        </TabsContent>
      </Tabs>

      {/* Item Dialog (Add/Edit Warehouse Item) */}
      <Dialog open={itemDialog} onOpenChange={setItemDialog}>
        <DialogContent className="max-w-[95vw] rounded-xl sm:max-w-[425px]">
          <DialogHeader>
            <DialogTitle>{itemEditId ? 'Edit' : 'Tambah'} Barang Gudang</DialogTitle>
            <DialogDescription className="text-xs">
              Buat atau perbarui barang/bahan baku untuk stok di gudang.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 mt-2 max-h-[75vh] overflow-y-auto pr-1">
            {/* Foto Barang */}
            <div className="flex flex-col items-center gap-2 pb-2">
              <Label className="text-xs font-semibold self-start">Foto Barang</Label>
              <div className="relative w-24 h-24 rounded-lg bg-muted border flex items-center justify-center overflow-hidden">
                {photo ? (
                  <>
                    <img src={photo} alt="Preview" className="w-full h-full object-cover" />
                    <button 
                      type="button" 
                      onClick={() => setPhoto(undefined)}
                      className="absolute top-1 right-1 p-1 bg-destructive text-destructive-foreground rounded-full hover:bg-destructive/90"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </>
                ) : (
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className="flex flex-col items-center gap-1 text-muted-foreground hover:text-foreground w-full h-full justify-center"
                  >
                    <Camera className="w-6 h-6" />
                    <span className="text-[10px]">Pilih Foto</span>
                  </button>
                )}
              </div>
              <input 
                type="file" 
                ref={fileInputRef} 
                onChange={handlePhotoSelect} 
                accept="image/*" 
                className="hidden" 
              />
            </div>

            <div className="space-y-1.5">
              <Label>Nama Barang</Label>
              <Input value={itemName} onChange={e => setItemName(e.target.value)} placeholder="Contoh: Plastik Kecil, Dada Ayam" className="h-11" />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Stok</Label>
                <Input type="number" value={itemStock} onChange={e => setItemStock(e.target.value)} className="h-11" />
              </div>
              <div className="space-y-1.5">
                <Label>Satuan</Label>
                <Input value={itemUnit} onChange={e => setItemUnit(e.target.value)} placeholder="pcs, gram, dll" className="h-11" />
              </div>
            </div>

            <div className="flex items-center justify-between p-3 bg-muted/30 rounded-xl">
              <div className="space-y-0.5">
                <Label className="text-xs font-semibold">Tampilkan di Kasir sebagai Pilihan?</Label>
                <p className="text-[10px] text-muted-foreground">Aktifkan untuk item plastik/kemasan yang dapat dipilih secara manual saat checkout.</p>
              </div>
              <Switch checked={isCashierVisible} onCheckedChange={setIsCashierVisible} />
            </div>

            {isCashierVisible && (
              <div className="space-y-1.5 animate-in fade-in slide-in-from-top-1 duration-200">
                <Label>Harga Tambahan di Kasir (Rp)</Label>
                <Input type="number" value={itemPrice} onChange={e => setItemPrice(e.target.value)} className="h-11" />
              </div>
            )}

            <div className="flex items-center justify-between p-3 bg-muted/30 rounded-xl">
              <div className="space-y-0.5">
                <Label className="text-xs font-semibold">Masuk Persiapan Harian?</Label>
                <p className="text-[10px] text-muted-foreground">Aktifkan untuk item yang perlu dipersiapkan/di-input jumlah persiapannya saat opening toko.</p>
              </div>
              <Switch checked={isDailyReset} onCheckedChange={setIsDailyReset} />
            </div>

            {isDailyReset && (
              <div className="space-y-1.5 animate-in fade-in slide-in-from-top-1 duration-200">
                <Label>Faktor Persiapan (Pengali Stok per 1 Unit Persiapan)</Label>
                <Input type="number" value={dailyPrepFactor} onChange={e => setDailyPrepFactor(e.target.value)} className="h-11" placeholder="Contoh: 1 untuk pcs, 2 untuk paha bawah per ekor" />
              </div>
            )}

            <Button className="w-full h-11 font-semibold" onClick={saveItem} disabled={!itemName.trim()}>
              Simpan Barang
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Recipe Dialog */}
      <Dialog open={recipeDialog} onOpenChange={setRecipeDialog}>
        <DialogContent className="max-w-[95vw] rounded-xl sm:max-w-[425px]">
          <DialogHeader>
            <DialogTitle>Hubungkan Bahan ke Produk</DialogTitle>
            <DialogDescription className="text-xs">
              Buat hubungan pengurangan stok gudang otomatis saat produk kasir terjual.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 mt-2">
            <div className="space-y-1.5">
              <Label>Pilih Produk Kasir</Label>
              <Select value={selectedProductId} onValueChange={setSelectedProductId}>
                <SelectTrigger className="h-11">
                  <SelectValue placeholder="Pilih Produk" />
                </SelectTrigger>
                <SelectContent>
                  {cashierProducts?.map(prod => (
                    <SelectItem key={prod.id} value={prod.id!.toString()}>
                      {prod.name} ({prod.sku})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label>Pilih Barang Gudang</Label>
              <Select value={selectedWarehouseItemId} onValueChange={setSelectedWarehouseItemId}>
                <SelectTrigger className="h-11">
                  <SelectValue placeholder="Pilih Barang Gudang" />
                </SelectTrigger>
                <SelectContent>
                  {warehouseItems?.map(item => (
                    <SelectItem key={item.id} value={item.id!.toString()}>
                      {item.name} ({item.unit})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label>Jumlah Pengurangan</Label>
              <Input type="number" value={recipeQty} onChange={e => setRecipeQty(e.target.value)} className="h-11" />
            </div>

            <Button className="w-full h-11 font-semibold" onClick={saveRecipeLink} disabled={!selectedProductId || !selectedWarehouseItemId}>
              Hubungkan Resep
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Daily Prep Dialog */}
      <Dialog open={prepDialog} onOpenChange={setPrepDialog}>
        <DialogContent className="max-w-[95vw] rounded-xl sm:max-w-[400px]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-1.5">
              <Layers className="w-5 h-5 text-primary" /> 
              Persiapan {prepItemName}
            </DialogTitle>
            <DialogDescription className="text-xs">
              Masukkan berapa unit {prepItemName} yang Anda persiapkan hari ini.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 mt-2">
            <div className="space-y-1.5">
              <Label>Jumlah Unit Persiapan</Label>
              <Input type="number" value={prepCount} onChange={e => setPrepCount(e.target.value)} className="h-11 text-center text-lg font-bold" min={0} />
            </div>

            <div className="text-xs text-muted-foreground p-3 bg-muted rounded-xl space-y-1">
              <span className="font-semibold text-foreground">Hasil Persiapan:</span>
              {(() => {
                const itemFormulas = formulas?.filter(f => f.prepItemId === prepItemId) || [];
                if (itemFormulas.length > 0) {
                  return (
                    <div className="grid grid-cols-2 gap-1 mt-1 text-[11px]">
                      {itemFormulas.map(f => {
                        const targetItem = warehouseItems?.find(wi => wi.id === f.targetItemId);
                        return (
                          <div key={f.id}>{targetItem?.name || `Bahan #${f.targetItemId}`}: {(parseInt(prepCount) || 0) * f.factor} {targetItem?.unit || 'pcs'}</div>
                        );
                      })}
                    </div>
                  );
                } else {
                  return (
                    <div>Total penambahan stok: {(parseInt(prepCount) || 0) * prepItemFactor} {prepItemUnit}</div>
                  );
                }
              })()}
            </div>

            <Button className="w-full h-11 font-semibold" onClick={processDailyPrep} disabled={(parseInt(prepCount) || 0) < 0}>
              Proses Persiapan
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Formula Editor Dialog */}
      <Dialog open={formulaDialog} onOpenChange={setFormulaDialog}>
        <DialogContent className="max-w-[95vw] rounded-xl sm:max-w-[450px]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-1.5">
              <Layers className="w-5 h-5 text-primary" />
              Edit Rumus: {formulaPrepItem?.name}
            </DialogTitle>
            <DialogDescription className="text-xs">
              Tentukan barang apa saja yang bertambah stoknya ketika {formulaPrepItem?.name} dipersiapkan beserta faktor pengalinya.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 mt-2 max-h-[60vh] overflow-y-auto pr-1">
            {/* List of current targets in the formula */}
            <div className="space-y-2">
              <Label className="text-xs font-semibold">Bahan Output Saat Ini</Label>
              <div className="space-y-2">
                {formulas?.filter(f => f.prepItemId === formulaPrepItem?.id).map(f => {
                  const targetItem = warehouseItems?.find(wi => wi.id === f.targetItemId);
                  return (
                    <div key={f.id} className="flex items-center justify-between gap-3 p-2 bg-muted/40 rounded-lg border text-xs">
                      <span className="font-semibold truncate flex-1">{targetItem?.name || `Bahan #${f.targetItemId}`}</span>
                      <div className="flex items-center gap-2 shrink-0">
                        <span className="text-[10px] text-muted-foreground">Faktor:</span>
                        <Input 
                          type="number" 
                          step="any"
                          value={f.factor} 
                          onChange={e => updateFormulaFactor(f.id!, e.target.value)} 
                          className="w-16 h-8 text-center text-xs p-1"
                        />
                        <Button 
                          variant="ghost" 
                          size="icon" 
                          className="w-8 h-8 text-destructive hover:bg-destructive/10" 
                          onClick={() => deleteFormulaItem(f.id!)}
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </Button>
                      </div>
                    </div>
                  );
                })}
                {formulas?.filter(f => f.prepItemId === formulaPrepItem?.id).length === 0 && (
                  <p className="text-xs text-muted-foreground italic text-center py-2">
                    Belum ada rumus bahan output. Stok persiapan akan ditambahkan ke diri sendiri.
                  </p>
                )}
              </div>
            </div>

            {/* Add new target form */}
            <div className="border-t pt-3 space-y-3">
              <Label className="text-xs font-semibold">Tambah Bahan Output</Label>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <span className="text-[10px] text-muted-foreground">Pilih Barang Gudang</span>
                  <Select value={newFormulaTargetId} onValueChange={setNewFormulaTargetId}>
                    <SelectTrigger className="h-10 text-xs">
                      <SelectValue placeholder="Pilih Bahan" />
                    </SelectTrigger>
                    <SelectContent>
                      {warehouseItems
                        ?.filter(wi => wi.id !== formulaPrepItem?.id)
                        .map(item => (
                          <SelectItem key={item.id} value={item.id!.toString()} className="text-xs">
                            {item.name} ({item.unit})
                          </SelectItem>
                        ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <span className="text-[10px] text-muted-foreground">Faktor Pengali</span>
                  <Input 
                    type="number" 
                    step="any"
                    value={newFormulaFactor} 
                    onChange={e => setNewFormulaFactor(e.target.value)} 
                    className="h-10 text-xs"
                  />
                </div>
              </div>
              <Button 
                onClick={addFormulaItem} 
                disabled={!newFormulaTargetId} 
                className="w-full h-10 text-xs font-semibold gap-1.5"
              >
                <Plus className="w-4 h-4" /> Tambah ke Rumus
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>log>
    </div>
  );
}
