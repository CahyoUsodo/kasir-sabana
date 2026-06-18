import { useLiveQuery } from 'dexie-react-hooks';
import { db, type PaymentMethod, type Category, type Unit } from '@/lib/db';
import { useState, useEffect, useRef } from 'react';
import { Settings, Store, CreditCard, Tag, Download, Upload, Plus, Trash2, Edit2, Info, Truck, ChevronRight, Receipt, Palette, HardDrive, Camera, X, Ruler, Users as UsersIcon, ShieldCheck, LogOut, Smartphone, CheckCircle2, Globe, Share2, CloudUpload, CloudDownload, KeyRound, Warehouse, DollarSign, RefreshCw } from 'lucide-react';
import ThemeColorPicker from '@/components/ThemeColorPicker';
import { setThemeColor } from '@/hooks/use-theme-color';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { InputOTP, InputOTPGroup, InputOTPSlot } from '@/components/ui/input-otp';
import PinVerificationDialog from '@/components/PinVerificationDialog';
import { toast } from 'sonner';
import { exportBackupData } from '@/components/BackupReminder';
import { performBackup, resolveCloudApiUrl } from '@/lib/backup';
import { compressImage } from '@/lib/image-utils';
import { APP_COMMIT_HASH, APP_VERSION, formatAppBuildTime } from '@/lib/app-version';
import { useAuth } from '@/hooks/use-auth';
import { createUser, hashPin, isValidPin, isValidUsername, saveSession } from '@/lib/auth';
import { usePWAInstall } from '@/hooks/use-pwa-install';
import { generateUUID } from '@/lib/utils';

