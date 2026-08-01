# Locate720 Backend

The core API server for the LocateMVP utility locate ticket management system. Ingests tickets from the [811Simulator](../811Simulator/), assigns them to technicians via a 4-level geo-territory hierarchy, and serves as the sync hub for the [Locate720 mobile app](../Locate720/) and the data source for the [L720Ops web portal](../L720Ops/).

## Tech Stack

| | |
|---|---|
| **Runtime** | Node.js (ES Modules, `"type": "module"`) |
| **Framework** | Express v4 |
| **Database** | `better-sqlite3` (SQLite at `data/locate720.db`) |
| **Auth** | JWT (`jsonwebtoken`) + `bcryptjs` |
| **Language** | JavaScript (ESM) |

## Quick Start

```bash
# From the repo root (preferred — uses pnpm workspace + turbo)
pnpm install
pnpm dev:backend          # http://localhost:3000

# Or standalone
cd Backend
pnpm install
pnpm dev                  # node --watch src/server.js
```

### Scripts

| Script | Description |
|---|---|
| `pnpm dev` | Start with auto-reload (`node --watch`) |
| `pnpm start` | Start without reload |
| `pnpm seed` | Seed sample users (`src/scripts/seedUsers.js`) |
| `pnpm reset` | Reset the database (`src/scripts/resetDatabase.js`) |
| `pnpm test:phase1` | Run sync integration tests |
| `pnpm test:status-machine` | Run status machine unit tests |

## Architecture

### Background Intervals

The server runs two 30-second background loops on boot:

1. **Inbound 811 ingestion** (`ingestionService.pullTicketsFrom811`) — pulls new/updated tickets from the 811Simulator, maps external IDs to local IDs, resolves ticket lineage (with out-of-order arrival repair), resolves each ticket's 4-level territory chain from its lat/lng, then auto-assigns unassigned tickets to a tech in their resolved tech territory. Emits a `simulator.sync` ops event.
2. **Outbound 811 events** (`outbound811Service.processOutbound811Events`) — pushes queued closure/response events from `outbox_811_events` back to the 811Simulator.

### Service Layer

| Service | Responsibility |
|---|---|
| `ingestionService.js` | Pull & upsert tickets from 811Simulator; lineage resolution & repair; missing-ticket reconciliation |
| `assignmentService.js` | Route unassigned tickets to a tech in their `tech_territory` |
| `territoryService.js` | Resolve (lat,lng) → 4-level territory chain; build visibility SQL filters per user |
| `ticketChainService.js` | Read helpers for linked-ticket chains (never aggregates across a chain) |
| `outbound811Service.js` | Queue & push closure/response events back to the 811Simulator |
| `idempotencyService.js` | Deduplicate inbound sync events by `requestId` |
| `conflictDetection.js` | Detect conflicting ticket state during sync |

### Event Bus

An in-process `opsEventBus` (`utils/opsEventBus.js`) pub/sub feeds the web portal's Server-Sent Events stream. Well-known event types: `ticket.updated`, `ticket.created`, `ticket.assigned`, `ticket.note.added`, `ticket.attachment.added`, `tech.clock.changed`, `tech.updated`, `simulator.sync`. No replay buffer — SSE clients that miss events fall back to TanStack Query polling.

## API Routes

### Tickets (`/api/tickets`)

| Method | Path | Description |
|---|---|---|
| `GET` | `/` | List tickets (filters: `assignedTo`, `status`, `locatorStatus`; territory-scoped by viewer) |
| `GET` | `/:id` | Single ticket |
| `GET` | `/:id/history` | Full ordered chain (original + linked tickets) |
| `GET` | `/:id/related` | Chain minus the current ticket |
| `GET` | `/:id/chain-summary` | Chain with per-ticket minutes/footage (no cross-chain aggregation) |
| `PATCH` | `/:id` | Update ticket fields (status, locator_status, assigned_tech_id, payload_json) |
| `GET` | `/stats/summary` | Ticket counts by status & locator status |
| `POST` | `/` | **Disabled** — tickets are ingested from the 811Simulator |

### Users (`/api/users`)

