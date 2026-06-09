import { useRef, useState, useEffect } from 'react';
import { format } from 'date-fns';
import { id } from 'date-fns/locale';
import html2canvas from 'html2canvas';
import { Download, Share2, Printer, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { toast } from 'sonner';
import { db, type Transaction, type StoreSettings, type TransactionItemRecord } from '@/lib/db';
import { cn } from '@/lib/utils';

interface ReceiptProps {
  open: boolean;
  onClose: () => void;
  transaction: Transaction;
  items: TransactionItemRecord[];
  storeSettings: StoreSettings | undefined;
  paymentMethodName: string;
  cashierName?: string; // optional — shown only when multi-user is on
}

// Helper to format line with left and right columns aligned to 32 characters
const formatLine = (left: string, right: string, width: number = 32): string => {
  const spacesNeeded = width - (left.length + right.length);
  if (spacesNeeded > 0) {
    return left + ' '.repeat(spacesNeeded) + right;
  }
  return left + ' ' + right;
};

// Helper to wrap text into lines of max width without cutting words
const wrapText = (text: string, maxWidth: number = 32): string[] => {
  const paragraphs = text.split('\n');
  const allLines: string[] = [];
  
  for (const para of paragraphs) {
    const words = para.split(' ');
    let currentLine = '';
    
    for (const word of words) {
      if (!word) continue;
      const testLine = currentLine ? `${currentLine} ${word}` : word;
      if (testLine.length <= maxWidth) {
        currentLine = testLine;
      } else {
        if (currentLine) {
          allLines.push(currentLine);
        }
        currentLine = word;
      }
    }
    if (currentLine) {
      allLines.push(currentLine);
    }
  }
  return allLines;
};

// Helper to convert base64 image data to ESC/POS raster image command
const getEscPosImage = (base64Data: string, targetWidth: number = 160): Promise<Uint8Array | null> => {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const scale = targetWidth / img.width;
      const targetHeight = Math.round(img.height * scale);

      const canvas = document.createElement('canvas');
      canvas.width = targetWidth;
      canvas.height = targetHeight;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        resolve(null);
        return;
      }

      ctx.drawImage(img, 0, 0, targetWidth, targetHeight);
      const imgData = ctx.getImageData(0, 0, targetWidth, targetHeight);
      const pixels = imgData.data;

      const widthBytes = Math.ceil(targetWidth / 8);
      const buffer = new Uint8Array(8 + widthBytes * targetHeight);
      
      buffer[0] = 0x1D; // GS
      buffer[1] = 0x76; // v
      buffer[2] = 0x30; // 0
      buffer[3] = 0;    // m
      buffer[4] = widthBytes % 256;
      buffer[5] = Math.floor(widthBytes / 256);
      buffer[6] = targetHeight % 256;
      buffer[7] = Math.floor(targetHeight / 256);

      let offset = 8;
      for (let y = 0; y < targetHeight; y++) {
        for (let x = 0; x < widthBytes; x++) {
          let byteVal = 0;
          for (let bit = 0; bit < 8; bit++) {
            const pxX = x * 8 + bit;
            if (pxX < targetWidth) {
              const pxIndex = (y * targetWidth + pxX) * 4;
              const r = pixels[pxIndex];
              const g = pixels[pxIndex + 1];
              const b = pixels[pxIndex + 2];
              const a = pixels[pxIndex + 3];
              
              let isBlack = false;
              if (a >= 128) {
                const grey = 0.299 * r + 0.587 * g + 0.114 * b;
                isBlack = grey < 128;
              }
              
              if (isBlack) {
                byteVal |= (1 << (7 - bit));
              }
            }
          }
          buffer[offset++] = byteVal;
        }
      }
      resolve(buffer);
    };
    img.onerror = () => {
      resolve(null);
    };
    img.src = base64Data;
  });
};

