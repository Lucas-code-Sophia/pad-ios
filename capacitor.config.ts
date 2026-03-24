import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.sophiapad.app',
  appName: 'SophiaPad',
  webDir: 'www',
  server: {
    url: 'https://sophia-pad.vercel.app',
    cleartext: false
  }
};

export default config;
