import { defineConfig } from '@playwright/test'
import { resolve } from 'node:path'

/**
 * Separate config for marketing-clip capture. Kept out of `playwright.config.ts`
 * so `pnpm test:e2e` never records video, and CI never tries to capture (these
 * runs need Docker, a built app, and for the AI clips a signed-in `claude` CLI).
 *
 * Run: `pnpm capture` — or a single clip with
 * `pnpm capture -- -g watch-mode`
 */
export default defineConfig({
  testDir: resolve(__dirname, 'tests', 'capture'),
  testMatch: '**/*.capture.ts',
  fullyParallel: false,
  workers: 1,
  // Clips involve deliberate pauses for readability, and the AI clips wait on a
  // local LLM — far longer than the e2e budget.
  timeout: 180_000,
  expect: { timeout: 15_000 },
  retries: 0,
  reporter: 'list',
  outputDir: 'test-results/capture'
})
