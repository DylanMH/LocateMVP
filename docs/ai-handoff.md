# AI Handoff Document — LocateMVP

## Current Goal

Continue improving the **Locate720 mobile app** (React Native/Expo) with the remaining medium-priority production improvements and one known architectural gap.

---

## Current Status

**Phase 3 production hardening is COMPLETE.** The SyncEngine, offline-first sync, WatermelonDB integration, and ticket workflow are all working. The mobile app screens (tickets list, ticket detail with customers/markings, timesheet, profile) are all built and functional.

The app authenticates users via `AuthContext` (stored in AsyncStorage). Login screen at `app/login.tsx`. Users choose their name from a hardcoded list at login; their ID is stored via `AsyncStorage`.

**What's done:**
- WatermelonDB schema v4 with migrations (tickets, outbox_events, drafts, day_sessions, clock_events)
- SyncEngine with P0 (ticket status events) + P1 (clock/timesheet events), exponential backoff, max retries, batching
- Full ticket status workflow: ASSIGNED → ENROUTE → ONSITE → PAUSED → ONSITE → CLOSED/UNABLE
- Customer marking system (marking utility lines per customer with minutes allocation)
- AllocationReconcileModal for time distribution enforcement
- Timesheet: clock in/out, lunch/personal breaks, clock events synced via P1 outbox
- L720Ops web portal: dashboard, techs, tickets, simulator control pages
- 811Simulator ↔ Backend ingestion/outbound pipeline

**What remains (MEDIUM priority from PRODUCTION_FIXES.md):**
1. **SyncEngine should use authenticated user ID** — currently hardcoded to `DEV_USER_ID = 'user-bob-123'` in `SyncEngine.ts`. Should use the actual logged-in user's ID from `AuthContext`.
2. **Optimize break status check** — `app/(tabs)/tickets.tsx` runs 4 separate DB queries to check break status. Should be consolidated to 1.
3. **Client-side rate limiting** — SyncEngine should not send more than 1 sync request per second to the backend.

---

## Files Involved

### For issue #1 (SyncEngine auth user wiring):
- `Locate720/src/features/tickets/sync/SyncEngine.ts` — has `DEV_USER_ID` import, must be replaced
- `Locate720/src/config/api.ts` — defines `DEV_USER_ID = 'user-bob-123'`
- `Locate720/src/features/auth/AuthContext.tsx` — defines `user.userId`, stored via AsyncStorage
- `Locate720/src/features/auth/devSession.ts` — `setCurrentUser()` is called on login/load
- `Locate720/app/(tabs)/tickets.tsx` — already uses `useAuth()` and has `currentUserId`

### For issue #2 (break status optimization):
- `Locate720/app/(tabs)/tickets.tsx` — `checkBreakStatus()` function runs multiple queries
- `Locate720/src/features/timesheet/utils/breakStatus.ts` — `checkUserBreakStatus()` utility

### For issue #3 (rate limiting):
- `Locate720/src/features/tickets/sync/SyncEngine.ts` — `queueEvent()` triggers immediate flush; needs throttle

---

## Decisions Already Made

- **Outbox pattern is final** — do not bypass it; never write ticket status changes directly to the backend
- **WatermelonDB is the local DB** — do not switch to AsyncStorage or any other local storage for ticket/session data
- **SyncEngine is a singleton** — `export const SyncEngine = new SyncEngineImpl()` — do not change this
- **Ticket status machine is locked** — `statusMachine.ts` transitions cannot be changed without explicit direction
- **`payload_json` is the flexible store** — timeline fields (`onsiteStartedAt`, `pauseEvents`, etc.) live in `payload_json`, not as dedicated columns
- **Auto 811 inbound polling is DISABLED** — use manual endpoint `POST /api/inbound/811/pull`
- **Auto outbound processing runs every 30 seconds** — this is intentional, do not disable
- **React.memo on TicketCard** — already applied (`memo` wraps `TicketCardComponent`)
- **`PULL_THROTTLE_MS = 60000`** — pull from backend max once per 60 seconds, do not lower

---

## Assumptions

