import { Model } from '@nozbe/watermelondb';
import { field, readonly, date } from '@nozbe/watermelondb/decorators';

/**
 * ClockEvent model - represents a clock/timesheet event
 * Timeline of all clock in/out, lunch, and personal time events
 * 
 * Event Types:
 * - CLOCK_IN: Start of work day
 * - CLOCK_OUT: End of work day
 * - LUNCH_START: Starting lunch break (future phase)
 * - LUNCH_END: Ending lunch break (future phase)
 * - PERSONAL_START: Starting personal time (future phase)
 * - PERSONAL_END: Ending personal time (future phase)
 */
export default class ClockEvent extends Model {
  static table = 'clock_events';

  @field('session_id') sessionId!: string;
  @field('user_id') userId!: string;
  @field('event_type') eventType!: string;
  @field('occurred_at') occurredAt!: number;
  @field('reason') reason?: string; // For personal time
  @field('ticket_id') ticketId?: string; // For clock out ticket selection
  @field('allocation_type') allocationType?: string; // For ALLOCATION_CHANGE events
  
  @readonly @date('created_at') createdAt!: Date;
}
