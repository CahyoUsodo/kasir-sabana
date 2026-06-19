import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.kasirsabana.app',
  appName: 'Aplikasi Kasir Sabana',
  webDir: 'dist',
  server: {
    androidScheme: 'https'
  }
};

export default config;
