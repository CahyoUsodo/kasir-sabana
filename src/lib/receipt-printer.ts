import { Capacitor, registerPlugin } from '@capacitor/core';
import { format } from 'date-fns';
import { id } from 'date-fns/locale';
import type { StoreSettings, Transaction, TransactionItemRecord } from './db';

export type ReceiptPrintMode = 'customer' | 'kitchen';

interface ReceiptPrintInput {
  mode: ReceiptPrintMode;
  transaction: Transaction;
  items: TransactionItemRecord[];
  storeSettings: StoreSettings | undefined;
  paymentMethodName: string;
  cashierName?: string;
  queueNumber: number | null;
}

interface BluetoothPrinterPlugin {
  printRaw(options: { data: string; chunkSize?: number }): Promise<{ deviceName?: string }>;
}

const BluetoothPrinter = registerPlugin<BluetoothPrinterPlugin>('BluetoothPrinter');

const SERVICE_UUID = '000018f0-0000-1000-8000-00805f9b34fb';
const CHARACTERISTIC_UUID = '00002af1-0000-1000-8000-00805f9b34fb';
const WEB_PRINTER_ID_KEY = 'preferredPrinterId';

const formatLine = (left: string, right: string, width: number = 32): string => {
  const spacesNeeded = width - (left.length + right.length);
  return spacesNeeded > 0 ? left + ' '.repeat(spacesNeeded) + right : left + ' ' + right;
};

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
        if (currentLine) allLines.push(currentLine);
        currentLine = word;
      }
    }

    if (currentLine) allLines.push(currentLine);
  }

  return allLines;
};

const PRINT_LOGO_WIDTH = 112;
const PRINT_LOGO_MAX_HEIGHT = 64;

const getEscPosImage = (base64Data: string, targetWidth: number = PRINT_LOGO_WIDTH): Promise<Uint8Array | null> => {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(targetWidth / img.width, PRINT_LOGO_MAX_HEIGHT / img.height, 1);
      const targetHeight = Math.max(1, Math.round(img.height * scale));
      const scaledWidth = Math.max(1, Math.round(img.width * scale));
      const canvasWidth = Math.ceil(scaledWidth / 8) * 8;

      const canvas = document.createElement('canvas');
      canvas.width = canvasWidth;
      canvas.height = targetHeight;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        resolve(null);
        return;
      }

      ctx.fillStyle = '#FFFFFF';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, Math.floor((canvasWidth - scaledWidth) / 2), 0, scaledWidth, targetHeight);
      const imgData = ctx.getImageData(0, 0, canvasWidth, targetHeight);
      const pixels = imgData.data;
      const widthBytes = Math.ceil(canvasWidth / 8);
      const buffer = new Uint8Array(8 + widthBytes * targetHeight);

      buffer[0] = 0x1D;
      buffer[1] = 0x76;
      buffer[2] = 0x30;
      buffer[3] = 0;
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
            if (pxX < canvasWidth) {
              const pxIndex = (y * canvasWidth + pxX) * 4;
              const r = pixels[pxIndex];
              const g = pixels[pxIndex + 1];
              const b = pixels[pxIndex + 2];
              const a = pixels[pxIndex + 3];
              const grey = 0.299 * r + 0.587 * g + 0.114 * b;

              if (a >= 128 && grey < 128) {
                byteVal |= (1 << (7 - bit));
              }
            }
          }
          buffer[offset++] = byteVal;
        }
      }

      resolve(buffer);
    };
    img.onerror = () => resolve(null);
    img.src = base64Data;
  });
};

const toBase64 = (data: Uint8Array) => {
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < data.length; i += chunkSize) {
    const chunk = data.subarray(i, i + chunkSize);
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
};

