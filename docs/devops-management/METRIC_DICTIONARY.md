# DevOps Metric Dictionary — Phase 1 Contract

This is the initial canonical reporting contract. Implementations must use the authoritative Backend service once added; the portal may format, sort, and render returned values but must not recreate these formulas from raw records.

## Reporting Rules

- A reporting range is a half-open interval: `from <= eventTime < to`.
- All APIs must resolve ranges in an explicit IANA timezone. Until tenant timezone configuration exists, development uses `America/Chicago`.
- A ticket is counted once by its own ticket ID. Linked-ticket lineage is not an aggregation key.
- Null timestamps are excluded from duration/rate denominators and reported by data-quality checks where relevant.
- Percentages return both numerator and denominator when practical; a zero denominator returns `null`, not `0%`.
- Archived/inactive users may remain in historical reports when their events fall in range; current workforce counts use active users only.

## Ticket Outcome Classification

### Fully clear

A completed ticket with at least one customer record where every customer is completed and every customer outcome is the canonical `EXCAVATION_SITE_CLEAR` value.

`customerCount > 0 AND all completed AND all outcome = EXCAVATION_SITE_CLEAR`

### Fully marked

A completed ticket with at least one customer record where every customer is completed and every customer outcome is the canonical marking outcome.

`customerCount > 0 AND all completed AND all outcome = MARKED`

### Mixed

A completed ticket with at least one clear customer and at least one marked customer, or any combination that is neither fully clear nor fully marked.

The implementation must use canonical stored outcome enums, never display labels.

### Marked ticket count

A ticket is marked when at least one customer outcome is `MARKED`. Therefore a mixed ticket is included in marked count, while fully clear is not.

## Core Metrics

| Metric | Formula / inclusion | Source |
|---|---|---|
| Assigned tickets | Tickets assigned to the scoped user/team at the reporting snapshot or assignment event contract | `tickets` |
| Open tickets | Tickets in active locator states `ASSIGNED`, `ENROUTE`, `ONSITE`, or `PAUSED` | `tickets.locator_status` |
| Completed tickets | Tickets with authoritative completion/closed event in range | `tickets`, `ticket_events` |
| Fully clear | Completed tickets classified fully clear | ticket payload/customer records |
| Fully marked | Completed tickets classified fully marked | ticket payload/customer records |
| Mixed | Completed tickets classified mixed | ticket payload/customer records |
| Clear percentage | `fullyClear / completedEligible * 100` | derived |
| Marked percentage | `markedTickets / completedEligible * 100` | derived |
| Total marked footage | Sum of footage for marked customer outcomes | ledger/customer records |
| Average footage per marked ticket | `totalMarkedFootage / markedTicketCount` | derived |
| Average footage per marked customer | `totalMarkedFootage / markedCustomerCount` | derived |
| Completed on time | Completed ticket where completion time `<= dueAt` | `tickets.closed_at`, `tickets.due_at` |
| COTP | `completedOnTime / completedWithDueAt * 100` | derived |
| Overdue ticket | Open ticket with `dueAt < now` | `tickets.due_at`, current time |
| Overdue completion | Completed ticket with completion time `> dueAt` | `tickets.closed_at`, `tickets.due_at` |
| Average completion duration | Average `closedAt - createdAt` for eligible completed tickets | `tickets` |
| Average onsite duration | Average canonical onsite duration for tickets with valid onsite start/end | ticket payload/events |
| Total worked minutes | Sum canonical worked session durations | `day_sessions`, events/segments |
| Productive minutes | Worked minutes excluding lunch and personal time under current business rules | timesheet tables |
| Locating minutes | Sum allocation segments classified `LOCATING` | `allocation_segments` |
| Tickets per hour | Completed eligible tickets / productive hours | derived |
| Footage per hour | Marked footage / productive hours | derived |

## Time and Rollups

- Session duration is bounded by clock-in and clock-out; an active session is bounded by report `to` for an in-progress report and flagged as open.
- Break and allocation durations are clipped to the reporting range before aggregation.
- Overlapping segments must not be double-counted; overlap is a data-quality issue and requires a deterministic resolution policy in the timesheet service.
- Team, supervisor, area, and district metrics sum eligible child records, not already-rounded child percentages.
- Aggregated percentages are recomputed from aggregate numerators and denominators.
- Customer, technician, and team rollups retain the ticket's own scope and do not aggregate linked-ticket chains.

## Required Response Metadata

Every aggregate response should include:

- `range`: resolved `from`, `to`, timezone, preset/custom key, and label
- `scope`: authenticated scope type and ID/name where safe to expose
- `metrics`: named values with numerator/denominator for rates
- `dataQuality`: counts and optional issue samples
- `generatedAt`

