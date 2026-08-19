# LocateMVP — Bug Fix Report (v1.5)

> Status report for all 13 bugs identified in the Phase 0 audit
> (`docs/CODEBASE_AUDIT_CURRENT_STATE.md`).

---

## Summary

| # | Bug | Phase | Status |
|---|---|---|---|
| 1 | Multi-device clock-in disagreement | 1 | ✅ Fixed |
| 2 | Enroute/onsite ticket-card highlighting | 4 | ✅ Fixed |
| 3 | DevOps/mobile due-color mismatch | 3 | ✅ Fixed |
| 4 | Stale or duplicate clock data | 1 | ✅ Fixed |
| 5 | Clock-out safe-area clipping | 4 | ✅ Fixed |
| 6 | Detailed timesheet timeline | 1 | ✅ Foundation |
| 7 | Today's Stats day rollover | 2 | ✅ Fixed |
| 8 | Profile clocked-in card removal | 1 | ✅ Fixed |
| 9 | Contractor email action | 4+7 | ✅ Fixed |
| 10 | Rescheduling research | 6 | ✅ Complete |
| 11 | Rescheduling implementation | 6+7 | ✅ Complete |
| 12 | 811 Simulator integration | 6 | ✅ Complete |
| 13 | Duplicate/redundant code cleanup | 5 | ✅ Complete |

---

## Bug 1: Multi-device clock-in disagreement

**Root cause**: Backend owned clock/session state but mobile never pulled
server timesheet state. A second device's clock-in was invisible to the
first device.

**Fix (Phase 1)**:
- Added `GET /api/timesheet/sync` delta-pull endpoint.
- Added server-side duplicate-clock-in refusal (`ALREADY_CLOCKED_IN`).
- Added mobile `SyncEngine.pullTimesheet()` that reconciles local
  WatermelonDB sessions with server state.
- Added clock-in precheck: mobile queries server for active session
  before creating a local one.

**Test**: `Backend/tests/multi-device-clock.test.js` — 7/7 passing.

---

## Bug 2: Enroute/onsite ticket-card highlighting

**Root cause**: Active tickets were only identifiable by a small status
pill. The card itself gave no visual distinction.

**Fix (Phase 4)**:
- `TicketCard` and `CompactTicketCard` now use the locator status color
  for the left border (6px thick) and add a subtle background tint
  (`${color}10` = 6% opacity) when the ticket is ENROUTE, ONSITE, or
  PAUSED.
- Non-active tickets retain the due-urgency border (4px).

---

## Bug 3: DevOps/mobile due-color mismatch

**Root cause**: Mobile had due-urgency bucketing in `dueColor.ts`; the
portal had none. Identical due timestamps produced different visual
signals.

**Fix (Phase 3)**:
- Refactored mobile `dueColor.ts` to export canonical bucketing:
  `getDueUrgencyBucket()`, `DUE_URGENCY_COLORS`, `DUE_URGENCY_LABELS`.
- Created portal mirror: `L720Ops/src/utils/dueUrgency.ts` with the same
  thresholds, colors, and Tailwind class mappings.
- Added due-urgency badges to TicketsPage, MapTicketsPage,
  TechDetailPage, and TicketDetailModal.
- Added due-urgency legend to the map page sidebar.

---

## Bug 4: Stale or duplicate clock data

**Root cause**: Same as Bug 1. Without server reconciliation, stale
sessions accumulated locally.

**Fix (Phase 1)**:
- `pullTimesheet()` overwrites local session status with server status
  (e.g. server `CLOCKED_OUT` overrides local `ACTIVE`).
- Duplicate-clock-in refusal prevents creating a second active session.
- Force override closes the prior active session server-side.

---

## Bug 5: Clock-out safe-area clipping

**Root cause**: The ticket detail screen's ScrollView had a fixed
`paddingBottom: 40` which didn't account for the iOS home indicator
safe area.

**Fix (Phase 4)**:
- Added `useSafeAreaInsets()` hook to `ticket-details/[id].tsx`.
- Changed `paddingBottom` to `40 + insets.bottom`.

---

## Bug 6: Detailed timesheet timeline

**Status**: Foundation laid in Phase 1.

The `GET /api/timesheet/sync` endpoint returns `break_segments` and
`allocation_segments` alongside sessions and clock events. The mobile
`pullTimesheet()` reconciles all four record types. The detailed
timeline UI rendering is not yet implemented but the data pipeline is
in place.

