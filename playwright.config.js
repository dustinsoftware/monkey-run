import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  timeout: 90_000,
  expect: { timeout: 15_000 },
  reporter: 'list',
  use: {
    baseURL: 'http://localhost:5173',
    viewport: { width: 1280, height: 720 },
    headless: true,
  },
  webServer: {
    command: 'pnpm dev',
    url: 'http://localhost:5173',
    timeout: 60_000,
    reuseExistingServer: true,
  },
});
