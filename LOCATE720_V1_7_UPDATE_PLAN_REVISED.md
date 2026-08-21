# Locate720 v1.7 — Ticket Sync Stability, Daily Closed Tickets, Modern Mobile UX, Filtering, Timesheet History, and UI System Refinement

## Release Purpose

Locate720 v1.7 is a combined **stability, usability, and mobile UI architecture release**.

The release should not be treated as a set of unrelated UI tweaks. It should improve the reliability of the field workflow while establishing a clearer, denser, more professional interface designed specifically for utility locating work.

The two primary goals are:

1. **Make ticket and timesheet behavior trustworthy and predictable.**
2. **Make the mobile app faster to understand and easier to operate in the field.**

Version 1.7 should leave the technician with less ambiguity about:

- which tickets belong to them
- whether a status change actually saved
- which ticket is currently ENROUTE / ONSITE / PAUSED
- which tickets are due soon or overdue
- which filters are active
- what they have done during the current workday
- what action they should perform next

---

# 1. Release Scope

## Stability / Bugs

- Investigate and fix tickets disappearing from the technician board after ENROUTE / ONSITE.
- Fix any mobile/server synchronization race responsible for tickets disappearing and later reappearing.
- Make technician Closed Tickets show only tickets closed during the current local day.
- Preserve complete historical closed-ticket data in the backend.
- Expand Timesheet history to show lunch, breaks, allocation changes, personal time, and clock-out.
- Fix Clock Out button safe-area / bottom navigation overlap.
- Preserve correct behavior across offline/online transitions.

## Ticket UX

- Add a full ticket Filter system.
- Add filter modal / bottom sheet.
- Add quick filter clearing.
- Make active filters visible.
- Improve ticket cards for fast scanning.
- Replace overreliance on status pills with stronger card-level state indication.
- Maintain clear due-date urgency while also showing operational state.

## Mobile UI

- Establish a cleaner design system.
- Reduce unnecessary blank space.
- Increase important touch targets.
- Create clearer visual hierarchy.
- Make layout responsive instead of simply shrinking elements.
- Use sticky primary actions where appropriate.
- Improve keyboard-aware behavior.
- Prefer bottom sheets for mobile configuration/action flows.
- Make Customer cards task-oriented and collapsible when completed.
- Improve Timesheet into a chronological workday timeline.

---

# 2. System Boundaries

Locate720 v1.7 touches the following systems.

## 2.1 Mobile

Relevant systems:

- Expo Router
- Tickets screen
- Ticket detail
- Customer tab
- Map/list state
- WatermelonDB
- Ticket observables
- Local optimistic updates
- Outbox
- SyncEngine
- Current user assignment filtering
- Closed Tickets tab
- Ticket filtering
- Timesheet
- Timesheet event timeline
- Safe areas
- Bottom tabs
- Keyboard-aware scrolling
- Shared UI tokens
- Ticket UI components

## 2.2 L720 Corporate Backend

Relevant responsibilities:

- Authoritative ticket assignment
- Authoritative operational ticket state
- Ticket event ingestion
- Ticket versioning
- Mobile event idempotency
- Assigned-ticket queries
- Closed ticket history
- Timesheet sessions/events
- Ticket search/history foundation
- Sync response correctness

The L720 backend remains the shared operational source of truth.

Mobile may work optimistically and offline, but the app must converge cleanly to backend state after synchronization.

---

# 3. Core Design Principles

## 3.1 Field Operations First

Locate720 is not a generic productivity app.

It is used by field technicians who may be:

- outside
- walking
- standing near traffic
- working in poor signal
- using the phone one-handed
- typing with limited attention
- switching between tickets quickly

The UI should therefore prioritize:

- clarity
- strong contrast
- fast scanning
- large touch targets
- predictable navigation
- minimal ambiguity
- minimal scrolling for common actions
- obvious current state

Every operational screen should quickly answer:

1. Where am I?
2. What am I working on?
3. What state is it in?
4. What should I do next?

---

# 4. Multi-Agent Work Breakdown

Use specialized agents to reduce overlap.

## Agent 0 — Coordinator / Architecture Agent

Owns:

