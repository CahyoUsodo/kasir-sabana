import { useEffect, useRef } from 'react';
import { db } from '@/lib/db';
import { performBackup } from '@/lib/backup';

const AUTO_BACKUP_HOURS = [0, 6, 12, 18];
const CHECK_INTERVAL_MS = 60 * 1000;

function getLatestBackupSlot(now: Date): Date {
  const slot = new Date(now);
  slot.setMinutes(0, 0, 0);

  let latestHour = AUTO_BACKUP_HOURS[0];
  for (const hour of AUTO_BACKUP_HOURS) {
    if (hour <= now.getHours()) {
      latestHour = hour;
    }
  }

  slot.setHours(latestHour, 0, 0, 0);
  return slot;
}

function getSlotKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hour = String(date.getHours()).padStart(2, '0');
  return `${year}-${month}-${day} ${hour}:00`;
}

export function useAutoBackup() {
  const isRunningRef = useRef(false);
  const lastAttemptedSlotRef = useRef<string | null>(null);

  useEffect(() => {
    const checkAndRunBackup = async () => {
      if (isRunningRef.current || !navigator.onLine) return;

      try {
        const settings = await db.storeSettings.toCollection().first();
        if (!settings) return;

        const now = new Date();
        const currentSlot = getLatestBackupSlot(now);
        const currentSlotKey = getSlotKey(currentSlot);
        const lastCloudBackupAt = settings.lastCloudBackupAt || settings.lastBackupAt || null;

        if (lastAttemptedSlotRef.current === currentSlotKey) {
          return;
        }

        if (lastCloudBackupAt && new Date(lastCloudBackupAt) >= currentSlot) {
          lastAttemptedSlotRef.current = currentSlotKey;
          return;
        }

        isRunningRef.current = true;
        await performBackup({ reason: 'auto', silent: true });
        lastAttemptedSlotRef.current = currentSlotKey;
      } catch (error) {
        console.error('Auto-backup failed:', error);
      } finally {
        isRunningRef.current = false;
      }
    };

    const intervalId = window.setInterval(checkAndRunBackup, CHECK_INTERVAL_MS);
    const startupTimer = window.setTimeout(checkAndRunBackup, 5000);
    const handleOnline = () => { void checkAndRunBackup(); };
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') {
        void checkAndRunBackup();
      }
    };

    window.addEventListener('online', handleOnline);
    document.addEventListener('visibilitychange', handleVisibility);

    return () => {
      window.clearInterval(intervalId);
      window.clearTimeout(startupTimer);
      window.removeEventListener('online', handleOnline);
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, []);
}
