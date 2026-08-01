# Locate720 — Field Technician Mobile App

The offline-first mobile app for field technicians in the LocateMVP utility locate ticket management system. Techs use this app to receive, manage, and close 811 locate tickets in the field. It syncs with the [Backend](../Backend/) API server and never talks to the [811Simulator](../811Simulator/) directly.

## Tech Stack

| | |
|---|---|
| **Framework** | Expo v54 + React Native 0.81.5 + React 19 |
| **Routing** | expo-router (file-based, `app/` directory) |
| **Local DB** | WatermelonDB v0.28 (expo-sqlite adapter) — schema v7 |
| **Styling** | NativeWind v4 (Tailwind for React Native) + `global.css` |
| **Maps** | `react-native-maps` |
| **Icons** | `@expo/vector-icons` (Ionicons) |
| **Sync** | Custom `SyncEngine` singleton (outbox pattern) |
| **Language** | TypeScript |

## Quick Start

> **Important:** Always run Expo directly (`npx expo start`), NOT via `pnpm dev:mobile` or turbo. Turbo captures stdout in non-TTY mode, which strips Expo's interactive UI and QR code.

```bash
# From the repo root
pnpm install

# One-time: build & install the dev client on your device/emulator
cd Locate720
npx expo run:android    # or: npx expo run:ios

# Daily dev: start the Expo bundler
cd Locate720
npx expo start
```

A **dev build** (`expo-dev-client`) must be installed on the device/emulator first. This app is not compatible with Expo Go because it uses native modules (WatermelonDB, react-native-maps, etc.).

### Scripts

| Script | Description |
|---|---|
| `npx expo start` | Start the Expo bundler (interactive UI + QR) |
| `npx expo start --lan` | Start with LAN IP (for physical devices) |
| `npx expo run:android` | Build & install dev client on Android (one-time per device) |
| `npx expo run:ios` | Build & install dev client on iOS (one-time per device) |
| `npx expo start --web` | Start in web mode (limited) |
| `npx expo lint` | Run ESLint |

## Architecture

### Offline-First

The app is fully functional without a network connection. All state changes write to the local WatermelonDB first, then sync to the Backend via the outbox pattern when connectivity returns.

```
User action → WatermelonDB write + outbox_events row
                    ↓ (when online)
              SyncEngine.flushP0() / flushP1()
                    ↓
              POST /api/sync/events (Backend)
```

### SyncEngine

A singleton (`src/features/tickets/sync/SyncEngine.ts`) that handles:

- **Outbox flush** — sends P0 events (ticket status, customer markings, notes, attachments) and P1 events (clock events) to the Backend in priority order.
- **Pull** — calls `POST /api/sync/pull` to fetch ticket deltas (throttled to 60s).
- **Auto-sync** — runs every 30s while the app is open.
- **Network listening** — uses `@react-native-community/netinfo` to detect connectivity changes and flush immediately when back online.
- **JWT auth** — automatic token refresh on 401 responses.
- **Conflict resolution** — server version overwrites local only if `delta.version > existing.version` AND there are no PENDING outbox events for that ticket.

**Constants (do not change):** `MAX_BATCH_SIZE=100`, `MAX_RETRY_COUNT=10`, `REQUEST_TIMEOUT_MS=30000`, `PULL_THROTTLE_MS=60000`.

### Outbox Pattern

Every state change creates an `outbox_events` row in WatermelonDB via factory functions in `src/features/tickets/domain/outbox.ts`:

| Event Type | Priority | Factory |
|---|---|---|
| `TICKET_STATUS_SET` | P0 | `createTicketStatusSetEvent` |
| `TICKET_CUSTOMER_MARKING_SET` | P0 | `createTicketCustomerMarkingSetEvent` |
| `TICKET_NOTE_ADDED` | P0 | `createTicketNoteEvent` |
| `TICKET_ATTACHMENT_ADDED` | P0 | `createTicketAttachmentEvent` |
| `CLOCK_EVENT` | P1 | `createClockEvent` |

### Status Machine

Ticket locator status transitions are enforced by `src/features/tickets/domain/statusMachine.ts`:

```
ASSIGNED → ENROUTE → ONSITE → PAUSED → ONSITE (loop)
                                    └→ CLOSED / UNABLE (terminal, set during closeout)
```

Never set status directly — always go through `canTransitionStatus()`.

## App Structure (expo-router)

```
app/
├── _layout.tsx              # Root layout (AuthProvider, AuthGuard, DB init, orphaned session cleanup)
├── index.tsx                # Auth redirect
├── login.tsx                # Login screen (email/password + password change flow)
├── (tabs)/
│   ├── _layout.tsx          # Bottom tab navigator (Tickets / Timesheet / Profile)
│   ├── tickets.tsx          # Ticket list + map view with filters
│   ├── timesheet.tsx        # Clock in/out, lunch & personal breaks
│   └── profile.tsx          # Personal productivity metrics
└── ticket-details/[id].tsx  # Ticket detail with tabbed sections
```

