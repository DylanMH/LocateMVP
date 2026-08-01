/**
 * Cleanup script:
 * 1. Hard-delete all archived users (is_active = 0)
 * 2. Assign all areas to Dylan (MANAGER)
 *
 * Run with: node scripts/cleanup-and-assign-areas.js
 */

import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dbPath = path.join(__dirname, '..', 'data', 'locate720.db');

console.log('Opening database at:', dbPath);
const db = new Database(dbPath);

db.pragma('foreign_keys = OFF');

async function main() {
  console.log('=== Cleanup & Area Assignment ===\n');

  // Step 1: Show current state
  const allUsers = db.prepare('SELECT id, name, email, role, is_active FROM users').all();
  console.log(`Found ${allUsers.length} users total:`);
  allUsers.forEach(u => {
    const status = u.is_active ? 'ACTIVE' : 'INACTIVE';
    console.log(`  [${status}] ${u.name} (${u.email}) - ${u.role}`);
  });

  // Step 2: Hard-delete archived users
  console.log('\n--- Deleting archived users ---');
  const archivedUsers = db.prepare('SELECT id, name FROM users WHERE is_active = 0').all();

  if (archivedUsers.length > 0) {
    // Clean up references first
    // Null out supervisor_id on any active user pointing to archived
    for (const user of archivedUsers) {
      db.prepare('UPDATE users SET supervisor_id = NULL WHERE supervisor_id = ?').run(user.id);
      db.prepare('UPDATE areas SET manager_id = NULL WHERE manager_id = ?').run(user.id);
      db.prepare('UPDATE tickets SET assigned_tech_id = NULL WHERE assigned_tech_id = ?').run(user.id);
      db.prepare('DELETE FROM user_areas WHERE user_id = ?').run(user.id);
    }

    const deleteStmt = db.prepare('DELETE FROM users WHERE is_active = 0');
    const deleted = deleteStmt.run();
    console.log(`Deleted ${deleted.changes} archived users`);
  } else {
    console.log('No archived users to delete');
  }

  // Step 3: Find Dylan
  const dylan = db.prepare("SELECT id, name FROM users WHERE email = 'dylan@locate720.com' AND is_active = 1").get();
  if (!dylan) {
    console.log('\nERROR: Dylan Houston not found! Skipping area assignment.');
    return;
  }

  console.log(`\n--- Assigning all areas to ${dylan.name} (${dylan.id}) ---`);

  const allAreas = db.prepare('SELECT id, name FROM areas WHERE active = 1').all();
  console.log(`Found ${allAreas.length} active areas`);

  const insertUserArea = db.prepare(`
    INSERT INTO user_areas (user_id, area_id, assigned_by, assigned_at)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(user_id, area_id) DO NOTHING
  `);

  const now = Date.now();
  let assigned = 0;
  for (const area of allAreas) {
    const result = insertUserArea.run(dylan.id, area.id, dylan.id, now);
    if (result.changes > 0) {
      assigned++;
      console.log(`  + ${area.name}`);
    } else {
      console.log(`  = ${area.name} (already assigned)`);
    }
  }
  console.log(`Assigned ${assigned} new areas to Dylan`);

  // Step 4: Verify
  console.log('\n--- Final State ---');
  const finalUsers = db.prepare('SELECT id, name, email, role FROM users').all();
  console.log(`Users (${finalUsers.length}):`);
  finalUsers.forEach(u => console.log(`  - ${u.name} (${u.email}) - ${u.role}`));

  const dylanAreas = db.prepare(`
    SELECT a.id, a.name FROM areas a
    INNER JOIN user_areas ua ON ua.area_id = a.id
    WHERE ua.user_id = ?
    ORDER BY a.name
  `).all(dylan.id);
  console.log(`\nDylan's areas (${dylanAreas.length}):`);
  dylanAreas.forEach(a => console.log(`  - ${a.name}`));

  console.log('\n=== Done ===');

  db.pragma('foreign_keys = ON');
  db.close();
}

main().catch(err => {
  console.error('Error:', err);
  db.close();
  process.exit(1);
});
