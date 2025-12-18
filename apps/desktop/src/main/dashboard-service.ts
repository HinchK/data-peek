import { v4 as uuid } from 'uuid'
import { CronExpressionParser } from 'cron-parser'
import cron, { ScheduledTask } from 'node-cron'
import { BrowserWindow } from 'electron'
import type {
  Dashboard,
  Widget,
  WidgetRunResult,
  CreateDashboardInput,
  UpdateDashboardInput,
  CreateWidgetInput,
  UpdateWidgetInput,
  ConnectionConfig,
  SavedQuery,
  WidgetLayout,
  SchedulePreset
} from '@shared/index'
import { SCHEDULE_PRESETS } from '@shared/index'
import { DpStorage } from './storage'
import { getAdapter } from './db-adapter'
import { createLogger } from './lib/logger'

const log = createLogger('dashboard')

const activeRefreshJobs = new Map<string, ScheduledTask>()

let dashboardsStore: DpStorage<{ dashboards: Dashboard[] }>
let connectionsStore: DpStorage<{ connections: ConnectionConfig[] }>
let savedQueriesStore: DpStorage<{ savedQueries: SavedQuery[] }>

/**
 * Initialize the dashboard service and storage
 */
export async function initDashboardService(
  connStore: DpStorage<{ connections: ConnectionConfig[] }>,
  queriesStore: DpStorage<{ savedQueries: SavedQuery[] }>
): Promise<void> {
  connectionsStore = connStore
  savedQueriesStore = queriesStore

  dashboardsStore = await DpStorage.create<{ dashboards: Dashboard[] }>({
    name: 'data-peek-dashboards',
    defaults: { dashboards: [] }
  })

  log.debug('Dashboard service initialized')
}

/**
 * List all dashboards
 */
export function listDashboards(): Dashboard[] {
  return dashboardsStore.get('dashboards', [])
}

/**
 * Get a dashboard by ID
 */
export function getDashboard(id: string): Dashboard | undefined {
  return dashboardsStore.get('dashboards', []).find((d) => d.id === id)
}

/**
 * Create a new dashboard
 */
export function createDashboard(input: CreateDashboardInput): Dashboard {
  const now = Date.now()
  const dashboard: Dashboard = {
    ...input,
    id: uuid(),
    widgets: (input.widgets || []).map((w) => ({
      ...w,
      id: w.id || uuid(),
      createdAt: w.createdAt || now,
      updatedAt: w.updatedAt || now
    })),
    tags: input.tags || [],
    layoutCols: input.layoutCols || 12,
    createdAt: now,
    updatedAt: now,
    version: 1
  }

  const dashboards = dashboardsStore.get('dashboards', [])
  dashboards.push(dashboard)
  dashboardsStore.set('dashboards', dashboards)

  log.debug('Created dashboard:', dashboard.name)
  return dashboard
}

/**
 * Update a dashboard
 */
export function updateDashboard(id: string, updates: UpdateDashboardInput): Dashboard | null {
  const dashboards = dashboardsStore.get('dashboards', [])
  const index = dashboards.findIndex((d) => d.id === id)

  if (index === -1) {
    return null
  }

  dashboards[index] = {
    ...dashboards[index],
    ...updates,
    updatedAt: Date.now(),
    version: dashboards[index].version + 1
  }

  dashboardsStore.set('dashboards', dashboards)
  log.debug('Updated dashboard:', dashboards[index].name)
  return dashboards[index]
}

/**
 * Delete a dashboard
 */
export function deleteDashboard(id: string): boolean {
  const dashboards = dashboardsStore.get('dashboards', [])
  const filtered = dashboards.filter((d) => d.id !== id)

  if (filtered.length === dashboards.length) {
    return false
  }

  dashboardsStore.set('dashboards', filtered)
  log.debug('Deleted dashboard:', id)
  return true
}

/**
 * Duplicate a dashboard
 */
