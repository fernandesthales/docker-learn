import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './test/e2e',
  timeout: 30000,
  retries: 0,
  workers: 1,
  use: {
    baseURL: process.env.E2E_BASE_URL || 'http://127.0.0.1:3011',
    browserName: 'chromium',
    trace: 'retain-on-failure'
  }
});
