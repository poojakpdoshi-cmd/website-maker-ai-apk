import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.poojak.webforgeai',
  appName: 'Nexora AI',
  webDir: 'dist',

  server: {
    androidScheme: 'https',
    cleartext: false
  },

  android: {
    backgroundColor: '#F7F9FC',
    allowMixedContent: false,
    webContentsDebuggingEnabled: false,
    loggingBehavior: 'none'
  }
};

export default config;
