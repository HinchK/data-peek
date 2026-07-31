import { test, expect } from './fixtures/recording-app'

test('column-stats', async ({ window, cursor, pg }) => {
  // Select the seeded connection first — the harness only adds it, it never selects
  // it (see command-palette.capture.ts).
  await cursor.click('[data-sidebar="menu-button"]')
  const connectionItem = window.locator('[role="menuitem"]').filter({ hasText: pg.config.name })
  await expect(connectionItem).toBeVisible({ timeout: 8000 })
  await cursor.click(`[role="menuitem"]:has-text("${pg.config.name}")`)
  await expect(window.locator('header').getByText(pg.config.name)).toBeVisible({ timeout: 5000 })
  await window.waitForTimeout(500)

  // Selecting the connection can leave focus sitting in the sidebar omnibar
  // input, which expands a suggestions overlay on top of the schema tree.
  // Blur it so that overlay collapses before we click a table row underneath it.
  await window.evaluate(() => (document.activeElement as HTMLElement | null)?.blur())
  await window.waitForTimeout(400)

  // Open the invoices table directly (table-preview) rather than typing a query —
  // stats-by-column-name resolution for a plain query tab is ambiguous whenever a
  // column name like "description" exists on more than one table (it does here:
  // invoices, projects, and feature_flags all have one). A table-preview tab
  // carries its own schema/table, so there's no ambiguity to resolve.
  await cursor.click('[data-sidebar="menu-sub-button"]:has-text("invoices")')
  await expect(window.locator('tbody tr')).toHaveCount(10, { timeout: 15000 })
  await window.waitForTimeout(700)

  // amount_cents (numeric, bimodal across plans) and description (text, repeats
  // across plan names) between them exercise every stats branch: min/max/avg,
  // null rate, a histogram, and a top-values list.
  await cursor.click('[data-testid="column-stats-trigger-amount_cents"]')
  await cursor.click('[role="menuitem"]:has-text("Column Statistics")')

  const panel = window.locator('[data-testid="column-stats-panel"]')
  await expect(panel).toBeVisible({ timeout: 5000 })
  await expect(panel.getByText('amount_cents')).toBeVisible({ timeout: 5000 })
  // Waits out the loading skeleton — the real numbers only land once the stats
  // query round-trips through the connection.
  // Pin the computed values, not just the labels: Min/Max/Avg render unconditionally
  // once statsType is 'numeric', so broken aggregate SQL returning any non-null
  // number would satisfy a label-only check. These come from the deterministic seed
  // (10 invoices at 1900/4900/99900 cents), and Min/Max are rendered raw via
  // String() rather than through the locale formatter, so they match exactly.
  await expect(panel.getByText('Min')).toBeVisible({ timeout: 8000 })
  await expect(panel.getByText('1900', { exact: true })).toBeVisible({ timeout: 8000 })
  await expect(panel.getByText('Max')).toBeVisible({ timeout: 8000 })
  await expect(panel.getByText('99900', { exact: true })).toBeVisible({ timeout: 8000 })
  await expect(panel.getByText('Avg')).toBeVisible({ timeout: 8000 })
  await expect(panel.locator('[data-testid="column-stats-histogram"]')).toBeVisible({
    timeout: 8000
  })
  await window.waitForTimeout(1400)

  // Close before opening the next column — the panel docks over the right edge
  // of the grid and can otherwise sit on top of a column's own trigger button.
  await cursor.click('[data-testid="column-stats-close"]')
  await expect(panel).not.toBeVisible({ timeout: 5000 })
  // Closing the panel widens the grid and shifts column positions — let the
  // layout settle before the cursor's eased move computes a target position.
  await window.waitForTimeout(500)

  await cursor.click('[data-testid="column-stats-trigger-description"]')
  await expect(window.locator('[role="menuitem"]:has-text("Column Statistics")')).toBeVisible({
    timeout: 5000
  })
  await cursor.click('[role="menuitem"]:has-text("Column Statistics")')

  await expect(panel).toBeVisible({ timeout: 5000 })
  await expect(panel.getByText('Length', { exact: true })).toBeVisible({ timeout: 8000 })
  await expect(panel.locator('[data-testid="column-stats-top-values"]')).toBeVisible({
    timeout: 8000
  })
  await expect(panel.getByText('Enterprise Plan - Monthly')).toBeVisible({ timeout: 8000 })
  await window.waitForTimeout(1600)
})
