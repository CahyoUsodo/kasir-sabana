import { useEffect, useRef } from 'react';
import { db } from '@/lib/db';
import { performBackup } from '@/lib/backup';
import { toast } from 'sonner';

export function useAutoBackup() {
  const hasRun = useRef(false);

  useEffect(() => {
    // Ensure this only runs once per session/mount
    if (hasRun.current) return;
    hasRun.current = true;

    const checkAndRunBackup = async () => {
      try {
        const settings = await db.storeSettings.toCollection().first();
        if (!settings) return;

        const todayDateString = new Date().toDateString();
        const lastBackupString = settings.lastBackupAt 
          ? new Date(settings.lastBackupAt).toDateString() 
          : null;

        // If backup hasn't run today and device is online, trigger backup
        if (todayDateString !== lastBackupString && navigator.onLine) {
          console.log('Initiating auto-backup to Google Drive...');
          
          await performBackup();
          
          toast.success('Backup harian otomatis berhasil disimpan ke Google Drive.');
          console.log('Auto-backup completed successfully.');
        }
      } catch (error) {
        console.error('Auto-backup failed:', error);
        // We fail silently in the background, it will try again next time if still not backed up
      }
    };

    // Run after a short delay (e.g., 5 seconds) to avoid blocking initial render
    const timer = setTimeout(checkAndRunBackup, 5000);
    return () => clearTimeout(timer);
    
  }, []);
}
