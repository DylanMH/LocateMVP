# AGENTS.md — AI Coding Agent Guide for LocateMVP

## Project Purpose

LocateMVP is a **utility locate ticket management system** for field technicians. When someone calls 811 ("Call Before You Dig"), the 811 center dispatches tickets to utility locating companies (like USIC). Field techs use the mobile app to receive, manage, and close tickets. Supervisors/managers use the web portal. This repo is a full MVP of that system.

---

## Four Sub-Systems (all in this monorepo)

| Folder | What it is | Port | Tech |
|---|---|---|---|
| `811Simulator/` | Fake 811 dispatch center | 4100 | TypeScript, Fastify, better-sqlite3 |
| `Backend/` | Core API server | 3000 | Node.js ESM, Express, better-sqlite3 |
| `Locate720/` | Field tech mobile app | N/A | React Native, Expo, WatermelonDB, NativeWind |
| `L720Ops/` | Web admin portal | 5173 | React 19, Vite, TailwindCSS v4, TanStack Query |

---

## Commands to Run Each Sub-System

This is a **pnpm workspace** managed with **Turborepo**. Run `pnpm install` from the repo root once to install all packages.

### Workspace-level (run from repo root)

```bash
pnpm dev              # start server-side apps only (811Sim + Backend + L720Ops)
pnpm dev:all          # start ALL dev apps including Expo (not recommended for mobile)
pnpm dev:server       # start only 811Simulator + Backend (most common for backend work)
pnpm dev:sim          # start only 811Simulator (port 4100)
pnpm dev:backend      # start only Backend (port 3000)
pnpm dev:web          # start only L720Ops (port 5173)
pnpm dev:mobile       # start only Locate720 directly (no turbo wrapper)
pnpm build            # build all buildable packages (L720Ops)
pnpm lint             # lint all packages
pnpm seed             # seed Backend DB with tickets
pnpm reset            # reset Backend DB
```

### Per-package (use --filter or cd into folder)

```bash
# From repo root — filter syntax
pnpm --filter locate720-backend dev
pnpm --filter locate720-backend seed
pnpm --filter locate720-backend reset
pnpm --filter l720ops build
pnpm --filter l720ops lint
pnpm --filter locate720 android    # expo run:android
pnpm --filter locate720 ios        # expo run:ios

# Or cd into the folder (still works — pnpm respects workspace)
cd 811Simulator && pnpm dev
cd Backend && pnpm dev
cd L720Ops && pnpm dev
cd Locate720 && npx expo start     # REQUIRED for mobile — see note below
```

> **Mobile dev note:** Always run Expo directly (`cd Locate720 && npx expo start`), NOT via `pnpm dev:mobile` or `pnpm dev`. Turbo captures stdout in non-TTY mode which strips Expo's interactive UI and QR code. The dev build (`expo-dev-client`) must also be installed on the device/emulator first via `npx expo run:android` or `npx expo run:ios` (one-time per device).

---

## Stack & Frameworks

### 811Simulator
- **Runtime:** Node.js with `tsx` (TypeScript execution)
- **Framework:** Fastify v5 + `@fastify/cors`
- **DB:** `better-sqlite3` (SQLite)
- **Validation:** Zod
- **Language:** TypeScript (strict)

### Backend
- **Runtime:** Node.js with ES Modules (`"type": "module"`)
- **Framework:** Express v4
- **DB:** `better-sqlite3` (SQLite at `data/locate720.db`)
- **Auth:** `jsonwebtoken` (JWT, secret: `l720-ops-secret-key` or `JWT_SECRET` env var)
- **Language:** JavaScript (CommonJS-style imports but ESM modules)

### Locate720
- **Framework:** Expo v54 + React Native 0.81.5 + React 19
- **Routing:** expo-router (file-based, `app/` directory)
- **Local DB:** WatermelonDB v0.28 with expo-sqlite adapter — schema version 4
- **Styling:** NativeWind v4 (Tailwind for React Native) + `global.css`
- **Language:** TypeScript
- **Sync:** Custom `SyncEngine` singleton (outbox pattern)
- **Icons:** `@expo/vector-icons` (Ionicons)

### L720Ops
- **Framework:** React 19 + Vite 7
- **Routing:** React Router DOM v7
- **Styling:** TailwindCSS v4 (via `@tailwindcss/vite`)
- **Data fetching:** TanStack Query v5
- **UI Components:** Headless UI v2 + Heroicons v2
- **Language:** TypeScript
- **Env file:** `L720Ops/.env` (use `VITE_API_BASE_URL` and `VITE_SIMULATOR_API_BASE_URL`)

---

## Coding Conventions

### All sub-systems
- Match existing file style exactly — don't mix formatting conventions across files
- No new utility files unless the logic is used in 3+ places
- Do not add or remove comments unless asked
- Do not change existing variable/function names without a clear reason

### Backend (JS)
- ES Module syntax (`import/export`) — no `require()`
- All DB queries use `better-sqlite3` prepared statements
- Services are pure functions that receive `db` as first argument
- Routes import from `../server.js` to get the `db` instance

