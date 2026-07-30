import { describe, it, expect, beforeEach, vi } from 'vitest'
import { useTabStore } from '../tab-store'
import { useEditStore } from '../edit-store'
import type { EditContext } from '@data-peek/shared'

vi.stubGlobal('crypto', {
  randomUUID: () => 'test-uuid-' + Math.random().toString(36).slice(2)
})

const sampleContext: EditContext = {
  schema: 'public',
  table: 'users',
  primaryKeyColumns: ['id'],
  columns: [
    { name: 'id', dataType: 'integer', isNullable: false, isPrimaryKey: true, ordinalPosition: 1 },
    { name: 'name', dataType: 'varchar', isNullable: true, isPrimaryKey: false, ordinalPosition: 2 }
  ]
}

function currentPage(tabId: string): number | undefined {
  const tab = useTabStore.getState().getTab(tabId)
  return tab && 'currentPage' in tab ? tab.currentPage : undefined
}

describe('tab-store invalidates pending edits when results change', () => {
  beforeEach(() => {
    useTabStore.setState({ tabs: [], activeTabId: null })
    useEditStore.setState({ tabEdits: new Map() })
  })

  function setupTabWithEdits(): string {
    const tabId = useTabStore.getState().createQueryTab(null, 'SELECT * FROM users')
    const edit = useEditStore.getState()
    edit.enterEditMode(tabId, sampleContext)
    edit.updateCellValue(tabId, { id: 1, name: 'Original' }, 'name', 'Modified')
    edit.markRowForDeletion(tabId, { id: 2, name: 'Doomed' })
    edit.addNewRow(tabId, { name: 'Brand New' })
    return tabId
  }

  it('updateTabResult drops stale pending edits so they cannot commit against new rows', () => {
    const tabId = setupTabWithEdits()
    expect(useEditStore.getState().hasPendingChanges(tabId)).toBe(true)

    useTabStore.getState().updateTabResult(
      tabId,
      {
        columns: [{ name: 'id', dataType: 'integer' }],
        rows: [{ id: 99 }],
        rowCount: 1,
        durationMs: 1
      },
      null
    )

    expect(useEditStore.getState().hasPendingChanges(tabId)).toBe(false)
  })

  it('updateTabMultiResult drops stale pending edits', () => {
    const tabId = setupTabWithEdits()
    expect(useEditStore.getState().hasPendingChanges(tabId)).toBe(true)

    useTabStore.getState().updateTabMultiResult(
      tabId,
      {
        statements: [
          {
            statementIndex: 0,
            isDataReturning: true,
            statement: 'SELECT * FROM users',
            fields: [{ name: 'id', dataType: 'integer' }],
            rows: [{ id: 99 }],
            rowCount: 1,
            durationMs: 1
          }
        ],
        totalDurationMs: 1,
        statementCount: 1
      },
      null
    )

    expect(useEditStore.getState().hasPendingChanges(tabId)).toBe(false)
  })

  it('updateTabResult does NOT drop pending edits when called with a null result', () => {
    // A null result means "cancel/error blanked the panel", not "new rows arrived".
    // The user's edits are still valid against whatever was previously displayed —
    // wiping them on Stop would silently destroy in-flight work.
    const tabId = setupTabWithEdits()

    useTabStore.getState().updateTabResult(tabId, null, 'Query cancelled by user')

    expect(useEditStore.getState().hasPendingChanges(tabId)).toBe(true)
  })

  it('updateTabMultiResult does NOT drop pending edits when called with a null multiResult', () => {
    const tabId = setupTabWithEdits()

    useTabStore.getState().updateTabMultiResult(tabId, null, 'Query cancelled by user')

    expect(useEditStore.getState().hasPendingChanges(tabId)).toBe(true)
  })

  it('setActiveResultIndex drops pending edits because they were captured against the previous statement', () => {
    const tabId = setupTabWithEdits()

    useTabStore.getState().updateTabMultiResult(
      tabId,
      {
        statements: [
          {
            statementIndex: 0,
            isDataReturning: true,
            statement: 'SELECT * FROM users',
            fields: [{ name: 'id', dataType: 'integer' }],
            rows: [{ id: 1 }],
            rowCount: 1,
            durationMs: 1
          },
          {
            statementIndex: 1,
            isDataReturning: true,
            statement: 'SELECT * FROM orders',
            fields: [{ name: 'id', dataType: 'integer' }],
            rows: [{ id: 100 }],
            rowCount: 1,
            durationMs: 1
          }
        ],
        totalDurationMs: 2,
        statementCount: 2
      },
      null
    )

    // Setting the result already cleared edits; re-add some so we can test setActiveResultIndex.
    const edit = useEditStore.getState()
    edit.enterEditMode(tabId, sampleContext)
    edit.updateCellValue(tabId, { id: 1, name: 'Original' }, 'name', 'Modified')
    expect(edit.hasPendingChanges(tabId)).toBe(true)

    useTabStore.getState().setActiveResultIndex(tabId, 1)

    expect(useEditStore.getState().hasPendingChanges(tabId)).toBe(false)
  })

  it('applyWatchResult declines the refresh while edits are pending, and keeps them', () => {
    const tabId = setupTabWithEdits()
    const before = {
      columns: [{ name: 'id', dataType: 'integer' }],
      rows: [{ id: 1 }],
      rowCount: 1,
      durationMs: 1
    }
    useTabStore.getState().updateTabResult(tabId, before, null)
    const edit = useEditStore.getState()
    edit.enterEditMode(tabId, sampleContext)
    edit.updateCellValue(tabId, { id: 1, name: 'Original' }, 'name', 'Modified')

    const applied = useTabStore.getState().applyWatchResult(tabId, {
      columns: [{ name: 'id', dataType: 'integer' }],
      rows: [{ id: 2 }],
      rowCount: 1,
      durationMs: 1
    })

    // Refusing beats both alternatives: dropping the edit destroys the user's
    // work, and moving the rows under it lets the commit target a row they
    // never saw.
    expect(applied).toBe(false)
    expect(useEditStore.getState().hasPendingChanges(tabId)).toBe(true)
    const tab = useTabStore.getState().getTab(tabId)
    expect(tab && 'result' in tab ? tab.result?.rows : null).toEqual([{ id: 1 }])
  })

  it('applyWatchResult declines the refresh while a cell editor is open', () => {
    const tabId = useTabStore.getState().createQueryTab(null, 'SELECT * FROM users')
    const edit = useEditStore.getState()
    edit.enterEditMode(tabId, sampleContext)
    edit.startCellEdit(tabId, 0, 'name')

    const applied = useTabStore.getState().applyWatchResult(tabId, {
      columns: [{ name: 'id', dataType: 'integer' }],
      rows: [{ id: 2 }],
      rowCount: 1,
      durationMs: 1
    })

    expect(applied).toBe(false)
  })

  it('applyWatchResult refreshes rows without disturbing an idle edit session', () => {
    const tabId = useTabStore.getState().createQueryTab(null, 'SELECT * FROM users')
    useEditStore.getState().enterEditMode(tabId, sampleContext)

    const applied = useTabStore.getState().applyWatchResult(tabId, {
      columns: [{ name: 'id', dataType: 'integer' }],
      rows: [{ id: 2 }],
      rowCount: 1,
      durationMs: 1
    })

    expect(applied).toBe(true)
    expect(useEditStore.getState().isInEditMode(tabId)).toBe(true)
    const tab = useTabStore.getState().getTab(tabId)
    expect(tab && 'result' in tab ? tab.result?.rows : null).toEqual([{ id: 2 }])
  })

  it('applyWatchResult keeps the current page, unlike updateTabResult', () => {
    const tabId = useTabStore.getState().createQueryTab(null, 'SELECT * FROM users')
    const result = {
      columns: [{ name: 'id', dataType: 'integer' }],
      rows: [{ id: 1 }],
      rowCount: 1,
      durationMs: 1
    }
    useTabStore.getState().setTabPage(tabId, 4)

    expect(useTabStore.getState().applyWatchResult(tabId, result)).toBe(true)
    expect(currentPage(tabId)).toBe(4)

    useTabStore.getState().updateTabResult(tabId, result, null)
    expect(currentPage(tabId)).toBe(1)
  })

  it('does not affect pending edits on other tabs', () => {
    const tab1 = setupTabWithEdits()
    const tab2 = setupTabWithEdits()
    expect(useEditStore.getState().hasPendingChanges(tab1)).toBe(true)
    expect(useEditStore.getState().hasPendingChanges(tab2)).toBe(true)

    useTabStore.getState().updateTabResult(
      tab1,
      {
        columns: [{ name: 'id', dataType: 'integer' }],
        rows: [{ id: 1 }],
        rowCount: 1,
        durationMs: 1
      },
      null
    )

    expect(useEditStore.getState().hasPendingChanges(tab1)).toBe(false)
    expect(useEditStore.getState().hasPendingChanges(tab2)).toBe(true)
  })
})
