/**
 * Watch Mode scheduler — a singleton that owns the setTimeout cycle for every
 * watched tab. Lives outside React because timer accuracy matters and we don't
 * want every effect re-mount to reset cadence.
 *
 * Tick lifecycle:
 *
 *   1. setTimeout fires at nextTickAt.
 *   2. If the tab's watch is gone or paused, requeue or stop.
 *   3. If a previous tick for this tab is still in flight, skip — never queue.
 *   4. Call runner.runQuery(). Build the snapshot + diff.
 *   5. Call watchStore.applyTick.
 *   6. Schedule next tick relative to *when this tick started* — if the query
 *      took longer than cadence, fire the next one immediately.
 *
 * The scheduler also subscribes to document.visibilitychange and pauses all
 * tabs whose config has pauseWhenHidden=true while the window is hidden.
 */

import { useWatchStore } from '@/stores/watch-store'
import { useTabStore } from '@/stores/tab-store'
import { CADENCE_FLOOR_MS, type WatchSnapshot } from './watch-types'
import { pickKeyingPlan, type KeyingPlan } from './watch-row-keying'
import { computeDiff } from './watch-diff'
import { evaluateAlerts } from './watch-alerts'
import { notifyWatchAlert } from './watch-notify'
import type { WatchDiff } from './watch-types'

export interface WatchRunResult {
  rows: Record<string, unknown>[]
  fields: Array<{ name: string; dataType: string }>
  durationMs: number
  error: string | null
}

export interface WatchRunner {
  /** Re-run the watched query. Should respect the existing executionId path. */
  runQuery: () => Promise<WatchRunResult>
  /** Optional explicit primary-key columns (from schema cache). */
  getKeyColumns?: () => ReadonlyArray<string> | undefined
}

interface RegisteredTab {
  runner: WatchRunner
  /** Wall-clock ms at which the next tick should fire. */
  scheduledAt: number | null
  /** Tick counter for this watch session. */
  tickCounter: number
  /** True while a tick is awaiting its query response. */
  inFlight: boolean
  /** Last keying plan picked — keep stable across ticks unless fields change. */
  lastPlan: KeyingPlan | null
  /** Field signature for cache invalidation of lastPlan. */
  lastFieldSig: string | null
}

/**
 * A diff that claims no new movement: already-highlighted cells keep their
 * `changedAt` so their fade carries on. Used when a tick lands without the grid
 * being refreshed (failed poll, or a refresh declined while the user is
 * mid-edit) so the overlay keeps describing the rows still on screen.
 */
function carryDiff(previous: WatchDiff | null, plan: KeyingPlan | null): WatchDiff {
  return {
    cells: previous?.cells ?? new Map(),
    addedRowKeys: new Set(),
    removedRowKeys: new Set(),
    keyingStrategy: plan?.strategy ?? 'row_position',
    keyColumns: plan?.keyColumns ?? [],
    // Fresh timestamp: applyTick counts cells whose changedAt equals computedAt
    // as new, so reusing the previous one would double-count them.
    computedAt: Date.now()
  }
}

class WatchScheduler {
  private tabs = new Map<string, RegisteredTab>()
  private timers = new Map<string, ReturnType<typeof setTimeout>>()
  private visibilitySetup = false
  private tabStoreSetup = false

  register(tabId: string, runner: WatchRunner): void {
    this.unregister(tabId)
    this.tabs.set(tabId, {
      runner,
      scheduledAt: null,
      tickCounter: 0,
      inFlight: false,
      lastPlan: null,
      lastFieldSig: null
    })
    this.ensureVisibilityListener()
    this.ensureTabStoreListener()
    // Fire one tick immediately so the user sees their first snapshot land.
    this.triggerNow(tabId)
  }

  unregister(tabId: string): void {
    const timer = this.timers.get(tabId)
    if (timer) {
      clearTimeout(timer)
      this.timers.delete(tabId)
    }
    this.tabs.delete(tabId)
    useWatchStore.getState().setNextTickAt(tabId, null)
  }

