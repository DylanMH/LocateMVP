/**
 * Backfill: notify the 811 simulator of all existing ticket assignments
 * in the backend. Run once after deploying the assignment notification feature.
 *
 * Run from the Backend directory:
 *   node scripts/backfill-sim-assignments.mjs
 */
import { initDatabase } from "../src/db/database-sqlite.js";

const db = initDatabase();
const SIMULATOR_URL = process.env.SIMULATOR_URL || 'http://localhost:4100';

async function main() {
  const tickets = db.prepare(`
    SELECT t.id, t.external_ticket_id, t.assigned_tech_id, t.locator_status, u.name as tech_name
    FROM tickets t
    LEFT JOIN users u ON u.id = t.assigned_tech_id
    WHERE t.assigned_tech_id IS NOT NULL
      AND t.source = '811'
      AND t.external_ticket_id IS NOT NULL
      AND t.locator_status NOT IN ('CLOSED','UNABLE')
  `).all();

  console.log(`[backfill] Found ${tickets.length} assigned 811 tickets to notify simulator about`);

  let success = 0;
  let failed = 0;

  for (const t of tickets) {
    try {
      const response = await fetch(
        `${SIMULATOR_URL}/api/811/tickets/${t.external_ticket_id}/assign`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            techId: t.assigned_tech_id,
            techName: t.tech_name || 'Unknown',
            locatorStatus: t.locator_status || 'ASSIGNED',
          }),
        },
      );
      if (response.ok) {
        success++;
      } else {
        failed++;
        if (failed <= 5) console.error(`[backfill] Failed for ${t.id}: ${response.status}`);
      }
    } catch (err) {
      failed++;
      if (failed <= 5) console.error(`[backfill] Error for ${t.id}: ${err.message}`);
    }
  }

  console.log(`[backfill] Done: ${success} success, ${failed} failed`);
  process.exit(0);
}

main().catch((err) => {
  console.error('[backfill] Fatal error:', err);
  process.exit(1);
});
