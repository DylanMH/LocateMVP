# Repo Map — LocateMVP

## Top-Level Structure

```
LocateMVP/
├── 811Simulator/     # Fake 811 dispatch center (TypeScript, Fastify, port 4100)
├── Backend/          # Core API server (Node.js/Express, port 3000)
├── Locate720/        # Field tech mobile app (Expo/React Native)
├── L720Ops/          # Web admin portal (React/Vite, port 5173)
├── docs/             # Handoff and reference docs
├── AGENTS.md         # AI coding agent guide (this project's rules)
└── .windsurf/        # Windsurf IDE config and workflows
```

---

## 811Simulator/

```
811Simulator/
├── src/
│   ├── server.ts           # Fastify server entry — registers all routes
│   ├── db/
│   │   └── db.ts           # better-sqlite3 instance, schema init
│   ├── domain/             # Ticket generation logic, area definitions
│   └── routes/
│       ├── tickets.ts      # GET /api/811/tickets — mobile pull endpoint
│       ├── responses.ts    # POST responses from Backend back to 811
│       ├── metrics.ts      # GET metrics/stats
│       └── ops.ts          # Full CRUD for 811 ticket management (L720Ops simulator page)
└── package.json            # Scripts: dev (tsx watch), start
```

**Key facts:**
- Tickets are stored in `tickets_811` and `ticket_members_811` tables
- The Backend calls `GET /api/811/tickets?since=<timestamp>` to pull new tickets
- `ops.ts` is what the L720Ops `/simulator` page talks to (via `VITE_SIMULATOR_API_BASE_URL`)

---

## Backend/

```
Backend/
├── src/
│   ├── server.js           # Express app entry — seeds users, registers routes, starts intervals
│   ├── db/
│   │   └── database.js     # better-sqlite3 init, table creation (tickets, users, ticket_events, outbox_811_events)
│   ├── routes/
│   │   ├── tickets.js      # GET/PATCH /api/tickets — basic ticket CRUD
│   │   ├── users.js        # GET /api/users — user management
│   │   ├── sync.js         # POST /api/sync/events — receives outbox events from mobile
│   │   ├── timesheet.js    # POST /api/timesheet/events — receives clock events from mobile
│   │   ├── inbound.js      # POST /api/inbound/811/pull — manual 811 ingestion trigger
│   │   └── ops.js          # /api/ops/* — JWT-gated endpoints for L720Ops portal
│   └── services/
│       ├── ingestionService.js     # Pulls tickets from 811Simulator, upserts into local DB
│       ├── assignmentService.js    # Assigns tickets to techs by area (round-robin by workload)
│       ├── outbound811Service.js   # Queues and sends outbound events back to 811Simulator
│       ├── conflictDetection.js    # Checks if a ticket has pending local changes before overwrite
│       └── idempotencyService.js   # Deduplication for sync events by requestId
└── package.json                    # Scripts: dev, seed, reset
```

**Key facts:**
- `server.js` auto-seeds 5 test users on first run (Bob/Alice/Charlie/Diana/Evan)
- Auto outbound 811 processing runs every 30s via `setInterval`
- Auto 811 inbound polling is **commented out** — use `POST /api/inbound/811/pull` manually
- All routes import `{ db }` from `../server.js`
- JWT secret: `l720-ops-secret-key` (any username/password accepted in dev)

**Backend DB tables:**
- `users` — id, name, email, role (TECH/SUPERVISOR/MANAGER), areaId
- `tickets` — id, external_ticket_id, ticket_number, status, locator_status, assigned_tech_id, version, payload_json, source
- `ticket_events` — audit trail
- `outbox_811_events` — outbound events queue to 811Simulator

---

## Locate720/ (Mobile App)

