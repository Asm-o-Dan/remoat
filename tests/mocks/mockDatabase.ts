/**
 * Mock Database & In-Memory SQLite Helper Harness
 * 
 * Provides an in-memory SQLite database instance populated with the Remoat schema:
 * - workspace_bindings
 * - chat_sessions
 * - templates
 * - schedules
 * 
 * Exports factory functions and pre-instantiated repositories for fast, isolated integration testing.
 */

import Database from 'better-sqlite3';
import {
  WorkspaceBindingRepository,
  WorkspaceBindingRecord,
  CreateWorkspaceBindingInput,
} from 'remoat/dist/database/workspaceBindingRepository';
import {
  ChatSessionRepository,
  ChatSessionRecord,
  CreateChatSessionInput,
} from 'remoat/dist/database/chatSessionRepository';
import {
  TemplateRepository,
  TemplateRecord,
  CreateTemplateInput,
  UpdateTemplateInput,
} from 'remoat/dist/database/templateRepository';
import {
  ScheduleRepository,
  ScheduleRecord,
  CreateScheduleInput,
  UpdateScheduleInput,
} from 'remoat/dist/database/scheduleRepository';

/**
 * Seed data definition for in-memory SQLite initialization
 */
export interface MockDatabaseSeedData {
  workspaceBindings?: Array<CreateWorkspaceBindingInput>;
  chatSessions?: Array<CreateChatSessionInput & { displayName?: string | null; isRenamed?: boolean }>;
  templates?: Array<CreateTemplateInput>;
  schedules?: Array<CreateScheduleInput>;
}

/**
 * Container holding all initialized repository instances
 */
export interface MockRepositories {
  db: Database.Database;
  workspaceBindingRepo: WorkspaceBindingRepository;
  chatSessionRepo: ChatSessionRepository;
  templateRepo: TemplateRepository;
  scheduleRepo: ScheduleRepository;
  reset?: () => void;
}

export type MockDatabaseBundle = MockRepositories;

/**
 * Schema DDL statements matching production repositories
 */
export const DATABASE_SCHEMA_DDL = `
  CREATE TABLE IF NOT EXISTS workspace_bindings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      channel_id TEXT NOT NULL UNIQUE,
      workspace_path TEXT NOT NULL,
      guild_id TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS chat_sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      channel_id TEXT NOT NULL UNIQUE,
      category_id TEXT NOT NULL,
      workspace_path TEXT NOT NULL,
      session_number INTEGER NOT NULL,
      display_name TEXT,
      is_renamed INTEGER NOT NULL DEFAULT 0,
      guild_id TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS templates (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      prompt TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS schedules (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      cron_expression TEXT NOT NULL,
      prompt TEXT NOT NULL,
      workspace_path TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
`;

export function initializeSchema(db: Database.Database): void {
  db.exec(DATABASE_SCHEMA_DDL);
}

/**
 * Creates an in-memory better-sqlite3 database with all tables initialized.
 */
export function createMockDatabase(seedData?: MockDatabaseSeedData): Database.Database {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  db.pragma('journal_mode = WAL');
  initializeSchema(db);

  if (seedData) {
    seedMockDatabase(db, seedData);
  }

  return db;
}

/**
 * Populates database tables with structured seed records.
 */
export function seedMockDatabase(db: Database.Database, seedData: MockDatabaseSeedData): void {
  if (seedData.workspaceBindings && seedData.workspaceBindings.length > 0) {
    const stmt = db.prepare(`
      INSERT INTO workspace_bindings (channel_id, workspace_path, guild_id)
      VALUES (?, ?, ?)
    `);
    const insertMany = db.transaction((bindings: CreateWorkspaceBindingInput[]) => {
      for (const b of bindings) {
        stmt.run(b.channelId, b.workspacePath, b.guildId);
      }
    });
    insertMany(seedData.workspaceBindings);
  }

  if (seedData.chatSessions && seedData.chatSessions.length > 0) {
    const stmt = db.prepare(`
      INSERT INTO chat_sessions (channel_id, category_id, workspace_path, session_number, display_name, is_renamed, guild_id)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    const insertMany = db.transaction(
      (sessions: Array<CreateChatSessionInput & { displayName?: string | null; isRenamed?: boolean }>) => {
        for (const s of sessions) {
          stmt.run(
            s.channelId,
            s.categoryId,
            s.workspacePath,
            s.sessionNumber,
            s.displayName ?? null,
            s.isRenamed ? 1 : 0,
            s.guildId
          );
        }
      }
    );
    insertMany(seedData.chatSessions);
  }

  if (seedData.templates && seedData.templates.length > 0) {
    const stmt = db.prepare(`
      INSERT INTO templates (name, prompt)
      VALUES (?, ?)
    `);
    const insertMany = db.transaction((templates: CreateTemplateInput[]) => {
      for (const t of templates) {
        stmt.run(t.name, t.prompt);
      }
    });
    insertMany(seedData.templates);
  }

  if (seedData.schedules && seedData.schedules.length > 0) {
    const stmt = db.prepare(`
      INSERT INTO schedules (cron_expression, prompt, workspace_path, enabled)
      VALUES (?, ?, ?, ?)
    `);
    const insertMany = db.transaction((schedules: CreateScheduleInput[]) => {
      for (const s of schedules) {
        stmt.run(s.cronExpression, s.prompt, s.workspacePath, s.enabled ? 1 : 0);
      }
    });
    insertMany(seedData.schedules);
  }
}

/**
 * Resets all tables in the mock database and optionally applies fresh seed data.
 */
export function resetMockDatabase(db: Database.Database, seedData?: MockDatabaseSeedData): void {
  db.exec(`
    DELETE FROM workspace_bindings;
    DELETE FROM chat_sessions;
    DELETE FROM templates;
    DELETE FROM schedules;
    DELETE FROM sqlite_sequence WHERE name IN ('workspace_bindings', 'chat_sessions', 'templates', 'schedules');
  `);

  if (seedData) {
    seedMockDatabase(db, seedData);
  }
}

/**
 * Factory that returns all 4 repository instances wired to an in-memory database.
 */
export function createMockRepositories(db?: Database.Database, seedData?: MockDatabaseSeedData): MockRepositories {
  const database = db ?? createMockDatabase(seedData);
  return {
    db: database,
    workspaceBindingRepo: new WorkspaceBindingRepository(database),
    chatSessionRepo: new ChatSessionRepository(database),
    templateRepo: new TemplateRepository(database),
    scheduleRepo: new ScheduleRepository(database),
    reset: () => resetMockDatabase(database),
  };
}

/**
 * Seed helper for workspace bindings
 */
export function seedWorkspaceBinding(
  repo: WorkspaceBindingRepository,
  input: CreateWorkspaceBindingInput
): WorkspaceBindingRecord {
  return repo.create(input);
}

/**
 * Seed helper for chat sessions
 */
export function seedChatSession(
  repo: ChatSessionRepository,
  input: CreateChatSessionInput & { displayName?: string }
): ChatSessionRecord | undefined {
  repo.create(input);
  if (input.displayName) {
    repo.updateDisplayName(input.channelId, input.displayName);
  }
  return repo.findByChannelId(input.channelId);
}

/**
 * Seed helper for templates
 */
export function seedTemplate(
  repo: TemplateRepository,
  input: CreateTemplateInput
): TemplateRecord {
  return repo.create(input);
}

/**
 * Seed helper for schedules
 */
export function seedSchedule(
  repo: ScheduleRepository,
  input: CreateScheduleInput
): ScheduleRecord {
  return repo.create(input);
}