| Method | Path | Description |
|---|---|---|
| `GET` | `/` | List users (filter: `role`) |
| `GET` | `/:id` | Single user |
| `POST` | `/` | Create user (`name`, `email`, `role`, `supervisorId?`, `areaId?`) |
| `GET` | `/:id/tickets` | Tickets assigned to a user |
| `GET` | `/:id/productivity-summary` | Aggregated daily productivity metrics (LPH, FPH, footage, utilities closed) |
| `GET` | `/:id/utility-production-summary` | Per-utility production totals + current ticket utility states |

### Auth (`/api/auth`) — Mobile

| Method | Path | Description |
|---|---|---|
| `POST` | `/login` | Email/password login → JWT (7d) + refresh token (30d) |
| `POST` | `/refresh` | Refresh access token |
| `POST` | `/password` | Change password (requires current password unless dev placeholder) |

### Sync (`/api/sync`) — Mobile

| Method | Path | Description |
|---|---|---|
| `POST` | `/events` | Receive outbox events from mobile app (idempotent by `requestId`) |
| `POST` | `/pull` | Pull ticket deltas since `lastSyncAt` (territory-scoped) |
| `POST` | `/process-outbound-811` | Manually flush pending outbound 811 events |
| `GET` | `/notes` | Fetch notes by `ticketId` or `ticketNumbers` |
| `GET` | `/attachments` | Fetch attachment metadata (or full base64 with `includeData=true`) |
| `GET` | `/attachments/:id` | Single attachment record |

**Sync event types handled:** `TICKET_STATUS_SET`, `TICKET_CUSTOMER_MARKING_SET`, `TICKET_CLOSED`, `TICKET_NOTE_ADDED`, `TICKET_ATTACHMENT_ADDED`, `CLOCK_EVENT`. Each event records a `ticket_events` history row and, for customer marking changes, records per-customer `utility_production_ledger` deltas (minutes, footage, completion).

### Timesheet (`/api/timesheet`)

| Method | Path | Description |
|---|---|---|
| `POST` | `/events` | Receive clock events (CLOCK_IN, CLOCK_OUT, LUNCH_START/END, PERSONAL_START/END) |
| `GET` | `/summary` | Timesheet summary for a user + date range |

### Inbound 811 (`/api/inbound`)

| Method | Path | Description |
|---|---|---|
| `POST` | `/811/pull` | Webhook target for 811Simulator dispatch notifications |
| `GET` | `/811/status` | Ingestion status & stats |
| `POST` | `/811/assign` | Manually trigger ticket assignment |
| `POST` | `/811/reset` | Delete all 811-sourced tickets (dev/test only) |

### Territories (`/api/ops/territories`)

| Method | Path | Description |
|---|---|---|
| `GET` | `/` | List all territories (flat, or `?tree=1` for nested) |
| `GET` | `/:id` | Single territory + assignments + derived hierarchy |
| `POST` | `/` | Create a territory |
| `PATCH` | `/:id` | Update a territory |
| `DELETE` | `/:id` | Soft-delete (`active=0`) |
| `POST` | `/:id/assignments` | Assign a user to a territory |
| `DELETE` | `/:id/assignments/:userId` | Remove a user assignment |
| `GET` | `/users/:userId/hierarchy` | Derived `{ supervisor, areaManager, districtManager }` |
| `GET` | `/users/:userId/assignments` | Territory assignments for a user |

### Ops Portal (`/api/ops`) — JWT-protected

| Method | Path | Description |
|---|---|---|
| `POST` | `/auth/login` | Portal login (24h token) |
| `POST` | `/auth/refresh` | Refresh portal token |
| `PATCH` | `/auth/password` | Change password |
| `GET` | `/events` | **SSE stream** — real-time ops events (accepts `?token=` for EventSource) |
| `GET` | `/dashboard/stats` | Dashboard metrics (range-aware: day/week/month) |
| `GET` | `/dashboard/tech-status` | Live tech clock/ticket status |
| `GET` | `/dashboard/activity` | Recent ticket event audit trail |
| `GET` | `/techs` | Tech list with productivity (range-aware) |
| `GET` | `/techs/:id` | Tech detail with productivity |
| `GET` | `/techs/:id/tickets` | Tech's tickets |
| `GET` | `/techs/:id/timesheet` | Tech's sessions, break segments, totals |
| `PUT` | `/techs/:id` | Update tech (area, supervisor) |
| `GET` | `/tickets` | Ticket list (paginated, filterable) |
| `GET` | `/tickets/:id` | Ticket detail |
| `GET` | `/tickets/:id/chain` | Chain with per-ticket operational summaries |
| `GET` | `/customers/summary` | Customer utility summary (range-aware) |