Ambiguous averages must be named with their denominator, such as `clearTicketsPerWorkday`, `clearTicketsPerTech`, or `clearTicketsPerTechWorkday`.

## Hierarchy Rollup Metrics

The following metrics are computed at every hierarchy level (supervisor, area, district) and exposed via the comparison APIs:

| Metric | Formula | Source |
|---|---|---|
| techCount | Count of active TECH/TRAINER/TRAINEE users assigned to descendant tech territories | `users`, `user_territory_assignments` |
| completed | Sum of completed tickets for all scoped techs in range | `tickets.closed_at` |
| fullyClear | Sum of fully clear tickets for all scoped techs in range | ticket payload |
| fullyMarked | Sum of fully marked tickets for all scoped techs in range | ticket payload |
| mixed | Sum of mixed tickets for all scoped techs in range | ticket payload |
| markedFootage | Sum of marked footage for all scoped techs in range | ticket payload |
| cotp | `sum(cotpNumerator) / sum(cotpDenominator) * 100` | derived |
| clearRate | `sum(fullyClear) / sum(completed) * 100` | derived |
| openBacklog | Count of active tickets assigned to scoped techs | `tickets.locator_status` |
| overdue | Count of open tickets with `due_at < now` | `tickets.due_at` |
| workedHours | Sum of worked session durations clipped to range | `day_sessions` |
| ticketsPerHour | `completed / workedHours` | derived |
| footagePerHour | `markedFootage / workedHours` | derived |

### Hierarchy Comparison Endpoints

- `GET /api/ops/supervisors` — supervisor comparison rows within caller's scope
- `GET /api/ops/supervisors/:id/metrics` — single supervisor aggregate + per-tech child summaries
- `GET /api/ops/areas/:id/metrics` — area aggregate + per-supervisor comparison rows
- `GET /api/ops/districts/:id/metrics` — district aggregate + per-area comparison rows
- `GET /api/ops/teams/:id/metrics` — generic team metrics by territory ID (any level)

## Customer Breakdown Metrics

Customer metrics support breakdowns by technician, supervisor, area, date, and ticket type. Each breakdown row includes:

- `ticketCount` — total tickets for that customer in the group
- `completed`, `fullyClear`, `fullyMarked`, `mixed` — outcome counts
- `markedFootage` — sum of marked footage
- `cotp`, `cotpNumerator`, `cotpDenominator` — COTP values
- `clearRate` — `fullyClear / completed * 100` with numerator/denominator (where applicable)

Additional customer-level metrics:

| Metric | Formula | Source |
|---|---|---|
| openTickets | Count of customer tickets in active locator states | `tickets.locator_status` |
| clearRate | `fullyClear / completed * 100` | derived |
| averageMinutesPerTicket | Sum of customer minutes / completed ticket count | ticket payload |
| averageOnsiteMinutes | Sum of onsite durations / completed ticket count | ticket payload |
| emergencyTickets | Count of customer tickets with `ticket_type = EMERGENCY` | `tickets.ticket_type` |
| rescheduleCount | Count of customer tickets where `original_due_at != due_at` | `tickets.original_due_at`, `tickets.due_at` |

## Data Quality Rules

| Rule | Severity | Entity | Description |
|---|---|---|---|
| `COMPLETED_MISSING_CLOSED_AT` | ERROR | TICKET | Ticket status is CLOSED but `closed_at` is null |
| `TICKET_WITHOUT_TECH` | WARN | TICKET | Active ticket has no assigned technician |
| `COMPLETED_CUSTOMER_MISSING_STATUS` | ERROR | TICKET | Closed ticket customer has no outcome |
| `MARKED_CUSTOMER_MISSING_FOOTAGE` | WARN | TICKET | Marked customer has zero footage |
| `OVERDUE_COMPLETION` | WARN | TICKET | Ticket was completed after its due date |
| `ACTIVE_TICKET_MISSING_DUE_AT` | WARN | TICKET | Active ticket has no due date |
| `DUPLICATE_ACTIVE_SESSIONS` | ERROR | USER | User has multiple active day sessions |
| `OVERLAPPING_TIMESHEET_SESSIONS` | ERROR | USER | Two sessions overlap in time |
| `STALE_OPEN_SESSION` | WARN | USER | Session has been open for over 24 hours |
| `TECH_WITHOUT_SUPERVISOR` | WARN | USER | Tech has no supervisor assignment |
| `SUPERVISOR_WITHOUT_AREA_MANAGER` | WARN | USER | Supervisor has no area/territory assignment |
| `AREA_MANAGER_WITHOUT_AREA` | WARN | USER | Area manager has no area assignment |
| `CUSTOMER_WITHOUT_UTILITY_TYPE` | ERROR | CUSTOMER | Active customer has no utility type |
