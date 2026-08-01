# Scalability & Performance Notes

## Database Indexing Strategy

### Required Indexes for Production Scale (1000+ techs)

#### tickets table
- **Primary**: `assigned_tech_id + locator_status` (composite)
  - Used by: Active ticket validation queries
  - Impact: O(1) lookup instead of O(n) scan
  
- **Secondary**: `due_at` (single column)
  - Used by: Ticket list sorting
  - Impact: Sorted queries without full table scan

- **Tertiary**: `updated_at + assigned_tech_id` (composite)
  - Used by: Sync pulls to fetch only changed tickets
  - Impact: Delta syncs instead of full refreshes

#### day_sessions table
- **Primary**: `user_id + date` (composite, unique)
  - Used by: Today's session lookup
  - Impact: Single-row direct access
  
- **Secondary**: `created_at` (for sorting latest session)
  - Used by: Finding most recent session when multiple exist
  - Impact: Instant latest session retrieval

#### clock_events table
- **Primary**: `session_id + event_type` (composite)
  - Used by: Break status checks (finding LUNCH_START, etc.)
  - Impact: Instant break state determination
  
- **Secondary**: `user_id + occurred_at` (composite)
  - Used by: Real-time break event observable
  - Impact: Efficient reactive updates

#### outbox_events table
- **Primary**: `status + priority` (composite)
  - Used by: Flush queries (P0, P1 event retrieval)
  - Impact: Instant priority queue operations
  
- **Secondary**: `occurred_at` (for retry logic)
  - Used by: Exponential backoff on failed events
  - Impact: Efficient retry scheduling

## Query Optimization Patterns

### 1. Date Filtering (Applied)
```typescript
// ❌ Bad: Scans all historical events
Q.where('user_id', userId)

// ✅ Good: Only today's events
Q.where('user_id', userId),
Q.where('occurred_at', Q.gte(todayStart))
```

### 2. Reactive Observables (Applied)
```typescript
// ❌ Bad: Polling every N seconds
setInterval(() => checkBreakStatus(), 5000)

// ✅ Good: React to DB changes only
eventsCollection.query(...).observe().subscribe(...)
```

### 3. Filtered Pulls (Applied)
```typescript
// ❌ Bad: Pull all tickets
GET /api/tickets

// ✅ Good: Pull only assigned tickets
GET /api/tickets?assignedTo={userId}
```

### 4. Event Batching (Applied)
```typescript
// ❌ Bad: Send each event individually
for (event of events) { await POST /api/sync/events }

// ✅ Good: Batch send
POST /api/sync/events { events: [...] }
```

## Memory Management

### WatermelonDB Connection Pooling
- Single DB instance shared across app
- Lazy query execution (only fetch when needed)
- Automatic cleanup of old queries

### Observable Lifecycle
- Always unsubscribe in useEffect cleanup
- Prevents memory leaks from stale subscriptions
- Pattern: `return () => subscription.unsubscribe()`

## Network Optimization

### Current Patterns
- **Throttled Pulls**: Max 1 pull per 60 seconds
- **Priority Queues**: P0 (tickets) flush before P1 (timesheet)
- **Offline-First**: No network = no blocking

### Future Enhancements for 1000+ Techs
1. **WebSocket Push**: Replace pull polling with server push
2. **GraphQL Subscriptions**: Real-time ticket updates
3. **CDN Caching**: Static assets and ticket history
4. **Redis Cache**: Backend ticket state caching
5. **Load Balancing**: Horizontal backend scaling

## Code Organization Benefits

### Centralized Types (`src/features/timesheet/types.ts`)
- Single source of truth for event types
- Easy to refactor when requirements change
- TypeScript autocomplete across all files

### Shared Utilities (`src/features/timesheet/utils/`)
- `breakStatus.ts`: Eliminates ~80 lines of duplicate logic
- `validation.ts`: Reusable active ticket checks
- DRY principle = fewer bugs, easier maintenance

### Performance Impact
- **Before**: ~160 lines of duplicate break checking code
- **After**: Single 100-line utility, called from 2 places
- **Result**: Smaller bundle, faster parse time

## Testing Recommendations

### Load Testing Scenarios
1. **100 concurrent users**: Should handle with current setup
2. **500 concurrent users**: Requires PostgreSQL + Redis
3. **1000+ users**: Requires full production stack

### Metrics to Monitor
- Query response times (aim for <50ms)
- Sync queue depth (should stay <10 events)
- Memory usage per session (aim for <50MB)
- Network payload sizes (aim for <100KB per sync)

## Migration Path to Production

### Phase 1: Current (Dev)
- File-based JSON backend
- SQLite (via WatermelonDB)
- Manual sync triggers

### Phase 2: Small Team (10-50 techs)
- PostgreSQL backend
- Same mobile architecture
- Scheduled sync intervals

### Phase 3: Enterprise (100-1000 techs)
- PostgreSQL + Redis
- WebSocket push updates
- Load balancer + multiple app servers
- CDN for static assets

### Phase 4: Large Scale (1000+ techs)
- Multi-region deployment
- Event streaming (Kafka/RabbitMQ)
- Real-time analytics
- Auto-scaling infrastructure

---

*Last Updated: Phase 3 Refactor*
*Mobile App: Production-ready patterns in place*
*Backend: Requires upgrade for 100+ concurrent users*