- codebase map
- file ownership
- shared contracts
- merge order
- cross-agent conflict prevention
- final integration review
- design-system consistency

Create:

`docs/v1.7/V1_7_IMPLEMENTATION_MAP.md`

Include:

- affected files
- agent ownership
- shared helpers
- shared API contracts
- high-conflict files
- schema changes
- migration needs
- implementation order

## Agent 1 — Ticket Sync Agent

Owns:

- disappearing ENROUTE / ONSITE tickets
- SyncEngine
- ticket delta application
- ticket assignment/query behavior
- pending outbox protection
- version conflict handling
- sync logging

## Agent 2 — Closed Tickets Agent

Owns:

- current-local-day Closed tab
- `closedAt` semantics
- midnight rollover
- timezone correctness
- historical retention

## Agent 3 — Ticket Filter Agent

Owns:

- Filter button
- filter bottom sheet / modal
- filter state
- filter chips
- filter count
- quick clear
- contractor/due/rescheduled/emergency/no-response filters

## Agent 4 — Timesheet Agent

Owns:

- current session view
- daily timeline
- lunch/break/allocation history
- personal time history
- Clock Out layout
- safe-area handling

## Agent 5 — Mobile UI / Design System Agent

Owns:

- design tokens
- ticket card redesign
- ticket detail hierarchy
- customer task-card redesign
- sticky action areas
- bottom sheets
- responsive behavior
- touch-target sizing
- typography/spacing cleanup

## Agent 6 — QA / Regression Agent

Owns:

- independent verification
- sync regression testing
- small-screen testing
- keyboard testing
- offline testing
- day rollover testing
- filter combinations
- timesheet timeline validation

---

# 5. Agent Execution Order

## Stage 1

Agent 0:

- audit architecture
- assign file ownership
- define shared types
- define design tokens
- identify high-risk files

## Stage 2 — Parallel

Agent 1 — Ticket Sync  
Agent 2 — Closed Tickets  
Agent 4 — Timesheet

## Stage 3 — Parallel

Agent 3 — Ticket Filtering  
Agent 5 — Mobile UI / Design System

Coordinate shared Tickets screen files before editing.

## Stage 4

Agent 0:

- integrate
- reconcile shared helpers
- eliminate duplicated logic
- run typecheck/lint

## Stage 5

Agent 6:

- regression and usability test pass

---

# 6. Priority 1 — Ticket Disappearance Sync Bug

## Reported Behavior

A technician changes a ticket to:

- ENROUTE
- ONSITE

The ticket remains visible briefly.

A few seconds later the ticket disappears from the technician board.

Later, it reappears.

This is likely a synchronization race, version mismatch, assignment inconsistency, or board-query issue.

Do not treat it as a simple UI rendering problem without tracing the full data flow.

---

# 7. Required End-to-End Ticket Trace

Instrument one ticket through:

```text
ASSIGNED
↓
Tech taps ENROUTE
↓
Watermelon optimistic write
↓
Outbox event created
↓
P0 flush
↓
Backend receives event
↓
Backend applies event
↓
Backend updates ticket/version
↓
Mobile ticket pull
↓
Delta received
↓
Delta reconciliation
↓
Ticket board query reevaluates
```

Log:

- ticketId
- ticketNumber
- assignedTechId
- local status
- local locatorStatus
- backend status
- backend locatorStatus
- local version
- server version
- syncState
- requestId
- event type
- outbox status
- pending event count
- incoming delta version
- incoming assignment
- board inclusion/exclusion reason

---

# 8. Sync Root Causes to Investigate

## 8.1 Stale Server State Overwrites Optimistic Local State

Possible:

```text
Mobile:
ASSIGNED → ENROUTE

Server:
ASSIGNED

Mobile pulls before server event finishes.

Old server row temporarily replaces ENROUTE.

Later:
server catches up
ticket returns
```

Pending local intent must not be overwritten by older state.

## 8.2 Version Race

Audit whether both client and server are independently advancing ticket version.

Preferred long-term model:

```text
server authoritative version
+
local pending event overlay
=
effective mobile state
```

Avoid two independent authorities updating the same version counter.

## 8.3 Assignment Field Is Being Lost

Verify no incoming sync update clears:

