# Mobile UI + Implementations TODO

## Planning Scope

This document now tracks implementation progress as work lands.

---

## Project Read Notes

- The tickets tab already had a split between `LIST` and `MAP` view in [Locate720/app/(tabs)/tickets.tsx](/d:/Desktop/LocateMVP/Locate720/app/(tabs)/tickets.tsx:1), but the map tab was still a placeholder and the header was minimal.
- The tickets header in [Locate720/src/features/tickets/components/TicketsHeader.tsx](/d:/Desktop/LocateMVP/Locate720/src/features/tickets/components/TicketsHeader.tsx:1) now supports branded user context, a placeholder avatar, and sync state.
- The tickets screen now has a local `List / Map / Reschedule` nav plus a search placeholder action.
- Ticket cards in [Locate720/src/features/tickets/components/TicketCard.tsx](/d:/Desktop/LocateMVP/Locate720/src/features/tickets/components/TicketCard.tsx:1) now open native maps when the address is tapped.
- Ticket records already store `lat` and `lng` in WatermelonDB via [Locate720/src/db/models/Ticket.ts](/d:/Desktop/LocateMVP/Locate720/src/db/models/Ticket.ts:1), and those values are synced from backend through `SyncEngine`.
- Scope geometry is still not present in the current mobile ticket model, so future map box rendering should align with [docs/811-scope-geometry-todo.md](/d:/Desktop/LocateMVP/docs/811-scope-geometry-todo.md:1).
- The profile screen in [Locate720/app/(tabs)/profile.tsx](/d:/Desktop/LocateMVP/Locate720/app/(tabs)/profile.tsx:1) and backend summary route in [Backend/src/routes/users.js](/d:/Desktop/LocateMVP/Backend/src/routes/users.js:153) now use daily-scoped metrics.
- The profile accumulated clock-in time now updates live from local `day_sessions` data and is treated as raw on-clock daily time.
- `Locate720/package.json` still does not include a map rendering library or foreground location package, so the map work still requires adding `react-native-maps` plus `expo-location`.

---

## Primary Goals

Open UI/map follow-up work from this document now lives in [overall-todos](/d:/Desktop/LocateMVP/docs/overall-todos:1).

---

## Implementation Plan

## Phase 1 - Tickets Screen Structure

- [x] Refactor [Locate720/src/features/tickets/components/TicketsHeader.tsx](/d:/Desktop/LocateMVP/Locate720/src/features/tickets/components/TicketsHeader.tsx:1) to support a branded header layout with user context and sync state.
- [x] Pass signed-in user data from [Locate720/app/(tabs)/tickets.tsx](/d:/Desktop/LocateMVP/Locate720/app/(tabs)/tickets.tsx:1) into the header component instead of rendering a static `Tickets` title only.
- [x] Preserve the existing sync badge behavior while moving it into the new top header row.
- [x] Reorganize the existing `view` toggle and filter controls so the screen reads as two clean levels:
  - top app/user header
  - local sub-nav and filters
- [x] Expand the current local view state beyond `LIST` and `MAP` to include `RESCHEDULE`, while treating `SEARCH` as an action button rather than a persistent content tab.
- [x] Keep the current `FilterChips` behavior for open/closed and mine/all filtering unless the new layout makes the component unreadable.

## Phase 2 - Header and Nav UX Details

- [x] Add a placeholder avatar treatment that does not require backend asset support yet.
- [x] Show the signed-in tech name from `AuthContext` in the tickets header.
- [x] Show app identity text in a way that does not fight the bottom tab navigator branding.
- [x] Add a clear sub-nav pattern for `List`, `Map`, and `Reschedule`, plus a search icon/button on the same level or aligned to the right.
- [x] Keep the screen usable while clocked out or on break by preserving the current empty-state logic from [Locate720/app/(tabs)/tickets.tsx](/d:/Desktop/LocateMVP/Locate720/app/(tabs)/tickets.tsx:1).

## Phase 3 - Map Foundations

- [x] Add the map dependencies required by Expo dev builds:
  - `react-native-maps`
  - `expo-location`
- [x] Confirm iOS and Android permission strings/config entries needed for foreground location.
- [x] Decide whether map rendering lives inline in [Locate720/app/(tabs)/tickets.tsx](/d:/Desktop/LocateMVP/Locate720/app/(tabs)/tickets.tsx:1) or in one focused ticket-map component under `src/features/tickets/components/`.
- [x] Reuse local WatermelonDB tickets already loaded in the tickets screen rather than introducing a second ticket query path.
- [x] Ignore tickets that lack valid `lat/lng` until data quality fallback behavior is defined.

## Phase 4 - Map Rendering and Interaction

- [x] Render one pin per visible ticket, respecting the active filters already applied on the tickets tab.
- [x] Reuse a single due-time color source for both list accents and map pins so urgency colors do not drift across views.
- [x] Center the initial map region based on:
  - user location when available
  - otherwise the average of visible ticket coordinates
  - otherwise a safe fallback region
- [x] Add user location indicator and optional recenter affordance.
- [x] Add pin press behavior that opens a bottom-of-screen ticket summary modal/sheet.
- [x] Include enough data in the map sheet to make the tap worthwhile:
  - ticket number
  - address
  - due time
  - locator status
  - contractor or work type if space allows
- [x] Make the modal itself tappable to open the full ticket details route.
- Remaining open items from this phase now live in [overall-todos](/d:/Desktop/LocateMVP/docs/overall-todos:1).

## Phase 5 - Scope Box Requirement

- [x] Confirm the source of scope coordinates for each ticket.
- [x] If true scope geometry already exists inside `payload_json`, standardize its parsing in one place and render that shape on the map.
- [x] If no scope geometry exists yet, implement a temporary highlighted bounding box derived from ticket `lat/lng` and document that it is a placeholder until backend provides real scope coordinates.
- Remaining open items from this phase now live in [overall-todos](/d:/Desktop/LocateMVP/docs/overall-todos:1).

