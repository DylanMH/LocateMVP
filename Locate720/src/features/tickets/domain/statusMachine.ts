/**
 * Ticket locator status transition rules
 * 
 * Flow: ASSIGNED -> ENROUTE -> ONSITE -> PAUSED (if need to leave) -> ONSITE (to resume)
 * Once ONSITE, cannot go back to ASSIGNED or ENROUTE
 * PAUSED can only go back to ONSITE, not ENROUTE
 * CLOSED/UNABLE are terminal states set during closeout, not quick actions
 */

export type LocatorStatus =
  | "ASSIGNED"
  | "ENROUTE"
  | "ONSITE"
  | "PAUSED"
  | "CLOSED"
  | "UNABLE";

const ALLOWED_TRANSITIONS: Readonly<Record<LocatorStatus, readonly LocatorStatus[]>> = {
  ASSIGNED: ["ENROUTE"],
  ENROUTE: ["ONSITE"],
  ONSITE: ["PAUSED"], // Can only pause from onsite, not go back to enroute
  PAUSED: ["ONSITE"], // Can only resume to onsite, not enroute
  CLOSED: [], // Terminal - set during closeout
  UNABLE: [], // Terminal - set during closeout
} as const;

/** Returns whether a locator status transition is allowed. */
export function canTransitionStatus(from: LocatorStatus, to: LocatorStatus): boolean {
  return ALLOWED_TRANSITIONS[from]?.includes(to) || false;
}

/** Returns the allowed next statuses for the given status. */
export function getAllowedNextStatuses(from: LocatorStatus): readonly LocatorStatus[] {
  return ALLOWED_TRANSITIONS[from] || [];
}

/** True when the ticket is in a terminal state (closed/unable) */
export function isTicketClosed(status: string): boolean {
  return status === "CLOSED" || status === "UNABLE";
}
