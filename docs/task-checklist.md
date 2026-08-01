# Task Checklist — LocateMVP

## Status: PRODUCTION READY

**All Phase 3 production hardening tasks complete AND Backend database migrated to SQLite.** The LocateMVP system has:
- Authenticated user sync (each user sees their own tickets)
- Optimized performance (reduced DB queries)
- Robust sync with rate limiting and conflict resolution
- Successful EAS build with stable SDK 54
- Backend SQLite database with proper schema and seeded users

---

## Completed Items

### Infrastructure
- [x] 811Simulator server (Fastify/TypeScript, port 4100) — ticket generation, responses, ops routes
- [x] Backend API server (Express/Node.js, port 3000) — all routes registered
- [x] Backend DB schema — users, tickets, ticket_events, outbox_811_events tables
- [x] Backend auto-seeds 5 test users on first run (Bob, Alice, Charlie, Diana, Evan)
- [x] Ticket ingestion pipeline: 811Simulator → Backend (`ingestionService.js`)
- [x] Ticket auto-assignment by area with workload balancing (`assignmentService.js`)
- [x] Outbound 811 event pipeline: Backend → 811Simulator (`outbound811Service.js`)
- [x] Conflict detection for pending local changes (`conflictDetection.js`)
- [x] Idempotency for sync events by `requestId` (`idempotencyService.js`)

### Mobile App (Locate720)
- [x] WatermelonDB setup with expo-sqlite adapter
- [x] Schema v4 — tables: tickets, outbox_events, drafts, day_sessions, clock_events
- [x] Migrations v1→v4 all in place
- [x] All 5 WatermelonDB models defined (Ticket, OutboxEvent, DaySession, ClockEvent, Draft)
- [x] Auth via AsyncStorage + AuthContext (login/logout, persists across restarts)
- [x] Login screen with user selection (`app/login.tsx`)
- [x] Tickets list screen — WatermelonDB query, filters (OPEN/CLOSED, MINE/ALL), sorting
- [x] Ticket sorting: ONSITE > ENROUTE > Emergency/NoResponse > type > due date
- [x] Ticket detail screen (`app/ticket-details/[id].tsx`) — full detail, tabs, status actions
- [x] Status machine enforced (`statusMachine.ts`) — ASSIGNED→ENROUTE→ONSITE→PAUSED→ONSITE
- [x] Customers tab — per-customer marking (MARKED/NOT_MARKED/NOT_YET_MARKED + result)
- [x] AllocationReconcileModal — enforces all onsite minutes allocated to customers before close
- [x] Time calculations from `payload_json` timeline (`ticketTime.ts`) — onsite, enroute, paused
- [x] Timesheet screen — clock in/out, lunch break, personal break
- [x] Clock events queued as P1 outbox events and synced to backend
- [x] Profile screen — user info, logout
- [x] SyncEngine P0 flush — ticket status events → `POST /api/sync/events`
- [x] SyncEngine P1 flush — clock events → `POST /api/timesheet/events`
- [x] SyncEngine pull — `GET /api/tickets?assignedTo={userId}` → `applyTicketDeltas()`
- [x] Conflict resolution in `applyTicketDeltas()` — server only wins if version newer AND no pending outbox
- [x] Timeline field preservation during sync merge (onsiteStartedAt, pauseEvents, etc.)
- [x] Network detection — auto-flush P0 + pull when network regained

### Production Hardening (Phase 3)
- [x] `fetchWithTimeout` utility — 30s default timeout on all mobile HTTP requests
- [x] Input sanitization (`validation.ts`) — sanitizeUserId, sanitizeTicketId, etc.
- [x] Response validation (`validation.ts`) — validateTicketsResponse, validateSyncEventsResponse
- [x] `logger.ts` — dev-only `logger.log/info`, always-on `logger.warn/error`
- [x] SyncEngine batch size limit — `MAX_BATCH_SIZE = 100`
- [x] SyncEngine exponential backoff — `2^retryCount` seconds, capped at 60s
- [x] SyncEngine max retries — `MAX_RETRY_COUNT = 10`, marks FAILED after
- [x] Pull throttle — `PULL_THROTTLE_MS = 60000` (max 1 pull per 60s)
- [x] React.memo on TicketCard component
- [x] **Wire authenticated user to SyncEngine** — added `setCurrentUser()` method, called from tickets screen on auth change
- [x] **Optimize break status check** — reduced from 5 DB queries to 2 using single `Q.or()` query
- [x] **Client-side rate limiting** — added 1-second guard in `queueEvent()` to prevent burst requests

