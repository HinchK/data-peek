import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { test, expect } from './fixtures/recording-app'

interface McpStatus {
  enabled: boolean
  running: boolean
  port: number
  token: string
  url: string
}

// Deliberately far from the e2e suite's 4723x ports and the app's own default
// so a locally running data-peek instance never collides with this capture.
const CAPTURE_MCP_PORT = 47910

test('mcp-approval', async ({ window, cursor, pg }) => {
  // Select the seeded connection — the harness only adds it, it never selects
  // it (see command-palette.capture.ts).
  await cursor.click('[data-sidebar="menu-button"]')
  const connectionItem = window.locator('[role="menuitem"]').filter({ hasText: pg.config.name })
  await expect(connectionItem).toBeVisible({ timeout: 8000 })
  await cursor.click(`[role="menuitem"]:has-text("${pg.config.name}")`)
  await expect(window.locator('header').getByText(pg.config.name)).toBeVisible({ timeout: 5000 })
  await window.waitForTimeout(500)

  // Enable the embedded MCP server through IPC — proven live in
  // tests/e2e/mcp-server.spec.ts — rather than filming the settings toggle.
  const portResult = await window.evaluate((port) => window.api.mcp.setPort(port), CAPTURE_MCP_PORT)
  expect(portResult.success).toBe(true)
  const enableResult = await window.evaluate(() => window.api.mcp.setEnabled(true))
  expect(enableResult.success).toBe(true)
  const status = enableResult.data as McpStatus
  expect(status.running).toBe(true)

  // A real MCP client — standing in for the harness — asks to run a write.
  // `execute_statement` is the one write-capable tool and every call to it
  // blocks server-side on the in-app approval gate (see mcp-handlers.ts /
  // ApprovalManager) until the user responds.
  const client = new Client({ name: 'feature-clip', version: '0.0.0' })
  const transport = new StreamableHTTPClientTransport(new URL(status.url), {
    requestInit: { headers: { authorization: `Bearer ${status.token}` } }
  })
  await client.connect(transport)

  const sql =
    "UPDATE users SET name = 'Updated by MCP agent' WHERE id = (SELECT id FROM users ORDER BY created_at LIMIT 1)"
  const pendingCall = client.callTool({
    name: 'execute_statement',
    arguments: { connectionId: pg.config.id, sql }
  })

  // Hold on the gate: the write is visibly stopped before it reaches the
  // database. This is the entire point of the clip.
  await expect(window.getByText('Agent wants to run a write statement')).toBeVisible({
    timeout: 8000
  })
  await expect(window.getByText(sql)).toBeVisible()
  await window.waitForTimeout(3200)

  await cursor.click('button:has-text("Reject")')

  const result = await pendingCall
  expect(result.isError).toBe(true)
  await expect(window.getByText('Agent wants to run a write statement')).not.toBeVisible({
    timeout: 5000
  })

  // The rejected write must never have touched the database.
  const check = await client.callTool({
    name: 'run_query',
    arguments: {
      connectionId: pg.config.id,
      sql: "SELECT count(*)::int AS n FROM users WHERE name = 'Updated by MCP agent'"
    }
  })
  const content = check.content as Array<{ type: string; text?: string }>
  const text = content
    .filter((c) => c.type === 'text')
    .map((c) => c.text ?? '')
    .join('\n')
  expect(text).toContain('"n": 0')

  await window.waitForTimeout(900)
  await client.close()
})
