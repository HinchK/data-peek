import { app, shell, BrowserWindow, ipcMain } from 'electron'
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import { Client } from 'pg'
import icon from '../../resources/icon.png?asset'
import type {
  ConnectionConfig,
  SchemaInfo,
  TableInfo,
  ColumnInfo,
  QueryField,
  ForeignKeyInfo,
  EditBatch,
  EditResult,
  TableDefinition,
  AlterTableBatch,
  DDLResult,
  SequenceInfo,
  CustomTypeInfo,
  ColumnDefinition,
  ConstraintDefinition,
  IndexDefinition
} from '@shared/index'
import { buildQuery, validateOperation, buildPreviewSql } from './sql-builder'
import {
  buildCreateTable,
  buildAlterTable,
  buildDropTable,
  buildPreviewDDL,
  validateTableDefinition
} from './ddl-builder'
import { createMenu } from './menu'
import { setupContextMenu } from './context-menu'
import { getWindowState, trackWindowState } from './window-state'

// ============================================
// PostgreSQL OID to Type Name Mapping
// Reference: https://github.com/postgres/postgres/blob/master/src/include/catalog/pg_type.dat
// ============================================
const PG_TYPE_MAP: Record<number, string> = {
  16: 'boolean',
  17: 'bytea',
  18: 'char',
  19: 'name',
  20: 'bigint',
  21: 'smallint',
  23: 'integer',
  24: 'regproc',
  25: 'text',
  26: 'oid',
  114: 'json',
  142: 'xml',
  600: 'point',
  601: 'lseg',
  602: 'path',
  603: 'box',
  604: 'polygon',
  628: 'line',
  700: 'real',
  701: 'double precision',
  718: 'circle',
  790: 'money',
  829: 'macaddr',
  869: 'inet',
  650: 'cidr',
  1042: 'char',
  1043: 'varchar',
  1082: 'date',
  1083: 'time',
  1114: 'timestamp',
  1184: 'timestamptz',
  1186: 'interval',
  1266: 'timetz',
  1560: 'bit',
  1562: 'varbit',
  1700: 'numeric',
  2950: 'uuid',
  3802: 'jsonb',
  3904: 'int4range',
  3906: 'numrange',
  3908: 'tsrange',
  3910: 'tstzrange',
  3912: 'daterange',
  3926: 'int8range',
  // Array types (common ones)
  1000: 'boolean[]',
  1001: 'bytea[]',
  1005: 'smallint[]',
  1007: 'integer[]',
  1009: 'text[]',
  1014: 'char[]',
  1015: 'varchar[]',
  1016: 'bigint[]',
  1021: 'real[]',
  1022: 'double precision[]',
  1028: 'oid[]',
  1115: 'timestamp[]',
  1182: 'date[]',
  1183: 'time[]',
  1231: 'numeric[]',
  2951: 'uuid[]',
  3807: 'jsonb[]',
  199: 'json[]'
}

/**
 * Resolve PostgreSQL OID to human-readable type name
 */
function resolvePostgresType(dataTypeID: number): string {
  return PG_TYPE_MAP[dataTypeID] ?? `unknown(${dataTypeID})`
}

// electron-store v11 is ESM-only, use dynamic import
type StoreType = import('electron-store').default<{ connections: ConnectionConfig[] }>
let store: StoreType

async function initStore(): Promise<void> {
  const Store = (await import('electron-store')).default
  store = new Store<{ connections: ConnectionConfig[] }>({
    name: 'data-peek-connections',
    encryptionKey: 'data-peek-secure-storage-key', // Encrypts sensitive data
    defaults: {
      connections: []
    }
  })
}

// Store main window reference for macOS hide-on-close behavior
let mainWindow: BrowserWindow | null = null
let forceQuit = false

