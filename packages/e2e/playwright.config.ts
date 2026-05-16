import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: './tests',
  testMatch: '**/*.test.ts',
  timeout: 60_000,
  use: {
    headless: true,
    baseURL: process.env['PWA_URL'] ?? 'http://localhost:5173',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
      testMatch: '**/*pwa*',
    },
  ],
})
