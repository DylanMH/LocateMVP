/**
 * Ticket filter predicate for the v1.7 filter system (plan §21-24).
 *
 * Filtering order (plan §24):
 *   1. Get authorized/assigned technician tickets (handled by the board
 *      observable's WHERE clause and the active/closed split).
 *   2. Apply technician-selected filters (this module).
 *   3. Sort (handled by sortTickets).
 *   4. Render.
 *
 * Filters must NOT affect sync or assignment state.
 */

import type { TicketFilters } from "../types";
import type Ticket from "../../../db/models/Ticket";
import {
  getDueUrgencyBucket,
  isRescheduled,
} from "./dueColor";
import { getTicketDisplayData } from "../utils/ticketPayload";

/**
 * Map the mobile 8-bucket due urgency to the 5-category filter buckets
 * used by the filter UI (plan §21). The mobile dueColor.ts system is the
 * canonical source — we collapse its 8 buckets into the 5 filter categories.
 */
function dueBucketMatchesFilter(
  dueAt: number | undefined,
  filter: TicketFilters["due"],
  nowMs: number = Date.now(),
): boolean {
  if (filter === "ALL") return true;
  const bucket = getDueUrgencyBucket(dueAt, nowMs);
  switch (filter) {
    case "OVERDUE":
      return bucket === "overdue";
    case "DUE_WITHIN_2_HOURS":
      return bucket === "urgent";
    case "DUE_TODAY":
      return bucket === "today";
    case "DUE_WITHIN_72_HOURS":
      return bucket === "tomorrow_am" || bucket === "tomorrow_pm" || bucket === "soon";
    case "FUTURE":
      return bucket === "future";
    default:
      return true;
  }
}

/**
 * Returns true if the ticket passes all active technician filters.
 */
export function matchesFilters(
  ticket: Ticket,
  filters: TicketFilters,
  nowMs: number = Date.now(),
): boolean {
  // Contractor filter (case-insensitive)
  if (filters.contractor) {
    const display = getTicketDisplayData(ticket.payloadJson);
    if (
      display.contractor.toLowerCase() !== filters.contractor.toLowerCase()
    ) {
      return false;
    }
  }

  // Due filter
  if (!dueBucketMatchesFilter(ticket.dueAt, filters.due, nowMs)) {
    return false;
  }

  // Rescheduled filter
  if (filters.rescheduled !== "ALL") {
    const rescheduled = isRescheduled(ticket.dueAt, ticket.originalDueAt);
    if (filters.rescheduled === "RESCHEDULED" && !rescheduled) return false;
    if (filters.rescheduled === "NOT_RESCHEDULED" && rescheduled) return false;
  }

  // Emergency filter
  if (filters.emergency && ticket.ticketType !== "EMERGENCY") {
    return false;
  }

  // No Response filter
  if (filters.noResponse && ticket.ticketType !== "NO_RESPONSE") {
    return false;
  }

  return true;
}