- assignedTechId
- locatorStatus
- L720-only operational fields

Upstream ticket updates must not wipe corporate assignment data.

## 8.4 Active Board Query Excludes Active Workflow States

The active board should conceptually be:

```text
assignedTechId == currentTech
AND
ticket is not operationally CLOSED/CANCELLED
```

It should include:

- ASSIGNED
- ENROUTE
- ONSITE
- PAUSED

## 8.5 `status` vs `locatorStatus` Confusion

Do not treat these as the same concept.

`status` may represent broad ticket lifecycle.

`locatorStatus` represents technician workflow.

Changing locator state must not accidentally make the ticket fail a broad "open" query.

## 8.6 Pending Event Conflict Handling

Avoid simplistic behavior such as:

```text
if ticket has pending event:
    ignore entire server delta
```

Prefer field-aware reconciliation or a pending-event overlay.

---

# 9. Ticket Sync Invariants

After v1.7:

- ENROUTE cannot make a ticket disappear.
- ONSITE cannot make a ticket disappear.
- PAUSED cannot make a ticket disappear.
- Pending local status cannot be overwritten by older server state.
- Assignment remains stable unless an authoritative reassignment occurs.
- Duplicate requestId/event retry is idempotent.
- Server acknowledgement clears pending state cleanly.
- Offline → reconnect converges without visible state regression.
- Manual refresh during a pending status change does not remove the ticket.

Create:

`docs/v1.7/TICKET_SYNC_REPORT.md`

---

# 10. Priority 2 — Daily Closed Tickets

## Requirement

The technician Closed tab should show only tickets closed during the current local calendar day.

Historical tickets stay in the backend.

Later search will provide historical access.

The Closed tab is a **daily operational view**, not storage.

---

# 11. Canonical Closure Rule

Use authoritative:

```text
closedAt
```

Do not substitute:

- updatedAt
- local save time
- sync time
- customer completion timestamp

unless backend architecture explicitly defines them as equivalent.

---

# 12. Local Day Rule

```text
startOfLocalDay <= closedAt < startOfNextLocalDay
```

Handle:

- time zones
- daylight saving
- overnight app use
- app left open past midnight

At midnight:

- yesterday's items disappear from the default Closed tab
- no backend history is deleted
- app restart is not required

---

# 13. Closed Ticket Future-Proofing

Do not remove historical records from local/server storage merely to create the daily view.

Future search should reasonably support:

- ticket number
- address
- contractor
- date closed
- ticket type
- utility
- technician

Create:

`docs/v1.7/CLOSED_TICKETS_REPORT.md`

---

# 14. Priority 3 — Modern Ticket Screen Architecture

The Tickets screen should feel like a professional field operations board.

Avoid:

- giant page titles
- large unused blank areas
- excessive decorative cards
- tiny status pills
- weak touch targets

Prefer:

- compact headers
- fast scanning
- visible active state
- clear due urgency
- strong filter visibility

---

# 15. Ticket Screen Header

Recommended structure:

```text
Tickets

Open 18     Closed 7

[ Search tickets... ]   [ Filter ]

[Metro Fiber ×] [Due Today ×]
Clear filters
```

Do not use a huge title section consuming the top quarter of the screen.

The ticket list should begin quickly.

---

# 16. Ticket Card Design

Ticket cards are one of the most important components in Locate720.

A technician should be able to scan:

- ticket number
- address
- contractor
- due urgency
- ticket type
- utilities
- current workflow state

without opening the ticket.

Recommended hierarchy:

## Top Row

- ticket number
- ticket type

## Primary

- full address

## Secondary

- contractor
- contractor phone if useful

## Utilities

- compact icons/labels

## Bottom

- due time
- urgency
- current workflow state if active

---

# 17. Workflow State Should Affect the Card

Do not rely solely on a small:

```text
[ ONSITE ]
```

pill.

## ENROUTE

Use:

- colored side rail
- subtle background tint
- route/navigation icon
- small ENROUTE label if needed

## ONSITE

Use:

- stronger accent
- location/crosshair motif
- subtle tinted background
- visible elapsed onsite duration

## PAUSED

Use:

- muted accent
- pause icon
- paused duration

