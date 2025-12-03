import {
  pgTable,
  uuid,
  text,
  timestamp,
  integer,
  boolean,
  index,
  jsonb,
} from 'drizzle-orm/pg-core'
import { relations } from 'drizzle-orm'

// Customers table - synced from Clerk and DodoPayments
export const customers = pgTable(
  'customers',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    email: text('email').notNull().unique(),
    name: text('name'),
    clerkUserId: text('clerk_user_id').unique(),
    dodoCustomerId: text('dodo_customer_id').unique(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index('idx_customers_email').on(table.email),
    index('idx_customers_clerk_id').on(table.clerkUserId),
  ]
)

// Teams table - for business/team plans
export const teams = pgTable(
  'teams',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: text('name').notNull(),
    ownerId: uuid('owner_id')
      .references(() => customers.id)
      .notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index('idx_teams_owner').on(table.ownerId),
  ]
)

// Team Members table - links customers to teams
export const teamMembers = pgTable(
  'team_members',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    teamId: uuid('team_id')
      .references(() => teams.id, { onDelete: 'cascade' })
      .notNull(),
    customerId: uuid('customer_id')
      .references(() => customers.id, { onDelete: 'cascade' })
      .notNull(),
    role: text('role').notNull().default('member'), // 'owner', 'admin', 'member'
    invitedBy: uuid('invited_by').references(() => customers.id),
    invitedAt: timestamp('invited_at', { withTimezone: true }).defaultNow().notNull(),
    joinedAt: timestamp('joined_at', { withTimezone: true }),
    status: text('status').notNull().default('pending'), // 'pending', 'active', 'removed'
  },
  (table) => [
    index('idx_team_members_team').on(table.teamId),
    index('idx_team_members_customer').on(table.customerId),
    index('idx_team_members_status').on(table.status),
  ]
)

// Licenses table
export const licenses = pgTable(
  'licenses',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    customerId: uuid('customer_id')
      .references(() => customers.id)
      .notNull(),
    licenseKey: text('license_key').notNull().unique(),
    plan: text('plan').notNull().default('pro'), // 'pro', 'team', 'enterprise'
    status: text('status').notNull().default('active'), // 'active', 'revoked', 'expired'
    maxActivations: integer('max_activations').notNull().default(3),
    // Team-specific fields
    teamId: uuid('team_id').references(() => teams.id),
    seatCount: integer('seat_count').default(1), // Number of seats for team plans
    dodoPaymentId: text('dodo_payment_id').unique(),
    dodoProductId: text('dodo_product_id'),
    dodoSubscriptionId: text('dodo_subscription_id'), // For subscription management
    purchasedAt: timestamp('purchased_at', { withTimezone: true }).defaultNow().notNull(),
    updatesUntil: timestamp('updates_until', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index('idx_licenses_customer').on(table.customerId),
    index('idx_licenses_key').on(table.licenseKey),
    index('idx_licenses_status').on(table.status),
    index('idx_licenses_team').on(table.teamId),
  ]
)

// Device Activations table
export const activations = pgTable(
  'activations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    licenseId: uuid('license_id')
      .references(() => licenses.id, { onDelete: 'cascade' })
      .notNull(),
    instanceId: text('instance_id').notNull().unique(), // For deactivation
    deviceId: text('device_id').notNull(),
    deviceName: text('device_name'),
    os: text('os'), // 'macos', 'windows', 'linux'
    appVersion: text('app_version'),
    activatedAt: timestamp('activated_at', { withTimezone: true }).defaultNow().notNull(),
    lastValidatedAt: timestamp('last_validated_at', { withTimezone: true }).defaultNow().notNull(),
    isActive: boolean('is_active').notNull().default(true),
  },
  (table) => [
    index('idx_activations_license').on(table.licenseId),
    index('idx_activations_device').on(table.deviceId),
    index('idx_activations_instance').on(table.instanceId),
  ]
)

// App Releases table - for update checks
export const releases = pgTable(
  'releases',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    version: text('version').notNull().unique(),
    releaseNotes: text('release_notes'),
    downloadUrlMac: text('download_url_mac'),
    downloadUrlMacArm: text('download_url_mac_arm'),
    downloadUrlWindows: text('download_url_windows'),
    downloadUrlLinux: text('download_url_linux'),
    isLatest: boolean('is_latest').notNull().default(false),
    minSupportedVersion: text('min_supported_version'),
    releasedAt: timestamp('released_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [index('idx_releases_version').on(table.version)]
)

// Webhook Events table - provider-agnostic event logging
export const webhookEvents = pgTable(
  'webhook_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    eventId: text('event_id').notNull(), // Provider's event ID
    eventName: text('event_name').notNull(), // e.g. "payment.completed"
    provider: text('provider').notNull(), // e.g. "dodo", "stripe", "clerk"
    payload: jsonb('payload').notNull(), // Full event payload
    processed: boolean('processed').notNull().default(false),
    processedAt: timestamp('processed_at', { withTimezone: true }),
    error: text('error'), // Store error message if processing failed
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index('idx_webhook_events_event_id').on(table.eventId),
    index('idx_webhook_events_provider').on(table.provider),
    index('idx_webhook_events_event_name').on(table.eventName),
    index('idx_webhook_events_processed').on(table.processed),
  ]
)

// Relations
export const customersRelations = relations(customers, ({ many }) => ({
  licenses: many(licenses),
  ownedTeams: many(teams),
  teamMemberships: many(teamMembers),
}))

export const teamsRelations = relations(teams, ({ one, many }) => ({
  owner: one(customers, {
    fields: [teams.ownerId],
    references: [customers.id],
  }),
  members: many(teamMembers),
  licenses: many(licenses),
}))

export const teamMembersRelations = relations(teamMembers, ({ one }) => ({
  team: one(teams, {
    fields: [teamMembers.teamId],
    references: [teams.id],
  }),
  customer: one(customers, {
    fields: [teamMembers.customerId],
    references: [customers.id],
  }),
  inviter: one(customers, {
    fields: [teamMembers.invitedBy],
    references: [customers.id],
  }),
}))

export const licensesRelations = relations(licenses, ({ one, many }) => ({
  customer: one(customers, {
    fields: [licenses.customerId],
    references: [customers.id],
  }),
  team: one(teams, {
    fields: [licenses.teamId],
    references: [teams.id],
  }),
  activations: many(activations),
}))

export const activationsRelations = relations(activations, ({ one }) => ({
  license: one(licenses, {
    fields: [activations.licenseId],
    references: [licenses.id],
  }),
}))

// Types
export type Customer = typeof customers.$inferSelect
export type NewCustomer = typeof customers.$inferInsert

export type License = typeof licenses.$inferSelect
export type NewLicense = typeof licenses.$inferInsert

export type Activation = typeof activations.$inferSelect
export type NewActivation = typeof activations.$inferInsert

export type Release = typeof releases.$inferSelect
export type NewRelease = typeof releases.$inferInsert

export type WebhookEvent = typeof webhookEvents.$inferSelect
export type NewWebhookEvent = typeof webhookEvents.$inferInsert

export type Team = typeof teams.$inferSelect
export type NewTeam = typeof teams.$inferInsert

export type TeamMember = typeof teamMembers.$inferSelect
export type NewTeamMember = typeof teamMembers.$inferInsert
