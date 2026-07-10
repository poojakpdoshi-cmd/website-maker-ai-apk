import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.poojak.websitemakerai',
  appName: 'Website Maker AI',
  webDir: 'dist',
  server: { androidScheme: 'https', cleartext: true },
  android: { allowMixedContent: true }
};

export default config;
