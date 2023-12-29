/// <reference types="@capacitor/splash-screen" />

import { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  "appId": "ai.jan.mobile",
  "appName": "jan-mobile",
  "bundledWebRuntime": false,
  "webDir": "dist",
  "plugins": {
    "SplashScreen": {
      "launchShowDuration": 0
    }
  },
  server: {
    androidScheme: "https"
  }
}

export default config;