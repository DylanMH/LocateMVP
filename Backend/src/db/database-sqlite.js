import Database from "better-sqlite3";
import { existsSync, mkdirSync } from "fs";
import { join } from "path";
import {
  ensureTerritorySchema,
  seedTerritoryTree,
  backfillTicketTerritories,
  backfillUserTerritoryAssignments,
} from "./territories.js";
import { 
  ensureBoundaryUnitSchema, 
  importTexasCitiesFromGeoJSON 
} from "./boundaryUnits.js";

const DATA_DIR = join(process.cwd(), "data");
const DB_PATH = join(DATA_DIR, "locate720.db");

// Ensure data directory exists
if (!existsSync(DATA_DIR)) {
  mkdirSync(DATA_DIR, { recursive: true });
}

// Initialize SQLite database
export const db = new Database(DB_PATH);
db.pragma("foreign_keys = ON");

// Create schema if not exists
const schemaSql = `
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT,
  role TEXT NOT NULL CHECK (role IN ('TRAINEE', 'TRAINER', 'TECH', 'SUPERVISOR', 'AREA_MANAGER', 'MANAGER')),
  title TEXT,
  phone TEXT,
  area_id TEXT,
  supervisor_id TEXT,
  is_active INTEGER DEFAULT 1,
  password_must_change INTEGER DEFAULT 0,
  last_login_at INTEGER,
  created_at INTEGER DEFAULT (strftime('%s', 'now') * 1000),
  updated_at INTEGER DEFAULT (strftime('%s', 'now') * 1000),
  FOREIGN KEY (supervisor_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS areas (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  manager_id TEXT REFERENCES users(id),
  polygon_geojson TEXT,
  bbox_north REAL,
  bbox_south REAL,
  bbox_east REAL,
  bbox_west REAL,
  center_lat REAL,
  center_lng REAL,
  color TEXT DEFAULT '#3B82F6',
  active INTEGER DEFAULT 1,
  created_at INTEGER DEFAULT (strftime('%s', 'now') * 1000),
  updated_at INTEGER DEFAULT (strftime('%s', 'now') * 1000)
);

CREATE TABLE IF NOT EXISTS user_areas (
  user_id TEXT NOT NULL,
  area_id TEXT NOT NULL,
  assigned_by TEXT,
  assigned_at INTEGER DEFAULT (strftime('%s', 'now') * 1000),
  PRIMARY KEY (user_id, area_id),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (area_id) REFERENCES areas(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS tickets (
  id TEXT PRIMARY KEY,
  external_ticket_id TEXT,
  ticket_number TEXT NOT NULL,
  ticket_type TEXT,
  address TEXT,
  lat REAL,
  lng REAL,
  status TEXT NOT NULL DEFAULT 'NEW' CHECK (status IN ('NEW', 'OPEN', 'ASSIGNED', 'IN_PROGRESS', 'COMPLETED', 'CLOSED')),
  locator_status TEXT NOT NULL DEFAULT 'ASSIGNED' CHECK (locator_status IN ('ASSIGNED', 'ENROUTE', 'ONSITE', 'PAUSED', 'CLOSED', 'UNABLE')),
  assigned_tech_id TEXT,
  version INTEGER DEFAULT 1,
  payload_json TEXT DEFAULT '{}',
  source TEXT DEFAULT '811',
  created_at INTEGER DEFAULT (strftime('%s', 'now') * 1000),
  updated_at INTEGER DEFAULT (strftime('%s', 'now') * 1000),
  due_at INTEGER,
  closed_by_name TEXT,
  closed_at INTEGER,
  last_811_sync_at INTEGER,
  -- Ticket lineage. See docs/linked-tickets-architecture.md.
  -- Linkage is for HISTORY only. Each ticket remains independent for
  -- assignment, time, footage, notes, photos, productivity, and billing.
  root_ticket_id TEXT,
  parent_ticket_id TEXT,
  sequence_number INTEGER DEFAULT 1,
  external_root_number TEXT,
  FOREIGN KEY (assigned_tech_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS ticket_events (
  id TEXT PRIMARY KEY,
  ticket_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  old_status TEXT,
  new_status TEXT,
  old_locator_status TEXT,
  new_locator_status TEXT,
  user_id TEXT,
  notes TEXT,
  payload_json TEXT DEFAULT '{}',
  created_at INTEGER DEFAULT (strftime('%s', 'now') * 1000),
  FOREIGN KEY (ticket_id) REFERENCES tickets(id),
  FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS outbox_811_events (
  id TEXT PRIMARY KEY,
  ticket_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  member_code TEXT NOT NULL,
  response_code TEXT,
  notes TEXT,
  status TEXT DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'SENT', 'FAILED')),
  created_at INTEGER DEFAULT (strftime('%s', 'now') * 1000),
  sent_at INTEGER,
  retry_count INTEGER DEFAULT 0,
  FOREIGN KEY (ticket_id) REFERENCES tickets(id)
);

CREATE TABLE IF NOT EXISTS day_sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  date TEXT NOT NULL,
  clock_in_at INTEGER,
  clock_out_at INTEGER,
  clock_out_ticket_id TEXT,
  status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'CLOCKED_OUT')),
  clock_in_reason TEXT,
  allocation_type TEXT,
  other_reason TEXT,
  created_at INTEGER DEFAULT (strftime('%s', 'now') * 1000),
  updated_at INTEGER DEFAULT (strftime('%s', 'now') * 1000),
  FOREIGN KEY (user_id) REFERENCES users(id),
  FOREIGN KEY (clock_out_ticket_id) REFERENCES tickets(id)
);

CREATE TABLE IF NOT EXISTS clock_events (
  id TEXT PRIMARY KEY,
  request_id TEXT NOT NULL UNIQUE,
  session_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  event_type TEXT NOT NULL CHECK (event_type IN ('CLOCK_IN', 'CLOCK_OUT', 'LUNCH_START', 'LUNCH_END', 'PERSONAL_START', 'PERSONAL_END')),
  occurred_at INTEGER NOT NULL,
  reason TEXT,
  ticket_id TEXT,
  device_id TEXT,
  seq INTEGER,
  date TEXT,
  clock_in_at INTEGER,
  clock_out_at INTEGER,
  session_status TEXT CHECK (session_status IN ('ACTIVE', 'CLOCKED_OUT')),
  created_at INTEGER DEFAULT (strftime('%s', 'now') * 1000),
  FOREIGN KEY (session_id) REFERENCES day_sessions(id),
  FOREIGN KEY (user_id) REFERENCES users(id),
  FOREIGN KEY (ticket_id) REFERENCES tickets(id)
);

CREATE TABLE IF NOT EXISTS break_segments (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  break_type TEXT NOT NULL CHECK (break_type IN ('LUNCH', 'PERSONAL')),
  started_at INTEGER NOT NULL,
  ended_at INTEGER,
  reason TEXT,
  start_event_request_id TEXT,
  end_event_request_id TEXT,
  created_at INTEGER DEFAULT (strftime('%s', 'now') * 1000),
  updated_at INTEGER DEFAULT (strftime('%s', 'now') * 1000),
  FOREIGN KEY (session_id) REFERENCES day_sessions(id),
  FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS utility_production_ledger (
  id TEXT PRIMARY KEY,
  request_id TEXT NOT NULL,
  ticket_id TEXT NOT NULL,
  user_id TEXT,
  customer_id TEXT NOT NULL,
  customer_name TEXT,
  utility_type TEXT,
  minutes_delta INTEGER NOT NULL DEFAULT 0,
  footage_delta INTEGER NOT NULL DEFAULT 0,
  completed_delta INTEGER NOT NULL DEFAULT 0,
  source_event_type TEXT NOT NULL,
  occurred_at INTEGER NOT NULL,
  created_at INTEGER DEFAULT (strftime('%s', 'now') * 1000),
  FOREIGN KEY (ticket_id) REFERENCES tickets(id),
  FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_tickets_assigned_tech ON tickets(assigned_tech_id);
CREATE INDEX IF NOT EXISTS idx_tickets_status ON tickets(status);
CREATE INDEX IF NOT EXISTS idx_tickets_locator_status ON tickets(locator_status);
CREATE INDEX IF NOT EXISTS idx_tickets_updated_at ON tickets(updated_at);
CREATE INDEX IF NOT EXISTS idx_ticket_events_ticket_id ON ticket_events(ticket_id);
CREATE INDEX IF NOT EXISTS idx_outbox_811_status ON outbox_811_events(status);
CREATE INDEX IF NOT EXISTS idx_day_sessions_user_date ON day_sessions(user_id, date);
CREATE INDEX IF NOT EXISTS idx_day_sessions_status ON day_sessions(status);
CREATE INDEX IF NOT EXISTS idx_clock_events_session_id ON clock_events(session_id);
CREATE INDEX IF NOT EXISTS idx_clock_events_user_occurred ON clock_events(user_id, occurred_at);
CREATE INDEX IF NOT EXISTS idx_clock_events_type ON clock_events(event_type);
CREATE INDEX IF NOT EXISTS idx_break_segments_session ON break_segments(session_id);
CREATE INDEX IF NOT EXISTS idx_break_segments_user_started ON break_segments(user_id, started_at);
CREATE INDEX IF NOT EXISTS idx_break_segments_type ON break_segments(break_type);
CREATE TABLE IF NOT EXISTS ticket_notes (
  id TEXT PRIMARY KEY,
  ticket_id TEXT NOT NULL,
  ticket_number TEXT NOT NULL,
  author_id TEXT,
  author_name TEXT,
  body TEXT NOT NULL,
  note_type TEXT NOT NULL DEFAULT 'INTERNAL' CHECK (note_type IN ('INTERNAL', 'DISPATCH')),
  created_at INTEGER DEFAULT (strftime('%s', 'now') * 1000),
  FOREIGN KEY (ticket_id) REFERENCES tickets(id)
);

CREATE INDEX IF NOT EXISTS idx_ticket_notes_ticket_id ON ticket_notes(ticket_id);
CREATE INDEX IF NOT EXISTS idx_ticket_notes_ticket_number ON ticket_notes(ticket_number);
CREATE INDEX IF NOT EXISTS idx_ticket_notes_created_at ON ticket_notes(created_at);

CREATE TABLE IF NOT EXISTS ticket_attachments (
  id TEXT PRIMARY KEY,
  ticket_id TEXT NOT NULL,
  ticket_number TEXT NOT NULL,
  uploader_id TEXT,
  uploader_name TEXT,
  kind TEXT NOT NULL DEFAULT 'PHOTO',
  file_name TEXT,
  mime_type TEXT,
  width INTEGER,
  height INTEGER,
  file_size INTEGER,
  lat REAL,
  lng REAL,
  data_base64 TEXT,
  remote_url TEXT,
  captured_at INTEGER,
  created_at INTEGER DEFAULT (strftime('%s', 'now') * 1000),
  FOREIGN KEY (ticket_id) REFERENCES tickets(id)
);

CREATE INDEX IF NOT EXISTS idx_ticket_attachments_ticket_id ON ticket_attachments(ticket_id);
CREATE INDEX IF NOT EXISTS idx_ticket_attachments_ticket_number ON ticket_attachments(ticket_number);

CREATE INDEX IF NOT EXISTS idx_utility_production_ticket ON utility_production_ledger(ticket_id);
CREATE INDEX IF NOT EXISTS idx_utility_production_user ON utility_production_ledger(user_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_utility_production_request_customer
  ON utility_production_ledger(request_id, customer_id);

CREATE TABLE IF NOT EXISTS idempotency_records (
  request_id TEXT PRIMARY KEY,
  result_json TEXT NOT NULL,
  created_at INTEGER DEFAULT (strftime('%s', 'now') * 1000)
);

CREATE INDEX IF NOT EXISTS idx_idempotency_created ON idempotency_records(created_at);
`;

