import Ticket from '../../../db/models/Ticket';

/**
 * Sophisticated ticket sorting with priority order:
 * 1. ONSITE tickets (highest priority)
 * 2. EN ROUTE tickets
 * 3. Emergency/No Response tickets
 * 4. Regular tickets (by type)
 * 
 * Within each group, sort by due date:
 * - Late (overdue)
 * - Due today
 * - Due tomorrow
 * - Due in 4+ days
 */

function getStatusPriority(locatorStatus: string): number {
  if (locatorStatus === 'ONSITE') return 0; // Highest priority
  if (locatorStatus === 'ENROUTE') return 1;
  return 2; // All other statuses
}

function getTicketTypePriority(ticketType?: string): number {
  if (!ticketType) return 2;
  // Highest priority: Emergency, DigUp (damage), No Response.
  if (ticketType === 'EMERGENCY' || ticketType === 'DIGUP' || ticketType === 'NO_RESPONSE') return 0;
  // High priority: Non-Compliant (short notice).
  if (ticketType === 'NON_COMPLIANT') return 1;
  return 2; // Normal, Update, Recall, etc.
}

function getDueDateCategory(dueAt?: number): number {
  if (!dueAt) return 999; // No due date = lowest priority
  
  const now = Date.now();
  const diff = dueAt - now;
  const hoursUntil = diff / (1000 * 60 * 60);
  const daysUntil = diff / (1000 * 60 * 60 * 24);
  
  if (hoursUntil < 0) return 0; // Late/overdue
  if (hoursUntil < 24) return 1; // Due today
  if (daysUntil < 2) return 2; // Due tomorrow
  return 3; // Due in 4+ days
}

export function sortTickets(tickets: Ticket[]): Ticket[] {
  return [...tickets].sort((a, b) => {
    // 1. Sort by locator status (ONSITE > ENROUTE > others)
    const statusA = getStatusPriority(a.locatorStatus);
    const statusB = getStatusPriority(b.locatorStatus);
    if (statusA !== statusB) {
      return statusA - statusB;
    }
    
    // 2. Sort by ticket type (Emergency/No Response > others)
    const typeA = getTicketTypePriority(a.ticketType);
    const typeB = getTicketTypePriority(b.ticketType);
    if (typeA !== typeB) {
      return typeA - typeB;
    }
    
    // 3. Sort by due date category (late > today > tomorrow > 4+)
    const dueCategoryA = getDueDateCategory(a.dueAt);
    const dueCategoryB = getDueDateCategory(b.dueAt);
    if (dueCategoryA !== dueCategoryB) {
      return dueCategoryA - dueCategoryB;
    }
    
    // 4. Within same category, sort by exact due date (earliest first)
    if (a.dueAt && b.dueAt) {
      return a.dueAt - b.dueAt;
    }
    
    return 0;
  });
}
