import { Model } from '@nozbe/watermelondb';
import { field } from '@nozbe/watermelondb/decorators';

export default class Ticket extends Model {
  static table = 'tickets';

  @field('ticket_number') ticketNumber!: string;
  @field('ticket_type') ticketType?: string;
  @field('address') address!: string;
  @field('lat') lat?: number;
  @field('lng') lng?: number;
  @field('status') status!: string;
  @field('locator_status') locatorStatus!: string;
  @field('assigned_tech_id') assignedTechId!: string;
  @field('due_at') dueAt?: number;
  @field('original_due_at') originalDueAt?: number;
  @field('updated_at') updatedAt!: number;
  @field('version') version!: number;
  @field('closed_by_name') closedByName?: string;
  @field('closed_at') closedAt?: number;
  @field('payload_json') payloadJson!: string;
  @field('sync_state') syncState?: string;
  // Lineage (linked-ticket model). Each ticket is still independent for work,
  // time, footage, notes, and photos \u2014 these fields are for history only.
  @field('root_ticket_id') rootTicketId?: string;
  @field('parent_ticket_id') parentTicketId?: string;
  @field('sequence_number') sequenceNumber?: number;
  @field('external_root_number') externalRootNumber?: string;
}
