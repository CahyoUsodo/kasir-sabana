import { useState, useEffect } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '@/lib/db';
import { hashPin } from '@/lib/auth';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import {
  InputOTP,
  InputOTPGroup,
  InputOTPSlot,
} from '@/components/ui/input-otp';
import { KeyRound } from 'lucide-react';

interface PinVerificationDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess: () => void;
  title?: string;
  description?: string;
}

export default function PinVerificationDialog({
  open,
  onOpenChange,
  onSuccess,
  title = "Verifikasi PIN Otorisasi",
  description = "Masukkan PIN keamanan 6 angka untuk menyetujui tindakan ini."
}: PinVerificationDialogProps) {
  const storeSettings = useLiveQuery(() => db.storeSettings.toCollection().first());
  const [pin, setPin] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    if (open) {
      setPin('');
      setError('');
    }
  }, [open]);

  const handleChange = async (val: string) => {
    setPin(val);
    setError('');
    
    if (val.length === 6) {
      if (!storeSettings?.securityPin) {
        // Fallback: if somehow PIN is not set, allow
        if (document.activeElement instanceof HTMLElement) {
          document.activeElement.blur();
        }
        onOpenChange(false);
        setTimeout(() => {
          onSuccess();
        }, 150);
        return;
      }
      
      try {
        const deviceId = storeSettings?.deviceId || '';
        const hashed = await hashPin(val, deviceId);
        if (hashed === storeSettings.securityPin) {
          if (document.activeElement instanceof HTMLElement) {
            document.activeElement.blur();
          }
          onOpenChange(false);
          setTimeout(() => {
            onSuccess();
          }, 150);
        } else {
          setError('PIN salah. Silakan coba lagi.');
          setPin('');
        }
      } catch (err: any) {
        console.error('Error verifying PIN:', err);
        setError('Gagal memverifikasi PIN.');
        setPin('');
      }
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[400px] w-[90vw] rounded-xl p-6 flex flex-col items-center">
        <DialogHeader className="items-center text-center w-full">
          <div className="w-12 h-12 rounded-full bg-primary/10 text-primary flex items-center justify-center mb-3">
            <KeyRound className="w-6 h-6" />
          </div>
          <DialogTitle className="text-base font-bold">{title}</DialogTitle>
          <DialogDescription className="text-xs text-center mt-1">
            {description}
          </DialogDescription>
        </DialogHeader>

        <div className="my-6 flex flex-col items-center gap-2">
          <InputOTP
            maxLength={6}
            value={pin}
            onChange={handleChange}
            autoFocus
            inputMode="numeric"
            pattern="[0-9]*"
          >
            <InputOTPGroup>
              <InputOTPSlot index={0} className="w-11 h-11 text-lg" />
              <InputOTPSlot index={1} className="w-11 h-11 text-lg" />
              <InputOTPSlot index={2} className="w-11 h-11 text-lg" />
              <InputOTPSlot index={3} className="w-11 h-11 text-lg" />
              <InputOTPSlot index={4} className="w-11 h-11 text-lg" />
              <InputOTPSlot index={5} className="w-11 h-11 text-lg" />
            </InputOTPGroup>
          </InputOTP>
          {error && <p className="text-xs text-destructive font-medium mt-2">{error}</p>}
        </div>
      </DialogContent>
    </Dialog>
  );
}
