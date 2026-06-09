import { db, type User, type PermissionKey, ALL_PERMISSIONS } from './db';

// Pure JS SHA-256 fallback for non-secure HTTP contexts
function sha256Pure(str: string): string {
  const rotateRight = (n: number, x: number) => (x >>> n) | (x << (32 - n));
  
  const k = [
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
  ];

  let h0 = 0x6a09e667, h1 = 0xbb67ae85, h2 = 0x3c6ef372, h3 = 0xa54ff53a,
      h4 = 0x510e527f, h5 = 0x9b05688c, h6 = 0x1f83d9ab, h7 = 0x5be0cd19;

  const utf8: number[] = [];
  for (let i = 0; i < str.length; i++) {
    let charcode = str.charCodeAt(i);
    if (charcode < 0x80) utf8.push(charcode);
    else if (charcode < 0x800) {
      utf8.push(0xc0 | (charcode >> 6), 0x80 | (charcode & 0x3f));
    } else if (charcode < 0xd800 || charcode >= 0xe000) {
      utf8.push(0xe0 | (charcode >> 12), 0x80 | ((charcode >> 6) & 0x3f), 0x80 | (charcode & 0x3f));
    } else {
      i++;
      charcode = 0x10000 + (((charcode & 0x3ff) << 10) | (str.charCodeAt(i) & 0x3ff));
      utf8.push(
        0xf0 | (charcode >> 18),
        0x80 | ((charcode >> 12) & 0x3f),
        0x80 | ((charcode >> 6) & 0x3f),
        0x80 | (charcode & 0x3f)
      );
    }
  }

  const l = utf8.length;
  utf8.push(0x80);
  while ((utf8.length + 8) % 64 !== 0) utf8.push(0);

  const lenBits = l * 8;
  utf8.push(0, 0, 0, 0); // High 32-bits
  utf8.push(
    (lenBits >>> 24) & 0xff,
    (lenBits >>> 16) & 0xff,
    (lenBits >>> 8) & 0xff,
    lenBits & 0xff
  );

  const w = new Array(64);
  for (let i = 0; i < utf8.length; i += 64) {
    let a = h0, b = h1, c = h2, d = h3, e = h4, f = h5, g = h6, h = h7;

    for (let j = 0; j < 64; j++) {
      if (j < 16) {
        const idx = i + j * 4;
        w[j] = (utf8[idx] << 24) | (utf8[idx + 1] << 16) | (utf8[idx + 2] << 8) | utf8[idx + 3];
      } else {
        const s0 = (rotateRight(7, w[j - 15]) ^ rotateRight(18, w[j - 15]) ^ (w[j - 15] >>> 3)) | 0;
        const s1 = (rotateRight(17, w[j - 2]) ^ rotateRight(19, w[j - 2]) ^ (w[j - 2] >>> 10)) | 0;
        w[j] = (w[j - 16] + s0 + w[j - 7] + s1) | 0;
      }

      const s0 = (rotateRight(2, a) ^ rotateRight(13, a) ^ rotateRight(22, a)) | 0;
      const maj = ((a & b) ^ (a & c) ^ (b & c)) | 0;
      const t2 = (s0 + maj) | 0;
      const s1 = (rotateRight(6, e) ^ rotateRight(11, e) ^ rotateRight(25, e)) | 0;
      const ch = ((e & f) ^ (~e & g)) | 0;
      const t1 = (h + s1 + ch + k[j] + w[j]) | 0;

      h = g;
      g = f;
      f = e;
      e = (d + t1) | 0;
      d = c;
      c = b;
      b = a;
      a = (t1 + t2) | 0;
    }

    h0 = (h0 + a) | 0;
    h1 = (h1 + b) | 0;
    h2 = (h2 + c) | 0;
    h3 = (h3 + d) | 0;
    h4 = (h4 + e) | 0;
    h5 = (h5 + f) | 0;
    h6 = (h6 + g) | 0;
    h7 = (h7 + h) | 0;
  }

  const hex = (num: number) => ('00000000' + (num >>> 0).toString(16)).slice(-8);
  return hex(h0) + hex(h1) + hex(h2) + hex(h3) + hex(h4) + hex(h5) + hex(h6) + hex(h7);
}

export async function hashPin(pin: string, deviceId: string): Promise<string> {
  const input = `${deviceId || ''}:${pin}`;
  if (typeof crypto !== 'undefined' && crypto.subtle) {
    const data = new TextEncoder().encode(input);
    const hash = await crypto.subtle.digest('SHA-256', data);
    return Array.from(new Uint8Array(hash))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
  } else {
    return sha256Pure(input);
  }
}

export function isValidPin(pin: string): boolean {
  return /^\d{4,6}$/.test(pin);
}

export function isValidUsername(username: string): boolean {
  // 3-20 chars, alphanumeric + underscore + dot, no spaces
  return /^[a-zA-Z0-9_.]{3,20}$/.test(username);
}

// === Permissions ===
export { ALL_PERMISSIONS };
export type { PermissionKey };

