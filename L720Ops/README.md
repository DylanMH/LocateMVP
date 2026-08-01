# L720Ops — Web Admin Portal

The supervisor/manager web portal for the LocateMVP utility locate ticket management system. Provides a real-time operations dashboard, technician management, ticket oversight, territory administration, and 811Simulator controls. Talks to the [Backend](../Backend/) API over REST + Server-Sent Events, and to the [811Simulator](../811Simulator/) for its simulator admin page.

## Tech Stack

| | |
|---|---|
| **Framework** | React 19 + Vite 7 |
| **Routing** | React Router DOM v7 |
| **Styling** | TailwindCSS v4 (via `@tailwindcss/vite`) + `@tailwindcss/typography` |
| **Data Fetching** | TanStack Query v5 (+ devtools) |
| **UI Components** | Headless UI v2 + Heroicons v2 |
| **Maps** | Leaflet 1.9 + react-leaflet 5 |
| **Utilities** | `clsx`, `date-fns` |
| **Language** | TypeScript |

## Quick Start

```bash
# From the repo root (preferred — uses pnpm workspace + turbo)
pnpm install
pnpm dev:web          # http://localhost:5173

# Or standalone
cd L720Ops
pnpm install
pnpm dev
```

The Backend must be running on `http://localhost:3000` for the portal to function. Start it with `pnpm dev:backend` (or `pnpm dev:server` to also start the 811Simulator).

### Scripts

| Script | Description |
|---|---|
| `pnpm dev` | Start Vite dev server with HMR |
| `pnpm build` | Type-check (`tsc -b`) + production build (`vite build`) |
| `pnpm lint` | Run ESLint |
| `pnpm preview` | Preview the production build locally |

## Architecture

### Data Flow

```
L720Ops (browser)
    │
    ├── REST (TanStack Query) ──→ Backend /api/ops/*  (JWT in localStorage)
    │                              ↓
    │                        in-process opsEventBus
    │                              ↓
    └── SSE (EventSource) ────→ Backend /api/ops/events?token=...
                                  ↓
                            invalidates React Query cache
```

- **TanStack Query** is the primary data layer. Each query has a 30s/60s refetch interval as a fallback.
- **Server-Sent Events** drive near-real-time updates. A single SSE connection is established at the layout level (`useOpsEvents` hook) and invalidates the relevant React Query cache entries when server-side changes happen. Pages don't poll manually — they subscribe to stable query keys and trust this hook to invalidate them.
- **Auth** is JWT-based. The token is stored in `localStorage` under `auth_token`. The `AuthContext` provider handles login, logout, and token refresh. A `PrivateRoute` guard redirects unauthenticated users to `/login`.

### SSE Event → Cache Invalidation

| Event Type | React Query Keys Invalidated |
|---|---|
| `ticket.updated`, `ticket.created`, `ticket.assigned`, `ticket.note.added`, `ticket.attachment.added` | `["ops","tickets"]`, `["ops","dashboard"]`, `["ops","activity"]`, `["ops","ticket-detail"]` |
| `ticket.assigned`, `ticket.updated`, `ticket.created` | also `["ops","techs"]` |
| `tech.clock.changed`, `tech.updated` | `["ops","techs"]`, `["ops","dashboard"]`, `["ops","timesheet"]` |
| `simulator.sync` | `["ops","tickets"]`, `["ops","dashboard"]`, `["simulator"]` |

If the SSE socket disconnects, it auto-reconnects after 5s. Falls back to polling intervals if reconnection fails.

## Pages

| Route | Page | Description |
|---|---|---|
| `/login` | `LoginPage` | Email/password login with password-change flow |
| `/dashboard` | `DashboardPage` | Live ops overview (range-aware: day/week/month) |
| `/techs` | `TechsPage` | Technician list with productivity metrics |
| `/techs/:id` | `TechDetailPage` | Tech profile: tickets, timesheet, productivity |
| `/tickets` | `TicketsPage` | Filterable ticket table with detail modal |
| `/areas` | `AreasPage` | Area management |
| `/territories` | `TerritoriesPage` | 4-level territory tree builder with map |
| `/simulator` | `SimulatorPage` | 811Simulator admin (generate/reset tickets, view stats) |

### Dashboard

- **Metrics:** Clocked in, on break (lunch/personal), open tickets by locator status, unassigned, created/closed in range, total footage, locates closed, avg LPH/FPH.
- **Live Tech Board:** Real-time tech clock status & current ticket.
- **Activity Feed:** Recent ticket event audit trail.
- **Customer Summary:** Per-utility production totals.
- **Range Toggle:** Day / week / month.

### Techs