```
Locate720/
├── app/                            # expo-router screens (file = route)
│   ├── _layout.tsx                 # Root layout — AuthProvider, AuthGuard, Stack nav
│   ├── login.tsx                   # Login screen — hardcoded user list, writes to AsyncStorage
│   ├── index.tsx                   # Redirects to tickets tab
│   ├── (tabs)/
│   │   ├── _layout.tsx             # Bottom tab bar (Tickets, Timesheet, Profile)
│   │   ├── tickets.tsx             # Main ticket list screen — WatermelonDB query + SyncEngine
│   │   ├── timesheet.tsx           # Clock in/out, breaks, timesheet display
│   │   └── profile.tsx             # User profile, logout, debug info
│   └── ticket-details/
│       └── [id].tsx                # Ticket detail screen — status actions, customer markings, closeout
├── src/
│   ├── config/
│   │   └── api.ts                  # API_BASE_URL (⚠️ has machine-specific IP), ENDPOINTS, DEV_USER_ID
│   ├── db/
│   │   ├── database.ts             # WatermelonDB instance singleton
│   │   ├── schema.ts               # WatermelonDB schema — version 4, 5 tables
│   │   ├── migrations.ts           # Schema migrations v1→v4
│   │   ├── models/
│   │   │   ├── Ticket.ts           # WatermelonDB Ticket model with @field decorators
│   │   │   ├── OutboxEvent.ts      # Outbox queue model
│   │   │   ├── DaySession.ts       # Clock session model
│   │   │   ├── ClockEvent.ts       # Individual clock event model
│   │   │   └── Draft.ts            # Draft save model (customer markings draft)
│   │   ├── clearTickets.ts         # Dev utility to wipe tickets from DB
│   │   └── seed.ts                 # Dev seed data
│   ├── features/
│   │   ├── auth/
│   │   │   ├── AuthContext.tsx     # Auth state — user, login(), logout() via AsyncStorage
│   │   │   └── devSession.ts       # setCurrentUser() — dev helper to track current user
│   │   ├── tickets/
│   │   │   ├── types.ts            # All ticket domain types (TicketStatus, Customer, etc.)
│   │   │   ├── components/
│   │   │   │   ├── TicketCard.tsx          # Ticket list card (memo-wrapped)
│   │   │   │   ├── CustomersTab.tsx        # Per-customer marking UI in detail view
│   │   │   │   ├── AllocationReconcileModal.tsx  # Enforces all time allocated before close
│   │   │   │   ├── FilterChips.tsx         # OPEN/CLOSED + MINE/ALL filter UI
│   │   │   │   ├── TicketsHeader.tsx       # Header with sync badge
│   │   │   │   ├── SyncBadge.tsx           # Shows sync state (synced/pending/offline)
│   │   │   │   ├── StatusPill.tsx          # Colored status chip
│   │   │   │   ├── DetailTabs.tsx          # Tab switcher for detail screen
│   │   │   │   ├── CustomerStatusSection.tsx
│   │   │   │   ├── AttachmentsTab.tsx
│   │   │   │   ├── NotesTab.tsx
│   │   │   │   ├── MarkingInstructionsCard.tsx
│   │   │   │   ├── SectionCard.tsx
│   │   │   │   └── SegmentedToggle.tsx
│   │   │   ├── domain/
│   │   │   │   ├── statusMachine.ts        # ⚠️ DO NOT EDIT — transition rules
│   │   │   │   ├── outbox.ts               # createOutboxEvent() helper
│   │   │   │   ├── dueColor.ts             # Due-date color logic
│   │   │   │   └── formatters.ts           # Status/type label formatters
│   │   │   ├── sync/
│   │   │   │   └── SyncEngine.ts           # ⚠️ SENSITIVE — offline sync singleton
│   │   │   ├── store/
│   │   │   │   └── ticketsStore.ts         # Legacy in-memory store (not used by main screens)
│   │   │   ├── data/
│   │   │   │   └── seedTickets.ts          # Legacy seed data (used by ticketsStore only)
│   │   │   └── utils/
│   │   │       ├── ticketTime.ts           # ⚠️ DO NOT EDIT — all time calculations
│   │   │       ├── ticketSorting.ts        # Ticket list sort order (ONSITE > ENROUTE > type > due)
│   │   │       └── uuid.ts                 # createRequestId() helper
│   │   └── timesheet/
│   │       ├── types.ts            # ClockEventType, SessionStatus, BreakStatus types
│   │       ├── components/         # Timesheet UI components
│   │       └── utils/
│   │           ├── breakStatus.ts  # checkUserBreakStatus() — DB query to check break state
│   │           └── validation.ts   # Active ticket validation helpers
│   └── utils/
│       ├── fetchWithTimeout.ts     # fetch() wrapper with 30s default timeout
│       ├── validation.ts           # Input sanitization + response structure validation
│       ├── logger.ts               # logger.log/warn/error — dev-only log gating
│       └── date.ts                 # Date formatting utilities
├── app.json                        # Expo config (name, plugins, android/ios settings)
├── babel.config.js                 # Babel with decorators (needed for WatermelonDB @field)
├── global.css                      # NativeWind global styles
└── tailwind.config.js              # Tailwind/NativeWind config
```

**WatermelonDB tables (schema v4):**
| Table | Purpose |
|---|---|
| `tickets` | Local copy of assigned tickets from backend |
| `outbox_events` | Queued changes waiting to sync (P0=tickets, P1=clock) |
| `drafts` | Saved customer marking drafts per ticket |
| `day_sessions` | Daily clock-in/clock-out sessions |
| `clock_events` | Individual clock/break events within a session |

