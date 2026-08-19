# LocateMVP — Architecture (v1.5)

> Post-v1.5 architecture reflecting all changes from the Phase 0 audit
> implementation. See `docs/CODEBASE_AUDIT_CURRENT_STATE.md` for the
> pre-change audit.

---

## System Overview

Monorepo with four cooperating subsystems:

| Subsystem | Location | Port | Role |
|---|---|---:|---|
| 811 Simulator | `811Simulator/` | 4100 | Authoritative source of externally generated tickets, revisions, and due-date changes |
| Core Backend | `Backend/` | 3000 | Shared operational source of truth; ingests 811; serves mobile + ops |
| Mobile app | `Locate720/` | — | Offline-first field client (WatermelonDB + outbox) |
| Ops portal | `L720Ops/` | 5173 | Dispatch/management web UI (React + TanStack Query) |

---

## Data Flow

```
811 Simulator
    │
    │  GET /api/811/tickets (polled every 30s)
    ▼
Backend (SQLite: data/locate720.db)
    │
    ├── POST /api/sync/pull        ──►  Mobile (WatermelonDB)
    ├── POST /api/sync/events      ◄──  Mobile (P0 outbox: ticket status)
    ├── POST /api/timesheet/events ◄──  Mobile (P1 outbox: clock events)
    ├── GET  /api/timesheet/sync   ──►  Mobile (session reconciliation)
    ├── GET  /api/ops/*            ──►  L720Ops (REST)
    ├── SSE  /api/ops/events       ──►  L720Ops (live updates)
    │
    ├── POST /api/811/tickets/:id/close        ──►  811 Simulator (queued)
    ├── POST /api/811/tickets/:id/assign       ──►  811 Simulator (fire-and-forget)
    ├── POST /api/811/tickets/:id/status       ──►  811 Simulator (fire-and-forget)
    └── POST /api/811/tickets/:id/revise-due   ──►  811 Simulator (queued)
```

---

## Sources of Truth

| Concern | Authoritative source | Reconciliation |
|---|---|---|
| Ticket existence, type, address, customers | 811 Simulator `tickets_811` | Backend ingests every 30s |
| Ticket assignment, locator status, payload | Backend `tickets` | Mobile pulls via sync; Ops reads via REST/SSE |
| Due date (original) | 811 Simulator `tickets_811.due_at` | Backend preserves `original_due_at` |
| Due date (current/rescheduled) | Backend `tickets.due_at` | 811 revised via `revise-due` endpoint |
| Reschedule history | Backend `ticket_reschedules` | Append-only, idempotent via `request_id` |
| Day session / clock state | Backend `day_sessions` + `clock_events` | Mobile pulls via `GET /api/timesheet/sync` |
| Break segments | Backend `break_segments` | Reconstructed from clock events |
| Allocation segments | Backend `allocation_segments` | Reconstructed from clock events |
| Ticket event history | Backend `ticket_events` | Mobile has no pull (future work) |
| Outbound 811 events | Backend `outbox_811_events` | Queued with retry, processed every 30s |
| Contractor email queue | Backend `contractor_email_queue` | Processed every 60s |

---

## Key Architectural Decisions (v1.5)

### 1. Server-authoritative clock state

Backend is authoritative for clock/session state. Mobile reconciles via
`GET /api/timesheet/sync` (delta-pull with `lastSyncAt` watermark).
Server refuses duplicate clock-in from a second device with
`ALREADY_CLOCKED_IN` error. Force override available via `force: true`
payload flag.

### 2. Unified due-urgency presentation

Both mobile and portal use the same urgency bucketing:
overdue / urgent (<2h) / today (<24h) / soon (<72h) / future / none.
Colors are mirrored in `Locate720/src/features/tickets/domain/dueColor.ts`
and `L720Ops/src/utils/dueUrgency.ts`.

### 3. Local-date handling

All "today" date derivation uses `getTodayDateString()` which returns
`new Date().toLocaleDateString('en-CA')` (YYYY-MM-DD in local timezone).
No raw `toISOString().split('T')[0]` for "today" semantics.

### 4. Rescheduling architecture

- 811 Simulator: `POST /api/811/tickets/:id/revise-due` preserves
  `original_due_at`, updates `due_at`, increments version, logs
  `DUE_REVISED` event.
- Backend: `POST /api/tickets/:id/reschedule` (single) and
  `POST /api/tickets/reschedule-bulk` (same-contractor) with idempotency
  via `request_id`. Appends to `ticket_reschedules` history. Queues
  outbound 811 event and contractor email.
- Ingestion guard: Backend does not overwrite `due_at` when
  `original_due_at` is set and incoming 811 `due_at` equals
  `original_due_at` (no simulator revision).

### 5. Active-ticket highlighting

Mobile ticket cards use the locator status color for the left border
(6px) and a subtle background tint when the ticket is ENROUTE, ONSITE,
or PAUSED. Non-active tickets use the due-urgency border (4px).

### 6. Contractor email queue

Backend `contractor_email_queue` table with PENDING/SENT/FAILED status
and retry logic. In development, emails are logged. In production, this
would use SMTP (nodemailer, SendGrid, etc.).

---

## Database Schemas

### Backend (SQLite: data/locate720.db)

Key tables: `users`, `tickets` (with `original_due_at`, lineage columns),
`ticket_events`, `ticket_reschedules`, `day_sessions`, `clock_events`,
`break_segments`, `allocation_segments`, `utility_production_ledger`,
`outbox_811_events`, `contractor_email_queue`, `ticket_notes`,
`ticket_attachments`, `idempotency_records`.

### Mobile (WatermelonDB, schema version 8)

Tables: `tickets`, `outbox_events`, `drafts`, `day_sessions`,
`clock_events`, `ticket_notes`.

### 811 Simulator (SQLite: data/sim811.sqlite)

Tables: `tickets_811` (with `original_due_at`, lineage columns),
`ticket_members_811`, `ticket_event_log_811`, `service_areas`.

---

## Sync Engine

The mobile `SyncEngine` (singleton) handles:
- **P0 flush**: ticket status events → `POST /api/sync/events`
- **P1 flush**: clock events → `POST /api/timesheet/events`
- **Ticket pull**: `GET /api/tickets?assignedTo=userId` → `applyTicketDeltas()`
- **Timesheet pull**: `GET /api/timesheet/sync?userId=&lastSyncAt=` → `applyTimesheetDeltas()`
- **Auto-sync**: every 30s when online
- **Network regain**: flush P0 → pull tickets → pull timesheet
- **Conflict resolution**: server version overwrites local only if
  `delta.version > existing.version` AND no PENDING outbox events

Constants: `MAX_BATCH_SIZE=100`, `MAX_RETRY_COUNT=10`,
`REQUEST_TIMEOUT_MS=30000`, `PULL_THROTTLE_MS=60000`,
`TIMESHEET_PULL_THROTTLE_MS=30000`.
