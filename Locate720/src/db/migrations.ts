import { schemaMigrations, addColumns, createTable, unsafeExecuteSql } from '@nozbe/watermelondb/Schema/migrations';

export default schemaMigrations({
  migrations: [
    {
      toVersion: 2,
      steps: [
        addColumns({
          table: 'tickets',
          columns: [
            { name: 'ticket_type', type: 'string', isOptional: true },
          ],
        }),
      ],
    },
    {
      toVersion: 3,
      steps: [
        addColumns({
          table: 'outbox_events',
          columns: [
            { name: 'ticket_id', type: 'string', isIndexed: true, isOptional: true },
          ],
        }),
      ],
    },
    {
      toVersion: 4,
      steps: [
        createTable({
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
        createTable({
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
      ],
    },
    {
      toVersion: 5,
      steps: [
        createTable({
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
    },
    {
      // v6: ticket lineage (linked-ticket model).
      // Existing rows get null values for these columns and are treated as
      // self-rooted originals by the UI (see HistoryTab + SyncEngine).
      toVersion: 6,
      steps: [
        addColumns({
          table: 'tickets',
          columns: [
            { name: 'root_ticket_id', type: 'string', isIndexed: true, isOptional: true },
            { name: 'parent_ticket_id', type: 'string', isIndexed: true, isOptional: true },
            { name: 'sequence_number', type: 'number', isOptional: true },
            { name: 'external_root_number', type: 'string', isIndexed: true, isOptional: true },
          ],
        }),
      ],
    },
    {
      // v7: composite indexes for production-scale query performance.
      // These cover the most frequent query patterns in the app:
      // - Ticket list: filter by assigned_tech_id + locator_status
      // - Active ticket check: assigned_tech_id + locator_status (ENROUTE/ONSITE)
      // - Outbox flush: status + priority + seq ordering
      // - Session lookup: user_id + date + status
      toVersion: 7,
      steps: [
        unsafeExecuteSql(
          `CREATE INDEX IF NOT EXISTS idx_tickets_tech_locator ON tickets (assigned_tech_id, locator_status);`
        ),
        unsafeExecuteSql(
          `CREATE INDEX IF NOT EXISTS idx_tickets_tech_due ON tickets (assigned_tech_id, due_at);`
        ),
        unsafeExecuteSql(
          `CREATE INDEX IF NOT EXISTS idx_outbox_status_priority_seq ON outbox_events (status, priority, seq);`
        ),
        unsafeExecuteSql(
          `CREATE INDEX IF NOT EXISTS idx_sessions_user_date_status ON day_sessions (user_id, date, status);`
        ),
        unsafeExecuteSql(
          `CREATE INDEX IF NOT EXISTS idx_notes_ticket_created ON ticket_notes (ticket_id, created_at);`
        ),
      ],
    },
    {
      // v8: clock-in reason and allocation type for day_sessions.
      toVersion: 8,
      steps: [
        addColumns({
          table: 'day_sessions',
          columns: [
            { name: 'clock_in_reason', type: 'string', isOptional: true },
            { name: 'allocation_type', type: 'string', isOptional: true },
            { name: 'other_reason', type: 'string', isOptional: true },
          ],
        }),
      ],
    },
    {
      // v9: original_due_at for tracking reschedule history on tickets.
      // Preserved on first reschedule by the backend; used by the mobile
      // app to show the original due date and apply half-color styling
      // for late-but-rescheduled tickets.
      toVersion: 9,
      steps: [
        addColumns({
          table: 'tickets',
          columns: [
            { name: 'original_due_at', type: 'number', isOptional: true },
          ],
        }),
      ],
    },
  ],
});
