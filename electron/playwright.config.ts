import { PlaywrightTestConfig } from "@playwright/test";

const config: PlaywrightTestConfig = {
  testDir: "./tests",
  testIgnore: "./core/**",
  retries: 0
};

export default config;
