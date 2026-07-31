import { test, expect } from './fixtures/recording-app'

test('er-diagram', async ({ window, cursor, pg }) => {
  // Select the seeded connection first — the harness only adds it, it never selects
  // it (see command-palette.capture.ts).
  await cursor.click('[data-sidebar="menu-button"]')
  const connectionItem = window.locator('[role="menuitem"]').filter({ hasText: pg.config.name })
  await expect(connectionItem).toBeVisible({ timeout: 8000 })
  await cursor.click(`[role="menuitem"]:has-text("${pg.config.name}")`)
  await expect(window.locator('header').getByText(pg.config.name)).toBeVisible({ timeout: 5000 })
  await window.waitForTimeout(500)

  const erdButton = window.locator('button[title="View ERD diagram"]')
  await expect(erdButton).toBeVisible({ timeout: 10000 })
  await cursor.click('button[title="View ERD diagram"]')

  // Nodes mount asynchronously after xyflow's layout pass — wait on the node
  // itself rather than a fixed timeout.
  await expect(window.locator('.react-flow__node').first()).toBeVisible({ timeout: 15000 })
  await window.waitForTimeout(1000)

  // A small pan on the full graph so the canvas reads as interactive before we
  // narrow the view.
  const pane = window.locator('.react-flow__pane')
  const paneBox = await pane.boundingBox()
  if (paneBox) {
    const startX = paneBox.x + paneBox.width / 2
    const startY = paneBox.y + paneBox.height / 2
    await window.mouse.move(startX, startY)
    await window.mouse.down()
    await window.mouse.move(startX - 140, startY - 70, { steps: 20 })
    await window.mouse.up()
  }
  await window.waitForTimeout(600)

  // Filter down to the organizations hub and its directly related tables — this
  // is the payoff: a focused relationship graph instead of the full schema.
  await cursor.click('button:has-text("Filter Tables")')
  const searchInput = window.getByPlaceholder('Search tables...')
  await expect(searchInput).toBeVisible({ timeout: 5000 })

  for (const table of ['organizations', 'subscriptions', 'invoices', 'projects']) {
    await cursor.click(`[data-radix-popper-content-wrapper] button:has-text("${table}")`)
    await window.waitForTimeout(250)
  }

  await cursor.press('Escape')
  await expect(searchInput).not.toBeVisible({ timeout: 5000 })

  // The filtered node set doesn't auto re-fit the viewport (xyflow's `fitView`
  // prop only applies on initial mount), so re-center via the built-in control.
  await cursor.click('.react-flow__controls-fitview')
  await expect(window.locator('.react-flow__edge').first()).toBeVisible({ timeout: 8000 })
  await window.waitForTimeout(6000)
})
