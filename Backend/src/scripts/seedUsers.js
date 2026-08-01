import { initDatabase } from '../db/database.js';
import { v4 as uuidv4 } from 'uuid';

const db = initDatabase();

const SAMPLE_USERS = [
  { name: 'John Smith', email: 'john.smith@locate720.com', role: 'TECH' },
  { name: 'Sarah Johnson', email: 'sarah.johnson@locate720.com', role: 'TECH' },
  { name: 'Mike Williams', email: 'mike.williams@locate720.com', role: 'TECH' },
  { name: 'Emily Davis', email: 'emily.davis@locate720.com', role: 'SUPERVISOR' },
  { name: 'David Brown', email: 'david.brown@locate720.com', role: 'MANAGER' },
];

console.log('[Seed] Creating sample users...');

const insertStmt = db.prepare(`
  INSERT OR IGNORE INTO users (id, name, email, role, created_at)
  VALUES (?, ?, ?, ?, ?)
`);

const now = Date.now();

for (const user of SAMPLE_USERS) {
  const userId = `user-${uuidv4()}`;
  insertStmt.run(userId, user.name, user.email, user.role, now);
  console.log(`[Seed] Created ${user.role}: ${user.name}`);
}

console.log('[Seed] Users seeded successfully');

db.close();