export const buildReceiptPrintData = async ({
  mode,
  transaction,
  items,
  storeSettings,
  paymentMethodName,
  cashierName,
  queueNumber,
}: ReceiptPrintInput): Promise<Uint8Array> => {
  const printableItems = items.filter(item => item.productId >= 0);
  const getItemDetails = (item: TransactionItemRecord) =>
    item.selectedOptions?.map(option => option.optionName).filter(Boolean) ?? [];
  const getDisplayName = (item: TransactionItemRecord) =>
    getItemDetails(item).length > 0 && item.productBaseName ? item.productBaseName : item.productName;

  let logoBuffer: Uint8Array | null = null;
  if (mode === 'customer' && storeSettings?.logo) {
    logoBuffer = await getEscPosImage(storeSettings.logo);
  }

  const encoder = new TextEncoder();
  const lines: string[] = [];

  if (mode === 'customer') {
    lines.push('\x1B\x61\x01');
    wrapText(storeSettings?.storeName || 'Toko', 32).forEach(line => lines.push(line + '\n'));
    if (storeSettings?.address) wrapText(storeSettings.address, 32).forEach(line => lines.push(line + '\n'));
    if (storeSettings?.phone) wrapText(storeSettings.phone, 32).forEach(line => lines.push(line + '\n'));
    lines.push('--------------------------------\n');
    lines.push('\x1B\x61\x00');
    lines.push(`No: ${transaction.receiptNumber}\n`);
    lines.push(formatLine(format(new Date(transaction.date), 'dd/MM/yyyy HH:mm'), paymentMethodName) + '\n');
    if (cashierName) lines.push(`Kasir: ${cashierName}\n`);
    if (transaction.customerName) wrapText(`Pelanggan: ${transaction.customerName}`, 32).forEach(line => lines.push(line + '\n'));
    if (transaction.serviceType) lines.push(`Tipe: ${transaction.serviceType === 'take_away' ? 'Take Away' : 'Dine In'}\n`);
    if (transaction.tableNumber) lines.push(`Meja: ${transaction.tableNumber}\n`);

    if (queueNumber !== null) {
      lines.push('--------------------------------\n');
      lines.push('\x1B\x61\x01');
      lines.push('\x1B\x45\x01');
      lines.push('Your Queue Number:\n');
      lines.push(`\x1D\x21\x11#${queueNumber}\n\x1D\x21\x00`);
      lines.push('\x1B\x45\x00');
      lines.push('\x1B\x61\x00');
    }

    lines.push('--------------------------------\n');
    for (let i = 0; i < printableItems.length; i++) {
      const item = printableItems[i];
      lines.push(`${getDisplayName(item)}\n`);
      getItemDetails(item).forEach(detail => lines.push(`  - ${detail}\n`));
      lines.push(formatLine(`  ${item.quantity} x Rp ${item.price.toLocaleString('id-ID')}`, `Rp ${item.subtotal.toLocaleString('id-ID')}`) + '\n');
      if (i < printableItems.length - 1) lines.push('\n');
    }

    lines.push('--------------------------------\n');
    lines.push(formatLine('Subtotal:', `Rp ${transaction.subtotal.toLocaleString('id-ID')}`) + '\n');
    if (transaction.discountAmount > 0) lines.push(formatLine('Diskon:', `-Rp ${transaction.discountAmount.toLocaleString('id-ID')}`) + '\n');
    lines.push(formatLine('TOTAL:', `Rp ${transaction.total.toLocaleString('id-ID')}`) + '\n');
    lines.push(formatLine('Bayar:', `Rp ${transaction.paymentAmount.toLocaleString('id-ID')}`) + '\n');
    lines.push(formatLine('Kembali:', `Rp ${transaction.change.toLocaleString('id-ID')}`) + '\n');
    lines.push('--------------------------------\n');
    lines.push('\x1B\x61\x01');
    wrapText(storeSettings?.receiptFooter || 'Terima kasih!', 32).forEach(line => lines.push(line + '\n'));
  } else {
    lines.push('\x1B\x61\x01');
    lines.push('\x1B\x45\x01');
    lines.push('*** DAPUR ***\n');
    lines.push('\x1B\x45\x00');
    if (queueNumber !== null) {
      lines.push('\x1B\x45\x01');
      lines.push('Your Queue Number:\n');
      lines.push(`\x1D\x21\x11#${queueNumber}\n\x1D\x21\x00`);
      lines.push('\x1B\x45\x00');
    }
    if (transaction.serviceType) {
      lines.push('\x1B\x45\x01');
      lines.push(`${transaction.serviceType === 'take_away' ? 'TAKE AWAY' : 'DINE IN'}\n`);
      lines.push('\x1B\x45\x00');
    }
    lines.push('--------------------------------\n');
    lines.push('\x1B\x61\x00');
    lines.push(`No: ${transaction.receiptNumber}\n`);
    lines.push(`Tanggal: ${format(new Date(transaction.date), 'dd/MM/yyyy HH:mm', { locale: id })}\n`);
    if (cashierName) lines.push(`Kasir: ${cashierName}\n`);
    if (transaction.customerName) wrapText(`Pelanggan: ${transaction.customerName}`, 32).forEach(line => lines.push(line + '\n'));
    if (transaction.serviceType) lines.push(`Tipe: ${transaction.serviceType === 'take_away' ? 'Take Away' : 'Dine In'}\n`);
    if (transaction.tableNumber) lines.push(`Meja: ${transaction.tableNumber}\n`);
    if (transaction.remarks) wrapText(`Catatan: ${transaction.remarks}`, 32).forEach(line => lines.push(line + '\n'));
    lines.push('--------------------------------\n');

    for (let i = 0; i < printableItems.length; i++) {
      const item = printableItems[i];
      const qtyStr = `[${item.quantity}x]`.padEnd(6, ' ');
      const maxNameWidth = 32 - qtyStr.length;
      const nameLines = wrapText(getDisplayName(item), maxNameWidth);
      lines.push('\x1B\x45\x01');
      if (nameLines.length > 0) {
        lines.push(`${qtyStr}${nameLines[0]}\n`);
        const padding = ' '.repeat(qtyStr.length);
        for (let j = 1; j < nameLines.length; j++) lines.push(`${padding}${nameLines[j]}\n`);
      }
      lines.push('\x1B\x45\x00');
      const padding = ' '.repeat(qtyStr.length);
      getItemDetails(item).forEach(detail => {
        wrapText(`- ${detail}`, maxNameWidth).forEach(detailLine => lines.push(`${padding}${detailLine}\n`));
      });
      if (item.notes) wrapText(`* Catatan: ${item.notes}`, 30).forEach(noteLine => lines.push(`  ${noteLine}\n`));
      if (i < printableItems.length - 1) lines.push('\n');
    }
    lines.push('--------------------------------\n');
    lines.push('\x1B\x61\x01');
    lines.push('Harap periksa pesanan\n');
  }

  lines.push('\n\n\n');

  const textData = encoder.encode(lines.join(''));
  const initCommands = new Uint8Array([0x1B, 0x40, 0x1B, 0x61, 0x01]);

  if (!logoBuffer) {
    const data = new Uint8Array(initCommands.length + textData.length);
    data.set(initCommands, 0);
    data.set(textData, initCommands.length);
    return data;
  }

  const data = new Uint8Array(initCommands.length + logoBuffer.length + 1 + textData.length);
  data.set(initCommands, 0);
  data.set(logoBuffer, initCommands.length);
  data[initCommands.length + logoBuffer.length] = 0x0A;
  data.set(textData, initCommands.length + logoBuffer.length + 1);
  return data;
};

