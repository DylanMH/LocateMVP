# DevOps Organization Hierarchy

The canonical operational hierarchy is:

```text
DISTRICT -> AREA -> SUPERVISOR_TERRITORY -> TECH_TERRITORY -> Technician
```

Backend scope is resolved from authenticated role and `user_territory_assignments`, not client-passed manager IDs. Existing legacy `users.area_id`, `users.supervisor_id`, `areas.manager_id`, and `user_areas` remain compatibility fields and must not be used for new analytics authorization.

- Supervisors see subordinate technicians in their supervisor territories.
- Area managers see technicians under assigned areas.
- District managers see technicians under assigned districts or the organization policy defined for the tenant.
- Field users see their own records.

Every drilldown endpoint must enforce this scope server-side.