db.exec(schemaSql);

function ensureColumnExists(tableName, columnName, alterSql) {
  const columns = db.prepare(`PRAGMA table_info(${tableName})`).all();
  const hasColumn = columns.some((column) => column.name === columnName);

  if (!hasColumn) {
    db.exec(alterSql);
  }
}

ensureColumnExists(
  "ticket_events",
  "payload_json",
  "ALTER TABLE ticket_events ADD COLUMN payload_json TEXT DEFAULT '{}'",
);
ensureColumnExists(
  "users",
  "supervisor_id",
  "ALTER TABLE users ADD COLUMN supervisor_id TEXT REFERENCES users(id)",
);
ensureColumnExists(
  "users",
  "password_hash",
  "ALTER TABLE users ADD COLUMN password_hash TEXT",
);
ensureColumnExists(
  "users",
  "title",
  "ALTER TABLE users ADD COLUMN title TEXT",
);
ensureColumnExists(
  "users",
  "phone",
  "ALTER TABLE users ADD COLUMN phone TEXT",
);
ensureColumnExists(
  "users",
  "is_active",
  "ALTER TABLE users ADD COLUMN is_active INTEGER DEFAULT 1",
);
ensureColumnExists(
  "users",
  "password_must_change",
  "ALTER TABLE users ADD COLUMN password_must_change INTEGER DEFAULT 0",
);
ensureColumnExists(
  "users",
  "last_login_at",
  "ALTER TABLE users ADD COLUMN last_login_at INTEGER",
);

