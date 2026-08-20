import NetInfo from '@react-native-community/netinfo';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Q } from '@nozbe/watermelondb';
import { database } from '../../../db/database';
import Ticket from '../../../db/models/Ticket';
import OutboxEvent from '../../../db/models/OutboxEvent';
import TicketNote from '../../../db/models/TicketNote';
import DaySession from '../../../db/models/DaySession';
import ClockEvent from '../../../db/models/ClockEvent';
import { API_BASE_URL, ENDPOINTS } from '../../../config/api';
import { fetchWithTimeout } from '../../../utils/fetchWithTimeout';
import { validateTicketsResponse, validateSyncEventsResponse, sanitizeUserId } from '../../../utils/validation';
import { logger } from '../../../utils/logger';

const AUTH_TOKEN_KEY = '@locate720:auth_token';
const AUTH_REFRESH_TOKEN_KEY = '@locate720:auth_refresh_token';
const AUTH_USER_KEY = '@locate720:auth_user';

/**
 * SyncEngine - Sync/outbox engine for offline-first mobile state
 *
 * Key responsibilities:
 * - Queue outbox events (status changes, clock events)
 * - Flush outbox to server (P0 ticket events, P1 clock events)
 * - Pull ticket deltas from server (applyTicketDeltas)
 * - Pull timesheet deltas from server (pullTimesheet)
 * - Handle conflict resolution (version-based merge)
 */

let lastPullAt = 0;
let lastTimesheetPullAt = 0;
const PULL_THROTTLE_MS = 60000; // 60 seconds
const TIMESHEET_PULL_THROTTLE_MS = 30000; // 30 seconds
const MAX_BATCH_SIZE = 100; // Max events per batch (prevents memory issues)
const MAX_RETRY_COUNT = 10; // Max retries before marking FAILED
const REQUEST_TIMEOUT_MS = 30000; // 30 second timeout
const AUTO_SYNC_INTERVAL_MS = 30000; // Keep ticket board fresh while app is open

export interface SyncState {
  isOnline: boolean;
  isSyncing: boolean;
  pendingCount: number;
  lastSyncAt: number | null;
}

class SyncEngineImpl {
  private currentUserId: string = '';
  private currentAuthToken: string | null = null;
  private syncState: SyncState = {
    isOnline: true,
    isSyncing: false,
    pendingCount: 0,
    lastSyncAt: null,
  };

  private listeners: ((state: SyncState) => void)[] = [];
  private lastFlushTime: number = 0; // Rate limiting guard

  constructor() {
    this.initNetworkListener();
    this.loadPendingCount();
    this.initAutoSync();
  }

  /**
   * Set the current authenticated user ID for sync operations
   */
  setCurrentUser(userId: string): void {
    this.currentUserId = userId;
    this.currentAuthToken = null; // Reset cached token so new user's token is fetched
    logger.log(`[SyncEngine] Current user set to: ${userId}`);
  }

  /**
   * Clear the current user — called on logout.
   * Stops the SyncEngine from syncing until a new user is set.
   * Also marks all pending outbox events as SKIPPED so stale events
   * from the previous user are not flushed after a new user logs in.
   */
  async clearCurrentUser(): Promise<void> {
    this.currentUserId = '';
    this.currentAuthToken = null;
    logger.log('[SyncEngine] Current user cleared (logout)');

    // Mark all pending outbox events as SKIPPED so they don't get
    // flushed when a different user logs in. The backend would reject
    // them anyway (userId mismatch), but this avoids the noise and
    // prevents retry storms.
    try {
      const outboxCollection = database.collections.get<OutboxEvent>('outbox_events');
      const pending = await outboxCollection
        .query(Q.where('status', 'PENDING'))
        .fetch();

      if (pending.length > 0) {
        await database.write(async () => {
          for (const event of pending) {
            await event.update((evt: OutboxEvent) => {
              evt.status = 'SKIPPED';
            });
          }
        });
        logger.log(`[SyncEngine] Skipped ${pending.length} pending outbox events on logout`);
        await this.loadPendingCount();
      }
    } catch (error) {
      logger.error('[SyncEngine] Failed to skip pending events on logout:', error);
    }
  }

  /**
   * Get the current auth token from storage
   */
  private async getAuthToken(): Promise<string | null> {
    if (this.currentAuthToken) return this.currentAuthToken;
    try {
      const token = await AsyncStorage.getItem(AUTH_TOKEN_KEY);
      this.currentAuthToken = token;
      return token;
    } catch (error) {
      logger.error('[SyncEngine] Failed to get auth token:', error);
      return null;
    }
  }

