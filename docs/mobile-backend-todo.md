# Mobile + Backend TODO

## Project Read Notes

- Mobile auth sign-out in [Locate720/app/(tabs)/profile.tsx](/d:/Desktop/LocateMVP/Locate720/app/(tabs)/profile.tsx:1) now blocks active-ticket sign-out and auto-clocks out the active session first, but the session-aware logic still lives in the profile screen instead of a shared timesheet/auth flow.
- Mobile clock/lunch flows are written to WatermelonDB and queued through `SyncEngine`, but the backend timesheet endpoint in [Backend/src/routes/timesheet.js](/d:/Desktop/LocateMVP/Backend/src/routes/timesheet.js:1) only logs events and does not persist them.
- Ticket status sync is wired through [Locate720/app/ticket-details/[id].tsx](/d:/Desktop/LocateMVP/Locate720/app/ticket-details/[id].tsx:1), [Locate720/src/features/tickets/domain/outbox.ts](/d:/Desktop/LocateMVP/Locate720/src/features/tickets/domain/outbox.ts:1), and [Backend/src/routes/sync.js](/d:/Desktop/LocateMVP/Backend/src/routes/sync.js:1). This covers ticket status changes, but not the rest of the technician activity reporting you want.
- Ticket customer/time/footage details are currently stored inside `payload_json` locally and on the backend ticket row; there is no dedicated backend reporting model yet for utility-level production metrics.
- Mobile tab navigation in [Locate720/app/(tabs)/_layout.tsx](/d:/Desktop/LocateMVP/Locate720/app/(tabs)/_layout.tsx:1) has labels only and no explicit icons yet.
- Profile data in [Locate720/app/(tabs)/profile.tsx](/d:/Desktop/LocateMVP/Locate720/app/(tabs)/profile.tsx:1) is minimal and only shows auth basics, while backend `users` data in [Backend/src/db/database-sqlite.js](/d:/Desktop/LocateMVP/Backend/src/db/database-sqlite.js:1) currently has no supervisor relationship or productivity aggregates.

## Mobile App

### Auth + Timesheet

- [x] Ensure signing out clocks the user out first.
- [x] Define sign-out behavior when the tech is clocked in and has an active ticket: block sign-out, or guide them to pause/close first.
- [x] Move sign-out flow in [Locate720/app/(tabs)/profile.tsx](/d:/Desktop/LocateMVP/Locate720/app/(tabs)/profile.tsx:1) to call a shared timesheet action instead of directly calling `logout()`.
- [x] Update [Locate720/src/features/auth/AuthContext.tsx](/d:/Desktop/LocateMVP/Locate720/src/features/auth/AuthContext.tsx:1) so auth teardown happens only after local session updates and outbox queueing succeed.
- [x] Verify the sign-out path sends a final `CLOCK_OUT` event to backend sync before clearing the dev session user.
- [x] Add edge-case handling for lunch/personal break state during sign-out.

### Timesheet Data Capture

- [x] Extend mobile event payloads where needed so customer/utility production data is not only embedded in ticket payload blobs but can also be consumed for reporting.
- [x] Add explicit sync validation for failed P1 timesheet events so user activity is not silently dropped.
- Remaining open items from this section now live in [overall-todos](/d:/Desktop/LocateMVP/docs/overall-todos:1).

### UI Mobile


- Remaining open items from this section now live in [overall-todos](/d:/Desktop/LocateMVP/docs/overall-todos:1).

### Profile

- [x] Expand profile screen to show email, name, supervisor, total tickets on board, closed tickets for the day, total footage allocated, total utilities closed, LPH, FPH, and accumulated clock-in time.
- [x] Decide which profile metrics are live backend aggregates versus values derived from local WatermelonDB for offline display.
- [x] Add refresh/loading/error states for profile metrics instead of assuming auth data is enough.

### Lunch / Break Bug

- [x] Fix the bug where clocking back in from lunch does not fully clear lunch state and ticket pages still show the user on lunch break.
- [x] Trace break-state reads across timesheet and ticket screens to ensure both use the same latest-session/latest-event logic.
- Remaining open items from this section now live in [overall-todos](/d:/Desktop/LocateMVP/docs/overall-todos:1).

### Ticket Details Data Accuracy

- [x] Verify ticket details pulls the correct customer info and work details from `payload_json` in [Locate720/app/ticket-details/[id].tsx](/d:/Desktop/LocateMVP/Locate720/app/ticket-details/[id].tsx:1).
- [x] Remove fallback logic that fabricates customer account numbers if real backend data is expected.
- [x] Confirm whether `originalTicketData.payload`, `originalTicketData.members`, and top-level payload fields are all valid current sources, then standardize on one canonical mapping.
- [x] Validate contractor, contact, marking instructions, and work type extraction against actual backend ticket payloads.
- [x] Confirm customer completion, minutes, and footage shown in [Locate720/src/features/tickets/components/CustomersTab.tsx](/d:/Desktop/LocateMVP/Locate720/src/features/tickets/components/CustomersTab.tsx:1) match what is stored in local DB and synced to backend.

## Backend

### Timesheet Persistence

- [x] Replace the placeholder logging implementation in [Backend/src/routes/timesheet.js](/d:/Desktop/LocateMVP/Backend/src/routes/timesheet.js:1) with real database persistence.
- [x] Add backend tables for day sessions, clock events, and break segments if timesheet reporting is required centrally.
- [x] Make timesheet event writes idempotent by `requestId`, similar to sync event handling.
- [x] Persist event subtype details such as reason, ticket linkage, and session status transitions.
- [x] Add read endpoints for daily/weekly session summaries and profile metrics.

### Ticket / Utility Activity Reporting

- [x] Decide whether utility-level production data remains in `tickets.payload_json` only or is also normalized into reporting tables.
- [x] Record incremental utility production when utility time/footage is saved on edit, pause, or close, without duplicating the same production again at final ticket close.
- [x] Persist and query utility statuses, per-utility minutes, per-utility footage, total ticket time, enroute time, onsite time, and paused time in a way the ops portal and mobile profile can aggregate reliably.
- [x] Add backend validation around `customerMarking` payload shape before storing analytics/reporting data.
- [x] Store ticket event history for status transitions if supervisor reporting or audit history is needed.
- [x] Expose profile/productivity endpoints for tickets on board, closed today, utilities closed, total footage, LPH, FPH, and accumulated time.

### User Data

- [x] Extend backend user data to support supervisor relationships if profile must display supervisor name.
- [x] Decide whether supervisor is a direct `users.supervisor_id`, area-based lookup, or ops-managed assignment.

## Cross-System Validation

Open validation work now lives in [overall-todos](/d:/Desktop/LocateMVP/docs/overall-todos:1).

## User added checklist
- [x] For dev purposes - if the 811 simulator database is cleared or reset, the L720 database should reflect those changes (this also might be how it works in production)

Remaining open checklist items now live in [overall-todos](/d:/Desktop/LocateMVP/docs/overall-todos:1).

