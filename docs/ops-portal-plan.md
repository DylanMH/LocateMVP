# L720Ops Portal — Implementation Plan

Source of truth for the L720 operations web portal (`@/d:/Desktop/LocateMVP/L720Ops`). Complements `docs/overall-todos` and inherits Phase 0 / Phase 4 decisions from it. The portal is the supervisor / manager / dispatcher cockpit against the Backend (`:3000`) and the 811 Simulator (`:4100`).

---

## Guiding principles

1. **One backend contract per concern.** Every aggregate endpoint takes the same `range` query (`day | week | month | all` or `startDate/endDate`) so the UI can point any page at any time window.
2. **Shared data, not page-local fetches.** React Query keys are namespaced (`["ops", "dashboard", range]`, `["ops", "techs", range, filters]`). One page's refetch invalidates everyone's cache.
3. **Push over poll where possible.** A single SSE stream `/api/ops/events` broadcasts `ticket.updated`, `tech.clock.changed`, `ticket_event.created`, `simulator.ticket.generated`. Pages subscribe via one hook and `invalidateQueries` on relevant messages. Polling remains as a 30 s fallback.
4. **Professional component layering.**
   - `components/ui/*` — primitive building blocks (Button, Metric, StatusBadge, DataTable, Drawer, Tabs, RangeToggle, EmptyState, Spinner).
   - `components/features/*` — feature-scoped composites (TicketTable, TechRow, TechProductivityPanel, TicketTimelineBar, AssignTechMenu).
   - `pages/*` — route containers that only compose features and wire URL state.
   - `hooks/*` — data hooks (`useRange`, `useOpsEvents`, `useTechsQuery`, `useTicketDetailQuery`).
   - `services/*` — HTTP clients, one per backend resource, **no React inside**.
5. **URL is the state.** Filters, range, selected ticket id, selected tab all live in the query string so deep links and browser back/forward just work.
6. **Managers can act, not just view.** Every list row exposes the management actions the user's role allows: reassign ticket, move between areas, force status change, open/close tech clock, add dispatch note, regenerate scope.

---

## Architecture

```
L720Ops (Vite + React 19 + TanStack Query v5 + Headless UI + Tailwind v4)
   │
   ├── SSE subscription ──► GET /api/ops/events (Backend :3000)
   ├── REST queries      ──► /api/ops/*        (Backend :3000)
   └── 811 simulator     ──► /api/ops/811/*    (Simulator :4100 via simulatorService)

Backend emits ops events from:
  - sync.js             (TICKET_STATUS_SET, utility ledger writes, notes, attachments)
  - timesheet.js        (CLOCK_IN/OUT, LUNCH_*, PERSONAL_*)
  - ingestionService.js (new 811 tickets, auto-assignment)
  - ops.js              (manual assignment / status changes / area moves)
```

---

## Range contract

All aggregate endpoints accept:

| Param | Values | Behavior |
|---|---|---|
| `range` | `day` | today 00:00 → now |
| | `week` | Monday 00:00 of current ISO week → now |
| | `month` | 1st of current month 00:00 → now |
| | `all` | no lower bound |
| `startDate`, `endDate` | ISO date | overrides `range`; inclusive calendar days |

Resolved server-side by a single helper `resolveRange(req)` returning `{ startMs, endMs, label }`.

---

## Phase breakdown

### Phase Ops-1 — Backend contracts (prerequisite for every UI phase)

Endpoints to add / extend in `Backend/src/routes/ops.js` (plus a small `Backend/src/utils/range.js`):

- `GET /ops/dashboard/stats?range=...` — extend with closed/created in range, total footage, total utility minutes, techs by state (clocked_in / on_lunch / on_personal / clocked_out), per-area real ticket counts.
- `GET /ops/dashboard/tech-status` — add `currentSession { clockInAt, elapsedMs, onBreak, breakType, breakStartedAt }` and `currentTicket { id, ticketNumber, locatorStatus, onsiteStartedAt, enrouteStartedAt }`.
- `GET /ops/dashboard/activity?limit=50` — latest `ticket_events` joined with ticket + user.
- `GET /ops/techs?range=...&area=&status=&search=` — full productivity row per tech.
- `GET /ops/techs/:id/summary?range=...` — ticketsOnBoard, closedInRange, footage, utility minutes, worked ms, lunch ms, personal ms, LPH, FPH, per-day series.
- `GET /ops/techs/:id/tickets?status=&range=&page=` — tech's ticket list.
- `GET /ops/techs/:id/timesheet?range=...` — day sessions + break segments.
- `PUT /ops/techs/:id` — reassign area / supervisor (manager action).
- `GET /ops/tickets?...` — add `locatorStatus`, `ticketType`, `createdAfter`, `createdBefore`, `closedAfter`, `closedBefore`, `sortBy` filters.
- `GET /ops/tickets/:id` — include `timeAllocation`, `customers[]`, `notes[]` (metadata), `attachments[]` (metadata), `productionLedger[]`.
- `PUT /ops/tickets/:id/assign` — already exists; extend to emit ops event + bump version + write ticket_event row.
- `POST /ops/tickets/bulk-assign` — body `{ ticketIds, techId }`.
- `GET /ops/tickets/export?...` — CSV.
- `GET /ops/customers/summary?range=...` — per-customer + per-utility footage / minutes / completed across all tickets.
- `GET /ops/events` — SSE stream; heartbeat every 25 s.
- `POST /ops/techs/:id/clock-in`, `/clock-out` — admin override; creates a `day_session` + `clock_event` with `reason: "OPS_OVERRIDE"`.

