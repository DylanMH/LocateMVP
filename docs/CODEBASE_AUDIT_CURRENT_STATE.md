# LocateMVP — Codebase Audit: Current State (Phase 0)

> Phase 0 deliverable. This document maps the current implementation, identifies
> architectural root causes for the reported bugs, catalogs duplicate/stale code,
> and proposes an implementation order grounded in actual code findings.
>
> **No code changes have been made.** This is analysis only.

---

## 1. System Architecture

Monorepo at `D:\Desktop\LocateMVP` with four cooperating subsystems:

| Subsystem | Location | Port | Stack | Role |
|---|---|---:|---|---|
| 811 Simulator | `811Simulator/` | 4100 | TypeScript, Fastify 5, Zod, better-sqlite3 | Authoritative source of externally generated tickets & revisions |
| Core Backend | `Backend/` | 3000 | Node.js ESM, Express 4, better-sqlite3, JWT | Shared operational source of truth; ingests 811; serves mobile + ops |
| Mobile app | `Locate720/` | — | Expo 54, RN 0.81.5, React 19, WatermelonDB, NativeWind | Offline-first field client |
| Ops portal | `L720Ops/` | 5173 | React 19, Vite 7, TailwindCSS v4, TanStack Query | Dispatch/management web UI |

### 1.1 Documented data flow (README + AGENTS.md)

1. 811 Simulator creates and owns external tickets (originals + linked revisions).
2. Backend polls the simulator every 30s (`pullTicketsFrom811`) and upserts tickets.
3. Backend auto-assigns unassigned tickets (`assignUnassignedTickets`).
4. Mobile reads assigned tickets via `POST /api/sync/pull` and writes mutations through the outbox (`POST /api/sync/events`).
5. Mobile clock/timesheet events flow through a separate P1 outbox to `POST /api/timesheet/events`.
6. L720Ops reads ticket/tech state through the Backend `/api/ops/*` REST surface and subscribes to SSE for live updates.
7. On ticket closure, Backend queues an outbound 811 event (`outbox_811_events`) processed every 30s.
8. Backend also fire-and-forgets status updates (ENROUTE/ONSITE/PAUSED) to the simulator.

### 1.2 Architectural invariants (from AGENTS.md, verified against code)

- Mobile is offline-first: local WatermelonDB is the write target; outbox flushes to Backend.
- Backend is the shared operational source of truth for assigned tickets.
- Mobile must not call the 811 Simulator directly. ✅ Verified — no simulator URLs in `Locate720/`.
- Status transitions must use `canTransitionStatus()`. ✅ Verified in `ticket-details/[id].tsx`.
- Linked tickets are independent operational rows; lineage is history-only. ✅ Verified in ingestion + simulator.
- WatermelonDB schema changes require a migration. Current schema version is **8** (AGENTS.md still says 4 — stale).

---

## 2. Sources of Truth (Actual)

| Concern | Authoritative source | Where the bug lives |
|---|---|---|
| Ticket existence, type, due date, address, customers | 811 Simulator `tickets_811` | — |
| Ticket assignment, locator status, payload (markings/timeline) | Backend `tickets` | — |
| Day session / clock state | Backend `day_sessions` + `clock_events` | Mobile reads local only |
| Break segments (lunch/personal) | Backend `break_segments` | Mobile has no such table |
| Allocation segments (locating/training/etc.) | Backend `allocation_segments` | Mobile has no such table |
| Ticket event history | Backend `ticket_events` | Mobile has no pull for it |
| Outbox delivery to 811 | Backend `outbox_811_events` | — |
| 811 revision/version history | 811 Simulator `ticket_event_log_811` | No "revise due date" concept exists |

**Key gap:** Backend *is* authoritative for clock state, but the mobile app never asks Backend for it. The mobile `SyncEngine.pullTickets()` pulls ticket rows only; there is no timesheet/session reconciliation pull. This single gap is the root cause of several reported bugs (see §5).

---

## 3. Database Schemas

### 3.1 Backend (`Backend/src/db/database-sqlite.js`) — the real DB

