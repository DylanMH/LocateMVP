# Current DevOps Audit

## Audit Status

Phase 0 baseline completed on the `feat/devops-v1.5` branch. This is a code-structure audit; production/server data quality still requires a read-only database inspection with approved access.

## What Exists

### Portal

The portal is a React 19/Vite application with a shared authenticated layout and TanStack Query. Existing management surfaces are:

- Dashboard with range toggle, live technician board, recent activity, area summary, and top customer production.
- Technician list and technician detail with tickets, route, and timesheet data.
- Ticket/map view with detail, assignment, bulk assignment, CSV export, and live locations.
- Territory administration.
- 811 simulator controls.

`OpsService` already centralizes calls for dashboard, technician, ticket, customer-summary, and canonical `/me` APIs. The portal does not yet expose the plan's dedicated customer, analytics, hierarchy drilldown, daily timeline, supervisor, area-manager, or district-manager experiences.

### Backend

The Backend already provides a broad Ops router. It includes dashboard aggregates, technician/ticket detail, timesheet summaries, production/customer summary, assignment/status operations, user and area administration, map/location data, and canonical role-scoped `/me` endpoints.

The Ops router has 41 route declarations and is responsible for both read and write concerns. This is the primary maintainability risk for the expansion; new analytics should be implemented as testable services and DTOs rather than increasing route-level calculation duplication.

### Authorization and hierarchy

The role set is canonical and includes `TRAINEE`, `TRAINER`, `TECH`, `SUPERVISOR`, `AREA_MANAGER`, and `DISTRICT_MANAGER`. `permissions.js` defines team/organization permissions, and `territoryService.js` provides server-side ticket visibility helpers.

The territory model is explicit and supports district, area, supervisor territory, and tech territory nodes. Users can have territory assignments. Legacy `users.area_id`, `users.supervisor_id`, `areas.manager_id`, and `user_areas` remain in the database, so the expansion must define which relationship is authoritative and how legacy records are migrated/backfilled.

A notable authorization gap is that `canViewTimesheet()` currently grants self access and district-manager access, but returns false for supervisor and area-manager subordinate access pending database checks. This must be resolved before broad timesheet drilldown is exposed.

### Timesheet data

The database has normalized session/event tables: `day_sessions`, `clock_events`, `break_segments`, and `allocation_segments`, indexed by user/date and session. The existing technician timesheet endpoint returns sessions, breaks, allocation segments, allocation breakdown, and aggregate durations.

The current API is a range summary, not a canonical day timeline that safely correlates ticket and timesheet streams. The plan's daily timeline and historical date navigation require a separate contract with explicit timezone and overlap/null rules.

### Ticket and production data

Tickets contain status, locator status, assignment, due/closed timestamps, rich `payload_json`, and independent linked-ticket lineage. `utility_production_ledger` stores customer-level minutes, footage, completion deltas, and occurrence timestamps. Existing queries calculate closed locates, utility minutes, footage, LPH, and FPH.

The linked-ticket rule is important: chain linkage is history/visibility only. Metrics must aggregate each operational ticket independently and must not roll up time, footage, notes, photos, or billing across a chain.

### Customer data

The current customer summary groups ledger rows by `customer_name` and `utility_type`. Ticket detail reconstructs customer rows from `payload_json` and merges marking data. No standalone stable customer catalog table is present in the inspected schema.

This does not satisfy the plan's stable customer ID, code, active flag, utility class, and territory relationship requirements. A catalog design must account for historical payloads, ledger references, duplicate names, and ingestion compatibility before UI work.

## Metric Audit

Existing metrics include:

- open tickets by locator status
- unassigned tickets
- tickets created/closed in range
- closed locates
- utility minutes
- footage
- worked, lunch, personal, and productive milliseconds
- LPH and FPH
- customer ticket/production summary
- due urgency on canonical DTOs

The current dashboard displays a mixture of backend aggregates and frontend derivation. For example, the dashboard derives open-ticket count by summing `ASSIGNED`, `ENROUTE`, `ONSITE`, and `PAUSED` locator statuses. This should move behind a canonical metric contract if it becomes a reporting truth.

The inspected implementation does not yet provide a complete canonical classification for fully clear, fully marked, mixed, COTP, overdue completions, ticket-type distributions, customer clear rates, or hierarchy rollups. These require a metric dictionary and deterministic test fixtures before UI implementation.

## Time Range Audit

`resolveRange()` supports `day`, `week`, `month`, `all`, and explicit `startDate`/`endDate`. Presets use server-local calendar boundaries and explicit end dates use local end-of-day. The plan calls for timezone-aware reporting and an exact `from`/`to` contract or named presets. The current contract needs to be formalized before analytics endpoints are added.

## Data Quality Risks to Validate

The code audit identifies these risks for deterministic fixtures and read-only database checks:

- customer identity is name/type based in summary paths rather than a catalog ID
- customer outcomes are embedded in variable ticket payload shapes
- completion and closed timestamps may be absent or inconsistent
- marked footage and clear outcomes need contradiction checks
- timesheet sessions/segments may overlap or remain open
- role relationship fields and territory assignments can disagree
- tickets may be unassigned or lack complete territory resolution
- linked tickets must not be double-counted through chain aggregation

No production rows were modified during this audit.

## Duplicate / Stale Logic Candidates

1. Metric calculations are present in `ops.js` route helpers instead of dedicated analytics services.
2. Dashboard and technician views expose overlapping productivity calculations with different DTO shapes.
3. Customer summary is a legacy name/type grouping and should not become the canonical customer model.
4. Legacy `users.area_id`/`supervisor_id` relationships coexist with territory assignments.
5. Portal navigation and route structure do not yet reflect the full management hierarchy in the plan.
6. The permissions module contains placeholder comments/logic for subordinate timesheet access and a deprecated interpolated ticket visibility helper.

These should be confirmed with tests and call-site review before removal. Do not remove compatibility paths until consumers are migrated.

## Initial Implementation Completed

The first canonical ticket-metrics slice is now implemented in `Backend/src/services/analytics/ticketMetrics.js` and exposed through `GET /api/ops/techs/:id/metrics`. It covers fully clear, fully marked, mixed, marked-footage, and COTP calculations with backend scope checks. Existing Ops endpoints remain unchanged.

## Recommended Next Implementation Step

Continue the Phase 1 contracts before broad feature coding:

1. metric dictionary for ticket outcome, COTP, footage, time, productivity, and rollups
2. timezone-aware reporting range contract
3. stable customer catalog and historical compatibility strategy
4. scoped hierarchy response contract
5. authorization tests for supervisor, area-manager, and district-manager drilldowns
6. deterministic fixture with expected clear/marked/mixed/COTP/footage/work-hour totals