### Health

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/health` | Server health check |

## Database

SQLite at `data/locate720.db` (auto-created on first run, gitignored).

**Tables:**

| Table | Purpose |
|---|---|
| `users` | Technicians, supervisors, managers (with role CHECK constraint, bcrypt password hash, supervisor tree) |
| `areas` | Legacy area definitions (kept for back-compat; territory model is preferred) |
| `user_areas` | Legacy user→area links |
| `tickets` | 811 locate tickets with status, locator_status, assignment, version, lineage columns |
| `ticket_events` | Audit trail of ticket changes |
| `outbox_811_events` | Outbound closure/response events queued for the 811Simulator |
| `day_sessions` | Daily clock sessions (clock in/out, status) |
| `clock_events` | Individual clock events (CLOCK_IN, CLOCK_OUT, LUNCH_*, PERSONAL_*) |
| `break_segments` | Lunch/personal break segments within a session |
| `utility_production_ledger` | Per-customer minutes/footage/completion deltas (append-only, idempotent by `request_id:customer_id`) |
| `ticket_notes` | Internal & dispatch notes |
| `ticket_attachments` | Photos/PDFs (stored as base64) |
| `territories` | 4-level territory hierarchy (DISTRICT → AREA → SUPERVISOR_TERRITORY → TECH_TERRITORY) |
| `user_territory_assignments` | User→territory links with assignment type |
| `boundary_units` | Texas cities/counties from GeoJSON for precise point-in-territory matching |

**Schema migrations** are additive and run on boot via `ensureColumnExists()` + a `users.role` CHECK rebuild for `DISTRICT_MANAGER`. Ticket lineage columns are backfilled as self-rooted originals on upgrade.

## Role Hierarchy & Permissions

| Role | Level | Can View | Can Edit | Can Clock | Search Scope |
|---|---|---|---|---|---|
| `TRAINEE` | 0 | Own tickets only | Limited (notes only) | Yes | Own ticket number |
| `TRAINER` | 1 | Own + supervised techs | Supervised tickets | Yes | Supervised ticket numbers |
| `TECH` | 2 | Own tickets | Full | Yes | Own ticket number |
| `SUPERVISOR` | 3 | Territory tickets | Territory tickets + clock time | No | Address + ticket number + date range |
| `AREA_MANAGER` | 4 | Area tickets | Area tickets + staff mgmt | No | Address + ticket number + date range |
| `DISTRICT_MANAGER` | 5 | District tickets | District tickets | No | District-wide |
| `MANAGER` | 6 | All tickets | Full system | No | All filters |

**Roles determine *what* a user can do; territories determine *where* they can see.** Visibility is enforced via `territoryService.buildTicketVisibilityFilter()` which produces a SQL fragment injected into every ticket query.

## Ticket Status Flow

```
ASSIGNED → ENROUTE → ONSITE → PAUSED → ONSITE (loop)
                                    └→ CLOSED / UNABLE (terminal, set during closeout)
```

Status transitions are enforced by `src/validation/statusMachine.js` (mirrors the mobile app's `statusMachine.ts`). Never set status directly — go through `canTransitionStatus()`.

## Configuration

| Variable | Default | Location | Notes |
|---|---|---|---|
| `PORT` | `3000` | `src/server.js` | API port |
| `JWT_SECRET` | `l720-ops-secret-key` | `src/routes/ops.js`, `auth.js`, `territories.js` | Dev secret; set in prod |
| `ELEVEN_SIM_BASE_URL` | `http://localhost:4100` | `src/services/ingestionService.js` | 811Simulator URL |
| `SIMULATOR_URL` | `http://localhost:4100` | `src/services/outbound811Service.js` | Outbound 811 URL |

## Dev Notes

- Seeded dev users (Bob, Alice, Charlie, Diana, Evan) are relied on by the mobile app — do not remove them from `server.js`.
- Dev users with the placeholder password hash (`$2b$10$YourDevHashHere...`) accept any password.
- The `data/` directory is gitignored and runtime-only — deleting it resets the database.
- All DB queries use `better-sqlite3` prepared statements; services are pure functions that receive `db` as the first argument.
- Routes import `db` from `../server.js` to get the singleton instance.
