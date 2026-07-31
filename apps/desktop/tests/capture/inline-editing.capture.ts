import { test, expect } from './fixtures/recording-app'

test('inline-editing', async ({ window, cursor, pg }) => {
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
  // Project id — users' only primary key — so the result is recognised as editable.
  // The rule is in resolveEditSourceTable (src/renderer/src/components/query-editor/
  // use-editable-result.ts): every primary-key column must appear in the projection.
  // analyzeEditableSelect only parses table and projection shape; it has no concept
  // of primary keys.
  await cursor.type('SELECT id, email, name, created_at FROM users ORDER BY email LIMIT 5')
  await window.waitForTimeout(700)

  await cursor.press('Meta+Enter')
  const rows = window.locator('tbody tr')
  await expect(rows).toHaveCount(5, { timeout: 15000 })
  await window.waitForTimeout(700)

  // "name" is the 3rd projected column (id, email, name, created_at) -> td index 2.
  const nameCell = rows.nth(0).locator('td').nth(2)
  const originalName = (await nameCell.innerText()).trim()
  expect(originalName.length).toBeGreaterThan(0)

  // Hold on the plain cell for a beat before editing.
  await window.waitForTimeout(600)

  // Double-click enters edit mode for the whole table and starts editing this cell
  // in one action (see handleActivate in editable-data-table.tsx).
  await cursor.moveTo(`tbody tr:nth-child(1) td:nth-child(3)`)
  await nameCell.dblclick()

  const input = window.locator('[data-testid="editable-cell-input"]')
  await expect(input).toBeVisible({ timeout: 5000 })
  // Entering edit mode also flips the toolbar to its amber "Exit Edit" state.
  await expect(window.getByRole('button', { name: /exit edit/i })).toBeVisible({ timeout: 5000 })
  await window.waitForTimeout(400)

  const selectAll = process.platform === 'darwin' ? 'Meta+a' : 'Control+a'
  await cursor.press(selectAll)
  await cursor.type('Data Peek Demo')
  await window.waitForTimeout(500)

  await cursor.press('Enter')
  await expect(input).toBeHidden({ timeout: 5000 })
  // Entering edit mode prepends a row-actions column, shifting every td index
  // by one — so re-find the cell by its new value instead of a stale index.
  await expect(rows.nth(0).getByText('Data Peek Demo', { exact: true })).toBeVisible({
    timeout: 5000
  })
  await expect(window.getByText('1 modified')).toBeVisible({ timeout: 5000 })
  await window.waitForTimeout(700)

  await cursor.click('button:has-text("Preview SQL")')
  await expect(window.getByText('SQL Preview')).toBeVisible({ timeout: 5000 })
  await expect(window.locator('pre code')).toContainText('UPDATE')
  await expect(window.locator('pre code')).toContainText('Data Peek Demo')
  await window.waitForTimeout(900)

  await cursor.click('button:has-text("Execute 1 Statement")')
  await expect(window.getByText('SQL Preview')).not.toBeVisible({ timeout: 10000 })
  await expect(window.getByText('1 modified')).not.toBeVisible({ timeout: 10000 })
  await window.waitForTimeout(1800)
})