export default function Pengaturan() {
  const buildInfoText = `v${APP_VERSION} • build ${APP_COMMIT_HASH}`;
  const buildTimeText = formatAppBuildTime();

  const reviveDates = (obj: any): any => {
    if (obj === null || obj === undefined) return obj;
    const isoRegex = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d*)?(?:[-+]\d{2}:?\d{2}|Z)?$/;
    if (typeof obj === 'string' && isoRegex.test(obj)) return new Date(obj);
    if (Array.isArray(obj)) return obj.map(reviveDates);
    if (typeof obj === 'object') {
      const newObj: any = {};
      for (const key in obj) newObj[key] = reviveDates(obj[key]);
      return newObj;
    }
    return obj;
  };

  const storeSettings = useLiveQuery(() => db.storeSettings.toCollection().first());
  const paymentMethods = useLiveQuery(() => db.paymentMethods.toArray());
  const categories = useLiveQuery(() => db.categories.where('isDeleted').equals(0).toArray());
  const usersCount = useLiveQuery(() => db.users.count());
  const units = useLiveQuery(() => db.units.where('isDeleted').equals(0).toArray());

  const { multiUserEnabled, currentUser, isOwner, can, logout } = useAuth();

  // PWA install
  const { canInstall, isInstalled, isIOS, install } = usePWAInstall();
  const [installHelpOpen, setInstallHelpOpen] = useState(false);
  const [isApplyingAppUpdate, setIsApplyingAppUpdate] = useState(false);

  // Multi-user activation
  const [activateOpen, setActivateOpen] = useState(false);
  const [actName, setActName] = useState('');
  const [actUsername, setActUsername] = useState('');
  const [actPin, setActPin] = useState('');
  const [actPinConfirm, setActPinConfirm] = useState('');
  const [activating, setActivating] = useState(false);

  // Disable multi-user confirmation
  const [disableOpen, setDisableOpen] = useState(false);

  // Logout confirmation
  const [logoutOpen, setLogoutOpen] = useState(false);

  // Store edit
  const [storeDialog, setStoreDialog] = useState(false);
  const [storeName, setStoreName] = useState('');
  const [storeAddr, setStoreAddr] = useState('');
  const [storePhone, setStorePhone] = useState('');
  const [storeLogo, setStoreLogo] = useState<string | undefined>(undefined);
  const logoInputRef = useRef<HTMLInputElement>(null);
  // Payment method
  const [pmDialog, setPmDialog] = useState(false);
  const [pmName, setPmName] = useState('');
  const [pmCategory, setPmCategory] = useState('tunai');
  const [pmEditId, setPmEditId] = useState<number | null>(null);

  // Category
  const [catDialog, setCatDialog] = useState(false);
  const [catName, setCatName] = useState('');
  const [catIcon, setCatIcon] = useState('📦');
  const [catColor, setCatColor] = useState('#FF6B35');
  const [catEditId, setCatEditId] = useState<number | null>(null);

  // Unit
  const [unitDialog, setUnitDialog] = useState(false);
  const [unitName, setUnitName] = useState('');
  const [unitEditId, setUnitEditId] = useState<number | null>(null);
  const [unitOriginalName, setUnitOriginalName] = useState('');
  const [unitDeleteTarget, setUnitDeleteTarget] = useState<Unit | null>(null);
  const [unitDeleteUsage, setUnitDeleteUsage] = useState(0);

  // Storage info (CR-9)
  const [storageUsage, setStorageUsage] = useState<{ usage: number; quota: number } | null>(null);
  useEffect(() => {
    if (navigator.storage?.estimate) {
      navigator.storage.estimate().then(est => {
        setStorageUsage({ usage: est.usage ?? 0, quota: est.quota ?? 0 });
      });
    }
  }, []);

  const [isBackingUp, setIsBackingUp] = useState(false);
  const [isRestoring, setIsRestoring] = useState(false);
  const [restoreDriveConfirmOpen, setRestoreDriveConfirmOpen] = useState(false);
  const [restoreFileConfirmOpen, setRestoreFileConfirmOpen] = useState(false);
  const pendingImportDataRef = useRef<any | null>(null);

  // Security PIN states
  const [tempFileId, setTempFileId] = useState('');
  const [pinManageOpen, setPinManageOpen] = useState(false);
  const [pinManageMode, setPinManageMode] = useState<'setup' | 'change' | 'disable'>('setup');
  const [pinStep, setPinStep] = useState<'verify_old' | 'enter_new' | 'confirm_new'>('enter_new');
  const [pinInput, setPinInput] = useState('');
  const [tempNewPin, setTempNewPin] = useState('');
  const [pinManageError, setPinManageError] = useState('');
  const [pinVerifyOpen, setPinVerifyOpen] = useState(false);
  const [pinVerifyTitle, setPinVerifyTitle] = useState('Verifikasi PIN Otorisasi');
  const [pinVerifyDesc, setPinVerifyDesc] = useState('Masukkan PIN keamanan 6 angka untuk menyetujui tindakan ini.');
  const pinCallbackRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    if (storeSettings?.googleDriveFileId !== undefined) {
      setTempFileId(storeSettings.googleDriveFileId || '');
    }
  }, [storeSettings?.googleDriveFileId]);

  const runWithPinGate = (action: () => void, title?: string, desc?: string) => {
    if (storeSettings?.securityPin) {
      pinCallbackRef.current = action;
      if (title) setPinVerifyTitle(title);
      else setPinVerifyTitle('Verifikasi PIN Otorisasi');
      if (desc) setPinVerifyDesc(desc);
      else setPinVerifyDesc('Masukkan PIN keamanan 6 angka untuk menyetujui tindakan ini.');
      setPinVerifyOpen(true);
    } else {
      action();
    }
  };

  const handleAppRefresh = async () => {
    const pwaWindow = window as Window & {
      __applyPwaUpdate__?: () => Promise<void>;
      __hasPendingPwaUpdate__?: boolean;
    };

    try {
      setIsApplyingAppUpdate(true);

      if (pwaWindow.__hasPendingPwaUpdate__ && pwaWindow.__applyPwaUpdate__) {
        toast.info('Menerapkan versi aplikasi terbaru...');
        await pwaWindow.__applyPwaUpdate__();
        return;
      }

      toast.info('Memeriksa pembaruan aplikasi...');
      window.location.reload();
    } finally {
      setIsApplyingAppUpdate(false);
    }
  };

  const backupHasEssentialData = (data: any) =>
    ['categories', 'products', 'suppliers', 'transactions', 'paymentMethods'].some(
      key => Array.isArray(data[key]) && data[key].length > 0
    );

  const restoreBackupData = async (data: any) => {
    await db.transaction('rw', [
      db.categories,
      db.products,
      db.suppliers,
      db.stockIns,
      db.stockOuts,
      db.hppHistory,
      db.paymentMethods,
      db.transactions,
      db.transactionItems,
      db.storeSettings,
      db.users,
      db.units,
      db.warehouseItems,
      db.productRecipes,
      db.productOptionGroups,
      db.productOptions,
      db.productOptionRecipes,
      db.dailyPrepFormulas,
      db.dailyExpenses,
      db.warehouseUsageLogs,
    ], async () => {
      await db.categories.clear();
      await db.products.clear();
      await db.suppliers.clear();
      await db.stockIns.clear();
      await db.stockOuts.clear();
      await db.hppHistory.clear();
      await db.paymentMethods.clear();
      await db.transactions.clear();
      await db.transactionItems.clear();
      await db.storeSettings.clear();
      await db.users.clear();
      await db.units.clear();
      await db.warehouseItems.clear();
      await db.productRecipes.clear();
      await db.productOptionGroups.clear();
      await db.productOptions.clear();
      await db.productOptionRecipes.clear();
      await db.dailyPrepFormulas.clear();
      await db.dailyExpenses.clear();
      await db.warehouseUsageLogs.clear();

      if (data.categories?.length) await db.categories.bulkAdd(data.categories);
      if (data.products?.length) await db.products.bulkAdd(data.products);
      if (data.suppliers?.length) await db.suppliers.bulkAdd(data.suppliers);
      if (data.stockIns?.length) await db.stockIns.bulkAdd(data.stockIns);
      if (data.stockOuts?.length) await db.stockOuts.bulkAdd(data.stockOuts);
      if (data.hppHistory?.length) await db.hppHistory.bulkAdd(data.hppHistory);
      if (data.paymentMethods?.length) await db.paymentMethods.bulkAdd(data.paymentMethods);
      if (data.transactions?.length) await db.transactions.bulkAdd(data.transactions);
      if (data.storeSettings?.length) await db.storeSettings.bulkAdd(data.storeSettings);
      if (data.users?.length) await db.users.bulkAdd(data.users);
      if (data.warehouseItems?.length) await db.warehouseItems.bulkAdd(data.warehouseItems);
      if (data.productRecipes?.length) await db.productRecipes.bulkAdd(data.productRecipes);
      if (data.productOptionGroups?.length) await db.productOptionGroups.bulkAdd(data.productOptionGroups);
      if (data.productOptions?.length) await db.productOptions.bulkAdd(data.productOptions);
      if (data.productOptionRecipes?.length) await db.productOptionRecipes.bulkAdd(data.productOptionRecipes);
      if (data.dailyPrepFormulas?.length) await db.dailyPrepFormulas.bulkAdd(data.dailyPrepFormulas);
      if (data.dailyExpenses?.length) await db.dailyExpenses.bulkAdd(data.dailyExpenses);
      if (data.warehouseUsageLogs?.length) await db.warehouseUsageLogs.bulkAdd(data.warehouseUsageLogs);

      if (Array.isArray(data.units) && data.units.length > 0) {
        await db.units.bulkAdd(data.units);
      } else {
        const now = new Date();
        const defaults = ['pcs', 'kg', 'gram', 'liter', 'ml', 'porsi', 'cup', 'botol', 'bungkus'];
        const seen = new Set<string>();
        const toAdd: any[] = [];

        for (const name of defaults) {
          seen.add(name);
          toAdd.push({ name, isDefault: 1, createdAt: now, isDeleted: 0, deletedAt: null });
        }

        if (Array.isArray(data.products)) {
          for (const p of data.products) {
            const unit = (p?.unit as string | undefined)?.trim();
            if (!unit || seen.has(unit)) continue;
            seen.add(unit);
            toAdd.push({ name: unit, isDefault: 0, createdAt: now, isDeleted: 0, deletedAt: null });
          }
        }

        if (toAdd.length > 0) {
          await db.units.bulkAdd(toAdd);
        }
      }

      if (data.transactionItems?.length) {
        await db.transactionItems.bulkAdd(data.transactionItems);
      } else if (data.version === 1 && data.transactions?.length) {
        for (const transaction of data.transactions) {
          if (!Array.isArray(transaction.items) || transaction.items.length === 0) continue;

          const itemRecords = transaction.items.map((item: any) => ({
            transactionId: transaction.id,
            productId: item.productId,
            productName: item.productName,
            quantity: item.quantity,
            price: item.price,
            hpp: item.hpp,
            discountType: item.discountType,
            discountValue: item.discountValue,
            discountAmount: item.discountAmount,
            subtotal: item.subtotal,
          }));

          await db.transactionItems.bulkAdd(itemRecords);
        }
      }
    });
  };

  const openPinSetup = () => {
    setPinManageMode('setup');
    setPinStep('enter_new');
    setPinInput('');
    setTempNewPin('');
    setPinManageError('');
    setPinManageOpen(true);
  };

  const openPinChange = () => {
    setPinManageMode('change');
    setPinStep('verify_old');
    setPinInput('');
    setTempNewPin('');
    setPinManageError('');
    setPinManageOpen(true);
  };

  const openPinDisable = () => {
    setPinManageMode('disable');
    setPinStep('verify_old');
    setPinInput('');
    setTempNewPin('');
    setPinManageError('');
    setPinManageOpen(true);
  };

  const handlePinManageOTPChange = async (val: string) => {
    setPinInput(val);
    setPinManageError('');

    if (val.length === 6) {
      try {
        let currentSettings = storeSettings;
        if (!currentSettings || !currentSettings.id) {
          currentSettings = await db.storeSettings.toCollection().first();
        }
        if (!currentSettings) {
          const deviceId = generateUUID();
          const newId = await db.storeSettings.add({
            storeName: 'Toko Saya',
            address: '',
            phone: '',
            receiptFooter: 'Terima kasih atas kunjungan Anda!',
            onboardingDone: false,
            lastBackupAt: null,
            deviceId: deviceId,
          });
          currentSettings = {
            id: newId,
            storeName: 'Toko Saya',
            address: '',
            phone: '',
            receiptFooter: 'Terima kasih atas kunjungan Anda!',
            onboardingDone: false,
            lastBackupAt: null,
            deviceId: deviceId,
          };
        }

        const deviceId = currentSettings.deviceId || generateUUID();
        if (!currentSettings.deviceId) {
          await db.storeSettings.update(currentSettings.id!, { deviceId });
          currentSettings.deviceId = deviceId;
        }

        if (pinStep === 'verify_old') {
          const hashed = await hashPin(val, deviceId);
          if (hashed === currentSettings.securityPin) {
            if (pinManageMode === 'change') {
              setPinStep('enter_new');
              setPinInput('');
            } else if (pinManageMode === 'disable') {
              if (document.activeElement instanceof HTMLElement) {
                document.activeElement.blur();
              }
              setPinManageOpen(false);
              const settingsId = currentSettings.id!;
              setTimeout(async () => {
                try {
                  await db.storeSettings.update(settingsId, { securityPin: undefined });
                  toast.success('PIN Otorisasi berhasil dinonaktifkan');
                } catch (err: any) {
                  console.error('Error disabling PIN:', err);
                  toast.error('Gagal menonaktifkan PIN');
                }
              }, 150);
            }
          } else {
            setPinManageError('PIN lama salah');
            setPinInput('');
          }
        } else if (pinStep === 'enter_new') {
          setTempNewPin(val);
          setPinStep('confirm_new');
          setPinInput('');
        } else if (pinStep === 'confirm_new') {
          if (val === tempNewPin) {
            if (document.activeElement instanceof HTMLElement) {
              document.activeElement.blur();
            }
            setPinManageOpen(false);
            const settingsId = currentSettings.id!;
            const mode = pinManageMode;
            setTimeout(async () => {
              try {
                const hashed = await hashPin(val, deviceId);
                await db.storeSettings.update(settingsId, { securityPin: hashed });
                toast.success(mode === 'setup' ? 'PIN Otorisasi berhasil diaktifkan' : 'PIN Otorisasi berhasil diubah');
              } catch (err: any) {
                console.error('Error updating PIN:', err);
                toast.error('Gagal menyimpan PIN baru');
              }
            }, 150);
          } else {
            setPinManageError('Konfirmasi PIN tidak cocok. Silakan ulangi.');
            setPinInput('');
            setPinStep('enter_new');
            setTempNewPin('');
          }
        }
      } catch (err: any) {
        console.error('Error handling PIN management:', err);
        setPinManageError('Gagal memproses PIN');
        toast.error('Gagal memproses PIN: ' + (err.message || err));
      }
    }
  };

  const handleManualBackup = async () => {
    setIsBackingUp(true);
    try {
      await performBackup();
      toast.success('Backup berhasil disimpan ke Google Drive!');
    } catch (error: any) {
      toast.error(error.message || 'Gagal melakukan backup');
    } finally {
      setIsBackingUp(false);
    }
  };

  const handleRestoreFromDrive = async () => {
    const fileId = storeSettings?.googleDriveFileId;
    if (!fileId || !fileId.trim()) {
      toast.error('Masukkan Google Drive File ID terlebih dahulu');
      return;
    }
    if (!navigator.onLine) {
      toast.error('Tidak ada koneksi internet');
      return;
    }
    setRestoreDriveConfirmOpen(true);
  };

  const confirmRestoreFromDrive = () => {
    runWithPinGate(
      async () => {
        const fileId = storeSettings?.googleDriveFileId;
        if (!fileId || !fileId.trim()) {
          toast.error('Masukkan Google Drive File ID terlebih dahulu');
          return;
        }
        setIsRestoring(true);
        try {
          const apiUrl = resolveCloudApiUrl('/api/restore');

          const response = await fetch(apiUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ fileId: fileId.trim() })
          });

          if (!response.ok) {
            let errorMessage = 'Gagal mengambil data dari Google Drive.';
            try {
              const errData = await response.json();
              if (errData.error) errorMessage = errData.error;
            } catch { /* ignore */ }
            throw new Error(errorMessage);
          }

          const responseRes = await response.json();
          const data = reviveDates(responseRes.backupData);

          if (!data || !data.version) {
            throw new Error('Data dari Google Drive tidak valid');
          }

          if (!backupHasEssentialData(data)) {
            throw new Error('File backup tidak berisi data');
          }

          await restoreBackupData(data);
          toast.success('Data berhasil di-restore dari Google Drive!');
        } catch (error: any) {
          toast.error(error.message || 'Gagal restore dari Google Drive');
        } finally {
          setIsRestoring(false);
          setRestoreDriveConfirmOpen(false);
        }
      },
      'Verifikasi PIN Restore GDrive',
      'Masukkan PIN keamanan 6 angka untuk menyetujui restore data dari Google Drive.'
    );
  };

  const openStoreEdit = () => {
    setStoreName(storeSettings?.storeName ?? '');
    setStoreAddr(storeSettings?.address ?? '');
    setStorePhone(storeSettings?.phone ?? '');
    setStoreLogo(storeSettings?.logo);
    setStoreDialog(true);
  };

  const saveStore = async () => {
    if (storeSettings?.id) {
      await db.storeSettings.update(storeSettings.id, { storeName: storeName.trim(), address: storeAddr.trim(), phone: storePhone.trim(), logo: storeLogo || undefined });
      toast.success('Info toko disimpan');
      setStoreDialog(false);
    }
  };

  const handleLogoSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      toast.error('File harus berupa gambar');
      return;
    }
    try {
      const compressed = await compressImage(file);
      setStoreLogo(compressed);
    } catch {
      toast.error('Gagal memproses gambar');
    }
    if (logoInputRef.current) logoInputRef.current.value = '';
  };

  // === Multi-user activation ===

  const openActivateDialog = () => {
    setActName('');
    setActUsername('');
    setActPin('');
    setActPinConfirm('');
    setActivateOpen(true);
  };

  const handleActivateMultiUser = async () => {
    if (!storeSettings?.id) return;
    if (!actName.trim()) { toast.error('Nama pemilik wajib diisi'); return; }
    if (!isValidUsername(actUsername)) {
      toast.error('Username 3-20 karakter, hanya huruf/angka/underscore');
      return;
    }
    if (!isValidPin(actPin)) {
      toast.error('PIN harus 4-6 digit angka');
      return;
    }
    if (actPin !== actPinConfirm) {
      toast.error('Konfirmasi PIN tidak cocok');
      return;
    }

    setActivating(true);
    try {
      // Check if owner already exists (idempotent — safety net)
      const existingOwner = await db.users.where('role').equals('owner').first();
      let ownerId = existingOwner?.id;

      if (!existingOwner) {
        const result = await createUser({
          username: actUsername,
          pin: actPin,
          name: actName,
          role: 'owner',
          permissions: [],
        });
        if (!result.ok) {
          toast.error(result.error || 'Gagal membuat akun pemilik');
          return;
        }
        ownerId = result.userId;
      }

      // Flip the flag
      await db.storeSettings.update(storeSettings.id, { multiUserEnabled: true });

      // Persist session for the owner so they stay logged in immediately
      if (ownerId && storeSettings.deviceId) {
        saveSession(ownerId, storeSettings.deviceId);
      }

      toast.success('Multi-user aktif. Anda login sebagai pemilik.');
      setActivateOpen(false);
      // Reload so AuthProvider picks up the new session + flag from a clean state.
      window.location.reload();
    } finally {
      setActivating(false);
    }
  };

  const handleDisableMultiUser = async () => {
    if (!storeSettings?.id) return;
    await db.storeSettings.update(storeSettings.id, { multiUserEnabled: false });
    setDisableOpen(false);
    toast.success('Multi-user dinonaktifkan');
    // Force reload so AuthProvider re-evaluates state.
    window.location.reload();
  };

  const handleLogout = () => {
    logout();
    setLogoutOpen(false);
    // Reload to drop any in-memory state and route back to login screen cleanly.
    window.location.reload();
  };

  const openPmAdd = () => { setPmEditId(null); setPmName(''); setPmCategory('tunai'); setPmDialog(true); };
  const openPmEdit = (pm: PaymentMethod) => { setPmEditId(pm.id!); setPmName(pm.name); setPmCategory(pm.category); setPmDialog(true); };
  const savePm = async () => {
    if (!pmName.trim()) return;
    if (pmEditId) await db.paymentMethods.update(pmEditId, { name: pmName.trim(), category: pmCategory });
    else await db.paymentMethods.add({ name: pmName.trim(), category: pmCategory, isDefault: false, createdAt: new Date() });
    setPmDialog(false);
    toast.success('Metode pembayaran disimpan');
  };
  const deletePm = async (id: number) => { await db.paymentMethods.delete(id); toast.success('Dihapus'); };

  const openCatAdd = () => { setCatEditId(null); setCatName(''); setCatIcon('📦'); setCatColor('#FF6B35'); setCatDialog(true); };
  const openCatEdit = (c: Category) => { setCatEditId(c.id!); setCatName(c.name); setCatIcon(c.icon); setCatColor(c.color); setCatDialog(true); };
  const saveCat = async () => {
    if (!catName.trim()) return;
    if (catEditId) await db.categories.update(catEditId, { name: catName.trim(), icon: catIcon, color: catColor });
    else await db.categories.add({ name: catName.trim(), icon: catIcon, color: catColor, createdAt: new Date(), isDeleted: 0, deletedAt: null });
    setCatDialog(false);
    toast.success('Kategori disimpan');
  };
  const deleteCat = async (id: number) => { await db.categories.update(id, { isDeleted: 1, deletedAt: new Date() }); toast.success('Dihapus'); };

  const openUnitAdd = () => {
    setUnitEditId(null);
    setUnitName('');
    setUnitOriginalName('');
    setUnitDialog(true);
  };
  const openUnitEdit = (u: Unit) => {
    setUnitEditId(u.id!);
    setUnitName(u.name);
    setUnitOriginalName(u.name);
    setUnitDialog(true);
  };
  const saveUnit = async () => {
    const name = unitName.trim();
    if (!name) return;

    // Uniqueness check (active units only — soft-deleted records still occupy &name index,
    // but we want to surface a clearer message on conflict)
    const existing = await db.units.where('name').equals(name).first();
    if (existing && existing.id !== unitEditId) {
      if (existing.isDeleted === 1) {
        toast.error(`Satuan "${name}" pernah dihapus. Pakai nama lain atau pulihkan via backup.`);
      } else {
        toast.error(`Satuan "${name}" sudah ada`);
      }
      return;
    }

    try {
      if (unitEditId) {
        await db.units.update(unitEditId, { name });
        // Cascade rename to all products using the old name so the dropdown stays consistent
        if (unitOriginalName && unitOriginalName !== name) {
          await db.products.where('unit').equals(unitOriginalName).modify({ unit: name, updatedAt: new Date() });
        }
      } else {
        await db.units.add({
          name,
          isDefault: 0,
          createdAt: new Date(),
          isDeleted: 0,
          deletedAt: null,
        });
      }
      setUnitDialog(false);
      toast.success('Satuan disimpan');
    } catch {
      toast.error('Gagal menyimpan satuan');
    }
  };
  const requestDeleteUnit = async (u: Unit) => {
    const usage = await db.products.filter(p => p.unit === u.name && p.isDeleted === 0).count();
    setUnitDeleteUsage(usage);
    setUnitDeleteTarget(u);
  };
  const confirmDeleteUnit = async () => {
    if (!unitDeleteTarget?.id) return;
    await db.units.update(unitDeleteTarget.id, { isDeleted: 1, deletedAt: new Date() });
    setUnitDeleteTarget(null);
    toast.success('Satuan dihapus');
  };

  const handleImport = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    input.onchange = async (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;
      try {
        const text = await file.text();
        if (!text.trim()) { toast.error('File kosong'); return; }
        const data = reviveDates(JSON.parse(text));
        if (!data.version) { toast.error('File tidak valid'); return; }

        if (!backupHasEssentialData(data)) { toast.error('File backup tidak berisi data'); return; }

        pendingImportDataRef.current = data;
        setRestoreFileConfirmOpen(true);
      } catch { toast.error('Gagal membaca file'); }
    };
    input.click();
  };

  const confirmRestoreFromFile = () => {
    const data = pendingImportDataRef.current;
    if (!data) {
      toast.error('Data backup tidak ditemukan');
      setRestoreFileConfirmOpen(false);
      return;
    }

    runWithPinGate(
      async () => {
        setIsRestoring(true);
        try {
          await restoreBackupData(data);
          toast.success('Data berhasil di-restore!');
        } catch (importErr: any) {
          toast.error(importErr?.message || 'Import gagal');
        } finally {
          setIsRestoring(false);
          setRestoreFileConfirmOpen(false);
          pendingImportDataRef.current = null;
        }
      },
      'Verifikasi PIN Import',
      'Masukkan PIN keamanan 6 angka untuk menyetujui restore data dari file.'
    );
  };

  const emojiOptions = ['📦', '🍕', '🥤', '🍜', '🧃', '🎽', '💊', '🧹', '📱', '🛒', '🎁', '✂️'];

  const formatBytes = (bytes: number): string => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
  };

  return (
    <div className="px-4 pt-6 pb-4 space-y-5">
      <h1 className="text-xl font-bold flex items-center gap-2">
        <Settings className="w-5 h-5 text-primary" />
        Pengaturan
      </h1>

      {/* Store Info */}
      <Card
        className={`border-0 shadow-sm ${can('manage_store_settings') ? 'cursor-pointer' : 'cursor-default opacity-90'}`}
        onClick={() => can('manage_store_settings') && openStoreEdit()}
      >
        <CardContent className="p-4 flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-primary/10 text-primary flex items-center justify-center overflow-hidden shrink-0">
            {storeSettings?.logo ? (
              <img src={storeSettings.logo} alt="Logo" className="w-full h-full object-cover" />
            ) : (
              <Store className="w-5 h-5" />
            )}
          </div>
          <div className="flex-1">
            <p className="text-sm font-semibold">{storeSettings?.storeName || 'Toko Saya'}</p>
            <p className="text-xs text-muted-foreground">{storeSettings?.address || 'Belum diatur'}</p>
          </div>
          {can('manage_store_settings') && <Edit2 className="w-4 h-4 text-muted-foreground" />}
        </CardContent>
      </Card>

      {/* Install as App removed per user request */}

      {/* Karyawan & Akses (current user / multi-user activation) */}
      {multiUserEnabled && currentUser ? (
        <Card className="border-0 shadow-sm">
          <CardContent className="p-4 flex items-center gap-3">
            <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${currentUser.role === 'owner' ? 'bg-primary/10 text-primary' : 'bg-accent/10 text-accent'}`}>
              <ShieldCheck className="w-5 h-5" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold truncate">{currentUser.name}</p>
              <p className="text-[10px] text-muted-foreground">
                @{currentUser.username} · {currentUser.role === 'owner' ? 'Pemilik' : 'Karyawan'}
              </p>
            </div>
            <Button variant="ghost" size="sm" className="h-8 text-xs gap-1 text-destructive" onClick={() => setLogoutOpen(true)}>
              <LogOut className="w-3.5 h-3.5" />
              Keluar
            </Button>
          </CardContent>
        </Card>
      ) : null}

      {/* Karyawan & Akses links/activation removed per user request */}

      {/* Transaksi & Stok */}
      <div className="space-y-2">
        <h2 className="text-sm font-semibold text-muted-foreground">Transaksi & Stok</h2>
        <Link to="/history" className="block">
          <Card className="border-0 shadow-sm cursor-pointer hover:shadow-md transition-shadow">
            <CardContent className="p-3 flex items-center gap-3">
              <div className="w-9 h-9 rounded-lg bg-primary/10 text-primary flex items-center justify-center"><Receipt className="w-4 h-4" /></div>
              <div className="flex-1"><p className="text-sm font-semibold">Riwayat Transaksi</p><p className="text-[10px] text-muted-foreground">Lihat semua transaksi & cetak ulang struk</p></div>
              <ChevronRight className="w-4 h-4 text-muted-foreground" />
            </CardContent>
          </Card>
        </Link>
        {/* Supplier removed per user request */}
        <Link to="/warehouse" className="block">
          <Card className="border-0 shadow-sm cursor-pointer hover:shadow-md transition-shadow">
            <CardContent className="p-3 flex items-center gap-3">
              <div className="w-9 h-9 rounded-lg bg-primary/10 text-primary flex items-center justify-center"><Warehouse className="w-4 h-4" /></div>
              <div className="flex-1"><p className="text-sm font-semibold">Stok Gudang & Resep</p><p className="text-[10px] text-muted-foreground">Persiapan harian ayam & resep bahan baku</p></div>
              <ChevronRight className="w-4 h-4 text-muted-foreground" />
            </CardContent>
          </Card>
        </Link>
        <Link to="/daily-expenses" className="block">
          <Card className="border-0 shadow-sm cursor-pointer hover:shadow-md transition-shadow">
            <CardContent className="p-3 flex items-center gap-3">
              <div className="w-9 h-9 rounded-lg bg-primary/10 text-primary flex items-center justify-center"><DollarSign className="w-4 h-4" /></div>
              <div className="flex-1"><p className="text-sm font-semibold">Pengeluaran Harian</p><p className="text-[10px] text-muted-foreground">Catat pengeluaran cabang & pemakaian stok manual</p></div>
              <ChevronRight className="w-4 h-4 text-muted-foreground" />
            </CardContent>
          </Card>
        </Link>
      </div>

      {/* Payment Methods */}
      {can('manage_categories_payments') && (
      <Card className="border-0 shadow-sm">
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm flex items-center gap-1.5"><CreditCard className="w-4 h-4" /> Metode Pembayaran</CardTitle>
            <Button variant="ghost" size="sm" className="h-7 text-xs gap-1" onClick={openPmAdd}><Plus className="w-3 h-3" />Tambah</Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-1">
          {paymentMethods?.map(pm => (
            <div key={pm.id} className="flex items-center justify-between py-1.5">
              <div>
                <p className="text-sm font-medium">{pm.name}</p>
                <p className="text-[10px] text-muted-foreground capitalize">{pm.category}</p>
              </div>
              <div className="flex gap-1">
                <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => openPmEdit(pm)}><Edit2 className="w-3 h-3" /></Button>
                <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive" onClick={() => deletePm(pm.id!)}><Trash2 className="w-3 h-3" /></Button>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>
      )}

      {/* Categories */}
      {can('manage_categories_payments') && (
      <Card className="border-0 shadow-sm">
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm flex items-center gap-1.5"><Tag className="w-4 h-4" /> Kategori Produk</CardTitle>
            <Button variant="ghost" size="sm" className="h-7 text-xs gap-1" onClick={openCatAdd}><Plus className="w-3 h-3" />Tambah</Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-1">
          {categories?.map(c => (
            <div key={c.id} className="flex items-center justify-between py-1.5">
              <div className="flex items-center gap-2">
                <span className="w-6 h-6 rounded flex items-center justify-center text-sm" style={{ backgroundColor: c.color + '20' }}>{c.icon}</span>
                <span className="text-sm font-medium">{c.name}</span>
              </div>
              <div className="flex gap-1">
                <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => openCatEdit(c)}><Edit2 className="w-3 h-3" /></Button>
                <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive" onClick={() => deleteCat(c.id!)}><Trash2 className="w-3 h-3" /></Button>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>
      )}

      {/* Units */}
      <Card className="border-0 shadow-sm">
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm flex items-center gap-1.5"><Ruler className="w-4 h-4" /> Satuan</CardTitle>
            <Button variant="ghost" size="sm" className="h-7 text-xs gap-1" onClick={openUnitAdd}><Plus className="w-3 h-3" />Tambah</Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-1">
          {units && units.length === 0 && (
            <p className="text-xs text-muted-foreground py-1.5">Belum ada satuan</p>
          )}
          {units?.map(u => (
            <div key={u.id} className="flex items-center justify-between py-1.5">
              <span className="text-sm font-medium">{u.name}</span>
              <div className="flex gap-1">
                <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => openUnitEdit(u)}><Edit2 className="w-3 h-3" /></Button>
                <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive" onClick={() => requestDeleteUnit(u)}><Trash2 className="w-3 h-3" /></Button>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>



      {/* PIN Otorisasi */}
      {isOwner && (
        <Card className="border-0 shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-1.5">
              <KeyRound className="w-4 h-4 text-primary" /> PIN Otorisasi
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium">Status PIN Otorisasi</p>
                <p className="text-xs text-muted-foreground font-normal">
                  {storeSettings?.securityPin
                    ? 'Aktif (Melindungi hapus transaksi, ubah GDrive ID, restore data)'
                    : 'Tidak Aktif (Tindakan sensitif tidak dilindungi PIN)'}
                </p>
              </div>
              <Badge variant={storeSettings?.securityPin ? 'default' : 'secondary'} className="text-xs">
                {storeSettings?.securityPin ? 'Aktif' : 'Nonaktif'}
              </Badge>
            </div>
            <div className="flex gap-2">
              {!storeSettings?.securityPin ? (
                <Button className="w-full h-10 text-sm gap-2" onClick={openPinSetup}>
                  Aktifkan PIN Otorisasi
                </Button>
              ) : (
                <>
                  <Button variant="outline" className="flex-1 h-10 text-sm gap-2" onClick={openPinChange}>
                    Ubah PIN
                  </Button>
                  <Button variant="outline" className="flex-1 h-10 text-sm gap-2 text-destructive border-destructive/20 hover:bg-destructive/5" onClick={openPinDisable}>
                    Nonaktifkan
                  </Button>
                </>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Backup & Restore */}
      {can('manage_backup') && (
      <Card className="border-0 shadow-sm">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-1.5"><Download className="w-4 h-4" /> Backup & Restore</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1.5">
            <Label className="text-xs">Google Drive File ID (Bypass Error Service Account & Multi-Cabang)</Label>
            <div className="flex gap-2">
              <Input 
                value={tempFileId} 
                onChange={(e) => setTempFileId(e.target.value)}
                placeholder="Masukkan ID File Docs (opsional)" 
                className="h-9 text-xs flex-1"
              />
              {tempFileId !== (storeSettings?.googleDriveFileId || '') && (
                <Button 
                  size="sm" 
                  className="h-9 text-xs" 
                  onClick={() => {
                    runWithPinGate(
                      async () => {
                        if (storeSettings?.id) {
                          await db.storeSettings.update(storeSettings.id, { googleDriveFileId: tempFileId.trim() });
                          toast.success('Google Drive File ID disimpan');
                        }
                      },
                      'Verifikasi PIN Pengaturan',
                      'Masukkan PIN keamanan 6 angka untuk mengubah Google Drive File ID.'
                    );
                  }}
                >
                  Simpan
                </Button>
              )}
            </div>
            <p className="text-[10px] text-muted-foreground leading-tight">Jika diisi, backup akan menimpa file ini. Sangat berguna jika Anda memiliki beberapa cabang agar backup tidak saling tertimpa (tiap cabang beda ID File).</p>
          </div>
          <div className="space-y-2">
            <Button variant="outline" className="w-full h-10 text-sm gap-2" onClick={exportBackupData}>
              <Download className="w-4 h-4" /> Export Backup (Manual)
            </Button>
            <Button variant="outline" className="w-full h-10 text-sm gap-2" onClick={handleImport}>
              <Upload className="w-4 h-4" /> Import / Restore Data (File)
            </Button>
            <Button 
              variant="outline" 
              className="w-full h-10 text-sm gap-2" 
              onClick={handleRestoreFromDrive}
              disabled={isRestoring || !storeSettings?.googleDriveFileId}
            >
              <CloudDownload className="w-4 h-4" /> {isRestoring ? 'Mengunduh...' : 'Restore dari Google Drive'}
            </Button>
            <Button 
              variant="default" 
              className="w-full h-10 text-sm gap-2" 
              onClick={handleManualBackup}
              disabled={isBackingUp}
            >
              <CloudUpload className="w-4 h-4" /> {isBackingUp ? 'Menyimpan...' : 'Backup ke Google Drive Sekarang'}
            </Button>
            {(storeSettings?.lastCloudBackupAt || storeSettings?.lastBackupAt) && (
              <p className="text-[10px] text-muted-foreground text-center">
                Terakhir backup cloud: {new Date(storeSettings?.lastCloudBackupAt || storeSettings?.lastBackupAt || new Date()).toLocaleString('id-ID')}
              </p>
            )}
          </div>
        </CardContent>
      </Card>
      )}

      {/* Storage Info */}
      <Card className="border-0 shadow-sm">
        <CardContent className="p-4">
           {storageUsage && (
             <div>
               <div className="flex items-center justify-center gap-1.5 text-xs text-muted-foreground mb-1.5">
                 <HardDrive className="w-3.5 h-3.5" />
                 <span>Penyimpanan Terpakai</span>
               </div>
               <p className="text-xs font-semibold text-center">
                 {formatBytes(storageUsage.usage)} / {formatBytes(storageUsage.quota)}
               </p>
               <div className="w-full h-1.5 bg-muted rounded-full mt-1.5 overflow-hidden">
                 <div
                   className="h-full bg-primary rounded-full transition-all"
                   style={{ width: `${Math.min(100, (storageUsage.usage / storageUsage.quota) * 100)}%` }}
                 />
               </div>
             </div>
           )}
        </CardContent>
      </Card>

      <div className="pb-2 text-center text-[11px] leading-relaxed text-muted-foreground">
        <div className="mb-3">
          <Button
            variant="outline"
            className="h-9 text-xs gap-2"
            onClick={handleAppRefresh}
            disabled={isApplyingAppUpdate}
          >
            <RefreshCw className={isApplyingAppUpdate ? 'w-3.5 h-3.5 animate-spin' : 'w-3.5 h-3.5'} />
            {isApplyingAppUpdate ? 'Memperbarui Aplikasi...' : 'Perbarui Aplikasi'}
          </Button>
        </div>
        <p>Versi aplikasi {buildInfoText}</p>
        <p>Build {buildTimeText}</p>
      </div>

      {/* Install Help Dialog */}
      <Dialog open={installHelpOpen} onOpenChange={setInstallHelpOpen}>
        <DialogContent className="max-w-[95vw] rounded-xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Smartphone className="w-5 h-5 text-primary" />
              Cara Install Aplikasi
            </DialogTitle>
            <DialogDescription>
              Browser kamu belum menampilkan tombol install otomatis. Ikuti langkah berikut sesuai perangkat.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 mt-2">
            {isIOS ? (
              <div className="space-y-3">
                <div className="flex items-start gap-3">
                  <div className="w-7 h-7 rounded-full bg-primary/10 text-primary flex items-center justify-center shrink-0 text-xs font-bold">1</div>
                  <p className="text-sm flex-1">
                    Buka aplikasi ini di browser <strong>Safari</strong> (bukan Chrome).
                  </p>
                </div>
                <div className="flex items-start gap-3">
                  <div className="w-7 h-7 rounded-full bg-primary/10 text-primary flex items-center justify-center shrink-0 text-xs font-bold">2</div>
                  <p className="text-sm flex-1">
                    Ketuk tombol <Share2 className="w-3.5 h-3.5 inline mx-0.5" /> <strong>Share</strong> di bawah layar.
                  </p>
                </div>
                <div className="flex items-start gap-3">
                  <div className="w-7 h-7 rounded-full bg-primary/10 text-primary flex items-center justify-center shrink-0 text-xs font-bold">3</div>
                  <p className="text-sm flex-1">
                    Pilih <strong>"Add to Home Screen"</strong>, lalu ketuk <strong>Add</strong>.
                  </p>
                </div>
              </div>
            ) : (
              <div className="space-y-3">
                <div className="flex items-start gap-3">
                  <div className="w-7 h-7 rounded-full bg-primary/10 text-primary flex items-center justify-center shrink-0 text-xs font-bold">1</div>
                  <p className="text-sm flex-1">
                    Buka aplikasi ini di browser <strong>Chrome</strong> atau <strong>Edge</strong>.
                  </p>
                </div>
                <div className="flex items-start gap-3">
                  <div className="w-7 h-7 rounded-full bg-primary/10 text-primary flex items-center justify-center shrink-0 text-xs font-bold">2</div>
                  <p className="text-sm flex-1">
                    Ketuk menu <strong>(⋮)</strong> di pojok kanan atas browser.
                  </p>
                </div>
                <div className="flex items-start gap-3">
                  <div className="w-7 h-7 rounded-full bg-primary/10 text-primary flex items-center justify-center shrink-0 text-xs font-bold">3</div>
                  <p className="text-sm flex-1">
                    Pilih <strong>"Install app"</strong> atau <strong>"Add to Home screen"</strong>.
                  </p>
                </div>
                <div className="rounded-lg bg-muted/60 p-3 text-xs text-muted-foreground flex items-start gap-2">
                  <Info className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                  <span>
                    Kalau opsi tidak muncul, refresh halaman dulu lalu coba lagi. Beberapa browser butuh kunjungan kedua sebelum menawarkan install.
                  </span>
                </div>
              </div>
            )}
          </div>
          <Button className="w-full mt-2" variant="outline" onClick={() => setInstallHelpOpen(false)}>
            Tutup
          </Button>
        </DialogContent>
      </Dialog>

      {/* Store Dialog */}
      <Dialog open={storeDialog} onOpenChange={setStoreDialog}>
        <DialogContent className="max-w-[95vw] rounded-xl">
          <DialogHeader><DialogTitle>Info Toko</DialogTitle></DialogHeader>
          <div className="space-y-4 mt-2">
            {/* Logo picker */}
            <div className="space-y-1.5">
              <Label>Logo Toko</Label>
              <div className="flex items-center gap-3">
                <div
                  className="w-20 h-20 rounded-xl bg-muted border-2 border-dashed border-border flex items-center justify-center overflow-hidden cursor-pointer hover:border-primary/50 transition-colors"
                  onClick={() => logoInputRef.current?.click()}
                >
                  {storeLogo ? (
                    <img src={storeLogo} alt="Logo" className="w-full h-full object-cover" />
                  ) : (
                    <Camera className="w-6 h-6 text-muted-foreground/50" />
                  )}
                </div>
                <div className="flex flex-col gap-1.5">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-8 text-xs gap-1.5"
                    onClick={() => logoInputRef.current?.click()}
                  >
                    <Camera className="w-3.5 h-3.5" />
                    {storeLogo ? 'Ganti Logo' : 'Pilih Logo'}
                  </Button>
                  {storeLogo && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-8 text-xs text-destructive gap-1.5"
                      onClick={() => setStoreLogo(undefined)}
                    >
                      <X className="w-3.5 h-3.5" />
                      Hapus Logo
                    </Button>
                  )}
                </div>
                <input
                  ref={logoInputRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={handleLogoSelect}
                />
              </div>
            </div>
            <div className="space-y-1.5"><Label>Nama Toko</Label><Input value={storeName} onChange={e => setStoreName(e.target.value)} className="h-11" /></div>
            <div className="space-y-1.5"><Label>Alamat</Label><Input value={storeAddr} onChange={e => setStoreAddr(e.target.value)} className="h-11" /></div>
            <div className="space-y-1.5"><Label>Telepon</Label><Input value={storePhone} onChange={e => setStorePhone(e.target.value)} className="h-11" type="tel" /></div>
            <Button className="w-full h-11" onClick={saveStore}>Simpan</Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Payment Method Dialog */}
      <Dialog open={pmDialog} onOpenChange={setPmDialog}>
        <DialogContent className="max-w-[95vw] rounded-xl">
          <DialogHeader><DialogTitle>{pmEditId ? 'Edit' : 'Tambah'} Metode Pembayaran</DialogTitle></DialogHeader>
          <div className="space-y-4 mt-2">
            <div className="space-y-1.5"><Label>Nama</Label><Input value={pmName} onChange={e => setPmName(e.target.value)} placeholder="Contoh: Transfer BCA" className="h-11" /></div>
            <div className="space-y-1.5">
              <Label>Kategori</Label>
              <div className="grid grid-cols-4 gap-2">
                {['tunai', 'transfer', 'e-wallet', 'qris'].map(c => (
                  <button key={c} onClick={() => setPmCategory(c)} className={`p-2 rounded-lg text-xs font-semibold border-2 capitalize transition-colors ${pmCategory === c ? 'border-primary bg-primary/5 text-primary' : 'border-muted text-muted-foreground'}`}>{c}</button>
                ))}
              </div>
            </div>
            <Button className="w-full h-11" onClick={savePm} disabled={!pmName.trim()}>Simpan</Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Category Dialog */}
      <Dialog open={catDialog} onOpenChange={setCatDialog}>
        <DialogContent className="max-w-[95vw] rounded-xl">
          <DialogHeader><DialogTitle>{catEditId ? 'Edit' : 'Tambah'} Kategori</DialogTitle></DialogHeader>
          <div className="space-y-4 mt-2">
            <div className="space-y-1.5"><Label>Nama Kategori</Label><Input value={catName} onChange={e => setCatName(e.target.value)} placeholder="Contoh: Snack" className="h-11" /></div>
            <div className="space-y-1.5">
              <Label>Ikon</Label>
              <div className="flex flex-wrap gap-2">
                {emojiOptions.map(e => (
                  <button key={e} onClick={() => setCatIcon(e)} className={`w-10 h-10 rounded-lg text-lg flex items-center justify-center border-2 transition-colors ${catIcon === e ? 'border-primary bg-primary/5' : 'border-muted'}`}>{e}</button>
                ))}
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Warna</Label>
              <Input type="color" value={catColor} onChange={e => setCatColor(e.target.value)} className="h-11 w-20" />
            </div>
            <Button className="w-full h-11" onClick={saveCat} disabled={!catName.trim()}>Simpan</Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Multi-User Activation Dialog */}
      <Dialog open={activateOpen} onOpenChange={setActivateOpen}>
        <DialogContent className="max-w-[95vw] rounded-xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Aktifkan Multi-User</DialogTitle>
            <DialogDescription className="text-xs">
              Buat akun pemilik. Setelah aktif, Anda harus login dengan username & PIN ini setiap kali buka aplikasi.
              Data toko Anda tetap utuh.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 mt-2">
            <div className="space-y-1.5">
              <Label>Nama Anda *</Label>
              <Input value={actName} onChange={e => setActName(e.target.value)} placeholder="Contoh: Pak Budi" className="h-11" />
            </div>
            <div className="space-y-1.5">
              <Label>Username *</Label>
              <Input
                value={actUsername}
                onChange={e => setActUsername(e.target.value.toLowerCase().replace(/[^a-z0-9_.]/g, ''))}
                placeholder="Contoh: owner"
                className="h-11 font-mono"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
              />
              <p className="text-[10px] text-muted-foreground">3-20 karakter, huruf/angka/underscore. Tidak bisa diubah.</p>
            </div>
            <div className="space-y-1.5">
              <Label>PIN *</Label>
              <Input
                type="password"
                inputMode="numeric"
                pattern="[0-9]*"
                maxLength={6}
                value={actPin}
                onChange={e => setActPin(e.target.value.replace(/\D/g, ''))}
                placeholder="4-6 digit angka"
                className="h-11 font-mono text-center tracking-widest"
              />
            </div>
            <div className="space-y-1.5">
              <Label>Konfirmasi PIN *</Label>
              <Input
                type="password"
                inputMode="numeric"
                pattern="[0-9]*"
                maxLength={6}
                value={actPinConfirm}
                onChange={e => setActPinConfirm(e.target.value.replace(/\D/g, ''))}
                placeholder="Ketik ulang PIN"
                className="h-11 font-mono text-center tracking-widest"
              />
            </div>
            <div className="bg-warning/10 border border-warning/30 rounded-xl p-3 text-xs text-foreground">
              <p className="font-semibold mb-1">Penting:</p>
              <p className="text-muted-foreground">
                Catat username & PIN dengan baik. Jika lupa, satu-satunya cara untuk reset adalah dengan menghapus
                data aplikasi (data toko juga terhapus). Pastikan Anda sudah backup.
              </p>
            </div>
            <Button className="w-full h-11" onClick={handleActivateMultiUser} disabled={activating}>
              {activating ? 'Mengaktifkan…' : 'Aktifkan Multi-User'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Unit Dialog */}
      <Dialog open={unitDialog} onOpenChange={setUnitDialog}>
        <DialogContent className="max-w-[95vw] rounded-xl">
          <DialogHeader><DialogTitle>{unitEditId ? 'Edit' : 'Tambah'} Satuan</DialogTitle></DialogHeader>
          <div className="space-y-4 mt-2">
            <div className="space-y-1.5">
              <Label>Nama Satuan</Label>
              <Input
                value={unitName}
                onChange={e => setUnitName(e.target.value)}
                placeholder="Contoh: pak, lusin, mangkok"
                className="h-11"
              />
              {unitEditId && unitOriginalName && unitName.trim() && unitName.trim() !== unitOriginalName && (
                <p className="text-[11px] text-muted-foreground">
                  Semua produk yang memakai "{unitOriginalName}" akan otomatis di-rename ke "{unitName.trim()}".
                </p>
              )}
            </div>
            <Button className="w-full h-11" onClick={saveUnit} disabled={!unitName.trim()}>Simpan</Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Disable Multi-User Confirmation */}
      <AlertDialog open={disableOpen} onOpenChange={setDisableOpen}>
        <AlertDialogContent className="max-w-[90vw] rounded-xl">
          <AlertDialogHeader>
            <AlertDialogTitle>Nonaktifkan Multi-User?</AlertDialogTitle>
            <AlertDialogDescription>
              Aplikasi akan kembali ke mode tanpa login. Akun karyawan tetap tersimpan dan akan aktif kembali
              jika multi-user diaktifkan lagi. Data transaksi tetap utuh.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Batal</AlertDialogCancel>
            <AlertDialogAction onClick={handleDisableMultiUser} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              Nonaktifkan
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Logout Confirmation */}
      <AlertDialog open={logoutOpen} onOpenChange={setLogoutOpen}>
        <AlertDialogContent className="max-w-[90vw] rounded-xl">
          <AlertDialogHeader>
            <AlertDialogTitle>Keluar dari Akun?</AlertDialogTitle>
            <AlertDialogDescription>
              Anda akan diarahkan ke halaman login. Pastikan tidak ada open bill yang belum disimpan.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Batal</AlertDialogCancel>
            <AlertDialogAction onClick={handleLogout} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              Keluar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Unit Delete Confirm */}
      <AlertDialog open={!!unitDeleteTarget} onOpenChange={(o) => { if (!o) setUnitDeleteTarget(null); }}>
        <AlertDialogContent className="max-w-[90vw] rounded-xl">
          <AlertDialogHeader>
            <AlertDialogTitle>Hapus Satuan "{unitDeleteTarget?.name}"?</AlertDialogTitle>
            <AlertDialogDescription>
              {unitDeleteUsage > 0
                ? `Saat ini dipakai oleh ${unitDeleteUsage} produk. Produk yang sudah ada tetap menyimpan satuan "${unitDeleteTarget?.name}", tapi satuan ini tidak akan muncul lagi di pilihan saat tambah/edit produk baru.`
                : 'Satuan ini tidak dipakai oleh produk manapun. Aman untuk dihapus.'}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Batal</AlertDialogCancel>
            <AlertDialogAction onClick={confirmDeleteUnit} className="bg-destructive text-destructive-foreground">Hapus</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <AlertDialog open={restoreDriveConfirmOpen} onOpenChange={setRestoreDriveConfirmOpen}>
        <AlertDialogContent className="max-w-[90vw] rounded-xl">
          <AlertDialogHeader>
            <AlertDialogTitle>Restore dari Google Drive?</AlertDialogTitle>
            <AlertDialogDescription>
              Data yang ada sekarang akan diganti dengan data dari Google Drive. Pastikan Anda sudah memilih file backup yang benar.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Batal</AlertDialogCancel>
            <AlertDialogAction onClick={confirmRestoreFromDrive}>
              Lanjut Restore
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <AlertDialog open={restoreFileConfirmOpen} onOpenChange={(open) => {
        setRestoreFileConfirmOpen(open);
        if (!open) pendingImportDataRef.current = null;
      }}>
        <AlertDialogContent className="max-w-[90vw] rounded-xl">
          <AlertDialogHeader>
            <AlertDialogTitle>Restore dari File Backup?</AlertDialogTitle>
            <AlertDialogDescription>
              Data yang ada sekarang akan diganti dengan data dari file backup yang Anda pilih. Lanjutkan hanya jika file tersebut memang versi terbaru yang ingin dipakai.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Batal</AlertDialogCancel>
            <AlertDialogAction onClick={confirmRestoreFromFile}>
              Lanjut Restore
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      {/* PIN Verification for actions in Settings */}
      <PinVerificationDialog
        open={pinVerifyOpen}
        onOpenChange={setPinVerifyOpen}
        onSuccess={() => {
          if (pinCallbackRef.current) {
            pinCallbackRef.current();
            pinCallbackRef.current = null;
          }
        }}
        title={pinVerifyTitle}
        description={pinVerifyDesc}
      />

      {/* Security PIN Management Dialog */}
      <Dialog open={pinManageOpen} onOpenChange={setPinManageOpen}>
        <DialogContent className="max-w-[400px] w-[90vw] rounded-xl p-6 flex flex-col items-center">
          <DialogHeader className="items-center text-center w-full">
            <div className="w-12 h-12 rounded-full bg-primary/10 text-primary flex items-center justify-center mb-3">
              <KeyRound className="w-6 h-6" />
            </div>
            <DialogTitle className="text-base font-bold">
              {pinManageMode === 'setup' && 'Aktifkan PIN Otorisasi'}
              {pinManageMode === 'change' && 'Ubah PIN Otorisasi'}
              {pinManageMode === 'disable' && 'Nonaktifkan PIN Otorisasi'}
            </DialogTitle>
            <DialogDescription className="text-xs text-center mt-1">
              {pinStep === 'verify_old' && 'Masukkan PIN Otorisasi lama Anda untuk memverifikasi.'}
              {pinStep === 'enter_new' && 'Buat 6 angka PIN Otorisasi baru Anda.'}
              {pinStep === 'confirm_new' && 'Masukkan kembali 6 angka PIN Otorisasi untuk konfirmasi.'}
            </DialogDescription>
          </DialogHeader>

          <div className="my-6 flex flex-col items-center gap-2">
            <InputOTP
              key={pinStep}
              maxLength={6}
              value={pinInput}
              onChange={handlePinManageOTPChange}
              autoFocus
              inputMode="numeric"
              pattern="[0-9]*"
            >
              <InputOTPGroup>
                <InputOTPSlot index={0} className="w-11 h-11 text-lg" type="password" />
                <InputOTPSlot index={1} className="w-11 h-11 text-lg" type="password" />
                <InputOTPSlot index={2} className="w-11 h-11 text-lg" type="password" />
                <InputOTPSlot index={3} className="w-11 h-11 text-lg" type="password" />
                <InputOTPSlot index={4} className="w-11 h-11 text-lg" type="password" />
                <InputOTPSlot index={5} className="w-11 h-11 text-lg" type="password" />
              </InputOTPGroup>
            </InputOTP>
            {pinManageError && (
              <p className="text-xs text-destructive font-medium mt-2">{pinManageError}</p>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
