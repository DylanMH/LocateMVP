# Locate720 v1.6 — Major Cleanup, Mobile UX, Role-Based Ops, and Architecture Consolidation

## Document Purpose

This document defines the full engineering scope for **Locate720 v1.6**.

Version 1.6 is not a small patch release. It is a structured cleanup and architecture release focused on:

1. **Major codebase cleanup and componentization**
2. **Centralized API/data access**
3. **Removal of stale, unused, duplicate, and legacy code**
4. **Mobile bug fixes**
5. **Mobile UI density and navigation improvements**
6. **Clear separation of Timesheet vs Profile responsibilities**
7. **A new role-based mobile experience for Supervisors and Managers**
8. **Consistency between Mobile, DevOps Portal, and the L720 Corporate Backend**
9. **A more maintainable foundation for future operational features**

The long-term goal is for Locate720 to behave as one coordinated operational platform rather than separate frontends with duplicated business logic.

---

# 1. System Context

Locate720 currently consists of multiple systems:

## 1.1 L720 Mobile

Android-first React Native / Expo application used by field employees.

Responsibilities include:

- Authentication
- Assigned ticket retrieval
- Offline-first ticket interaction
- Enroute / onsite / pause workflow
- Customer status handling
- Customer minutes and footage allocation
- Ticket closeout
- Ticket map
- Timesheet
- Clock in / out
- Lunch
- Breaks
- Personal time
- Employee profile
- Offline sync through WatermelonDB + outbox
- Future supervisor / manager operational view

---

## 1.2 L720 Corporate Backend

The authoritative operational backend for Locate720.

Responsibilities include:

- User / employee records
- Roles
- Supervisor / manager hierarchy
- Employee areas
- Ticket assignments
- Ticket status
- Customer closeout state
- Timesheet sessions and events
- Ticket events
- Operational statistics
- DevOps Portal APIs
- Supervisor / manager mobile Ops APIs
- Synchronization with the 811 Simulator

The backend should be the shared operational source of truth for all clients.

---

## 1.3 L720 DevOps Portal

Web-based management / development / future operations portal.

Responsibilities include:

- Tech visibility
- Team visibility
- Ticket visibility
- Map visualization
- Ticket states
- Customer closeout information
- Allocated minutes
- Footage
- Notes
- Attachments
- Timesheet visibility
- Operational statistics
- Future management actions

The portal should consume canonical L720 backend APIs instead of reproducing business rules locally.

---

## 1.4 811 Simulator

Separate system acting as a simulated 811 call center.

Responsibilities include:

- Creating tickets
- Owning original 811-style ticket data
- Delivering ticket data to L720
- Tracking external 811-style state
- Accepting relevant responses from L720

The 811 Simulator must remain separate from L720 operations.

---

# 2. v1.6 Core Engineering Principle

The most important rule for v1.6 is:

> **One business rule should have one canonical implementation.**

Avoid maintaining separate interpretations of the same rule in:

- Mobile
- DevOps
- Backend
- Hooks
- Components
- Utility files

Examples of logic that should be centralized or aligned:

- Locator status
- Due-date urgency
- Ticket type formatting
- Customer completion
- Allocation totals
- Employee role permissions
- Timesheet current state
- Daily statistics
- API paths
- Ticket DTO normalization
- Map marker categories

---

# 3. Agent Split

Version 1.6 should be handled by separate focused coding agents.

## 3.1 Agent A — Mobile Agent

### Scope

Agent A owns only the mobile application and mobile-facing domain logic.

Responsibilities:

- React Native
- Expo Router
- WatermelonDB
- Mobile synchronization
- Mobile components
- Mobile navigation
- Mobile ticket UI
- Mobile map
- Mobile Timesheet
- Mobile Profile
- Mobile role-based navigation
- Supervisor mobile Ops
- Manager mobile Ops
- Mobile API modules
- Mobile-specific tests

### Agent A must not:

- Redesign DevOps Portal
- Change DevOps-only presentation code
- Modify backend route behavior without documenting the required contract
- Reimplement backend authorization logic in the client

