import { Model } from '@nozbe/watermelondb';
import { field } from '@nozbe/watermelondb/decorators';

export type NoteType = 'INTERNAL' | 'DISPATCH';

export default class TicketNote extends Model {
  static table = 'ticket_notes';

  @field('ticket_id') ticketId!: string;
  @field('ticket_number') ticketNumber!: string;
  @field('author_id') authorId!: string;
  @field('author_name') authorName!: string;
  @field('body') body!: string;
  @field('note_type') noteType!: NoteType;
  @field('created_at') createdAt!: number;
  @field('sync_state') syncState?: string;
  @field('request_id') requestId?: string;
}
