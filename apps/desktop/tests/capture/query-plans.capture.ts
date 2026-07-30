import { test, expect } from './fixtures/recording-app'

const QUERY =
  'SELECT o.name AS org_name, o.plan, COUNT(i.id) AS invoice_count, ' +
  'SUM(i.amount_cents) AS total_cents FROM organizations o ' +
  'JOIN invoices i ON i.organization_id = o.id ' +
  'JOIN subscriptions s ON s.organization_id = o.id ' +
  "WHERE i.status = 'paid' GROUP BY o.name, o.plan ORDER BY total_cents DESC"

test('query-plans', async ({ window, cursor, pg }) => {
  // Select the seeded connection first — the harness only adds it, it never selects
  // it (see command-palette.capture.ts).
  await cursor.click('[data-sidebar="menu-button"]')
  const connectionItem = window.locator('[role="menuitem"]').filter({ hasText: pg.config.name })
  await expect(connectionItem).toBeVisible({ timeout: 8000 })
  await cursor.click(`[role="menuitem"]:has-text("${pg.config.name}")`)
  await expect(window.locator('header').getByText(pg.config.name)).toBeVisible({ timeout: 5000 })
  await window.waitForTimeout(500)

  const newQueryBtn = window.getByRole('button', { name: /new query/i })
  if (await newQueryBtn.isVisible()) {
    await cursor.click('button:has-text("New Query")')
  } else {
    await cursor.press('Meta+t')
  }
  await expect(window.locator('.monaco-editor').first()).toBeVisible({ timeout: 15000 })
  await window.waitForTimeout(500)

  // A three-table join with a filter, GROUP BY, and ORDER BY produces a plan tree
  // with several distinct node types (hash joins, seq scans, aggregate, sort) —
  // a flat `SELECT * FROM users` would render as one uninteresting node.
  await cursor.click('.monaco-editor')
  await cursor.type(QUERY)
  await window.waitForTimeout(700)

  await cursor.click('button:has-text("Explain")')
  await expect(window.getByText('Query Execution Plan')).toBeVisible({ timeout: 15000 })
  await window.waitForTimeout(1000)

  // The top few levels of the tree open by default (PlanNodeView: depth < 3);
  // expand a deeper, still-collapsed node so the clip shows the tree responding
  // to a click rather than sitting static. Scoped to the plan panel itself —
  // an unscoped query can match a collapsed sidebar tree item hidden behind the
  // panel's backdrop, which is unclickable and hangs the click.
  const planPanel = 'div.fixed.top-0.bottom-0.right-0.z-50.bg-background'
  const closedToggleSelector = `${planPanel} button[data-slot="collapsible-trigger"][data-state="closed"]`
  const closedToggle = window.locator(closedToggleSelector).first()
  if (await closedToggle.isVisible().catch(() => false)) {
    await cursor.click(closedToggleSelector)
    await window.waitForTimeout(900)
  }

  await window.waitForTimeout(5500)
})
