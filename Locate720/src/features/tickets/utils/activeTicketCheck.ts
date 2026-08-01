import { database } from '../../../db/database';
import Ticket from '../../../db/models/Ticket';
import { Q } from '@nozbe/watermelondb';

/**
 * Check if user has any tickets in ENROUTE or ONSITE status
 * Returns the active ticket if found, null otherwise
 */
export async function getActiveTicket(currentUserId: string, excludeTicketId?: string): Promise<Ticket | null> {
  const ticketsCollection = database.collections.get<Ticket>('tickets');
  
  const query = [
    Q.where('assigned_tech_id', currentUserId),
    Q.or(
      Q.where('locator_status', 'ENROUTE'),
      Q.where('locator_status', 'ONSITE')
    ),
  ];
  
  // Exclude the current ticket if provided
  if (excludeTicketId) {
    query.push(Q.where('id', Q.notEq(excludeTicketId)));
  }
  
  const activeTickets = await ticketsCollection.query(...query).fetch();
  
  return activeTickets.length > 0 ? activeTickets[0] : null;
}
