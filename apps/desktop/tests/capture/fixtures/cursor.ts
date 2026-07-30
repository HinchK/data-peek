import type { Page } from '@playwright/test'

/**
 * Synthetic pointer + keycap HUD for screen captures.
 *
 * Playwright records video via CDP screencast, which does not include the OS
 * cursor. Clips of click-driven flows are unreadable without a visible pointer,
 * so we inject a DOM overlay and move it in lockstep with `page.mouse`.
 *
 * The keycap HUD is not decoration: for a keyboard-first tool, showing the
 * keystroke that caused an effect is the substance of the clip.
 */

const OVERLAY_SCRIPT = `
(() => {
  if (window.__dpCursorReady) return
  window.__dpCursorReady = true

  const install = () => {
    const style = document.createElement('style')
    style.textContent = \`
      #dp-cursor {
        position: fixed; top: 0; left: 0; width: 22px; height: 22px;
        margin: -3px 0 0 -3px; z-index: 2147483647; pointer-events: none;
        opacity: 0; transition: opacity 160ms ease;
        filter: drop-shadow(0 1px 2px rgba(0,0,0,0.55));
      }
      #dp-cursor.visible { opacity: 1; }
      #dp-ripple {
        position: fixed; top: 0; left: 0; width: 34px; height: 34px;
        margin: -17px 0 0 -17px; border-radius: 50%; z-index: 2147483646;
        pointer-events: none; opacity: 0;
        border: 2px solid oklch(0.65 0.15 250);
        background: oklch(0.65 0.15 250 / 0.18);
      }
      #dp-ripple.fire { animation: dp-ripple 420ms ease-out 1; }
      @keyframes dp-ripple {
        0%   { opacity: 0.9; transform: scale(0.35); }
        100% { opacity: 0;   transform: scale(1.5); }
      }
      #dp-keys {
        position: fixed; bottom: 28px; left: 50%; transform: translateX(-50%);
        display: flex; gap: 6px; z-index: 2147483647; pointer-events: none;
        opacity: 0; transition: opacity 140ms ease;
        font-family: ui-monospace, SFMono-Regular, monospace;
      }
      #dp-keys.visible { opacity: 1; }
      #dp-keys kbd {
        min-width: 30px; height: 30px; padding: 0 9px;
        display: inline-flex; align-items: center; justify-content: center;
        font-size: 13px; color: #fff; border-radius: 6px;
        background: rgba(20,22,28,0.92);
        border: 1px solid rgba(255,255,255,0.16);
        box-shadow: 0 2px 8px rgba(0,0,0,0.4);
      }
    \`
    document.head.appendChild(style)

    const cursor = document.createElement('div')
    cursor.id = 'dp-cursor'
    cursor.innerHTML =
      '<svg viewBox="0 0 22 22" width="22" height="22">' +
      '<path d="M4 2 L4 17 L8.2 13.2 L11 19.5 L13.6 18.3 L10.8 12.2 L16.5 12 Z"' +
      ' fill="#fff" stroke="rgba(0,0,0,0.6)" stroke-width="1.1"/></svg>'
    document.body.appendChild(cursor)

    const ripple = document.createElement('div')
    ripple.id = 'dp-ripple'
    document.body.appendChild(ripple)

    const keys = document.createElement('div')
    keys.id = 'dp-keys'
    document.body.appendChild(keys)

    window.__dpCursor = {
      move(x, y) {
        cursor.classList.add('visible')
        cursor.style.transform = 'translate(' + x + 'px,' + y + 'px)'
        ripple.style.transform = 'translate(' + x + 'px,' + y + 'px)'
      },
      ripple(x, y) {
        ripple.style.transform = 'translate(' + x + 'px,' + y + 'px)'
        ripple.classList.remove('fire')
        void ripple.offsetWidth
        ripple.classList.add('fire')
      },
      showKeys(labels) {
        keys.innerHTML = labels.map((l) => '<kbd>' + l + '</kbd>').join('')
        keys.classList.add('visible')
      },
      hideKeys() {
        keys.classList.remove('visible')
      }
    }
  }

  if (document.body) install()
  else document.addEventListener('DOMContentLoaded', install, { once: true })
})()
`

/** Human-readable keycap labels for a Playwright key expression like 'Meta+k'. */
function keycaps(keys: string): string[] {
  const map: Record<string, string> = {
    Meta: '⌘',
    Control: 'Ctrl',
    Alt: '⌥',
    Shift: '⇧',
    Enter: '↵',
    Escape: 'Esc',
    ArrowDown: '↓',
    ArrowUp: '↑'
  }
  return keys.split('+').map((k) => map[k] ?? k.toUpperCase())
}

export interface Cursor {
  /** Ease the pointer to the centre of the first match of `selector`. */
  moveTo(selector: string): Promise<void>
  /** Move to the element, fire a ripple, then click it. */
  click(selector: string): Promise<void>
  /** Press a Playwright key expression and flash its keycaps in the HUD. */
  press(keys: string, label?: string): Promise<void>
  /** Type text at a human cadence. */
  type(text: string, delayMs?: number): Promise<void>
  /** Hide the keycap HUD. */
  hideKeys(): Promise<void>
}

/** Cubic ease-in-out — instant pointer jumps read as glitches on video. */
function ease(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2
}

/** Pointer start position — centre of the recorded frame. */
const CLIP_CENTRE = { x: 720, y: 450 }

export async function installCursor(page: Page): Promise<Cursor> {
  await page.addInitScript(OVERLAY_SCRIPT)
  // The page may already be mounted when this runs, in which case addInitScript
  // only applies to the *next* navigation — so install into the live document too.
  await page.evaluate(OVERLAY_SCRIPT)

  let at = { x: CLIP_CENTRE.x, y: CLIP_CENTRE.y }

  async function moveTo(selector: string): Promise<void> {
    const box = await page.locator(selector).first().boundingBox()
    if (!box) throw new Error(`cursor.moveTo: no bounding box for ${selector}`)
    const to = { x: box.x + box.width / 2, y: box.y + box.height / 2 }
    const steps = 24
    for (let i = 1; i <= steps; i++) {
      const t = ease(i / steps)
      const x = at.x + (to.x - at.x) * t
      const y = at.y + (to.y - at.y) * t
      await page.mouse.move(x, y)
      await page.evaluate(([px, py]) => window.__dpCursor.move(px, py), [x, y])
      await page.waitForTimeout(12)
    }
    at = to
  }

  return {
    moveTo,
    async click(selector: string) {
      await moveTo(selector)
      await page.evaluate(([px, py]) => window.__dpCursor.ripple(px, py), [at.x, at.y])
      await page.waitForTimeout(120)
      await page.locator(selector).first().click()
      await page.waitForTimeout(180)
    },
    async press(keys: string, label?: string) {
      const caps = label ? [label] : keycaps(keys)
      await page.evaluate((c) => window.__dpCursor.showKeys(c), caps)
      await page.waitForTimeout(260)
      await page.keyboard.press(keys)
      await page.waitForTimeout(520)
      await page.evaluate(() => window.__dpCursor.hideKeys())
    },
    async type(text: string, delayMs = 34) {
      await page.keyboard.type(text, { delay: delayMs })
    },
    async hideKeys() {
      await page.evaluate(() => window.__dpCursor.hideKeys())
    }
  }
}

declare global {
  interface Window {
    __dpCursorReady?: boolean
    __dpCursor: {
      move(x: number, y: number): void
      ripple(x: number, y: number): void
      showKeys(labels: string[]): void
      hideKeys(): void
    }
  }
}
