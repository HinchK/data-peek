import { test, expect } from './fixtures/recording-app'

test('command-palette', async ({ window, cursor, pg }) => {
  // Select the seeded connection first so the header and Connections group show
  // a real, active connection instead of an empty pre-connect state (the harness
  // only adds the connection, it never selects it).
  await cursor.click('[data-sidebar="menu-button"]')
  const connectionItem = window.locator('[role="menuitem"]').filter({ hasText: pg.config.name })
  await expect(connectionItem).toBeVisible({ timeout: 8000 })
  await cursor.click(`[role="menuitem"]:has-text("${pg.config.name}")`)
  await expect(window.locator('header').getByText(pg.config.name)).toBeVisible({ timeout: 5000 })
  await window.waitForTimeout(500)

  await cursor.press('Meta+k')
  const palette = window.locator('[cmdk-root], [role="dialog"]').first()
  await expect(palette).toBeVisible({ timeout: 8000 })
  await cursor.moveTo('[cmdk-input]')
  await window.waitForTimeout(700)

  // First search: narrows the whole home page down to the Connections group.
  await cursor.type('conn', 65)
  await window.waitForTimeout(1300)

  // Clear and search again: narrows to the single "Change Theme" item.
  await cursor.press('Meta+a')
  await cursor.type('theme', 65)
  await window.waitForTimeout(1300)

  // Clear and search a third time: narrows to the Queries group.
  await cursor.press('Meta+a')
  await cursor.type('quer', 65)
  await window.waitForTimeout(1300)

  await cursor.press('ArrowDown')
  await window.waitForTimeout(400)
  await cursor.press('Escape')
  await window.waitForTimeout(700)
})
