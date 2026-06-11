import { useLiveQuery } from 'dexie-react-hooks';
import { db, type WarehouseItem, type Product } from '@/lib/db';
import { useState, useEffect } from 'react';
import { 
  Warehouse, Plus, Trash2, Edit2, ChevronLeft, ArrowRight,
  TrendingDown, Check, Scale, X, Layers, AlertCircle, ShoppingBag
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

  // Daily Reset check
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
  const [itemEditId, setItemEditId] = useState<number | null>(null);

  // Recipe Dialog states
  const [recipeDialog, setRecipeDialog] = useState(false);
  const [selectedProductId, setSelectedProductId] = useState<string>('');
  const [selectedWarehouseItemId, setSelectedWarehouseItemId] = useState<string>('');
  const [recipeQty, setRecipeQty] = useState('1');

  // Daily Prep states
  const [prepDialog, setPrepDialog] = useState(false);
  const [prepCount, setPrepCount] = useState('1');

  // Handle Item Save
  const saveItem = async () => {
    if (!itemName.trim()) return;
    const now = new Date();
    const parsedStock = parseFloat(itemStock) || 0;
    const parsedPrice = parseFloat(itemPrice) || 0;

    try {
      if (itemEditId) {
        await db.warehouseItems.update(itemEditId, {
          name: itemName.trim(),
          stock: parsedStock,
          unit: itemUnit,
          isCashierVisible: isCashierVisible ? 1 : 0,
          price: parsedPrice,
          isDailyReset: isDailyReset ? 1 : 0,
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
          lastPreparedDate: '',
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

  // Daily Prep "Ayam Potong 9"
  const processDailyPrep = async () => {
    const counts = parseInt(prepCount) || 0;
    if (counts <= 0) return;

    // 1 chicken = 2 paha bawah, 2 paha atas, 2 sayap, 3 dada
    const formulas = [
      { name: 'Paha Bawah', factor: 2 },
      { name: 'Paha Atas', factor: 2 },
      { name: 'Sayap', factor: 2 },
      { name: 'Dada', factor: 3 }
    ];

    const todayStr = new Date().toLocaleDateString('en-CA'); // YYYY-MM-DD local format

    try {
      for (const formula of formulas) {
        const item = await db.warehouseItems
          .where('name')
          .equalsIgnoreCase(formula.name)
          .first();

        if (item) {
          const addQty = formula.factor * counts;
          // SOP: ganti hari ganti ayam. If this is the first prep of a new day, we reset stock first.
          let newStock = item.stock + addQty;
          if (item.lastPreparedDate !== todayStr) {
            newStock = addQty; // Reset previous day stock and set to new prep
          }
          await db.warehouseItems.update(item.id!, {
            stock: newStock,
            lastPreparedDate: todayStr,
            updatedAt: new Date()
          });
        }
      }
      toast.success(`Berhasil memproses persiapan ${counts} ekor Ayam Potong 9 untuk hari ini!`);
      setPrepDialog(false);
    } catch (err) {
      console.error(err);
      toast.error('Gagal memproses persiapan ayam harian');
    }
  };

  // Check if chicken needs daily preparation
  const todayStr = new Date().toLocaleDateString('en-CA');
  const needsPrep = chickenItems && chickenItems.length > 0 && chickenItems.some(item => item.lastPreparedDate !== todayStr);

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
              <p className="text-sm font-semibold text-warning-foreground">Persiapan Ayam Hari Ini Belum Diisi</p>
              <p className="text-xs text-muted-foreground leading-relaxed">
                Berdasarkan SOP Sabana Fried Chicken, stok potongan ayam harian harus disiapkan ulang setiap hari. Hari ini Anda belum memasukkan jumlah persiapan Ayam Potong 9.
              </p>
              <Button size="sm" className="mt-2 text-xs bg-warning text-warning-foreground hover:bg-warning/95" onClick={() => setPrepDialog(true)}>
                Input Persiapan Hari Ini
              </Button>
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
                  <div className="space-y-1 min-w-0">
                    <div className="flex items-center gap-1.5">
                      <p className="text-sm font-semibold truncate">{item.name}</p>
                      {item.isDailyReset === 1 && (
                        <Badge className="text-[9px] h-4 bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400 border-0">Ayam Harian</Badge>
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
                          <span>Harga Kasir:</span>
                          <span className="font-semibold text-foreground">Rp {item.price.toLocaleString('id-ID')}</span>
                        </>
                      )}
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
        </TabsContent>

        {/* Tab 3: Persiapan Harian (Ayam) */}
        <TabsContent value="daily" className="mt-4 space-y-4">
          <Card className="border-0 shadow-sm">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm flex items-center gap-1.5"><Layers className="w-4 h-4 text-primary" /> Persiapan Harian Ayam Potong 9</CardTitle>
              <CardDescription className="text-xs">
                Masukkan jumlah ekor Ayam Potong 9 yang dipotong dan disiapkan hari ini.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="bg-primary/5 rounded-xl p-4 space-y-2">
                <p className="text-xs font-bold text-primary flex items-center gap-1"><Scale className="w-3.5 h-3.5" /> Rumus Pemotongan Ayam Potong 9 (Per Ekor):</p>
                <div className="grid grid-cols-2 gap-2 text-xs text-muted-foreground">
                  <div className="flex justify-between border-b pb-1"><span>• Paha Bawah</span> <span className="font-semibold text-foreground">2 pcs</span></div>
                  <div className="flex justify-between border-b pb-1"><span>• Paha Atas</span> <span className="font-semibold text-foreground">2 pcs</span></div>
                  <div className="flex justify-between border-b pb-1"><span>• Sayap</span> <span className="font-semibold text-foreground">2 pcs</span></div>
                  <div className="flex justify-between border-b pb-1"><span>• Dada</span> <span className="font-semibold text-foreground">3 pcs</span></div>
                </div>
              </div>

              <div className="space-y-3">
                <div className="flex justify-between items-center text-xs text-muted-foreground border-b pb-2">
                  <span>Status Hari Ini ({new Date().toLocaleDateString('id-ID')})</span>
                  {needsPrep ? (
                    <Badge variant="destructive" className="text-[10px] h-5">Belum Persiapan</Badge>
                  ) : (
                    <Badge className="text-[10px] h-5 bg-success hover:bg-success/95 text-success-foreground">Sudah Persiapan</Badge>
                  )}
                </div>

                <div className="grid grid-cols-2 gap-3">
                  {chickenItems?.map(item => (
                    <div key={item.id} className="p-3 bg-muted/50 rounded-lg flex flex-col justify-between h-16">
                      <span className="text-xs font-semibold text-muted-foreground">{item.name}</span>
                      <span className="text-sm font-bold">{item.stock} {item.unit}</span>
                    </div>
                  ))}
                </div>

                <Button className="w-full h-11 font-semibold" onClick={() => setPrepDialog(true)}>
                  Mulai Persiapan Ayam Hari Ini
                </Button>
              </div>
            </CardContent>
          </Card>
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
          <div className="space-y-4 mt-2">
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
                <Label className="text-xs font-semibold">Ayam Potong Harian?</Label>
                <p className="text-[10px] text-muted-foreground">Aktifkan untuk potongan ayam (dada, paha, sayap) yang wajib reset setiap ganti hari.</p>
              </div>
              <Switch checked={isDailyReset} onCheckedChange={setIsDailyReset} />
            </div>

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
            <DialogTitle className="flex items-center gap-1.5"><Layers className="w-5 h-5 text-primary" /> Persiapan Ayam Potong 9</DialogTitle>
            <DialogDescription className="text-xs">
              Masukkan berapa ekor Ayam Potong 9 yang Anda siapkan hari ini. Stok potongan ayam akan di-reset (ganti hari) dan diisi ulang sesuai rumus.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 mt-2">
            <div className="space-y-1.5">
              <Label>Jumlah Ekor Ayam</Label>
              <Input type="number" value={prepCount} onChange={e => setPrepCount(e.target.value)} className="h-11 text-center text-lg font-bold" min={1} />
            </div>

            <div className="text-xs text-muted-foreground p-3 bg-muted rounded-xl space-y-1">
              <span className="font-semibold text-foreground">Hasil Potongan Ayam:</span>
              <div className="grid grid-cols-2 gap-1 mt-1 text-[11px]">
                <div>Paha Bawah: {(parseInt(prepCount) || 0) * 2} pcs</div>
                <div>Paha Atas: {(parseInt(prepCount) || 0) * 2} pcs</div>
                <div>Sayap: {(parseInt(prepCount) || 0) * 2} pcs</div>
                <div>Dada: {(parseInt(prepCount) || 0) * 3} pcs</div>
              </div>
            </div>

            <Button className="w-full h-11 font-semibold" onClick={processDailyPrep} disabled={(parseInt(prepCount) || 0) <= 0}>
              Proses Persiapan Ayam
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
