# 811 Scope Geometry TODO

## Planning Scope

This document is a planning pass only. No simulator, backend, or mobile code changes are included here.

---

## Current State

- The 811 simulator currently generates a single point per ticket in [811Simulator/src/domain/generator.ts](/d:/Desktop/LocateMVP/811Simulator/src/domain/generator.ts:1) using `lat` and `lng` randomly selected within the service area bounds.
- The simulator schema in [811Simulator/src/db/schema.ts](/d:/Desktop/LocateMVP/811Simulator/src/db/schema.ts:1) stores ticket point coordinates, but does not store scope bounding box fields or separate scope geometry columns.
- Simulator ticket payloads currently include:
  - generic address
  - center `lat`
  - center `lng`
  - contractor/work/customer data
- The simulator ticket APIs in [811Simulator/src/routes/tickets.ts](/d:/Desktop/LocateMVP/811Simulator/src/routes/tickets.ts:1) and [811Simulator/src/routes/ops.ts](/d:/Desktop/LocateMVP/811Simulator/src/routes/ops.ts:1) already return `lat`, `lng`, and `payload`.
- Backend ingestion in [Backend/src/services/ingestionService.js](/d:/Desktop/LocateMVP/Backend/src/services/ingestionService.js:1) maps the simulator ticket point through to L720, but does not currently standardize or preserve explicit scope bbox fields.
- The mobile map planning depends on ticket scope geometry to draw a highlighted work box instead of inferring one ad hoc from a point.

---

## Goal

Keep the existing generic address and point coordinates, but also generate logical ticket scope geometry in the 811 simulator so each ticket has a deterministic work-area bounding box that can flow through:

1. 811 Simulator
2. Backend ingestion
3. L720 backend ticket payload
4. Locate720 mobile map view

The first pass should use a bounding box that is realistic enough for map highlighting, even if it is not yet a true polygon.

---

## Requirements

- [x] Preserve the existing generic address field for list and detail views.
- [x] Preserve the existing ticket center `lat` and `lng`.
- [x] Add a deterministic scope bounding box for every generated ticket.
- [x] Ensure the scope box is logically related to the ticket center and service area, not a random unrelated rectangle.
- [x] Keep scope geometry inside the simulator payload and available through existing simulator APIs.
- [x] Ensure backend ingestion preserves the scope geometry in `payload_json` even if L720 does not add dedicated columns yet.
- [x] Make the geometry shape stable enough that a ticket keeps the same scope box unless the source ticket is regenerated or edited.

---

## Recommended Data Shape

Use the ticket point as the center and add a `scope` object into simulator `payload_json`:

```json
{
  "lat": 32.9312,
  "lng": -96.4597,
  "scope": {
    "centerLat": 32.9312,
    "centerLng": -96.4597,
    "latMin": 32.9307,
    "latMax": 32.9317,
    "lngMin": -96.4604,
    "lngMax": -96.4590,
    "widthFeet": 220,
    "heightFeet": 160,
    "shape": "BOUNDING_BOX"
  }
}
```

This keeps the simulator flexible:

- the point still works for assignment and simple map pinning
- the scope box supports mobile map overlays
- later, a polygon can be added without breaking the first-pass bbox contract

---

## Implementation Plan

## Phase 1 - Scope Generation Rules

- [x] Define a deterministic helper in [811Simulator/src/domain/generator.ts](/d:/Desktop/LocateMVP/811Simulator/src/domain/generator.ts:1) for generating scope bounds from the ticket center.
- [x] Keep the scope dimensions realistic for locate work rather than city-scale rectangles.
- [x] Choose a bounded random size range such as:
  - smaller boxes for routine residential work
  - larger boxes for emergency or boring/trenching work
- [x] Clamp generated bounds to the parent service area so scope never spills outside the area box.
- [x] Decide whether scope size varies by `ticketType`, `workType`, or both.

## Phase 2 - Simulator Payload Shape

