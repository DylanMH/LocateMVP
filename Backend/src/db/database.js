/**
 * File-based database for development
 * Persists data to JSON files
 */

import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const DATA_DIR = join(__dirname, '../../data');
const DB_FILE = join(DATA_DIR, 'database.json');

// Ensure data directory exists
if (!existsSync(DATA_DIR)) {
  mkdirSync(DATA_DIR, { recursive: true });
}

const users = new Map();
const tickets = new Map();
const ticketEvents = new Map();
const outbox811Events = new Map();

// Load from file if exists
function loadFromFile() {
  if (existsSync(DB_FILE)) {
    try {
      const data = JSON.parse(readFileSync(DB_FILE, 'utf-8'));
      if (data.users) {
        data.users.forEach(u => users.set(u.id, u));
      }
      if (data.tickets) {
        data.tickets.forEach(t => tickets.set(t.id, t));
      }
      if (data.ticketEvents) {
        data.ticketEvents.forEach(e => ticketEvents.set(e.id, e));
      }
      if (data.outbox811Events) {
        data.outbox811Events.forEach(e => outbox811Events.set(e.id, e));
      }
      console.log('[Database] Loaded from file:', users.size, 'users,', tickets.size, 'tickets', outbox811Events.size, '811 outbox events');
    } catch (error) {
      console.error('[Database] Failed to load from file:', error.message);
    }
  }
}

// Save to file
function saveToFile() {
  const data = {
    users: Array.from(users.values()),
    tickets: Array.from(tickets.values()),
    ticketEvents: Array.from(ticketEvents.values()),
    outbox811Events: Array.from(outbox811Events.values()),
  };
  writeFileSync(DB_FILE, JSON.stringify(data, null, 2), 'utf-8');
}