export default function Receipt({ open, onClose, transaction, items, storeSettings, paymentMethodName, cashierName }: ReceiptProps) {
  const receiptRef = useRef<HTMLDivElement>(null);
  const [generating, setGenerating] = useState(false);
  const [queueNumber, setQueueNumber] = useState<number | null>(null);
  const [previewType, setPreviewType] = useState<'customer' | 'kitchen'>('customer');

  useEffect(() => {
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
  }, [transaction.id, transaction.date]);

  const captureReceipt = async (): Promise<HTMLCanvasElement | null> => {
    if (!receiptRef.current) return null;
    setGenerating(true);
    try {
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
    if (!('bluetooth' in navigator)) {
      toast.error('Bluetooth tidak tersedia di browser ini. Gunakan Chrome di Android.');
      return;
    }

    let server: any = null;
    try {
      let device: any;
      
      // Auto-connect to previously paired device if supported and saved
      if ('getDevices' in navigator.bluetooth) {
        // @ts-expect-error Web Bluetooth API getDevices is not fully typed
        const pairedDevices = await navigator.bluetooth.getDevices();
        const preferredId = localStorage.getItem('preferredPrinterId');
        if (preferredId) {
          device = pairedDevices.find((d: any) => d.id === preferredId);
        }
        if (!device && pairedDevices.length > 0) {
          device = pairedDevices[0];
        }
      }

      // If no paired device found, prompt picker
      if (!device) {
        toast.info('Mencari printer Bluetooth...');
        // @ts-expect-error Web Bluetooth API is not fully typed in TypeScript
        device = await navigator.bluetooth.requestDevice({
          filters: [{ services: ['000018f0-0000-1000-8000-00805f9b34fb'] }],
          optionalServices: ['000018f0-0000-1000-8000-00805f9b34fb'],
        });
        if (device) {
          localStorage.setItem('preferredPrinterId', device.id);
        }
      }

      server = await device.gatt.connect();
      const service = await server.getPrimaryService('000018f0-0000-1000-8000-00805f9b34fb');
      const characteristic = await service.getCharacteristic('00002af1-0000-1000-8000-00805f9b34fb');

      // Convert logo to ESC/POS raster image
      let logoBuffer: Uint8Array | null = null;
      if (mode === 'customer' && storeSettings?.logo) {
        try {
          logoBuffer = await getEscPosImage(storeSettings.logo, 160);
        } catch (e) {
          console.error('Error loading logo:', e);
        }
      }

      // Build ESC/POS text
      const encoder = new TextEncoder();
      const lines: string[] = [];
      
      if (mode === 'customer') {
        lines.push('\x1B\x61\x01'); // Center align
        const storeName = storeSettings?.storeName || 'Toko';
        wrapText(storeName, 32).forEach(line => lines.push(line + '\n'));
        if (storeSettings?.address) {
          wrapText(storeSettings.address, 32).forEach(line => lines.push(line + '\n'));
        }
        if (storeSettings?.phone) {
          wrapText(storeSettings.phone, 32).forEach(line => lines.push(line + '\n'));
        }
        lines.push('--------------------------------\n');
        
        lines.push('\x1B\x61\x00'); // Left align
        lines.push(`No: ${transaction.receiptNumber}\n`);
        lines.push(formatLine(format(new Date(transaction.date), 'dd/MM/yyyy HH:mm'), paymentMethodName) + '\n');
        if (cashierName) lines.push(`Kasir: ${cashierName}\n`);
        if (transaction.customerName) {
          wrapText(`Pelanggan: ${transaction.customerName}`, 32).forEach(line => lines.push(line + '\n'));
        }
        if (transaction.tableNumber) lines.push(`Meja: ${transaction.tableNumber}\n`);
        if (transaction.remarks) {
          wrapText(`Catatan: ${transaction.remarks}`, 32).forEach(line => lines.push(line + '\n'));
        }

        // Print Queue Number
        if (queueNumber !== null) {
          lines.push('--------------------------------\n');
          lines.push('\x1B\x61\x01'); // Center
          lines.push('\x1B\x45\x01'); // Bold on
          lines.push('Your Queue Number:\n');
          lines.push(`\x1D\x21\x11#${queueNumber}\n\x1D\x21\x00`); // Double size number
          lines.push('\x1B\x45\x00'); // Bold off
          lines.push('\x1B\x61\x00'); // Left
        }

        lines.push('--------------------------------\n');
        
        for (let i = 0; i < items.length; i++) {
          const item = items[i];
          lines.push(`${item.productName}\n`);
          if (item.notes) lines.push(`  ${item.notes}\n`);
          
          const qtyPrice = `  ${item.quantity} x Rp ${item.price.toLocaleString('id-ID')}`;
          const subtotalStr = `Rp ${item.subtotal.toLocaleString('id-ID')}`;
          lines.push(formatLine(qtyPrice, subtotalStr) + '\n');

          if (i < items.length - 1) {
            lines.push('\n');
          }
        }
        
        lines.push('--------------------------------\n');
        lines.push(formatLine('Subtotal:', `Rp ${transaction.subtotal.toLocaleString('id-ID')}`) + '\n');
        if (transaction.discountAmount > 0) {
          lines.push(formatLine('Diskon:', `-Rp ${transaction.discountAmount.toLocaleString('id-ID')}`) + '\n');
        }
        lines.push(formatLine('TOTAL:', `Rp ${transaction.total.toLocaleString('id-ID')}`) + '\n');
        lines.push(formatLine('Bayar:', `Rp ${transaction.paymentAmount.toLocaleString('id-ID')}`) + '\n');
        lines.push(formatLine('Kembali:', `Rp ${transaction.change.toLocaleString('id-ID')}`) + '\n');
        lines.push('--------------------------------\n');
        
        lines.push('\x1B\x61\x01'); // Center
        const footerText = storeSettings?.receiptFooter || 'Terima kasih!';
        wrapText(footerText, 32).forEach(line => lines.push(line + '\n'));
      } else {
        // Kitchen mode printing
        lines.push('\x1B\x61\x01'); // Center align
        lines.push('\x1B\x45\x01'); // Bold on
        lines.push('*** DAPUR ***\n');
        lines.push('\x1B\x45\x00'); // Bold off

        // Print Queue Number (very prominent in kitchen print)
        if (queueNumber !== null) {
          lines.push('\x1B\x45\x01'); // Bold on
          lines.push('Your Queue Number:\n');
          lines.push(`\x1D\x21\x11#${queueNumber}\n\x1D\x21\x00`); // Double size number
          lines.push('\x1B\x45\x00'); // Bold off
        }
        lines.push('--------------------------------\n');

        lines.push('\x1B\x61\x00'); // Left align
        lines.push(`No: ${transaction.receiptNumber}\n`);
        lines.push(`Tanggal: ${format(new Date(transaction.date), 'dd/MM/yyyy HH:mm')}\n`);
        if (cashierName) lines.push(`Kasir: ${cashierName}\n`);
        if (transaction.customerName) {
          wrapText(`Pelanggan: ${transaction.customerName}`, 32).forEach(line => lines.push(line + '\n'));
        }
        if (transaction.tableNumber) lines.push(`Meja: ${transaction.tableNumber}\n`);
        if (transaction.remarks) {
          wrapText(`Catatan: ${transaction.remarks}`, 32).forEach(line => lines.push(line + '\n'));
        }
        lines.push('--------------------------------\n');

        for (let i = 0; i < items.length; i++) {
          const item = items[i];
          const qtyStr = `[${item.quantity}x]`.padEnd(6, ' ');
          const maxNameWidth = 32 - qtyStr.length;
          const nameLines = wrapText(item.productName, maxNameWidth);
          
          lines.push('\x1B\x45\x01'); // Bold on
          if (nameLines.length > 0) {
            lines.push(`${qtyStr}${nameLines[0]}\n`);
            const padding = ' '.repeat(qtyStr.length);
            for (let j = 1; j < nameLines.length; j++) {
              lines.push(`${padding}${nameLines[j]}\n`);
            }
          }
          lines.push('\x1B\x45\x00'); // Bold off
          if (item.notes) {
            wrapText(`* Catatan: ${item.notes}`, 30).forEach(noteLine => {
              lines.push(`  ${noteLine}\n`);
            });
          }
          if (i < items.length - 1) {
            lines.push('\n');
          }
        }
        lines.push('--------------------------------\n');
        lines.push('\x1B\x61\x01'); // Center
        lines.push('Harap periksa pesanan\n');
      }
      
      lines.push('\n\n\n'); // Spacing to feed paper

      const textData = encoder.encode(lines.join(''));
      
      // Combine initialization, logo (if any), and text data
      const initCommands = new Uint8Array([0x1B, 0x40, 0x1B, 0x61, 0x01]); // ESC @ (Init) + ESC a 1 (Center)
      let data: Uint8Array;
      if (logoBuffer) {
        data = new Uint8Array(initCommands.length + logoBuffer.length + 1 + textData.length);
        data.set(initCommands, 0);
        data.set(logoBuffer, initCommands.length);
        data[initCommands.length + logoBuffer.length] = 0x0A; // Line Feed (flush/feed raster image)
        data.set(textData, initCommands.length + logoBuffer.length + 1);
      } else {
        data = new Uint8Array(initCommands.length + textData.length);
        data.set(initCommands, 0);
        data.set(textData, initCommands.length);
      }
      
      // Send in chunks of 20 bytes with 20ms delay to prevent buffer overflow in BLE write
      const chunkSize = 20;
      for (let i = 0; i < data.length; i += chunkSize) {
        const chunk = data.slice(i, i + chunkSize);
        await characteristic.writeValue(chunk);
        await new Promise((resolve) => setTimeout(resolve, 20));
      }

      toast.success(mode === 'customer' ? 'Struk pelanggan berhasil dicetak!' : 'Struk dapur berhasil dicetak!');
    } catch (err: unknown) {
      if (err instanceof Error && err.name !== 'NotFoundError') {
        // Clear the preferred printer ID if connection fails so user can choose again
        localStorage.removeItem('preferredPrinterId');
        toast.error('Gagal mencetak. Pastikan printer Bluetooth menyala.');
      }
    } finally {
      if (server) {
        try {
          await server.disconnect();
        } catch (e) {
          console.error('Error disconnecting GATT server:', e);
        }
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

              {queueNumber !== null && (
                <div className="text-center my-2 py-1 bg-gray-50 rounded border border-dashed border-gray-300">
                  <p className="text-[8px] text-gray-500 uppercase tracking-wider font-semibold">Your Queue Number</p>
                  <p className="text-lg font-bold">#{queueNumber}</p>
                </div>
              )}

              <div className="border-t border-dashed border-gray-400 my-2" />

              {/* Items */}
              {items.map((item, i) => (
                <div key={i} className="mb-3">
                  <p className="text-[11px] font-medium">{item.productName}</p>
                  {item.notes && <p className="text-[9px] text-gray-500 italic">  {item.notes}</p>}
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
                {items.map((item, i) => (
                  <div key={i} className="text-[11px]">
                    <div className="flex items-start">
                      <span className="min-w-[36px] text-[11px] font-bold bg-black text-white rounded px-1.5 py-0.5 text-center mr-2">
                        {item.quantity}x
                      </span>
                      <div className="flex-1">
                        <p className="font-bold leading-tight">{item.productName}</p>
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
