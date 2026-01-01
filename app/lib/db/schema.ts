import { pgTable, text, timestamp, jsonb, uniqueIndex, boolean } from "drizzle-orm/pg-core";

export const users = pgTable("users", {
  id: text("id").primaryKey(),
  email: text("email").unique().notNull(),
  name: text("name").notNull(),
  passwordHash: text("password_hash"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const organizations = pgTable("organizations", {
  id: text("id").primaryKey(),
  onboardingCompleted: boolean("onboarding_completed").default(false).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const members = pgTable(
  "members",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .references(() => users.id, { onDelete: "cascade" })
      .notNull(),
    organizationId: text("organization_id")
      .references(() => organizations.id, { onDelete: "cascade" })
      .notNull(),
    role: text("role").notNull().default("member"), // 'owner' | 'member'
    deactivatedAt: timestamp("deactivated_at"), // null = active, set = deactivated
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [uniqueIndex("user_org_unique").on(table.userId, table.organizationId)]
);

export const invitations = pgTable("invitations", {
  id: text("id").primaryKey(),
  organizationId: text("organization_id")
    .references(() => organizations.id, { onDelete: "cascade" })
    .notNull(),
  token: text("token").unique().notNull(),
  role: text("role").notNull().default("member"), // role to assign on accept
  expiresAt: timestamp("expires_at").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const sessions = pgTable("sessions", {
  id: text("id").primaryKey(),
  userId: text("user_id")
    .references(() => users.id, { onDelete: "cascade" })
    .notNull(),
  expiresAt: timestamp("expires_at").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const conversations = pgTable("conversations", {
  id: text("id").primaryKey(),
  userId: text("user_id")
    .references(() => users.id, { onDelete: "cascade" })
    .notNull(),
  title: text("title").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// Item types: 'message' | 'tool_call' | 'tool_output'
export const items = pgTable("items", {
  id: text("id").primaryKey(),
  conversationId: text("conversation_id")
    .references(() => conversations.id, { onDelete: "cascade" })
    .notNull(),
  type: text("type").notNull(), // 'message' | 'tool_call' | 'tool_output'
  role: text("role"), // 'user' | 'assistant' (for messages only)
  content: jsonb("content"), // flexible based on type
  toolCallId: text("tool_call_id"), // for tool_output, references a tool_call item
  status: text("status"), // 'in_progress' | 'completed' | 'cancelled'
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const conversationShares = pgTable("conversation_shares", {
  id: text("id").primaryKey(),
  conversationId: text("conversation_id")
    .references(() => conversations.id, { onDelete: "cascade" })
    .notNull(),
  token: text("token").unique().notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  revokedAt: timestamp("revoked_at"), // null = active, set = revoked
});

export const reviewRequests = pgTable("review_requests", {
  id: text("id").primaryKey(),
  conversationId: text("conversation_id")
    .references(() => conversations.id, { onDelete: "cascade" })
    .notNull(),
  requestedByUserId: text("requested_by_user_id")
    .references(() => users.id, { onDelete: "cascade" })
    .notNull(),
  requestedToUserId: text("requested_to_user_id")
    .references(() => users.id, { onDelete: "cascade" })
    .notNull(),
  shareToken: text("share_token").notNull(),
  status: text("status").notNull().default("pending"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  reviewedAt: timestamp("reviewed_at"),
});

export const githubInstallations = pgTable("github_installations", {
  id: text("id").primaryKey(),
  organizationId: text("organization_id")
    .references(() => organizations.id, { onDelete: "cascade" })
    .notNull()
    .unique(),
  installationId: text("installation_id").notNull(),
  encryptedAccessToken: text("encrypted_access_token"),
  accessTokenIv: text("access_token_iv"),
  accessTokenExpiresAt: timestamp("access_token_expires_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const repositories = pgTable("repositories", {
  id: text("id").primaryKey(),
  organizationId: text("organization_id")
    .references(() => organizations.id, { onDelete: "cascade" })
    .notNull(),
  githubRepoId: text("github_repo_id"),
  name: text("name").notNull(),
  fullName: text("full_name").notNull(),
  cloneUrl: text("clone_url").notNull(),
  isPrivate: boolean("is_private").default(false).notNull(),
  cloneStatus: text("clone_status").default("pending").notNull(),
  clonedAt: timestamp("cloned_at"),
  lastSyncedAt: timestamp("last_synced_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const ssoConfigurations = pgTable("sso_configurations", {
  id: text("id").primaryKey(),
  organizationId: text("organization_id")
    .references(() => organizations.id, { onDelete: "cascade" })
    .notNull()
    .unique(),
  enabled: boolean("enabled").default(false).notNull(),
  providerName: text("provider_name"),
  idpEntityId: text("idp_entity_id"),
  idpSsoUrl: text("idp_sso_url"),
  idpCertificate: text("idp_certificate"),
  spEntityId: text("sp_entity_id"),
  spAcsUrl: text("sp_acs_url"),
  allowPasswordLogin: boolean("allow_password_login").default(true).notNull(),
  autoProvisionUsers: boolean("auto_provision_users").default(true).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const githubAppConfigurations = pgTable("github_app_configurations", {
  id: text("id").primaryKey(),
  organizationId: text("organization_id")
    .references(() => organizations.id, { onDelete: "cascade" })
    .notNull()
    .unique(),
  appId: text("app_id").notNull(),
  appSlug: text("app_slug").notNull(),
  encryptedPrivateKey: text("encrypted_private_key").notNull(),
  privateKeyIv: text("private_key_iv").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});