// Day session allocation columns (clock-in reason tracking).
ensureColumnExists("day_sessions", "clock_in_reason", "ALTER TABLE day_sessions ADD COLUMN clock_in_reason TEXT");
ensureColumnExists("day_sessions", "allocation_type", "ALTER TABLE day_sessions ADD COLUMN allocation_type TEXT");
ensureColumnExists("day_sessions", "other_reason", "ALTER TABLE day_sessions ADD COLUMN other_reason TEXT");

// Area bounding box migrations
ensureColumnExists("areas", "bbox_north", "ALTER TABLE areas ADD COLUMN bbox_north REAL");
ensureColumnExists("areas", "bbox_south", "ALTER TABLE areas ADD COLUMN bbox_south REAL");
ensureColumnExists("areas", "bbox_east", "ALTER TABLE areas ADD COLUMN bbox_east REAL");
ensureColumnExists("areas", "bbox_west", "ALTER TABLE areas ADD COLUMN bbox_west REAL");
ensureColumnExists("areas", "center_lat", "ALTER TABLE areas ADD COLUMN center_lat REAL");
ensureColumnExists("areas", "center_lng", "ALTER TABLE areas ADD COLUMN center_lng REAL");
ensureColumnExists("areas", "color", "ALTER TABLE areas ADD COLUMN color TEXT DEFAULT '#3B82F6'");

