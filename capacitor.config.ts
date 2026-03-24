import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.lucascharles.sophiapad.ios2026app',
  appName: 'SophiaPad',
  webDir: 'www',
  server: {
    url: 'https://pad-ios.vercel.app/',
    cleartext: false
  }
};

export default config;