---

## 3.2 Agent B — DevOps Agent

### Scope

Agent B owns the web portal.

Responsibilities:

- Portal code cleanup
- Portal componentization
- Portal API access
- Ticket tables
- Map visualization
- Tech / team views
- Ticket details
- Timesheet display
- Operational dashboards
- Shared presentation standards
- Removal of stale DevOps code
- DevOps-specific tests

### Agent B must not:

- Rewrite mobile components
- Create mobile-only API behavior
- Duplicate backend business rules unnecessarily

---

## 3.3 Shared Coordination Layer

Both agents must coordinate around the L720 backend contracts.

Canonical backend concepts should include:

- User roles
- Team hierarchy
- Ticket status enums
- Due urgency categories
- Customer completion shape
- Ticket Ops DTOs
- Timesheet Ops DTOs
- Map DTOs
- Permission behavior
- API error structure

Where direct shared TypeScript packages are not practical, each frontend should mirror the same documented contract exactly.

---

# 4. Phase 0 — Full Codebase Audit

Before large changes, both agents must analyze their codebases.

Create a current-state report.

Suggested file:

`docs/V1_6_CODEBASE_AUDIT.md`

## 4.1 Mobile Audit

Identify:

- Screens
- Routes
- Components
- Hooks
- API calls
- Watermelon models
- Database schema
- Outbox behavior
- Ticket utilities
- Timesheet utilities
- Profile statistics
- Map dependencies
- Role logic
- Current auth model
- Existing feature flags
- Existing safe-area handling
- Existing keyboard handling

Search specifically for:

- duplicate date formatting
- duplicate status formatting
- duplicate colors
- repeated `JSON.parse(ticket.payloadJson)`
- repeated role checks
- repeated API base URL logic
- repeated ticket mapping
- old seeded data
- abandoned hooks
- legacy Expo test code
- dead screens
- old clock state
- stale dev-only state

## 4.2 DevOps Audit

Identify:

- Pages
- Route handlers
- API modules
- Tables
- Maps
- Ticket components
- User / tech components
- Statistics
- Due color logic
- Ticket status color logic
- Any direct DB assumptions
- Repeated fetch logic
- Old development pages
- Old ticket generator controls
- Abandoned components

## 4.3 Required Audit Output

For each discovered redundancy:

- File
- Function / component
- Duplicate of
- Whether it is safe to remove
- Replacement
- Risk
- Dependencies

Do not delete based only on static editor "unused" warnings.

Confirm:

- Expo Router dynamic usage
- callback references
- route imports
- backend contract references
- test references
- lazy/dynamic imports

---

# 5. Phase 1 — Centralized API Architecture

A major v1.6 goal is to remove scattered network calls.

## 5.1 Mobile API Layer

Suggested structure:

```text
src/
  api/
    client.ts
    auth.ts
    tickets.ts
    timesheets.ts
    users.ts
    ops.ts
    map.ts
```

### `client.ts`

Owns:

- Base URL
- Auth header
- JSON parsing
- Standard errors
- Timeout
- Retry policy
- Request logging in development
- Version headers if required

No screen should build API URLs manually.

## 5.2 DevOps API Layer

Suggested structure:

```text
src/
  api/
    client.ts
    tickets.ts
    users.ts
    timesheets.ts
    ops.ts
    map.ts
```

The portal may use a different networking implementation than React Native, but endpoint contracts must match.

## 5.3 Canonical API Functions

Examples:

```ts
getMyAssignedTickets()
getTicketById()
getCurrentTimesheet()
getTodayTimesheet()
clockIn()
clockOut()
startLunch()
endLunch()
startBreak()
endBreak()

getOpsOverview()
getOpsTechs()
getOpsTechById()
getOpsTechTickets()
getOpsTickets()
getOpsTicketById()
getOpsMapData()
```

---

# 6. Phase 2 — Remove Stale and Duplicate Code

After the audit and before feature expansion:

