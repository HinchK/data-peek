import { Notification } from 'electron'
import { CronExpressionParser } from 'cron-parser'
import cron, { ScheduledTask } from 'node-cron'
import { v4 as uuid } from 'uuid'
import type {
  ScheduledQuery,
  ScheduledQueryRun,
  CreateScheduledQueryInput,
  UpdateScheduledQueryInput,
  ConnectionConfig
} from '@shared/index'
import { SCHEDULE_PRESETS } from '@shared/index'
import { DpStorage } from './storage'
import { getAdapter } from './db-adapter'
import { createLogger } from './lib/logger'

const log = createLogger('scheduler')

// Maximum preview rows to store in run history
const MAX_PREVIEW_ROWS = 5

// Store instances
let scheduledQueriesStore: DpStorage<{ scheduledQueries: ScheduledQuery[] }>
let scheduledQueryRunsStore: DpStorage<{ runs: ScheduledQueryRun[] }>
let connectionsStore: DpStorage<{ connections: ConnectionConfig[] }>

// Active cron jobs for scheduled queries
const activeJobs = new Map<string, ScheduledTask>()

// Mutex for atomic run storage operations
let saveRunLock: Promise<void> = Promise.resolve()

/**
 * Initialize the scheduler service and storage
 */
export async function initSchedulerService(
  connStore: DpStorage<{ connections: ConnectionConfig[] }>
): Promise<void> {
  connectionsStore = connStore

  scheduledQueriesStore = await DpStorage.create<{ scheduledQueries: ScheduledQuery[] }>({
    name: 'data-peek-scheduled-queries',
    defaults: { scheduledQueries: [] }
  })

  scheduledQueryRunsStore = await DpStorage.create<{ runs: ScheduledQueryRun[] }>({
    name: 'data-peek-scheduled-query-runs',
    defaults: { runs: [] }
  })

  // Start all active schedules
  const queries = scheduledQueriesStore.get('scheduledQueries', [])
  for (const query of queries) {
    if (query.status === 'active') {
      scheduleCronJob(query)
    }
  }

  log.debug('Scheduler service initialized with', queries.length, 'scheduled queries')
}

/**
 * Get the cron expression for a schedule config
 */
function getCronExpression(schedule: ScheduledQuery['schedule']): string {
  if (schedule.preset === 'custom') {
    return schedule.cronExpression || '0 * * * *' // Default to hourly if custom but no expression
  }

  const preset = SCHEDULE_PRESETS[schedule.preset as keyof typeof SCHEDULE_PRESETS]
  return preset?.cron || '0 * * * *'
}

/**
 * Calculate the next run time for a scheduled query
 */
function getNextRunTime(schedule: ScheduledQuery['schedule']): number {
  const cronExpression = getCronExpression(schedule)

  try {
    const interval = CronExpressionParser.parse(cronExpression, {
      tz: schedule.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone
    })
    return interval.next().getTime()
  } catch (error) {
    log.error('Failed to parse cron expression:', cronExpression, error)
    // Default to 1 hour from now if parsing fails
    return Date.now() + 60 * 60 * 1000
  }
}

/**
 * Schedule a cron job for a query
 */
function scheduleCronJob(query: ScheduledQuery): void {
  // Stop any existing job
  const existingJob = activeJobs.get(query.id)
  if (existingJob) {
    existingJob.stop()
    activeJobs.delete(query.id)
  }

  // Don't schedule if not active
  if (query.status !== 'active') {
    return
  }

  const cronExpression = getCronExpression(query.schedule)
  const timezone = query.schedule.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone

  // Validate cron expression with node-cron
  if (!cron.validate(cronExpression)) {
    log.error(`Invalid cron expression for "${query.name}":`, cronExpression)
    updateScheduledQueryInternal(query.id, {
      status: 'error',
      lastError: `Invalid cron expression: ${cronExpression}`
    })
    return
  }

  log.debug(`Scheduling "${query.name}" with cron: ${cronExpression} (${timezone})`)

  // Calculate and store next run time
  const nextRunAt = getNextRunTime(query.schedule)
  updateScheduledQueryInternal(query.id, { nextRunAt })

  // Create the cron job
  const job = cron.schedule(
    cronExpression,
    async () => {
      await executeScheduledQuery(query.id)
    },
    {
      timezone,
      scheduled: true
    }
  )

  activeJobs.set(query.id, job)
}

/**
 * Execute a scheduled query
 */