`server.js` imports `initDatabase` from `database-sqlite.js`. Tables:

- `users` (id, name, email, password_hash, role, title, phone, area_id, supervisor_id, is_active, password_must_change, last_login_at, …)
- `areas`, `user_areas`
- `tickets` (id, external_ticket_id, ticket_number, ticket_type, address, lat, lng, status, locator_status, assigned_tech_id, version, payload_json, source, due_at, closed_by_name, closed_at, last_811_sync_at, root_ticket_id, parent_ticket_id, sequence_number, external_root_number, district/area/supervisor/tech territory ids)
- `ticket_events` (history: old/new status, locator_status, notes, payload snapshot)
- `outbox_811_events` (PENDING/SENT/FAILED, retry_count)
- `day_sessions` (user_id, date, clock_in_at, clock_out_at, clock_out_ticket_id, status ACTIVE|CLOCKED_OUT, clock_in_reason, allocation_type, other_reason)
- `clock_events` (request_id UNIQUE, session_id, user_id, event_type, occurred_at, reason, ticket_id, device_id, seq, date, clock_in_at, clock_out_at, session_status)
- `break_segments` (session_id, break_type LUNCH|PERSONAL, started_at, ended_at, start/end event request ids)
- `allocation_segments` (session_id, allocation_type, started_at, ended_at, start/end event request ids)
- `utility_production_ledger` (append-only per-customer minutes/footage/completed deltas, unique on (request_id, customer_id))
- `ticket_notes`, `ticket_attachments`, `tech_locations`, `idempotency_records`

**Notable:** Backend has `break_segments` and `allocation_segments` tables that Mobile does **not** have. Mobile models breaks/allocation via `clock_events` only. This is a structural divergence: Backend reconstructs segments from events on write, but Mobile never receives the segment records back.

### 3.2 Mobile (`Locate720/src/db/schema.ts`, version 8)

Tables: `tickets`, `outbox_events`, `drafts`, `day_sessions`, `clock_events`, `ticket_notes`.

- `day_sessions`: user_id, date, clock_in_at, clock_out_at, clock_out_ticket_id, status, clock_in_reason, allocation_type, other_reason, timestamps.
- `clock_events`: session_id, user_id, event_type, occurred_at, optional reason/ticket_id.

Migrations v2–v8 are additive (ticket_type, outbox ticket_id, day_sessions/clock_events, ticket_notes, linked-ticket lineage, composite indexes, clock-in reason/allocation). No break_segments or allocation_segments tables on mobile.

### 3.3 811 Simulator (`811Simulator/src/db/schema.ts`)

- `tickets_811` (id, ticket_number, ticket_type, status, version, area_id, due_at, address fields, lat/lng, work_type, marking_instructions, contractor_*, contact_*, payload_json, root_ticket_id, parent_ticket_id, sequence_number, external_root_number)
- `ticket_members_811` (member_code, utility_type, company_name, status, response_code, responded_at)
- `ticket_event_log_811` (generic append-only event log)
- `service_areas`

**No `original_due_at` column and no revision/due-history table.** `due_at` is a single mutable column. The simulator has no concept of "extend the life of an existing ticket" — UPDATE/UPDATE_REMARK/RECALL/NO_RESPONSE are modeled as **new linked tickets** with their own due_at, not revisions of the original's due date.

---

## 4. Duplicate / Stale / Risky Code Inventory

### 4.1 Dead code (only self-references, no consumers)

| File | Status | Evidence |
|---|---|---|
| `Backend/src/db/database.js` | **Dead — legacy JSON-file stub** | `server.js` imports `database-sqlite.js`. The JSON stub simulates a DB with string-query matching and lacks `break_segments`/`allocation_segments`/`utility_production_ledger` entirely. Any code path that accidentally imported it would silently lose data. |
| `Locate720/src/features/tickets/components/StatusPill.tsx` | **Dead** | Grep finds zero importers outside the file itself. ENROUTE/ONSITE both map to `colors.accent` (indistinguishable). |
| `Locate720/src/features/tickets/domain/formatters.ts` | **Dead** | `formatShortDateTime`, `formatShortTime`, `formatTicketTitle`, `formatTicketAddressSummary` have no consumers. Active code uses `src/utils/date.ts` (`formatDueDateTime`, `formatTime`, `formatDate`) and `ticketPresentation.ts`. |