Remove safely confirmed:

- legacy ticket generator code from L720
- stale test screens
- obsolete local ticket seed flows
- duplicate API wrappers
- duplicate ticket formatting helpers
- unused role helpers
- abandoned clock state
- unused selectors
- unused hooks
- dead components
- old map implementations
- dev-only hacks no longer required
- duplicate constants
- stale migration compatibility logic no longer supported

Every deletion should have a known replacement or documented reason.

---

# 7. Phase 3 — Mobile Bug: Map Tab Crash

## 7.1 Problem

Opening the Map tab currently crashes the application.

This is a release-blocking bug.

## 7.2 Root Cause Investigation

Inspect:

- Map package native compatibility
- Expo dev client configuration
- Android native requirements
- Permissions
- Invalid coordinates
- null latitude
- null longitude
- malformed ticket payload
- invalid region calculations
- markers rendering before data is ready
- empty ticket arrays
- unstable marker keys
- NaN coordinates
- unavailable map provider
- map screen error boundaries
- offline state
- stale Watermelon objects

Do not simply wrap the entire screen in `try/catch`.

## 7.3 Required Behavior

Map screen must work when:

- zero tickets exist
- one ticket exists
- dozens of tickets exist
- a ticket has no coordinates
- a ticket has invalid coordinates
- device is offline
- local database contains stale ticket rows
- server refresh is in progress

Invalid tickets should be skipped individually.

## 7.4 Acceptance Criteria

- No crash when opening Map
- Valid markers display
- Invalid markers are ignored
- Map renders from cached tickets offline
- Loading state is clear
- Empty state is clear
- No infinite map recentering
- No route remount loop

---

# 8. Phase 4 — Customer Tab Scrolling Rewrite

Two separate problems exist.

## 8.1 Bug A — Manual Scrolling Breaks Auto-Scroll

Current behavior appears to mix:

- automatic scrolling
- user-driven scrolling

The app must distinguish between them.

Suggested state concepts:

```ts
isUserScrolling
lastAutoScrollTarget
hasAutoScrolledToCloseSection
pendingScrollTarget
```

Listen to:

```text
onScrollBeginDrag
onScrollEndDrag
onMomentumScrollEnd
```

When the user intentionally scrolls, do not repeatedly override their position.

## 8.2 Auto-Scroll Rules

Automatic scrolling should happen only when meaningful new content appears.

Examples:

- customer is completed and next customer expands
- Close Ticket section becomes available
- validation error needs to reveal a hidden field
- keyboard focus requires repositioning

Do not call `scrollToEnd()` after every render or customer state update.

## 8.3 Bug B — Keyboard Covers Inputs

When only a few customers exist, the scroll content may be shorter than the screen.

Opening the keyboard can then cover:

- minutes
- footage
- customer actions

The screen cannot scroll enough to expose them.

## 8.4 Keyboard-Aware Requirements

Use proper layout techniques such as:

- `KeyboardAvoidingView`
- safe-area insets
- dynamic keyboard-aware bottom inset
- `keyboardShouldPersistTaps`
- focused input measurement
- scroll-to-focused-input
- content container bottom padding based on keyboard/safe-area behavior

Avoid permanent arbitrary giant spacers.

## 8.5 Test Matrix

Test Customer tab with:

- 1 customer
- 2 customers
- 3 customers
- 5 customers
- 10+ customers

For each:

- status field
- minutes
- footage
- keyboard opening
- manual scroll
- automatic scroll
- close ticket reveal

---

# 9. Phase 5 — Timesheet vs Profile Responsibility Cleanup

This version must remove ambiguity between Profile and Timesheet.

## 9.1 Timesheet Owns Current Session

Timesheet answers:

> What am I doing right now?

Timesheet displays:

- Current clock status
- Current session start
- Current session duration
- Current allocation
- Allocation history
- Lunch state
- Break state
- Personal state
- Current session timeline
- Clock Out action

## 9.2 Profile Owns Employee Information + Aggregate Stats

Profile answers:

