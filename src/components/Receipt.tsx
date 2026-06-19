import { useRef, useState, useEffect, useMemo } from 'react';
import { format } from 'date-fns';
import { id } from 'date-fns/locale';
import { Download, Share2, Printer, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { toast } from 'sonner';
import { db, type Transaction, type StoreSettings, type TransactionItemRecord } from '@/lib/db';
import { cn } from '@/lib/utils';
import { printReceipt } from '@/lib/receipt-printer';

interface ReceiptProps {
  open: boolean;
  onClose: () => void;
  transaction: Transaction;
  items: TransactionItemRecord[];
  storeSettings: StoreSettings | undefined;
  paymentMethodName: string;
  cashierName?: string; // optional — shown only when multi-user is on
}

export default function Receipt({ open, onClose, transaction, items, storeSettings, paymentMethodName, cashierName }: ReceiptProps) {
  const receiptRef = useRef<HTMLDivElement>(null);
  const [generating, setGenerating] = useState(false);
  const [queueNumber, setQueueNumber] = useState<number | null>(null);
  const [previewType, setPreviewType] = useState<'customer' | 'kitchen'>('customer');

  const printableItems = useMemo(
    () => items.filter(item => item.productId >= 0),
    [items]
  );
  const getItemDetails = (item: TransactionItemRecord, index: number) =>
    item.selectedOptions?.map(option => option.optionName).filter(Boolean) ?? [];
  const getDisplayName = (item: TransactionItemRecord, index: number) =>
    getItemDetails(item, index).length > 0 && item.productBaseName
      ? item.productBaseName
      : item.productName;

  useEffect(() => {
    if (!open) {
      setQueueNumber(null);
      return;
    }

    const fetchQueueNumber = async () => {
      if (!transaction.id || !transaction.date) {
        setQueueNumber(1);
        return;
      }
      try {
        const txDate = new Date(transaction.date);
        const start = new Date(txDate);
        start.setHours(0, 0, 0, 0);
        const end = new Date(txDate);
        end.setHours(23, 59, 59, 999);

        // Fetch all transactions on the same day
        const dayTxs = await db.transactions
          .where('date')
          .between(start, end, true, true)
          .toArray();

        // Sort them chronologically by date and id
        dayTxs.sort((a, b) => {
          const timeA = new Date(a.date).getTime();
          const timeB = new Date(b.date).getTime();
          if (timeA !== timeB) return timeA - timeB;
          return (a.id || 0) - (b.id || 0);
        });

        const index = dayTxs.findIndex(t => t.id === transaction.id);
        if (index !== -1) {
          setQueueNumber(index + 1);
        } else {
          setQueueNumber(dayTxs.length + 1);
        }
      } catch (err) {
        console.error('Error fetching queue number:', err);
        setQueueNumber(1);
      }
    };

    fetchQueueNumber();
  }, [open, transaction.id, transaction.date]);
  const captureReceipt = async (): Promise<HTMLCanvasElement | null> => {
    if (!receiptRef.current) return null;
    setGenerating(true);
    try {
      const { default: html2canvas } = await import('html2canvas');
      const canvas = await html2canvas(receiptRef.current, {
        backgroundColor: '#ffffff',
        scale: 2,
        useCORS: true,
        logging: false,
      });
      return canvas;
    } catch {
      toast.error('Gagal membuat gambar struk');
      return null;
    } finally {
      setGenerating(false);
    }
  };

  const handleDownload = async () => {
    const canvas = await captureReceipt();
    if (!canvas) return;
    const link = document.createElement('a');
    link.download = `struk-${previewType}-${transaction.receiptNumber}.png`;
    link.href = canvas.toDataURL('image/png');
    link.click();
    toast.success('Struk berhasil diunduh');
  };

  const handleShare = async () => {
    const canvas = await captureReceipt();
    if (!canvas) return;

    try {
      const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/png'));
      if (!blob) return;

      if (navigator.share) {
        const file = new File([blob], `struk-${previewType}-${transaction.receiptNumber}.png`, { type: 'image/png' });
        await navigator.share({
          title: `Struk ${previewType === 'customer' ? 'Pelanggan' : 'Dapur'} ${transaction.receiptNumber}`,
          text: `Struk dari ${storeSettings?.storeName || 'Toko'}`,
          files: [file],
        });
      } else {
        // Fallback: open WhatsApp with text
        const text = encodeURIComponent(
          `*${storeSettings?.storeName || 'Toko'} - Struk ${previewType === 'customer' ? 'Pelanggan' : 'Dapur'}*\nStruk: ${transaction.receiptNumber}\nTotal: Rp ${transaction.total.toLocaleString('id-ID')}\nTanggal: ${format(new Date(transaction.date), 'dd MMM yyyy HH:mm', { locale: id })}`
        );
        window.open(`https://wa.me/?text=${text}`, '_blank');
      }
    } catch (err: unknown) {
      if (err instanceof Error && err.name !== 'AbortError') {
        toast.error('Gagal membagikan struk');
      }
    }
  };

  const handleBluetoothPrint = async (mode: 'customer' | 'kitchen') => {
    try {
      toast.info('Mengirim struk ke printer...');
      await printReceipt({
        mode,
        transaction,
        items,
        storeSettings,
        paymentMethodName,
        cashierName,
        queueNumber,
      });
      toast.success(mode === 'customer' ? 'Struk pelanggan berhasil dicetak!' : 'Struk dapur berhasil dicetak!');
    } catch (err: unknown) {
      if (err instanceof Error && err.name !== 'NotFoundError') {
        toast.error(err.message || 'Gagal mencetak. Pastikan printer Bluetooth menyala.');
      }
    }
  };

  const rp = (n: number) => `Rp ${n.toLocaleString('id-ID')}`;

  return (
    <Dialog open={open} onOpenChange={v => !v && onClose()}>
      <DialogContent className="max-w-[95vw] max-h-[90vh] overflow-y-auto rounded-xl p-4">
        <DialogHeader>
          <DialogTitle className="text-center">Struk Transaksi</DialogTitle>
        </DialogHeader>

        {/* Toggle Preview Mode */}
        <div className="flex gap-1 bg-muted p-1 rounded-lg mx-auto w-[280px]">
          <button
            onClick={() => setPreviewType('customer')}
            className={cn(
              'flex-1 text-center py-1.5 text-xs font-semibold rounded-md transition-all',
              previewType === 'customer'
                ? 'bg-background text-foreground shadow-sm font-bold'
                : 'text-muted-foreground hover:text-foreground'
            )}
          >
            Pelanggan
          </button>
          <button
            onClick={() => setPreviewType('kitchen')}
            className={cn(
              'flex-1 text-center py-1.5 text-xs font-semibold rounded-md transition-all',
              previewType === 'kitchen'
                ? 'bg-background text-foreground shadow-sm font-bold'
                : 'text-muted-foreground hover:text-foreground'
            )}
          >
            Dapur
          </button>
        </div>

        {/* Receipt preview - this gets captured as image */}
        <div ref={receiptRef} className="bg-white text-black p-4 rounded-lg mx-auto" style={{ width: '280px', fontFamily: 'monospace', fontSize: '12px' }}>
          {previewType === 'customer' ? (
            <>
              {/* Store Header */}
              <div className="text-center mb-2">
                {storeSettings?.logo && (
                  <img src={storeSettings.logo} alt="Logo" className="w-16 h-16 object-contain mx-auto mb-1" />
                )}
                <p className="font-bold text-sm">{storeSettings?.storeName || 'Toko'}</p>
                {storeSettings?.address && <p className="text-[10px]">{storeSettings.address}</p>}
                {storeSettings?.phone && <p className="text-[10px]">{storeSettings.phone}</p>}
              </div>

              <div className="border-t border-dashed border-gray-400 my-2" />

              {/* Receipt info */}
              <div className="flex justify-between text-[10px]">
                <span>No: {transaction.receiptNumber}</span>
              </div>
              <div className="flex justify-between text-[10px] mb-1">
                <span>{format(new Date(transaction.date), 'dd/MM/yyyy HH:mm', { locale: id })}</span>
                <span>{paymentMethodName}</span>
              </div>
              {cashierName && (
                <div className="flex justify-between text-[10px]">
                  <span>Kasir: {cashierName}</span>
                </div>
              )}
              {transaction.customerName && (
                <div className="flex justify-between text-[10px]">
                  <span>Pelanggan: {transaction.customerName}</span>
                </div>
              )}
              {transaction.serviceType && (
                <div className="flex justify-between text-[10px]">
                  <span>Tipe: {transaction.serviceType === 'take_away' ? 'Take Away' : 'Dine In'}</span>
                </div>
              )}
              {transaction.tableNumber && (
                <div className="flex justify-between text-[10px]">
                  <span>Meja: {transaction.tableNumber}</span>
                </div>
              )}
              {queueNumber !== null && (
                <div className="text-center my-2 py-1 bg-gray-50 rounded border border-dashed border-gray-300">
                  <p className="text-[8px] text-gray-500 uppercase tracking-wider font-semibold">Your Queue Number</p>
                  <p className="text-lg font-bold">#{queueNumber}</p>
                </div>
              )}

              <div className="border-t border-dashed border-gray-400 my-2" />

              {/* Items */}
              {printableItems.map((item, i) => (
                <div key={i} className="mb-3">
                  <p className="text-[11px] font-medium">{getDisplayName(item, i)}</p>
                  {getItemDetails(item, i).length > 0 && (
                    <div className="mt-0.5 space-y-0.5">
                      {getItemDetails(item, i).map(detail => (
                        <p key={`${detail}-${i}`} className="text-[9px] text-gray-600">- {detail}</p>
                      ))}
                    </div>
                  )}
                  <div className="flex justify-between text-[10px]">
                    <span>{item.quantity} x {rp(item.price)}</span>
                    <span>{rp(item.subtotal)}</span>
                  </div>
                  {item.discountAmount > 0 && (
                    <div className="flex justify-between text-[10px] text-gray-500">
                      <span>  Diskon</span>
                      <span>-{rp(item.discountAmount)}</span>
                    </div>
                  )}
                </div>
              ))}

              <div className="border-t border-dashed border-gray-400 my-2" />

              {/* Totals */}
              <div className="space-y-0.5 text-[11px]">
                <div className="flex justify-between">
                  <span>Subtotal</span>
                  <span>{rp(transaction.subtotal)}</span>
                </div>
                {transaction.discountAmount > 0 && (
                  <div className="flex justify-between">
                    <span>Diskon</span>
                    <span>-{rp(transaction.discountAmount)}</span>
                  </div>
                )}
                <div className="flex justify-between font-bold text-xs border-t border-dashed border-gray-400 pt-1 mt-1">
                  <span>TOTAL</span>
                  <span>{rp(transaction.total)}</span>
                </div>
                <div className="flex justify-between">
                  <span>Bayar</span>
                  <span>{rp(transaction.paymentAmount)}</span>
                </div>
                <div className="flex justify-between">
                  <span>Kembali</span>
                  <span>{rp(transaction.change)}</span>
                </div>
              </div>

              <div className="border-t border-dashed border-gray-400 my-2" />

              {/* Footer */}
              <p className="text-center text-[10px] text-gray-500">
                {storeSettings?.receiptFooter || 'Terima kasih atas kunjungan Anda!'}
              </p>
            </>
          ) : (
            <>
              {/* Kitchen Header */}
              <div className="text-center mb-2">
                <p className="font-bold text-sm tracking-widest">*** DAPUR ***</p>
              </div>

              {queueNumber !== null && (
                <div className="text-center my-2 py-1 bg-gray-50 rounded border border-dashed border-gray-300">
                  <p className="text-[8px] text-gray-500 uppercase tracking-wider font-semibold">Your Queue Number</p>
                  <p className="text-lg font-bold">#{queueNumber}</p>
                </div>
              )}
              {transaction.serviceType && (
                <div className="text-center my-1">
                  <p className="text-xs font-bold bg-black text-white py-1 rounded tracking-wider">
                    {transaction.serviceType === 'take_away' ? 'TAKE AWAY' : 'DINE IN'}
                  </p>
                </div>
              )}

              <div className="border-t border-dashed border-gray-400 my-2" />

              {/* Receipt info */}
              <div className="flex justify-between text-[10px]">
                <span>No: {transaction.receiptNumber}</span>
              </div>
              <div className="flex justify-between text-[10px] mb-1">
                <span>{format(new Date(transaction.date), 'dd/MM/yyyy HH:mm', { locale: id })}</span>
              </div>
              {cashierName && (
                <div className="flex justify-between text-[10px]">
                  <span>Kasir: {cashierName}</span>
                </div>
              )}
              {transaction.customerName && (
                <div className="flex justify-between text-[10px]">
                  <span>Pelanggan: {transaction.customerName}</span>
                </div>
              )}
              {transaction.serviceType && (
                <div className="flex justify-between text-[10px]">
                  <span>Tipe: {transaction.serviceType === 'take_away' ? 'Take Away' : 'Dine In'}</span>
                </div>
              )}
              {transaction.tableNumber && (
                <div className="flex justify-between text-[10px]">
                  <span>Meja: {transaction.tableNumber}</span>
                </div>
              )}
              {transaction.remarks && (
                <div className="text-[10px]">
                  <span>Catatan: {transaction.remarks}</span>
                </div>
              )}

              <div className="border-t border-dashed border-gray-400 my-2" />

              {/* Items */}
              <div className="space-y-4">
                {printableItems.map((item, i) => (
                  <div key={i} className="text-[11px]">
                    <div className="flex items-start">
                      <span className="min-w-[36px] text-[11px] font-bold bg-black text-white rounded px-1.5 py-0.5 text-center mr-2">
                        {item.quantity}x
                      </span>
                      <div className="flex-1">
                        <p className="font-bold leading-tight">{getDisplayName(item, i)}</p>
                        {getItemDetails(item, i).length > 0 && (
                          <div className="mt-1 space-y-0.5">
                            {getItemDetails(item, i).map(detail => (
                              <p key={`${detail}-kitchen-${i}`} className="text-[10px] text-gray-700">
                                - {detail}
                              </p>
                            ))}
                          </div>
                        )}
                        {item.notes && (
                          <p className="text-[10px] text-gray-700 font-medium italic mt-0.5">
                            * Catatan: {item.notes}
                          </p>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>

              <div className="border-t border-dashed border-gray-400 my-2" />
              <p className="text-center text-[9px] text-gray-500 italic">Harap periksa pesanan dengan teliti</p>
            </>
          )}
        </div>

        {/* Action buttons */}
        <div className="grid grid-cols-2 gap-2 mt-3">
          <Button variant="outline" className="flex items-center justify-center gap-2 h-10 text-xs py-2" onClick={handleDownload} disabled={generating}>
            <Download className="w-4 h-4" />
            <span>Unduh</span>
          </Button>
          <Button variant="outline" className="flex items-center justify-center gap-2 h-10 text-xs py-2" onClick={handleShare} disabled={generating}>
            <Share2 className="w-4 h-4" />
            <span>Bagikan</span>
          </Button>
        </div>
        <div className="grid grid-cols-2 gap-2 mt-2">
          <Button variant="outline" className="flex items-center justify-center gap-2 h-11 text-xs py-2 border-primary text-primary hover:bg-primary/5" onClick={() => handleBluetoothPrint('customer')} disabled={generating}>
            <Printer className="w-4 h-4" />
            <span>Cetak Pelanggan</span>
          </Button>
          <Button className="flex items-center justify-center gap-2 h-11 text-xs py-2" onClick={() => handleBluetoothPrint('kitchen')} disabled={generating}>
            <Printer className="w-4 h-4" />
            <span>Cetak Dapur</span>
          </Button>
        </div>

        <Button variant="secondary" className="w-full mt-1" onClick={onClose}>
          Selesai
        </Button>
      </DialogContent>
    </Dialog>
  );
}
