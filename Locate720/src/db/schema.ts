import { appSchema, tableSchema } from '@nozbe/watermelondb';

export const schema = appSchema({
  version: 7,
  tables: [
    tableSchema({
      name: 'tickets',
      columns: [
        { name: 'ticket_number', type: 'string', isIndexed: true },
        { name: 'ticket_type', type: 'string', isOptional: true },
        { name: 'address', type: 'string' },
        { name: 'lat', type: 'number', isOptional: true },
        { name: 'lng', type: 'number', isOptional: true },
        { name: 'status', type: 'string', isIndexed: true },
        { name: 'locator_status', type: 'string', isIndexed: true },
        { name: 'assigned_tech_id', type: 'string', isIndexed: true },
        { name: 'due_at', type: 'number', isOptional: true },
        { name: 'updated_at', type: 'number' },
        { name: 'version', type: 'number' },
        { name: 'closed_by_name', type: 'string', isOptional: true },
        { name: 'closed_at', type: 'number', isOptional: true },
        { name: 'payload_json', type: 'string' },
        { name: 'sync_state', type: 'string', isOptional: true },
        // Lineage columns (v6). See docs/linked-tickets-architecture.md.
        // Each ticket remains an independent operational row; these columns
        // only describe relationships for history/visibility.
        { name: 'root_ticket_id', type: 'string', isIndexed: true, isOptional: true },
        { name: 'parent_ticket_id', type: 'string', isIndexed: true, isOptional: true },
        { name: 'sequence_number', type: 'number', isOptional: true },
        { name: 'external_root_number', type: 'string', isIndexed: true, isOptional: true },
      ],
    }),
    tableSchema({
      name: 'outbox_events',
      columns: [
        { name: 'type', type: 'string', isIndexed: true },
        { name: 'priority', type: 'number', isIndexed: true },
        { name: 'request_id', type: 'string', isIndexed: true },
        { name: 'ticket_id', type: 'string', isIndexed: true, isOptional: true },
        { name: 'device_id', type: 'string' },
        { name: 'seq', type: 'number', isIndexed: true },
        { name: 'occurred_at', type: 'number', isIndexed: true },
        { name: 'payload_json', type: 'string' },
        { name: 'status', type: 'string', isIndexed: true },
        { name: 'retry_count', type: 'number' },
        { name: 'last_attempt_at', type: 'number', isOptional: true },
      ],
    }),
    tableSchema({
      name: 'drafts',
      columns: [
        { name: 'ticket_id', type: 'string', isIndexed: true },
        { name: 'user_id', type: 'string', isIndexed: true },
        { name: 'fields_json', type: 'string' },
        { name: 'updated_at', type: 'number' },
      ],
    }),
    tableSchema({
      name: 'day_sessions',
      columns: [
        { name: 'user_id', type: 'string', isIndexed: true },
        { name: 'date', type: 'string', isIndexed: true },
        { name: 'clock_in_at', type: 'number' },
        { name: 'clock_out_at', type: 'number', isOptional: true },
        { name: 'clock_out_ticket_id', type: 'string', isOptional: true },
        { name: 'status', type: 'string', isIndexed: true },
        { name: 'created_at', type: 'number' },
        { name: 'updated_at', type: 'number' },
      ],
    }),
    tableSchema({
      name: 'clock_events',
      columns: [
        { name: 'session_id', type: 'string', isIndexed: true },
        { name: 'user_id', type: 'string', isIndexed: true },
        { name: 'event_type', type: 'string', isIndexed: true },
        { name: 'occurred_at', type: 'number', isIndexed: true },
        { name: 'reason', type: 'string', isOptional: true },
        { name: 'ticket_id', type: 'string', isOptional: true },
        { name: 'created_at', type: 'number' },
      ],
    }),
    tableSchema({
      name: 'ticket_notes',
      columns: [
        { name: 'ticket_id', type: 'string', isIndexed: true },
        { name: 'ticket_number', type: 'string', isIndexed: true },
        { name: 'author_id', type: 'string' },
        { name: 'author_name', type: 'string' },
        { name: 'body', type: 'string' },
        { name: 'note_type', type: 'string', isIndexed: true },
        { name: 'created_at', type: 'number', isIndexed: true },
        { name: 'sync_state', type: 'string', isOptional: true },
        { name: 'request_id', type: 'string', isOptional: true },
      ],
    }),
  ],
});
