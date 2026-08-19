/**
 * Reset database by deleting the SQLite database file.
 * This will force the server to regenerate a fresh database on next start.
 */

import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { existsSync, unlinkSync } from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const DATA_DIR = join(__dirname, '../../data');
const DB_FILE = join(DATA_DIR, 'locate720.db');

console.log('[Reset] Checking for database file...');

if (existsSync(DB_FILE)) {
  unlinkSync(DB_FILE);
  console.log('[Reset] ✅ Database file deleted:', DB_FILE);
  console.log('[Reset] Server will regenerate fresh database on next start');
} else {
  console.log('[Reset] ℹ️  No database file found - already clean');
}

// Also clean up the legacy JSON file if it exists (from the old database.js stub)
const LEGACY_DB_FILE = join(DATA_DIR, 'database.json');
if (existsSync(LEGACY_DB_FILE)) {
  unlinkSync(LEGACY_DB_FILE);
  console.log('[Reset] ✅ Legacy database.json deleted');
}

console.log('[Reset] Done!');