## Phase 6 - Ticket List Navigation Action

- [x] Replace the address tap TODO in [Locate720/src/features/tickets/components/TicketCard.tsx](/d:/Desktop/LocateMVP/Locate720/src/features/tickets/components/TicketCard.tsx:1) with native maps deep-link behavior.
- [x] Prefer device-default navigation behavior rather than hardcoding a single maps vendor when possible.
- [x] Handle invalid or empty addresses gracefully.
- [x] Keep address taps from interfering with the card's main ticket-detail press target.

## Phase 7 - Reschedule Placeholder

- [x] Add a `RESCHEDULE` panel to the tickets local nav.
- [x] Use placeholder copy only for now, but make it feel intentional rather than like a broken route.
- [x] Call out that reschedule functionality will eventually support ticket deferrals, updated due windows, or schedule requests, without wiring backend mutations yet.

## Phase 8 - Search Placeholder

- [x] Add a visible search affordance in the tickets screen header/sub-nav.
- [x] Keep the first pass UI-only:
  - no final filtering logic yet
  - no backend search yet
  - no route split yet unless the screen layout requires it
- Remaining open items from this phase now live in [overall-todos](/d:/Desktop/LocateMVP/docs/overall-todos:1).

## Phase 9 - Profile Daily Metrics Fix

- [x] Update the backend productivity summary in [Backend/src/routes/users.js](/d:/Desktop/LocateMVP/Backend/src/routes/users.js:153) so daily metrics are truly daily.
- [x] Keep `Tickets On Board` defined as currently open tickets only.
- [x] Keep `Closed` defined as tickets closed since local day start only.
- [x] Decide whether `totalFootageAllocated`, `totalUtilitiesClosed`, `LPH`, and `FPH` are now all daily metrics as well. The implementation now treats them as daily-scoped values.
- [x] Update the local fallback logic in [Locate720/app/(tabs)/profile.tsx](/d:/Desktop/LocateMVP/Locate720/app/(tabs)/profile.tsx:1) to match the backend's daily-only definitions so offline behavior does not drift from online behavior.
- [x] Ensure daily refresh happens automatically based on today's date rather than requiring manual profile refresh after midnight.

## Phase 10 - Dynamic Accumulated Clock Time

- [x] Rework the profile screen's accumulated clock-in time so it updates on a timer while the current session is active.
- [x] Reuse the same source-of-truth session data already used by the timesheet flow instead of inventing a separate timing model.
- [x] Combine:
  - persisted historical worked time for completed sessions today
  - current active session elapsed time up to `Date.now()`
  - break handling if active clocked-in time should exclude lunch/personal segments
- [x] Confirm whether accumulated clock in time is intended to mean raw on-clock session time or net working time excluding breaks. This implementation now treats it as raw on-clock daily time.
- [x] Ensure the timer is lightweight and cleaned up properly when the profile screen blurs or unmounts.

---

## File Targets

### Mobile

- [x] [Locate720/app/(tabs)/tickets.tsx](/d:/Desktop/LocateMVP/Locate720/app/(tabs)/tickets.tsx:1)
- [x] [Locate720/src/features/tickets/components/TicketsHeader.tsx](/d:/Desktop/LocateMVP/Locate720/src/features/tickets/components/TicketsHeader.tsx:1)
- [x] [Locate720/src/features/tickets/components/TicketCard.tsx](/d:/Desktop/LocateMVP/Locate720/src/features/tickets/components/TicketCard.tsx:1)
- [x] [Locate720/src/features/tickets/components/TicketMapView.tsx](/d:/Desktop/LocateMVP/Locate720/src/features/tickets/components/TicketMapView.tsx:1)
- [x] [Locate720/app/(tabs)/profile.tsx](/d:/Desktop/LocateMVP/Locate720/app/(tabs)/profile.tsx:1)
- Remaining open items from this section now live in [overall-todos](/d:/Desktop/LocateMVP/docs/overall-todos:1).

### Backend

- [x] [Backend/src/routes/users.js](/d:/Desktop/LocateMVP/Backend/src/routes/users.js:153)

### Likely New Dependencies

- [x] `react-native-maps`
- [x] `expo-location`

---

## Risks / Gaps To Resolve Before Coding

- [x] Confirm the exact desired daily scope for profile metrics beyond `Tickets On Board` and `Closed`.
- [x] Confirm whether accumulated clock-in time includes breaks or excludes them.
- [x] Confirm whether scope coordinates already exist anywhere in ticket payloads. They do not in the current mobile ticket model yet.
- Remaining open items from this section now live in [overall-todos](/d:/Desktop/LocateMVP/docs/overall-todos:1).


---

## Recommended Build Order

1. Update tickets header and local sub-nav structure first.
2. Add reschedule and search placeholders so the tickets screen layout is settled before map work.
3. Add address-to-navigation behavior on ticket cards.
4. Fix backend and mobile daily profile metric definitions.
5. Implement dynamic accumulated clock time.
6. Add map dependencies and permission flow.
7. Implement pins, user location, and bottom-sheet ticket interaction.
8. Implement scope box rendering once the coordinate source is confirmed.

---

## Validation Checklist

Open validation items from this document now live in [overall-todos](/d:/Desktop/LocateMVP/docs/overall-todos:1).
- [x] Profile metrics match daily-only definitions online and offline.
- [x] `Tickets On Board` counts open tickets only.
- [x] `Closed` counts today's closed tickets only.
- [x] Accumulated clock time updates without requiring a new timesheet event.
- [x] Midnight rollover refreshes daily metrics correctly.

