import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function generateUUID(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  // Fallback for non-secure HTTP contexts
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

export function parseFormattedNumber(value?: string): number {
  if (!value) return 0;
  const normalized = value.replace(/[^\d]/g, "");
  return Number(normalized || "0");
}

export function formatNumberInput(value?: string | number): string {
  if (value === null || value === undefined) return "";
  const numericValue = typeof value === "number" ? value : parseFormattedNumber(value);
  if (!numericValue) return "";
  return numericValue.toLocaleString("id-ID");
}
