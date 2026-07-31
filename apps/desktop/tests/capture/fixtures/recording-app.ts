import { test as base, _electron, type ElectronApplication, type Page } from '@playwright/test'
import { existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { startSeededPostgres, type SeededPostgres } from '../../e2e/fixtures/postgres'
import { installCursor, type Cursor } from './cursor'

const MAIN_ENTRY = resolve(__dirname, '..', '..', '..', 'out', 'main', 'index.js')

/** Raw footage lands here; the ffmpeg pipeline in tools/feature-clips reads it. */
export const FOOTAGE_DIR = resolve(
  __dirname,
  '..',
  '..',
  '..',
  '..',
  '..',
  'tools',
  'feature-clips',
  'footage'
)

/**
 * Every clip is captured at this size so encoded outputs share dimensions.
 * 1728x1080 rather than the desktop app's narrower default: the editor layout's
 * minimum width overlaps the sidebar below ~1720px (see
 * tests/e2e/watch-mode.spec.ts). 1728 is exactly a 1.6 ratio so the later
 * ffmpeg `scale=1280:-2` lands on 1280x800 with no odd-dimension rounding.
 */
export const CLIP_SIZE = { width: 1728, height: 1080 }

interface CaptureFixtures {
  /** Temp directory used as `--user-data-dir`; cleaned up after the test. */
  userDataDir: string
  recordedApp: ElectronApplication
  window: Page
  cursor: Cursor
}

/** Worker-scoped: one container per worker, not per test. */
interface CaptureWorkerFixtures {
  pg: SeededPostgres
}

/**
 * Boots the built Electron app with video recording on, then saves the footage to
 * `FOOTAGE_DIR/<test title>.webm`. The test title IS the clip id — keep titles
 * kebab-case and in sync with `tools/feature-clips/clips.manifest.json`.
 *
 * One Postgres container per worker is shared across the file (`scope: 'worker'`),
 * because each container costs 3-5s to boot.
 */
export const test = base.extend<CaptureFixtures, CaptureWorkerFixtures>({
  pg: [
    async ({}, use) => {
      const seeded = await startSeededPostgres()
      await use(seeded)
      await seeded.stop()
    },
    { scope: 'worker' }
  ],

  // Own fixture (mirroring tests/e2e/fixtures/electron-app.ts) so its teardown
  // runs independently of `recordedApp` — if `recordedApp` throws during setup,
  // before reaching `use()`, Playwright still unwinds this fixture and removes
  // the temp dir.
  userDataDir: async ({}, use) => {
    const dir = mkdtempSync(join(tmpdir(), 'data-peek-capture-'))
    await use(dir)
    try {
      rmSync(dir, { recursive: true, force: true })
    } catch {
      // Best-effort; the OS reaps temp dirs.
    }
  },

  recordedApp: async ({ userDataDir }, use, testInfo) => {
    if (!existsSync(MAIN_ENTRY)) {
      throw new Error(
        `Electron main bundle not found at ${MAIN_ENTRY}. Run \`pnpm build\` first ` +
          `(or use \`pnpm capture\`, which builds before recording).`
      )
    }
    mkdirSync(FOOTAGE_DIR, { recursive: true })

    const app = await _electron.launch({
      args: [MAIN_ENTRY, `--user-data-dir=${userDataDir}`],
      env: { ...process.env, DP_E2E: '1', NODE_ENV: 'production' },
      recordVideo: { dir: join(FOOTAGE_DIR, '.raw'), size: CLIP_SIZE }
    })

    const page = await app.firstWindow()
    const video = page.video()
    if (!video) {
      // This throw happens before `use()`, so no teardown below runs for `app` —
      // close it ourselves or a missing screencast handle leaks the Electron process.
      await app.close()
      throw new Error(
        'recordVideo produced no Video handle — Playwright did not attach a screencast ' +
          'to the Electron window. See the fallback documented in the design spec.'
      )
    }

    await use(app)

    // Close first so the screencast is flushed, then name it after the test and
    // delete the raw intermediate so `.raw/` doesn't accumulate across specs.
    await app.close()
    await video.saveAs(join(FOOTAGE_DIR, `${testInfo.title}.webm`))
    await video.delete()
  },

  window: async ({ recordedApp, pg }, use) => {
    const page = await recordedApp.firstWindow()
    // Force dark before first paint. The app already defaults to dark, but pinning
    // it here means a future default change can't silently invalidate every clip.
    // Also disable auto-masking by default: masking-store.ts defaults
    // autoMaskEnabled to true with an 'email' rule enabled, which blurs the email
    // column in every clip and reads as a rendering bug to anyone who doesn't
    // know the feature exists. This is a harness default, not an override — a
    // later spec (e.g. one filming data masking itself) can add its own
    // addInitScript after this one to set autoMaskEnabled back to true.
    await page.addInitScript(() => {
      localStorage.setItem('data-peek-theme', 'dark')
      localStorage.setItem(
        'masking-store',
        JSON.stringify({ state: { autoMaskEnabled: false }, version: 0 })
      )
    })

    // Even at CLIP_SIZE, some result shapes (e.g. a UUID primary key column)
    // push the app's root layout a few dozen px past the viewport. Focusing
    // Monaco then triggers the browser's default scroll-into-view, which
    // shoves the whole page left-to-right mid-clip — a horizontal scroll in
    // released footage reads as a bug. Pin the document non-scrollable
    // instead of chasing every content shape that could overflow 1728px; any
    // overflow is simply clipped off the right edge, which is far less
    // damaging than the left edge (SQL text, emails) shifting out of frame.
    await page.addInitScript(() => {
      const unscroll = (): void => {
        if (document.documentElement.scrollLeft) document.documentElement.scrollLeft = 0
        if (document.body.scrollLeft) document.body.scrollLeft = 0
      }
      const pin = (): void => {
        document.documentElement.style.overflowX = 'hidden'
        document.body.style.overflowX = 'hidden'
        // overflow: hidden only hides the scrollbar — the browser's focus
        // scroll-into-view still sets scrollLeft and the content still
        // shifts. Snap it back on the same tick so the offset never paints.
        document.addEventListener('scroll', unscroll, { capture: true, passive: true })
        window.addEventListener('scroll', unscroll, { passive: true })
      }
      if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', pin, { once: true })
      } else {
        pin()
      }
    })

    await recordedApp.evaluate(({ BrowserWindow }, size) => {
      const win = BrowserWindow.getAllWindows()[0]
      win.setContentSize(size.width, size.height)
      win.center()
    }, CLIP_SIZE)

    await page.waitForLoadState('domcontentloaded')
    await page.evaluate((cfg) => window.api.connections.add(cfg), pg.config)
    await page.reload()
    await page.waitForSelector('#root', { timeout: 15000 })
    await use(page)
  },

  cursor: async ({ window }, use) => {
    await use(await installCursor(window))
  }
})

export { expect } from '@playwright/test'
