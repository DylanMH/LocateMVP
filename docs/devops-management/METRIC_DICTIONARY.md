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
