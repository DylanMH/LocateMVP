# Linked Ticket / Chain Architecture

## Why

811 workflows produce ticket *chains*: an original locate request, later
updates, update remarks, no-responses, recalls, and corrections. Techs need to
see the full history. Operations needs each ticket to still behave like a
normal independent work item for billing and productivity.

## Core invariant

> Linked tickets are grouped for **history and visibility**.
> Each ticket remains **independent** for field work, time, footage,
> notes, photos, assignment, and billing/productivity.

No service, endpoint, query, or UI may aggregate time, footage, notes, or
photos across a ticket chain.

## Lineage columns (present in 811 Sim, Backend, Mobile)

| Column | Rule |
|---|---|
| `ticket_type` | `ORIGINAL | UPDATE | UPDATE_REMARK | NO_RESPONSE | RECALL | CORRECTION | EMERGENCY`. Legacy `NORMAL` is migrated / displayed as `ORIGINAL`. |
| `root_ticket_id` | Chain head. For an original this equals the ticket's own id. |
| `parent_ticket_id` | Direct predecessor. Null for originals. |
| `sequence_number` | 1 for original, N+1 per subsequent linked ticket. Unique per root. |
| `external_root_number` | Shared human ticket number across the chain for search. |

Backend indexes: `idx_tickets_root`, `idx_tickets_parent`, `idx_tickets_ext_root`.
Mobile WatermelonDB schema v6 mirrors the same columns (indexed).

## Ticket numbering

- Original: `MMYY-AREA-NNNNNN` (e.g. `1126-ROCK-000123`).
- Linked: `{base}-R{sequence_number - 1}` (e.g. `1126-ROCK-000123-R1`, `-R2`, ...).
- `external_root_number` always equals the original's `ticket_number`.

## Components changed

### 811 Simulator (`811Simulator/`)

- `src/db/schema.ts` / `src/db/db.ts` — added lineage columns + indexes + boot-time backfill (self-root originals).
- `src/domain/generator.ts` — split into `generateTickets` (bulk originals) and `createLinkedTicket(rootTicketId, type, overrides)`; exposes `getNextSequenceNumber`, `getTicketChain`; bulk tickets now always `ORIGINAL`.
- `src/routes/tickets.ts`:
  - `POST /api/811/tickets/:rootId/linked` — spawn a linked ticket (notifies L720 backend).
  - `GET /api/811/tickets/:ticketId/chain` — ordered chain.
  - `/api/811/tickets` list + detail responses now include `rootTicketId`, `parentTicketId`, `sequenceNumber`, `externalRootNumber`.

### Backend (`Backend/`)

- `src/db/database-sqlite.js` — additive migration + indexes + backfill.
- `src/services/ingestionService.js`:
  - `map811TicketToL720` normalizes legacy `NORMAL` → `ORIGINAL`.
  - `resolveLineage` maps external 811 IDs to local L720 IDs (falls back to self-root + null parent on out-of-order pulls).
  - `repairPendingLineage` fixes a row whose parent arrived later.
  - `adoptOrphanedChildren` fixes children when their root arrives later.
  - `reconcileMissing811Tickets` unchanged — never cascades deletion across a chain.
- `src/services/ticketChainService.js` — read helpers: `getChainByTicketId`, `getChainByExternalRootNumber`, `getLatestInChain`, `getChainWithSummaries`. The summary function joins `utility_production_ledger` per ticket and never aggregates across the chain.
- `src/routes/tickets.js`:
  - Serializer includes lineage.
  - `GET /api/tickets/:id/history` — full chain.
  - `GET /api/tickets/:id/related` — chain minus self.
  - `GET /api/tickets/:id/chain-summary` — chain with per-ticket minutes/footage.
- `src/routes/ops.js`:
  - `mapTicketRow` includes lineage.
  - `GET /api/ops/tickets/:id/chain` — chain with per-ticket operational summaries.

### Mobile (`Locate720/`)

- `src/db/schema.ts` → v6, adds 4 lineage columns.
- `src/db/migrations.ts` → v6 `addColumns` step.
- `src/db/models/Ticket.ts` → `rootTicketId`, `parentTicketId`, `sequenceNumber`, `externalRootNumber`.
- `src/features/tickets/sync/SyncEngine.ts`:
  - `pullTickets` delta map includes lineage (falls back to self-root).
  - `applyTicketDeltas` writes lineage on create; on update it only fills in missing lineage (immutable-after-set).
