import { useState, useEffect, useCallback } from 'react';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

// Global capture — catches the event even before React mounts
let deferredPrompt: BeforeInstallPromptEvent | null = null;
let promptListeners: Array<() => void> = [];

// This runs immediately when the module is imported (before React renders)
if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (e: Event) => {
    e.preventDefault();
    deferredPrompt = e as BeforeInstallPromptEvent;
    // Notify all active hook instances
    promptListeners.forEach(fn => fn());
  });
}

function detectInstalled(): boolean {
  if (typeof window === 'undefined') return false;
  // iOS Safari home-screen launch
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  if ((window.navigator as any).standalone) return true;
  // Other browsers
  return window.matchMedia?.('(display-mode: standalone)').matches ?? false;
}

function detectIOS(): boolean {
  if (typeof window === 'undefined') return false;
  const ua = window.navigator.userAgent;
  // iPad on iOS 13+ reports as Mac, so also check touch points
  return /iPad|iPhone|iPod/.test(ua) ||
    (ua.includes('Mac') && 'ontouchend' in document);
}

export function usePWAInstall() {
  const [canInstall, setCanInstall] = useState(!!deferredPrompt);
  const [isInstalled, setIsInstalled] = useState(detectInstalled);
  const [isIOS] = useState(detectIOS);

  useEffect(() => {
    // Check if already installed as standalone
    if (detectInstalled()) {
      setIsInstalled(true);
      return;
    }

    // If event was already captured before this hook mounted
    if (deferredPrompt) {
      setCanInstall(true);
    }

    // Subscribe to future prompt events
    const onPrompt = () => setCanInstall(true);
    promptListeners.push(onPrompt);

    const installedHandler = () => {
      setIsInstalled(true);
      setCanInstall(false);
      deferredPrompt = null;
    };

    window.addEventListener('appinstalled', installedHandler);

    return () => {
      promptListeners = promptListeners.filter(fn => fn !== onPrompt);
      window.removeEventListener('appinstalled', installedHandler);
    };
  }, []);

  const install = useCallback(async () => {
    if (!deferredPrompt) return false;
    await deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    if (outcome === 'accepted') {
      setCanInstall(false);
      deferredPrompt = null;
      return true;
    }
    return false;
  }, []);

  return { canInstall, isInstalled, isIOS, install };
}
