import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import type { EditContext } from '@data-peek/shared'
import { watchScheduler, type WatchRunResult } from '../watch-scheduler'
import { cellKey } from '../watch-row-keying'
import { useWatchStore } from '@/stores/watch-store'
import { useTabStore } from '@/stores/tab-store'
import { useEditStore } from '@/stores/edit-store'

vi.stubGlobal('crypto', {
  randomUUID: () => 'test-uuid-' + Math.random().toString(36).slice(2)
})

const FIELDS = [
  { name: 'id', dataType: 'integer' },
  { name: 'status', dataType: 'text' }
]

const SQL = 'SELECT id, status FROM jobs'

const editContext: EditContext = {
  schema: 'public',
  table: 'jobs',
  primaryKeyColumns: ['id'],
  columns: [
    { name: 'id', dataType: 'integer', isNullable: false, isPrimaryKey: true, ordinalPosition: 1 },
    { name: 'status', dataType: 'text', isNullable: true, isPrimaryKey: false, ordinalPosition: 2 }
  ]
}

type Row = Record<string, unknown>

/**
 * Runner that serves one canned result per tick, holding the last one once the
 * script runs out. `error` entries stand in for a failed poll.
 */
function scriptedRunner(script: Array<Row[] | { error: string }>) {
  let call = 0
  return {
    runQuery: async (): Promise<WatchRunResult> => {
      const step = script[Math.min(call, script.length - 1)]
      call++
      if (!Array.isArray(step)) {
        return { rows: [], fields: [], durationMs: 1, error: step.error }
      }
      return { rows: step, fields: FIELDS, durationMs: 3, error: null }
    },
    getKeyColumns: () => ['id']
  }
}

function seedGrid(tabId: string, rows: Row[]): void {
  useTabStore.getState().updateTabResult(
    tabId,
    {
      columns: FIELDS,
      rows,
      rowCount: rows.length,
      durationMs: 1
    },
    null
  )
}

function gridRows(tabId: string): Row[] {
  const tab = useTabStore.getState().getTab(tabId)
  const result = tab && 'result' in tab ? tab.result : null
  return (result?.rows ?? []) as Row[]
}

function currentPage(tabId: string): number | undefined {
  const tab = useTabStore.getState().getTab(tabId)
  return tab && 'currentPage' in tab ? tab.currentPage : undefined
}

async function waitForTick(tabId: string, tick: number): Promise<void> {
  await vi.waitFor(() => {
    const landed = useWatchStore.getState().getState(tabId)?.snapshots[0]?.tick
    if (landed !== tick) throw new Error(`tick ${tick} has not landed (saw ${landed})`)
  })
}