---

## L720Ops/ (Web Admin Portal)

```
L720Ops/
├── src/
│   ├── App.tsx                     # Router, QueryClientProvider, AuthProvider
│   ├── main.tsx                    # React DOM entry point
│   ├── index.css                   # TailwindCSS v4 base styles
│   ├── pages/
│   │   ├── auth/LoginPage.tsx      # Login form — any user/pass works in dev
│   │   ├── dashboard/DashboardPage.tsx  # Ticket stats, area breakdown
│   │   ├── techs/TechsPage.tsx     # List techs, see their ticket counts
│   │   ├── tickets/TicketsPage.tsx # Filter/view/reassign tickets
│   │   └── simulator/SimulatorPage.tsx  # Control 811Simulator: create tickets, set responses
│   ├── components/
│   │   ├── auth/PrivateRoute.tsx   # Redirects to /login if no token
│   │   └── layout/MainLayout.tsx   # Sidebar nav + main content wrapper
│   ├── services/
│   │   ├── authService.ts          # POST /api/ops/auth/login — JWT login
│   │   ├── ticketsService.ts       # GET/PUT /api/ops/tickets/*
│   │   ├── techsService.ts         # GET /api/ops/techs, /api/users
│   │   ├── dashboardService.ts     # GET /api/ops/dashboard/stats
│   │   ├── simulatorService.ts     # All calls to VITE_SIMULATOR_API_BASE_URL (port 4100)
│   │   └── reportsService.ts       # GET /api/ops/reports/*
│   ├── contexts/AuthContext.tsx    # JWT token storage in localStorage
│   ├── hooks/                      # Custom React hooks
│   └── types/                      # TypeScript type definitions (7 files)
├── .env                            # VITE_API_BASE_URL + VITE_SIMULATOR_API_BASE_URL
└── vite.config.ts                  # Vite + @tailwindcss/vite plugin
```

---

## Where Key Logic Lives

| What | Where |
|---|---|
| Ticket status transitions | `Locate720/src/features/tickets/domain/statusMachine.ts` |
| All time calculations (onsite, enroute, paused) | `Locate720/src/features/tickets/utils/ticketTime.ts` |
| Sync/outbox engine | `Locate720/src/features/tickets/sync/SyncEngine.ts` |
| WatermelonDB schema | `Locate720/src/db/schema.ts` |
| WatermelonDB migrations | `Locate720/src/db/migrations.ts` |
| Backend DB initialization | `Backend/src/db/database.js` |
| Ticket ingestion from 811 | `Backend/src/services/ingestionService.js` |
| Ticket auto-assignment | `Backend/src/services/assignmentService.js` |
| Outbound to 811 | `Backend/src/services/outbound811Service.js` |
| L720Ops auth | `Backend/src/routes/ops.js` (POST /api/ops/auth/login) |
| Mobile auth | `Locate720/src/features/auth/AuthContext.tsx` |
| API config + DEV_USER_ID | `Locate720/src/config/api.ts` |
| Break status DB query | `Locate720/src/features/timesheet/utils/breakStatus.ts` |
| Input sanitization | `Locate720/src/utils/validation.ts` |
| Logging | `Locate720/src/utils/logger.ts` |

---

## Safe to Edit for Current Tasks

These files are the primary targets for the next set of improvements:

- `Locate720/src/features/tickets/sync/SyncEngine.ts` — add `setCurrentUser()` method, wire auth user
- `Locate720/app/(tabs)/tickets.tsx` — call `SyncEngine.setCurrentUser()`, optimize break status queries
- `Locate720/src/features/timesheet/utils/breakStatus.ts` — query consolidation
- `Locate720/src/config/api.ts` — update `API_BASE_URL` for your dev machine

---

## Sensitive / Avoid Unless Specifically Tasked

| File | Why |
|---|---|
| `Locate720/src/db/schema.ts` | Schema version change requires migration — coordinated change |
| `Locate720/src/db/migrations.ts` | Must match schema version exactly |
| `Locate720/src/features/tickets/sync/SyncEngine.ts` | Core sync logic — any bug breaks offline data integrity |
| `Locate720/src/features/tickets/domain/statusMachine.ts` | Business rules — wrong transitions break field workflow |
| `Locate720/src/features/tickets/utils/ticketTime.ts` | All time math — bugs here cause incorrect billing data |
| `Backend/src/server.js` (user seeding section) | Mobile app hardcodes `user-bob-123` — breaking these breaks mobile |
| `Backend/src/db/database.js` | Table schema — changes require data migration |
| `L720Ops/.env` | API URLs — changing breaks web portal |
