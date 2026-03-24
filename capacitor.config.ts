import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.sophiapad.app',
  appName: 'SophiaPad',
  webDir: 'www',
  server: {
    url: 'https://pad-k1drf5qq0-charleslucas-projects.vercel.app/',
    cleartext: false
  }
};

export default config;
