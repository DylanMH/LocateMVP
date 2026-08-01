import { Database } from '@nozbe/watermelondb';
import SQLiteAdapter from '@nozbe/watermelondb/adapters/sqlite';

import { schema } from './schema';
import migrations from './migrations';
import Ticket from './models/Ticket';
import OutboxEvent from './models/OutboxEvent';
import Draft from './models/Draft';
import DaySession from './models/DaySession';
import ClockEvent from './models/ClockEvent';
import TicketNote from './models/TicketNote';

/**
 * SQLite adapter with JSI for production-ready persistence
 * Requires Expo dev client build (not compatible with Expo Go)
 */

const adapter = new SQLiteAdapter({
  schema,
  migrations,
  jsi: false,
  onSetUpError: (error) => {
    console.error('[DB] Setup error:', error);
  },
});

export const database = new Database({
  adapter,
  modelClasses: [Ticket, OutboxEvent, Draft, DaySession, ClockEvent, TicketNote],
});

console.log('[DB] Database initialized with SQLite adapter + JSI');