### Locate720 (TypeScript, React Native)
- WatermelonDB models live in `src/db/models/` — use `@field()` decorators
- If you add a column to the schema, you **must** also add a migration in `src/db/migrations.ts` and bump `version` in `src/db/schema.ts`
- All time-based ticket calculations go in `src/features/tickets/utils/ticketTime.ts` — do not duplicate logic
- Status transitions are enforced by `src/features/tickets/domain/statusMachine.ts` — do not bypass it
- Use `logger.log/warn/error` from `src/utils/logger.ts`, never raw `console.log` (except where it already exists)
- Use `fetchWithTimeout` from `src/utils/fetchWithTimeout.ts` for all HTTP calls in the mobile app
- `payload_json` on a ticket stores rich JSON metadata (customers, timeline, contractor). Parse it with try/catch
- Do not modify `SyncEngine.ts` batch limits (100), retry limits (10), or timeout (30s) unless asked

### L720Ops (TypeScript, React)
- Services are static class methods in `src/services/`
- Components go in `src/components/` or `src/pages/`
- All API calls use `localStorage.getItem('auth_token')` for auth header

---

## Architecture Rules

1. **Offline-first:** The mobile app (Locate720) must work without a network connection. All state changes write to WatermelonDB first, then sync via outbox.
2. **Outbox pattern:** Ticket status changes queue as `outbox_events` in WatermelonDB. `SyncEngine.flushP0()` sends them. Do not bypass this.
3. **Conflict resolution:** During `applyTicketDeltas()`, the server version only overwrites local if `delta.version > existing.version` AND there are no PENDING outbox events for that ticket.
4. **Status machine:** Ticket locator status transitions are enforced. ASSIGNED → ENROUTE → ONSITE → PAUSED → ONSITE (loop). CLOSED/UNABLE are terminal. Never set status directly; go through `canTransitionStatus()`.
5. **Priority queues:** P0 events = ticket status changes (flushed first). P1 events = clock/timesheet events.
6. **Service separation:** 811Simulator and Backend are separate systems. Backend ingests FROM the simulator; the mobile app syncs FROM/TO the backend. The mobile app does NOT talk to the 811Simulator directly.
7. **Schema migrations:** Any WatermelonDB schema change requires a migration entry. Schema version and migration count must stay in sync.
8. **Linked tickets (chain model):** Every ticket has `root_ticket_id`, `parent_ticket_id`, `sequence_number`, `external_root_number` (see `docs/linked-tickets-architecture.md`). Linkage is **history/visibility only** — never aggregate time, footage, notes, photos, or billing across a chain. Each row remains an independent operational ticket. Originals are self-rooted (`root_ticket_id = id`, `sequence_number = 1`). Linked tickets are spawned via `811Simulator` `createLinkedTicket` and flow through ingestion, which resolves external → local IDs and repairs out-of-order arrivals.

---

## What NOT to Change Unless Explicitly Asked

- `Locate720/src/db/schema.ts` version number (without a migration)
- `Locate720/src/db/migrations.ts` (without a schema change)
- `SyncEngine.ts` constants: `MAX_BATCH_SIZE`, `MAX_RETRY_COUNT`, `REQUEST_TIMEOUT_MS`, `PULL_THROTTLE_MS`
- `Backend/src/server.js` seeded test users (Bob, Alice, Charlie, Diana, Evan) — these are relied on by the mobile app
- `statusMachine.ts` transition rules
- `ticketTime.ts` calculation logic
- `L720Ops/.env` API URLs
- Any database file in `data/` directories (they are gitignored and runtime-only)

---

## How to Approach Edits in This Repo

1. **Identify which sub-system** the change lives in before touching anything.
2. **Read the file first** — understand the existing pattern, then match it.
3. **For mobile app DB changes:** schema → migration → model → done, in that order.
4. **For Backend route additions:** add to the appropriate router file in `src/routes/`, register in `server.js` if it's a new router.
5. **For SyncEngine changes:** be extremely careful — all 4 methods (flushP0, flushP1, pullTickets, applyTicketDeltas) must stay consistent.
6. **Test the full flow** when touching sync: 811Simulator → Backend → Mobile app.
7. **Do not create new files** unless absolutely necessary. Prefer editing existing files.
8. **L720Ops API calls** all go through `http://localhost:3000/api` — check the service file in `src/services/` before adding a new endpoint.

---

## Important Hardcoded Values (Dev Only)

| Value | Location | Notes |
|---|---|---|
| `DEV_USER_ID = 'user-bob-123'` | `Locate720/src/config/api.ts` | Hardcoded auth — should use real auth user |
| `API_BASE_URL = 'http://192.168.50.245:3000/api'` | `Locate720/src/config/api.ts` | Machine-specific IP — change to your LAN IP or `localhost` |
| `JWT_SECRET = 'l720-ops-secret-key'` | `Backend/src/routes/ops.js` | Dev secret, any user/pass accepted |
| `ELEVEN_SIM_BASE_URL = 'http://localhost:4100'` | `Backend/src/services/ingestionService.js` | 811Simulator URL |
| `SIMULATOR_URL = 'http://localhost:4100'` | `Backend/src/services/outbound811Service.js` | Outbound 811 URL |
