# DevOps Management Expansion — Implementation Map

## Scope

This map is the Phase 0 baseline for the independent DevOps version track (`feat/devops-v1.5`). The mobile app remains on `v1.7`; DevOps-only work must not change mobile version metadata.

## Repository Map

| Area | Location | Current responsibility |
|---|---|---|
| DevOps portal | `L720Ops/` | React 19/Vite portal for dashboard, technicians, tickets/map, territories, and simulator views |
| Backend API | `Backend/src/` | Express API, SQLite persistence, authentication, ticket operations, timesheets, territories, and Ops endpoints |
| 811 simulator | `811Simulator/` | Synthetic dispatch source; Backend ingests simulator data |
| Mobile app | `Locate720/` | Offline-first field application; not a DevOps implementation target unless a shared contract intentionally changes |
| Existing docs | `docs/` | Architecture, version audits, API contracts, and QA reports |

## DevOps Frontend Entry Points

- `L720Ops/src/App.tsx` defines routes for `/dashboard`, `/techs`, `/techs/:id`, `/map`, `/territories`, and `/simulator`.
- `L720Ops/src/components/layout/MainLayout.tsx` owns the sidebar, authenticated shell, and SSE-driven query invalidation.
- `L720Ops/src/services/opsService.ts` is the frontend API boundary.
- `L720Ops/src/types/ops.ts` contains dashboard, technician, ticket, timesheet, and customer response types.
- Existing pages are dashboard, technician list/detail, map/tickets, territories, and simulator. There are no dedicated timesheet, customer, analytics, supervisor, area-manager, or district-manager pages yet.

## Backend Entry Points

- `Backend/src/server.js` initializes the database and mounts `/api/ops/territories` and `/api/ops`.
- `Backend/src/routes/ops.js` is currently a large mixed router containing authentication, dashboard queries, technician/ticket operations, customer summary, user administration, territory-related operations, canonical `/me` endpoints, and map data.
- `Backend/src/routes/territories.js` handles territory administration.
- `Backend/src/services/territoryService.js` owns ticket visibility and territory scope helpers.
- `Backend/src/utils/permissions.js` defines roles, permissions, and middleware.
- `Backend/src/utils/range.js` resolves `day`, `week`, `month`, `all`, and explicit `startDate`/`endDate` ranges using server-local calendar boundaries.
- `Backend/src/dtos/` contains Ops DTO helpers for overview, map markers, ticket summaries, and technician summaries.

## Database / Data Model Map

Core tables in `Backend/src/db/database-sqlite.js`:

- `users`, `areas`, and `user_areas`
- `tickets` and `ticket_events`
- `day_sessions`, `clock_events`, `break_segments`, and `allocation_segments`
- `utility_production_ledger`
- `ticket_notes`, `ticket_attachments`, `tech_locations`
- `ticket_reschedules`, `contractor_email_queue`, and `idempotency_records`

Territory tables in `Backend/src/db/territories.js`:

- `territories` with `DISTRICT -> AREA -> SUPERVISOR_TERRITORY -> TECH_TERRITORY`
- `user_territory_assignments` with `OWNER`, `MANAGER`, `TECH_ASSIGNMENT`, and `TRAINER_SUPPORT`
- ticket territory foreign-key columns for district, area, supervisor, and tech scope

Current customer data is embedded in ticket `payload_json` and copied into production ledger rows. There is no canonical standalone customer catalog table identified in the current schema.

## Existing API Surface

### Frontend-consumed legacy Ops endpoints

- `GET /api/ops/dashboard/stats`
- `GET /api/ops/dashboard/tech-status`
- `GET /api/ops/dashboard/activity`
- `GET /api/ops/techs`
- `GET /api/ops/techs/:id`
- `GET /api/ops/techs/:id/tickets`
- `GET /api/ops/techs/:id/timesheet`
- `GET /api/ops/techs/:id/metrics` (initial canonical ticket outcome/COTP metrics)
- `GET /api/ops/techs-locations`
- `GET /api/ops/techs/:id/route`
- `GET /api/ops/tickets`
- `GET /api/ops/tickets/:id`
- `GET /api/ops/tickets/:id/chain`
- `GET /api/ops/customers/summary`
- `GET /api/ops/tickets/export.csv`
- ticket assignment/status mutation endpoints

### Existing canonical scoped endpoints

- `GET /api/ops/me/overview`
- `GET /api/ops/me/techs`
- `GET /api/ops/me/teams`
- `GET /api/ops/map`

These use authentication and `ops.viewTeam` permission, with scope resolved server-side. They should be evaluated for extension before adding parallel endpoints.

## Proposed Ownership / Agent Boundaries

| Workstream | Primary ownership | Must coordinate with |
|---|---|---|
| Audit and contracts | Coordinator | All workstreams |
| Canonical metrics services | Backend analytics | Timesheet, ticket, customer agents |
| Hierarchy and authorization | Backend territory/permission layer | Analytics and UI |
| Timesheet analytics | Backend timesheet services/routes | Metrics and UI |
| Ticket analytics | Backend ticket metrics | Customer and metrics agents |
| Customer catalog/analytics | Backend schema/services | Ticket ingestion and seed scripts |
| DevOps UI | `L720Ops/` | API contracts and authorization |
| Synthetic data | Backend seed scripts / simulator | Customer and analytics agents |
| QA | Tests and deterministic fixtures | Every workstream |

## High-Risk Shared Files

- `Backend/src/routes/ops.js`: currently monolithic and contains overlapping legacy/canonical endpoints.
- `Backend/src/db/database-sqlite.js`: startup schema and additive compatibility changes; database files are runtime-only.
- `Backend/src/services/territoryService.js` and `Backend/src/utils/permissions.js`: authorization scope must remain backend-enforced.
- `L720Ops/src/services/opsService.ts` and `L720Ops/src/types/ops.ts`: shared frontend API contract boundary.
- `L720Ops/src/components/layout/MainLayout.tsx` and `L720Ops/src/App.tsx`: shared navigation and routing.

## Recommended Merge Order

1. Audit and metric/API contracts.
2. Hierarchy and authorization changes.
3. Canonical ticket/timesheet/customer metric services.
4. Synthetic catalog and deterministic test data.
5. API routes and DTOs.
6. DevOps frontend pages and navigation.
7. QA, performance checks, and stale/duplicate cleanup.

Each workstream should keep changes isolated and avoid editing another workstream's high-risk files without coordination.

## Versioning

- Base: `master` at stable mobile `v1.7` merge commit `18b57d1`.
- Current DevOps branch: `feat/devops-v1.5`.
- DevOps versioning is independent. Do not bump `Locate720` or mobile release metadata for portal-only work.
- Backend changes that alter mobile sync payloads or mobile behavior require separate mobile contract review.
