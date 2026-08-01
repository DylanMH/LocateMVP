/**
 * Script to reset all users and create a master user
 * Run with: node scripts/reset-users-and-create-master.js
 */

import Database from 'better-sqlite3';
import { v4 as uuidv4 } from 'uuid';
import bcrypt from 'bcryptjs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dbPath = path.join(__dirname, '..', 'data', 'locate720.db');

console.log('Opening database at:', dbPath);
const db = new Database(dbPath);

// Disable foreign keys temporarily
db.pragma('foreign_keys = OFF');

const MASTER_USER = {
  name: 'Dylan Houston',
  email: 'dylan@locate720.com',
  password: 'admin123',
  role: 'MANAGER',
  title: 'System Administrator',
};

async function main() {
  console.log('=== Resetting Users and Creating Master ===\n');

  // Step 1: Get all existing users
  const existingUsers = db.prepare('SELECT id, name, email, role, is_active FROM users').all();
  console.log(`Found ${existingUsers.length} existing users:`);
  existingUsers.forEach(u => console.log(`  - ${u.name} (${u.email}) [${u.role}] ${u.is_active ? 'ACTIVE' : 'INACTIVE'}`));

  // Step 2: Archive (deactivate) all existing users
  console.log('\n--- Archiving existing users ---');

  // Update each user individually to handle email uniqueness
  const updateStmt = db.prepare('UPDATE users SET is_active = 0, email = ? WHERE id = ?');
  let archivedCount = 0;

  for (const user of existingUsers) {
    if (user.is_active) {
      const newEmail = `${user.email}.archived.${user.id}`;
      try {
        updateStmt.run(newEmail, user.id);
        archivedCount++;
      } catch (e) {
        console.log(`  Warning: Could not archive ${user.name}: ${e.message}`);
      }
    }
  }

  console.log(`Archived ${archivedCount} users`);

  // Step 3: Create master user
  console.log('\n--- Creating master user ---');

  // Check if master email already exists (maybe from a previous run)
  const existingMaster = db.prepare('SELECT * FROM users WHERE email = ?').get(MASTER_USER.email);
  if (existingMaster) {
    console.log(`Master user ${MASTER_USER.email} already exists, reactivating...`);
    const passwordHash = await bcrypt.hash(MASTER_USER.password, 10);
    db.prepare(`
      UPDATE users
      SET name = ?, password_hash = ?, role = ?, title = ?, is_active = 1, password_must_change = 1, supervisor_id = NULL
      WHERE email = ?
    `).run(MASTER_USER.name, passwordHash, MASTER_USER.role, MASTER_USER.title, MASTER_USER.email);
    console.log(`Master user reactivated!`);
  } else {
    // Create new master user
    const userId = `user-${uuidv4()}`;
    const now = Date.now();
    const passwordHash = await bcrypt.hash(MASTER_USER.password, 10);

    db.prepare(`
      INSERT INTO users (id, name, email, password_hash, role, title, is_active, password_must_change, created_at, area_id, supervisor_id)
      VALUES (?, ?, ?, ?, ?, ?, 1, 1, ?, NULL, NULL)
    `).run(userId, MASTER_USER.name, MASTER_USER.email, passwordHash, MASTER_USER.role, MASTER_USER.title, now);

    console.log(`Master user created!`);
    console.log(`  ID: ${userId}`);
    console.log(`  Name: ${MASTER_USER.name}`);
    console.log(`  Email: ${MASTER_USER.email}`);
    console.log(`  Role: ${MASTER_USER.role}`);
    console.log(`  Password: ${MASTER_USER.password} (must change on first login)`);
  }

  // Step 4: Verify
  console.log('\n--- Verification ---');
  const allUsers = db.prepare('SELECT id, name, email, role, is_active FROM users').all();
  console.log(`Total users in database: ${allUsers.length}`);
  allUsers.forEach(u => {
    const status = u.is_active ? 'ACTIVE' : 'INACTIVE';
    console.log(`  [${status}] ${u.name} (${u.email}) - ${u.role}`);
  });

  console.log('\n=== Done ===');
  console.log('\nYou can now log in with:');
  console.log(`  Email: ${MASTER_USER.email}`);
  console.log(`  Password: ${MASTER_USER.password}`);
  console.log('\nMake sure to change the password after first login!');

  // Re-enable foreign keys
  db.pragma('foreign_keys = ON');
  db.close();
}

main().catch(err => {
  console.error('Error:', err);
  db.close();
  process.exit(1);
});
