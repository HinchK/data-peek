import { test, expect } from './fixtures/recording-app'

test('ai-to-sql', async ({ window, cursor, pg }) => {
  // Configure the BYOH provider (the user's own local `claude` CLI) through IPC
  // instead of filming the settings form — that isn't the point of this clip
  // and would double its length. `claude-cli` is a keyless provider, so no
  // apiKey is needed; `sonnet` is its recommended model (DEFAULT_MODELS).
  await window.evaluate(() =>
    window.api.ai.setMultiProviderConfig({
      providers: { 'claude-cli': {} },
      activeProvider: 'claude-cli',
      activeModels: { 'claude-cli': 'sonnet' }
    })
  )
  await window.reload()
  await window.waitForSelector('#root', { timeout: 15000 })

  // Select the seeded connection — the harness only adds it, it never selects
  // it (see command-palette.capture.ts).
  await cursor.click('[data-sidebar="menu-button"]')
  const connectionItem = window.locator('[role="menuitem"]').filter({ hasText: pg.config.name })
  await expect(connectionItem).toBeVisible({ timeout: 8000 })
  await cursor.click(`[role="menuitem"]:has-text("${pg.config.name}")`)
  await expect(window.locator('header').getByText(pg.config.name)).toBeVisible({ timeout: 5000 })

  // Let the schema fetch (9 tables) land before asking a schema-aware
  // question — the whole point is the model knowing real table/column names.
  await window.waitForTimeout(2000)

  await cursor.press('Meta+i')
  const composer = window.getByPlaceholder('Ask about your data...')
  await expect(composer).toBeVisible({ timeout: 5000 })
  await window.waitForTimeout(400)

  await cursor.click('textarea[placeholder="Ask about your data..."]')
  await cursor.type('Show me the 5 most recent invoices with the organization name for each', 32)
  await window.waitForTimeout(400)
  await cursor.press('Enter')

  // Real local `claude` CLI call (one-shot, non-agentic — no MCP server needed
  // for this clip). Hold on the generated, schema-aware SQL once it lands.
  await expect(window.getByText('Generated SQL')).toBeVisible({ timeout: 90000 })
  const sqlBlock = window
    .locator('pre')
    .filter({ hasText: /select/i })
    .first()
  await expect(sqlBlock).toContainText(/organizations/i, { timeout: 5000 })
  await expect(sqlBlock).toContainText(/invoices/i)
  await window.waitForTimeout(1600)

  // The feature's claim is a *runnable* query, so run it. The table-name checks
  // above would pass on syntactically broken SQL that merely mentions the right
  // names; only executing it proves the claim. Waiting on the row count means a
  // failed run — which renders "Query failed" instead — times out loudly rather
  // than filming a broken result panel.
  await cursor.click('button:has-text("Run Query")')
  await expect(window.getByText(/[1-9]\d* rows?/).first()).toBeVisible({ timeout: 30000 })
  await expect(window.getByText('Query failed')).toHaveCount(0)
  await window.waitForTimeout(2400)
})
