export const schemaSql = `
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS service_areas (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  center_lat REAL NOT NULL,
  center_lng REAL NOT NULL,
  lat_min REAL NOT NULL,
  lat_max REAL NOT NULL,
  lng_min REAL NOT NULL,
  lng_max REAL NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS tickets_811 (
  id TEXT PRIMARY KEY,
  ticket_number TEXT NOT NULL UNIQUE,
  ticket_type TEXT NOT NULL,
  status TEXT NOT NULL,
  version INTEGER NOT NULL,
  area_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  due_at INTEGER NOT NULL,
  address_line1 TEXT NOT NULL,
  city TEXT NOT NULL,
  state TEXT NOT NULL,
  zip TEXT NOT NULL,
  lat REAL NOT NULL,
  lng REAL NOT NULL,
  work_type TEXT NOT NULL,
  marking_instructions TEXT NOT NULL,
  contractor_name TEXT NOT NULL,
  contractor_phone TEXT NOT NULL,
  contact_name TEXT NOT NULL,
  contact_email TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  FOREIGN KEY(area_id) REFERENCES service_areas(id)
);

CREATE INDEX IF NOT EXISTS idx_tickets_area ON tickets_811(area_id);
CREATE INDEX IF NOT EXISTS idx_tickets_updated ON tickets_811(updated_at);
-- Lineage columns (root_ticket_id, parent_ticket_id, sequence_number,
-- external_root_number) and their indexes are added in db.ts via
-- ensureColumn() so that pre-existing DBs upgrade cleanly. See
-- docs/linked-tickets-architecture.md.

CREATE TABLE IF NOT EXISTS ticket_members_811 (
  id TEXT PRIMARY KEY,
  ticket_id TEXT NOT NULL,
  member_code TEXT NOT NULL,
  utility_type TEXT NOT NULL,
  company_name TEXT NOT NULL,
  status TEXT NOT NULL,
  response_code TEXT,
  responded_at INTEGER,
  notes TEXT,
  FOREIGN KEY(ticket_id) REFERENCES tickets_811(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_members_ticket ON ticket_members_811(ticket_id);
CREATE INDEX IF NOT EXISTS idx_members_code ON ticket_members_811(member_code);

CREATE TABLE IF NOT EXISTS ticket_event_log_811 (
  id TEXT PRIMARY KEY,
  ticket_id TEXT NOT NULL,
  type TEXT NOT NULL,
  occurred_at INTEGER NOT NULL,
  payload_json TEXT NOT NULL,
  FOREIGN KEY(ticket_id) REFERENCES tickets_811(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_log_ticket ON ticket_event_log_811(ticket_id);
`;
