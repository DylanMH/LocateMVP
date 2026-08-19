import Database from "better-sqlite3";
import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { schemaSql } from "./schema.js";

const DATA_DIR = join(process.cwd(), "data");
const DB_PATH = join(DATA_DIR, "sim811.sqlite");

if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });

export const db = new Database(DB_PATH);
db.pragma("foreign_keys = ON");
db.exec(schemaSql);

// Additive migration: add ticket lineage columns to pre-existing DBs.
// Safe to run on every boot — PRAGMA table_info is cheap and ADD COLUMN is a no-op once applied.
function ensureColumn(table: string, column: string, alterSql: string) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  if (!cols.some((c) => c.name === column)) {
    db.exec(alterSql);
  }
}

ensureColumn("tickets_811", "root_ticket_id", "ALTER TABLE tickets_811 ADD COLUMN root_ticket_id TEXT");
ensureColumn("tickets_811", "parent_ticket_id", "ALTER TABLE tickets_811 ADD COLUMN parent_ticket_id TEXT");
ensureColumn("tickets_811", "sequence_number", "ALTER TABLE tickets_811 ADD COLUMN sequence_number INTEGER NOT NULL DEFAULT 1");
ensureColumn("tickets_811", "external_root_number", "ALTER TABLE tickets_811 ADD COLUMN external_root_number TEXT");
ensureColumn("tickets_811", "assigned_tech_name", "ALTER TABLE tickets_811 ADD COLUMN assigned_tech_name TEXT");
ensureColumn("tickets_811", "assigned_tech_id", "ALTER TABLE tickets_811 ADD COLUMN assigned_tech_id TEXT");
ensureColumn("tickets_811", "locator_status", "ALTER TABLE tickets_811 ADD COLUMN locator_status TEXT NOT NULL DEFAULT 'PENDING'");
ensureColumn("tickets_811", "original_due_at", "ALTER TABLE tickets_811 ADD COLUMN original_due_at INTEGER");

db.exec(`CREATE INDEX IF NOT EXISTS idx_tickets_root ON tickets_811(root_ticket_id)`);
db.exec(`CREATE INDEX IF NOT EXISTS idx_tickets_parent ON tickets_811(parent_ticket_id)`);
db.exec(`CREATE INDEX IF NOT EXISTS idx_tickets_ext_root ON tickets_811(external_root_number)`);

// Backfill pre-lineage rows as self-rooted originals (sequence_number = 1).
// ticket_number is the 811 "base" number for pre-existing rows, so reuse it as external_root_number.
db.exec(`
  UPDATE tickets_811
  SET root_ticket_id = id
  WHERE root_ticket_id IS NULL
`);
db.exec(`
  UPDATE tickets_811
  SET external_root_number = ticket_number
  WHERE external_root_number IS NULL
`);