### 4.2 Duplicate logic

| Concern | Implementations | Risk |
|---|---|---|
| Due-urgency color (mobile) | `getTicketDueAccent()` AND `getDueAccentColorFromTimestamp()` in `Locate720/src/features/tickets/domain/dueColor.ts` | Two different threshold sets & palettes in the same file. Cards use the timestamp variant; the other is unused-but-present. Confusing. |
| Status→color (portal) | `STATUS_COLORS` duplicated verbatim in `MapTicketsPage.tsx:47` and `TechDetailPage.tsx:42` | Drift risk; two copies must be hand-synced. |
| Allocation→color (portal) | Duplicated in `TechsPage.tsx:30` and `TechDetailPage.tsx:71` | Same drift risk. |
| Date formatting (mobile) | `src/utils/date.ts` (active) vs `formatters.ts` (dead) | See 4.1. |
| Ticket duration calc | `Locate720/src/features/tickets/utils/ticketTime.ts` is the intended single source; portal computes durations independently from raw payload in places | Needs parity verification during implementation. |

### 4.3 Stale terminology / docs

- `AGENTS.md` says mobile schema version is 4; actual is 8.
- `SyncEngine.ts` class comments still call the implementation a "Stub" despite performing real API work, retries, batching, and idempotency handling.
- `Locate720/src/features/auth/devSession.ts` is a legacy compatibility cache layered on top of `AuthContext`. Still wired in but redundant given `AuthContext` persists tokens directly.

### 4.4 Risky patterns

- **`due_at` overwrite on every 811 ingest.** `ingestionService.upsert811Ticket` runs `UPDATE tickets SET due_at = ?` with the simulator's `due_at` on every poll (unless `hasPendingLocalChanges` blocks). If L720 ever reschedules a ticket locally, the next 30s poll would clobber it. There is no `original_due_at` to preserve.
- **Fire-and-forget simulator status notifications.** `sync.js:527` does `fetch(...).catch(log)` for ENROUTE/ONSITE/PAUSED with no queue, no retry, no idempotency. A transient simulator outage silently drops the status update.
- **`closePriorActiveSessions` is the only multi-device clock guard** and it is one-directional: it closes prior ACTIVE sessions server-side on a new CLOCK_IN, but nothing tells the other device its session was closed.
- **No DB-level uniqueness on active sessions.** "One ACTIVE session per user" is enforced only by the transaction in `persistClockEvent`, not by a partial unique index. Safe under better-sqlite3's synchronous execution within one process, but fragile if the backend ever scales horizontally.
- **4-day ticket cleanup** (`server.js:118`) hard-deletes tickets older than 4 days plus all related rows. Acceptable for a demo/sim environment but would destroy history in production.
- **`ensureUserExists` in `timesheet.js:20`** auto-creates placeholder `TECH` users for any unknown userId. This masks bugs where mobile sends a malformed userId and pollutes the users table.
- **Seed/reset scripts target the wrong database.** `Backend/src/scripts/seedUsers.js` and `Backend/src/scripts/resetDatabase.js` both import from `../db/database.js` (the dead JSON-file stub), not `database-sqlite.js`. This means `pnpm seed` writes to `data/database.json` and `pnpm reset` deletes `data/database.json` — neither affects the real SQLite DB at `data/locate720.db`. The seeded users (John Smith, Sarah Johnson, Mike Williams, Emily Davis, David Brown) never actually make it into the running server's database via the seed script. The server's users likely come from `ensureUserExists` auto-creation and ops-portal user creation instead.

---

## 5. Suspected Root Causes for Each Reported Bug

### Bug 1 — Multi-device clock-in disagreement

**Root cause: Mobile never reconciles day-session state from Backend.**

