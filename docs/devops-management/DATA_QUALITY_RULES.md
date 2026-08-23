# DevOps Data Quality Rules

The `/api/ops/data-quality` endpoint runs read-only validation for district managers.

| Rule | Severity | Condition |
|---|---|---|
| `COMPLETED_MISSING_CLOSED_AT` | ERROR | Closed ticket has no completion timestamp |
| `COMPLETED_CUSTOMER_MISSING_STATUS` | ERROR | Closed customer has no outcome/status |
| `MARKED_CUSTOMER_MISSING_FOOTAGE` | WARN | Marked outcome has zero/invalid footage |
| `OVERLAPPING_TIMESHEET_SESSIONS` | ERROR | Same technician has overlapping sessions on a day |
| `DUPLICATE_ACTIVE_SESSIONS` | ERROR | Technician has more than one active session |
| `TICKET_WITHOUT_TECH` | WARN | Active ticket has no assigned technician |
| `TECH_WITHOUT_SUPERVISOR` | WARN | Active field user lacks supervisor assignment |
| `SUPERVISOR_WITHOUT_AREA_MANAGER` | WARN | Supervisor lacks area territory ownership/assignment |
| `CUSTOMER_WITHOUT_UTILITY_TYPE` | ERROR | Active catalog customer has no utility type |

Checks are diagnostic only. They do not repair records or silently change metric inputs. Results are capped by a caller-controlled limit and include issue type counts.
