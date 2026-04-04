import {
  pgTable,
  text,
  timestamp,
  jsonb,
  uniqueIndex,
  boolean,
  integer,
} from "drizzle-orm/pg-core";

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
    role: text("role").notNull().default("member"),
    deactivatedAt: timestamp("deactivated_at"),
    preferredModel: text("preferred_model"),
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

export const projects = pgTable("projects", {
  id: text("id").primaryKey(),
  organizationId: text("organization_id")
    .references(() => organizations.id, { onDelete: "cascade" })
    .notNull(),
  name: text("name").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const projectRepositories = pgTable(
  "project_repositories",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .references(() => projects.id, { onDelete: "cascade" })
      .notNull(),
    repositoryId: text("repository_id")
      .references(() => repositories.id, { onDelete: "cascade" })
      .notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [uniqueIndex("project_repo_unique").on(table.projectId, table.repositoryId)]
);

export const conversations = pgTable("conversations", {
  id: text("id").primaryKey(),
  userId: text("user_id")
    .references(() => users.id, { onDelete: "cascade" })
    .notNull(),
  projectId: text("project_id")
    .references(() => projects.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  sessionId: text("session_id"),
  conversationId: text("conversation_id"),
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

export const githubInstallations = pgTable("github_installations", {
  id: text("id").primaryKey(),
  organizationId: text("organization_id")
    .references(() => organizations.id, { onDelete: "cascade" })
    .notNull()
    .unique(),
  installationId: text("installation_id"),
  githubAccountLogin: text("github_account_login"),
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

export const aiProviderConfigurations = pgTable("ai_provider_configurations", {
  id: text("id").primaryKey(),
  organizationId: text("organization_id")
    .references(() => organizations.id, { onDelete: "cascade" })
    .notNull()
    .unique(),
  provider: text("provider").notNull(),
  encryptedAnthropicApiKey: text("encrypted_anthropic_api_key"),
  anthropicApiKeyIv: text("anthropic_api_key_iv"),
  awsRegion: text("aws_region"),
  encryptedAwsAccessKeyId: text("encrypted_aws_access_key_id"),
  awsAccessKeyIdIv: text("aws_access_key_id_iv"),
  encryptedAwsSecretAccessKey: text("encrypted_aws_secret_access_key"),
  awsSecretAccessKeyIv: text("aws_secret_access_key_iv"),
  promptCachingEnabled: boolean("prompt_caching_enabled").default(true),
  compactionEnabled: boolean("compaction_enabled").default(true),
  availableModels: jsonb("available_models").$type<string[]>().default(["claude-sonnet-4-6"]),
  defaultModel: text("default_model").default("claude-sonnet-4-6"),
  allowedTools: jsonb("allowed_tools").$type<string[]>().default(["Bash"]),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const storageConfigurations = pgTable("storage_configurations", {
  id: text("id").primaryKey(),
  organizationId: text("organization_id")
    .references(() => organizations.id, { onDelete: "cascade" })
    .notNull()
    .unique(),
  provider: text("provider").notNull(),
  bucket: text("bucket").notNull(),
  region: text("region"),
  encryptedAccessKeyId: text("encrypted_access_key_id").notNull(),
  accessKeyIdIv: text("access_key_id_iv").notNull(),
  encryptedSecretAccessKey: text("encrypted_secret_access_key").notNull(),
  secretAccessKeyIv: text("secret_access_key_iv").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const auditLogs = pgTable("audit_logs", {
  id: text("id").primaryKey(),
  organizationId: text("organization_id")
    .references(() => organizations.id, { onDelete: "cascade" })
    .notNull(),
  actorId: text("actor_id")
    .references(() => users.id, { onDelete: "cascade" })
    .notNull(),
  action: text("action").notNull(),
  metadata: jsonb("metadata").$type<Record<string, unknown>>(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const blobs = pgTable("blobs", {
  id: text("id").primaryKey(),
  key: text("key").unique().notNull(),
  filename: text("filename").notNull(),
  contentType: text("content_type").notNull(),
  byteSize: integer("byte_size").notNull(),
  organizationId: text("organization_id")
    .references(() => organizations.id, { onDelete: "cascade" })
    .notNull(),
  itemId: text("item_id")
    .references(() => items.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const projectSandboxes = pgTable("project_sandboxes", {
  id: text("id").primaryKey(),
  projectId: text("project_id")
    .references(() => projects.id, { onDelete: "cascade" })
    .notNull()
    .unique(),
  sandboxId: text("sandbox_id"),
  status: text("status").notNull().default("pending"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const itemBlobs = pgTable(
  "item_blobs",
  {
    id: text("id").primaryKey(),
    itemId: text("item_id")
      .references(() => items.id, { onDelete: "cascade" })
      .notNull(),
    blobId: text("blob_id")
      .references(() => blobs.id, { onDelete: "cascade" })
      .notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [uniqueIndex("item_blob_unique").on(table.itemId, table.blobId)]
);
