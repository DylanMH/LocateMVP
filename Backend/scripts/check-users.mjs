import { initDatabase } from "../src/db/database-sqlite.js";
const db = initDatabase();

const sample = db.prepare("SELECT id, name, email, role, password_hash IS NOT NULL as has_pw FROM users LIMIT 10").all();
console.log("Sample users:");
console.log(JSON.stringify(sample, null, 2));

const counts = db.prepare("SELECT role, COUNT(*) as c, SUM(CASE WHEN password_hash IS NOT NULL THEN 1 ELSE 0 END) as with_pw FROM users GROUP BY role").all();
console.log("\nUsers by role:");
console.log(JSON.stringify(counts, null, 2));

const noPw = db.prepare("SELECT id, name, email, role FROM users WHERE password_hash IS NULL OR password_hash = '' LIMIT 10").all();
console.log("\nUsers without password:");
console.log(JSON.stringify(noPw, null, 2));

process.exit(0);