async function executeScheduledQuery(queryId: string): Promise<void> {
  const queries = scheduledQueriesStore.get('scheduledQueries', [])
  const query = queries.find((q) => q.id === queryId)

  if (!query) {
    log.error('Scheduled query not found:', queryId)
    return
  }

  if (query.status !== 'active') {
    log.debug('Skipping inactive scheduled query:', query.name)
    return
  }

  log.debug('Executing scheduled query:', query.name)

  const run: ScheduledQueryRun = {
    id: uuid(),
    scheduledQueryId: queryId,
    startedAt: Date.now(),
    success: false
  }

  try {
    // Get the connection
    const connections = connectionsStore.get('connections', [])
    const connection = connections.find((c) => c.id === query.connectionId)

    if (!connection) {
      throw new Error(`Connection not found: ${query.connectionId}`)
    }

    // Execute the query
    const adapter = getAdapter(connection)
    const result = await adapter.queryMultiple(connection, query.query, {
      executionId: `scheduled-${queryId}-${run.id}`
    })

    run.completedAt = Date.now()
    run.durationMs = run.completedAt - run.startedAt
    run.success = true

    // Get row count from the results
    const dataResult = result.results.find((r) => r.isDataReturning) || result.results[0]
    run.rowCount = dataResult?.rowCount ?? 0

    // Store a preview of the results (first few rows)
    if (dataResult?.rows && dataResult.rows.length > 0) {
      run.resultPreview = dataResult.rows.slice(0, MAX_PREVIEW_ROWS)
    }

    log.debug(`Scheduled query "${query.name}" completed in ${run.durationMs}ms`)

    // Update query with last run time
    updateScheduledQueryInternal(query.id, {
      lastRunAt: run.completedAt,
      lastError: undefined,
      status: 'active'
    })

    // Show notification if enabled
    if (query.notifyOnComplete) {
      showNotification(
        `Scheduled Query Completed`,
        `"${query.name}" finished successfully (${run.rowCount} rows in ${run.durationMs}ms)`
      )
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error)
    run.completedAt = Date.now()
    run.durationMs = run.completedAt - run.startedAt
    run.success = false
    run.error = errorMessage

    log.error(`Scheduled query "${query.name}" failed:`, errorMessage)

    // Update query with error status
    updateScheduledQueryInternal(query.id, {
      lastRunAt: run.completedAt,
      lastError: errorMessage,
      status: 'error'
    })

    // Show notification if enabled
    if (query.notifyOnError) {
      showNotification(`Scheduled Query Failed`, `"${query.name}" failed: ${errorMessage}`)
    }
  }

  // Store the run
  await saveRun(run)

  // Update nextRunAt for UI display (cron job continues running automatically)
  const updatedQuery = scheduledQueriesStore
    .get('scheduledQueries', [])
    .find((q) => q.id === queryId)
  if (updatedQuery && updatedQuery.status === 'active') {
    const nextRunAt = getNextRunTime(updatedQuery.schedule)
    updateScheduledQueryInternal(updatedQuery.id, { nextRunAt })
  }
}

/**
 * Save a run to history, respecting maxHistoryRuns
 * Uses a mutex to prevent concurrent read-modify-write race conditions
 */
async function saveRun(run: ScheduledQueryRun): Promise<void> {
  const currentLock = saveRunLock
  let releaseLock: () => void

  saveRunLock = new Promise((resolve) => {
    releaseLock = resolve
  })

  try {
    await currentLock

    const runs = scheduledQueryRunsStore.get('runs', [])

    const queries = scheduledQueriesStore.get('scheduledQueries', [])
    const query = queries.find((q) => q.id === run.scheduledQueryId)
    const maxRuns = query?.maxHistoryRuns || 100

    runs.push(run)

    const queryRuns = runs.filter((r) => r.scheduledQueryId === run.scheduledQueryId)
    const otherRuns = runs.filter((r) => r.scheduledQueryId !== run.scheduledQueryId)

    queryRuns.sort((a, b) => b.startedAt - a.startedAt)
    const trimmedQueryRuns = queryRuns.slice(0, maxRuns)

    scheduledQueryRunsStore.set('runs', [...otherRuns, ...trimmedQueryRuns])
  } finally {
    releaseLock!()
  }
}

/**
 * Show a desktop notification
 */
function showNotification(title: string, body: string): void {
  if (Notification.isSupported()) {
    const notification = new Notification({
      title,
      body,
      silent: false
    })
    notification.show()
  }
}

/**
 * Internal update without triggering reschedule
 */
function updateScheduledQueryInternal(
  id: string,
  updates: Partial<ScheduledQuery>
): ScheduledQuery | null {
  const queries = scheduledQueriesStore.get('scheduledQueries', [])
  const index = queries.findIndex((q) => q.id === id)

  if (index === -1) {
    return null
  }

  queries[index] = {
    ...queries[index],
    ...updates,
    updatedAt: Date.now()
  }

  scheduledQueriesStore.set('scheduledQueries', queries)
  return queries[index]
}

/**
 * List all scheduled queries
 */
export function listScheduledQueries(): ScheduledQuery[] {
  return scheduledQueriesStore.get('scheduledQueries', [])
}

/**
 * Get a scheduled query by ID
 */