- `Locate720/app/(tabs)/timesheet.tsx` loads today's session from local WatermelonDB `day_sessions` only.
- `SyncEngine.pullTickets()` pulls ticket rows only — there is **no** call to `GET /api/timesheet/sessions` or any timesheet pull endpoint.
- Backend **does** enforce a single active session: `closePriorActiveSessions` (`timesheet.js:255`) closes any prior ACTIVE session for the user when a new CLOCK_IN arrives. So Device B clocking in will, server-side, close Device A's session.
- But Device A is never notified. Its local `day_sessions` row stays `ACTIVE`, so it keeps rendering "clocked in" indefinitely.
- There is also no device-id generation in `AuthContext.tsx`; `device_id` on clock events is whatever the outbox sets (often null/undefined), weakening any per-device dedup.

**Files involved:** `Locate720/app/(tabs)/timesheet.tsx`, `Locate720/src/features/timesheet/utils/validation.ts`, `Locate720/src/features/timesheet/utils/breakStatus.ts`, `Locate720/src/features/tickets/sync/SyncEngine.ts` (no P1 pull), `Backend/src/routes/timesheet.js` (has sessions endpoint, unused by mobile).

### Bug 2 — Enroute/onsite ticket-card highlighting

**Root cause: Active status is shown only via a small pill; the card body has no status-specific treatment.**

- `TicketCard.tsx` & `CompactTicketCard.tsx` set the left border (4px) from `getDueAccentColorFromTimestamp(ticket.dueAt)` — i.e., **due urgency**, not active status.
- `shouldShowLocatorStatusBadge()` (`ticketPresentation.ts:31`) renders a small pill only for ENROUTE/ONSITE/PAUSED.
- The dead `StatusPill.tsx` mapped ENROUTE and ONSITE to the **same** `colors.accent`, making them visually identical even when it was used.
- There is no card-wide background/border change for "you are currently on this ticket." The active ticket is only discoverable via the small pill and the action-button `active` state on the detail screen.

**Files involved:** `Locate720/src/features/tickets/components/TicketCard.tsx`, `CompactTicketCard.tsx`, `ticketPresentation.ts`, dead `StatusPill.tsx`.

### Bug 3 — DevOps/mobile due-color mismatch

**Root cause: The two systems categorize tickets by entirely different dimensions.**

- Mobile buckets by **due-urgency** (overdue / <2h / <24h / <72h / future) via `dueColor.ts`.
- L720Ops map buckets by **locator status** (ASSIGNED/ENROUTE/ONSITE/PAUSED/CLOSED/UNABLE) via `STATUS_COLORS` in `MapTicketsPage.tsx:47` and `TechDetailPage.tsx:42`.
- The portal's `StatusBadge.tsx` is status/type-based and has **no due-urgency bucketing at all**. `dueAt` is rendered as a plain `toLocaleString()` string (`TicketsPage.tsx:400`, `MapTicketsPage.tsx:1018`, `TicketDetailModal.tsx:386`).
- Result: identical due timestamps produce no comparable visual signal between mobile and portal, and the portal never communicates urgency.

**Files involved:** `Locate720/src/features/tickets/domain/dueColor.ts`, `L720Ops/src/pages/maptickets/MapTicketsPage.tsx`, `L720Ops/src/pages/techs/TechDetailPage.tsx`, `L720Ops/src/components/ui/StatusBadge.tsx`.

### Bug 4 — Stale or duplicate clock data

**Root cause: Local-only session lookup + no server reconciliation + UTC-date mismatch.**

- Mobile `day_sessions` supports multiple rows per date and picks the latest by `created_at` (`breakStatus.ts`, `validation.ts`, `ticket-details/[id].tsx:useClockedInStatus`). If a user clocks in twice locally (e.g., after an app crash), two ACTIVE rows can coexist locally.
- Backend `clock_events.request_id` is UNIQUE and idempotency is enforced via `idempotencyService`, so duplicate *events* are deduped server-side. But the mobile local DB has no such uniqueness on session rows.
- Without a pull, the local DB accumulates sessions that Backend may have already closed via `closePriorActiveSessions`.