> Who am I and how have I performed today?

Profile may display:

- Name
- ID
- Email
- Role
- Area
- Today's total worked time
- Tickets completed today
- Footage
- Performance metrics
- Historical statistics

Profile must **not** display a separate active Clocked In card.

## 9.3 Profile Today Stats

"Today" should represent all relevant sessions for the current local calendar day.

It must not represent only the current active session.

If a technician:

1. clocks in
2. clocks out
3. clocks in again

Profile Today's Stats should include both sessions.

Timesheet should focus on the active/current session and the detailed day timeline.

---

# 10. Phase 6 — Mobile UI Density and Navigation Cleanup

## 10.1 Current Issues

- Too much blank space
- Small controls
- Weak page hierarchy
- Bottom navigation feels default/sparse
- Important field actions are visually understated

## 10.2 Design Goals

Mobile should feel:

- professional
- field-focused
- information-rich
- fast to use with one hand
- readable outdoors
- touch-friendly
- modern but not decorative

## 10.3 Touch Targets

Important controls should generally have at least:

```text
44–48dp
```

effective touch target.

Particularly:

- En Route
- On Site
- Pause
- Customer status
- Complete Customer
- Close Ticket
- Clock In
- Clock Out
- Lunch
- Break
- Personal
- Supervisor Ops cards

## 10.4 Layout Hierarchy

Prefer:

```text
Screen title / context
Primary status
Primary actions
Critical data
Secondary details
History / supporting information
```

Avoid multiple large empty cards that contain only one line.

## 10.5 Tab Bar

Audit:

- icon sizes
- label sizes
- active color
- inactive color
- tab height
- safe-area spacing
- clipping
- blank padding
- landscape behavior if supported

---

# 11. Phase 7 — Role-Based Mobile Architecture

This is the major new v1.6 feature.

The same application supports:

```text
TECH
SUPERVISOR
MANAGER
```

The mobile experience must change significantly based on role.

Do not implement this as a handful of hidden buttons.

Use role-specific app shells.

---

# 12. TECH Mobile Experience

Current field workflow remains Tech-focused.

Suggested tabs:

```text
Tickets
Map
Timesheet
Profile
```

Tech scope:

- own assigned tickets
- own map
- own timesheet
- own profile
- own statistics

Tech must not receive team-wide data from the backend.

---

# 13. SUPERVISOR Mobile Experience

Supervisor should receive a mobile Ops interface.

Suggested tabs:

```text
Overview
Techs
Tickets
Map
Profile
```

This is a mobile operational view, not a locator workflow.

## 13.1 Supervisor Overview

Show team-level health.

Suggested metrics:

- Total techs
- Clocked-in techs
- Enroute techs
- Onsite techs
- Paused techs
- Lunch / break state if useful
- Open tickets
- Overdue tickets
- Due-soon tickets
- Tickets completed today
- Total team footage today
- Teams with sync issues
- High-priority tickets

Suggested sections:

### Needs Attention

- overdue tickets
- stalled tickets
- offline techs with pending work
- tickets nearing due time

### Active Techs

- current activity
- active ticket
- area
- session duration

### Team Summary

- total worked time
- tickets completed
- footage
- open backlog

---

# 14. Supervisor Techs Tab

Display technicians under this supervisor.

Each tech card may show:

```text
Name
Area
Current work state
Current ticket
Worked today
Tickets completed today
Footage today
Open assigned tickets
Overdue assigned tickets
Last activity
```

Example:

```text
John Smith
Rockwall

ON SITE
0126-ROCK-002391

Today
7h 21m
8 tickets completed
3,420 ft

Assigned
17 open
2 overdue
```

---

# 15. Supervisor Tech Detail

When tapping a tech, show an operational employee view.

## 15.1 Employee Information

- Name
- Employee ID
- Email
- Area
- Role
- Supervisor
- Current clock state
- Last sync / last activity if available

## 15.2 Current Activity

Possible states:

