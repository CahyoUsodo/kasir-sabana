import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { useEffect } from "react";
import { checkVersion } from "@/lib/version-check";
import { AuthProvider } from "@/hooks/use-auth";
import AppLayout from "./components/layout/AppLayout";
import Dashboard from "./pages/Dashboard";
import Cashier from "./pages/Cashier";
import Products from "./pages/Products";
import Reports from "./pages/Reports";
import Settings from "./pages/Settings";
import SupplierPage from "./pages/Supplier";
import StockInPage from "./pages/StockIn";
import StockOutPage from "./pages/StockOut";
import TransactionHistory from "./pages/TransactionHistory";
import StockReport from "./pages/StockReport";
import UsersPage from "./pages/Users";
import NotFound from "./pages/NotFound";

const queryClient = new QueryClient();

import { useAutoBackup } from "@/hooks/useAutoBackup";

import { db } from '@/lib/db';

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
              </Route>
              <Route path="*" element={<NotFound />} />
            </Routes>
          </AuthProvider>
        </BrowserRouter>
      </TooltipProvider>
    </QueryClientProvider>
  );
};

export default App;
