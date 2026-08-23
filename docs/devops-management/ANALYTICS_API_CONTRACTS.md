# DevOps Analytics API Contracts — Phase 1

These contracts describe the next canonical Backend API layer. Existing endpoints should remain compatible while consumers migrate. All endpoints require the existing JWT authentication and backend-enforced territory authorization.

## Common Query Contract

Collection and aggregate endpoints accept:

```text
from=ISO-8601 timestamp, optional when preset is supplied
to=ISO-8601 timestamp, optional when preset is supplied
preset=TODAY|YESTERDAY|THIS_WEEK|LAST_WEEK|THIS_MONTH|LAST_MONTH|CUSTOM
timezone=IANA timezone, default America/Chicago in development
```

`from` is inclusive and `to` is exclusive. The server rejects malformed ranges, `to <= from`, and unsupported timezones. The response echoes resolved boundaries so the UI never has to infer them.

## Common Response Envelope

```json
{
  "range": {
    "from": "2026-08-01T05:00:00.000Z",
    "to": "2026-09-01T05:00:00.000Z",
    "timezone": "America/Chicago",
    "preset": "THIS_MONTH",
    "label": "This month"
  },
  "scope": {
    "type": "TEAM",
    "id": "authenticated-scope",
    "label": "My team"
  },
  "generatedAt": "2026-08-23T12:00:00.000Z",
  "dataQuality": {
    "issueCount": 0,
    "issues": []
  }
}
```

## Initial Endpoints

### `GET /api/ops/me/overview`

Returns the authenticated user's role-scoped operational summary. Existing endpoint is retained and should be extended only with additive fields.

Required metric groups:

- workforce: total, active, clocked-in, current allocation/state
- backlog: open, overdue, due today/soon, unassigned
- production: completed, fully clear, fully marked, mixed, footage
- time: worked and productive minutes
- rates: clear percentage, COTP, tickets/hour, footage/hour
- alerts: typed needs-attention items

### `GET /api/ops/techs/:id/metrics`

Authorization: self, direct team scope, area scope, or district scope as resolved from backend hierarchy.

Query: common range contract.

Response adds:

```json
{
  "tech": { "id": "...", "name": "...", "role": "TECH" },
  "metrics": {
    "assigned": 0,
    "completed": 0,
    "fullyClear": 0,
    "fullyMarked": 0,
    "mixed": 0,
    "clearRate": { "value": null, "numerator": 0, "denominator": 0 },
    "cotp": { "value": null, "numerator": 0, "denominator": 0 },
    "markedFootage": 0,
    "workedMinutes": 0,
    "productiveMinutes": 0,
    "ticketsPerHour": null,
    "footagePerHour": null
  }
}
```

### `GET /api/ops/team/metrics`

Returns canonical ticket outcome and COTP metrics for all field technicians under the authenticated user's territory scope. Requires `ops.viewTeam`; it accepts the common range contract and never accepts a client-supplied team owner as an authorization input.

Response metrics include `techCount`, `completed`, `fullyClear`, `fullyMarked`, `mixed`, `markedTickets`, `markedFootage`, and COTP numerator/denominator/value.

### `GET /api/ops/techs/:id/timesheets/:date`

Authorization follows the metrics endpoint. The date is interpreted in the requested timezone.

Returns daily session summaries, clipped event/segment durations, canonical totals, and a separate ordered event stream. Ticket events and timesheet events must retain their source identity; presentation correlation must not mutate records.

### `GET /api/ops/teams/:id/metrics`

Returns a supervisor or manager team aggregate plus child summaries. Child rows contain numerator/denominator fields so sorting does not depend on rounded percentages.

### `GET /api/ops/areas/:id/metrics`

Authorization requires the authenticated user to own or be assigned to the area or to be a district manager. Returns supervisor comparison rows and area totals.

### `GET /api/ops/districts/:id/metrics`

Authorization requires district-manager scope. Returns area comparison rows, district totals, backlog/overdue exposure, and trends.

### `GET /api/ops/customers`

Returns the stable customer catalog with ID, code, display name, utility type, active state, and optional territory relationship. Supports search, active filter, utility type, pagination, and stable sort.

### `GET /api/ops/customers/:id/metrics`

Returns customer ticket outcome, COTP, footage, time, overdue, and technician/supervisor/area breakdowns under the common range contract.

## Authorization Requirements

- Client-supplied manager IDs are filters only, never authorization inputs.
- Every target user, team, area, district, ticket, and customer must be checked against the authenticated user's resolved scope.
- Supervisor access is limited to subordinate technicians and team records.
- Area-manager access is limited to assigned areas and their descendants.
- District-manager access covers assigned district descendants; global access must be an explicit permission, not an implicit role shortcut in route code.
- Unauthorized targets return `404` where appropriate to avoid leaking existence, or `403` when the resource is known and access is denied, following existing API conventions.

## Compatibility and Migration

- Do not remove existing `/ops/dashboard/*`, `/ops/customers/summary`, or `/ops/me/*` endpoints until all portal callers migrate.
- New services must own calculations; route handlers should validate input, resolve scope/range, invoke services, and serialize DTOs.
- Existing legacy range parameters should be translated at the boundary and documented as deprecated once the common contract is live.
- API tests must cover role scope, empty ranges, null-rate denominators, malformed payloads, linked tickets, and deterministic metric totals.