- Clocked Out
- Locating
- Training
- Meeting
- Truck Support
- Lunch
- Break
- Personal
- Enroute
- Onsite
- Paused

The system may have both a timesheet state and a ticket state.

Present them clearly instead of collapsing unrelated states into one label.

Example:

```text
Timesheet: LOCATING
Ticket: ON SITE
```

## 15.3 Active Ticket

Show:

- Ticket #
- Address
- Contractor
- Due time
- Ticket type
- Locator status
- Enroute duration
- Onsite duration
- Customer completion
- Allocation summary

## 15.4 Assigned Tickets

Supervisor can view all tickets belonging to the tech.

Filters:

- Open
- Enroute
- Onsite
- Paused
- Overdue
- Due today
- Closed today

## 15.5 Today's Timeline

Show:

- Clock in
- Allocation changes
- Lunch
- Breaks
- Personal
- Tickets worked
- Enroute
- Onsite
- Ticket completions
- Clock out

---

# 16. Supervisor Tickets Tab

Show tickets for the supervisor's team.

Suggested filters:

- Tech
- Area
- Ticket state
- Locator state
- Due urgency
- Ticket type
- Contractor
- Customer / utility
- Overdue only

Suggested columns/cards:

- Ticket number
- Address
- Contractor
- Assigned tech
- Due
- Locator state
- Customer completion
- Allocated vs onsite time
- Ticket type

---

# 17. Supervisor Ticket Detail

Supervisor ticket detail should be operationally richer than Tech detail.

Display:

- Original ticket info
- Assigned tech
- Current ticket state
- Locator status
- Full event timeline
- Customers
- Customer status
- Minutes
- Footage
- Notes
- Attachments
- Enroute duration
- Onsite duration
- Pauses
- Current sync state
- Closure details

Future actions may include:

- Reassign
- Reschedule
- Supervisor Close

Do not enable actions in v1.6 unless permission and backend behavior are implemented safely.

---

# 18. Supervisor Map

Show:

- team tickets
- due urgency
- assigned tech
- active ticket state
- optionally tech current position later

Map marker semantics should match canonical due urgency.

Map should allow:

- filter by tech
- filter by due
- filter active
- select marker
- open ticket detail

---

# 19. MANAGER Mobile Experience

Managers receive a higher-scope Ops experience.

Possible tabs:

```text
Overview
Teams
Tickets
Map
Profile
```

Manager scope may include multiple supervisors and areas.

## 19.1 Manager Overview

Show:

- Supervisor count
- Tech count
- Active techs
- Open tickets
- Overdue tickets
- Completed today
- Area-level backlog
- Team-level backlog
- Productivity aggregates
- Sync health

## 19.2 Teams View

Hierarchy:

```text
Manager
  Supervisor A
    Tech 1
    Tech 2
  Supervisor B
    Tech 3
    Tech 4
```

Manager can drill:

```text
Manager
→ Supervisor
→ Tech
→ Ticket
```

---

# 20. Phase 8 — Organization Hierarchy Backend Support

Do not infer organizational relationships solely from area.

Recommended concepts:

```text
User
  id
  role
  primaryAreaId
  supervisorId?
  managerId?
```

Or normalized organization tables if architecture supports them.

Required logical hierarchy:

```text
Manager
  ↓
Supervisor
  ↓
Tech
```

Area is assignment context, not necessarily hierarchy.

---

# 21. Phase 9 — Backend Authorization and Scope

Frontend visibility is not security.

The L720 backend must determine what each role is allowed to retrieve.

## Tech

Can access:

- own profile
- own timesheet
- own assigned tickets

Cannot access:

- arbitrary employee lists
- another tech's timesheet
- organization Ops

## Supervisor

Can access:

- own profile
- assigned subordinate techs
- team tickets
- team timesheet summaries
- team Ops data

Cannot access unrelated teams unless explicitly authorized.

## Manager

Can access:

- supervisors within scope
- their subordinate techs
- relevant areas
- organization-level Ops within scope

---

# 22. Phase 10 — Canonical Ops Backend API

