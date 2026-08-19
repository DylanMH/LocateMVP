/**
 * Contractor Email Service
 *
 * Manages the contractor email queue for rescheduling notifications.
 * In production, this would use a real SMTP transport. In development,
 * it logs the email content instead of sending it.
 *
 * The queue is processed periodically by processEmailQueue().
 */

const MAX_EMAIL_RETRIES = 5;

/**
 * Queue a contractor email for sending.
 * @param {Object} db - Database instance
 * @param {Object} email - { ticketId, contractorEmail, subject, body }
 */
export function queueContractorEmail(db, email) {
  const { ticketId, contractorEmail, subject, body } = email;
  const id = `email-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

  db.prepare(`
    INSERT INTO contractor_email_queue (
      id, ticket_id, contractor_email, subject, body, status, retry_count, created_at
    ) VALUES (?, ?, ?, ?, ?, 'PENDING', 0, ?)
  `).run(id, ticketId, contractorEmail, subject, body, Date.now());

  console.log(`[EmailQueue] Queued email to ${contractorEmail} for ticket ${ticketId}`);
  return id;
}

/**
 * Process pending contractor emails.
 * In development, logs the email. In production, would use SMTP.
 * @param {Object} db - Database instance
 */
export async function processEmailQueue(db) {
  const pending = db.prepare(`
    SELECT * FROM contractor_email_queue
    WHERE status = 'PENDING'
    ORDER BY created_at ASC
    LIMIT 10
  `).all();

  if (pending.length === 0) {
    return { processed: 0, errors: [] };
  }

  const results = { processed: 0, errors: [] };

  for (const email of pending) {
    try {
      // In development, log the email. In production, this would call
      // an SMTP transport (nodemailer, SendGrid, etc.).
      console.log(`[EmailQueue] Sending email:`);
      console.log(`  To: ${email.contractor_email}`);
      console.log(`  Subject: ${email.subject}`);
      console.log(`  Body: ${email.body.substring(0, 200)}...`);

      // Mark as sent
      db.prepare(`
        UPDATE contractor_email_queue
        SET status = 'SENT', sent_at = ?
        WHERE id = ?
      `).run(Date.now(), email.id);

      results.processed++;
    } catch (error) {
      const newRetryCount = email.retry_count + 1;

      if (newRetryCount >= MAX_EMAIL_RETRIES) {
        db.prepare(`
          UPDATE contractor_email_queue
          SET status = 'FAILED', retry_count = ?, error_message = ?
          WHERE id = ?
        `).run(newRetryCount, error.message, email.id);
        results.errors.push(`Failed to send email ${email.id}: ${error.message}`);
      } else {
        db.prepare(`
          UPDATE contractor_email_queue
          SET retry_count = ?, error_message = ?
          WHERE id = ?
        `).run(newRetryCount, error.message, email.id);
      }
    }
  }

  return results;
}

/**
 * Get email queue status for a ticket.
 * @param {Object} db - Database instance
 * @param {string} ticketId
 */
export function getEmailsForTicket(db, ticketId) {
  return db.prepare(`
    SELECT * FROM contractor_email_queue
    WHERE ticket_id = ?
    ORDER BY created_at DESC
  `).all(ticketId);
}
