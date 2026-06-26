import { useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { format, isSameDay } from 'date-fns';
import { id as localeId } from 'date-fns/locale';
import { DollarSign, Trash2, ChevronLeft } from 'lucide-react';
import { db, deleteDailyExpenseEntry, recordDailyExpense } from '@/lib/db';
import { useAuth } from '@/hooks/use-auth';
import { Link } from 'react-router-dom';
import LockedPage from '@/components/LockedPage';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { toast } from 'sonner';
import { formatNumberInput, parseFormattedNumber } from '@/lib/utils';

export default function SalaryExpensesPage() {
  const { can } = useAuth();
  const todayDate = new Date().toLocaleDateString('en-CA');
  const [expenseAmount, setExpenseAmount] = useState('');
  const [expensePurpose, setExpensePurpose] = useState('');
  const [expenseDate, setExpenseDate] = useState(todayDate);
  const [expenseHistoryDate, setExpenseHistoryDate] = useState(todayDate);

  const dailyExpenses = useLiveQuery(() => db.dailyExpenses.orderBy('date').reverse().toArray());

  if (!can('manage_stock_inout')) {
    return <LockedPage title="Pengeluaran Gaji" permissionLabel="Kelola Transaksi & Stok" />;
  }

  const selectedExpenseHistoryStart = useMemo(() => {
    const value = expenseHistoryDate ? new Date(`${expenseHistoryDate}T00:00:00`) : new Date();
    value.setHours(0, 0, 0, 0);
    return value;
  }, [expenseHistoryDate]);

  const selectedExpenseHistoryEnd = useMemo(() => {
    const value = expenseHistoryDate ? new Date(`${expenseHistoryDate}T23:59:59.999`) : new Date();
    value.setHours(23, 59, 59, 999);
    return value;
  }, [expenseHistoryDate]);

  const filteredDailyExpenses = useMemo(() => {
    return (dailyExpenses ?? []).filter(expense => {
      const isSalary = expense.type === 'salary';
      if (!isSalary) return false;
      const time = new Date(expense.date).getTime();
      return time >= selectedExpenseHistoryStart.getTime() && time <= selectedExpenseHistoryEnd.getTime();
    });
  }, [dailyExpenses, selectedExpenseHistoryEnd, selectedExpenseHistoryStart]);

  const totalFilteredExpenses = useMemo(() => {
    return filteredDailyExpenses.reduce((sum, item) => sum + item.amount, 0);
  }, [filteredDailyExpenses]);

  const submitDailyExpense = async () => {
    try {
      await recordDailyExpense({
        amount: parseFormattedNumber(expenseAmount),
        purpose: expensePurpose,
        date: expenseDate ? new Date(`${expenseDate}T12:00:00`) : undefined,
        type: 'salary',
      });
      setExpenseAmount('');
      setExpensePurpose('');
      setExpenseHistoryDate(expenseDate || todayDate);
      setExpenseDate(todayDate);
      toast.success('Pengeluaran gaji berhasil disimpan');
    } catch (error) {
      console.error(error);
      toast.error(error instanceof Error ? error.message : 'Gagal menyimpan pengeluaran gaji');
    }
  };

  const removeDailyExpense = async (expenseId: number) => {
    try {
      await deleteDailyExpenseEntry(expenseId);
      toast.success('Pengeluaran gaji dihapus');
    } catch (error) {
      console.error(error);
      toast.error('Gagal menghapus pengeluaran gaji');
    }
  };

  return (
    <div className="px-4 pt-6 pb-20 space-y-5">
      <div className="flex items-center gap-3">
        <Link to="/settings" className="p-1.5 rounded-lg bg-muted text-muted-foreground hover:bg-muted/80">
          <ChevronLeft className="w-5 h-5" />
        </Link>
        <div>
          <h1 className="text-xl font-bold">Pengeluaran Gaji Karyawan</h1>
          <p className="text-xs text-muted-foreground mt-1">
            Catat pengeluaran gaji karyawan cabang.
          </p>
        </div>
      </div>

      <div className="grid gap-4 max-w-2xl mx-auto">
        <Card className="border-0 shadow-sm overflow-hidden">
          <CardHeader className="p-4 pb-3">
            <CardTitle className="text-sm flex items-center gap-1.5">
              <DollarSign className="w-4 h-4 text-primary" />
              Pencatatan Gaji Karyawan
            </CardTitle>
            <CardDescription className="text-xs">
              Untuk mencatat pembayaran gaji karyawan cabang.
            </CardDescription>
          </CardHeader>
          <CardContent className="p-4 pt-0 space-y-3">
            <div className="grid gap-3 sm:grid-cols-[160px_1fr]">
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold">Nominal Gaji (Rp)</Label>
                <Input
                  type="text"
                  inputMode="numeric"
                  placeholder="Contoh: 1.500.000"
                  value={expenseAmount}
                  onChange={e => setExpenseAmount(formatNumberInput(e.target.value))}
                  className="h-10"
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold">Nama Karyawan / Detail Gaji</Label>
                <Input
                  placeholder="Contoh: Gaji (Nama) - Bulan Juni"
                  value={expensePurpose}
                  onChange={e => setExpensePurpose(e.target.value)}
                  className="h-10"
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold">Tanggal Pembayaran Gaji</Label>
              <Input
                type="date"
                value={expenseDate}
                onChange={e => setExpenseDate(e.target.value)}
                className="h-10"
              />
              <p className="text-[11px] text-muted-foreground">
                Laporan kas dan pengeluaran akan mengikuti tanggal kejadian ini, bukan waktu saat data diinput.
              </p>
            </div>
            <Button
              onClick={submitDailyExpense}
              disabled={parseFormattedNumber(expenseAmount) <= 0 || !expensePurpose.trim() || !expenseDate}
              className="w-full h-10 text-xs font-semibold"
            >
              Simpan Pengeluaran Gaji
            </Button>
            <div className="rounded-xl border bg-muted/20 p-3 space-y-2">
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold">Lihat Riwayat Tanggal</Label>
                <Input
                  type="date"
                  value={expenseHistoryDate}
                  onChange={e => setExpenseHistoryDate(e.target.value)}
                  className="h-10"
                />
              </div>
              <div className="flex items-center justify-between text-xs">
                <span className="font-semibold text-muted-foreground">
                  Total pengeluaran gaji {expenseHistoryDate ? format(new Date(`${expenseHistoryDate}T12:00:00`), 'dd MMM yyyy', { locale: localeId }) : 'tanggal dipilih'}
                </span>
                <span className="font-bold text-foreground">Rp {totalFilteredExpenses.toLocaleString('id-ID')}</span>
              </div>
              <div className="space-y-2">
                {filteredDailyExpenses.length === 0 ? (
                  <p className="text-[11px] text-muted-foreground">Belum ada pengeluaran gaji pada tanggal yang dipilih.</p>
                ) : (
                  filteredDailyExpenses.map(expense => (
                    <div key={expense.id} className="flex items-start justify-between gap-3 rounded-lg border bg-background px-3 py-2">
                      <div className="min-w-0">
                        <p className="text-xs font-semibold break-words">{expense.purpose}</p>
                        <p className="text-[11px] text-muted-foreground">
                          Tanggal kejadian {format(new Date(expense.date), 'dd MMM yyyy', { locale: localeId })}
                        </p>
                        <p className="text-[11px] text-muted-foreground">
                          Diinput {format(new Date(expense.createdAt), 'dd MMM yyyy HH:mm', { locale: localeId })}
                        </p>
                        {!isSameDay(new Date(expense.date), new Date(expense.createdAt)) && (
                          <p className="text-[11px] font-medium text-warning">Input terlambat</p>
                        )}
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <span className="text-xs font-bold text-foreground">Rp {expense.amount.toLocaleString('id-ID')}</span>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 text-destructive hover:bg-destructive/10"
                          onClick={() => removeDailyExpense(expense.id!)}
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </Button>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
