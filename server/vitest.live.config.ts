import { defineConfig } from 'vitest/config';

import config from './vitest.config.js';

// Tests that call real third-party APIs. They need credentials, so they run
// only via `npm run test:live`, not in the unit or integration suites.
export default defineConfig({
  ...config,
  test: {
    ...config.test,
    include: ['**/*.live.test.ts'],
    exclude: ['node_modules/**', 'transpiled/**', 'e2e/**'],
    testTimeout: 30_000,
    // Retry once so a transient network failure doesn't fail the run.
    retry: 1,
    // The scheduled workflow runs whatever live tests exist, including none.
    passWithNoTests: true,
  },
});
