# DevOps QA Plan

## Automated checks

- Ticket outcome/COTP unit tests
- Team aggregation tests
- Customer catalog and customer metrics tests
- Data-quality rule tests
- Permission and territory-scope tests
- Backend syntax checks
- L720Ops TypeScript/Vite production build

## Deterministic fixtures

Fixtures must cover fully clear, fully marked, mixed, incomplete, on-time, late, overdue, multi-customer, and linked-ticket records. Linked-ticket metrics count each operational ticket independently.

## Release checks

1. Run all Backend scripts from `Backend/package.json`.
2. Run `pnpm --filter l720ops build`.
3. Verify remote branch fast-forwards to the release commit.
4. Restart PM2 Backend after Backend changes.
5. Verify `/api/health`, PM2 status, and relevant route authentication.
6. Preserve unrelated remote working-tree files.

Known limitation: L720Ops currently has pre-existing lint failures in unrelated files; a successful production build is required until those are remediated.
