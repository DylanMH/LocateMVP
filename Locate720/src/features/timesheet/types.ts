/**
 * Timesheet domain types
 * Centralized type definitions for clock events, sessions, and timesheet functionality
 */

// Clock event types
export type ClockEventType = 
  | 'CLOCK_IN' 
  | 'CLOCK_OUT' 
  | 'LUNCH_START' 
  | 'LUNCH_END' 
  | 'PERSONAL_START' 
  | 'PERSONAL_END';

// Session status
export type SessionStatus = 'ACTIVE' | 'CLOCKED_OUT';

// Break types
export type BreakType = 'lunch' | 'personal';

// Clock event payload for outbox
export interface ClockEventPayload {
  sessionId: string;
  userId: string;
  eventType: ClockEventType;
  occurredAt: number;
  date: string;
  clockInAt: number;
  clockOutAt?: number;
  status?: SessionStatus; // Optional - only needed for CLOCK_IN/CLOCK_OUT
  reason?: string; // For personal time
  ticketId?: string; // For End Day clock out ticket selection
  clockInReason?: string; // locating | training | truck_support | meeting | oncall | other
  allocationType?: string; // current allocation (can change)
  otherReason?: string; // free-text when clock_in_reason = 'other'
  [key: string]: unknown; // Index signature for compatibility
}

// Break status check result
export interface BreakStatus {
  isOnBreak: boolean;
  breakType: BreakType | null;
  startedAt: number | null;
}