export function duplicateDashboard(id: string): Dashboard | null {
  const dashboard = getDashboard(id)
  if (!dashboard) {
    return null
  }

  const now = Date.now()
  const newDashboard: Dashboard = {
    ...dashboard,
    id: uuid(),
    name: `${dashboard.name} (Copy)`,
    widgets: dashboard.widgets.map((w) => ({
      ...w,
      id: uuid(),
      createdAt: now,
      updatedAt: now
    })),
    createdAt: now,
    updatedAt: now,
    version: 1,
    syncId: undefined
  }

  const dashboards = dashboardsStore.get('dashboards', [])
  dashboards.push(newDashboard)
  dashboardsStore.set('dashboards', dashboards)

  log.debug('Duplicated dashboard:', dashboard.name, '->', newDashboard.name)
  return newDashboard
}

/**
 * Add a widget to a dashboard
 */
export function addWidget(dashboardId: string, input: CreateWidgetInput): Widget | null {
  const dashboards = dashboardsStore.get('dashboards', [])
  const index = dashboards.findIndex((d) => d.id === dashboardId)

  if (index === -1) {
    return null
  }

  const now = Date.now()
  const widget: Widget = {
    ...input,
    id: uuid(),
    createdAt: now,
    updatedAt: now
  }

  dashboards[index].widgets.push(widget)
  dashboards[index].updatedAt = now
  dashboards[index].version += 1

  dashboardsStore.set('dashboards', dashboards)
  log.debug('Added widget to dashboard:', widget.name)
  return widget
}

/**
 * Update a widget in a dashboard
 */
export function updateWidget(
  dashboardId: string,
  widgetId: string,
  updates: UpdateWidgetInput
): Widget | null {
  const dashboards = dashboardsStore.get('dashboards', [])
  const dashboardIndex = dashboards.findIndex((d) => d.id === dashboardId)

  if (dashboardIndex === -1) {
    return null
  }

  const widgetIndex = dashboards[dashboardIndex].widgets.findIndex((w) => w.id === widgetId)

  if (widgetIndex === -1) {
    return null
  }

  const now = Date.now()
  dashboards[dashboardIndex].widgets[widgetIndex] = {
    ...dashboards[dashboardIndex].widgets[widgetIndex],
    ...updates,
    updatedAt: now
  }
  dashboards[dashboardIndex].updatedAt = now
  dashboards[dashboardIndex].version += 1

  dashboardsStore.set('dashboards', dashboards)
  log.debug('Updated widget:', dashboards[dashboardIndex].widgets[widgetIndex].name)
  return dashboards[dashboardIndex].widgets[widgetIndex]
}

/**
 * Delete a widget from a dashboard
 */
export function deleteWidget(dashboardId: string, widgetId: string): boolean {
  const dashboards = dashboardsStore.get('dashboards', [])
  const dashboardIndex = dashboards.findIndex((d) => d.id === dashboardId)

  if (dashboardIndex === -1) {
    return false
  }

  const widgetCount = dashboards[dashboardIndex].widgets.length
  dashboards[dashboardIndex].widgets = dashboards[dashboardIndex].widgets.filter(
    (w) => w.id !== widgetId
  )

  if (dashboards[dashboardIndex].widgets.length === widgetCount) {
    return false
  }

  dashboards[dashboardIndex].updatedAt = Date.now()
  dashboards[dashboardIndex].version += 1

  dashboardsStore.set('dashboards', dashboards)
  log.debug('Deleted widget:', widgetId)
  return true
}

/**
 * Update widget layouts (batch update for drag-drop)
 */
export function updateWidgetLayouts(
  dashboardId: string,
  layouts: Record<string, WidgetLayout>
): Dashboard | null {
  const dashboards = dashboardsStore.get('dashboards', [])
  const index = dashboards.findIndex((d) => d.id === dashboardId)

  if (index === -1) {
    return null
  }

  const now = Date.now()
  for (const widget of dashboards[index].widgets) {
    if (layouts[widget.id]) {
      widget.layout = layouts[widget.id]
      widget.updatedAt = now
    }
  }

  dashboards[index].updatedAt = now
  dashboards[index].version += 1

  dashboardsStore.set('dashboards', dashboards)
  log.debug('Updated widget layouts for dashboard:', dashboards[index].name)
  return dashboards[index]
}

/**
 * Get the SQL query for a widget (resolves saved query references)
 */