### Backend Database Migration
- [x] **Migrate Backend from JSON stub to SQLite** - created `database-sqlite.js` with proper schema, updated server.js, 60KB database with 5 users seeded
- [x] **Fix Windows path resolution** - used `process.cwd()` instead of `fileURLToPath()` to resolve duplicate drive letter issue
- [x] **Fix ops.js SQL parameter error** - corrected count query regex pattern and parameter handling for pagination in L720Ops tickets endpoint
- [x] **Add missing database columns** - added `last_811_sync_at`, `address`, `lat`, `lng` columns and updated schema constraints
- [x] **Fix ticket ingestion** - resolved schema mismatches and allowed 'OPEN' status from 811Simulator
- [x] **Fix ticket assignment** - corrected areaId lookup in payload and fixed users table column name (`area_id` vs `areaId`)
- [x] **Complete ticket workflow** - successfully ingested 38 tickets and assigned them to techs by area
- [x] **Fix L720Ops tickets page** - resolved status constraint issue and fixed tech lookup column name for proper ticket display
- [x] **Complete ticket closure flow** - added outbound 811 integration for ticket closures, Backend now updates database and sends closure to 811Simulator

### Web Admin (L720Ops)
- [x] Login page with JWT auth (any credentials in dev)
- [x] Dashboard page — ticket stats, counts
- [x] Techs page — view techs and their assignments
- [x] Tickets page — filter, view, reassign tickets
- [x] Simulator page — control 811Simulator from web UI

---

## Remaining Items

Open work from this checklist now lives in [overall-todos](/d:/Desktop/LocateMVP/docs/overall-todos:1).

---

## Validation Steps

### After wiring auth user to SyncEngine:
1. Log in as Bob in the mobile app
2. Pull down to refresh on tickets screen
3. Check network logs (or backend logs) — request URL should have `assignedTo=user-bob-123`
4. Log out, log in as Alice (`user-alice-456`)
5. Pull to refresh again — request URL should now have `assignedTo=user-alice-456`
6. Confirm Alice sees only her tickets (not Bob's)

### After optimizing break status check:
1. Clock in as a user
2. Navigate to tickets screen — should show tickets without noticeable delay
3. Start a lunch break
4. Navigate to tickets screen — should show "On Break" state without noticeable delay
5. Confirm no regression in break detection behavior

### After adding rate limiting:
1. Trigger multiple rapid ticket status changes (tap ENROUTE quickly several times)
2. Check backend logs — should not see burst of duplicate requests
3. Confirm final status does reach backend correctly after throttle window

### Full sync flow validation:
1. Start 811Simulator: `cd 811Simulator && npm run dev`
2. Start Backend: `cd Backend && npm run dev`
3. Pull tickets: `POST http://localhost:3000/api/inbound/811/pull` (use curl or L720Ops)
4. Open L720Ops at `http://localhost:5173` — login, check tickets appear
5. Open mobile app (Expo dev build), login as Bob
6. Confirm Bob's assigned tickets appear
7. Move a ticket to ENROUTE — confirm SyncEngine flushes P0 event
8. Check backend logs for sync event receipt
9. Check L720Ops tickets page — locator status should update

---

## Rollback Notes

### If SyncEngine auth wiring breaks sync:
- The change is isolated to adding one method and one field to `SyncEngineImpl`
- Rollback: revert to `DEV_USER_ID` import in the `pullTickets()` call
- Data risk: none — WatermelonDB data is local and unaffected

### If break status optimization breaks break detection:
- The current `checkUserBreakStatus()` utility is in `breakStatus.ts`
- Rollback: restore the original `checkBreakStatus()` function body in `tickets.tsx`
- Data risk: none — no DB writes involved

### If WatermelonDB schema changes are needed (future):
1. Increment `version` in `schema.ts`
2. Add migration step to `migrations.ts`
3. Test on fresh install AND on existing install (migration path)
4. If migration fails on device, the DB will be wiped and re-synced from server — data loss risk on device only (server is source of truth)

### General rollback:
- All four sub-systems are independent — you can restart any one without affecting others
- Backend DB is at `Backend/data/locate720.db` — delete it and restart to get fresh state
- WatermelonDB on device: uninstall the app and reinstall for a clean slate

