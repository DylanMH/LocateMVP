import { Model } from '@nozbe/watermelondb';
import { field } from '@nozbe/watermelondb/decorators';

export default class OutboxEvent extends Model {
  static table = 'outbox_events';

  @field('type') type!: string;
  @field('priority') priority!: number;
  @field('request_id') requestId!: string;
  @field('ticket_id') ticketId?: string;
  @field('device_id') deviceId!: string;
  @field('seq') seq!: number;
  @field('occurred_at') occurredAt!: number;
  @field('payload_json') payloadJson!: string;
  @field('status') status!: string;
  @field('retry_count') retryCount!: number;
  @field('last_attempt_at') lastAttemptAt?: number;
}
