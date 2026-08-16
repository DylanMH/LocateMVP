import { Model } from '@nozbe/watermelondb';
import { field, readonly, date } from '@nozbe/watermelondb/decorators';

export type AllocationType = 'locating' | 'training' | 'truck_support' | 'meeting' | 'oncall' | 'other';

/**
 * DaySession model - represents a work day session
 * One session per day per user
 * Tracks clock in/out times, status, and allocation reason
 */
export default class DaySession extends Model {
  static table = 'day_sessions';

  @field('user_id') userId!: string;
  @field('date') date!: string; // YYYY-MM-DD format
  @field('clock_in_at') clockInAt!: number;
  @field('clock_out_at') clockOutAt?: number;
  @field('clock_out_ticket_id') clockOutTicketId?: string;
  @field('status') status!: string; // 'ACTIVE' | 'CLOCKED_OUT'
  @field('clock_in_reason') clockInReason?: string; // locating | training | truck_support | meeting | oncall | other
  @field('allocation_type') allocationType?: string; // current allocation (can change while clocked in)
  @field('other_reason') otherReason?: string; // free-text when clock_in_reason = 'other'

  @readonly @date('created_at') createdAt!: Date;
  @readonly @date('updated_at') updatedAt!: Date;
}