- **Development machine:** Backend is reachable at `API_BASE_URL` in `Locate720/src/config/api.ts`. The IP `192.168.50.245` is machine-specific — change to your LAN IP or `localhost` for emulator testing.
- **Test user:** Bob Smith (`user-bob-123`) is always seeded by the Backend on first run. This is the primary test user for the mobile app.
- **Any username/password** works for L720Ops login (Backend accepts all credentials in dev, issues JWT)
- **Expo dev build required** — WatermelonDB requires native modules; cannot run in Expo Go, must use `expo run:android` or `expo run:ios` or a dev build

---

## Constraints

- Do NOT bump `schema.ts` version without adding a matching migration to `migrations.ts`
- Do NOT modify `MAX_BATCH_SIZE` (100), `MAX_RETRY_COUNT` (10), `REQUEST_TIMEOUT_MS` (30000), or `PULL_THROTTLE_MS` (60000) in `SyncEngine.ts`
- Do NOT change Backend test users (Bob, Alice, Charlie, Diana, Evan)
- Do NOT use `console.log` in new Locate720 code — use `logger.log/warn/error` from `src/utils/logger.ts`
- Do NOT add `require()` in Backend — it uses ES Modules (`import/export`)
- Do NOT talk to 811Simulator directly from the mobile app — only Backend ↔ 811Simulator
- Do NOT modify `ticketTime.ts` calculation logic without explicit direction

---

## Known Issues / Risks

| Issue | Location | Severity | Notes |
|---|---|---|---|
| `DEV_USER_ID` hardcoded in SyncEngine | `SyncEngine.ts` line 374 | HIGH | Pulls tickets for Bob only, regardless of who's logged in |
| `API_BASE_URL` has machine-specific IP | `src/config/api.ts` line 9 | MEDIUM | Must be changed per dev machine |
| Break status check is 4 queries | `tickets.tsx` `checkBreakStatus()` | MEDIUM | Works but is inefficient |
| No client-side rate limiting on sync | `SyncEngine.ts` `queueEvent()` | MEDIUM | Could flood backend during burst |
| `ticketsStore.ts` is a legacy in-memory store | `src/features/tickets/store/ticketsStore.ts` | LOW | Not currently used by main screens; WatermelonDB is the real store |
| Login screen uses hardcoded user list | `app/login.tsx` | LOW | Users are hardcoded; no real auth against Backend |

---

## Exact Next Steps (in order)

### Step 1 — Wire authenticated user to SyncEngine
**File:** `Locate720/src/features/tickets/sync/SyncEngine.ts`

The `SyncEngine` is a singleton and cannot directly call React hooks. The fix is to give `SyncEngine` a method to set the current user ID, and call that method from the tickets screen (which already has access to `useAuth()`).

1. In `SyncEngine.ts`: Add a `private currentUserId: string = 'user-bob-123'` field and a `setCurrentUser(userId: string)` method
2. In `SyncEngine.ts`: Replace `DEV_USER_ID` in `pullTickets()` with `this.currentUserId`
3. In `app/(tabs)/tickets.tsx`: After getting `user` from `useAuth()`, call `SyncEngine.setCurrentUser(user.userId)` in a `useEffect` when user changes

### Step 2 — Optimize break status check
**File:** `Locate720/app/(tabs)/tickets.tsx`

The `checkBreakStatus()` function calls `checkUserBreakStatus()` from `breakStatus.ts` which runs multiple DB queries. Review `src/features/timesheet/utils/breakStatus.ts` to see if it can be consolidated into a single query with a join or combined filter.

### Step 3 — Add client-side rate limiting to SyncEngine
**File:** `Locate720/src/features/tickets/sync/SyncEngine.ts`

Add a simple timestamp guard in `queueEvent()` so that if a flush was triggered less than 1 second ago, schedule it with `setTimeout(1000)` instead of calling immediately.

---

## Exact Next Action to Take First

**Start with Step 1.** Open `Locate720/src/features/tickets/sync/SyncEngine.ts` and read the full file. Then add `setCurrentUser(userId: string)` method and replace `DEV_USER_ID` usage in `pullTickets()`. Then update `app/(tabs)/tickets.tsx` to call `SyncEngine.setCurrentUser(user.userId)` when the user changes.
