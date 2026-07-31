import { test, expect } from './fixtures/recording-app'

test('health-monitor', async ({ window, cursor, pg }) => {
  // Select the seeded connection first — the harness only adds it, it never selects
  // it (see command-palette.capture.ts).
  await cursor.click('[data-sidebar="menu-button"]')
  const connectionItem = window.locator('[role="menuitem"]').filter({ hasText: pg.config.name })
  await expect(connectionItem).toBeVisible({ timeout: 8000 })
  await cursor.click(`[role="menuitem"]:has-text("${pg.config.name}")`)
  await expect(window.locator('header').getByText(pg.config.name)).toBeVisible({ timeout: 5000 })
  await window.waitForTimeout(500)

  // Start a long-running query on its own tab so Health Monitor's Active Queries
  // panel has something real to show and kill. We deliberately don't wait for it
  // to finish — it runs on its own pooled connection while we switch tabs.
  const newQueryBtn = window.getByRole('button', { name: /new query/i })
  if (await newQueryBtn.isVisible()) {
    await cursor.click('button:has-text("New Query")')
  } else {
    await cursor.press('Meta+t')
  }
  await expect(window.locator('.monaco-editor').first()).toBeVisible({ timeout: 15000 })
  await cursor.click('.monaco-editor')
  await cursor.type('SELECT pg_sleep(20)')
  await window.waitForTimeout(400)
  await cursor.press('Meta+Enter')
  await window.waitForTimeout(500)

  await cursor.click('button:has-text("Health Monitor")')
  await expect(window.getByText('Active Queries')).toBeVisible({ timeout: 8000 })

  // The stuck query lands in Active Queries once the panel's poll picks it up.
  const sleepRowSelector = 'tr:has-text("pg_sleep")'
  const sleepRow = window.locator(sleepRowSelector)
  await expect(sleepRow).toBeVisible({ timeout: 15000 })
  await window.waitForTimeout(600)

  // The other three panels are live too, not an empty shell: table sizes with a
  // real total, cache hit ratios as percentages, and a clean locks panel.
  await expect(window.getByText(/DB Total:/)).toBeVisible({ timeout: 10000 })
  await expect(window.getByText('public.users').first()).toBeVisible({ timeout: 10000 })

  // Scoped to the Buffer Cache card, and requiring two or three digits, because a
  // regressed cache-stats query degrades to `0%` rather than erroring
  // (bufferCacheHitRatio is `Number(row?.buffer_cache_hit_ratio ?? 0)`). Matching a
  // bare `%` anywhere on the page would film meaningless numbers and still pass.
  const bufferCacheCard = window.locator('div:has(> p:text-is("Buffer Cache"))')
  await expect(bufferCacheCard).toBeVisible({ timeout: 10000 })
  await expect(bufferCacheCard).toContainText(/\d{2,3}(\.\d+)?%/, { timeout: 10000 })

  await expect(window.getByText('No blocking locks')).toBeVisible({ timeout: 10000 })
  await window.waitForTimeout(900)

  // Kill the stuck query live.
  await cursor.click(`${sleepRowSelector} button`)
  await expect(window.getByText('Kill Query?')).toBeVisible({ timeout: 5000 })
  await window.waitForTimeout(500)
  await cursor.click('button:has-text("Kill Query")')

  await expect(sleepRow).toHaveCount(0, { timeout: 10000 })
  await expect(window.getByText('No active queries')).toBeVisible({ timeout: 5000 })
  await window.waitForTimeout(1800)
})
