import { useRef, useState } from 'react';
import { format } from 'date-fns';
import { id } from 'date-fns/locale';
import html2canvas from 'html2canvas';
import { Download, Share2, Printer, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { toast } from 'sonner';
import type { Transaction, StoreSettings, TransactionItemRecord } from '@/lib/db';

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
    link.download = `struk-${transaction.receiptNumber}.png`;
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
        const file = new File([blob], `struk-${transaction.receiptNumber}.png`, { type: 'image/png' });
        await navigator.share({
          title: `Struk ${transaction.receiptNumber}`,
          text: `Struk dari ${storeSettings?.storeName || 'Toko'}`,
          files: [file],
        });
      } else {
        // Fallback: open WhatsApp with text
        const text = encodeURIComponent(
          `*${storeSettings?.storeName || 'Toko'}*\nStruk: ${transaction.receiptNumber}\nTotal: Rp ${transaction.total.toLocaleString('id-ID')}\nTanggal: ${format(new Date(transaction.date), 'dd MMM yyyy HH:mm', { locale: id })}`
        );
        window.open(`https://wa.me/?text=${text}`, '_blank');
      }
    } catch (err: unknown) {
      if (err instanceof Error && err.name !== 'AbortError') {
        toast.error('Gagal membagikan struk');
      }
    }
  };

  const handleBluetoothPrint = async () => {
    if (!('bluetooth' in navigator)) {
      toast.error('Bluetooth tidak tersedia di browser ini. Gunakan Chrome di Android.');
      return;
    }

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

      const server = await device.gatt.connect();
      const service = await server.getPrimaryService('000018f0-0000-1000-8000-00805f9b34fb');
      const characteristic = await service.getCharacteristic('00002af1-0000-1000-8000-00805f9b34fb');

      // Convert logo to ESC/POS raster image
      let logoBuffer: Uint8Array | null = null;
      if (storeSettings?.logo) {
        try {
          logoBuffer = await getEscPosImage(storeSettings.logo, 160);
        } catch (e) {
          console.error('Error loading logo:', e);
        }
      }

      // Build ESC/POS text
      const encoder = new TextEncoder();
      const lines: string[] = [];
      
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
      lines.push('--------------------------------\n');
      
      for (const item of items) {
        lines.push(`${item.productName}\n`);
        if (item.notes) lines.push(`  ${item.notes}\n`);
        
        const qtyPrice = `  ${item.quantity} x Rp ${item.price.toLocaleString('id-ID')}`;
        const subtotalStr = `Rp ${item.subtotal.toLocaleString('id-ID')}`;
        lines.push(formatLine(qtyPrice, subtotalStr) + '\n');
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
      lines.push('\n\n\n'); // Spacing to feed paper

      const textData = encoder.encode(lines.join(''));
      
      // Combine initialization, logo, and text data
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

      toast.success('Struk berhasil dicetak!');
      await server.disconnect();
    } catch (err: unknown) {
      if (err instanceof Error && err.name !== 'NotFoundError') {
        // Clear the preferred printer ID if connection fails so user can choose again
        localStorage.removeItem('preferredPrinterId');
        toast.error('Gagal mencetak. Pastikan printer Bluetooth menyala.');
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

        {/* Receipt preview - this gets captured as image */}
        <div ref={receiptRef} className="bg-white text-black p-4 rounded-lg mx-auto" style={{ width: '280px', fontFamily: 'monospace', fontSize: '12px' }}>
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

          <div className="border-t border-dashed border-gray-400 my-2" />

          {/* Items */}
          {items.map((item, i) => (
            <div key={i} className="mb-1">
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
        </div>

        {/* Action buttons */}
        <div className="grid grid-cols-3 gap-2 mt-3">
          <Button variant="outline" className="flex flex-col items-center gap-1 h-auto py-3" onClick={handleDownload} disabled={generating}>
            <Download className="w-5 h-5" />
            <span className="text-[10px]">Unduh</span>
          </Button>
          <Button variant="outline" className="flex flex-col items-center gap-1 h-auto py-3" onClick={handleShare} disabled={generating}>
            <Share2 className="w-5 h-5" />
            <span className="text-[10px]">Bagikan</span>
          </Button>
          <Button variant="outline" className="flex flex-col items-center gap-1 h-auto py-3" onClick={handleBluetoothPrint} disabled={generating}>
            <Printer className="w-5 h-5" />
            <span className="text-[10px]">Cetak</span>
          </Button>
        </div>

        <Button variant="secondary" className="w-full mt-1" onClick={onClose}>
          Selesai
        </Button>
      </DialogContent>
    </Dialog>
  );
}
