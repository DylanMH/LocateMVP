/**
 * Utility to clear all tickets from local database
 * Use this during development to remove old seeded data
 * and start fresh with backend-generated tickets only
 */

import { Q } from '@nozbe/watermelondb';
import { database } from './database';
import Ticket from './models/Ticket';
import OutboxEvent from './models/OutboxEvent';

/**
 * Clear all tickets and related outbox events from local database
 * This removes any old seeded tickets that don't match backend IDs
 */
export async function clearAllTickets(): Promise<void> {
  console.log('[ClearTickets] Clearing all local tickets and outbox events...');
  
  try {
    await database.write(async () => {
      // Clear all tickets
      const ticketsCollection = database.collections.get<Ticket>('tickets');
      const allTickets = await ticketsCollection.query().fetch();
      
      for (const ticket of allTickets) {
        await ticket.destroyPermanently();
      }
      
      console.log(`[ClearTickets] Deleted ${allTickets.length} tickets`);
      
      // Clear all outbox events (they reference old ticket IDs)
      const outboxCollection = database.collections.get<OutboxEvent>('outbox_events');
      const allEvents = await outboxCollection.query().fetch();
      
      for (const event of allEvents) {
        await event.destroyPermanently();
      }
      
      console.log(`[ClearTickets] Deleted ${allEvents.length} outbox events`);
    });
    
    console.log('[ClearTickets] ✅ Database cleared successfully');
    console.log('[ClearTickets] Pull from backend to get fresh tickets');
  } catch (error) {
    console.error('[ClearTickets] Failed to clear database:', error);
    throw error;
  }
}

/**
 * Check if database has any tickets
 */
export async function hasTickets(): Promise<boolean> {
  const ticketsCollection = database.collections.get<Ticket>('tickets');
  const count = await ticketsCollection.query().fetchCount();
  return count > 0;
}

/**
 * Get ticket count and sample IDs for debugging
 */
export async function getTicketInfo(): Promise<{
  count: number;
  sampleIds: string[];
}> {
  const ticketsCollection = database.collections.get<Ticket>('tickets');
  const tickets = await ticketsCollection.query(Q.take(5)).fetch();
  
  return {
    count: await ticketsCollection.query().fetchCount(),
    sampleIds: tickets.map(t => t.id),
  };
}

/**
 * FORCE clear all tickets (for duplicate cleanup)
 * This removes ALL tickets regardless of ID format
 */
export async function forceClearAllTickets(): Promise<void> {
  console.log('[ForceClear] Removing ALL tickets from local database...');
  
  try {
    const info = await getTicketInfo();
    console.log(`[ForceClear] Found ${info.count} tickets to remove`);
    
    await clearAllTickets();
    
    const afterInfo = await getTicketInfo();
    console.log(`[ForceClear] ✅ Cleared! Remaining: ${afterInfo.count} tickets`);
  } catch (error) {
    console.error('[ForceClear] Failed:', error);
    throw error;
  }
}
