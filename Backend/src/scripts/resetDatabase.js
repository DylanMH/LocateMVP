/**
 * Reset database by deleting the database.json file
 * This will force the server to regenerate fresh tickets with the new structure
 */

import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { existsSync, unlinkSync } from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const DATA_DIR = join(__dirname, '../../data');
const DB_FILE = join(DATA_DIR, 'database.json');

console.log('[Reset] Checking for database file...');

if (existsSync(DB_FILE)) {
  unlinkSync(DB_FILE);
  console.log('[Reset] ✅ Database file deleted:', DB_FILE);
  console.log('[Reset] Server will regenerate fresh tickets on next start');
} else {
  console.log('[Reset] ℹ️  No database file found - already clean');
}

console.log('[Reset] Done!');
