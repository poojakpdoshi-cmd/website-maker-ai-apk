import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.poojak.webforgeai',
  appName: 'Nexora.Ai',
  webDir: 'dist',

  server: {
    androidScheme: 'https',
    cleartext: false
  },

  android: {
    backgroundColor: '#000008',
    allowMixedContent: false,
    webContentsDebuggingEnabled: false,
    loggingBehavior: 'none'
  }
};

export default config;
