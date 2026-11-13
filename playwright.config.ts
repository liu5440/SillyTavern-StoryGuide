import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests/browser',
  timeout: 30000,
  use: {
    baseURL: 'http://127.0.0.1:8123',
    headless: true,
    launchOptions: process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {},
  },
  webServer: {
    command: 'node scripts/test-server.mjs',
    url: 'http://127.0.0.1:8123',
    reuseExistingServer: false,
  },
});