// Users role CHECK migration — add DISTRICT_MANAGER if not present.
// SQLite can't ALTER a CHECK; rebuild the table in place.
(function migrateUsersRoleCheck() {
  const row = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='users'").get();
  if (!row?.sql || row.sql.includes('DISTRICT_MANAGER')) return;
  console.log('[Database] Migrating users.role CHECK to include DISTRICT_MANAGER');
  db.pragma('foreign_keys = OFF');
  const tx = db.transaction(() => {
    db.exec(`
      CREATE TABLE users_new (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        email TEXT NOT NULL UNIQUE,
        password_hash TEXT,
        role TEXT NOT NULL CHECK (role IN ('TRAINEE','TRAINER','TECH','SUPERVISOR','AREA_MANAGER','DISTRICT_MANAGER','MANAGER')),
        title TEXT,
        phone TEXT,
        area_id TEXT,
        supervisor_id TEXT,
        is_active INTEGER DEFAULT 1,
        password_must_change INTEGER DEFAULT 0,
        last_login_at INTEGER,
        created_at INTEGER DEFAULT (strftime('%s', 'now') * 1000),
        updated_at INTEGER DEFAULT (strftime('%s', 'now') * 1000),
        FOREIGN KEY (supervisor_id) REFERENCES users(id)
      );
      INSERT INTO users_new (id, name, email, password_hash, role, title, phone, area_id, supervisor_id, is_active, password_must_change, last_login_at, created_at, updated_at)
        SELECT id, name, email, password_hash, role, title, phone, area_id, supervisor_id, is_active, password_must_change, last_login_at, created_at, updated_at FROM users;
      DROP TABLE users;
      ALTER TABLE users_new RENAME TO users;
    `);
  });
  tx();
  db.pragma('foreign_keys = ON');
})();

