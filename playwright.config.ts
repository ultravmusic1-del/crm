import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false, // one shared database
  workers: 1,
  retries: 0,
  timeout: 60_000,
  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:3000',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'] } },
    // Spec §6.6 gives phone and laptop equal weight, so the journey runs
    // on both. A pass on desktop only is half a pass.
    { name: 'mobile', use: { ...devices['iPhone 13'] } },
  ],
  webServer: process.env.E2E_BASE_URL
    ? undefined
    : { command: 'npm run dev', url: 'http://localhost:3000', reuseExistingServer: true, timeout: 120_000 },
})
