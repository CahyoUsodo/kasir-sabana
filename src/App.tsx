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

const Dashboard = lazy(() => import("./pages/Dashboard"));
const Cashier = lazy(() => import("./pages/Cashier"));
const Products = lazy(() => import("./pages/Products"));
const Reports = lazy(() => import("./pages/Reports"));
const Settings = lazy(() => import("./pages/Settings"));
const SupplierPage = lazy(() => import("./pages/Supplier"));
const StockInPage = lazy(() => import("./pages/StockIn"));
const StockOutPage = lazy(() => import("./pages/StockOut"));
const TransactionHistory = lazy(() => import("./pages/TransactionHistory"));
const StockReport = lazy(() => import("./pages/StockReport"));
const UsersPage = lazy(() => import("./pages/Users"));
const WarehousePage = lazy(() => import("./pages/Warehouse"));
const NotFound = lazy(() => import("./pages/NotFound"));

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