  /**
   * Refresh the access token using the refresh token
   */
  private async refreshAccessToken(): Promise<string | null> {
    try {
      const refreshToken = await AsyncStorage.getItem(AUTH_REFRESH_TOKEN_KEY);
      if (!refreshToken) {
        logger.error('[SyncEngine] No refresh token available');
        return null;
      }

      const response = await fetch(`${API_BASE_URL}/auth/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken }),
      });

      if (!response.ok) {
        logger.error('[SyncEngine] Token refresh failed:', response.status);
        // Clear auth on refresh failure - user needs to re-login
        await AsyncStorage.multiRemove([AUTH_TOKEN_KEY, AUTH_REFRESH_TOKEN_KEY, AUTH_USER_KEY]);
        return null;
      }

      const data = await response.json();
      await AsyncStorage.setItem(AUTH_TOKEN_KEY, data.token);
      if (data.refreshToken) {
        await AsyncStorage.setItem(AUTH_REFRESH_TOKEN_KEY, data.refreshToken);
      }
      this.currentAuthToken = data.token;
      logger.log('[SyncEngine] Token refreshed successfully');
      return data.token;
    } catch (error) {
      logger.error('[SyncEngine] Failed to refresh token:', error);
      return null;
    }
  }

  /**
   * Make an authenticated API request with automatic token refresh on 401
   */
  private async authenticatedRequest(
    url: string,
    options: RequestInit & { timeout?: number }
  ): Promise<Response> {
    const token = await this.getAuthToken();
    if (!token) {
      throw new Error('No auth token available');
    }

    const headers = {
      ...options.headers,
      'Authorization': `Bearer ${token}`,
    };

    const response = await fetchWithTimeout(url, {
      ...options,
      headers,
      timeout: options.timeout || REQUEST_TIMEOUT_MS,
    });

    // Handle 401 by refreshing token and retrying once
    if (response.status === 401) {
      logger.log('[SyncEngine] Got 401, attempting token refresh...');
      const newToken = await this.refreshAccessToken();
      if (newToken) {
        // Retry the request with new token
        const retryHeaders = {
          ...options.headers,
          'Authorization': `Bearer ${newToken}`,
        };
        return fetchWithTimeout(url, {
          ...options,
          headers: retryHeaders,
          timeout: options.timeout || REQUEST_TIMEOUT_MS,
        });
      } else {
        throw new Error('Token refresh failed - authentication required');
      }
    }

    return response;
  }

  /**
   * Subscribe to sync state changes
   */
  subscribe(listener: (state: SyncState) => void): () => void {
    this.listeners.push(listener);
    return () => {
      this.listeners = this.listeners.filter((l) => l !== listener);
    };
  }

  getSyncState(): SyncState {
    return { ...this.syncState };
  }

  private notifyListeners() {
    this.listeners.forEach((listener) => listener(this.getSyncState()));
  }

  private updateState(partial: Partial<SyncState>) {
    this.syncState = { ...this.syncState, ...partial };
    this.notifyListeners();
  }

  private async loadPendingCount() {
    const outboxCollection = database.collections.get<OutboxEvent>('outbox_events');
    const count = await outboxCollection
      .query(Q.where('status', 'PENDING'))
      .fetchCount();
    this.updateState({ pendingCount: count });
  }

  private async applyFlushResults(
    attemptedEvents: OutboxEvent[],
    results: { requestId: string; status: string; error?: string; reason?: string }[],
  ) {
    const resultByRequestId = new Map(
      results.map((result) => [result.requestId, result]),
    );

    const ticketsCollection = database.collections.get<Ticket>('tickets');
    const notesCollection = database.collections.get<TicketNote>('ticket_notes');

    await database.write(async () => {
      for (const event of attemptedEvents) {
        const result = resultByRequestId.get(event.requestId);
        const succeeded = result?.status === 'OK' || result?.status === 'IGNORED';
        const failedTerminal = result?.status === 'ERROR';

        await event.update((evt: OutboxEvent) => {
          evt.lastAttemptAt = Date.now();

          if (succeeded) {
            evt.status = 'SENT';
            return;
          }

          const newRetryCount = (evt.retryCount || 0) + 1;
          evt.retryCount = newRetryCount;

          if (failedTerminal) {
            evt.status = 'FAILED';
            logger.error(
              `[SyncEngine] Event ${evt.requestId} rejected by backend: ${result?.error || 'unknown error'}`,
            );
            return;
          }

          if (newRetryCount >= MAX_RETRY_COUNT) {
            evt.status = 'FAILED';
            logger.error(
              `[SyncEngine] Event ${evt.requestId} failed after ${MAX_RETRY_COUNT} retries`,
            );
          }
        });

        // Per-event-type local state cleanup on terminal outcome.
        // These updates are important so the UI can flip "Syncing..." to
        // "Synced" or "Failed" after the backend confirms the event.
        if (!succeeded && !failedTerminal) continue;

        const nextState: 'SYNCED' | 'FAILED' = succeeded ? 'SYNCED' : 'FAILED';

        try {
          const payload = JSON.parse(event.payloadJson || '{}');

          if (event.type === 'TICKET_NOTE_ADDED' && typeof payload.noteId === 'string') {
            try {
              const note = await notesCollection.find(payload.noteId);
              await note.update((n) => {
                n.syncState = nextState;
              });
            } catch (findErr) {
              logger.warn(
                `[SyncEngine] Could not locate ticket_note ${payload.noteId} to update sync_state:`,
                findErr,
              );
            }
          } else if (
            event.type === 'TICKET_STATUS_SET' &&
            typeof payload.ticketId === 'string'
          ) {
            try {
              const ticket = await ticketsCollection.find(payload.ticketId);
              await ticket.update((t) => {
                t.syncState = nextState;
              });
            } catch (findErr) {
              logger.warn(
                `[SyncEngine] Could not locate ticket ${payload.ticketId} to update sync_state after status ack:`,
                findErr,
              );
            }
          } else if (
            event.type === 'TICKET_ATTACHMENT_ADDED' &&
            typeof payload.ticketId === 'string' &&
            typeof payload.attachmentId === 'string'
          ) {
            try {
              const ticket = await ticketsCollection.find(payload.ticketId);
              await ticket.update((t) => {
                let parsed: Record<string, unknown>;
                try {
                  parsed = JSON.parse(t.payloadJson || '{}');
                } catch {
                  parsed = {};
                }
                const list = Array.isArray(parsed.attachments)
                  ? (parsed.attachments as Array<Record<string, unknown>>)
                  : [];
                let mutated = false;
                const nextList = list.map((a) => {
                  if (a && a.id === payload.attachmentId) {
                    mutated = true;
                    return { ...a, syncState: nextState };
                  }
                  return a;
                });
                if (mutated) {
                  parsed.attachments = nextList;
                  t.payloadJson = JSON.stringify(parsed);
                }
              });
            } catch (findErr) {
              logger.warn(
                `[SyncEngine] Could not locate ticket ${payload.ticketId} to update attachment sync_state:`,
                findErr,
              );
            }
          }
        } catch (parseErr) {
          logger.warn(
            `[SyncEngine] Failed to parse payload for post-success cleanup on ${event.type}:`,
            parseErr,
          );
        }
      }
    });

    await this.loadPendingCount();
  }

  private initNetworkListener() {
    NetInfo.addEventListener((state) => {
      const isOnline = state.isConnected === true && state.isInternetReachable !== false;
      const wasOffline = !this.syncState.isOnline;
      
      this.updateState({ isOnline });

      // Network regained - flush P0 first, then pull
      if (isOnline && wasOffline) {
        logger.log('[SyncEngine] Network regained, flushing P0 then pulling...');
        this.flushP0().then(() => this.pullTickets()).then(() => this.pullTimesheet());
      }
    });
  }

  /**
   * Queue an outbox event and optionally flush immediately
   */
  async queueEvent(eventData: {
    type: string;
    priority: number;
    requestId: string;
    deviceId: string;
    seq: number;
    occurredAt: number;
    payloadJson: string;
    status: 'PENDING';
    retryCount: 0;
    ticketId?: string;
  }) {
    const outboxCollection = database.collections.get<OutboxEvent>('outbox_events');

    await database.write(async () => {
      await outboxCollection.create((event) => {
        event.type = eventData.type;
        event.priority = eventData.priority;
        event.requestId = eventData.requestId;
        event.ticketId = eventData.ticketId;
        event.deviceId = eventData.deviceId;
        event.seq = eventData.seq;
        event.occurredAt = eventData.occurredAt;
        event.payloadJson = eventData.payloadJson;
        event.status = eventData.status;
        event.retryCount = eventData.retryCount;
      });
    });

    await this.loadPendingCount();

    // Rate limiting: prevent more than 1 flush per second
    const now = Date.now();
    const timeSinceLastFlush = now - this.lastFlushTime;
    const rateLimitDelay = 1000; // 1 second

    // Auto-flush P0 events if online
    if (eventData.priority === 0 && this.syncState.isOnline) {
      if (timeSinceLastFlush >= rateLimitDelay) {
        this.flushP0();
        this.lastFlushTime = now;
      } else {
        // Delayed flush to respect rate limit
        const delay = rateLimitDelay - timeSinceLastFlush;
        setTimeout(() => {
          if (this.syncState.isOnline) {
            this.flushP0();
          }
        }, delay);
        this.lastFlushTime = now + delay; // Update to when flush will occur
      }
    }
    
    // Auto-flush P1 events if online
    if (eventData.priority === 1 && this.syncState.isOnline) {
      if (timeSinceLastFlush >= rateLimitDelay) {
        this.flushP1();
        this.lastFlushTime = now;
      } else {
        // Delayed flush to respect rate limit
        const delay = rateLimitDelay - timeSinceLastFlush;
        setTimeout(() => {
          if (this.syncState.isOnline) {
            this.flushP1();
          }
        }, delay);
        this.lastFlushTime = now + delay; // Update to when flush will occur
      }
    }
  }

  /**
   * Flush P0 (highest priority) events to server
   * Sends outbox events to backend API
   */
  async flushP0(): Promise<void> {
    if (!this.syncState.isOnline) {
      logger.log('[SyncEngine] Offline, skipping P0 flush');
      return;
    }

    if (!this.currentUserId) {
      logger.log('[SyncEngine] No current user, skipping P0 flush');
      return;
    }

    const outboxCollection = database.collections.get<OutboxEvent>('outbox_events');
    const p0Events = await outboxCollection
      .query(
        Q.where('status', 'PENDING'),
        Q.where('priority', 0),
        Q.take(MAX_BATCH_SIZE) // Batch size limit
      )
      .fetch();
    
    // Filter out events that need more backoff time
    const readyEvents = p0Events.filter(event => {
      if (event.retryCount === 0) return true;
      
      const backoffMs = Math.min(60000, Math.pow(2, event.retryCount) * 1000);
      const timeSinceLastAttempt = Date.now() - (event.lastAttemptAt || 0);
      return timeSinceLastAttempt >= backoffMs;
    });

    if (readyEvents.length === 0) {
      if (p0Events.length > 0) {
        logger.log(`[SyncEngine] ${p0Events.length} P0 events waiting for backoff`);
      }
      return;
    }

    logger.log(`[SyncEngine] Flushing ${readyEvents.length} P0 events to backend...`);

    try {
      // Send events to backend with auth
      const response = await this.authenticatedRequest(
        `${API_BASE_URL}${ENDPOINTS.syncEvents}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            events: readyEvents.map(e => ({
              type: e.type,
              requestId: e.requestId,
              deviceId: e.deviceId,
              seq: e.seq,
              occurredAt: e.occurredAt,
              payload: JSON.parse(e.payloadJson),
            })),
          }),
        }
      );

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const result = await response.json();
      validateSyncEventsResponse(result);
      logger.log('[SyncEngine] Backend processed events:', result.results);
      await this.applyFlushResults(readyEvents, result.results);
      logger.log('[SyncEngine] P0 events flushed successfully');
    } catch (error) {
      logger.error('[SyncEngine] Failed to flush P0 events:', error);
      
      // Mark events as failed and increment retry count
      await database.write(async () => {
        for (const event of readyEvents) {
          await event.update((evt: OutboxEvent) => {
            const newRetryCount = (evt.retryCount || 0) + 1;
            
            // Mark as FAILED after max retries
            if (newRetryCount >= MAX_RETRY_COUNT) {
              evt.status = 'FAILED';
              logger.error(`[SyncEngine] Event ${evt.requestId} failed after ${MAX_RETRY_COUNT} retries`);
            }
            
            evt.retryCount = newRetryCount;
            evt.lastAttemptAt = Date.now();
          });
        }
      });
    }
  }

  /**
   * Flush P1 (clock/timesheet events) to server
   * Sends clock events to /api/timesheet/events
   */
  async flushP1(): Promise<void> {
    if (!this.syncState.isOnline) {
      logger.log('[SyncEngine] Offline, skipping P1 flush');
      return;
    }

    if (!this.currentUserId) {
      logger.log('[SyncEngine] No current user, skipping P1 flush');
      return;
    }

    const outboxCollection = database.collections.get<OutboxEvent>('outbox_events');
    const p1Events = await outboxCollection
      .query(
        Q.where('status', 'PENDING'),
        Q.where('priority', 1),
        Q.take(MAX_BATCH_SIZE)
      )
      .fetch();
    
    // Filter out events that need more backoff time
    const readyEvents = p1Events.filter(event => {
      if (event.retryCount === 0) return true;
      
      const backoffMs = Math.min(60000, Math.pow(2, event.retryCount) * 1000);
      const timeSinceLastAttempt = Date.now() - (event.lastAttemptAt || 0);
      return timeSinceLastAttempt >= backoffMs;
    });

    if (readyEvents.length === 0) {
      if (p1Events.length > 0) {
        logger.log(`[SyncEngine] ${p1Events.length} P1 events waiting for backoff`);
      }
      return;
    }

    logger.log(`[SyncEngine] Flushing ${readyEvents.length} P1 clock events to backend...`);

    try {
      // Send events to timesheet endpoint with auth
      const response = await this.authenticatedRequest(
        `${API_BASE_URL}${ENDPOINTS.timesheetEvents}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            events: readyEvents.map(e => ({
              type: e.type,
              requestId: e.requestId,
              deviceId: e.deviceId,
              seq: e.seq,
              occurredAt: e.occurredAt,
              payload: JSON.parse(e.payloadJson),
            })),
          }),
        }
      );

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const result = await response.json();
      validateSyncEventsResponse(result);
      logger.log('[SyncEngine] Backend processed clock events:', result.results);
      await this.applyFlushResults(readyEvents, result.results);
      logger.log('[SyncEngine] P1 clock events flushed successfully');

      // If any clock event was refused with ALREADY_CLOCKED_IN, trigger a
      // timesheet pull so the local session state converges with the
      // server's authoritative active session (multi-device reconciliation).
      const hasAlreadyClockedIn = (result.results || []).some(
        (r: any) => r?.error === 'ALREADY_CLOCKED_IN',
      );
      if (hasAlreadyClockedIn) {
        logger.log('[SyncEngine] ALREADY_CLOCKED_IN detected, pulling timesheet to reconcile');
        this.pullTimesheet(true);
      }
    } catch (error) {
      logger.error('[SyncEngine] Failed to flush P1 events:', error);
      
      // Mark events as failed and increment retry count
      await database.write(async () => {
        for (const event of readyEvents) {
          await event.update((evt: OutboxEvent) => {
            const newRetryCount = (evt.retryCount || 0) + 1;
            
            // Mark as FAILED after max retries
            if (newRetryCount >= MAX_RETRY_COUNT) {
              evt.status = 'FAILED';
              logger.error(`[SyncEngine] Event ${evt.requestId} failed after ${MAX_RETRY_COUNT} retries`);
            }
            
            evt.retryCount = newRetryCount;
            evt.lastAttemptAt = Date.now();
          });
        }
      });
    }
  }

  private initAutoSync() {
    setInterval(() => {
      if (!this.syncState.isOnline || this.syncState.isSyncing || !this.currentUserId) {
        return;
      }

      logger.log('[SyncEngine] Auto-sync polling tick');
      this.syncNow(true);
    }, AUTO_SYNC_INTERVAL_MS);
  }

  /**
   * Flush pending outbox work, then pull the latest tickets.
   * Useful when the app starts after being offline and pending events already exist locally.
   */
  async syncNow(forcePull: boolean = false): Promise<void> {
    if (!this.syncState.isOnline) {
      logger.log('[SyncEngine] Offline, skipping syncNow');
      return;
    }

    await this.flushP0();
    await this.flushP1();
    await this.pullTickets(forcePull);
    await this.pullTimesheet(forcePull);
  }

  /**
   * Pull ticket updates from server
   * Fetches all tickets assigned to current user
   */
  async pullTickets(force: boolean = false): Promise<void> {
    if (!force) {
      // Throttle pulls
      const timeSinceLastPull = Date.now() - lastPullAt;
      if (timeSinceLastPull < PULL_THROTTLE_MS) {
        logger.log(`[SyncEngine] Pull throttled (${Math.round(timeSinceLastPull / 1000)}s since last)`);
        return;
      }
    }

    if (!this.syncState.isOnline) {
      logger.log('[SyncEngine] Offline, skipping pull');
      return;
    }

    if (this.syncState.isSyncing) {
      logger.log('[SyncEngine] Already syncing, skipping');
      return;
    }

    this.updateState({ isSyncing: true });
    lastPullAt = Date.now();

    try {
      logger.log('[SyncEngine] Pulling tickets from backend...');

      // Fetch tickets assigned to user (sanitize user ID)
      const sanitizedUserId = sanitizeUserId(this.currentUserId);
      const url = `${API_BASE_URL}${ENDPOINTS.tickets}?assignedTo=${sanitizedUserId}`;
      logger.log('[SyncEngine] Fetching from:', url);

      const response = await this.authenticatedRequest(url, {});

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const data = await response.json();
      validateTicketsResponse(data);
      logger.log(`[SyncEngine] Received ${data.tickets.length} tickets from backend for user ${sanitizedUserId}`);

      const serverTicketIds = new Set<string>(
        (data.tickets || []).map((ticket: any) => ticket.id).filter(Boolean),
      );

      // Apply deltas to local database (version-based merge will handle updates/creates)
      if (data.tickets && data.tickets.length > 0) {
        await this.applyTicketDeltas(data.tickets.map((t: any) => ({
          id: t.id,
          ticketNumber: t.ticket_number,
          ticketType: t.ticket_type,
          address: t.address,
          lat: t.lat,
          lng: t.lng,
          status: t.status,
          locatorStatus: t.locator_status,
          assignedTechId: t.assigned_tech_id,
          dueAt: t.due_at,
          originalDueAt: t.original_due_at,
          updatedAt: t.updated_at,
          version: t.version,
          closedByName: t.closed_by_name,
          closedAt: t.closed_at,
          payloadJson: t.payload_json || t.payloadJson,
          // Lineage (linked-ticket model). Fall back to self-rooted original if
          // server omits these so old rows render as independent originals.
          rootTicketId: t.root_ticket_id ?? t.rootTicketId ?? t.id,
          parentTicketId: t.parent_ticket_id ?? t.parentTicketId ?? undefined,
          sequenceNumber: t.sequence_number ?? t.sequenceNumber ?? 1,
          externalRootNumber:
            t.external_root_number ?? t.externalRootNumber ?? t.ticket_number,
        })));
      }

      await this.reconcileRemovedTickets(serverTicketIds);

      this.updateState({ 
        isSyncing: false, 
        lastSyncAt: Date.now() 
      });

      logger.log('[SyncEngine] Pull complete');
    } catch (error) {
      logger.error('[SyncEngine] Pull failed:', error);
      this.updateState({ isSyncing: false });
    }
  }

  private async reconcileRemovedTickets(serverTicketIds: Set<string>) {
    const ticketsCollection = database.collections.get<Ticket>('tickets');
    const outboxCollection = database.collections.get<OutboxEvent>('outbox_events');

    const localTickets = await ticketsCollection
      .query(Q.where('assigned_tech_id', this.currentUserId))
      .fetch();

    if (localTickets.length === 0) {
      return;
    }

    const pendingEvents = await outboxCollection
      .query(Q.where('status', 'PENDING'))
      .fetch();
    const pendingTicketIds = new Set(
      pendingEvents.map((event) => event.ticketId).filter(Boolean) as string[],
    );

    // When the server returns zero tickets for this user, the backend
    // genuinely has nothing assigned (reset, different env, etc.).  In
    // that case we must NOT preserve active-state tickets — they are
    // stale local rows, not a transient race.  Active-state preservation
    // only applies when the server returned a partial snapshot (some
    // tickets present, some missing), which suggests a transient race.
    const serverHasAnyTickets = serverTicketIds.size > 0;
    const activeWorkflowStates = ['ENROUTE', 'ONSITE', 'PAUSED'];

    const ticketsToDelete = localTickets.filter((ticket) => {
      if (serverTicketIds.has(ticket.id)) {
        return false;
      }

      if (pendingTicketIds.has(ticket.id)) {
        logger.log(`[SyncEngine] Preserving local ticket ${ticket.id} because it has pending outbox events`);
        return false;
      }

      // Preserve tickets in active workflow states (ENROUTE / ONSITE /
      // PAUSED) when missing from a PARTIAL server snapshot.  A transient
      // pull race or backend ingestion lag can cause the ticket to be
      // absent from one snapshot and present in the next; deleting it
      // here would make it disappear from the board and reappear on the
      // next pull — the "disappearing ENROUTE/ONSITE" symptom.
      //
      // BUT: when the server returns zero tickets for this user, the
      // backend genuinely has nothing — this is not a transient race,
      // and we must clean up stale local rows (e.g. after a backend
      // reset or when switching between dev/prod environments).
      if (serverHasAnyTickets && activeWorkflowStates.includes(ticket.locatorStatus)) {
        logger.log(
          `[SyncEngine] Preserving local ticket ${ticket.id} in active workflow state ${ticket.locatorStatus} (missing from partial server snapshot, likely transient)`,
        );
        return false;
      }

      return true;
    });

    if (ticketsToDelete.length === 0) {
      return;
    }

    logger.log(`[SyncEngine] Removing ${ticketsToDelete.length} local tickets missing from backend snapshot (server returned ${serverTicketIds.size} tickets)`);

    await database.write(async () => {
      for (const ticket of ticketsToDelete) {
        await ticket.destroyPermanently();
      }
    });
  }

  /**
   * Pull timesheet/session deltas from server.
   *
   * This is the server-authoritative counterpart to the P1 outbox flush.
   * It reconciles local day_sessions and clock_events with Backend truth,
   * which is critical for multi-device clock-in agreement:
   *
   *   - If another device clocked in, this pull discovers the ACTIVE session.
   *   - If another device clocked out, this pull marks the local session CLOCKED_OUT.
   *   - If the server refused a duplicate clock-in, the local session stays in sync.
   *
   * Sessions are upserted by server ID (like tickets). Clock events are
   * upserted by server ID (which is the requestId from the original outbox event).
   */
  async pullTimesheet(force: boolean = false): Promise<void> {
    if (!force) {
      const timeSinceLastPull = Date.now() - lastTimesheetPullAt;
      if (timeSinceLastPull < TIMESHEET_PULL_THROTTLE_MS) {
        return;
      }
    }

    if (!this.syncState.isOnline) {
      logger.log('[SyncEngine] Offline, skipping timesheet pull');
      return;
    }

    if (!this.currentUserId) {
      logger.log('[SyncEngine] No current user, skipping timesheet pull');
      return;
    }

    lastTimesheetPullAt = Date.now();

    try {
      const sanitizedUserId = sanitizeUserId(this.currentUserId);
      const url = `${API_BASE_URL}${ENDPOINTS.timesheetSync}?userId=${sanitizedUserId}&lastSyncAt=${this.lastTimesheetSyncAt}`;
      logger.log('[SyncEngine] Pulling timesheet deltas from backend...');

      const response = await this.authenticatedRequest(url, {});

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const data = await response.json();
      logger.log(
        `[SyncEngine] Received ${data.sessions?.length || 0} sessions, ` +
        `${data.clockEvents?.length || 0} clock events from backend`,
      );

      await this.applyTimesheetDeltas(data);

      // Update the watermark for the next delta pull
      if (data.serverTime) {
        this.lastTimesheetSyncAt = data.serverTime;
      }
    } catch (error) {
      logger.error('[SyncEngine] Timesheet pull failed:', error);
    }
  }

  private lastTimesheetSyncAt: number = 0;

  /**
   * Apply server-authoritative timesheet deltas to local WatermelonDB.
   *
   * - Upserts day_sessions by server ID. If a local session exists and the
   *   server says CLOCKED_OUT, the local session is updated to CLOCKED_OUT
   *   (this is the multi-device reconciliation path).
   * - Upserts clock_events by server ID (which equals the original requestId).
   *   Events that originated on this device already exist locally with the
   *   same ID, so this is a no-op for them. Events from other devices are
   *   created locally.
   */
  private async applyTimesheetDeltas(data: {
    sessions?: any[];
    clockEvents?: any[];
    activeSessionId?: string | null;
  }): Promise<void> {
    const sessionsCollection = database.collections.get<DaySession>('day_sessions');
    const clockEventsCollection = database.collections.get<ClockEvent>('clock_events');
    const serverSessions = data.sessions || [];
    const serverClockEvents = data.clockEvents || [];

    if (serverSessions.length === 0 && serverClockEvents.length === 0) {
      return;
    }

    await database.write(async () => {
      // Upsert sessions
      for (const s of serverSessions) {
        try {
          const existing = await sessionsCollection.find(s.id);
          // Update existing session — server is authoritative for status
          await existing.update((session) => {
            session.userId = s.user_id;
            session.date = s.date;
            session.clockInAt = s.clock_in_at || 0;
            session.clockOutAt = s.clock_out_at || undefined;
            session.clockOutTicketId = s.clock_out_ticket_id || undefined;
            session.status = s.status;
            session.clockInReason = s.clock_in_reason || undefined;
            session.allocationType = s.allocation_type || undefined;
            session.otherReason = s.other_reason || undefined;
          });
        } catch {
          // Session doesn't exist locally — create it (from another device)
          await sessionsCollection.create((session) => {
            session._raw.id = s.id;
            session.userId = s.user_id;
            session.date = s.date;
            session.clockInAt = s.clock_in_at || 0;
            session.clockOutAt = s.clock_out_at || undefined;
            session.clockOutTicketId = s.clock_out_ticket_id || undefined;
            session.status = s.status;
            session.clockInReason = s.clock_in_reason || undefined;
            session.allocationType = s.allocation_type || undefined;
            session.otherReason = s.other_reason || undefined;
          });
        }
      }

      // Upsert clock events
      for (const e of serverClockEvents) {
        try {
          // Check if we already have this event locally (by server ID)
          await clockEventsCollection.find(e.id);
          // Already exists — skip (server is echoing back our own event)
        } catch {
          // Doesn't exist locally — create it (from another device or server-side)
          await clockEventsCollection.create((evt) => {
            evt._raw.id = e.id;
            evt.sessionId = e.session_id;
            evt.userId = e.user_id;
            evt.eventType = e.event_type;
            evt.occurredAt = e.occurred_at;
            evt.reason = e.reason || undefined;
            evt.ticketId = e.ticket_id || undefined;
          });
        }
      }
    });

    logger.log(
      `[SyncEngine] Timesheet reconciliation complete: ` +
      `${serverSessions.length} sessions, ${serverClockEvents.length} events processed`,
    );
  }

  /**
   * Apply ticket deltas from server to local DB
   * Handles conflict resolution: don't overwrite local optimistic changes
   */
  async applyTicketDeltas(deltas: {
    id: string;
    ticketNumber: string;
    ticketType?: string;
    address: string;
    lat?: number;
    lng?: number;
    status: string;
    locatorStatus: string;
    assignedTechId: string;
    dueAt?: number;
    originalDueAt?: number;
    updatedAt: number;
    version: number;
    closedByName?: string;
    closedAt?: number;
    payloadJson: string;
    // Lineage (linked-ticket model).
    rootTicketId?: string;
    parentTicketId?: string;
    sequenceNumber?: number;
    externalRootNumber?: string;
  }[]) {
    logger.log('[SyncEngine] Applying', deltas.length, 'ticket deltas to local DB...');
    const ticketsCollection = database.collections.get<Ticket>('tickets');
    const outboxCollection = database.collections.get<OutboxEvent>('outbox_events');

    // Precompute pending ticket IDs and their event types using the indexed
    // ticket_id column.  Instead of skipping the entire delta when a ticket
    // has pending outbox events, we apply a field-aware overlay: non-status
    // fields from the server delta are still applied (address, due date,
    // payload metadata, etc.) while local optimistic status and timeline
    // fields are preserved until the pending event is acked.
    const pendingTicketIds = new Set<string>();
    const pendingStatusTicketIds = new Set<string>();
    const pendingEvents = await outboxCollection
      .query(Q.where('status', 'PENDING'))
      .fetch();

    for (const event of pendingEvents) {
      if (event.ticketId) {
        pendingTicketIds.add(event.ticketId);
        if (event.type === 'TICKET_STATUS_SET') {
          pendingStatusTicketIds.add(event.ticketId);
        }
      }
    }

    await database.write(async () => {
      for (const delta of deltas) {
        logger.log('[SyncEngine] Processing delta for ticket:', delta.id);

        const hasPending = pendingTicketIds.has(delta.id);
        const hasPendingStatus = pendingStatusTicketIds.has(delta.id);

        try {
          const existing = await ticketsCollection.find(delta.id);

          // When the ticket has a pending status event we must not let a
          // stale server row overwrite the optimistic locatorStatus /
          // timeline.  However, we still want non-status fields (address,
          // due date, etc.) to converge.  We achieve this by:
          //   1. Only applying the delta when the server version is newer
          //      (unchanged guard).
          //   2. When applying, preserving local locatorStatus, closedAt,
          //      closedByName, and timeline payload fields if the ticket
          //      has a pending TICKET_STATUS_SET event.
          if (delta.version > existing.version) {
            logger.log('[SyncEngine] Updating existing ticket:', delta.id, hasPendingStatus ? '(pending status overlay)' : '');

            await existing.update((ticket) => {
              // Preserve local timeline fields if they exist and server doesn't have them
              let mergedPayload = delta.payloadJson;
              try {
                const localPayload = JSON.parse(ticket.payloadJson);
                const serverPayload = JSON.parse(delta.payloadJson);

                // Preserve timeline fields from local if not in server payload
                const timelineFields = ['onsiteStartedAt', 'onsiteEndedAt', 'enrouteStartedAt', 'enrouteEndedAt', 'pauseEvents', 'closedAt'];
                let needsMerge = false;

                for (const field of timelineFields) {
                  if (localPayload[field] && !serverPayload[field]) {
                    serverPayload[field] = localPayload[field];
                    needsMerge = true;
                  }
                }

                // When there is a pending status event, also preserve
                // timeline fields that the server DOES have but that
                // originated from the local optimistic write (the server
                // simply mirrors them back).  Overwriting with the server
                // copy is harmless in principle, but preserving the local
                // copy avoids any chance of a partial mirror race.
                if (hasPendingStatus) {
                  for (const field of timelineFields) {
                    if (localPayload[field]) {
                      serverPayload[field] = localPayload[field];
                      needsMerge = true;
                    }
                  }
                }

                // Preserve local-only payload fields that the server does not
                // mirror back through tickets.payload_json. Attachment records
                // live in the backend ticket_attachments table and are never
                // serialised into the ticket's payload, so a delta overwrite
                // would otherwise wipe them from the device.
                const localOnlyArrayFields = ['attachments'];
                for (const field of localOnlyArrayFields) {
                  const localArr = Array.isArray(localPayload[field]) ? localPayload[field] : null;
                  const serverArr = Array.isArray(serverPayload[field]) ? serverPayload[field] : null;
                  if (localArr && localArr.length > 0 && (!serverArr || serverArr.length === 0)) {
                    serverPayload[field] = localArr;
                    needsMerge = true;
                  }
                }

                if (needsMerge) {
                  mergedPayload = JSON.stringify(serverPayload);
                  logger.log('[SyncEngine] Preserved local timeline fields for ticket:', delta.id);
                }
              } catch (e) {
                logger.warn('[SyncEngine] Failed to merge timeline fields:', e);
              }

              ticket.ticketNumber = delta.ticketNumber;
              ticket.ticketType = delta.ticketType;
              ticket.address = delta.address;
              ticket.lat = delta.lat;
              ticket.lng = delta.lng;
              ticket.status = delta.status;
              // Pending-status overlay: keep the local optimistic
              // locatorStatus / closedAt / closedByName until the outbox
              // event is acked.  The server delta for these fields likely
              // reflects the pre-ack state and would temporarily revert the
              // ticket to ASSIGNED, causing the "disappearing ENROUTE/ONSITE"
              // symptom.
              if (hasPendingStatus) {
                // preserve ticket.locatorStatus, ticket.closedAt, ticket.closedByName
              } else {
                ticket.locatorStatus = delta.locatorStatus;
                ticket.closedByName = delta.closedByName;
                ticket.closedAt = delta.closedAt;
              }
              ticket.assignedTechId = delta.assignedTechId;
              ticket.dueAt = delta.dueAt;
              ticket.originalDueAt = delta.originalDueAt ?? delta.dueAt;
              ticket.updatedAt = delta.updatedAt;
              ticket.version = delta.version;
              ticket.payloadJson = mergedPayload;
              ticket.syncState = hasPending ? 'PENDING' : 'SYNCED';
              // Lineage columns are immutable once set on the server. Only
              // write them if the local row doesn't already have a value.
              if (!ticket.rootTicketId && delta.rootTicketId) ticket.rootTicketId = delta.rootTicketId;
              if (!ticket.parentTicketId && delta.parentTicketId) ticket.parentTicketId = delta.parentTicketId;
              if (ticket.sequenceNumber == null && delta.sequenceNumber != null) ticket.sequenceNumber = delta.sequenceNumber;
              if (!ticket.externalRootNumber && delta.externalRootNumber) ticket.externalRootNumber = delta.externalRootNumber;
            });
          } else {
            logger.log('[SyncEngine] Skipping update - server version not newer:', delta.id);
          }
        } catch (error) {
          // Ticket doesn't exist, create it
          logger.log('[SyncEngine] Creating new ticket:', delta.id, 'ticketNumber:', delta.ticketNumber);
          await ticketsCollection.create((ticket) => {
            ticket._raw.id = delta.id;
            ticket.ticketNumber = delta.ticketNumber;
            ticket.ticketType = delta.ticketType;
            ticket.address = delta.address;
            ticket.lat = delta.lat;
            ticket.lng = delta.lng;
            ticket.status = delta.status;
            ticket.locatorStatus = delta.locatorStatus;
            ticket.assignedTechId = delta.assignedTechId;
            ticket.dueAt = delta.dueAt;
            ticket.originalDueAt = delta.originalDueAt ?? delta.dueAt;
            ticket.updatedAt = delta.updatedAt;
            ticket.version = delta.version;
            ticket.closedByName = delta.closedByName;
            ticket.closedAt = delta.closedAt;
            ticket.payloadJson = delta.payloadJson;
            ticket.syncState = 'SYNCED';
            // Lineage (linked-ticket model). Default to self-rooted original
            // when server omits so we never end up with orphan rows.
            ticket.rootTicketId = delta.rootTicketId || delta.id;
            ticket.parentTicketId = delta.parentTicketId;
            ticket.sequenceNumber = delta.sequenceNumber ?? 1;
            ticket.externalRootNumber = delta.externalRootNumber || delta.ticketNumber;
          });
          logger.log('[SyncEngine] Created ticket:', delta.id, error ? error : '');
        }
      }
    });
  }
}

export const SyncEngine = new SyncEngineImpl();
