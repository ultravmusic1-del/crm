import { defineConfig } from 'vitest/config'
import tsconfigPaths from 'vite-tsconfig-paths'

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    // Pure functions only. No jsdom, no Testing Library — component
    // behaviour is covered by Playwright at the journey level (Phase 8).
    environment: 'node',
    // The host here is Asia/Bahrain, which is the one timezone where a
    // timezone bug is invisible. Run in a distant zone so a regression
    // fails a test instead of reaching production.
    env: { TZ: 'America/Los_Angeles' },
    include: ['src/**/*.test.ts'],
  },
})