**Files involved:** `Locate720/src/features/timesheet/utils/breakStatus.ts`, `validation.ts`, `Locate720/app/(tabs)/timesheet.tsx`, `Locate720/app/ticket-details/[id].tsx`.

### Bug 5 — Clock-out safe-area clipping

**Suspected cause (needs UI repro to confirm):** The clock-out control lives inside a scroll container / floating card whose bottom padding does not account for the iOS safe-area inset. `ticket-details/[id].tsx` uses `KeyboardAvoidingView` with `paddingBottom: 40` on the scroll content but no `SafeAreaView` or `safeAreaInsets.bottom` usage on the action region. On devices with a home indicator, the bottom action card can be clipped. The timesheet screen's clock-out button has the same risk if it sits in a non-safe-area footer.

**Files involved:** `Locate720/app/ticket-details/[id].tsx` (ScrollView contentContainerStyle), `Locate720/app/(tabs)/timesheet.tsx`. **Confirm with a physical-device repro before fixing.**

### Bug 6 — Detailed timesheet timeline

**Root cause: Backend has the data; Mobile never asks for it.**

- Backend `buildSessionsResponse` (`timesheet.js:472`) already returns each session with its `clock_events` and `break_segments` arrays.
- `GET /api/timesheet/sessions` and `GET /api/timesheet/summary` expose this.
- Mobile `SyncEngine` never calls either endpoint. The timesheet screen renders only from local `clock_events`, which lacks break/allocation segments entirely (those tables don't exist on mobile).
- So the "detailed timeline" (locating/training/lunch/break allocation) cannot be reconstructed on mobile from local data alone.

**Files involved:** `Backend/src/routes/timesheet.js` (ready), `Locate720/src/features/tickets/sync/SyncEngine.ts` (no pull), `Locate720/app/(tabs)/timesheet.tsx`.

### Bug 7 — Today's Stats day rollover

**Root cause: Mixed UTC and local date derivation.**

- `getTodayDateString()` in `breakStatus.ts` returns `new Date().toISOString().split('T')[0]` — the **UTC** calendar date.
- Other code uses local-time notions (`new Date().setHours(0,0,0,0)`, `getHours()` in `date.ts`).
- `useClockedInStatus` in `ticket-details/[id].tsx:138` also uses the UTC `toISOString().split('T')[0]`.
- Near local midnight (e.g., 11pm CST = 5am UTC next day), the UTC date flips first, so "today's session" lookups can target the wrong calendar day, making Today's Stats blank or stale until local midnight catches up.

**Files involved:** `Locate720/src/features/timesheet/utils/breakStatus.ts`, `Locate720/app/ticket-details/[id].tsx`, `Locate720/app/(tabs)/timesheet.tsx`.

### Bug 8 — Profile clocked-in card removal

**Suspected cause:** The Profile screen's "clocked in" card is gated on the same local `day_sessions` lookup used elsewhere. When the local session is missing or stale (see Bugs 1 & 4), the card fails to render or renders incorrectly. Needs direct Profile screen inspection to confirm, but the underlying local-only session dependency is the same root cause as Bug 1.

**Files involved:** `Locate720/app/(tabs)/profile.tsx` (needs read to confirm), `breakStatus.ts`.

### Bug 9 — Contractor email action

**Root cause: Email is rendered as plain non-interactive text.**

- `ticket-details/[id].tsx:930-944` renders `contactEmail` inside a `<Text>` with no `onPress` / `Linking.openURL('mailto:...')`.
- The email is parsed correctly (`ticketPayload.ts:117`) and surfaced through `getTicketDisplayData`, but the UI never makes it actionable.
- There is also **no backend email infrastructure at all** (no SMTP, no notification queue, no mailer service — grep confirms zero matches beyond user-account email fields). So "contractor email action" in the rescheduling sense (queueing an email to the contractor) is entirely greenfield.

**Files involved:** `Locate720/app/ticket-details/[id].tsx`, `Locate720/src/features/tickets/utils/ticketPayload.ts`, `Backend/src/**` (no email service exists).

### Bug 10 — Rescheduling research

**Finding: Rescheduling does not exist in any form.**

- No `original_due_at` / `current_due_at` / `ticket_reschedules` table anywhere (grep: zero matches).
- No reschedule endpoint in Backend or simulator routes.
- The 811 Simulator's UPDATE/UPDATE_REMARK types create **new linked tickets** with fresh due dates, not revisions of an existing ticket's due date. There is no "extend due date" operation.
- `ingestionService` overwrites `due_at` on every pull, so even a manual DB edit wouldn't survive the next 30s poll.

**Implication:** Rescheduling requires (a) a new simulator "revise due" concept with version history, (b) Backend schema for `original_due_at` + append-only `ticket_reschedules`, (c) a reschedule service + route, (d) an 811 outbound queue entry type, (e) a contractor email queue (which doesn't exist), and (f) mobile/portal UI. This is the largest net-new feature in the spec.

### Bug 11 — Rescheduling implementation

See Bug 10. Greenfield. Implementation order in §7.

### Bug 12 — 811 Simulator integration (for rescheduling)

**Current simulator integration surface:**

- Inbound (sim→backend): `GET /api/811/tickets?since=&memberCode=&limit=` polled every 30s.
- Outbound (backend→sim): `POST /api/811/tickets/:id/close`, `POST /api/811/tickets/:id/assign`, `POST /api/811/tickets/:id/status`. The close path is queued+retried; assign/status are fire-and-forget.
- **Missing for rescheduling:** No `POST /api/811/tickets/:id/update` or "revise due" endpoint. No simulator-side due-history. No Positive Response / excavator-response modeling beyond member `response_code`.

**Files involved:** `811Simulator/src/routes/tickets.ts`, `811Simulator/src/domain/generator.ts` (linked tickets ≠ revisions), `Backend/src/services/outbound811Service.js`, `Backend/src/services/ingestionService.js`.

### Bug 13 — Duplicate/redundant code cleanup

Cataloged in §4. Safe removal candidates (after reference grep at implementation time): `database.js`, `StatusPill.tsx`, `formatters.ts`, the unused `getTicketDueAccent()` variant. Stale doc/terminology fixes: AGENTS.md schema version, SyncEngine "stub" comments, `devSession.ts` redundancy.

---

## 6. Recommended Architecture Changes

### 6.1 Make Backend authoritative for clock state — add a timesheet pull

Add a mobile-facing pull that reconciles day-session + clock-event + break/allocation-segment deltas from Backend. Concretely:

- Expose (or reuse) `GET /api/timesheet/sessions?userId=...&startDate=...&endDate=...` and add a `since`/`lastSyncAt` variant returning only changed sessions/events.
- Add `SyncEngine.pullTimesheet()` (P1 counterpart to `pullTickets`) that upserts server-authoritative session rows into WatermelonDB and reconciles status (e.g., a session the server closed remotely should be marked `CLOCKED_OUT` locally).
- Before allowing a local CLOCK_IN, the validation layer should refresh from server (or accept the server's `ACTIVE` session as the truth) so Device B discovers Device A's session and the server can refuse the second clock-in.

This addresses Bugs 1, 4, 6, and 8 at their root.

### 6.2 Server-side refusal of duplicate clock-in

Backend currently *silently closes* the prior session on a new CLOCK_IN. To match the spec ("Device B's second clock-in is refused by the server"), add an explicit guard: if an ACTIVE session already exists for the user on that date, reject the new CLOCK_IN with a structured error (unless the client proves it is the same session/device resending). Keep `closePriorActiveSessions` only for the legitimate "force clock-in" admin path.

### 6.3 Unify date handling

Replace `getTodayDateString()` (UTC) with a local-date helper (`new Date().toLocaleDateString('en-CA')` or a `startOfLocalDay` util) and use it consistently across timesheet, ticket-details, and stats. Add a single `src/utils/localDate.ts` and ban raw `toISOString().split('T')[0]` for "today" semantics. Addresses Bug 7.

### 6.4 Unify due-urgency presentation across mobile and portal

- Pick **one** due-urgency bucketing function and threshold set. Put it in a shared location (or mirror it identically in `L720Ops`).
- On the portal map, add a due-urgency layer/legend alongside (or instead of) the status-color scheme, so identical due timestamps yield identical urgency colors on both systems.
- Remove the dead `getTicketDueAccent()` variant from mobile.
- Addresses Bug 3.

### 6.5 Active-ticket card highlighting (mobile)

Add a card-level active-state treatment (border/background) when `ticket.locatorStatus` is ENROUTE/ONSITE/PAUSED, distinct from the due-urgency left border. Delete dead `StatusPill.tsx`. Addresses Bug 2.

### 6.6 Contractor email actionability + email queue

- Mobile: wrap `contactEmail` in a `Pressable` that calls `Linking.openURL('mailto:...')`. Quick win for Bug 9's UI half.
- Backend: add a `contractor_email_queue` table (id, ticket_id, contractor_email, subject, body, status PENDING|SENT|FAILED, retry_count, created_at, sent_at) and a stub mailer service (configurable transport; no-op/logger in dev). The reschedule flow will enqueue into this.

### 6.7 Rescheduling architecture (greenfield)

1. **811 Simulator:** add `POST /api/811/tickets/:id/revise-due` that increments `version`, preserves `original_due_at` (new column), writes a `ticket_event_log_811` entry of type `DUE_REVISED`, and returns the revised ticket. Optionally model this as a new linked UPDATE ticket instead of mutating the original — decide during implementation based on 811 semantics.
2. **Backend:** add `tickets.original_due_at` (nullable, set on first reschedule), `tickets.current_due_at` (= existing `due_at`, renamed conceptually), and an append-only `ticket_reschedules` table (id, ticket_id, previous_due_at, new_due_at, reason, approver_user_id, performed_by_user_id, excavator_response, 811_revision_state, notes, created_at). Add `POST /api/tickets/:id/reschedule` (single) and `POST /api/tickets/reschedule-bulk` (same-contractor multi-select, reject mixed contractors). Idempotency via `request_id`. Queue an outbound 811 event of type `TICKET_DUE_REVISED` and a contractor email queue entry.
3. **Ingestion guard:** stop overwriting `due_at` when `original_due_at` is set and the incoming 811 `due_at` equals `original_due_at`; only apply 811-driven due changes when the simulator itself revises (detected via version bump + event log).
4. **Mobile + Portal:** reschedule modal (+24h / +48h / custom), same-contractor multi-select, stale-ticket detection while modal is open, history visibility in ticket history tab / portal detail.

### 6.8 Observability

Add structured logs (with request ids) for: clock events, session reconciliation, timesheet sync, ticket workflow transitions, reschedule operations, 811 queue send, contractor email queue send. Much of this already exists as `console.log`/`console.error` — formalize into a logger with levels and a correlation id.

### 6.9 Stale-code removal (after reference grep)

- Delete `Backend/src/db/database.js`.
- Delete `Locate720/src/features/tickets/components/StatusPill.tsx`.
- Delete `Locate720/src/features/tickets/domain/formatters.ts`.
- Remove unused `getTicketDueAccent()` from `dueColor.ts`.
- Fix `AGENTS.md` schema version (4 → 8) and remove "stub" wording from `SyncEngine.ts` comments.
- Evaluate `devSession.ts` removal once `AuthContext` is confirmed to be the only session source.

---

## 7. Implementation Order (Grounded in Findings)

Ordered to fix root causes first and avoid rework. Each phase is independently verifiable.

### Phase 1 — Server authority for clock state (Bugs 1, 4, 6, 8)
1. Add `GET /api/timesheet/sessions` `since`/delta variant (or confirm existing endpoint suffices) returning sessions + events + break/allocation segments.
2. Add `SyncEngine.pullTimesheet()` + WatermelonDB upsert/reconcile for `day_sessions`/`clock_events`. Add a migration if new columns are needed.
3. Add server-side duplicate-clock-in refusal with a structured error code; keep `closePriorActiveSessions` only for admin force-flow.
4. Wire mobile clock-in validation to refresh server session state before allowing a new CLOCK_IN.
5. Tests: Device A clocks in → Device B sees ACTIVE → Device B clock-in refused → both converge after sync; offline clock event + reconnect; duplicate request ids.

### Phase 2 — Date unification (Bug 7)
1. Create `Locate720/src/utils/localDate.ts` with a local-day helper.
2. Replace all `toISOString().split('T')[0]` "today" usages in `breakStatus.ts`, `ticket-details/[id].tsx`, `timesheet.tsx`, `validation.ts`.
3. Test: local-midnight rollover produces the correct session lookup and Today's Stats.

### Phase 3 — Due-urgency parity (Bug 3)
1. Define the canonical bucketing function + thresholds in one place; mirror into `L720Ops`.
2. Add a due-urgency legend/layer to the portal map; render due-urgency on portal ticket rows/detail.
3. Remove dead `getTicketDueAccent()` from mobile.
4. Test: identical due timestamps yield identical urgency buckets on mobile and portal.

### Phase 4 — Active-ticket highlighting + email actionability + safe-area (Bugs 2, 5, 9-UI)
1. Add card-level active-status treatment on mobile TicketCard/CompactTicketCard.
2. Delete dead `StatusPill.tsx`.
3. Make `contactEmail` tappable (`mailto:`) on ticket-details.
4. Fix clock-out safe-area clipping (confirm with device repro first): wrap the action region in `SafeAreaView` / apply `safeAreaInsets.bottom` to padding.
5. Tests: status-card mapping for Assigned/Enroute/Onsite/Paused/Closed; email link opens mailto.

### Phase 5 — Stale-code cleanup (Bug 13)
1. Grep-verify zero references, then delete `database.js`, `formatters.ts`, `StatusPill.tsx`, unused `getTicketDueAccent`.
2. Fix `AGENTS.md` schema version; remove SyncEngine "stub" comments; evaluate `devSession.ts` removal.
3. Run full `pnpm lint` + `pnpm build` + manual smoke of all four systems.

### Phase 6 — Rescheduling: simulator + backend (Bugs 10, 11, 12)
1. Simulator: add `original_due_at` column + `POST /api/811/tickets/:id/revise-due` + `DUE_REVISED` event log. Preserve history.
2. Backend: add `tickets.original_due_at`, `ticket_reschedules` table, reschedule service + routes (single + bulk, same-contractor enforcement, idempotency). Stop overwriting `due_at` when a local reschedule exists.
3. Add `TICKET_DUE_REVISED` to the outbound 811 queue with retry/idempotency (reuse `outbox_811_events` pattern).
4. Tests: reschedule persistence, history append, 811 queue send, simulator failure + retry, duplicate request id, stale-ticket detection.

### Phase 7 — Rescheduling: contractor email + UI (Bugs 9-backend, 11)
1. Backend: add `contractor_email_queue` table + stub mailer service; enqueue from reschedule flow.
2. Mobile: reschedule modal (+24h / +48h / custom), same-contractor multi-select, stale detection, history visibility.
3. Portal: reschedule action in ticket detail / bulk action on tickets page.
4. Tests: email queue send, retry, failure; mixed-contractor rejection; repeated reschedule; original due preserved.

### Phase 8 — Documentation
1. Create `docs/ARCHITECTURE.md` reflecting the post-change architecture.
2. Create `docs/BUG_FIX_REPORT_THIS_PHASE.md` mapping each bug to its fix, files changed, and tests added.

---

## 8. Constraints Respected During This Audit

- No code changes were made. This document is the only artifact.
- No schema/migration changes.
- No `SyncEngine` constants touched.
- No seeded users modified. (Note: the actual seed file `Backend/src/scripts/seedUsers.js` seeds John Smith, Sarah Johnson, Mike Williams, Emily Davis, David Brown — **not** Bob/Alice/Charlie/Diana/Evan. The prior conversation summary's claim about seeded users was inaccurate; this audit uses the seed file as the source of truth.)
- No runtime database files modified.
- All findings above are from direct source inspection of the four subsystems.
