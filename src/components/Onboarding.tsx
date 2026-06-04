import { useState } from 'react';
import { Store, MapPin, Phone } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { db } from '@/lib/db';

interface OnboardingProps {
  onComplete: () => void;
}

export default function Onboarding({ onComplete }: OnboardingProps) {
  const [storeName, setStoreName] = useState('');
  const [address, setAddress] = useState('');
  const [phone, setPhone] = useState('');
  const [saving, setSaving] = useState(false);
  const themeColor = '25'; // Default red theme as requested

  const handleFinish = async () => {
    if (!storeName.trim()) return;
    setSaving(true);
    try {
      const existing = await db.storeSettings.toCollection().first();
      if (existing?.id) {
        await db.storeSettings.update(existing.id, {
          storeName: storeName.trim(),
          address: address.trim(),
          phone: phone.trim(),
          onboardingDone: true,
          themeColor,
        });
      } else {
        await db.storeSettings.add({
          storeName: storeName.trim(),
          address: address.trim(),
          phone: phone.trim(),
          receiptFooter: 'Terima kasih atas kunjungan Anda!',
          onboardingDone: true,
          lastBackupAt: null,
          themeColor,
        });
      }
      onComplete();
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-x-0 top-0 z-[100] bg-background max-w-lg md:max-w-6xl mx-auto overflow-y-auto" style={{ height: '100dvh', WebkitOverflowScrolling: 'touch' }}>
      <div className="min-h-full flex flex-col">
        <div className="flex-1 flex flex-col px-4">
          <div className="flex-1 flex flex-col overflow-y-auto space-y-6 py-8 -mx-1 px-1" style={{ WebkitOverflowScrolling: 'touch' }}>
            <div className="text-center space-y-2 mt-8">
              <div className="w-16 h-16 rounded-2xl bg-primary/10 text-primary flex items-center justify-center mx-auto">
                <Store className="w-8 h-8" />
              </div>
              <h2 className="text-2xl font-bold tracking-tight">Setup Toko Kamu</h2>
              <p className="text-sm text-muted-foreground">Informasi ini akan tampil di struk belanja</p>
            </div>

            <div className="space-y-4 max-w-md mx-auto w-full">
              <div className="space-y-2">
                <Label htmlFor="storeName" className="flex items-center gap-1.5">
                  <Store className="w-3.5 h-3.5" />
                  Nama Toko <span className="text-destructive">*</span>
                </Label>
                <Input
                  id="storeName"
                  placeholder="Contoh: Toko Berkah Jaya"
                  value={storeName}
                  onChange={e => setStoreName(e.target.value)}
                  className="h-12"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="address" className="flex items-center gap-1.5">
                  <MapPin className="w-3.5 h-3.5" />
                  Alamat
                </Label>
                <Input
                  id="address"
                  placeholder="Contoh: Jl. Merdeka No. 10, Jakarta"
                  value={address}
                  onChange={e => setAddress(e.target.value)}
                  className="h-12"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="phone" className="flex items-center gap-1.5">
                  <Phone className="w-3.5 h-3.5" />
                  Nomor Telepon
                </Label>
                <Input
                  id="phone"
                  placeholder="Contoh: 08123456789"
                  value={phone}
                  onChange={e => setPhone(e.target.value)}
                  className="h-12"
                  type="tel"
                />
              </div>
            </div>
          </div>
        </div>

        {/* Navigation */}
        <div className="px-4 pt-4 flex items-center gap-3 max-w-md mx-auto w-full" style={{ paddingBottom: 'max(2rem, env(safe-area-inset-bottom, 2rem))' }}>
          <Button
            size="lg"
            className="flex-1 h-12 text-base font-semibold"
            onClick={handleFinish}
            disabled={!storeName.trim() || saving}
          >
            {saving ? 'Menyimpan...' : 'Mulai Jualan! 🚀'}
          </Button>
        </div>
      </div>
    </div>
  );
}