// Ticket lineage migration (additive). See docs/linked-tickets-architecture.md.
ensureColumnExists(
  "tickets",
  "root_ticket_id",
  "ALTER TABLE tickets ADD COLUMN root_ticket_id TEXT",
);
ensureColumnExists(
  "tickets",
  "parent_ticket_id",
  "ALTER TABLE tickets ADD COLUMN parent_ticket_id TEXT",
);
ensureColumnExists(
  "tickets",
  "sequence_number",
  "ALTER TABLE tickets ADD COLUMN sequence_number INTEGER DEFAULT 1",
);
ensureColumnExists(
  "tickets",
  "external_root_number",
  "ALTER TABLE tickets ADD COLUMN external_root_number TEXT",
);

db.exec(`CREATE INDEX IF NOT EXISTS idx_tickets_root ON tickets(root_ticket_id)`);
db.exec(`CREATE INDEX IF NOT EXISTS idx_tickets_parent ON tickets(parent_ticket_id)`);
db.exec(`CREATE INDEX IF NOT EXISTS idx_tickets_ext_root ON tickets(external_root_number)`);

// Backfill pre-lineage rows as self-rooted originals. ticket_number is reused
// as external_root_number for pre-existing tickets so search remains stable.
db.exec(`UPDATE tickets SET root_ticket_id = id WHERE root_ticket_id IS NULL`);
db.exec(`UPDATE tickets SET sequence_number = 1 WHERE sequence_number IS NULL`);
db.exec(`UPDATE tickets SET external_root_number = ticket_number WHERE external_root_number IS NULL`);