This allows active tickets to be identified instantly.

---

# 18. Due Urgency vs Workflow Status

These represent different dimensions.

A ticket may be:

```text
ONSITE
+
OVERDUE
```

Use separate visual channels.

Recommended:

- card treatment = workflow state
- due label/accent = urgency

Example:

```text
ONSITE

410 Sunset Dr
Metro Utility

OVERDUE · 34m
```

Do not rely on color alone.

---

# 19. Due Urgency System

Define one canonical due-urgency model.

Audit current implementation first.

Possible buckets:

- OVERDUE
- DUE_WITHIN_2_HOURS
- DUE_TODAY
- DUE_WITHIN_72_HOURS
- FUTURE

The filter system, ticket cards, and future Ops map should use the same semantics.

---

# 20. Ticket Filter System

Add a prominent Filter control.

Prefer a **bottom sheet** instead of a tiny centered modal.

Bottom sheets are easier to use one-handed and adapt better to mobile screens.

---

# 21. Initial Filters

## Contractor

- case-insensitive
- known contractor list or searchable selector

## Due

- Overdue
- Due within 2 hours
- Due today
- Due within 72 hours
- Future
- custom date range later

## Rescheduled

- All
- Rescheduled
- Not Rescheduled

## Emergency

Canonical emergency ticket type.

## No Response

Canonical No Response ticket type/state.

---

# 22. Filter UX

No filters:

```text
Filter
```

Three filter categories active:

```text
Filter (3)
```

Also show active chips:

```text
[Metro Fiber ×] [Due Today ×] [Emergency ×]
```

And:

```text
Clear all
```

A technician should always know why tickets are missing.

---

# 23. Filter Bottom Sheet

Recommended:

```text
Filter Tickets

Contractor
[Any contractor ▼]

Due
○ All
○ Overdue
○ Due today
○ Due within 2 hours

☐ Emergency
☐ No Response
☐ Rescheduled

Clear All        Apply Filters
```

Use temporary filter state until Apply.

Cancel should preserve previous filters.

---

# 24. Filtering Order

Correct order:

```text
1. Get authorized/assigned technician tickets
2. Separate active vs today's closed
3. Apply technician-selected filters
4. Sort
5. Render
```

Filtering must not affect sync or assignment state.

---

# 25. Filter Empty State

If filters hide all tickets:

```text
No tickets match your filters.
```

Do not show:

```text
No assigned tickets.
```

---

# 26. Ticket Detail Information Architecture

Use progressive disclosure.

Recommended tabs/sections:

- Overview
- Customers
- Attachments
- Notes

The Overview should surface important data first.

---

# 27. Ticket Overview Structure

Recommended order:

```text
Ticket #0126-ROCK-002391
EMERGENCY

824 Ridge Road
Rockwall, TX 75087
[Open Map]

Due
Today · 2:40 PM
1h 12m remaining

Contractor
Metro Fiber
(214) 555-1212
contractor@example.com

Contact
John Smith

Work Type
Bore new fiber

Marking Instructions
Locate entire ROW...
```

Phone and email should clearly appear interactive.

---

# 28. Sticky Primary Actions

Important workflow actions should not disappear far below the fold.

Use a bottom action area that respects safe-area insets.

Examples by state:

```text
[ EN ROUTE ]
```

then:

```text
[ ON SITE ]
```

then:

```text
[ PAUSE ]    [ CUSTOMER WORK ]
```

The exact buttons may vary, but the current primary action should remain obvious.

---

# 29. Customer Tab as a Task List

Treat each customer as a work item.

Incomplete customer:

```text
Electric
Utility Name

Status
[ Select status ▼ ]

Minutes
[ 28 ]

Footage
[ 430 ]

[ Complete ]
```

Once completed, collapse:

```text
✓ Electric — Marked
28 min · 430 ft

[ Edit ]
```

Benefits:

- less scrolling
- less visual clutter
- better keyboard behavior
- incomplete work remains prominent

---

# 30. Customer Progress

At the top:

```text
Customers
3 of 5 complete

████████████░░░░
```

Also show time allocation:

```text
Onsite      54 min
Allocated   46 min
Remaining    8 min
```

