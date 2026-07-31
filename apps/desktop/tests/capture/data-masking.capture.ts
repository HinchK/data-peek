import { test, expect } from './fixtures/recording-app'

test('data-masking', async ({ window, cursor, pg }) => {
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

  await cursor.click('.monaco-editor')
  await cursor.type('SELECT id, email, name, created_at FROM users ORDER BY email LIMIT 5')
  await window.waitForTimeout(700)

  await cursor.press('Meta+Enter')
  await expect(window.locator('tbody tr')).toHaveCount(5, { timeout: 15000 })
  await window.waitForTimeout(900)

  // Hold on the plain, legible email column before masking is turned on — the
  // harness defaults auto-masking off, and this clip's whole point is filming
  // the toggle, not showing a pre-masked table.
  await window.waitForTimeout(1400)

  await cursor.click('button:has-text("Masking")')
  await expect(window.getByText('Data Masking')).toBeVisible({ timeout: 5000 })
  await window.waitForTimeout(500)

  await cursor.click(
    'div.flex.items-center.justify-between:has-text("Auto-mask sensitive columns") button[role="switch"]'
  )

  // The email column matches the default 'email' auto-mask rule, so turning the
  // toggle on should blur it immediately.
  await expect(window.locator('span[style*="blur"]').first()).toBeVisible({ timeout: 5000 })
  await window.waitForTimeout(600)

  await cursor.press('Escape')
  await expect(window.getByText('Data Masking')).not.toBeVisible({ timeout: 5000 })
  await window.waitForTimeout(3000)
})
