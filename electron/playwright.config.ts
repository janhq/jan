import { PlaywrightTestConfig } from '@playwright/test'

const config: PlaywrightTestConfig = {
  testDir: './tests',
  retries: 0,
  globalTimeout: 300000,
}

export default config