function getWidgetSql(widget: Widget): { sql: string; connectionId: string } | null {
  if (widget.dataSource.type === 'inline') {
    if (!widget.dataSource.sql) {
      return null
    }
    return {
      sql: widget.dataSource.sql,
      connectionId: widget.dataSource.connectionId
    }
  }

  if (widget.dataSource.type === 'saved-query') {
    if (!widget.dataSource.savedQueryId) {
      return null
    }

    const savedQueries = savedQueriesStore.get('savedQueries', [])
    const savedQuery = savedQueries.find((q) => q.id === widget.dataSource.savedQueryId)

    if (!savedQuery) {
      return null
    }

    return {
      sql: savedQuery.query,
      connectionId: widget.dataSource.connectionId
    }
  }

  return null
}

/**
 * Execute a widget's query and return results
 */
export async function executeWidget(widget: Widget): Promise<WidgetRunResult> {
  const startTime = Date.now()
  const result: WidgetRunResult = {
    widgetId: widget.id,
    success: false,
    durationMs: 0,
    rowCount: 0,
    executedAt: startTime
  }

  try {
    const sqlInfo = getWidgetSql(widget)
    if (!sqlInfo) {
      result.error = 'No SQL query configured for widget'
      result.durationMs = Date.now() - startTime
      return result
    }

    const connections = connectionsStore.get('connections', [])
    const connection = connections.find((c) => c.id === sqlInfo.connectionId)

    if (!connection) {
      result.error = `Connection not found: ${sqlInfo.connectionId}`
      result.durationMs = Date.now() - startTime
      return result
    }

    const adapter = getAdapter(connection)
    const queryResult = await adapter.queryMultiple(connection, sqlInfo.sql, {
      executionId: `widget-${widget.id}-${startTime}`
    })

    const dataResult = queryResult.results.find((r) => r.isDataReturning) || queryResult.results[0]

    result.success = true
    result.data = dataResult?.rows || []
    result.fields = dataResult?.fields
    result.rowCount = dataResult?.rowCount || 0
    result.durationMs = Date.now() - startTime

    log.debug(`Widget "${widget.name}" executed in ${result.durationMs}ms`)
  } catch (error) {
    result.error = error instanceof Error ? error.message : String(error)
    result.durationMs = Date.now() - startTime
    log.error(`Widget "${widget.name}" failed:`, result.error)
  }

  return result
}

/**
 * Execute all widgets in a dashboard
 */
export async function executeAllWidgets(dashboardId: string): Promise<WidgetRunResult[]> {
  const dashboard = getDashboard(dashboardId)
  if (!dashboard) {
    return []
  }

  const results = await Promise.all(dashboard.widgets.map((widget) => executeWidget(widget)))

  return results
}

/**
 * Get dashboards by tag
 */
export function getDashboardsByTag(tag: string): Dashboard[] {
  return dashboardsStore.get('dashboards', []).filter((d) => d.tags.includes(tag))
}

/**
 * Get all unique tags across dashboards
 */
export function getAllDashboardTags(): string[] {
  const dashboards = dashboardsStore.get('dashboards', [])
  const tags = new Set<string>()

  for (const dashboard of dashboards) {
    for (const tag of dashboard.tags) {
      tags.add(tag)
    }
  }

  return Array.from(tags).sort()
}

/**
 * Get the cron expression for a refresh schedule
 */
function getCronExpression(schedule: NonNullable<Dashboard['refreshSchedule']>): string {
  if (schedule.preset === 'custom') {
    return schedule.cronExpression || '0 * * * *'
  }

  const preset = SCHEDULE_PRESETS[schedule.preset as Exclude<SchedulePreset, 'custom'>]
  return preset?.cron || '0 * * * *'
}

/**
 * Calculate the next refresh time for a dashboard
 */
export function getNextRefreshTime(
  schedule: NonNullable<Dashboard['refreshSchedule']>
): number | null {
  if (!schedule.enabled) return null

  const cronExpression = getCronExpression(schedule)

  try {
    const interval = CronExpressionParser.parse(cronExpression, {
      tz: schedule.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone
    })
    return interval.next().getTime()
  } catch (error) {
    log.error('Failed to parse cron expression:', cronExpression, error)
    return null
  }
}