async function createWindow(): Promise<void> {
  // Get saved window state
  const windowState = await getWindowState()

  // Create the browser window.
  mainWindow = new BrowserWindow({
    x: windowState.x,
    y: windowState.y,
    width: windowState.width,
    height: windowState.height,
    minWidth: 900,
    minHeight: 600,
    show: false,
    autoHideMenuBar: false, // Show menu bar for native shortcuts
    // macOS-style window
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 16, y: 18 },
    vibrancy: 'sidebar',
    visualEffectState: 'active',
    transparent: true,
    backgroundColor: '#00000000',
    // Windows titlebar overlay
    ...(process.platform === 'win32' && {
      titleBarStyle: 'hidden',
      titleBarOverlay: {
        color: '#1e1e1e',
        symbolColor: '#ffffff',
        height: 40
      }
    }),
    ...(process.platform === 'linux' ? { icon } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false
    }
  })

  // Track window state for persistence
  trackWindowState(mainWindow)

  // Restore maximized state
  if (windowState.isMaximized) {
    mainWindow.maximize()
  }

  // Setup context menu
  setupContextMenu(mainWindow)

  mainWindow.on('ready-to-show', () => {
    mainWindow?.show()
  })

  // macOS: hide instead of close (like native apps)
  mainWindow.on('close', (e) => {
    if (process.platform === 'darwin' && !forceQuit) {
      e.preventDefault()
      mainWindow?.hide()
    }
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  // HMR for renderer base on electron-vite cli.
  // Load the remote URL for development or the local html file for production.
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
app.whenReady().then(async () => {
  // Initialize electron-store (ESM module)
  await initStore()

  // Create native application menu
  createMenu()

  // Set app user model id for windows
  electronApp.setAppUserModelId('com.datapeek')

  // Default open or close DevTools by F12 in development
  // and ignore CommandOrControl + R in production.
  // see https://github.com/alex8088/electron-toolkit/tree/master/packages/utils
  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  // IPC Handlers
  ipcMain.handle('db:connect', async (_, config) => {
    try {
      const client = new Client(config)
      await client.connect()
      await client.end()
      return { success: true }
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      return { success: false, error: errorMessage }
    }
  })

  ipcMain.handle('db:query', async (_, { config, query }) => {
    console.log('[main:db:query] Received query request')
    console.log('[main:db:query] Config:', { ...config, password: '***' })
    console.log('[main:db:query] Query:', query)

    try {
      const client = new Client(config)
      console.log('[main:db:query] Connecting...')
      await client.connect()
      console.log('[main:db:query] Connected, executing query...')
      const start = Date.now()
      const res = await client.query(query)
      const duration = Date.now() - start
      console.log('[main:db:query] Query completed in', duration, 'ms')
      console.log('[main:db:query] Rows:', res.rowCount)
      await client.end()

      // Map fields with resolved type names
      const fields: QueryField[] = res.fields.map((f) => ({
        name: f.name,
        dataType: resolvePostgresType(f.dataTypeID),
        dataTypeID: f.dataTypeID
      }))

      return {
        success: true,
        data: {
          rows: res.rows,
          fields,
          rowCount: res.rowCount,
          durationMs: duration
        }
      }
    } catch (error: unknown) {
      console.error('[main:db:query] Error:', error)
      const errorMessage = error instanceof Error ? error.message : String(error)
      return { success: false, error: errorMessage }
    }
  })

  // Fetch database schemas, tables, and columns
  ipcMain.handle('db:schemas', async (_, config: ConnectionConfig) => {
    const client = new Client(config)

    try {
      await client.connect()

      // Query 1: Get all schemas (excluding system schemas)
      const schemasResult = await client.query(`
        SELECT schema_name
        FROM information_schema.schemata
        WHERE schema_name NOT IN ('pg_catalog', 'information_schema', 'pg_toast')
        ORDER BY schema_name
      `)

      // Query 2: Get all tables and views
      const tablesResult = await client.query(`
        SELECT
          table_schema,
          table_name,
          table_type
        FROM information_schema.tables
        WHERE table_schema NOT IN ('pg_catalog', 'information_schema', 'pg_toast')
        ORDER BY table_schema, table_name
      `)

      // Query 3: Get all columns with primary key info
      const columnsResult = await client.query(`
        SELECT
          c.table_schema,
          c.table_name,
          c.column_name,
          c.data_type,
          c.udt_name,
          c.is_nullable,
          c.column_default,
          c.ordinal_position,
          c.character_maximum_length,
          c.numeric_precision,
          c.numeric_scale,
          CASE WHEN pk.column_name IS NOT NULL THEN true ELSE false END as is_primary_key
        FROM information_schema.columns c
        LEFT JOIN (
          SELECT
            kcu.table_schema,
            kcu.table_name,
            kcu.column_name
          FROM information_schema.table_constraints tc
          JOIN information_schema.key_column_usage kcu
            ON tc.constraint_name = kcu.constraint_name
            AND tc.table_schema = kcu.table_schema
          WHERE tc.constraint_type = 'PRIMARY KEY'
        ) pk ON c.table_schema = pk.table_schema
          AND c.table_name = pk.table_name
          AND c.column_name = pk.column_name
        WHERE c.table_schema NOT IN ('pg_catalog', 'information_schema', 'pg_toast')
        ORDER BY c.table_schema, c.table_name, c.ordinal_position
      `)

      // Query 4: Get all foreign key relationships
      const foreignKeysResult = await client.query(`
        SELECT
          tc.table_schema,
          tc.table_name,
          kcu.column_name,
          tc.constraint_name,
          ccu.table_schema AS referenced_schema,
          ccu.table_name AS referenced_table,
          ccu.column_name AS referenced_column
        FROM information_schema.table_constraints tc
        JOIN information_schema.key_column_usage kcu
          ON tc.constraint_name = kcu.constraint_name
          AND tc.table_schema = kcu.table_schema
        JOIN information_schema.constraint_column_usage ccu
          ON ccu.constraint_name = tc.constraint_name
          AND ccu.table_schema = tc.constraint_schema
        WHERE tc.constraint_type = 'FOREIGN KEY'
          AND tc.table_schema NOT IN ('pg_catalog', 'information_schema', 'pg_toast')
        ORDER BY tc.table_schema, tc.table_name, kcu.column_name
      `)

      await client.end()

      // Build foreign key lookup map: "schema.table.column" -> ForeignKeyInfo
      const fkMap = new Map<string, ForeignKeyInfo>()
      for (const row of foreignKeysResult.rows) {
        const key = `${row.table_schema}.${row.table_name}.${row.column_name}`
        fkMap.set(key, {
          constraintName: row.constraint_name,
          referencedSchema: row.referenced_schema,
          referencedTable: row.referenced_table,
          referencedColumn: row.referenced_column
        })
      }

      // Build schema structure
      const schemaMap = new Map<string, SchemaInfo>()

      // Initialize schemas
      for (const row of schemasResult.rows) {
        schemaMap.set(row.schema_name, {
          name: row.schema_name,
          tables: []
        })
      }

      // Build tables map for easy column assignment
      const tableMap = new Map<string, TableInfo>()
      for (const row of tablesResult.rows) {
        const tableKey = `${row.table_schema}.${row.table_name}`
        const table: TableInfo = {
          name: row.table_name,
          type: row.table_type === 'VIEW' ? 'view' : 'table',
          columns: []
        }
        tableMap.set(tableKey, table)

        // Add table to its schema
        const schema = schemaMap.get(row.table_schema)
        if (schema) {
          schema.tables.push(table)
        }
      }

      // Assign columns to tables
      for (const row of columnsResult.rows) {
        const tableKey = `${row.table_schema}.${row.table_name}`
        const table = tableMap.get(tableKey)
        if (table) {
          // Format data type nicely
          let dataType = row.udt_name
          if (row.character_maximum_length) {
            dataType = `${row.udt_name}(${row.character_maximum_length})`
          } else if (row.numeric_precision && row.numeric_scale) {
            dataType = `${row.udt_name}(${row.numeric_precision},${row.numeric_scale})`
          }

          // Check for foreign key relationship
          const fkKey = `${row.table_schema}.${row.table_name}.${row.column_name}`
          const foreignKey = fkMap.get(fkKey)

          const column: ColumnInfo = {
            name: row.column_name,
            dataType,
            isNullable: row.is_nullable === 'YES',
            isPrimaryKey: row.is_primary_key,
            defaultValue: row.column_default || undefined,
            ordinalPosition: row.ordinal_position,
            foreignKey
          }
          table.columns.push(column)
        }
      }

      // Convert map to array
      const schemas = Array.from(schemaMap.values())

      return {
        success: true,
        data: {
          schemas,
          fetchedAt: Date.now()
        }
      }
    } catch (error: unknown) {
      await client.end().catch(() => {})
      const errorMessage = error instanceof Error ? error.message : String(error)
      return { success: false, error: errorMessage }
    }
  })

  // Connection CRUD handlers
  ipcMain.handle('connections:list', () => {
    try {
      const connections = store.get('connections', [])
      return { success: true, data: connections }
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      return { success: false, error: errorMessage }
    }
  })

  ipcMain.handle('connections:add', (_, connection: ConnectionConfig) => {
    try {
      const connections = store.get('connections', [])
      connections.push(connection)
      store.set('connections', connections)
      return { success: true, data: connection }
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      return { success: false, error: errorMessage }
    }
  })

  ipcMain.handle('connections:update', (_, connection: ConnectionConfig) => {
    try {
      const connections = store.get('connections', [])
      const index = connections.findIndex((c) => c.id === connection.id)
      if (index === -1) {
        return { success: false, error: 'Connection not found' }
      }
      connections[index] = connection
      store.set('connections', connections)
      return { success: true, data: connection }
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      return { success: false, error: errorMessage }
    }
  })

  ipcMain.handle('connections:delete', (_, id: string) => {
    try {
      const connections = store.get('connections', [])
      const filtered = connections.filter((c) => c.id !== id)
      store.set('connections', filtered)
      return { success: true }
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      return { success: false, error: errorMessage }
    }
  })

  // Execute edit operations (INSERT, UPDATE, DELETE)
  ipcMain.handle(
    'db:execute',
    async (_, { config, batch }: { config: ConnectionConfig; batch: EditBatch }) => {
      console.log('[main:db:execute] Received edit batch')
      console.log('[main:db:execute] Context:', batch.context)
      console.log('[main:db:execute] Operations count:', batch.operations.length)

      const client = new Client(config)
      const result: EditResult = {
        success: true,
        rowsAffected: 0,
        executedSql: [],
        errors: []
      }

      try {
        await client.connect()

        // Start transaction for atomicity
        await client.query('BEGIN')

        for (const operation of batch.operations) {
          // Validate operation
          const validation = validateOperation(operation)
          if (!validation.valid) {
            result.errors!.push({
              operationId: operation.id,
              message: validation.error!
            })
            continue
          }

          try {
            // Build parameterized query
            const query = buildQuery(operation, batch.context, 'postgresql')
            const previewSql = buildPreviewSql(operation, batch.context, 'postgresql')
            result.executedSql.push(previewSql)

            console.log('[main:db:execute] Executing:', query.sql)
            console.log('[main:db:execute] Params:', query.params)

            const res = await client.query(query.sql, query.params)
            result.rowsAffected += res.rowCount ?? 0
          } catch (opError: unknown) {
            const errorMessage = opError instanceof Error ? opError.message : String(opError)
            result.errors!.push({
              operationId: operation.id,
              message: errorMessage
            })
          }
        }

        // If any errors, rollback; otherwise commit
        if (result.errors && result.errors.length > 0) {
          await client.query('ROLLBACK')
          result.success = false
        } else {
          await client.query('COMMIT')
        }

        await client.end()
        return { success: true, data: result }
      } catch (error: unknown) {
        console.error('[main:db:execute] Error:', error)
        await client.query('ROLLBACK').catch(() => {})
        await client.end().catch(() => {})
        const errorMessage = error instanceof Error ? error.message : String(error)
        return { success: false, error: errorMessage }
      }
    }
  )

  // Preview SQL for edit operations (without executing)
  ipcMain.handle('db:preview-sql', (_, { batch }: { batch: EditBatch }) => {
    try {
      const previews = batch.operations.map((op) => ({
        operationId: op.id,
        sql: buildPreviewSql(op, batch.context, 'postgresql')
      }))
      return { success: true, data: previews }
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      return { success: false, error: errorMessage }
    }
  })

  // Execute EXPLAIN ANALYZE for query plan analysis
  ipcMain.handle('db:explain', async (_, { config, query, analyze }) => {
    console.log('[main:db:explain] Received explain request')
    console.log('[main:db:explain] Query:', query)
    console.log('[main:db:explain] Analyze:', analyze)

    try {
      const client = new Client(config)
      await client.connect()

      // Build EXPLAIN query with JSON format for easy parsing
      const explainOptions = analyze
        ? 'ANALYZE, COSTS, VERBOSE, BUFFERS, FORMAT JSON'
        : 'COSTS, VERBOSE, FORMAT JSON'
      const explainQuery = `EXPLAIN (${explainOptions}) ${query}`

      console.log('[main:db:explain] Running:', explainQuery)
      const start = Date.now()
      const res = await client.query(explainQuery)
      const duration = Date.now() - start

      await client.end()

      // EXPLAIN with JSON format returns a single row with "QUERY PLAN" column containing JSON array
      const planJson = res.rows[0]?.['QUERY PLAN']

      return {
        success: true,
        data: {
          plan: planJson,
          durationMs: duration
        }
      }
    } catch (error: unknown) {
      console.error('[main:db:explain] Error:', error)
      const errorMessage = error instanceof Error ? error.message : String(error)
      return { success: false, error: errorMessage }
    }
  })

  // ============================================
  // DDL Handlers - Table Designer
  // ============================================

  // Create a new table
  ipcMain.handle(
    'db:create-table',
    async (
      _,
      { config, definition }: { config: ConnectionConfig; definition: TableDefinition }
    ) => {
      console.log('[main:db:create-table] Creating table:', definition.schema, definition.name)

      // Validate table definition
      const validation = validateTableDefinition(definition)
      if (!validation.valid) {
        return {
          success: false,
          error: validation.errors.join('; ')
        }
      }

      const client = new Client(config)
      const result: DDLResult = {
        success: true,
        executedSql: [],
        errors: []
      }

      try {
        await client.connect()
        await client.query('BEGIN')

        // Build and execute CREATE TABLE statement
        const { sql } = buildCreateTable(definition, 'postgresql')
        result.executedSql.push(sql)

        console.log('[main:db:create-table] Executing:', sql)

        // Execute each statement separately (CREATE TABLE, COMMENT, indexes)
        const statements = sql.split(/;\s*\n\n/).filter((s) => s.trim())
        for (const stmt of statements) {
          if (stmt.trim()) {
            await client.query(stmt.trim().endsWith(';') ? stmt : stmt + ';')
          }
        }

        await client.query('COMMIT')
        await client.end()

        return { success: true, data: result }
      } catch (error: unknown) {
        console.error('[main:db:create-table] Error:', error)
        await client.query('ROLLBACK').catch(() => {})
        await client.end().catch(() => {})
        const errorMessage = error instanceof Error ? error.message : String(error)
        return { success: false, error: errorMessage }
      }
    }
  )

  // Alter an existing table
  ipcMain.handle(
    'db:alter-table',
    async (_, { config, batch }: { config: ConnectionConfig; batch: AlterTableBatch }) => {
      console.log('[main:db:alter-table] Altering table:', batch.schema, batch.table)

      const client = new Client(config)
      const result: DDLResult = {
        success: true,
        executedSql: [],
        errors: []
      }

      try {
        await client.connect()
        await client.query('BEGIN')

        // Build and execute ALTER TABLE statements
        const queries = buildAlterTable(batch, 'postgresql')

        for (const query of queries) {
          result.executedSql.push(query.sql)
          console.log('[main:db:alter-table] Executing:', query.sql)

          try {
            await client.query(query.sql)
          } catch (opError: unknown) {
            const errorMessage = opError instanceof Error ? opError.message : String(opError)
            result.errors!.push(errorMessage)
          }
        }

        if (result.errors && result.errors.length > 0) {
          await client.query('ROLLBACK')
          result.success = false
        } else {
          await client.query('COMMIT')
        }

        await client.end()
        return { success: true, data: result }
      } catch (error: unknown) {
        console.error('[main:db:alter-table] Error:', error)
        await client.query('ROLLBACK').catch(() => {})
        await client.end().catch(() => {})
        const errorMessage = error instanceof Error ? error.message : String(error)
        return { success: false, error: errorMessage }
      }
    }
  )

  // Drop a table
  ipcMain.handle(
    'db:drop-table',
    async (
      _,
      {
        config,
        schema,
        table,
        cascade
      }: { config: ConnectionConfig; schema: string; table: string; cascade?: boolean }
    ) => {
      console.log('[main:db:drop-table] Dropping table:', schema, table)

      const client = new Client(config)

      try {
        await client.connect()

        const { sql } = buildDropTable(schema, table, cascade, 'postgresql')
        console.log('[main:db:drop-table] Executing:', sql)

        await client.query(sql)
        await client.end()

        return {
          success: true,
          data: { success: true, executedSql: [sql] }
        }
      } catch (error: unknown) {
        console.error('[main:db:drop-table] Error:', error)
        await client.end().catch(() => {})
        const errorMessage = error instanceof Error ? error.message : String(error)
        return { success: false, error: errorMessage }
      }
    }
  )

  // Get table definition (reverse engineer from database)
  ipcMain.handle(
    'db:get-table-ddl',
    async (
      _,
      { config, schema, table }: { config: ConnectionConfig; schema: string; table: string }
    ) => {
      console.log('[main:db:get-table-ddl] Getting DDL for:', schema, table)

      const client = new Client(config)

      try {
        await client.connect()

        // Query columns with full metadata
        const columnsResult = await client.query(
          `
          SELECT
            c.column_name,
            c.data_type,
            c.udt_name,
            c.is_nullable,
            c.column_default,
            c.ordinal_position,
            c.character_maximum_length,
            c.numeric_precision,
            c.numeric_scale,
            c.collation_name,
            CASE WHEN pk.column_name IS NOT NULL THEN true ELSE false END as is_primary_key,
            col_description(
              (quote_ident($1) || '.' || quote_ident($2))::regclass,
              c.ordinal_position
            ) as column_comment
          FROM information_schema.columns c
          LEFT JOIN (
            SELECT kcu.column_name
            FROM information_schema.table_constraints tc
            JOIN information_schema.key_column_usage kcu
              ON tc.constraint_name = kcu.constraint_name
              AND tc.table_schema = kcu.table_schema
            WHERE tc.constraint_type = 'PRIMARY KEY'
              AND tc.table_schema = $1
              AND tc.table_name = $2
          ) pk ON c.column_name = pk.column_name
          WHERE c.table_schema = $1 AND c.table_name = $2
          ORDER BY c.ordinal_position
        `,
          [schema, table]
        )

        // Query constraints
        const constraintsResult = await client.query(
          `
          SELECT
            tc.constraint_name,
            tc.constraint_type,
            kcu.column_name,
            ccu.table_schema AS ref_schema,
            ccu.table_name AS ref_table,
            ccu.column_name AS ref_column,
            rc.update_rule,
            rc.delete_rule,
            cc.check_clause
          FROM information_schema.table_constraints tc
          LEFT JOIN information_schema.key_column_usage kcu
            ON tc.constraint_name = kcu.constraint_name
            AND tc.table_schema = kcu.table_schema
          LEFT JOIN information_schema.constraint_column_usage ccu
            ON tc.constraint_name = ccu.constraint_name
            AND tc.constraint_type = 'FOREIGN KEY'
          LEFT JOIN information_schema.referential_constraints rc
            ON tc.constraint_name = rc.constraint_name
          LEFT JOIN information_schema.check_constraints cc
            ON tc.constraint_name = cc.constraint_name
          WHERE tc.table_schema = $1 AND tc.table_name = $2
          ORDER BY tc.constraint_name, kcu.ordinal_position
        `,
          [schema, table]
        )

        // Query indexes
        const indexesResult = await client.query(
          `
          SELECT
            i.relname as index_name,
            ix.indisunique as is_unique,
            am.amname as index_method,
            array_agg(a.attname ORDER BY array_position(ix.indkey, a.attnum)) as columns,
            pg_get_expr(ix.indpred, ix.indrelid) as where_clause
          FROM pg_index ix
          JOIN pg_class i ON i.oid = ix.indexrelid
          JOIN pg_class t ON t.oid = ix.indrelid
          JOIN pg_namespace n ON n.oid = t.relnamespace
          JOIN pg_am am ON am.oid = i.relam
          LEFT JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = ANY(ix.indkey)
          WHERE n.nspname = $1 AND t.relname = $2
            AND NOT ix.indisprimary  -- Exclude primary key index
          GROUP BY i.relname, ix.indisunique, am.amname, ix.indpred, ix.indrelid
        `,
          [schema, table]
        )

        // Query table comment
        const tableCommentResult = await client.query(
          `
          SELECT obj_description(
            (quote_ident($1) || '.' || quote_ident($2))::regclass
          ) as comment
        `,
          [schema, table]
        )

        await client.end()

        // Build TableDefinition
        const columns: ColumnDefinition[] = columnsResult.rows.map((row, idx) => ({
          id: `col-${idx}`,
          name: row.column_name,
          dataType: row.udt_name,
          length: row.character_maximum_length || undefined,
          precision: row.numeric_precision || undefined,
          scale: row.numeric_scale || undefined,
          isNullable: row.is_nullable === 'YES',
          isPrimaryKey: row.is_primary_key,
          isUnique: false, // Will be set from constraints
          defaultValue: row.column_default || undefined,
          comment: row.column_comment || undefined,
          collation: row.collation_name || undefined
        }))

        // Build constraints from query results
        const constraintMap = new Map<
          string,
          { type: string; columns: string[]; refSchema?: string; refTable?: string; refColumns?: string[]; onUpdate?: string; onDelete?: string; checkExpression?: string }
        >()

        for (const row of constraintsResult.rows) {
          const key = row.constraint_name
          if (!constraintMap.has(key)) {
            constraintMap.set(key, {
              type: row.constraint_type,
              columns: [],
              refSchema: row.ref_schema,
              refTable: row.ref_table,
              refColumns: [],
              onUpdate: row.update_rule,
              onDelete: row.delete_rule,
              checkExpression: row.check_clause
            })
          }
          const constraint = constraintMap.get(key)!
          if (row.column_name && !constraint.columns.includes(row.column_name)) {
            constraint.columns.push(row.column_name)
          }
          if (row.ref_column && !constraint.refColumns!.includes(row.ref_column)) {
            constraint.refColumns!.push(row.ref_column)
          }
        }

        const constraints: ConstraintDefinition[] = []
        let constraintIdx = 0
        for (const [name, data] of constraintMap) {
          // Skip primary key (handled at column level)
          if (data.type === 'PRIMARY KEY') continue

          const constraintDef: ConstraintDefinition = {
            id: `constraint-${constraintIdx++}`,
            name,
            type:
              data.type === 'FOREIGN KEY'
                ? 'foreign_key'
                : data.type === 'UNIQUE'
                  ? 'unique'
                  : data.type === 'CHECK'
                    ? 'check'
                    : 'unique',
            columns: data.columns
          }

          if (data.type === 'FOREIGN KEY') {
            constraintDef.referencedSchema = data.refSchema
            constraintDef.referencedTable = data.refTable
            constraintDef.referencedColumns = data.refColumns
            constraintDef.onUpdate = data.onUpdate as ConstraintDefinition['onUpdate']
            constraintDef.onDelete = data.onDelete as ConstraintDefinition['onDelete']
          }

          if (data.type === 'CHECK') {
            constraintDef.checkExpression = data.checkExpression
          }

          // Mark columns as unique for UNIQUE constraints
          if (data.type === 'UNIQUE' && data.columns.length === 1) {
            const col = columns.find((c) => c.name === data.columns[0])
            if (col) col.isUnique = true
          }

          constraints.push(constraintDef)
        }

        // Build indexes
        const indexes: IndexDefinition[] = indexesResult.rows.map((row, idx) => {
          // Handle columns array - could be null, undefined, or not an array in some cases
          const columnsArray = Array.isArray(row.columns)
            ? row.columns.filter((c: string | null) => c !== null)
            : []

          return {
            id: `index-${idx}`,
            name: row.index_name,
            columns: columnsArray.map((c: string) => ({ name: c })),
            isUnique: row.is_unique,
            method: row.index_method as IndexDefinition['method'],
            where: row.where_clause || undefined
          }
        })

        const definition: TableDefinition = {
          schema,
          name: table,
          columns,
          constraints,
          indexes,
          comment: tableCommentResult.rows[0]?.comment || undefined
        }

        return { success: true, data: definition }
      } catch (error: unknown) {
        console.error('[main:db:get-table-ddl] Error:', error)
        await client.end().catch(() => {})
        const errorMessage = error instanceof Error ? error.message : String(error)
        return { success: false, error: errorMessage }
      }
    }
  )

  // Get available sequences
  ipcMain.handle('db:get-sequences', async (_, config: ConnectionConfig) => {
    console.log('[main:db:get-sequences] Fetching sequences')

    const client = new Client(config)

    try {
      await client.connect()

      const result = await client.query(`
        SELECT
          schemaname as schema,
          sequencename as name,
          data_type,
          start_value::text,
          increment_by::text as increment
        FROM pg_sequences
        WHERE schemaname NOT IN ('pg_catalog', 'information_schema')
        ORDER BY schemaname, sequencename
      `)

      await client.end()

      const sequences: SequenceInfo[] = result.rows.map((row) => ({
        schema: row.schema,
        name: row.name,
        dataType: row.data_type,
        startValue: row.start_value,
        increment: row.increment
      }))

      return { success: true, data: sequences }
    } catch (error: unknown) {
      console.error('[main:db:get-sequences] Error:', error)
      await client.end().catch(() => {})
      const errorMessage = error instanceof Error ? error.message : String(error)
      return { success: false, error: errorMessage }
    }
  })

  // Get custom types (enums, composites, etc.)
  ipcMain.handle('db:get-types', async (_, config: ConnectionConfig) => {
    console.log('[main:db:get-types] Fetching custom types')

    const client = new Client(config)

    try {
      await client.connect()

      // Get enum types with their values
      const enumsResult = await client.query(`
        SELECT
          n.nspname as schema,
          t.typname as name,
          'enum' as type_category,
          array_agg(e.enumlabel ORDER BY e.enumsortorder) as values
        FROM pg_type t
        JOIN pg_namespace n ON n.oid = t.typnamespace
        JOIN pg_enum e ON e.enumtypid = t.oid
        WHERE n.nspname NOT IN ('pg_catalog', 'information_schema')
        GROUP BY n.nspname, t.typname
        ORDER BY n.nspname, t.typname
      `)

      // Get domain types
      const domainsResult = await client.query(`
        SELECT
          n.nspname as schema,
          t.typname as name,
          'domain' as type_category
        FROM pg_type t
        JOIN pg_namespace n ON n.oid = t.typnamespace
        WHERE t.typtype = 'd'
          AND n.nspname NOT IN ('pg_catalog', 'information_schema')
        ORDER BY n.nspname, t.typname
      `)

      await client.end()

      const types: CustomTypeInfo[] = [
        ...enumsResult.rows.map((row) => ({
          schema: row.schema,
          name: row.name,
          type: 'enum' as const,
          values: row.values
        })),
        ...domainsResult.rows.map((row) => ({
          schema: row.schema,
          name: row.name,
          type: 'domain' as const
        }))
      ]

      return { success: true, data: types }
    } catch (error: unknown) {
      console.error('[main:db:get-types] Error:', error)
      await client.end().catch(() => {})
      const errorMessage = error instanceof Error ? error.message : String(error)
      return { success: false, error: errorMessage }
    }
  })

  // Preview DDL without executing
  ipcMain.handle('db:preview-ddl', (_, { definition }: { definition: TableDefinition }) => {
    try {
      const sql = buildPreviewDDL(definition, 'postgresql')
      return { success: true, data: sql }
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      return { success: false, error: errorMessage }
    }
  })

  await createWindow()

  app.on('activate', function () {
    // On macOS it's common to re-create a window in the app when the
    // dock icon is clicked and there are no other windows open.
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
    } else if (mainWindow) {
      // Show hidden window when clicking dock icon
      mainWindow.show()
    }
  })
})

// macOS: set forceQuit flag before quitting
app.on('before-quit', () => {
  forceQuit = true
})

// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

// In this file you can include the rest of your app's specific main process
// code. You can also put them in separate files and require them here.