Do not wait until Close Ticket to reveal a remaining-time problem.

---

# 31. Close Ticket Completion State

When all customers are complete:

```text
✓ All customers completed

Time Allocation
Onsite        68 min
Allocated     68 min
Remaining      0 min

[ CLOSE TICKET ]
```

If time remains:

```text
⚠ 7 minutes unallocated

Allocate remaining onsite time before closing.

[ Review Allocation ]
```

Prefer this over a generic alert dialog.

---

# 32. Keyboard-Aware Customer Layout

The Customer screen must work with:

- 1 customer
- 2 customers
- many customers
- keyboard open
- minutes input
- footage input

Use:

- KeyboardAvoidingView where appropriate
- dynamic bottom inset
- keyboard-aware scrolling
- focused-input measurement
- safe-area spacing
- `keyboardShouldPersistTaps`

Avoid a permanent arbitrary spacer.

---

# 33. Distinguish Scrolling Modes

The Customer screen may have:

- user scroll
- keyboard-driven scroll
- application auto-scroll

These should not fight.

Track concepts such as:

```text
isUserScrolling
pendingAutoScrollTarget
hasAutoScrolledToCloseSection
lastAutoScrollTarget
```

When manual scrolling begins, suppress nonessential auto-scroll.

---

# 34. Timesheet as a Timeline

Timesheet should not look like a collection of disconnected settings cards.

It should communicate a workday moving through time.

---

# 35. Current Timesheet State

At the top, prominently show the current state.

Example:

```text
CLOCKED IN

Locating
3h 42m

Since 8:01 AM
```

Lunch:

```text
ON LUNCH

24m

Started 12:06 PM
```

Break:

```text
ON BREAK

8m

Started 2:31 PM
```

The current state should be immediately obvious.

---

# 36. Timesheet Controls

Primary controls should be larger.

Example:

```text
[ Lunch ] [ Break ]

[ Change Allocation ]

[ CLOCK OUT ]
```

Use a clear hierarchy:

- Clock Out = primary
- Lunch/Break = secondary
- Change Allocation = secondary

---

# 37. Today's Timeline

Show:

- clock in
- allocation changes
- lunch
- break
- personal
- clock out

Example:

```text
7:41 AM
● Clocked In
  Locating

10:12 AM
● Training
  42m

10:54 AM
● Locating

12:06 PM
● Lunch
  12:06 PM – 12:36 PM
  30m
```

---

# 38. Current Session vs Today

Distinguish:

## Current Session

The currently active clock session.

## Today

All sessions/events belonging to the current workday.

If technician clocks out and later clocks in again:

- Current Session = new session
- Today's Timeline = both sessions

---

# 39. Clock Out Safe-Area Bug

Clock Out currently extends too far down and overlaps the bottom navigation.

Fix using:

- safe-area inset
- actual bottom tab height
- scrollable content
- bottom content padding

Do not hardcode one device-specific margin.

Test:

- Android gesture navigation
- Android 3-button navigation
- small phone
- large phone

---

# 40. Mobile Design System

Create/normalize shared tokens.

Suggested:

```text
src/ui/
  colors.ts
  spacing.ts
  typography.ts
  radius.ts
  shadows.ts
```

Recommended baseline:

| Token | Suggested Value |
|---|---:|
| Screen horizontal padding | 16dp |
| Tight spacing | 6–8dp |
| Normal spacing | 12dp |
| Section spacing | 16–20dp |
| Card radius | 12–16dp |
| Bottom sheet radius | 20–24dp |
| Primary button height | 50–56dp |
| Secondary button height | 44–48dp |
| Minimum touch target | 44–48dp |
| Main title | 22–26sp |
| Section title | 16–18sp |
| Body | 14–16sp |
| Metadata | 12–13sp |

Avoid random one-off values across screens.

---

# 41. Color Rules

Use color for meaning.

## Workflow State

Controls card/background treatment.

## Due Urgency

Controls due label/urgency accent.

## Utility Type

Mostly icon/label color.

## Actions

Brand colors.

## Error / Warning

Reserve for actual problems.

Do not make every piece of metadata brightly colored.

---

# 42. Accessibility

Do not rely on color alone.

