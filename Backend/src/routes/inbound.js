import express from 'express';
import { db } from '../server.js';
import { pullTicketsFrom811, getLast811SyncTimestamp } from '../services/ingestionService.js';
import { assignUnassignedTickets, getAssignmentStats } from '../services/assignmentService.js';

const router = express.Router();

/**
 * POST /api/inbound/811/pull
 * Pull new/updated tickets from 811 Simulator
 * Query params:
 *   - since: timestamp in milliseconds (optional, defaults to last sync)
 *   - assign: boolean (optional, defaults to true) - whether to auto-assign tickets
 *   - reconcileMissing: boolean (optional, defaults to false) - when true, performs a full-source reconcile and deletes backend tickets no longer present in 811
 */
router.post('/811/pull', async (req, res) => {
  try {
    const {
      since,
      assign = true,
      reconcileMissing = false,
    } = typeof req.body === 'object' ? req.body : {};
    
    // Determine since timestamp
    let sinceTimestamp = since;
    if (reconcileMissing) {
      sinceTimestamp = 0;
    } else if (!sinceTimestamp) {
      sinceTimestamp = getLast811SyncTimestamp(db);
    }

    console.log(`[Inbound] Starting 811 pull since ${new Date(sinceTimestamp).toISOString()}`);

    // Pull tickets from 811
    const pullResults = await pullTicketsFrom811(db, sinceTimestamp, {
      reconcileMissing,
    });

    // Auto-assign unassigned tickets if requested
    let assignmentResults = { assigned: 0, errors: [] };
    if (assign && pullResults.ingested > 0) {
      assignmentResults = assignUnassignedTickets(db);
    }

    res.json({
      success: true,
      pull: pullResults,
      assignment: assignmentResults,
      serverTime: Date.now(),
      message: reconcileMissing
        ? `Reconciled 811 source: ${pullResults.ingested} new, ${pullResults.updated} updated, ${pullResults.reconciledRemoved} removed`
        : `Pulled ${pullResults.ingested} new, ${pullResults.updated} updated tickets`
    });

  } catch (error) {
    console.error('[Inbound] Pull failed:', error.message);
    res.status(500).json({
      success: false,
      error: error.message,
      message: 'Failed to pull tickets from 811 Simulator'
    });
  }
});

/**
 * GET /api/inbound/811/status
 * Get ingestion status and statistics
 */
router.get('/811/status', (req, res) => {
  try {
    // Get basic stats
    const totalTickets = db.prepare("SELECT COUNT(*) as count FROM tickets WHERE source = '811'").get().count;
    const lastSync = getLast811SyncTimestamp(db);
    
    // Get assignment stats
    const assignmentStats = getAssignmentStats(db);

    // Get recent tickets
    const recentTickets = db.prepare(`
      SELECT id, ticket_number, status, locator_status, assigned_tech_id, created_at
      FROM tickets 
      WHERE source = '811'
      ORDER BY created_at DESC
      LIMIT 10
    `).all();

    res.json({
      success: true,
      status: {
        total811Tickets: totalTickets,
        last811Sync: lastSync,
        lastSyncTime: lastSync ? new Date(lastSync).toISOString() : null,
        assignmentStats,
        recentTickets: recentTickets.map(t => ({
          ...t,
          created_at: new Date(t.created_at).toISOString()
        }))
      }
    });

  } catch (error) {
    console.error('[Inbound] Status check failed:', error.message);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * POST /api/inbound/811/assign
 * Manually trigger assignment for unassigned tickets
 */
router.post('/811/assign', (req, res) => {
  try {
    console.log('[Inbound] Manual assignment triggered');
    
    const results = assignUnassignedTickets(db);
    
    res.json({
      success: true,
      results,
      message: `Assigned ${results.assigned} tickets`
    });

  } catch (error) {
    console.error('[Inbound] Manual assignment failed:', error.message);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * POST /api/inbound/811/reset
 * Reset all 811 tickets (for testing/dev only)
 */
router.post('/811/reset', (req, res) => {
  try {
    console.log('[Inbound] Resetting all 811 tickets');

    const ticketsToDelete = db.prepare(`
      SELECT id
      FROM tickets
      WHERE source = '811'
    `).all();

    const deleteTicketEvents = db.prepare(`
      DELETE FROM ticket_events
      WHERE ticket_id = ?
    `);
    const deleteOutboundEvents = db.prepare(`
      DELETE FROM outbox_811_events
      WHERE ticket_id = ?
    `);
    const deleteClockEvents = db.prepare(`
      DELETE FROM clock_events
      WHERE ticket_id = ?
    `);
    const clearClockOutTicketReferences = db.prepare(`
      UPDATE day_sessions
      SET clock_out_ticket_id = NULL
      WHERE clock_out_ticket_id = ?
    `);
    const deleteUtilityProduction = db.prepare(`
      DELETE FROM utility_production_ledger
      WHERE ticket_id = ?
    `);
    const deleteTicket = db.prepare(`
      DELETE FROM tickets
      WHERE id = ?
    `);

    const deletedCount = db.transaction((ticketRows) => {
      let count = 0;

      for (const ticket of ticketRows) {
        deleteTicketEvents.run(ticket.id);
        deleteOutboundEvents.run(ticket.id);
        deleteClockEvents.run(ticket.id);
        clearClockOutTicketReferences.run(ticket.id);
        deleteUtilityProduction.run(ticket.id);
        deleteTicket.run(ticket.id);
        count += 1;
      }

      return count;
    })(ticketsToDelete);
    
    console.log(`[Inbound] Deleted ${deletedCount} 811 tickets`);
    
    res.json({
      success: true,
      deleted: deletedCount,
      message: `Reset complete: deleted ${deletedCount} tickets`
    });

  } catch (error) {
    console.error('[Inbound] Reset failed:', error.message);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

export default router;