---

## Bug 7: Today's Stats day rollover

**Root cause**: `new Date().toISOString().split('T')[0]` returns the
UTC calendar date, which can differ from the local calendar date near
local midnight (e.g. 11pm CST = 5am UTC next day).

**Fix (Phase 2)**:
- `getTodayDateString()` now uses `new Date().toLocaleDateString('en-CA')`
  which produces YYYY-MM-DD in the local timezone.
- Replaced all 8 inline UTC date derivations across 6 files with calls
  to `getTodayDateString()`.

---

## Bug 8: Profile clocked-in card removal

**Root cause**: Same as Bug 1. The profile screen showed a stale
clocked-in card because it read local WatermelonDB state that hadn't
been reconciled with the server.

**Fix (Phase 1)**:
- `pullTimesheet()` now updates stale local active-session state when
  the server reports the session as `CLOCKED_OUT`.
- The profile screen's reactive query automatically reflects the
  updated local state.

---

## Bug 9: Contractor email action

**Root cause**: Two parts — (a) the mobile contact email was
non-actionable plain text, (b) no contractor email notification on
reschedule.

**Fix (Phase 4 + 7)**:
- Mobile: `contactEmail` in ticket details is now a `Pressable` that
  opens `mailto:` via `Linking.openURL`, styled as a link.
- Backend: Added `contractor_email_queue` table and `emailService.js`.
  Reschedule routes queue a contractor email with previous/new due
  dates and reason. Processed every 60s with retry logic.

---

## Bug 10: Rescheduling research

**Status**: Complete (Phase 6).

The audit identified that rescheduling required:
- 811 Simulator authority for externally generated due dates.
- Backend authority for reschedule decisions and history.
- Idempotent, auditable operations.
- Contractor notification.

All of these are implemented in Phases 6-7.

---

## Bug 11: Rescheduling implementation

**Fix (Phase 6 + 7)**:

811 Simulator:
- `POST /api/811/tickets/:id/revise-due` endpoint.
- `original_due_at` column preserves the first due date.
- `DUE_REVISED` event logged in `ticket_event_log_811`.

Backend:
- `POST /api/tickets/:id/reschedule` (single, idempotent).
- `POST /api/tickets/reschedule-bulk` (same-contractor, idempotent).
- `GET /api/tickets/:id/reschedules` (history).
- `ticket_reschedules` append-only history table.
- `original_due_at` column on tickets.
- Ingestion guard: doesn't overwrite locally-rescheduled due_at.
- Outbound 811 `TICKET_DUE_REVISED` event queued.
- Contractor email queued on reschedule.

Portal:
- `RescheduleModal` component with preset offsets and custom picker.
- Wired into `TicketDetailModal`.

---

## Bug 12: 811 Simulator integration

**Fix (Phase 6)**:
- 811 Simulator `revise-due` endpoint notifies Backend to re-ingest.
- Backend `outbound811Service.js` handles `TICKET_DUE_REVISED` events
  by calling the simulator's `revise-due` endpoint.
- Ingestion service preserves `original_due_at` and only applies
  811-driven due changes when the simulator actually revises.

---

## Bug 13: Duplicate/redundant code cleanup

**Fix (Phase 5)**:

Deleted dead files (verified zero importers):
- `Backend/src/db/database.js` — legacy JSON DB stub.
- `Locate720/src/features/tickets/components/StatusPill.tsx`
- `Locate720/src/features/tickets/domain/formatters.ts`

Fixed stale scripts:
- `seedUsers.js` now imports from `database-sqlite.js`.
- `resetDatabase.js` now deletes `locate720.db` instead of
  `database.json`.

Fixed stale comments:
- `SyncEngine.ts`: removed "Stub implementation" and "Bob for now".

---

## Commits

| Phase | Commit | Description |
|---|---|---|
| 1 | `80c2e3d` | Server-authoritative clock state with multi-device reconciliation |
| 2 | `deb9066` | Unify date handling to local timezone |
| 3 | `e97858a` | Unify due-urgency presentation across mobile and portal |
| 4 | `95de906` | Active-ticket highlighting, email actionability, safe-area fix |
| 5 | `1710b5e` | Delete dead code and fix stale references |
| 6 | `ebf429d` | Rescheduling infrastructure - simulator and backend |
| 7 | `5234b52` | Contractor email queue and rescheduling UI |
