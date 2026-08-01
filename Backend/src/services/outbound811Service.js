/**
 * Outbound 811 Service
 * Handles sending ticket closure/status updates from L720 to 811 Simulator
 * Uses outbox pattern for reliable delivery with retries
 */

const SIMULATOR_URL = process.env.SIMULATOR_URL || 'http://localhost:4100';

/**
 * Queue an outbound event to 811
 * @param {Object} db - Database instance
 * @param {Object} event - Event data
 */
export function queueOutbound811Event(db, event) {
  const {
    ticketId,
    externalTicketId,
    eventType,
    payload,
    priority = 1
  } = event;

  const insertStmt = db.prepare(`
    INSERT INTO outbox_811_events (
      id, ticket_id, external_ticket_id, event_type, member_code, response_code, notes, status, retry_count, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const eventId = `out811-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  
  insertStmt.run(
    eventId,
    ticketId,
    externalTicketId,
    eventType,
    payload?.memberCode || '',
    payload?.responseCode || '',
    payload?.notes || '',
    'PENDING',
    0,
    Date.now()
  );

  console.log(`[Outbound811] Queued ${eventType} for ticket ${ticketId} -> 811 ticket ${externalTicketId}`);
  return eventId;
}

/**
 * Process pending outbound 811 events
 * @param {Object} db - Database instance
 */
export async function processOutbound811Events(db) {
  const pendingEvents = db.prepare(`
    SELECT * FROM outbox_811_events 
    WHERE status = 'PENDING' 
    ORDER BY created_at ASC
    LIMIT 10
  `).all();

  console.log(`[Outbound811] Found ${pendingEvents.length} pending events`);
  
  if (pendingEvents.length === 0) {
    return { processed: 0, errors: [] };
  }

  console.log(`[Outbound811] Processing ${pendingEvents.length} pending events`);

  const results = { processed: 0, errors: [] };

  for (const event of pendingEvents) {
    try {
      // Build payload from the actual table columns
      const payload = {
        memberCode: event.member_code,
        responseCode: event.response_code,
        notes: event.notes
      };
      
      if (event.event_type === 'TICKET_CLOSED') {
        await sendTicketClosureTo811(event.external_ticket_id, payload);
      } else if (event.event_type === 'TICKET_STATUS_UPDATE') {
        await sendStatusUpdateTo811(event.external_ticket_id, payload);
      }

      // Mark as completed
      db.prepare(`
        UPDATE outbox_811_events 
        SET status = 'SENT', sent_at = ?
        WHERE id = ?
      `).run(Date.now(), event.id);

      results.processed++;
      console.log(`[Outbound811] ✅ Sent ${event.event_type} for 811 ticket ${event.external_ticket_id}`);

    } catch (error) {
      // Handle retry logic
      const newRetryCount = event.retry_count + 1;
      const maxRetries = 5;

      console.error(`[Outbound811] Error details:`, error.message);
      console.error(`[Outbound811] Error stack:`, error.stack);
      if (error.response) {
        console.error(`[Outbound811] Fetch error response:`, error.response);
        console.error(`[Outbound811] Fetch error status:`, error.response.status);
      }

      if (newRetryCount >= maxRetries) {
        // Mark as failed
        db.prepare(`
          UPDATE outbox_811_events 
          SET status = 'FAILED', retry_count = ?
          WHERE id = ?
        `).run(newRetryCount, event.id);
        
        results.errors.push(`Failed to send ${event.event_type} for ${event.ticket_id}: ${error.message}`);
        console.error(`[Outbound811] Failed permanently for ${event.id}:`, error.message);
      } else if (error.nonRetryable) {
        db.prepare(`
          UPDATE outbox_811_events 
          SET status = 'FAILED', retry_count = ?
          WHERE id = ?
        `).run(newRetryCount, event.id);

        results.errors.push(`Non-retryable ${event.event_type} failure for ${event.ticket_id}: ${error.message}`);
        console.error(
          `[Outbound811] Marked ${event.id} as FAILED without retry because the 811 API returned ${error.statusCode}`,
        );
      } else {
        // Update retry count and keep pending
        db.prepare(`
          UPDATE outbox_811_events 
          SET retry_count = ?
          WHERE id = ?
        `).run(newRetryCount, event.id);
        
        console.error(`[Outbound811] Retry ${newRetryCount}/${maxRetries} for ${event.id}:`, error.message);
      }
    }
  }

  return results;
}

/**
 * Send ticket closure to 811 Simulator
 * @param {string} externalTicketId - 811 ticket ID
 * @param {Object} payload - Closure payload
 */
async function sendTicketClosureTo811(externalTicketId, payload) {
  const response = await fetch(`${SIMULATOR_URL}/api/811/tickets/${externalTicketId}/close`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      closedByName: payload.closedByName || 'L720 Technician',
      customerMarkings: payload.customerMarkings || {},
      closedAt: payload.closedAt || Date.now()
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    const error = new Error(`811 API error: ${response.status} ${response.statusText} - ${errorText}`);
    error.statusCode = response.status;
    error.nonRetryable = response.status >= 400 && response.status < 500;
    throw error;
  }

  const result = await response.json();
  console.log(`[Outbound811] 811 acknowledged closure for ${externalTicketId}:`, result);
  return result;
}

/**
 * Send status update to 811 Simulator
 * @param {string} externalTicketId - 811 ticket ID  
 * @param {Object} payload - Status payload
 */
async function sendStatusUpdateTo811(externalTicketId, payload) {
  // For now, 811 Simulator only handles closures
  // Status updates could be implemented later if needed
  console.log(`[Outbound811] Status update not implemented for 811 ticket ${externalTicketId}:`, payload);
}

/**
 * Check if ticket is from 811 and queue closure event
 * @param {Object} db - Database instance
 * @param {string} ticketId - L720 ticket ID
 * @param {Object} closureData - Closure information
 */
export function handleTicketClosure(db, ticketId, closureData) {
  // Get ticket to check if it's from 811
  const ticket = db.prepare('SELECT * FROM tickets WHERE id = ?').get(ticketId);
  
  if (!ticket || ticket.source !== '811' || !ticket.external_ticket_id) {
    console.log(`[Outbound811] Ticket ${ticketId} not from 811, skipping outbound`);
    return null;
  }

  // Queue outbound closure event
  return queueOutbound811Event(db, {
    ticketId,
    externalTicketId: ticket.external_ticket_id,
    eventType: 'TICKET_CLOSED',
    payload: {
      ...closureData,
      l720TicketId: ticketId,
      closedAt: Date.now()
    }
  });
}
