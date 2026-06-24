import { useMemo, useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { format, isSameDay } from 'date-fns';
import { id as localeId } from 'date-fns/locale';
import { Camera, Check, ChevronLeft, ChevronsUpDown, ClipboardList, Loader2, Plus, ScanText, Trash2, Warehouse } from 'lucide-react';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import { createWorker } from 'tesseract.js';
import LockedPage from '@/components/LockedPage';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Command,
  CommandEmpty,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { useAuth } from '@/hooks/use-auth';
import { db, recordWarehouseStockEntry, revertWarehouseStockEntryGroup } from '@/lib/db';
import { compressImage } from '@/lib/image-utils';
import { extractOcrDraftSuggestions, type OcrDraftStatus } from '@/lib/warehouse-ocr';
import { cn } from '@/lib/utils';

type DraftRow = {
  id: string;
  warehouseItemId: string;
  quantity: string;
  source: 'manual' | 'ocr';
  detectedName?: string;
  detectedQuantity?: number;
  detectedUnit?: string;
  originalLine?: string;
  status?: OcrDraftStatus;
  note?: string;
};

type EntryHistoryGroup = {
  entryGroupId: string;
  date: Date;
  createdAt: Date;
  note?: string;
  items: Array<{
    id?: number;
    warehouseItemName: string;
    quantity: number;
    unit: string;
  }>;
};

const createDraftRow = (): DraftRow => ({
  id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
  warehouseItemId: '',
  quantity: '',
  source: 'manual',
});

export default function WarehouseStockEntryPage() {
  const { currentUser, can } = useAuth();
  const todayDate = new Date().toLocaleDateString('en-CA');
  const [entryDate, setEntryDate] = useState(todayDate);
  const [historyDate, setHistoryDate] = useState(todayDate);
  const [batchNote, setBatchNote] = useState('');
  const [draftRows, setDraftRows] = useState<DraftRow[]>([createDraftRow()]);
  const [receiptPhoto, setReceiptPhoto] = useState<string | undefined>(undefined);
  const [saving, setSaving] = useState(false);
  const [ocrLoading, setOcrLoading] = useState(false);
  const [ocrProgress, setOcrProgress] = useState(0);
  const [ocrRawText, setOcrRawText] = useState('');
  const [openRowId, setOpenRowId] = useState<string | null>(null);
  const [deleteGroupTarget, setDeleteGroupTarget] = useState<EntryHistoryGroup | null>(null);
  const [deletingGroupId, setDeletingGroupId] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const warehouseItems = useLiveQuery(() =>
    db.warehouseItems.where('isDeleted').equals(0).toArray()
  );
  const stockEntryLogs = useLiveQuery(() =>
    db.warehouseStockEntryLogs.orderBy('date').reverse().toArray()
  );

  if (!can('manage_stock_inout')) {
    return <LockedPage title="Input Stock Barang" permissionLabel="Kelola Transaksi & Stok" />;
  }

  const sortedWarehouseItems = useMemo(() => {
    return [...(warehouseItems ?? [])].sort((a, b) => a.name.localeCompare(b.name, 'id'));
  }, [warehouseItems]);

  const selectedHistoryStart = useMemo(() => {
    const value = historyDate ? new Date(`${historyDate}T00:00:00`) : new Date();
    value.setHours(0, 0, 0, 0);
    return value;
  }, [historyDate]);

  const selectedHistoryEnd = useMemo(() => {
    const value = historyDate ? new Date(`${historyDate}T23:59:59.999`) : new Date();
    value.setHours(23, 59, 59, 999);
    return value;
  }, [historyDate]);

  const historyGroups = useMemo<EntryHistoryGroup[]>(() => {
    const filteredLogs = (stockEntryLogs ?? []).filter(log => {
      const time = new Date(log.date).getTime();
      return time >= selectedHistoryStart.getTime() && time <= selectedHistoryEnd.getTime();
    });

    const grouped = new Map<string, EntryHistoryGroup>();

    for (const log of filteredLogs) {
      if (!grouped.has(log.entryGroupId)) {
        grouped.set(log.entryGroupId, {
          entryGroupId: log.entryGroupId,
          date: new Date(log.date),
          createdAt: new Date(log.createdAt),
          note: log.note,
          items: [],
        });
      }

      grouped.get(log.entryGroupId)!.items.push({
        id: log.id,
        warehouseItemName: log.warehouseItemName,
        quantity: log.quantity,
        unit: log.unit,
      });
    }

    return [...grouped.values()].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  }, [selectedHistoryEnd, selectedHistoryStart, stockEntryLogs]);

  const totalHistoryQty = useMemo(() => {
    return historyGroups.reduce(
      (sum, group) => sum + group.items.reduce((itemSum, item) => itemSum + item.quantity, 0),
      0
    );
  }, [historyGroups]);

  const validDraftItems = useMemo(() => {
    return draftRows
      .map(row => ({
        warehouseItemId: Number(row.warehouseItemId),
        quantity: Number(row.quantity) || 0,
      }))
      .filter(row => row.warehouseItemId > 0 && row.quantity > 0);
  }, [draftRows]);

  const canSaveDraft = validDraftItems.length > 0 && !!entryDate && !saving;
  const canRunOcr = !!receiptPhoto && !ocrLoading;

  const getWarehouseItemLabel = (warehouseItemId: string) => {
    const item = sortedWarehouseItems.find(entry => entry.id?.toString() === warehouseItemId);
    if (!item) return '';
    return `${item.name} · stok ${item.stock} ${item.unit}`;
  };

  const updateDraftRow = (rowId: string, patch: Partial<DraftRow>) => {
    setDraftRows(current =>
      current.map(row => (row.id === rowId ? { ...row, ...patch } : row))
    );
  };

  const addDraftRow = () => {
    setDraftRows(current => [...current, createDraftRow()]);
  };

  const removeDraftRow = (rowId: string) => {
    setDraftRows(current => {
      if (current.length === 1) {
        return [createDraftRow()];
      }
      return current.filter(row => row.id !== rowId);
    });
  };

  const handleReceiptPhotoSelect = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      toast.error('File harus berupa gambar');
      return;
    }

    try {
      const compressed = await compressImage(file, 1200, 0.8);
      setReceiptPhoto(compressed);
      setOcrRawText('');
      toast.success('Foto struk dimasukkan ke draft');
    } catch (error) {
      console.error(error);
      toast.error('Gagal memproses foto struk');
    }

    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const handleRunOcr = async () => {
    if (!receiptPhoto || ocrLoading) return;

    setOcrLoading(true);
    setOcrProgress(0);

    try {
      const worker = await createWorker('eng', 1, {
        logger: message => {
          if (message.status === 'recognizing text' && typeof message.progress === 'number') {
            setOcrProgress(Math.round(message.progress * 100));
          }
        },
      });

      const result = await worker.recognize(receiptPhoto);
      await worker.terminate();

      const text = result.data.text || '';
      setOcrRawText(text);

      const suggestions = extractOcrDraftSuggestions(
        text,
        (sortedWarehouseItems ?? []).map(item => ({
          id: item.id,
          name: item.name,
          unit: item.unit,
        }))
      );

      if (suggestions.length === 0) {
        toast.error('OCR selesai, tapi belum menemukan baris barang yang cukup jelas');
        return;
      }

      const nextRows: DraftRow[] = suggestions.map(suggestion => ({
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        warehouseItemId: suggestion.status === 'matched' && suggestion.warehouseItemId ? suggestion.warehouseItemId.toString() : '',
        quantity: String(suggestion.detectedQuantity || 1),
        source: 'ocr',
        detectedName: suggestion.detectedName,
        detectedQuantity: suggestion.detectedQuantity,
        detectedUnit: suggestion.detectedUnit,
        originalLine: suggestion.originalLine,
        status: suggestion.status,
        note: suggestion.note,
      }));

      setDraftRows(current => {
        const hasOnlySingleEmptyManualRow =
          current.length === 1 &&
          current[0].source === 'manual' &&
          !current[0].warehouseItemId &&
          !current[0].quantity;

        return hasOnlySingleEmptyManualRow ? nextRows : [...current, ...nextRows];
      });

      const matchedCount = suggestions.filter(item => item.status === 'matched').length;
      const reviewCount = suggestions.filter(item => item.status === 'review').length;
      const unknownCount = suggestions.filter(item => item.status === 'unknown').length;

      toast.success(
        `OCR selesai: ${suggestions.length} baris ditambahkan ke draft (${matchedCount} cocok, ${reviewCount} cek ulang, ${unknownCount} belum dikenal)`
      );
    } catch (error) {
      console.error(error);
      toast.error('Gagal menjalankan OCR. Coba foto yang lebih terang dan lurus.');
    } finally {
      setOcrLoading(false);
      setOcrProgress(0);
    }
  };

  const getStatusBadge = (status?: OcrDraftStatus) => {
    if (status === 'matched') {
      return <Badge className="text-[10px] h-5 bg-emerald-100 text-emerald-700 border-0">Cocok</Badge>;
    }
    if (status === 'review') {
      return <Badge className="text-[10px] h-5 bg-amber-100 text-amber-700 border-0">Perlu dicek</Badge>;
    }
    if (status === 'unknown') {
      return <Badge className="text-[10px] h-5 bg-slate-100 text-slate-700 border-0">Tidak dikenal</Badge>;
    }
    return null;
  };

  const handleSaveDraft = async () => {
    if (!canSaveDraft) return;

    setSaving(true);
    try {
      await recordWarehouseStockEntry({
        items: validDraftItems,
        note: batchNote,
        date: new Date(`${entryDate}T12:00:00`),
        source: 'manual',
        createdBy: currentUser?.id,
      });

      setDraftRows([createDraftRow()]);
      setBatchNote('');
      setReceiptPhoto(undefined);
      setHistoryDate(entryDate);
      toast.success('Stok masuk berhasil disimpan ke gudang');
    } catch (error) {
      console.error(error);
      toast.error(error instanceof Error ? error.message : 'Gagal menyimpan stok masuk');
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteHistoryGroup = async () => {
    if (!deleteGroupTarget || deletingGroupId) return;

    setDeletingGroupId(deleteGroupTarget.entryGroupId);
    try {
      await revertWarehouseStockEntryGroup(deleteGroupTarget.entryGroupId);
      toast.success('Batch stok masuk dihapus dan stok gudang dikembalikan');
      setDeleteGroupTarget(null);
    } catch (error) {
      console.error(error);
      toast.error(error instanceof Error ? error.message : 'Gagal menghapus batch stok masuk');
    } finally {
      setDeletingGroupId(null);
    }
  };

  return (
    <div className="px-4 pt-6 pb-20 space-y-5">
      <div className="flex items-center gap-3">
        <Link to="/warehouse" className="p-1.5 rounded-lg bg-muted text-muted-foreground hover:bg-muted/80">
          <ChevronLeft className="w-5 h-5" />
        </Link>
        <div>
          <h1 className="text-xl font-bold flex items-center gap-2">
            <ClipboardList className="w-5 h-5 text-primary" />
            Input Stock Barang
          </h1>
          <p className="text-xs text-muted-foreground">
            Tambahkan stok gudang secara manual per batch, lalu cek histori inputnya per tanggal.
          </p>
        </div>
      </div>

      <div className="grid gap-4 xl:grid-cols-[1.1fr_0.9fr]">
        <Card className="border-0 shadow-sm overflow-hidden">
          <CardHeader className="p-4 pb-3">
            <CardTitle className="text-sm flex items-center gap-1.5">
              <Warehouse className="w-4 h-4 text-primary" />
              Draft Stok Masuk
            </CardTitle>
            <CardDescription className="text-xs">
              Foto struk masih dipakai sebagai referensi visual dulu. Draft barang tetap bisa Anda atur manual sebelum disimpan.
            </CardDescription>
          </CardHeader>
          <CardContent className="p-4 pt-0 space-y-4">
            <div className="grid gap-3 sm:grid-cols-[180px_1fr]">
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold">Tanggal Barang Datang</Label>
                <Input
                  type="date"
                  value={entryDate}
                  onChange={event => setEntryDate(event.target.value)}
                  className="h-10"
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold">Catatan Batch</Label>
                <Input
                  value={batchNote}
                  onChange={event => setBatchNote(event.target.value)}
                  placeholder="Contoh: belanja pasar pagi, kiriman supplier, koreksi stok"
                  className="h-10"
                />
              </div>
            </div>

            <div className="rounded-xl border bg-muted/20 p-3 space-y-3">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-xs font-semibold">Foto Struk Belanja</p>
                  <p className="text-[11px] text-muted-foreground">
                    Belum dibaca otomatis di fase ini, tapi sudah bisa dipakai sebagai patokan sebelum input stok.
                  </p>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-9 gap-1.5 shrink-0"
                  onClick={() => fileInputRef.current?.click()}
                >
                  <Camera className="w-4 h-4" />
                  Pilih Foto
                </Button>
              </div>

              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-9 gap-1.5"
                  onClick={handleRunOcr}
                  disabled={!canRunOcr}
                >
                  {ocrLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <ScanText className="w-4 h-4" />}
                  {ocrLoading ? `Scan OCR ${ocrProgress}%` : 'Scan ke Draft'}
                </Button>
                <p className="text-[11px] text-muted-foreground">
                  OCR hanya bantu isi draft. Tetap cek ulang sebelum simpan.
                </p>
              </div>

              {receiptPhoto ? (
                <div className="space-y-2">
                  <div className="overflow-hidden rounded-lg border bg-background">
                    <img src={receiptPhoto} alt="Preview struk belanja" className="w-full max-h-64 object-contain bg-white" />
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-8 px-0 text-destructive hover:text-destructive"
                    onClick={() => setReceiptPhoto(undefined)}
                  >
                    Hapus Foto Draft
                  </Button>
                </div>
              ) : null}

              {ocrRawText ? (
                <div className="rounded-lg border bg-background px-3 py-2">
                  <p className="text-[11px] font-semibold text-muted-foreground mb-1">Teks OCR</p>
                  <p className="text-[11px] whitespace-pre-wrap break-words text-muted-foreground max-h-32 overflow-y-auto">
                    {ocrRawText}
                  </p>
                </div>
              ) : null}

              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                onChange={handleReceiptPhotoSelect}
                className="hidden"
              />
            </div>

            <div className="space-y-3">
              {draftRows.map((row, index) => (
                <div key={row.id} className="rounded-xl border bg-background p-3 space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <p className="text-xs font-semibold text-muted-foreground">Baris {index + 1}</p>
                      {row.source === 'ocr' ? getStatusBadge(row.status) : null}
                    </div>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 text-destructive hover:bg-destructive/10"
                      onClick={() => removeDraftRow(row.id)}
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </Button>
                  </div>

                  {row.source === 'ocr' ? (
                    <div className="rounded-lg border bg-muted/10 px-3 py-2 space-y-1">
                      <p className="text-[11px] font-medium break-words">
                        Hasil OCR: {row.detectedName}
                        {row.detectedUnit ? ` · ${row.detectedUnit}` : ''}
                        {row.detectedQuantity ? ` · qty ${row.detectedQuantity}` : ''}
                      </p>
                      {row.originalLine ? (
                        <p className="text-[11px] text-muted-foreground break-words">Baris asli: {row.originalLine}</p>
                      ) : null}
                      {row.note ? (
                        <p className="text-[11px] text-muted-foreground break-words">{row.note}</p>
                      ) : null}
                    </div>
                  ) : null}

                  <div className="grid gap-3 sm:grid-cols-[1fr_140px]">
                    <div className="space-y-1.5">
                      <Label className="text-xs font-semibold">Barang Gudang</Label>
                      <Popover open={openRowId === row.id} onOpenChange={open => setOpenRowId(open ? row.id : null)}>
                        <PopoverTrigger asChild>
                          <Button
                            type="button"
                            variant="outline"
                            role="combobox"
                            aria-expanded={openRowId === row.id}
                            className="h-10 w-full justify-between font-normal"
                          >
                            <span className="truncate">
                              {row.warehouseItemId ? getWarehouseItemLabel(row.warehouseItemId) : 'Pilih barang gudang'}
                            </span>
                            <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                          </Button>
                        </PopoverTrigger>
                        <PopoverContent className="w-[var(--radix-popover-trigger-width)] p-0" align="start">
                          <Command>
                            <CommandInput placeholder="Cari barang gudang..." />
                            <CommandList>
                              <CommandEmpty>Barang tidak ditemukan.</CommandEmpty>
                              {sortedWarehouseItems.map(item => (
                                <CommandItem
                                  key={item.id}
                                  value={`${item.name} stok ${item.stock} ${item.unit}`}
                                  onSelect={() => {
                                    updateDraftRow(row.id, { warehouseItemId: item.id!.toString() });
                                    setOpenRowId(null);
                                  }}
                                >
                                  <Check
                                    className={cn(
                                      'mr-2 h-4 w-4',
                                      row.warehouseItemId === item.id!.toString() ? 'opacity-100' : 'opacity-0'
                                    )}
                                  />
                                  <span className="truncate">{item.name} · stok {item.stock} {item.unit}</span>
                                </CommandItem>
                              ))}
                            </CommandList>
                          </Command>
                        </PopoverContent>
                      </Popover>
                    </div>

                    <div className="space-y-1.5">
                      <Label className="text-xs font-semibold">Jumlah Masuk</Label>
                      <Input
                        type="number"
                        min={0}
                        step="any"
                        value={row.quantity}
                        onChange={event => updateDraftRow(row.id, { quantity: event.target.value })}
                        placeholder="Contoh: 10"
                        className="h-10"
                      />
                    </div>
                  </div>
                </div>
              ))}

              <Button type="button" variant="outline" className="w-full h-10 gap-1.5" onClick={addDraftRow}>
                <Plus className="w-4 h-4" />
                Tambah Baris Barang
              </Button>
            </div>

            <Button onClick={handleSaveDraft} disabled={!canSaveDraft} className="w-full h-11 text-sm font-semibold">
              {saving ? 'Menyimpan...' : 'Simpan ke Gudang'}
            </Button>
          </CardContent>
        </Card>

        <Card className="border-0 shadow-sm overflow-hidden">
          <CardHeader className="p-4 pb-3">
            <CardTitle className="text-sm flex items-center gap-1.5">
              <ClipboardList className="w-4 h-4 text-primary" />
              Riwayat Stok Masuk
            </CardTitle>
            <CardDescription className="text-xs">
              Semua input tersimpan per batch agar mudah dicek saat ada selisih stok atau belanja.
            </CardDescription>
          </CardHeader>
          <CardContent className="p-4 pt-0 space-y-3">
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold">Lihat Riwayat Tanggal</Label>
              <Input
                type="date"
                value={historyDate}
                onChange={event => setHistoryDate(event.target.value)}
                className="h-10"
              />
            </div>

            <div className="flex items-center justify-between rounded-xl border bg-muted/20 px-3 py-2 text-xs">
              <span className="font-semibold text-muted-foreground">
                {historyDate ? format(new Date(`${historyDate}T12:00:00`), 'dd MMM yyyy', { locale: localeId }) : 'Tanggal dipilih'}
              </span>
              <span className="font-bold text-foreground">{historyGroups.length} batch · {totalHistoryQty} item</span>
            </div>

            <div className="space-y-3">
              {historyGroups.length === 0 ? (
                <p className="text-[11px] text-muted-foreground">
                  Belum ada input stok masuk pada tanggal yang dipilih.
                </p>
              ) : (
                historyGroups.map(group => (
                  <div key={group.entryGroupId} className="rounded-xl border bg-background p-3 space-y-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-xs font-semibold">
                          Barang datang {format(group.date, 'dd MMM yyyy', { locale: localeId })}
                        </p>
                        <p className="text-[11px] text-muted-foreground">
                          Diinput {format(group.createdAt, 'dd MMM yyyy HH:mm', { locale: localeId })}
                        </p>
                        {group.note ? (
                          <p className="text-[11px] text-muted-foreground break-words mt-1">{group.note}</p>
                        ) : null}
                        {!isSameDay(group.date, group.createdAt) ? (
                          <p className="text-[11px] font-medium text-warning mt-1">Input beda hari dengan tanggal barang datang</p>
                        ) : null}
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <span className="text-[11px] font-semibold text-muted-foreground">
                          {group.items.length} baris
                        </span>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 text-destructive hover:bg-destructive/10"
                          onClick={() => setDeleteGroupTarget(group)}
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </Button>
                      </div>
                    </div>

                    <div className="space-y-2">
                      {group.items.map(item => (
                        <div key={item.id} className="flex items-center justify-between gap-3 rounded-lg border bg-muted/10 px-3 py-2">
                          <p className="text-xs font-medium break-words">{item.warehouseItemName}</p>
                          <span className="text-xs font-bold shrink-0">
                            +{item.quantity} {item.unit}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                ))
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      <AlertDialog
        open={!!deleteGroupTarget}
        onOpenChange={open => {
          if (!open && !deletingGroupId) {
            setDeleteGroupTarget(null);
          }
        }}
      >
        <AlertDialogContent className="max-w-[90vw] rounded-xl">
          <AlertDialogHeader>
            <AlertDialogTitle>Hapus batch stok masuk?</AlertDialogTitle>
            <AlertDialogDescription>
              Semua barang pada batch ini akan dibatalkan dan stok gudang dikurangi kembali sesuai jumlah yang dulu ditambahkan.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={!!deletingGroupId}>Batal</AlertDialogCancel>
            <AlertDialogAction
              onClick={event => {
                event.preventDefault();
                void handleDeleteHistoryGroup();
              }}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={!!deletingGroupId}
            >
              {deletingGroupId ? 'Menghapus...' : 'Hapus Batch'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