  triggerNow(tabId: string): void {
    const timer = this.timers.get(tabId)
    if (timer) clearTimeout(timer)
    this.timers.delete(tabId)
    void this.tick(tabId)
  }

  /** Called when config.cadenceMs changes — re-arm based on new cadence. */
  reschedule(tabId: string): void {
    const entry = this.tabs.get(tabId)
    if (!entry) return
    const state = useWatchStore.getState().states[tabId]
    if (!state || !state.enabled || state.paused) return
    this.scheduleNext(tabId, state.config.cadenceMs)
  }

  isRegistered(tabId: string): boolean {
    return this.tabs.has(tabId)
  }

  private async tick(tabId: string): Promise<void> {
    const entry = this.tabs.get(tabId)
    if (!entry) return

    const store = useWatchStore.getState()
    const state = store.states[tabId]
    if (!state || !state.enabled) {
      this.unregister(tabId)
      return
    }
    if (state.paused) {
      this.scheduleNext(tabId, state.config.cadenceMs)
      return
    }
    if (entry.inFlight) {
      // Previous tick still pending — skip this one. The finally in the
      // running tick will schedule the next.
      return
    }

    entry.inFlight = true
    const tickStart = performance.now()
    const startedAt = Date.now()
    let snapshot: WatchSnapshot
    try {
      const result = await entry.runner.runQuery()

      const fieldSig = result.fields.map((f) => f.name).join('\0')
      let plan = entry.lastPlan
      if (!plan || entry.lastFieldSig !== fieldSig) {
        plan = pickKeyingPlan({
          explicitKeyColumns: entry.runner.getKeyColumns?.(),
          fieldNames: result.fields.map((f) => f.name)
        })
        entry.lastPlan = plan
        entry.lastFieldSig = fieldSig
      }

      entry.tickCounter += 1
      snapshot = {
        tick: entry.tickCounter,
        capturedAt: startedAt,
        rowCount: result.rows.length,
        durationMs: result.durationMs,
        error: result.error,
        rows: result.rows,
        fields: result.fields
      }

      // Diff against the rows on screen, read from the tab immediately before we
      // overwrite them. Caching them here instead would go stale the moment
      // anything else writes tab.result — a manual re-run, or the re-run that
      // fires when the user commits the very edits that made us decline a
      // refresh — and the diff would then describe a transition nobody saw.
      const displayedTab = useTabStore.getState().getTab(tabId)
      const displayedRows =
        displayedTab && 'result' in displayedTab ? displayedTab.result?.rows : undefined

      // The grid renders tab.result, not the snapshot, so a tick has to write
      // there too — otherwise the overlay highlights cells whose on-screen text
      // is still the previous value, which is the whole point of Watch Mode.
      // The tab store declines the refresh while the user has an inline edit in
      // flight; failed polls leave the last good rows up rather than blanking.
      const refreshed =
        !result.error &&
        useTabStore.getState().applyWatchResult(tabId, {
          columns: result.fields.map((f) => ({ name: f.name, dataType: f.dataType })),
          rows: result.rows,
          rowCount: result.rows.length,
          durationMs: result.durationMs
        })

      const latest = useWatchStore.getState().states[tabId]
      const previousSnap = latest?.snapshots[0]
      const diff = refreshed
        ? computeDiff({
            previous: displayedRows ? { rows: displayedRows, keyingPlan: plan } : undefined,
            next: {
              rows: result.rows,
              keyingPlan: plan,
              fieldNames: result.fields.map((f) => f.name)
            },
            now: Date.now(),
            carryFromPrevious: latest?.diff ?? null,
            fadeMs: latest?.config.fadeMs ?? 8000
          })
        : carryDiff(latest?.diff ?? null, plan)

      // The watch could've been stopped while the query was in flight.
      if (useWatchStore.getState().states[tabId]?.enabled) {
        useWatchStore.getState().applyTick(tabId, snapshot, diff)
        this.runAlerts(tabId, snapshot, previousSnap ?? null, diff)
      }
    } catch (err) {
      entry.tickCounter += 1
      snapshot = {
        tick: entry.tickCounter,
        capturedAt: startedAt,
        rowCount: 0,
        durationMs: performance.now() - tickStart,
        error: err instanceof Error ? err.message : String(err),
        rows: [],
        fields: []
      }
      const latest = useWatchStore.getState().states[tabId]
      if (latest?.enabled) {
        const carriedDiff = carryDiff(latest.diff ?? null, entry.lastPlan)
        useWatchStore.getState().applyTick(tabId, snapshot, carriedDiff)
        // Alerts still run on failed ticks — `query_errors` exists for them.
        this.runAlerts(tabId, snapshot, latest.snapshots[0] ?? null, carriedDiff)
      }
    } finally {
      entry.inFlight = false
      const elapsed = performance.now() - tickStart
      const stateNow = useWatchStore.getState().states[tabId]
      if (stateNow && stateNow.enabled && !stateNow.paused) {
        const wait = Math.max(CADENCE_FLOOR_MS, stateNow.config.cadenceMs - elapsed)
        this.scheduleNext(tabId, wait)
      }
    }
  }