export function getScheduledQuery(id: string): ScheduledQuery | undefined {
  return scheduledQueriesStore.get('scheduledQueries', []).find((q) => q.id === id)
}

/**
 * Create a new scheduled query
 */
export function createScheduledQuery(input: CreateScheduledQueryInput): ScheduledQuery {
  const now = Date.now()
  const query: ScheduledQuery = {
    ...input,
    id: uuid(),
    status: 'active',
    nextRunAt: getNextRunTime(input.schedule),
    createdAt: now,
    updatedAt: now
  }

  const queries = scheduledQueriesStore.get('scheduledQueries', [])
  queries.push(query)
  scheduledQueriesStore.set('scheduledQueries', queries)

  // Schedule the first run
  scheduleCronJob(query)

  log.debug('Created scheduled query:', query.name)
  return query
}

/**
 * Update a scheduled query
 */
export function updateScheduledQuery(
  id: string,
  updates: UpdateScheduledQueryInput
): ScheduledQuery | null {
  const queries = scheduledQueriesStore.get('scheduledQueries', [])
  const index = queries.findIndex((q) => q.id === id)

  if (index === -1) {
    return null
  }

  const oldQuery = queries[index]
  queries[index] = {
    ...oldQuery,
    ...updates,
    updatedAt: Date.now()
  }

  // Recalculate nextRunAt if schedule changed
  if (updates.schedule) {
    queries[index].nextRunAt = getNextRunTime(queries[index].schedule)
  }

  scheduledQueriesStore.set('scheduledQueries', queries)

  // Reschedule if status or schedule changed
  if (updates.status !== undefined || updates.schedule !== undefined) {
    scheduleCronJob(queries[index])
  }

  log.debug('Updated scheduled query:', queries[index].name)
  return queries[index]
}

/**
 * Delete a scheduled query
 */
export function deleteScheduledQuery(id: string): boolean {
  // Stop any active cron job
  const job = activeJobs.get(id)
  if (job) {
    job.stop()
    activeJobs.delete(id)
  }

  const queries = scheduledQueriesStore.get('scheduledQueries', [])
  const filtered = queries.filter((q) => q.id !== id)

  if (filtered.length === queries.length) {
    return false
  }

  scheduledQueriesStore.set('scheduledQueries', filtered)

  // Also delete run history for this query
  const runs = scheduledQueryRunsStore.get('runs', [])
  const filteredRuns = runs.filter((r) => r.scheduledQueryId !== id)
  scheduledQueryRunsStore.set('runs', filteredRuns)

  log.debug('Deleted scheduled query:', id)
  return true
}

/**
 * Pause a scheduled query
 */
export function pauseScheduledQuery(id: string): ScheduledQuery | null {
  return updateScheduledQuery(id, { status: 'paused' })
}

/**
 * Resume a scheduled query
 */
export function resumeScheduledQuery(id: string): ScheduledQuery | null {
  return updateScheduledQuery(id, { status: 'active', lastError: undefined })
}

/**
 * Run a scheduled query immediately (outside of schedule)
 */
export async function runScheduledQueryNow(id: string): Promise<ScheduledQueryRun | null> {
  const query = getScheduledQuery(id)
  if (!query) {
    return null
  }

  // Execute immediately
  await executeScheduledQuery(id)

  // Return the latest run
  const runs = scheduledQueryRunsStore.get('runs', [])
  return runs.find((r) => r.scheduledQueryId === id) || null
}

/**
 * Get run history for a scheduled query
 */
export function getScheduledQueryRuns(queryId: string, limit?: number): ScheduledQueryRun[] {
  const runs = scheduledQueryRunsStore.get('runs', [])
  const queryRuns = runs
    .filter((r) => r.scheduledQueryId === queryId)
    .sort((a, b) => b.startedAt - a.startedAt)

  return limit ? queryRuns.slice(0, limit) : queryRuns
}

/**
 * Get all recent runs across all scheduled queries
 */
export function getAllRecentRuns(limit: number = 50): ScheduledQueryRun[] {
  const runs = scheduledQueryRunsStore.get('runs', [])
  return runs.sort((a, b) => b.startedAt - a.startedAt).slice(0, limit)
}

/**
 * Clear run history for a scheduled query
 */
export function clearScheduledQueryRuns(queryId: string): void {
  const runs = scheduledQueryRunsStore.get('runs', [])
  const filtered = runs.filter((r) => r.scheduledQueryId !== queryId)
  scheduledQueryRunsStore.set('runs', filtered)
}

/**
 * Stop all scheduled queries (for app shutdown)
 */
export function stopAllSchedules(): void {
  for (const [id, job] of activeJobs) {
    job.stop()
    log.debug('Stopped schedule:', id)
  }
  activeJobs.clear()
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
 * Get the next N scheduled run times for a cron expression
 */
export function getNextRunTimes(
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