Mobile Supervisor/Manager and DevOps Portal should rely on the same canonical Ops APIs.

Suggested endpoints:

```text
GET /api/ops/me/overview
GET /api/ops/me/techs
GET /api/ops/me/teams
GET /api/ops/techs/:id
GET /api/ops/techs/:id/tickets
GET /api/ops/tickets
GET /api/ops/tickets/:id
GET /api/ops/map
```

Backend derives caller scope from authenticated identity.

Do not trust client-provided:

```text
supervisorId=
managerId=
```

as authorization.

---

# 23. Canonical Ops DTOs

Avoid returning huge raw DB objects to frontends.

Create frontend-oriented DTOs.

## 23.1 TechOpsSummary

Example:

```ts
interface TechOpsSummary {
  id: string;
  name: string;
  employeeId?: string;
  areaId: string;

  timesheetState: string;
  ticketState?: string;

  currentSessionStartedAt?: number;

  activeTicket?: {
    id: string;
    ticketNumber: string;
    address: string;
    locatorStatus: string;
    dueAt?: number;
  };

  today: {
    workedMinutes: number;
    completedTickets: number;
    footageFeet: number;
  };

  assigned: {
    open: number;
    overdue: number;
    dueSoon: number;
  };

  lastActivityAt?: number;
}
```

## 23.2 OpsTicketSummary

```ts
interface OpsTicketSummary {
  id: string;
  ticketNumber: string;
  address: string;
  areaId: string;

  assignedTech?: {
    id: string;
    name: string;
  };

  ticketType: string;
  status: string;
  locatorStatus: string;

  dueAt?: number;
  dueUrgency: string;

  customers: {
    total: number;
    completed: number;
  };

  allocation?: {
    onsiteMinutes: number;
    allocatedMinutes: number;
    remainingMinutes: number;
  };
}
```

---

# 24. Phase 11 — Shared Business Semantics

Mobile and DevOps should not share React UI components.

They should share behavior contracts.

Bad architecture:

```text
DevOps React component
    ↓
Imported into React Native
```

Good architecture:

```text
L720 Backend DTO
        ↓
Canonical domain semantics
        ↓
Mobile presentation      DevOps presentation
```

---

# 25. Phase 12 — Duplicate Function Cleanup

Search for duplicated functions such as:

```text
formatTicketType
getTicketTypeColor
formatDueDateTime
getDueAccent
getDueUrgency
getUtilityColor
getUtilityIcon
formatLocatorStatus
calculateOnsiteTime
calculateAllocatedTime
calculateTodayStats
parseTicketPayload
formatDuration
formatTimesheetState
```

For each:

1. Determine canonical behavior.
2. Extract pure helper where appropriate.
3. Replace duplicates.
4. Add focused tests.
5. Delete stale copies.

---

# 26. Phase 13 — Canonical Due Urgency

Due urgency should be defined once conceptually.

Current expected categories may resemble:

```text
OVERDUE
DUE_WITHIN_2_HOURS
DUE_TODAY
DUE_WITHIN_72_HOURS
FUTURE
```

Audit actual Mobile behavior before freezing this contract.

Backend may return:

```ts
dueUrgency
```

so clients only determine presentation color.

If clients compute it independently, add parity tests.

---

# 27. Phase 14 — Permission Model

Avoid hundreds of direct role comparisons.

Create canonical permissions.

Examples:

```text
ticket.viewOwn
ticket.viewTeam
ticket.viewOrganization

ticket.reassignTeam
ticket.closeOwn
ticket.closeTeam

timesheet.viewOwn
timesheet.viewTeam
timesheet.viewOrganization

user.viewTeam
user.viewOrganization

ops.viewTeam
ops.viewOrganization
```

Backend remains authoritative.

Mobile may use permission helpers for UI visibility.

---

# 28. Phase 15 — Testing Plan

v1.6 should include a meaningful role and regression test matrix.

---

# 29. Mobile Tech Tests

## Navigation

