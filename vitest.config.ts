import { defineConfig } from 'vitest/config'
import tsconfigPaths from 'vite-tsconfig-paths'

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    // Pure functions only. No jsdom, no Testing Library — component
    // behaviour is covered by Playwright at the journey level (Phase 8).
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
})
