import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { lazy, Suspense, useEffect, type ComponentType } from "react";
import { toast } from "sonner";
import { checkVersion } from "@/lib/version-check";
import { AuthProvider } from "@/hooks/use-auth";
import AppLayout from "./components/layout/AppLayout";

const queryClient = new QueryClient();

import { db, repairInventoryAnomalies } from '@/lib/db';

const lazyWithChunkRecovery = <T extends ComponentType<any>>(
  importer: () => Promise<{ default: T }>,
  cacheKey: string
) =>
  lazy(async () => {
    const retryKey = `lazy-retry:${cacheKey}`;

    try {
      const module = await importer();
      if (typeof window !== "undefined") {
        window.sessionStorage.removeItem(retryKey);
      }
      return module;
    } catch (error) {
      if (typeof window !== "undefined") {
        const message = error instanceof Error ? error.message : String(error);
        const alreadyRetried = window.sessionStorage.getItem(retryKey) === "1";
        const isChunkLoadError = /Failed to fetch dynamically imported module|Importing a module script failed|Loading chunk|ChunkLoadError/i.test(message);

        if (isChunkLoadError && !alreadyRetried) {
          window.sessionStorage.setItem(retryKey, "1");
          window.location.reload();
          return new Promise<never>(() => {});
        }

        window.sessionStorage.removeItem(retryKey);
      }

      throw error;
    }
  });

const loadDashboard = () => import("./pages/Dashboard");
const loadCashier = () => import("./pages/Cashier");
const loadProducts = () => import("./pages/Products");
const loadReports = () => import("./pages/Reports");
const loadSettings = () => import("./pages/Settings");
const loadSupplierPage = () => import("./pages/Supplier");
const loadStockInPage = () => import("./pages/StockIn");
const loadStockOutPage = () => import("./pages/StockOut");
const loadTransactionHistory = () => import("./pages/TransactionHistory");
const loadStockReport = () => import("./pages/StockReport");
const loadUsersPage = () => import("./pages/Users");
const loadWarehousePage = () => import("./pages/Warehouse");
const loadDailyExpensesPage = () => import("./pages/DailyExpenses");
const loadNotFound = () => import("./pages/NotFound");

const Dashboard = lazyWithChunkRecovery(loadDashboard, "dashboard");
const Cashier = lazyWithChunkRecovery(loadCashier, "cashier");
const Products = lazyWithChunkRecovery(loadProducts, "products");
const Reports = lazyWithChunkRecovery(loadReports, "reports");
const Settings = lazyWithChunkRecovery(loadSettings, "settings");
const SupplierPage = lazyWithChunkRecovery(loadSupplierPage, "supplier");
const StockInPage = lazyWithChunkRecovery(loadStockInPage, "stock-in");
const StockOutPage = lazyWithChunkRecovery(loadStockOutPage, "stock-out");
const TransactionHistory = lazyWithChunkRecovery(loadTransactionHistory, "history");
const StockReport = lazyWithChunkRecovery(loadStockReport, "stock-report");
const UsersPage = lazyWithChunkRecovery(loadUsersPage, "users");
const WarehousePage = lazyWithChunkRecovery(loadWarehousePage, "warehouse");
const DailyExpensesPage = lazyWithChunkRecovery(loadDailyExpensesPage, "daily-expenses");
const NotFound = lazyWithChunkRecovery(loadNotFound, "not-found");
const PWA_UPDATE_TOAST_ID = "pwa-update-ready";