- Tickets loads
- Map loads
- Timesheet loads
- Profile loads
- Tabs do not clip
- Back navigation works

## Map

- no tickets
- one ticket
- multiple tickets
- invalid location
- offline

## Customers

- 1 customer
- 2 customers
- 5 customers
- large customer set
- keyboard footage
- keyboard minutes
- manual scroll
- auto scroll
- close ticket reveal

## Timesheet

- Clock in
- Allocation change
- Lunch
- Break
- Personal
- Clock out
- Current session correct

## Profile

- No Clocked In card
- Today totals show all day's sessions
- Stats update correctly

---

# 30. Supervisor Tests

- Supervisor login selects Ops shell
- Supervisor only sees own techs
- Overview metrics match backend
- Tech list works
- Tech detail works
- Team tickets work
- Map works
- Ticket details work
- Unauthorized tech cannot be requested manually
- Active statuses update after refresh/sync

---

# 31. Manager Tests

- Manager login selects Manager shell
- Teams load
- Supervisor drilldown
- Tech drilldown
- Tickets aggregate correctly
- Map scope correct
- Unauthorized unrelated organization data blocked

---

# 32. API Contract Tests

Verify:

- Tech cannot call supervisor Ops endpoints successfully
- Supervisor cannot retrieve unrelated team
- Manager receives correct scope
- DTO shape stable
- Null values handled
- Empty result sets handled
- Error responses standardized

---

# 33. Performance Requirements

Supervisor and Manager views may load much more data than Tech views.

Do not return entire organization state in one massive payload.

Use:

- pagination
- server-side filtering
- compact summary DTOs
- detail endpoints
- lazy drilldown
- cached queries where appropriate

Map API should return only fields required to render markers.

---

# 34. Mobile Offline Behavior for Ops

Tech workflow remains strongly offline-first.

Supervisor / Manager Ops can initially be **network-preferred**, but should fail gracefully.

If offline:

- show last cached Ops data where feasible
- clearly indicate stale/offline state
- do not present cached state as live
- prevent actions requiring server authority

Do not make Ops caching interfere with Tech Watermelon ticket storage.

---

# 35. Observability

Add structured development logging around key new role behavior.

Examples:

```text
ROLE_SHELL_SELECTED
OPS_OVERVIEW_LOADED
OPS_TECH_LIST_LOADED
OPS_TECH_DETAIL_LOADED
OPS_MAP_LOADED
OPS_SCOPE_DENIED
MAP_INVALID_TICKET_SKIPPED
CUSTOMER_AUTO_SCROLL
CUSTOMER_MANUAL_SCROLL
KEYBOARD_INPUT_REVEAL
```

Do not log unnecessary personal data.

Use IDs where possible.

---

# 36. Migration Safety

Do not silently reset WatermelonDB.

If schema changes are required:

- bump schema version
- create migration
- preserve existing tickets/drafts/outbox
- document change

Backend database changes should also use migrations or explicit migration scripts.

---

# 37. Documentation Deliverables

Create or update:

```text
docs/V1_6_CODEBASE_AUDIT.md
docs/V1_6_ARCHITECTURE.md
docs/V1_6_API_CONTRACTS.md
docs/V1_6_ROLE_PERMISSIONS.md
docs/V1_6_TEST_PLAN.md
docs/V1_6_CLEANUP_REPORT.md
```

---

# 38. Recommended Implementation Order

## Phase A — Audit

- Mobile audit
- DevOps audit
- Backend API audit
- Duplicate map

Do not feature-build yet.

## Phase B — Cleanup Foundation

- Centralize API modules
- Consolidate shared helpers
- Remove confirmed stale code
- Clean unused imports/components
- Normalize status/date utilities

## Phase C — Fix Existing Mobile Bugs

- Map crash
- Customer auto-scroll
- Customer keyboard visibility
- Profile/Timesheet separation
- Tab spacing/touch target cleanup

Regression test Tech workflow.

## Phase D — Backend Ops Contracts

- Organization hierarchy
- Role authorization
- Ops overview API
- Tech summary API
- Ticket Ops API
- Map API

