import type { WarehouseItem } from './db';

export type OcrDraftStatus = 'matched' | 'review' | 'unknown';

export interface OcrDraftSuggestion {
  originalLine: string;
  detectedName: string;
  detectedQuantity: number;
  detectedUnit?: string;
  warehouseItemId?: number;
  warehouseItemName?: string;
  status: OcrDraftStatus;
  note: string;
}

const UNIT_PATTERN = 'pcs?|pc|pak|pack|dus|box|botol|btl|ltr|liter|ml|kg|gr|gram|karung|sak|ikat|ekor|cup|pouch|sachet|roll|tray';
const IGNORE_LINE_PATTERNS = [
  /subtotal/i,
  /grand\s*total/i,
  /^total\b/i,
  /diskon/i,
  /kembalian/i,
  /tunai/i,
  /cash/i,
  /debit/i,
  /kredit/i,
  /qris/i,
  /ppn/i,
  /tax/i,
  /terima\s*kasih/i,
  /tanggal/i,
  /^tgl\b/i,
  /^jam\b/i,
  /invoice/i,
  /nota/i,
  /struk/i,
  /bayar/i,
  /admin/i,
  /kasir/i,
  /promo/i,
  /member/i,
  /supplier/i,
];

const normalizeForMatch = (value?: string) =>
  (value || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const getTokens = (value?: string) =>
  normalizeForMatch(value)
    .split(' ')
    .filter(token => token.length > 2);

const parseQty = (value?: string) => {
  if (!value) return 0;
  const normalized = value.replace(',', '.');
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : 0;
};

const stripPriceTail = (line: string) => {
  let next = line.replace(/rp/gi, ' ');
  next = next.replace(/(?:\s+\d{1,3}(?:[.,]\d{3})+(?:[.,]\d{1,2})?)+\s*$/i, ' ');
  next = next.replace(/(?:\s+\d{4,})+\s*$/i, ' ');
  return next.replace(/\s+/g, ' ').trim();
};

const shouldIgnoreLine = (line: string) => {
  if (!line || line.length < 3) return true;
  if (!/[a-z]/i.test(line)) return true;
  return IGNORE_LINE_PATTERNS.some(pattern => pattern.test(line));
};

const parseReceiptLine = (line: string) => {
  const cleanedLine = stripPriceTail(line)
    .replace(/[|]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (shouldIgnoreLine(cleanedLine)) return null;

  const startQtyPattern = new RegExp(`^(\\d+(?:[.,]\\d+)?)\\s*(${UNIT_PATTERN})?\\s+(.+)$`, 'i');
  const endQtyPattern = new RegExp(`^(.+?)\\s+(\\d+(?:[.,]\\d+)?)\\s*(${UNIT_PATTERN})?$`, 'i');
  const xQtyPattern = new RegExp(`^(.+?)\\s+[xX]\\s*(\\d+(?:[.,]\\d+)?)\\s*(${UNIT_PATTERN})?$`, 'i');

  let match = cleanedLine.match(startQtyPattern);
  if (match) {
    const quantity = parseQty(match[1]);
    const unit = match[2]?.toLowerCase();
    const name = match[3]?.trim();
    if (quantity > 0 && name) {
      return {
        originalLine: line,
        detectedName: name,
        detectedQuantity: quantity,
        detectedUnit: unit,
        note: 'Jumlah terbaca dari OCR',
      };
    }
  }

  match = cleanedLine.match(xQtyPattern);
  if (match) {
    const name = match[1]?.trim();
    const quantity = parseQty(match[2]);
    const unit = match[3]?.toLowerCase();
    if (quantity > 0 && name) {
      return {
        originalLine: line,
        detectedName: name,
        detectedQuantity: quantity,
        detectedUnit: unit,
        note: 'Jumlah terbaca dari pola x qty',
      };
    }
  }

  match = cleanedLine.match(endQtyPattern);
  if (match) {
    const name = match[1]?.trim();
    const quantity = parseQty(match[2]);
    const unit = match[3]?.toLowerCase();
    if (quantity > 0 && quantity <= 200 && name) {
      return {
        originalLine: line,
        detectedName: name,
        detectedQuantity: quantity,
        detectedUnit: unit,
        note: 'Jumlah terbaca dari OCR',
      };
    }
  }

  const fallbackName = cleanedLine.replace(/\b\d+\b/g, ' ').replace(/\s+/g, ' ').trim();
  if (fallbackName.length < 3) return null;

  return {
    originalLine: line,
    detectedName: fallbackName,
    detectedQuantity: 1,
    note: 'Jumlah tidak terbaca jelas, default 1',
  };
};

const scoreWarehouseMatch = (sourceName: string, warehouseName: string) => {
  const normalizedSource = normalizeForMatch(sourceName);
  const normalizedWarehouse = normalizeForMatch(warehouseName);
  const sourceHasDigit = /\d/.test(normalizedSource);
  const warehouseHasDigit = /\d/.test(normalizedWarehouse);
  if (!normalizedSource || !normalizedWarehouse) return 0;
  if (normalizedSource === normalizedWarehouse) return 1;
  if (
    normalizedSource.length >= 5 &&
    (normalizedSource.includes(normalizedWarehouse) || normalizedWarehouse.includes(normalizedSource))
  ) {
    const directScore = 0.9;
    return warehouseHasDigit && !sourceHasDigit ? 0.75 : directScore;
  }

  const sourceTokens = getTokens(sourceName);
  const warehouseTokens = getTokens(warehouseName);
  if (sourceTokens.length === 0 || warehouseTokens.length === 0) return 0;

  const shared = sourceTokens.filter(token => warehouseTokens.includes(token));
  const baseScore = shared.length / Math.max(sourceTokens.length, warehouseTokens.length);
  const firstTokenBonus = shared[0] && sourceTokens[0] === warehouseTokens[0] ? 0.15 : 0;
  const totalScore = Math.min(0.89, baseScore + firstTokenBonus);
  return warehouseHasDigit && !sourceHasDigit ? Math.min(totalScore, 0.75) : totalScore;
};

const getBestWarehouseMatch = (
  detectedName: string,
  warehouseItems: Pick<WarehouseItem, 'id' | 'name' | 'unit'>[]
) => {
  let bestItem: Pick<WarehouseItem, 'id' | 'name' | 'unit'> | undefined;
  let bestScore = 0;

  for (const item of warehouseItems) {
    const score = scoreWarehouseMatch(detectedName, item.name);
    if (score > bestScore) {
      bestScore = score;
      bestItem = item;
    }
  }

  return { bestItem, bestScore };
};

export function extractOcrDraftSuggestions(
  text: string,
  warehouseItems: Pick<WarehouseItem, 'id' | 'name' | 'unit'>[]
): OcrDraftSuggestion[] {
  const lines = text
    .split(/\r?\n/)
    .map(line => line.replace(/\s+/g, ' ').trim())
    .filter(Boolean);

  const suggestions: OcrDraftSuggestion[] = [];

  for (const line of lines) {
    const parsed = parseReceiptLine(line);
    if (!parsed) continue;

    const { bestItem, bestScore } = getBestWarehouseMatch(parsed.detectedName, warehouseItems);

    if (bestItem && bestScore >= 0.9) {
      suggestions.push({
        ...parsed,
        warehouseItemId: bestItem.id,
        warehouseItemName: bestItem.name,
        status: 'matched',
        note: `Cocok otomatis ke ${bestItem.name}`,
      });
      continue;
    }

    if (bestItem && bestScore >= 0.45) {
      suggestions.push({
        ...parsed,
        warehouseItemName: bestItem.name,
        status: 'review',
        note: `Kemungkinan ${bestItem.name}, perlu dicek`,
      });
      continue;
    }

    suggestions.push({
      ...parsed,
      status: 'unknown',
      note: 'Belum ditemukan pasangan barang gudang',
    });
  }

  const deduped = new Map<string, OcrDraftSuggestion>();
  for (const suggestion of suggestions) {
    const key = `${normalizeForMatch(suggestion.detectedName)}::${suggestion.detectedQuantity}`;
    if (!deduped.has(key)) {
      deduped.set(key, suggestion);
    }
  }

  return [...deduped.values()];
}