// Add PENDING to locator_status CHECK so we can distinguish "awaiting tech
// assignment" from "assigned and ready for field work." SQLite can't ALTER
// a CHECK so we rebuild the table in place (same pattern as users role mig).
(function migrateTicketsLocatorCheck() {
  const row = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='tickets'").get();
  if (!row?.sql || row.sql.includes("'PENDING'")) return;
  console.log('[Database] Migrating tickets.locator_status CHECK to include PENDING');
  db.pragma('foreign_keys = OFF');
  const tx = db.transaction(() => {
    db.exec(`
      CREATE TABLE tickets_new (
        id TEXT PRIMARY KEY,
        external_ticket_id TEXT,
        ticket_number TEXT NOT NULL,
        ticket_type TEXT,
        address TEXT,
        lat REAL,
        lng REAL,
        status TEXT NOT NULL DEFAULT 'NEW' CHECK (status IN ('NEW', 'OPEN', 'ASSIGNED', 'IN_PROGRESS', 'COMPLETED', 'CLOSED')),
        locator_status TEXT NOT NULL DEFAULT 'PENDING' CHECK (locator_status IN ('PENDING', 'ASSIGNED', 'ENROUTE', 'ONSITE', 'PAUSED', 'CLOSED', 'UNABLE')),
        assigned_tech_id TEXT,
        version INTEGER DEFAULT 1,
        payload_json TEXT DEFAULT '{}',
        source TEXT DEFAULT '811',
        created_at INTEGER DEFAULT (strftime('%s', 'now') * 1000),
        updated_at INTEGER DEFAULT (strftime('%s', 'now') * 1000),
        due_at INTEGER,
        closed_by_name TEXT,
        closed_at INTEGER,
        last_811_sync_at INTEGER,
        root_ticket_id TEXT,
        parent_ticket_id TEXT,
        sequence_number INTEGER DEFAULT 1,
        external_root_number TEXT,
        district_territory_id TEXT,
        area_territory_id TEXT,
        supervisor_territory_id TEXT,
        tech_territory_id TEXT,
        FOREIGN KEY (assigned_tech_id) REFERENCES users(id)
      );
      INSERT INTO tickets_new (
        id, external_ticket_id, ticket_number, ticket_type, address,
        lat, lng, status, locator_status, assigned_tech_id, version,
        payload_json, source, created_at, updated_at, due_at,
        closed_by_name, closed_at, last_811_sync_at,
        root_ticket_id, parent_ticket_id, sequence_number, external_root_number,
        district_territory_id, area_territory_id, supervisor_territory_id, tech_territory_id
      )
      SELECT
        id, external_ticket_id, ticket_number, ticket_type, address,
        lat, lng, status, locator_status, assigned_tech_id, version,
        payload_json, source, created_at, updated_at, due_at,
        closed_by_name, closed_at, last_811_sync_at,
        root_ticket_id, parent_ticket_id, sequence_number, external_root_number,
        NULL, NULL, NULL, NULL
      FROM tickets;
      DROP TABLE tickets;
      ALTER TABLE tickets_new RENAME TO tickets;
    `);
    // Recreate indexes on the new table.
    db.exec(`CREATE INDEX IF NOT EXISTS idx_tickets_assigned_tech ON tickets(assigned_tech_id)`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_tickets_status ON tickets(status)`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_tickets_locator_status ON tickets(locator_status)`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_tickets_updated_at ON tickets(updated_at)`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_tickets_root ON tickets(root_ticket_id)`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_tickets_parent ON tickets(parent_ticket_id)`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_tickets_ext_root ON tickets(external_root_number)`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_tickets_district_territory ON tickets(district_territory_id)`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_tickets_area_territory ON tickets(area_territory_id)`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_tickets_supervisor_territory ON tickets(supervisor_territory_id)`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_tickets_tech_territory ON tickets(tech_territory_id)`);
  });
  tx();
  db.pragma('foreign_keys = ON');
})();

export function initDatabase() {
  console.log('[Database] SQLite database initialized with schema');

  // Note: Legacy 'areas' table kept for backward compatibility but no longer seeded with hardcoded data.
  // Use the new territory model with boundary_units for real geographic definitions.

  // --- Territory model (DISTRICT -> AREA -> SUPERVISOR_TERRITORY -> TECH_TERRITORY) ---
  ensureTerritorySchema(db);
  seedTerritoryTree(db);
  const tbf = backfillTicketTerritories(db);
  if (tbf.updated || tbf.unresolved) {
    console.log(`[Database] Territory backfill: ${tbf.updated} tickets resolved, ${tbf.unresolved} outside known tech territories`);
  }
  const uta = backfillUserTerritoryAssignments(db);
  if (uta.migrated) {
    console.log(`[Database] Migrated ${uta.migrated} legacy user->area rows into user_territory_assignments`);
  }

  // --- Boundary Units (real geographic data from GeoJSON) ---
  ensureBoundaryUnitSchema(db);
  const buResult = importTexasCitiesFromGeoJSON(db);
  if (buResult.imported > 0) {
    console.log(`[Database] Imported ${buResult.imported} boundary units from GeoJSON`);
  }

  return db;
}
