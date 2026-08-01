import { Model } from '@nozbe/watermelondb';
import { field } from '@nozbe/watermelondb/decorators';

export default class Draft extends Model {
  static table = 'drafts';

  @field('ticket_id') ticketId!: string;
  @field('user_id') userId!: string;
  @field('fields_json') fieldsJson!: string;
  @field('updated_at') updatedAt!: number;
}
