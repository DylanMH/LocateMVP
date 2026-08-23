# DevOps UI Specification

The portal is organized around dense operational visibility rather than large-card dashboards.

Current management surfaces:

- Dashboard with live operations and scoped team performance for management roles.
- Field Employees and technician drilldown.
- Daily technician timesheet timeline with date selection.
- Tickets/map and territory administration.
- Customer catalog analytics with search, utility filtering, range selection, KPI summaries, and CSV export.
- District-manager-only data-quality dashboard.

Future hierarchy views should use the existing `/api/ops/me/teams` tree and preserve breadcrumbs through district, area, supervisor, technician, ticket, customer, and timesheet drilldowns. Core metric values must come from Backend analytics contracts; the UI may format and sort returned values.