  /**
   * Evaluate the tab's alerts against the tick that just landed, commit the
   * updated arming/fired state, and raise OS notifications for fires. Kept
   * out of the store so applyTick stays a pure state transition.
   */
  private runAlerts(
    tabId: string,
    snapshot: WatchSnapshot,
    previous: WatchSnapshot | null,
    diff: WatchDiff
  ): void {
    const store = useWatchStore.getState()
    const state = store.states[tabId]
    if (!state || !state.enabled || state.alerts.length === 0) return
    const { alerts, fired } = evaluateAlerts(state.alerts, {
      snapshot,
      previous: previous && !previous.error ? previous : null,
      diff,
      now: Date.now()
    })
    store.setAlerts(tabId, alerts)
    if (fired.length === 0) return
    const tabTitle = useTabStore.getState().tabs.find((t) => t.id === tabId)?.title
    for (const alert of fired) {
      notifyWatchAlert({ alert, snapshot, tabTitle })
    }
  }

  private scheduleNext(tabId: string, ms: number): void {
    const existing = this.timers.get(tabId)
    if (existing) clearTimeout(existing)
    const wait = Math.max(CADENCE_FLOOR_MS, ms)
    const at = Date.now() + wait
    useWatchStore.getState().setNextTickAt(tabId, at)
    const t = setTimeout(() => {
      this.timers.delete(tabId)
      void this.tick(tabId)
    }, wait)
    this.timers.set(tabId, t)
  }

  /**
   * Subscribe once to the tab store so we tear down any watch whose tab has
   * been closed. Without this, closing a watched tab leaks the timer and the
   * scheduler keeps firing IPC against a phantom tabId.
   */
  private ensureTabStoreListener(): void {
    if (this.tabStoreSetup) return
    this.tabStoreSetup = true
    useTabStore.subscribe((state, prev) => {
      if (state.tabs === prev.tabs) return
      const live = new Set(state.tabs.map((t) => t.id))
      for (const tabId of this.tabs.keys()) {
        if (!live.has(tabId)) {
          this.unregister(tabId)
          useWatchStore.getState().stop(tabId)
        }
      }
    })
  }

  private ensureVisibilityListener(): void {
    if (this.visibilitySetup) return
    if (typeof document === 'undefined') return
    this.visibilitySetup = true
    document.addEventListener('visibilitychange', () => {
      const hidden = document.visibilityState === 'hidden'
      const store = useWatchStore.getState()
      for (const tabId of this.tabs.keys()) {
        const st = store.states[tabId]
        if (!st || !st.enabled) continue
        if (hidden && st.config.pauseWhenHidden && !st.paused) {
          store.pause(tabId)
        } else if (!hidden && st.config.pauseWhenHidden && st.paused) {
          store.resume(tabId)
          this.triggerNow(tabId)
        }
      }
    })
  }
}

export const watchScheduler = new WatchScheduler()