Verify DevOps can consume them.

## Phase E — Supervisor Mobile

- Role-aware root navigation
- Supervisor Overview
- Techs
- Tech detail
- Team tickets
- Team map
- Profile

## Phase F — Manager Mobile

- Manager Overview
- Teams hierarchy
- Larger ticket scope
- Map
- Profile

## Phase G — DevOps Alignment

Agent B migrates DevOps to canonical APIs.

- Remove duplicate direct fetch logic
- Match due urgency
- Match status semantics
- Use canonical Ops DTOs

## Phase H — Final Cleanup

- Dead code pass
- duplicate helper pass
- old API removal
- documentation
- tests
- lint/typecheck

---

# 39. Definition of Done — v1.6

## Codebase

- [ ] Mobile audit completed
- [ ] DevOps audit completed
- [ ] APIs centralized
- [ ] Confirmed stale code removed
- [ ] Duplicate helpers consolidated
- [ ] No competing ticket status implementations
- [ ] No redundant API URL construction

## Mobile Bugs

- [ ] Map tab does not crash
- [ ] Invalid map tickets cannot crash app
- [ ] Customer manual scrolling does not break automatic scrolling
- [ ] Auto-scroll no longer fights user scrolling
- [ ] Keyboard never blocks minutes/footage inputs
- [ ] Profile active Clocked In card removed
- [ ] Timesheet is canonical current-session screen

## Mobile UI

- [ ] Tab bar improved
- [ ] Major buttons have better touch targets
- [ ] Excess blank space reduced
- [ ] Field workflow feels denser and more deliberate
- [ ] Safe-area behavior correct

## Tech Role

- [ ] Tech sees Tech shell
- [ ] Own tickets only
- [ ] Own map
- [ ] Own timesheet
- [ ] Own profile

## Supervisor Role

- [ ] Supervisor sees Ops shell
- [ ] Overview
- [ ] Team tech list
- [ ] Tech detail
- [ ] Team tickets
- [ ] Team map
- [ ] Team-only backend scope

## Manager Role

- [ ] Manager shell works
- [ ] Supervisor/team hierarchy visible
- [ ] Organization-scoped tickets
- [ ] Organization map
- [ ] Backend scope enforced

## DevOps

- [ ] Uses canonical Ops APIs where appropriate
- [ ] Due urgency consistent with Mobile
- [ ] Ticket state semantics consistent
- [ ] Duplicate portal helpers cleaned

---

# 40. Non-Goals for v1.6

Unless already nearly complete, avoid expanding scope into unrelated systems.

Not primary v1.6 goals:

- full production email integration
- RD8200 Bluetooth
- full 811 rescheduling workflow
- advanced analytics
- payroll integration
- Workday integration
- live GPS employee tracking
- full manager mutation permissions
- deep attachment management redesign

The priority is:

> **Clean architecture + correct mobile behavior + role-based Ops foundation.**

---

# 41. Architectural End State

The desired system after v1.6:

```text
                         811 Simulator
                              │
                              ▼
                       L720 Corporate API
                              │
          ┌───────────────────┼───────────────────┐
          │                   │                   │
          ▼                   ▼                   ▼
     Tech Mobile        Supervisor/Manager      DevOps Portal
                            Mobile Ops
```

All three L720 clients should receive their operational truth from the same L720 backend.

They may present that truth differently.

They should not independently redefine it.

---

# 42. Final Engineering Instruction

Do not approach v1.6 as:

> "Add supervisor screens and fix some bugs."

Approach it as:

> **"Refactor Locate720 into a role-aware operational platform with a cleaner shared architecture."**

Before every major implementation decision, ask:

1. Is this rule already implemented elsewhere?
2. Should the server own it?
3. Will Tech, Supervisor, Manager, and DevOps agree on the result?
4. Does this create another duplicate source of truth?
5. Can the implementation survive additional features later?

If the change introduces a second independent representation of existing operational state, redesign it before proceeding.
