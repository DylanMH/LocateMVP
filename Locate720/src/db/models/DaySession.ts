import { Model } from '@nozbe/watermelondb';
import { field, readonly, date } from '@nozbe/watermelondb/decorators';

/**
 * DaySession model - represents a work day session
 * One session per day per user
 * Tracks clock in/out times and status
 */
export default class DaySession extends Model {
  static table = 'day_sessions';

  @field('user_id') userId!: string;
  @field('date') date!: string; // YYYY-MM-DD format
  @field('clock_in_at') clockInAt!: number;
  @field('clock_out_at') clockOutAt?: number;
  @field('clock_out_ticket_id') clockOutTicketId?: string;
  @field('status') status!: string; // 'ACTIVE' | 'CLOCKED_OUT'
  
  @readonly @date('created_at') createdAt!: Date;
  @readonly @date('updated_at') updatedAt!: Date;
}