const App = () => {
  useEffect(() => {
    checkVersion();
    
    // Auto-fix any string dates that might be in IndexedDB from an old Google Drive restore
    const fixStringDates = async () => {
      try {
        await db.transactions.toCollection().modify((t: any) => {
          if (typeof t.date === 'string') t.date = new Date(t.date);
          if (typeof t.openedAt === 'string') t.openedAt = new Date(t.openedAt);
          if (typeof t.closedAt === 'string') t.closedAt = new Date(t.closedAt);
        });
        await db.storeSettings.toCollection().modify((s: any) => {
          if (typeof s.lastBackupAt === 'string') s.lastBackupAt = new Date(s.lastBackupAt);
          if (typeof s.lastCloudBackupAt === 'string') s.lastCloudBackupAt = new Date(s.lastCloudBackupAt);
          if (typeof s.lastLocalExportAt === 'string') s.lastLocalExportAt = new Date(s.lastLocalExportAt);
        });
        await db.stockIns.toCollection().modify((s: any) => {
          if (typeof s.date === 'string') s.date = new Date(s.date);
        });
        await db.stockOuts.toCollection().modify((s: any) => {
          if (typeof s.date === 'string') s.date = new Date(s.date);
        });
        await db.hppHistory.toCollection().modify((h: any) => {
          if (typeof h.date === 'string') h.date = new Date(h.date);
        });
        await repairInventoryAnomalies();
      } catch (e) {
        console.error('Failed to fix dates', e);
      }
    };
    fixStringDates();
  }, []);

  useEffect(() => {
    const isCashierRoute = () => {
      const pathname = window.location.pathname.replace(/\/+$/, "") || "/";
      return pathname === "/cashier";
    };

    const applyPendingUpdate = async () => {
      if (!window.__hasPendingPwaUpdate__ || !window.__applyPwaUpdate__) return;

      try {
        await window.__applyPwaUpdate__();
      } catch (error) {
        console.error("Failed to apply PWA update", error);
      }
    };

    const handleUpdateReady = () => {
      if (!isCashierRoute()) {
        void applyPendingUpdate();
        return;
      }

      toast.info("Versi baru aplikasi siap dipakai", {
        id: PWA_UPDATE_TOAST_ID,
        duration: Infinity,
        description: "Tekan Perbarui agar perubahan terbaru langsung diterapkan. Update otomatis ditunda saat kasir sedang dibuka.",
        action: {
          label: "Perbarui",
          onClick: () => {
            void applyPendingUpdate();
          },
        },
        cancel: {
          label: "Nanti",
          onClick: () => undefined,
        },
      });
    };

    const handleVisibilityChange = () => {
      if (
        document.visibilityState === "hidden" &&
        window.__hasPendingPwaUpdate__ &&
        !isCashierRoute()
      ) {
        void applyPendingUpdate();
      }
    };

    window.addEventListener("pwa-update-ready", handleUpdateReady);
    document.addEventListener("visibilitychange", handleVisibilityChange);

    if (window.__hasPendingPwaUpdate__) {
      handleUpdateReady();
    }

    return () => {
      window.removeEventListener("pwa-update-ready", handleUpdateReady);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, []);

  useEffect(() => {
    const preloadPages = () => {
      void Promise.allSettled([
        loadCashier(),
        loadProducts(),
        loadReports(),
        loadTransactionHistory(),
        loadWarehousePage(),
        loadDailyExpensesPage(),
        loadSettings(),
      ]);
    };

    const browserWindow = window as Window & {
      requestIdleCallback?: (callback: () => void, options?: { timeout: number }) => number;
      cancelIdleCallback?: (handle: number) => void;
    };

    if (browserWindow.requestIdleCallback) {
      const idleId = browserWindow.requestIdleCallback(preloadPages, { timeout: 1500 });
      return () => {
        browserWindow.cancelIdleCallback?.(idleId);
      };
    }

    const timeoutId = window.setTimeout(preloadPages, 1200);
    return () => {
      window.clearTimeout(timeoutId);
    };
  }, []);

  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <Toaster />
        <Sonner />
        <BrowserRouter>
          <AuthProvider>
            <Suspense fallback={<div className="min-h-screen flex items-center justify-center text-sm text-muted-foreground">Memuat aplikasi...</div>}>
              <Routes>
                <Route element={<AppLayout />}>
                  <Route path="/" element={<Dashboard />} />
                  <Route path="/cashier" element={<Cashier />} />
                  <Route path="/products" element={<Products />} />
                  <Route path="/reports" element={<Reports />} />
                  <Route path="/settings" element={<Settings />} />
                  <Route path="/supplier" element={<SupplierPage />} />
                  <Route path="/stock-in" element={<StockInPage />} />
                  <Route path="/stock-out" element={<StockOutPage />} />
                  <Route path="/history" element={<TransactionHistory />} />
                  <Route path="/stock-report" element={<StockReport />} />
                  <Route path="/users" element={<UsersPage />} />
                  <Route path="/warehouse" element={<WarehousePage />} />
                  <Route path="/daily-expenses" element={<DailyExpensesPage />} />
                </Route>
                <Route path="*" element={<NotFound />} />
              </Routes>
            </Suspense>
          </AuthProvider>
        </BrowserRouter>
      </TooltipProvider>
    </QueryClientProvider>
  );
};

export default App;