- List with live clock status, current ticket, active ticket count, and productivity (tickets on board, closed in range, footage, LPH, FPH, worked/lunch/personal/productive time).
- Detail page with full timesheet: day sessions, break segments, worked/lunch/personal/productive totals.
- Filter by area, clock status, or search.

### Tickets

- Paginated, filterable ticket table (status, area, assigned tech, source, search).
- Detail modal with ticket chain panel showing per-ticket minutes/footage (no cross-chain aggregation).
- Reassign tickets, update status, add notes, search, export.

### Territories

- 4-level hierarchy builder: District → Area → Supervisor Territory → Tech Territory.
- Leaflet map with territory boundaries and legend.
- Boundary unit assignment (Texas cities/counties from GeoJSON).
- User-to-territory assignments (techs → tech territories, supervisors → supervisor territories, etc.).

### Simulator

- Generate bulk test tickets (configurable count & area).
- Reset the 811Simulator database.
- View simulator stats & backend ingestion status.
- View/create/update/delete simulator tickets.
- Manage ticket member responses.

## Project Structure

```
L720Ops/
├── src/
│   ├── App.tsx                  # Router + QueryClientProvider + AuthProvider
│   ├── main.tsx                 # Vite entry
│   ├── index.css                # Tailwind imports
│   ├── components/
│   │   ├── auth/PrivateRoute.tsx
│   │   ├── features/            # LiveTechBoard, ActivityFeed, AssignTechMenu
│   │   ├── layout/MainLayout.tsx
│   │   ├── territories/TerritoryMap.tsx
│   │   ├── ui/                  # DataTable, Drawer, Metric, PageHeader, RangeToggle, Spinner, StatusBadge, etc.
│   │   ├── users/               # CreateUserModal, EditUserModal
│   │   ├── TicketDetailModal.tsx
│   │   └── SimulatorTicketDetailModal.tsx
│   ├── contexts/AuthContext.tsx
│   ├── hooks/                   # useAuth, useOpsEvents, useRange
│   ├── lib/opsClient.ts         # Centralized fetch helper (auth, JSON, query strings)
│   ├── pages/                   # areas, auth, dashboard, simulator, techs, territories, tickets
│   ├── services/                # authService, backendService, dashboardService, opsService, reportsService, simulatorService, techsService, territoryService, ticketsService
│   └── types/                   # API, auth, common, ops, simulator, tech, territory, ticket
├── index.html
├── vite.config.ts
├── tailwind.config.js
├── eslint.config.js
└── tsconfig.json
```

## Services

All services are static class methods in `src/services/`. Each service targets a specific Backend or Simulator API area:

| Service | Target | Purpose |
|---|---|---|
| `AuthService` | Backend `/api/ops/auth` | Login, refresh, logout, password change |
| `OpsService` | Backend `/api/ops` | Dashboard stats, tech status, activity, techs, tickets, customers |
| `TicketsService` | Backend `/api/ops/tickets` | Ticket CRUD, chain, events, reassign, status, notes, search, export |
| `TechsService` | Backend `/api/ops/techs` | Tech list, detail, tickets, timesheet, update |
| `TerritoryService` | Backend `/api/ops/territories` | Territory tree CRUD, assignments, hierarchy |
| `SimulatorService` | 811Simulator `/api/ops/811` | Generate/reset tickets, stats, ticket CRUD, member responses |
| `BackendService` | Backend `/api/inbound` | 811 ingestion status, pull trigger |
| `ReportsService` | Backend `/api/ops` | Reports & exports |
| `DashboardService` | Backend `/api/ops/dashboard` | Dashboard-specific queries |

All Backend API calls go through `src/lib/opsClient.ts` which handles:
- Auth header injection from `localStorage.getItem('auth_token')`
- JSON parsing & error normalization
- Query string building

## Configuration

Create `L720Ops/.env`:

```env
VITE_API_BASE_URL=http://localhost:3000/api
VITE_SIMULATOR_API_BASE_URL=http://localhost:4100/api
```

| Variable | Default | Purpose |
|---|---|---|
| `VITE_API_BASE_URL` | `http://localhost:3000/api` | Backend API base URL |
| `VITE_SIMULATOR_API_BASE_URL` | `http://localhost:4100/api` | 811Simulator API base URL |

## Coding Conventions

- Services are static class methods in `src/services/`.
- Components go in `src/components/` or `src/pages/`.
- All API calls use `localStorage.getItem('auth_token')` for the auth header.
- UI primitives live in `src/components/ui/` with a barrel export (`index.ts`).
- Use the centralized `opsFetch` helper from `src/lib/opsClient.ts` for all `/api/ops/*` calls.