Bad:

```text
red due time
```

Better:

```text
OVERDUE · 34m
```

Bad:

```text
orange marker only
```

Better:

```text
DUE SOON · 48m
```

Use readable contrast for outdoor conditions.

Avoid:

- tiny metadata
- low-contrast gray
- hairline borders for important states

---

# 43. Button Hierarchy

## Primary

One strongest action for current state.

Examples:

- ON SITE
- CLOSE TICKET
- CLOCK OUT

## Secondary

Important alternatives.

Examples:

- Pause
- Change Allocation
- Add Note

## Tertiary

Utility actions.

Examples:

- Edit
- Clear
- View

Avoid five equally prominent buttons.

---

# 44. Bottom Sheets Over Desktop-Style Modals

Prefer bottom sheets for:

- filters
- customer status
- allocation choice
- work type
- future rescheduling

They are:

- easier one-handed
- more responsive
- more natural on mobile
- easier to scroll

---

# 45. Responsive Layout Rules

Responsive does not mean shrinking everything.

## Phone

Use single-column layouts.

## Large Phone / Landscape

Allow compact secondary information rows.

## Tablet / Future Ops

Use split layouts where useful:

```text
Ticket list | Ticket detail
```

Do not make font sizes tiny simply to fit more.

---

# 46. Offline / Sync Feedback

The technician should be able to distinguish:

- local action saved
- pending sync
- fully synchronized

Do not expose technical details unnecessarily.

Example:

```text
ENROUTE
Saving…
```

then:

```text
ENROUTE
✓ Synced
```

For offline:

```text
Offline · changes will sync automatically
```

Use an unobtrusive banner rather than blocking modal.

---

# 47. Loading Behavior

Prefer showing cached/local data immediately.

Avoid:

- blank screen + giant spinner
- layout jumping

Use skeletons only where no local data exists.

---

# 48. Animation Guidelines

Use animation only when it improves understanding.

Good:

- completed customer collapses
- Close Ticket section appears
- filter sheet opens
- status transitions
- progress bar changes

Avoid decorative animation that slows field use.

---

# 49. Observability

Add development logging around sync and board visibility.

Suggested events:

- TICKET_STATUS_LOCAL_UPDATE
- OUTBOX_EVENT_QUEUED
- OUTBOX_EVENT_FLUSH_STARTED
- OUTBOX_EVENT_ACKED
- TICKET_PULL_STARTED
- TICKET_DELTA_RECEIVED
- TICKET_DELTA_APPLIED
- TICKET_DELTA_SKIPPED
- TICKET_BOARD_INCLUDED
- TICKET_BOARD_EXCLUDED

Include:

- ticketId
- assignedTechId
- status
- locatorStatus
- version
- syncState
- requestId

Do not leave noisy production logging enabled.

---

# 50. QA — Ticket Sync

Test repeatedly:

```text
ASSIGNED
→ ENROUTE
→ wait
→ ONSITE
→ wait
→ PAUSE
→ resume
```

Also:

- offline
- reconnect
- delayed backend
- duplicate event retry
- manual refresh during pending event
- app background/foreground
- weak connection

Ticket must remain visible unless explicitly reassigned/closed/cancelled.

---

# 51. QA — Closed Tickets

Test:

- none closed today
- one closed today
- several closed today
- yesterday's closures
- 11:59 PM closure
- midnight rollover
- 12:01 AM closure
- app stays open through midnight

Backend must retain history.

---

# 52. QA — Filters

Test:

- contractor only
- due only
- emergency only
- no response only
- rescheduled only
- multiple combinations
- zero matches
- clear chip
- Clear All
- cancel modal
- apply modal
- filters remain separate from sync

---

# 53. QA — Customer UX

Test:

- 1 customer
- 2 customers
- 5 customers
- many customers
- completed customer collapse
- manual scroll
- auto-scroll
- keyboard open
- minutes
- footage
- close-ticket reveal
- allocation mismatch

---

# 54. QA — Timesheet

Test:

- clock in
- allocation switch
- lunch
- multiple breaks
- personal
- clock out
- second session same day
- timeline order
- active-session timer
- bottom safe-area
- small Android device

---

# 55. Performance

