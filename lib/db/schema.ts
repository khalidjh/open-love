import { pgTable, uuid, text, timestamp, jsonb, integer, index } from 'drizzle-orm/pg-core';

// =============================================================================
// Control-plane schema for Open Lovable (multi-tenant PaaS)
//
// Auth users live in Supabase's `auth.users`. We mirror the minimum here and
// model tenants (orgs), projects, versioned code snapshots, chat history, and
// (Phase 2) per-tenant provisioned databases.
// =============================================================================

// A tenant / client account. A user can belong to one or more orgs.
export const orgs = pgTable('orgs', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

// Profile row mirrored from Supabase auth.users (id === auth uid).
export const profiles = pgTable('profiles', {
  id: uuid('id').primaryKey(), // matches auth.users.id
  email: text('email'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

// Membership of a user in an org, with a role.
export const orgMembers = pgTable('org_members', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id').notNull().references(() => orgs.id, { onDelete: 'cascade' }),
  userId: uuid('user_id').notNull().references(() => profiles.id, { onDelete: 'cascade' }),
  role: text('role').notNull().default('owner'), // owner | admin | member
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => ({
  orgIdx: index('org_members_org_idx').on(t.orgId),
  userIdx: index('org_members_user_idx').on(t.userId),
}));

// A project = one app a client is building.
export const projects = pgTable('projects', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id').notNull().references(() => orgs.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  sourceUrl: text('source_url'),        // the site they cloned, if any
  model: text('model'),                 // AI model used
  sandboxId: text('sandbox_id'),        // last known live sandbox (ephemeral)
  sandboxProvider: text('sandbox_provider'), // 'e2b' | 'vercel'
  netlifySiteId: text('netlify_site_id'),    // stable per-project deploy target
  deployUrl: text('deploy_url'),
  currentVersionId: uuid('current_version_id'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => ({
  orgIdx: index('projects_org_idx').on(t.orgId),
}));

// An immutable snapshot of a project's files.
export const projectVersions = pgTable('project_versions', {
  id: uuid('id').primaryKey().defaultRandom(),
  projectId: uuid('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  label: text('label'),
  // files stored as { [path]: content }
  files: jsonb('files').$type<Record<string, string>>().notNull().default({}),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => ({
  projectIdx: index('project_versions_project_idx').on(t.projectId),
}));

// Chat history for a project.
export const messages = pgTable('messages', {
  id: uuid('id').primaryKey().defaultRandom(),
  projectId: uuid('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  role: text('role').notNull(), // user | assistant | system
  content: text('content').notNull(),
  seq: integer('seq').notNull().default(0),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => ({
  projectIdx: index('messages_project_idx').on(t.projectId),
}));

// Phase 2: per-tenant provisioned databases (e.g. a Supabase project per client app).
export const tenantDatabases = pgTable('tenant_databases', {
  id: uuid('id').primaryKey().defaultRandom(),
  projectId: uuid('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  provider: text('provider').notNull().default('supabase'), // supabase | neon | turso
  externalRef: text('external_ref'),          // e.g. supabase project ref
  // encrypted at rest (see lib/crypto); never store plaintext creds
  encryptedCredentials: text('encrypted_credentials'),
  status: text('status').notNull().default('pending'), // pending | ready | error
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => ({
  projectIdx: index('tenant_databases_project_idx').on(t.projectId),
}));

// Phase-1 multi-tenant auth: one isolated Zitadel organization per project, so
// each generated app has its own user pool. Tokens are validated by PostgREST via
// a combined JWKS (Zitadel RS256 + the existing Supabase HS256 anon key).
export const tenantAuth = pgTable('tenant_auth', {
  id: uuid('id').primaryKey().defaultRandom(),
  projectId: uuid('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  provider: text('provider').notNull().default('zitadel'),
  orgId: text('org_id'),                 // Zitadel organization id (the isolated tenant)
  clientId: text('client_id'),           // public OIDC client id (safe to ship in the app)
  issuer: text('issuer'),                // Zitadel issuer URL
  allowedOrigins: jsonb('allowed_origins').$type<string[]>().default([]),
  // encrypted at rest (see lib/crypto); never store plaintext admin creds
  encryptedCredentials: text('encrypted_credentials'),
  status: text('status').notNull().default('pending'), // pending | provisioning | ready | error
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => ({
  projectIdx: index('tenant_auth_project_idx').on(t.projectId),
}));

export type Project = typeof projects.$inferSelect;
export type NewProject = typeof projects.$inferInsert;
export type ProjectVersion = typeof projectVersions.$inferSelect;
export type Message = typeof messages.$inferSelect;