- [x] Add scope geometry to the simulator payload JSON at ticket creation time.
- [x] Keep the top-level `lat` and `lng` fields unchanged for backward compatibility.
- [x] Ensure API responses from [811Simulator/src/routes/tickets.ts](/d:/Desktop/LocateMVP/811Simulator/src/routes/tickets.ts:1) and [811Simulator/src/routes/ops.ts](/d:/Desktop/LocateMVP/811Simulator/src/routes/ops.ts:1) expose the new payload structure cleanly.
- Remaining open items from this phase now live in [overall-todos](/d:/Desktop/LocateMVP/docs/overall-todos:1).

## Phase 3 - Manual Ops Ticket Support

- [x] Update the simulator ops create/edit routes in [811Simulator/src/routes/ops.ts](/d:/Desktop/LocateMVP/811Simulator/src/routes/ops.ts:1) so manually created tickets also receive scope geometry.
- [x] If an ops user enters only `lat/lng`, auto-generate scope bounds from those coordinates.
- Remaining open items from this phase now live in [overall-todos](/d:/Desktop/LocateMVP/docs/overall-todos:1).

## Phase 4 - Backend Ingestion Preservation

- [x] Confirm [Backend/src/services/ingestionService.js](/d:/Desktop/LocateMVP/Backend/src/services/ingestionService.js:1) preserves `payload.scope` when it maps simulator payloads into L720 payload JSON.
- [x] If needed, add explicit payload mapping so scope geometry is not dropped when merging with existing L720 ticket payload fields.
- [x] Keep the existing ticket table point columns as-is unless a later feature truly needs dedicated bbox columns.

## Phase 5 - Mobile / Map Consumer Contract

- [x] Standardize the expected mobile contract as:
  - `ticket.lat`
  - `ticket.lng`
  - `payload.scope.latMin`
  - `payload.scope.latMax`
  - `payload.scope.lngMin`
  - `payload.scope.lngMax`
- [x] Ensure the mobile map todo uses this simulator/backend payload contract rather than inventing a different scope shape.
- Remaining open items from this phase now live in [overall-todos](/d:/Desktop/LocateMVP/docs/overall-todos:1).

---

## Open Design Decisions

Open design decisions from this document now live in [overall-todos](/d:/Desktop/LocateMVP/docs/overall-todos:1).

---

## Suggested First-Pass Decisions

- [x] Keep first-pass scope geometry as axis-aligned bounding boxes only.
- [x] Store scope in `payload_json` first, not as dedicated `tickets_811` columns.
- [x] Keep ticket center `lat/lng` as the authoritative pin location.
- [x] Derive scope size from `workType` with a small random factor.
- [x] Clamp all bbox values to the parent service area.

These choices minimize schema churn while still giving the mobile map enough structure to render a credible highlight box.

---

## File Targets

- [x] [811Simulator/src/domain/generator.ts](/d:/Desktop/LocateMVP/811Simulator/src/domain/generator.ts:1)
- [x] [811Simulator/src/routes/tickets.ts](/d:/Desktop/LocateMVP/811Simulator/src/routes/tickets.ts:1)
- [x] [811Simulator/src/routes/ops.ts](/d:/Desktop/LocateMVP/811Simulator/src/routes/ops.ts:1)
- Remaining open items from this section now live in [overall-todos](/d:/Desktop/LocateMVP/docs/overall-todos:1).
- [x] [Backend/src/services/ingestionService.js](/d:/Desktop/LocateMVP/Backend/src/services/ingestionService.js:1)
- [x] [docs/mobile-ui-and-implementations-todo.md](/d:/Desktop/LocateMVP/docs/mobile-ui-and-implementations-todo.md:1) to align the map consumer plan with the new simulator scope contract

---

## Validation Checklist

- [x] Newly generated 811 tickets include generic address, center `lat/lng`, and scope bbox data.
- [x] Scope bbox always contains the center point.
- [x] Scope bbox stays within the parent service area.
- [x] Simulator API responses expose scope data consistently.
- [x] Backend ingestion preserves scope data into L720 `payload_json`.
- [x] Mobile map consumers can draw a box from the ingested payload without inventing fallback geometry.
- Remaining open validation items now live in [overall-todos](/d:/Desktop/LocateMVP/docs/overall-todos:1).