- `src/features/tickets/types.ts` — `TicketType` taxonomy expanded (`ORIGINAL`, `CORRECTION`; legacy `NORMAL` kept as alias).
- `src/features/tickets/utils/ticketPayload.ts` / `ticketPresentation.ts` — format/color for `ORIGINAL` / `CORRECTION`.
- `src/features/tickets/components/HistoryTab.tsx` — merges current ticket into a single chronological list sorted by `sequence_number`; each row is tappable and navigates to `/ticket-details/<id>`.
- `src/features/tickets/components/TicketCard.tsx` — "Update #k of <base>" sub-label when `sequence_number > 1`.
- `app/ticket-details/[id].tsx` — `enhanceRelated` observes by `root_ticket_id` (plus `external_root_number` fallback). Replaces the previous address-matching heuristic.

### L720Ops (`L720Ops/`)

- `src/types/ticket.ts` — `TicketType` taxonomy expanded; `Ticket` carries lineage fields; new `TicketChainRow` type.
- `src/services/ticketsService.ts` — `getTicketChain(id)` calls `/api/ops/tickets/:id/chain`.
- `src/components/TicketDetailModal.tsx` — new `TicketChainPanel` renders per-ticket minutes/footage with an explicit no-aggregation note.

## Migration strategy (already live)

All three stores (811 sim sqlite, backend sqlite, mobile WatermelonDB) use
**additive** migrations and a boot-time backfill: every legacy row becomes
`root_ticket_id = id`, `sequence_number = 1`, `external_root_number = ticket_number`.
This is semantically identical to the prior corpus — every ticket was
effectively an independent original.

The 811 Simulator stops generating random `RECALL / UPDATE_REMARK / EMERGENCY`
type tickets as standalone rows; those types are now produced only via
`createLinkedTicket`. Existing random-typed rows keep their type on disk but
have no chain associated with them (they're effectively one-row chains).

## Out-of-order ingestion

If a child 811 ticket pulls before its parent (pagination, network reorder),
the backend inserts it as a **placeholder self-rooted original**:
`root_ticket_id = self, parent_ticket_id = null`, but retains the correct
`external_root_number` and `sequence_number`. On the next pull that brings in
the real root, `adoptOrphanedChildren` fixes up `root_ticket_id` in one pass.
If the child itself comes in later and its parent is already present,
`resolveLineage` returns the correct local id and the INSERT writes the real
link immediately.

## Operational rules (enforced in code)

- `utility_production_ledger.ticket_id` — already per-ticket. Chain APIs never sum it.
- `ticket_notes.ticket_id`, `ticket_attachments.ticket_id` — already per-ticket.
- `clock_events.ticket_id` — already per-ticket.
- `payload_json.enrouteStartedAt/onsiteStartedAt/pauseEvents/closedAt` — per-ticket.
- Mobile `HistoryTab` is read-only; editing still happens in the tab group for
  the currently-open ticket only.

## How to create a demo chain

```bash
# 1. Start 811Sim + Backend:
pnpm dev:server

# 2. Generate originals:
curl -X POST http://localhost:4100/api/811/generate \
  -H 'content-type: application/json' \
  -d '{"count": 5, "areaId": "ROCKWALL"}'

# 3. Pick one ticket id from the response, then spawn linked tickets:
curl -X POST http://localhost:4100/api/811/tickets/<ID>/linked \
  -H 'content-type: application/json' \
  -d '{"type": "NO_RESPONSE"}'

curl -X POST http://localhost:4100/api/811/tickets/<ID>/linked \
  -H 'content-type: application/json' \
  -d '{"type": "UPDATE", "overrides": {"markingInstructions": "Please re-mark east driveway."}}'

# 4. View the chain:
curl http://localhost:4100/api/811/tickets/<ID>/chain | jq
curl http://localhost:3000/api/tickets/<LOCAL_ID>/history | jq
curl http://localhost:3000/api/ops/tickets/<LOCAL_ID>/chain -H 'authorization: Bearer <token>' | jq
```