export function initDatabase() {
  loadFromFile();
  console.log('[Database] File-based database initialized');

  return {
    // Transaction method (execute callback and save)
    transaction: (callback) => {
      return (...args) => {
        const result = callback(...args);
        saveToFile();
        return result;
      };
    },

    // User methods
    prepare: (query) => ({
      get: (...params) => {
        if (query.includes('SELECT * FROM users WHERE id = ?')) {
          return users.get(params[0]);
        }
        if (query.includes('SELECT COUNT(*) as count FROM users')) {
          return { count: users.size };
        }
        if (query.includes('SELECT COUNT(*) as count FROM tickets')) {
          return { count: tickets.size };
        }
        if (query.includes('SELECT * FROM tickets WHERE id = ?')) {
          return tickets.get(params[0]);
        }
        if (query.includes('SELECT * FROM outbox_811_events WHERE id = ?')) {
          return outbox811Events.get(params[0]);
        }
        return null;
      },
      all: (...params) => {
        if (query.includes('FROM users')) {
          const results = Array.from(users.values());
          if (query.includes('WHERE role = ?')) {
            return results.filter(u => u.role === params[0]);
          }
          return results;
        }
        if (query.includes('FROM outbox_811_events')) {
          let results = Array.from(outbox811Events.values());
          if (query.includes('WHERE status = ?')) {
            results = results.filter(e => e.status === params[0]);
          }
          if (query.includes('ORDER BY created_at')) {
            results.sort((a, b) => a.created_at - b.created_at);
          }
          return results;
        }
        if (query.includes('FROM tickets')) {
          let results = Array.from(tickets.values());

          // Parse WHERE clauses
          if (query.includes('assigned_tech_id = ?')) {
            const techId = params[params.length - 1];
            results = results.filter(t => t.assigned_tech_id === techId);
          }

          // ORDER BY due_at
          if (query.includes('ORDER BY due_at')) {
            results.sort((a, b) => a.due_at - b.due_at);
          }

          return results;
        }
        return [];
      },
      run: (...params) => {
        let needsSave = false;

        if (query.includes('INSERT INTO users')) {
          // Handle named parameters (object) or positional
          if (params.length === 1 && typeof params[0] === 'object') {
            const user = params[0];
            users.set(user.id, user);
          } else {
            const [id, name, email, role, areaId, created_at] = params;
            users.set(id, { id, name, email, role, areaId, created_at });
          }
          needsSave = true;
        } else if (query.includes('INSERT INTO tickets')) {
          // Handle named parameters (object with camelCase keys)
          if (params.length === 1 && typeof params[0] === 'object') {
            const data = params[0];
            const ticket = {
              id: data.id,
              ticket_number: data.ticketNumber,
              ticket_type: data.ticketType || 'NORMAL',
              address: data.address,
              lat: data.lat,
              lng: data.lng,
              status: data.status,
              locator_status: data.locatorStatus,
              assigned_tech_id: data.assignedTechId,
              due_at: data.dueAt,
              created_at: data.createdAt,
              updated_at: data.updatedAt,
              version: data.version,
              payload_json: data.payloadJson,
              source: data.source || 'INTERNAL',
              external_ticket_id: data.externalTicketId || null,
              last_811_sync_at: data.last811SyncAt || null
            };
            tickets.set(ticket.id, ticket);
            console.log('[Database] Inserted ticket:', ticket.id, 'assigned to:', ticket.assigned_tech_id);
          } else {
            // Positional params
            const [id, ticket_number, ticket_type, address, lat, lng, status, locator_status,
              assigned_tech_id, due_at, created_at, updated_at, version, payload_json] = params;
            const ticket = {
              id, ticket_number, ticket_type: ticket_type || 'NORMAL', address, lat, lng, status, locator_status,
              assigned_tech_id, due_at, created_at, updated_at, version, payload_json,
              source: 'INTERNAL',
              external_ticket_id: null,
              last_811_sync_at: null
            };
            tickets.set(ticket.id, ticket);
            console.log('[Database] Inserted ticket:', ticket.id, 'assigned to:', ticket.assigned_tech_id);
          }
          needsSave = true;
        } else if (query.includes('INSERT INTO outbox_811_events') || query.includes('INSERT INTO outbox811Events')) {
          // Handle 811 outbox events
          if (params.length === 1 && typeof params[0] === 'object') {
            const event = params[0];
            outbox811Events.set(event.id, event);
          } else {
            // Positional params support for future use
            const [id, ticket_id, external_ticket_id, direction, event_type, payload, status, retry_count, created_at] = params;
            outbox811Events.set(id, {
              id, ticket_id, external_ticket_id, direction, event_type, payload, status, retry_count, created_at
            });
          }
          needsSave = true;
        } else if (query.includes('DELETE FROM tickets')) {
          const id = params[params.length - 1];
          if (tickets.delete(id)) {
            console.log('[Database] Deleted ticket:', id);
            needsSave = true;
          }
        } else if (query.includes('UPDATE tickets')) {
          const id = params[params.length - 1];
          const ticket = tickets.get(id);
          if (ticket) {
            // Simple update - increment version, set updated_at
            ticket.version = (ticket.version || 1) + 1;
            ticket.updated_at = params[params.length - 2];

            // Parse SET clauses (simplified)
            if (query.includes('locator_status')) {
              const idx = query.indexOf('locator_status = ?');
              if (idx > -1) ticket.locator_status = params[0];
            }
            if (query.includes('status =')) {
              const idx = query.indexOf('status =');
              if (idx > -1 && !query.includes('locator_status')) ticket.status = params[0];
            }
            if (query.includes('assigned_tech_id')) {
              const idx = query.indexOf('assigned_tech_id = ?');
              if (idx > -1) ticket.assigned_tech_id = params[0];
            }
            if (query.includes('payload_json')) {
              const idx = params.findIndex(p => typeof p === 'string' && p.startsWith('{'));
              if (idx > -1) ticket.payload_json = params[idx];
            }

            tickets.set(id, ticket);
            console.log('[Database] Updated ticket:', id, 'new version:', ticket.version);
            needsSave = true;
          }
        }

        if (needsSave) {
          saveToFile();
        }
      },
    }),
  };
}
