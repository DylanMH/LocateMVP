# LocateMVP

A full-stack MVP of a **utility locate ticket management system** for field technicians, supervisors, and managers. It models the real-world workflow that happens when someone calls 811 ("Call Before You Dig"): the 811 center dispatches locate tickets to utility locating companies, field techs receive and work those tickets on their phones, and supervisors/managers monitor operations from a web portal.

This monorepo contains four cooperating sub-systems that simulate the entire pipeline — from ticket generation at a fake 811 dispatch center, through ingestion and assignment by the core backend, down to the offline-first mobile app used in the field and the real-time ops portal used in the office.

---

## Table of Contents

- [Architecture Overview](#architecture-overview)
- [Live Demo](#live-demo)
- [Sub-Systems](#sub-systems)
  - [811Simulator](#811simulator)
  - [Backend](#backend)
  - [Locate720 (Mobile App)](#locate720-mobile-app)
  - [L720Ops (Web Portal)](#l720ops-web-portal)
- [Data Flow](#data-flow)
- [Key Concepts](#key-concepts)
- [Prerequisites](#prerequisites)
- [Getting Started](#getting-started)
- [Project Structure](#project-structure)
- [Configuration](#configuration)
- [Database](#database)
- [Development Notes](#development-notes)

---

## Architecture Overview

```
┌──────────────┐     ingest (pull)      ┌──────────────┐     sync (pull/push)     ┌──────────────────┐
│  811Simulator │ ─────────────────────▶ │   Backend    │ ◀──────────────────────▶ │  Locate720 (app) │
│  (port 4100)  │ ◀───────────────────── │  (port 3000) │                          │  offline-first    │
└──────────────┘   outbound 811 events   └──────┬───────┘                          └──────────────────┘
                                                │  REST + SSE
                                                ▼
                                        ┌──────────────────┐
                                        │   L720Ops (web)   │
                                        │   (port 5173)     │
                                        └──────────────────┘
```

- The **811Simulator** is a stand-in for a real 811 dispatch center. It generates and owns the source-of-truth tickets.
- The **Backend** ingests tickets from the simulator, assigns them to techs based on geo-territories, and serves as the sync endpoint for the mobile app and the API for the web portal.
- The **mobile app** never talks to the simulator directly — it only syncs with the Backend, and it does so offline-first using a local WatermelonDB database and an outbox pattern.
- The **web portal** talks to the Backend (and read-only to the simulator for its simulator admin page) over REST + Server-Sent Events.

---

## Live Demo

A live demo of the full system is deployed and accessible from anywhere — no local setup required.

### Operations Portal (Web)

The ops portal is where supervisors, managers, and administrators monitor and manage the entire locate operation.

**URL:** `http://15.204.247.173`

**Login:** Use the district manager login to view everything - tech accounts cant access ops portal
username: king.henry@locate720.com
password: password

#### What you can do and see

| Page | What's there |
|---|---|
| **Dashboard** | Live ops overview — clocked-in techs, on-break count, open/overdue tickets, total footage, locates closed, live tech board, real-time activity feed, customer summary. Range toggle (day/week/month). |
| **Techs** | Full tech roster with productivity metrics (tickets on board, closed, locates, footage, LPH/FPH). Click any tech to see their assigned tickets and complete timesheet history. |
| **Supervisors** | Supervisor cards aggregate subordinate tech stats — total locates, footage, productive hours, and calculated LPH/FPH across all their techs. Click to see all tickets in their territory hierarchy. |
| **Tickets** | Filterable ticket table covering all 300+ tickets across Texas. Filter by status, area, assigned tech, territory, or source. Click any ticket for full 811 details — contractor info, customer/utility list, marking instructions, scope geometry, lineage/chain, notes, history, and attachments. |
| **Map View** | Geographic view of all tickets on a Leaflet map. Color-coded by status. Click markers for ticket details. See ticket distribution across all Texas areas. |
| **Territories** | 4-level territory tree builder (District → Area → Supervisor → Tech). Visualize boundaries on a map, assign boundary units, and assign users to territories. |
| **Simulator** | 811 simulator admin page — generate new tickets (up to 300 per batch), view simulator stats, pull tickets to backend, reset databases. See real-time assignment status flow back from the backend. |

#### What's running

- **300 tickets** seeded across 60+ Texas service areas
- **110+ field employees** — district managers, area managers, supervisors, and techs
- **4 areas** — East Texas, North Texas (Dallas/Fort Worth), Central Texas (Austin), South Texas (Houston)
- **15 supervisor territories** with tech territories beneath each
- Tickets auto-assign to techs by territory; supervisors see all tickets in their hierarchy
- Tickets older than 4 days are auto-deleted to keep the demo fresh

### Mobile App (Preview Build)

A preview APK is available for field testing on Android devices. The app is offline-first — tickets download to the device and can be worked without a network connection.

**Key features to test:**

- Login with any seeded user (e.g. `user-bob-123`)
- View assigned tickets in list and map views
- Work a ticket: ASSIGNED → ENROUTE → ONSITE → PAUSED → CLOSED
- Record customer markings (minutes, footage, completion per utility)
- Add notes and photo attachments
- Clock in/out, take lunch and personal breaks
- View personal productivity metrics (LPH, FPH, tickets closed)
- All changes sync back to the backend when connectivity returns

**To build the preview APK:**

```bash
cd Locate720
eas build --profile preview --platform android
```

The built APK will be available on the EAS dashboard for download and sideloading.

> **Note:** The preview build points to the OVH server (`15.204.247.173`) for API calls, so it works from anywhere without your dev machine running.

---

## Sub-Systems

### 811Simulator

A fake 811 dispatch center that generates realistic locate tickets across the entire state of Texas — covering East Texas, North Texas (Dallas/Fort Worth), Central Texas (Austin), and South Texas (Houston) with 60+ service areas.

| | |
|---|---|
| **Port** | `4100` |
| **Runtime** | Node.js + `tsx` (TypeScript execution) |
| **Framework** | Fastify v5 + `@fastify/cors` |
| **Database** | `better-sqlite3` (SQLite at `811Simulator/data/sim811.sqlite`) |
| **Validation** | Zod |
| **Language** | TypeScript (strict) |

**Responsibilities:**

- Generate bulk "ORIGINAL" locate tickets with realistic Texas addresses, contractors, work types, marking instructions, due dates, and utility members (GAS, ELECTRIC, FIBER, WATER, SEWER, COPPER).
- Spawn **linked tickets** (UPDATE, UPDATE_REMARK, NO_RESPONSE, RECALL, CORRECTION, EMERGENCY) that reference an original via a lineage/chain model.
- Maintain ticket members (utility companies responding to a ticket), their response codes, and an event log.
- Compute deterministic ticket "scope" bounding boxes per work type and ticket type (used for map display).
- Notify the Backend whenever tickets change via an outbound webhook (`POST /api/inbound/811/pull`).
- Expose an ops API (`/api/ops/811/...`) used by the web portal's Simulator page.

**Key endpoints:**

| Method | Path | Purpose |
|---|---|---|
| `POST` | `/api/811/generate` | Bulk-generate ORIGINAL tickets |
| `POST` | `/api/811/tickets/:rootId/linked` | Spawn a linked ticket on a chain |
| `GET`  | `/api/811/tickets/:ticketId/chain` | Get the ordered chain for a ticket |
| `GET`  | `/api/811/tickets` | List tickets for a member code (with `since` cursor) |
| `GET`  | `/api/811/tickets/:ticketId` | Ticket detail with members & contractor |
| `POST` | `/api/811/tickets/:ticketId/close` | Mark a ticket CLOSED |
| `POST` | `/api/811/tickets/:ticketId/responses` | Record member responses (CLEAR, NOT_MARKED, etc.) |
| `GET`  | `/api/811/metrics` | Status counts + overdue count |
| `GET/POST` | `/api/ops/811/tickets[...]` | Ops API for the web portal |

### Backend

The core API server. Ingests tickets from the simulator, assigns them to technicians via a 4-level geo-territory hierarchy, and serves as the sync hub for the mobile app and the data source for the web portal.

| | |
|---|---|
| **Port** | `3000` |
| **Runtime** | Node.js (ES Modules) |
| **Framework** | Express v4 |
| **Database** | `better-sqlite3` (SQLite at `data/locate720.db`) |
| **Auth** | JWT (`jsonwebtoken`) + `bcryptjs` |
| **Language** | JavaScript (ESM) |

**Responsibilities:**

- **Ingestion:** Polls the 811Simulator every 30s for new/updated tickets (`ingestionService.pullTicketsFrom811`), maps external 811 IDs to local IDs, resolves ticket lineage (with out-of-order arrival repair), and resolves each ticket's 4-level territory chain from its lat/lng.
- **Auto-assignment:** After each ingest pass, unassigned tickets are routed to a tech in their resolved `tech_territory` (`assignmentService.assignUnassignedTickets`).
- **Outbound 811 events:** When a ticket is closed in the field, an outbound event is queued in `outbox_811_events` and pushed to the simulator every 30s (`outbound811Service.processOutbound811Events`).
- **Sync API:** Receives outbox events from the mobile app (`POST /api/sync/events`) with idempotency, validation, and per-event-type handling (status changes, customer markings, notes, attachments, clock events). Serves ticket deltas back to the mobile app (`POST /api/sync/pull`) filtered by the user's territory visibility.
- **Ops API:** JWT-protected endpoints under `/api/ops/...` powering the web portal: dashboard stats, tech status, activity feed, tech profiles & timesheets, ticket lists with chain summaries, territory CRUD, user management, and a live SSE event stream.
- **Auth:** Mobile login/refresh/password-change (`/api/auth/...`) and ops portal login (`/api/ops/auth/login`). Dev seeded users accept any password.
- **Timesheet:** Clock in/out, lunch/personal breaks, day sessions, and a `utility_production_ledger` that records per-customer minutes/footage/completion deltas.
- **Territory management:** A 4-level hierarchy — District → Area → Supervisor Territory → Tech Territory — with boundary units imported from a Texas cities GeoJSON file. Territories drive both ticket routing and data visibility.

**Key routes:**

| Router | Mount | Purpose |
|---|---|---|
| `tickets.js` | `/api/tickets` | Ticket CRUD, history, chain, related |
| `users.js` | `/api/users` | User CRUD, role hierarchy, per-user tickets & metrics |
| `auth.js` | `/api/auth` | Mobile JWT login/refresh/password |
| `sync.js` | `/api/sync` | Outbox event ingest, pull deltas, notes, attachments |
| `timesheet.js` | `/api/timesheet` | Clock events, sessions, summaries |
| `inbound.js` | `/api/inbound` | Webhook target for 811Simulator dispatch notifications |
| `territories.js` | `/api/ops/territories` | Territory tree CRUD + user assignments |
| `ops.js` | `/api/ops` | Portal auth, dashboard, techs, tickets, SSE stream |

**Role hierarchy:** `TRAINEE → TRAINER → TECH → SUPERVISOR → AREA_MANAGER → DISTRICT_MANAGER → MANAGER`. Roles determine *what* a user can do; territories determine *where* they can see.

### Locate720 (Mobile App)

The offline-first field technician app built with Expo + React Native + WatermelonDB.

| | |
|---|---|
| **Framework** | Expo v54 + React Native 0.81.5 + React 19 |
| **Routing** | expo-router (file-based, `app/` directory) |
| **Local DB** | WatermelonDB v0.28 (expo-sqlite adapter) — schema v7 |
| **Styling** | NativeWind v4 (Tailwind for RN) + `global.css` |
| **Maps** | `react-native-maps` |
| **Sync** | Custom `SyncEngine` singleton (outbox pattern) |
| **Language** | TypeScript |

**Responsibilities:**

- **Offline-first:** All state changes write to the local WatermelonDB first, then sync to the Backend via an outbox when connectivity returns. The app is fully functional without a network.
- **Ticket workflow:** List/map views with filters (open/closed, mine/all), ticket detail with tabbed sections (Customers, Notes, Attachments, History), status transitions enforced by a status machine (`ASSIGNED → ENROUTE → ONSITE → PAUSED → ONSITE`, terminal `CLOSED`/`UNABLE`).
- **Customer marking:** Per-utility minutes/footage/completion allocation with an allocation reconcile modal that distributes onsite time across customers.
- **Timesheet:** Clock in/out, lunch & personal breaks, day sessions, break-status validation, clock-out ticket selection.
- **Profile:** Personal productivity metrics (tickets on board, closed today, footage allocated, utilities closed, LPH/FPH, accumulated clock time).
- **Linked tickets:** History tab merges the current ticket into its chain (sorted by `sequence_number`); each row is tappable and navigates to that ticket's detail.
- **SyncEngine:** Singleton handling outbox flush (P0 = ticket status/note/attachment events, P1 = clock events), pull throttling (60s), auto-sync (30s while open), network listening, JWT auth with automatic token refresh on 401, conflict resolution (server version wins only if newer AND no pending local outbox events for that ticket).

**App structure (expo-router):**

```
app/
├── _layout.tsx              # Root layout (auth gate)
├── index.tsx                # Auth redirect
├── login.tsx                # Login screen
├── (tabs)/
│   ├── _layout.tsx          # Bottom tab nav (Tickets / Timesheet / Profile)
│   ├── tickets.tsx          # Ticket list + map
│   ├── timesheet.tsx        # Clock in/out & breaks
│   └── profile.tsx          # Personal metrics
└── ticket-details/[id].tsx  # Ticket detail screen
```

### L720Ops (Web Portal)

The supervisor/manager web portal built with React 19 + Vite + TailwindCSS v4.

| | |
|---|---|
| **Port** | `5173` |
| **Framework** | React 19 + Vite 7 |
| **Routing** | React Router DOM v7 |
| **Styling** | TailwindCSS v4 (via `@tailwindcss/vite`) |
| **Data fetching** | TanStack Query v5 |
| **UI Components** | Headless UI v2 + Heroicons v2 |
| **Maps** | Leaflet + react-leaflet |
| **Language** | TypeScript |

**Responsibilities:**

- **Dashboard:** Live ops overview — clocked-in count, on-break count, open/overdue tickets, total footage, locates closed, live tech board, activity feed, customer summary. Range toggle (day/week/month).
- **Techs:** Tech list with productivity metrics, tech detail page with tickets & full timesheet (sessions, break segments, worked/lunch/personal/productive totals).
- **Tickets:** Filterable ticket table with detail modal including the ticket chain panel (per-ticket minutes/footage, no cross-chain aggregation).
- **Territories:** 4-level territory tree builder with a Leaflet map, boundary unit assignment, and user-to-territory assignments.
- **Areas:** Area management page.
- **Simulator:** Admin page to generate/reset 811Simulator tickets and view simulator stats & backend ingestion status.
- **Auth:** Login page, JWT stored in `localStorage`, `PrivateRoute` guard, `AuthContext`.

**Pages:**

| Route | Page |
|---|---|
| `/login` | Login |
| `/dashboard` | Live ops dashboard |
| `/techs` | Tech list |
| `/techs/:id` | Tech detail (tickets + timesheet) |
| `/tickets` | Ticket table |
| `/areas` | Area management |
| `/territories` | Territory tree builder |
| `/simulator` | 811Simulator admin |

---

## Data Flow

### Inbound (811 → Backend → Mobile)

1. 811Simulator generates tickets (bulk or linked) and calls `POST /api/inbound/811/pull` on the Backend.
2. Backend's `ingestionService` pulls tickets from the simulator, maps them to local schema, resolves lineage & territory chain, and upserts them.
3. Backend's `assignmentService` auto-assigns unassigned tickets to a tech in the resolved tech territory.
4. Mobile app's `SyncEngine.pullTickets()` calls `POST /api/sync/pull` and applies deltas to local WatermelonDB (server version wins only if newer AND no pending local outbox events).

### Outbound (Mobile → Backend → 811)

1. Tech performs an action in the mobile app → writes to WatermelonDB + queues an `outbox_events` row (P0 for ticket status/note/attachment, P1 for clock events).
2. `SyncEngine.flushP0()` / `flushP1()` sends batches to `POST /api/sync/events` with JWT auth and automatic token refresh.
3. Backend applies events idempotently (per `requestId`), updates ticket state, records `ticket_events` history, records `utility_production_ledger` deltas, and queues outbound 811 events for closures.
4. Backend's `outbound811Service` pushes closure responses back to the 811Simulator every 30s.

### Live ops (Backend → Web Portal)

- Portal polls REST endpoints via TanStack Query (30s/60s intervals) and subscribes to a Server-Sent Events stream (`/api/ops/events`) for real-time updates powered by an in-process `opsEventBus`.

---

## Key Concepts

### Linked Tickets (Chain Model)

811 workflows produce ticket *chains*: an original locate request followed by updates, remarks, no-responses, recalls, corrections, and emergencies. Each ticket carries lineage columns:

| Column | Rule |
|---|---|
| `ticket_type` | `ORIGINAL \| UPDATE \| UPDATE_REMARK \| NO_RESPONSE \| RECALL \| CORRECTION \| EMERGENCY` |
| `root_ticket_id` | Chain head (equals own id for originals) |
| `parent_ticket_id` | Direct predecessor (null for originals) |
| `sequence_number` | 1 for original, N+1 per subsequent |
| `external_root_number` | Shared human ticket number across the chain |

**Linkage is for history/visibility only.** Each ticket remains independent for field work, time, footage, notes, photos, assignment, and billing — no service aggregates across a chain. Ticket numbering: originals use `MMYY-AREA-NNNNNN` (e.g. `1126-ROCK-000123`); linked tickets use `{base}-R{n}` (e.g. `-R1`, `-R2`).

### Status Machine

Ticket locator status transitions are enforced in `statusMachine.ts`:

```
ASSIGNED → ENROUTE → ONSITE → PAUSED → ONSITE (loop)
                                    └→ CLOSED / UNABLE (terminal, set during closeout)
```

Never set status directly — always go through `canTransitionStatus()`.

### Outbox Pattern

The mobile app never mutates server state directly. Every change creates a P0 (ticket) or P1 (clock) outbox event in WatermelonDB. `SyncEngine` flushes these in priority order with retries (max 10), timeouts (30s), and batch limits (100). The Backend deduplicates by `requestId` for idempotency.

### Territory Hierarchy

A 4-level geo-hierarchy drives both ticket routing and data visibility:

```
District → Area → Supervisor Territory → Tech Territory
```

Each ticket's lat/lng resolves to a tech territory at ingestion time. Techs see tickets in their territories; supervisors see their supervisor territory; area managers see their area; managers see everything. Boundary units (Texas cities/counties from a GeoJSON file) provide precise point-in-territory matching with bbox fallback.

---

## Prerequisites

- **Node.js** ≥ 20
- **pnpm** ≥ 10 (`corepack enable && corepack prepare pnpm@latest --activate`)
- **Android Studio** or **Xcode** (for mobile dev builds — one-time `expo run:android`/`run:ios`)
- **Expo dev client** installed on the target device/emulator

---

## Getting Started

```bash
# 1. Install all workspace dependencies
pnpm install

# 2. Start the server-side stack (811Sim + Backend + Web portal)
pnpm dev:server   # in one terminal — most common for backend work

# 3. (Optional) Start the web portal separately
pnpm dev:web      # http://localhost:5173

# 4. (Optional) Seed the Backend DB with sample tickets
pnpm seed

# 5. (Mobile) Run Expo directly — NOT via turbo/pnpm dev:mobile
cd Locate720 && npx expo start
```

> **Mobile dev note:** Always run Expo directly (`cd Locate720 && npx expo start`). Turbo captures stdout in non-TTY mode, which strips Expo's interactive UI and QR code. A dev build (`expo-dev-client`) must be installed on the device/emulator first via `npx expo run:android` or `npx expo run:ios` (one-time per device).

### Workspace Scripts

| Command | Description |
|---|---|
| `pnpm dev` | Start 811Sim + Backend + L720Ops |
| `pnpm dev:all` | Start everything including Expo (not recommended) |
| `pnpm dev:server` | Start 811Sim + Backend (most common) |
| `pnpm dev:sim` | Start only 811Simulator (port 4100) |
| `pnpm dev:backend` | Start only Backend (port 3000) |
| `pnpm dev:web` | Start only L720Ops (port 5173) |
| `pnpm dev:mobile` | Start Locate720 directly (no turbo wrapper) |
| `pnpm build` | Build all buildable packages (L720Ops) |
| `pnpm lint` | Lint all packages |
| `pnpm seed` | Seed Backend DB with tickets |
| `pnpm reset` | Reset Backend DB |

### Per-Package

```bash
pnpm --filter locate720-backend dev
pnpm --filter locate720-backend seed
pnpm --filter l720ops build
pnpm --filter locate720 android    # expo run:android
pnpm --filter locate720 ios        # expo run:ios
```

---

## Project Structure

```
LocateMVP/
├── 811Simulator/          # Fake 811 dispatch center (Fastify, TS, port 4100)
│   └── src/
│       ├── db/            # SQLite schema, seed
│       ├── domain/        # areas, generator, scope, statusLogic
│       ├── routes/        # tickets, responses, metrics, ops
│       └── services/      # dispatchNotifier
├── Backend/               # Core API server (Express, ESM JS, port 3000)
│   └── src/
│       ├── db/            # SQLite schema, territories, boundary units, geo-seed
│       ├── routes/        # tickets, users, auth, sync, timesheet, inbound, ops, territories
│       ├── services/      # ingestion, assignment, territory, ticketChain, outbound811, idempotency, conflictDetection
│       ├── utils/         # logger, opsEventBus, permissions, range
│       ├── validation/    # eventValidator, statusMachine
│       └── scripts/       # seedUsers, resetDatabase
├── Locate720/             # Field tech mobile app (Expo, RN, WatermelonDB)
│   ├── app/               # expo-router file-based routes
│   └── src/
│       ├── config/        # API config
│       ├── db/            # schema, migrations, models, database, seed
│       ├── features/
│       │   ├── auth/      # AuthContext, devSession
│       │   ├── tickets/   # components, domain, store, sync, utils, data, types
│       │   └── timesheet/ # components, utils, types
│       ├── ui/            # colors
│       └── utils/         # date, fetchWithTimeout, logger, validation
├── L720Ops/               # Web admin portal (React 19, Vite, port 5173)
│   └── src/
│       ├── components/    # auth, features, layout, territories, ui, users
│       ├── contexts/      # AuthContext
│       ├── hooks/         # useAuth, useOpsEvents, useRange
│       ├── lib/           # opsClient
│       ├── pages/         # areas, auth, dashboard, simulator, techs, territories, tickets
│       ├── services/      # auth, backend, dashboard, ops, reports, simulator, techs, territory, tickets
│       └── types/         # API, auth, common, ops, simulator, tech, territory, ticket
├── package.json           # Workspace root (turbo scripts)
├── pnpm-workspace.yaml    # Workspace packages
├── turbo.json             # Turborepo task config
└── AGENTS.md              # AI agent guide & architecture rules
```

---

## Configuration

### Backend

| Variable | Default | Location | Notes |
|---|---|---|---|
| `PORT` | `3000` | `Backend/src/server.js` | API port |
| `JWT_SECRET` | `l720-ops-secret-key` | `Backend/src/routes/ops.js` | Dev secret; set in prod |
| `ELEVEN_SIM_BASE_URL` | `http://localhost:4100` | `Backend/src/services/ingestionService.js` | 811Simulator URL |
| `SIMULATOR_URL` | `http://localhost:4100` | `Backend/src/services/outbound811Service.js` | Outbound 811 URL |

### L720Ops

Create `L720Ops/.env`:

```
VITE_API_BASE_URL=http://localhost:3000/api
VITE_SIMULATOR_API_BASE_URL=http://localhost:4100
```

### Locate720

Edit `Locate720/src/config/api.ts`:

- `API_BASE_URL` — change `http://192.168.50.245:3000/api` to your LAN IP or `localhost` (physical devices can't reach `localhost`).
- `DEV_USER_ID` — hardcoded dev user (`user-bob-123`); real auth should use the JWT user.

### 811Simulator

| Variable | Default | Location | Notes |
|---|---|---|---|
| `PORT` | `4100` | `811Simulator/src/server.ts` | Simulator port |
| `L720_BACKEND_URL` | `http://localhost:3000` | `811Simulator/src/services/dispatchNotifier.ts` | Backend webhook target |

---

## Database

All databases are SQLite-based and gitignored (runtime-only, regenerated on first run).

| Sub-system | Path | Tables (highlights) |
|---|---|---|
| 811Simulator | `811Simulator/data/sim811.sqlite` | `service_areas`, `tickets_811`, `ticket_members_811`, `ticket_event_log_811` |
| Backend | `data/locate720.db` | `users`, `areas`, `user_areas`, `tickets`, `ticket_events`, `outbox_811_events`, `day_sessions`, `clock_events`, `break_segments`, `utility_production_ledger`, `ticket_notes`, `ticket_attachments`, `territories`, `user_territory_assignments`, `boundary_units` |
| Locate720 | WatermelonDB (expo-sqlite) | `tickets`, `outbox_events`, `drafts`, `day_sessions`, `clock_events`, `ticket_notes` (schema v7) |

**Reset:**

```bash
pnpm reset                              # Backend DB
cd 811Simulator && rm -f data/sim811.*  # Simulator DB (regenerates on next start)
```

**WatermelonDB migrations:** Any local schema change in `Locate720/src/db/schema.ts` requires a matching migration in `src/db/migrations.ts` and a version bump. Schema version and migration count must stay in sync.

---

## Development Notes

- This is a **dev-only MVP**. Hardcoded values (dev JWT secret, dev user ID, machine-specific LAN IP) are documented in `AGENTS.md` and must be replaced for any production use.
- The 811Simulator uses deterministic scope geometry (SHA-256 seeded) so ticket bounding boxes are reproducible across runs.
- The Backend runs two 30-second intervals: one for inbound 811 ingestion + auto-assignment, one for outbound 811 event processing.
- The mobile app's `SyncEngine` is a singleton with constants that should not be changed casually: `MAX_BATCH_SIZE=100`, `MAX_RETRY_COUNT=10`, `REQUEST_TIMEOUT_MS=30000`, `PULL_THROTTLE_MS=60000`.
- The web portal uses TanStack Query with 30s/60s refetch intervals plus an SSE stream for near-real-time updates; the SSE bus holds no replay buffer (missed events fall back to polling).
- See `AGENTS.md` for the full AI coding agent guide, architecture rules, and the list of files that should not be changed without explicit instruction.