export const PERMISSION_LABELS: Record<PermissionKey, { title: string; desc: string }> = {
  create_transaction: {
    title: 'Buat Transaksi',
    desc: 'Akses Kasir, simpan open bill, dan checkout pembayaran',
  },
  delete_transaction: {
    title: 'Hapus / Batalkan Transaksi',
    desc: 'Hapus transaksi di Riwayat dan batalkan open bill',
  },
  manage_products: {
    title: 'Kelola Produk',
    desc: 'Tambah, edit, dan hapus produk',
  },
  manage_categories_payments: {
    title: 'Kelola Kategori & Metode Bayar',
    desc: 'CRUD kategori produk dan metode pembayaran',
  },
  manage_stock_inout: {
    title: 'Stock In / Stock Out',
    desc: 'Catat barang masuk dari supplier dan barang keluar non-penjualan',
  },
  manage_supplier: {
    title: 'Kelola Supplier',
    desc: 'Tambah, edit, dan hapus data supplier',
  },
  view_reports: {
    title: 'Lihat Laporan & Profit',
    desc: 'Akses laporan penjualan, profit, HPP, dan laporan stok',
  },
  manage_backup: {
    title: 'Backup & Restore',
    desc: 'Export dan import data toko (restore dapat menimpa semua data)',
  },
  manage_store_settings: {
    title: 'Edit Info Toko & Tema',
    desc: 'Ubah nama toko, alamat, telepon, logo, warna tema',
  },
};

// Default permission set for new staff: create transaction only.
export const DEFAULT_STAFF_PERMISSIONS: PermissionKey[] = ['create_transaction'];

// Owner implicitly has every permission. This helper centralizes the check.
export function hasPermission(user: User | null, key: PermissionKey): boolean {
  if (!user) return false;
  if (user.role === 'owner') return true;
  return user.permissions.includes(key);
}

// Owner-only: managing other users.
export function canManageUsers(user: User | null): boolean {
  return user?.role === 'owner';
}

// === Login ===

export interface LoginResult {
  ok: boolean;
  user?: User;
  error?: string;
}

export async function login(username: string, pin: string): Promise<LoginResult> {
  const trimmed = username.trim().toLowerCase();
  if (!trimmed || !pin) return { ok: false, error: 'Username dan PIN wajib diisi' };

  const settings = await db.storeSettings.toCollection().first();
  if (!settings?.deviceId) return { ok: false, error: 'Pengaturan toko belum siap' };

  const user = await db.users.where('username').equals(trimmed).first();
  if (!user) return { ok: false, error: 'Username atau PIN salah' };
  if (!user.isActive) return { ok: false, error: 'Akun ini dinonaktifkan' };

  const hash = await hashPin(pin, settings.deviceId);
  if (hash !== user.pinHash) return { ok: false, error: 'Username atau PIN salah' };

  // Update lastLoginAt (best-effort, non-blocking semantics OK)
  await db.users.update(user.id!, { lastLoginAt: new Date() });

  return { ok: true, user: { ...user, lastLoginAt: new Date() } };
}

// === Session persistence (localStorage) ===

const SESSION_KEY = 'kasirgratisan_session_v1';

interface StoredSession {
  userId: number;
  deviceId: string; // bind session to device — invalidate if storage moved
}

export function saveSession(userId: number, deviceId: string): void {
  const data: StoredSession = { userId, deviceId };
  try {
    localStorage.setItem(SESSION_KEY, JSON.stringify(data));
  } catch {
    // localStorage may be full or disabled — silent failure, user re-logs next time
  }
}

export function clearSession(): void {
  try {
    localStorage.removeItem(SESSION_KEY);
  } catch {
    /* ignore */
  }
}

export async function restoreSession(): Promise<User | null> {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw) as StoredSession;
    if (!data?.userId || !data?.deviceId) return null;

    const settings = await db.storeSettings.toCollection().first();
    if (!settings?.deviceId || settings.deviceId !== data.deviceId) {
      // Device changed (e.g. import/restore from backup) — force re-login
      clearSession();
      return null;
    }

    const user = await db.users.get(data.userId);
    if (!user || !user.isActive) {
      clearSession();
      return null;
    }
    return user;
  } catch {
    clearSession();
    return null;
  }
}

// === User CRUD helpers ===

export async function createUser(input: {
  username: string;
  pin: string;
  name: string;
  role: 'owner' | 'staff';
  permissions: PermissionKey[];
}): Promise<{ ok: boolean; userId?: number; error?: string }> {
  const username = input.username.trim().toLowerCase();
  if (!isValidUsername(username)) {
    return { ok: false, error: 'Username 3-20 karakter, hanya huruf/angka/underscore' };
  }
  if (!isValidPin(input.pin)) {
    return { ok: false, error: 'PIN harus 4-6 digit angka' };
  }
  if (!input.name.trim()) {
    return { ok: false, error: 'Nama tidak boleh kosong' };
  }

  const settings = await db.storeSettings.toCollection().first();
  if (!settings?.deviceId) return { ok: false, error: 'Pengaturan toko belum siap' };

  const existing = await db.users.where('username').equals(username).first();
  if (existing) return { ok: false, error: `Username "${username}" sudah dipakai` };

  const pinHash = await hashPin(input.pin, settings.deviceId);
  const userId = await db.users.add({
    username,
    pinHash,
    name: input.name.trim(),
    role: input.role,
    permissions: input.role === 'owner' ? [] : input.permissions,
    isActive: 1,
    createdAt: new Date(),
    lastLoginAt: null,
  });

  return { ok: true, userId: userId as number };
}

export async function updateUserPin(userId: number, newPin: string): Promise<{ ok: boolean; error?: string }> {
  if (!isValidPin(newPin)) return { ok: false, error: 'PIN harus 4-6 digit angka' };
  const settings = await db.storeSettings.toCollection().first();
  if (!settings?.deviceId) return { ok: false, error: 'Pengaturan toko belum siap' };
  const pinHash = await hashPin(newPin, settings.deviceId);
  await db.users.update(userId, { pinHash });
  return { ok: true };
}