const printWithWebBluetooth = async (data: Uint8Array) => {
  if (!('bluetooth' in navigator)) {
    throw new Error('Bluetooth tidak tersedia di browser ini. Gunakan Chrome di Android untuk mode web.');
  }

  let server: any = null;
  try {
    let device: any;
    const bluetooth = (navigator as any).bluetooth;

    if ('getDevices' in bluetooth) {
      const pairedDevices = await bluetooth.getDevices();
      const preferredId = localStorage.getItem(WEB_PRINTER_ID_KEY);
      if (preferredId) device = pairedDevices.find((d: any) => d.id === preferredId);
      if (!device && pairedDevices.length > 0) device = pairedDevices[0];
    }

    if (!device) {
      device = await bluetooth.requestDevice({
        filters: [{ services: [SERVICE_UUID] }],
        optionalServices: [SERVICE_UUID],
      });
      if (device) localStorage.setItem(WEB_PRINTER_ID_KEY, device.id);
    }

    server = await device.gatt.connect();
    const service = await server.getPrimaryService(SERVICE_UUID);
    const characteristic = await service.getCharacteristic(CHARACTERISTIC_UUID);

    for (let i = 0; i < data.length; i += 20) {
      await characteristic.writeValue(data.slice(i, i + 20));
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
  } catch (error) {
    localStorage.removeItem(WEB_PRINTER_ID_KEY);
    throw error;
  } finally {
    if (server) {
      try {
        await server.disconnect();
      } catch {
        // Ignore disconnect failures after a print attempt.
      }
    }
  }
};

export const printReceipt = async (input: ReceiptPrintInput) => {
  const data = await buildReceiptPrintData(input);

  if (Capacitor.isNativePlatform()) {
    await BluetoothPrinter.printRaw({ data: toBase64(data), chunkSize: 512 });
    return;
  }

  await printWithWebBluetooth(data);
};