### Ticket Detail Screen

The ticket detail screen (`app/ticket-details/[id].tsx`) has tabbed sections:

| Tab | Component | Content |
|---|---|---|
| Customers | `CustomersTab` | Per-utility marking (minutes, footage, completion status) with allocation reconcile modal |
| Notes | `NotesTab` | Internal & dispatch notes |
| Attachments | `AttachmentsTab` | Photos (via `expo-image-picker`) with GPS tagging |
| History | `HistoryTab` | Linked-ticket chain (sorted by `sequence_number`), each row tappable |

### Timesheet Screen

- Clock in / clock out (with ticket selection for clock-out)
- Lunch break start/end
- Personal break start/end
- Break status validation (can't clock out while on break, can't start a ticket while on break)
- Day session management

### Profile Screen

Personal productivity metrics:
- Supervisor name
- Tickets on board
- Closed today
- Total footage allocated
- Total utilities closed
- LPH (locates per hour)
- FPH (footage per hour)
- Accumulated clock-in time

## Local Database (WatermelonDB)

Schema v7 (`src/db/schema.ts`) with migrations (`src/db/migrations.ts`).

| Table | Purpose |
|---|---|
| `tickets` | Local ticket cache (status, locator_status, payload_json, lineage columns) |
| `outbox_events` | Pending sync events (type, priority, request_id, payload, status, retry_count) |
| `drafts` | Ticket draft fields (unsaved form state) |
| `day_sessions` | Daily clock sessions |
| `clock_events` | Individual clock events |
| `ticket_notes` | Notes (with sync_state and request_id for outbox tracking) |

**Models** live in `src/db/models/` and use `@field()` decorators.

### Schema Migrations

If you add a column to the schema:

1. Add the column to `src/db/schema.ts` and bump `version`.
2. Add a matching migration step in `src/db/migrations.ts`.
3. Add the `@field()` decorator to the model in `src/db/models/`.

Schema version and migration count must stay in sync.

## Key Source Files

| File | Purpose |
|---|---|
| `src/config/api.ts` | API base URL + endpoints + `DEV_USER_ID` |
| `src/db/database.ts` | WatermelonDB instance (SQLite adapter) |
| `src/db/schema.ts` | Schema definition (v7) |
| `src/db/migrations.ts` | Migration steps (v2 → v7) |
| `src/features/auth/AuthContext.tsx` | Auth provider (AsyncStorage-based JWT persistence) |
| `src/features/tickets/sync/SyncEngine.ts` | Sync singleton (flush, pull, conflict resolution) |
| `src/features/tickets/domain/statusMachine.ts` | Status transition rules |
| `src/features/tickets/domain/outbox.ts` | Outbox event factory functions |
| `src/features/tickets/utils/ticketTime.ts` | Time calculations (enroute, onsite, paused, allocatable) |
| `src/features/tickets/utils/ticketPayload.ts` | Payload parsing & formatting |
| `src/features/tickets/utils/ticketPresentation.ts` | Ticket type colors & display formatting |
| `src/utils/fetchWithTimeout.ts` | HTTP client with timeout (use for all HTTP calls) |
| `src/utils/logger.ts` | Logger (use instead of raw `console.log`) |

## Configuration

Edit `src/config/api.ts`:

```typescript
export const API_BASE_URL = __DEV__
  ? 'http://192.168.50.245:3000/api'  // ← Change to your LAN IP or localhost
  : 'https://api.locate720.com/api';  // Production URL (future)

export const DEV_USER_ID = 'user-bob-123';  // ← Hardcoded dev user
```

- **Physical devices can't reach `localhost`** — use your machine's LAN IP.
- `DEV_USER_ID` is a hardcoded dev auth user; real auth should use the JWT user from `AuthContext`.

## Coding Conventions

- WatermelonDB models live in `src/db/models/` — use `@field()` decorators.
- All time-based ticket calculations go in `src/features/tickets/utils/ticketTime.ts` — do not duplicate logic.
- Status transitions are enforced by `statusMachine.ts` — do not bypass it.
- Use `logger.log/warn/error` from `src/utils/logger.ts`, never raw `console.log` (except where it already exists).
- Use `fetchWithTimeout` from `src/utils/fetchWithTimeout.ts` for all HTTP calls.
- `payload_json` on a ticket stores rich JSON metadata (customers, timeline, contractor). Parse it with try/catch.
- Do not modify `SyncEngine.ts` batch limits (100), retry limits (10), or timeout (30s) unless asked.