Event emitter: tiny in-process `EventEmitter` in `Backend/src/utils/opsEventBus.js` consumed by `routes/ops.js` SSE handler. Emission sites added to `sync.js`, `timesheet.js`, `ingestionService.js`, and `ops.js` itself.

Tests: `Backend/tests/phase-ops.test.js` covers range resolver, tech summary math, dashboard counts, SSE event delivery, bulk assign, customer summary rollup.

### Phase Ops-2 — Shared UI primitives

- `components/ui/RangeToggle.tsx` — `day / week / month / all / custom` segmented control; stores state via `useRange`.
- `components/ui/Metric.tsx` — large value + label + delta + optional icon.
- `components/ui/StatusBadge.tsx` — unified color scale for ticket status, locator status, clock status, break type.
- `components/ui/DataTable.tsx` — thin wrapper over semantic table with sort, server pagination, row click, skeleton state.
- `components/ui/Drawer.tsx` — right-side Headless UI `Dialog`.
- `components/ui/Tabs.tsx` — URL-synced tabs via `?tab=`.
- `components/ui/EmptyState.tsx`, `Spinner.tsx`, `PageHeader.tsx`.
- `hooks/useRange.ts` — URL-synced range with helpers `{ range, startDate, endDate, setRange, toQuery() }`.
- `hooks/useOpsEvents.ts` — single SSE connection; exposes `subscribe(type, handler)`; global dispatcher also invalidates the canonical query keys automatically.
- `hooks/useOpsQuery.ts` — wrapper adding sensible defaults (staleTime, retry, refetch on window focus) and integrating with `useOpsEvents`.

### Phase Ops-3 — Dashboard rework

- Metric row: Clocked In, On Break, Tickets Open, Closed (range), Total Footage (range), Avg LPH.
- Per-area cards with real scoped counts.
- Live tech board: one row per clocked-in tech showing current ticket + elapsed onsite timer (ticks client-side).
- Recent activity feed (last 50 `ticket_events`), updated via SSE.
- Top customers card (footage / minutes in range).

### Phase Ops-4 — Tickets experience

- Wire filters and URL state.
- Columns: ticket #, type, status, locator status, address, assigned tech, area, created, closed, time on ticket.
- Row actions: Assign / Reassign, Move Area (updates tech assignment implicitly), Force Close, Open detail.
- Bulk select + bulk assign.
- Ticket detail drawer with tabs: Info, Customers, Time, Notes, Attachments, History, Activity.

### Phase Ops-5 — Technicians experience

- List with productivity columns keyed off range.
- Tech detail page `/techs/:id`: header with live clock timer + current ticket, metric row, tabs for Tickets / Productivity / Timesheet / Activity.
- Manager actions: change area, change supervisor, force clock in/out, reassign tickets to another tech in bulk.

### Phase Ops-6 — Reports & exports

- `/reports` landing with daily, weekly, monthly presets. Per-tech CSV, per-customer CSV, tickets CSV.
- Implement server-side CSV streaming via `/ops/reports/*`.

### Phase Ops-7 — Permissions

- Gate each page and action by role once the parent Phase 4 role model lands. Supervisor → area-scoped views; Manager → global; Trainer → read-only summaries.

### Phase Ops-8 — Polish

- Keyboard shortcuts (`/` focuses search, `g d` go dashboard, etc.).
- Toast system for action feedback.
- Dark mode (low priority).

---

## Open decisions

- **Week / month alignment**: calendar-aligned (Mon–Sun, 1st–end). Confirmed in this plan; flip to rolling if product pushes back.
- **LPH / FPH denominator**: `worked_ms` from `day_sessions` minus lunch/personal ms. Called out in endpoint docstring so it stays consistent everywhere.
- **"Locates closed"** = `SUM(completed_delta)` from `utility_production_ledger`. **"Tickets closed"** = count of tickets whose `locator_status IN ('CLOSED','UNABLE')` within range. Both shown with clear labels.
- **Attachments**: detail endpoints return metadata only; binaries fetched lazily from `/api/sync/attachments/:id`.
- **Notes**: ops is read + dispatch-create once Phase 0 approval rule is set. MVP = read-only.