describe('watch scheduler refreshes the grid it decorates', () => {
  let tabId = ''

  beforeEach(() => {
    useTabStore.setState({ tabs: [], activeTabId: null })
    useEditStore.setState({ tabEdits: new Map() })
    useWatchStore.setState({ states: {} })
    tabId = useTabStore.getState().createQueryTab(null, SQL)
  })

  afterEach(() => {
    watchScheduler.unregister(tabId)
    useWatchStore.getState().stop(tabId)
  })

  /** Start a watch with a cadence long enough that only explicit ticks fire. */
  async function startWatch(script: Array<Row[] | { error: string }>): Promise<void> {
    useWatchStore.getState().start(tabId, { cadenceMs: 60000 })
    watchScheduler.register(tabId, scriptedRunner(script))
    await waitForTick(tabId, 1)
  }

  it('writes the rows from each tick into the tab so the diff highlights new values', async () => {
    seedGrid(tabId, [{ id: 1, status: 'queued' }])
    await startWatch([[{ id: 1, status: 'queued' }], [{ id: 1, status: 'running' }]])

    watchScheduler.triggerNow(tabId)
    await waitForTick(tabId, 2)

    // The grid renders tab.result — it has to carry the new value, otherwise the
    // overlay paints "changed" over text that still reads `queued`.
    expect(gridRows(tabId)).toEqual([{ id: 1, status: 'running' }])
    const diff = useWatchStore.getState().getState(tabId)?.diff
    expect(diff?.cells.get(cellKey('1', 'status'))?.kind).toBe('changed')
  })

  it('keeps the tab error clear and mirrors rows into a single-statement multiResult', async () => {
    useTabStore.getState().updateTabMultiResult(
      tabId,
      {
        statements: [
          {
            statementIndex: 0,
            isDataReturning: true,
            statement: SQL,
            fields: FIELDS,
            rows: [{ id: 1, status: 'queued' }],
            rowCount: 1,
            durationMs: 1
          }
        ],
        totalDurationMs: 1,
        statementCount: 1
      },
      null
    )
    // A previous failure left an error banner over the grid; a good tick has to
    // clear it, not leave the panel showing an error next to fresh rows.
    useTabStore.getState().updateTabResult(tabId, null, 'connection terminated')
    await startWatch([[{ id: 1, status: 'running' }]])

    const tab = useTabStore.getState().getTab(tabId)
    const executable = tab && 'multiResult' in tab ? tab : null
    expect(executable?.multiResult?.statements[0].rows).toEqual([{ id: 1, status: 'running' }])
    expect(executable?.error).toBeNull()
  })

  it('leaves the current page alone so a watched, paged result does not jump', async () => {
    seedGrid(tabId, [{ id: 1, status: 'queued' }])
    useTabStore.getState().setTabPage(tabId, 3)
    await startWatch([[{ id: 1, status: 'running' }]])

    expect(currentPage(tabId)).toBe(3)
  })

  it('holds the grid still while inline edits are pending, but still records the snapshot', async () => {
    seedGrid(tabId, [{ id: 1, status: 'queued' }])
    await startWatch([[{ id: 1, status: 'queued' }], [{ id: 1, status: 'running' }]])

    const edit = useEditStore.getState()
    edit.enterEditMode(tabId, editContext)
    edit.updateCellValue(tabId, { id: 1, status: 'queued' }, 'status', 'cancelled')

    watchScheduler.triggerNow(tabId)
    await waitForTick(tabId, 2)

    // The user's edit survives, the rows they edited stay on screen, and the
    // overlay is not told about a change it would paint over stale text.
    expect(useEditStore.getState().hasPendingChanges(tabId)).toBe(true)
    expect(gridRows(tabId)).toEqual([{ id: 1, status: 'queued' }])
    expect(useWatchStore.getState().getState(tabId)?.diff?.cells.size).toBe(0)
    // Nothing is silently dropped from the watch record itself.
    expect(useWatchStore.getState().getState(tabId)?.snapshots[0]?.rows).toEqual([
      { id: 1, status: 'running' }
    ])
  })

  it('diffs against the rows on screen, so a skipped refresh still highlights later', async () => {
    seedGrid(tabId, [{ id: 1, status: 'queued' }])
    await startWatch([
      [{ id: 1, status: 'queued' }],
      [{ id: 1, status: 'running' }],
      [{ id: 1, status: 'done' }]
    ])

    const edit = useEditStore.getState()
    edit.enterEditMode(tabId, editContext)
    edit.updateCellValue(tabId, { id: 1, status: 'queued' }, 'status', 'cancelled')
    watchScheduler.triggerNow(tabId)
    await waitForTick(tabId, 2)

    // Commit/discard, then let the next tick through: the highlight has to cover
    // the whole gap between what was displayed and what is displayed now.
    useEditStore.getState().clearPendingChanges(tabId)
    watchScheduler.triggerNow(tabId)
    await waitForTick(tabId, 3)

    expect(gridRows(tabId)).toEqual([{ id: 1, status: 'done' }])
    expect(
      useWatchStore.getState().getState(tabId)?.diff?.cells.get(cellKey('1', 'status'))
        ?.previousValue
    ).toBe('queued')
  })

  it('re-reads the on-screen rows each tick, so a manual re-run cannot desync the baseline', async () => {
    // The sequence a declined refresh most often leads to: the commit that
    // releases the hold triggers a manual re-run (query-results wires
    // onChangesCommitted to handleRunQuery), which writes rows the scheduler
    // never produced. Anything cached inside the scheduler is stale from here on.
    seedGrid(tabId, [{ id: 1, status: 'queued' }])
    await startWatch([
      [{ id: 1, status: 'queued' }],
      [{ id: 1, status: 'queued' }],
      [
        { id: 1, status: 'queued' },
        { id: 2, status: 'queued' }
      ]
    ])

    const edit = useEditStore.getState()
    edit.enterEditMode(tabId, editContext)
    edit.updateCellValue(tabId, { id: 1, status: 'queued' }, 'status', 'cancelled')
    watchScheduler.triggerNow(tabId)
    await waitForTick(tabId, 2)

    // The commit lands and the manual re-run puts rows on screen that no tick
    // produced: row 1 now reads `cancelled`, and row 2 has appeared.
    seedGrid(tabId, [
      { id: 1, status: 'cancelled' },
      { id: 2, status: 'queued' }
    ])

    watchScheduler.triggerNow(tabId)
    await waitForTick(tabId, 3)

    const diff = useWatchStore.getState().getState(tabId)?.diff
    // cancelled → queued is a real change the user watches happen, so it must be
    // highlighted even though no tick ever reported `cancelled`.
    expect(diff?.cells.get(cellKey('1', 'status'))?.previousValue).toBe('cancelled')
    // Row 2 was already on screen, so it is not new — no green "added" band.
    expect(diff?.addedRowKeys.size).toBe(0)
    expect(diff?.removedRowKeys.size).toBe(0)
  })

  it('holds the grid still while a cell editor is open', async () => {
    seedGrid(tabId, [{ id: 1, status: 'queued' }])
    await startWatch([[{ id: 1, status: 'queued' }], [{ id: 1, status: 'running' }]])

    useEditStore.getState().enterEditMode(tabId, editContext)
    useEditStore.getState().startCellEdit(tabId, 0, 'status')

    watchScheduler.triggerNow(tabId)
    await waitForTick(tabId, 2)

    expect(gridRows(tabId)).toEqual([{ id: 1, status: 'queued' }])
  })

  it('keeps the last good rows on screen when a tick errors, and reports no row churn', async () => {
    seedGrid(tabId, [{ id: 1, status: 'queued' }])
    await startWatch([[{ id: 1, status: 'running' }], { error: 'connection terminated' }])

    watchScheduler.triggerNow(tabId)
    await waitForTick(tabId, 2)

    const state = useWatchStore.getState().getState(tabId)
    expect(state?.snapshots[0]?.error).toBe('connection terminated')
    expect(gridRows(tabId)).toEqual([{ id: 1, status: 'running' }])
    // A failed poll carries no rows. Diffing its empty result against the last
    // good one would report every row as removed, inflating the totals and
    // firing rows-removed alerts on nothing but an outage.
    expect(state?.totals.rowsRemovedCumulative).toBe(0)
    expect(state?.diff?.removedRowKeys.size).toBe(0)
  })
})