/**
 * Schedule auto-refresh for a dashboard
 */
export function scheduleDashboardRefresh(dashboardId: string): void {
  const existingJob = activeRefreshJobs.get(dashboardId)
  if (existingJob) {
    existingJob.stop()
    activeRefreshJobs.delete(dashboardId)
  }

  const dashboard = getDashboard(dashboardId)
  if (!dashboard?.refreshSchedule?.enabled) {
    return
  }

  const cronExpression = getCronExpression(dashboard.refreshSchedule)
  const timezone =
    dashboard.refreshSchedule.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone

  if (!cron.validate(cronExpression)) {
    log.error(`Invalid cron expression for dashboard "${dashboard.name}":`, cronExpression)
    return
  }

  log.debug(`Scheduling refresh for "${dashboard.name}" with cron: ${cronExpression} (${timezone})`)

  const job = cron.schedule(
    cronExpression,
    async () => {
      const currentDashboard = getDashboard(dashboardId)
      log.debug(`Auto-refreshing dashboard: ${currentDashboard?.name || dashboardId}`)

      try {
        const results = await executeAllWidgets(dashboardId)

        for (const window of BrowserWindow.getAllWindows()) {
          window.webContents.send('dashboard:refresh-complete', {
            dashboardId,
            results
          })
        }
      } catch (error) {
        log.error(`Failed to refresh dashboard ${dashboardId}:`, error)
      }
    },
    {
      timezone,
      scheduled: true
    }
  )

  activeRefreshJobs.set(dashboardId, job)
}

/**
 * Stop auto-refresh for a dashboard
 */
export function stopDashboardRefresh(dashboardId: string): void {
  const job = activeRefreshJobs.get(dashboardId)
  if (job) {
    job.stop()
    activeRefreshJobs.delete(dashboardId)
    log.debug('Stopped refresh schedule for dashboard:', dashboardId)
  }
}

/**
 * Update the refresh schedule for a dashboard
 */
export function updateDashboardRefreshSchedule(
  dashboardId: string,
  schedule: Dashboard['refreshSchedule']
): Dashboard | null {
  const updated = updateDashboard(dashboardId, { refreshSchedule: schedule })
  if (!updated) {
    return null
  }

  if (schedule?.enabled) {
    scheduleDashboardRefresh(dashboardId)
  } else {
    stopDashboardRefresh(dashboardId)
  }

  return updated
}

/**
 * Start all active refresh schedules (called on app startup)
 */
export function startAllRefreshSchedules(): void {
  const dashboards = dashboardsStore.get('dashboards', [])

  for (const dashboard of dashboards) {
    if (dashboard.refreshSchedule?.enabled) {
      scheduleDashboardRefresh(dashboard.id)
    }
  }

  log.debug(
    'Started refresh schedules for',
    dashboards.filter((d) => d.refreshSchedule?.enabled).length,
    'dashboards'
  )
}

/**
 * Stop all refresh schedules (called on app shutdown)
 */
export function stopAllRefreshSchedules(): void {
  for (const [id, job] of activeRefreshJobs) {
    job.stop()
    log.debug('Stopped refresh schedule:', id)
  }
  activeRefreshJobs.clear()
}

/**
 * Validate a cron expression
 */
export function validateCronExpression(expression: string): { valid: boolean; error?: string } {
  try {
    CronExpressionParser.parse(expression)
    return { valid: true }
  } catch (error) {
    return {
      valid: false,
      error: error instanceof Error ? error.message : 'Invalid cron expression'
    }
  }
}

/**
 * Get the next N scheduled refresh times for a cron expression
 */
export function getNextRefreshTimes(
  expression: string,
  count: number = 5,
  timezone?: string
): number[] {
  try {
    const interval = CronExpressionParser.parse(expression, {
      tz: timezone || Intl.DateTimeFormat().resolvedOptions().timeZone
    })

    const times: number[] = []
    for (let i = 0; i < count; i++) {
      times.push(interval.next().getTime())
    }

    return times
  } catch {
    return []
  }
}
