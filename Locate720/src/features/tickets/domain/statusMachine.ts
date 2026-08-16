/**
 * Ticket locator status transition rules
 * 
 * Flow: ASSIGNED -> ENROUTE -> ONSITE -> PAUSED (if need to leave) -> ONSITE (to resume)
 * Once ONSITE, cannot go back to ASSIGNED or ENROUTE
 * PAUSED can only go back to ONSITE, not ENROUTE
 * CLOSED/UNABLE are terminal states set during closeout, not quick actions
 */

export type LocatorStatus =
  | "PENDING"
  | "ASSIGNED"
  | "ENROUTE"
  | "ONSITE"
  | "PAUSED"
  | "CLOSED"
  | "UNABLE";

const ALLOWED_TRANSITIONS: Readonly<Record<LocatorStatus, readonly LocatorStatus[]>> = {
  PENDING: ["ASSIGNED"],   // Tech assigned → ready for field work
  ASSIGNED: ["ENROUTE"],
  ENROUTE: ["ONSITE"],
  ONSITE: ["PAUSED"],      // Can only pause from onsite, not go back to enroute
  PAUSED: ["ONSITE"],      // Can only resume to onsite, not enroute
  CLOSED: ["ASSIGNED"],    // Reopen: return to assigned for re-locate
  UNABLE: ["ASSIGNED"],    // Reopen: return to assigned for re-locate
} as const;

/** Returns whether a locator status transition is allowed. */
export function canTransitionStatus(from: LocatorStatus, to: LocatorStatus): boolean {
  return ALLOWED_TRANSITIONS[from]?.includes(to) || false;
}

/** Returns the allowed next statuses for the given status. */
export function getAllowedNextStatuses(from: LocatorStatus): readonly LocatorStatus[] {
  return ALLOWED_TRANSITIONS[from] || [];
}

/** True when the ticket is in a closed/unable state. These can be reopened. */
export function isTicketClosed(status: string): boolean {
  return status === "CLOSED" || status === "UNABLE";
}
