import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { lazy, Suspense, useEffect } from "react";
import { checkVersion } from "@/lib/version-check";
import { AuthProvider } from "@/hooks/use-auth";
import AppLayout from "./components/layout/AppLayout";

const queryClient = new QueryClient();

import { useAutoBackup } from "@/hooks/useAutoBackup";

import { db, repairInventoryAnomalies } from '@/lib/db';

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

const Dashboard = lazy(loadDashboard);
const Cashier = lazy(loadCashier);
const Products = lazy(loadProducts);
const Reports = lazy(loadReports);
const Settings = lazy(loadSettings);
const SupplierPage = lazy(loadSupplierPage);
const StockInPage = lazy(loadStockInPage);
const StockOutPage = lazy(loadStockOutPage);
const TransactionHistory = lazy(loadTransactionHistory);
const StockReport = lazy(loadStockReport);
const UsersPage = lazy(loadUsersPage);
const WarehousePage = lazy(loadWarehousePage);
const DailyExpensesPage = lazy(loadDailyExpensesPage);
const NotFound = lazy(loadNotFound);

const App = () => {
  useAutoBackup();

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
