import { existsSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { test, expect, FOOTAGE_DIR } from './fixtures/recording-app'

test('smoke', async ({ window, cursor }) => {
  await expect(window.locator('#root')).toBeVisible()
  await cursor.press('Meta+k')
  await window.waitForTimeout(1200)
  await cursor.press('Escape')
  await window.waitForTimeout(600)
})

test.afterAll(() => {
  const clip = join(FOOTAGE_DIR, 'smoke.webm')
  expect(existsSync(clip), `expected footage at ${clip}`).toBe(true)
  expect(statSync(clip).size).toBeGreaterThan(20_000)
})