Avoid:

- parsing `payloadJson` repeatedly on every render
- rebuilding filter options on every frame
- multiple components independently deriving the same ticket state
- network request per button press when local-first behavior is expected

Use:

- pure selectors
- memoization where useful
- centralized helpers
- local database as immediate UI source

---

# 56. Migration Safety

If WatermelonDB schema changes:

- bump schema version
- create migration
- preserve tickets
- preserve drafts
- preserve outbox

If backend schema changes:

- use explicit migration/repair
- retain historical ticket data

Do not reset databases as a shortcut.

---

# 57. Required Documentation

Create:

```text
docs/v1.7/
  V1_7_IMPLEMENTATION_MAP.md
  TICKET_SYNC_REPORT.md
  CLOSED_TICKETS_REPORT.md
  FILTERING_REPORT.md
  TIMESHEET_REPORT.md
  MOBILE_UI_SYSTEM.md
  QA_REPORT.md
  V1_7_FINAL_REPORT.md
```

---

# 58. Definition of Done — Sync

- [ ] ENROUTE stays visible
- [ ] ONSITE stays visible
- [ ] PAUSED stays visible
- [ ] Pending local state not overwritten by stale server state
- [ ] Assignment remains stable
- [ ] Retry is idempotent
- [ ] Offline/reconnect converges correctly
- [ ] Root cause documented

---

# 59. Definition of Done — Closed Tickets

- [ ] Closed tab shows only current local day's tickets
- [ ] Midnight resets the daily view
- [ ] Backend history remains intact
- [ ] Timezone-safe behavior
- [ ] No historical ticket deletion

---

# 60. Definition of Done — Filtering

- [ ] Filter control
- [ ] Filter bottom sheet
- [ ] Contractor
- [ ] Due
- [ ] Rescheduled
- [ ] Emergency
- [ ] No Response
- [ ] Active filter count
- [ ] Visible filter chips
- [ ] Quick clear
- [ ] Clear All
- [ ] Filtered empty state

---

# 61. Definition of Done — Timesheet

- [ ] Current state clearly visible
- [ ] Current session timer
- [ ] Clock-in shown
- [ ] Allocation changes shown
- [ ] Allocation durations shown
- [ ] Lunch start/end/duration
- [ ] Break start/end/duration
- [ ] Personal time if supported
- [ ] Clock-out shown
- [ ] Today's Timeline
- [ ] Multiple same-day sessions
- [ ] Clock Out does not overlap bottom navigation

---

# 62. Definition of Done — Mobile UI

- [ ] Shared spacing tokens
- [ ] Shared typography tokens
- [ ] Shared radius tokens
- [ ] Better ticket information density
- [ ] Active ticket card treatment
- [ ] Due urgency remains distinct
- [ ] Larger touch targets
- [ ] Sticky primary ticket actions where appropriate
- [ ] Customer cards collapse after completion
- [ ] Customer progress visible
- [ ] Time allocation visible before close
- [ ] Filters use mobile-friendly bottom sheet
- [ ] Timesheet uses timeline presentation
- [ ] Keyboard-aware layouts
- [ ] Responsive behavior tested
- [ ] Color is not the only status indicator

---

# 63. Non-Goals

Do not expand v1.7 into unrelated large features.

Not primary goals:

- full historical ticket search implementation
- RD8200 Bluetooth
- production rescheduling workflow
- advanced supervisor analytics
- payroll
- live employee GPS tracking
- major backend rewrite

---

# 64. Final Release Philosophy

Locate720 v1.7 should feel like a **purpose-built field operations application** rather than a set of generic React Native screens.

A technician should be able to understand a screen in roughly two seconds.

For every screen ask:

1. What is most important right now?
2. What action is most likely next?
3. Can that action be done with one thumb?
4. Is important information duplicated?
5. Can completed information collapse?
6. Does the layout still work with the keyboard open?
7. Does it still work on a small Android phone?
8. Does poor connectivity produce confusing state?
9. Are active filters visible?
10. Could the technician mistake a UI state for lost data?

The release should make Locate720 **more trustworthy, denser, clearer, and faster to use in the field** while fixing the underlying synchronization and workday-history problems.
