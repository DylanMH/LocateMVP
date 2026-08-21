import { View, Text, Pressable, ScrollView, ActivityIndicator, Alert } from "react-native";
import { useEffect, useState, useCallback, useRef } from "react";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useAuth } from "../../src/features/auth/AuthContext";
import { colors } from "../../src/ui/colors";
import { database } from "../../src/db/database";
import DaySession, { type AllocationType } from "../../src/db/models/DaySession";
import ClockEvent from "../../src/db/models/ClockEvent";
import { SyncEngine } from "../../src/features/tickets/sync/SyncEngine";
import { createClockEvent } from "../../src/features/tickets/domain/outbox";
import {
  checkActiveTickets,
  closeActiveSession,
  getActiveTicketsErrorMessage,
  checkServerActiveSession,
} from "../../src/features/timesheet/utils/validation";
import { checkUserBreakStatus, getTodayDateString, getTodayStartTimestamp } from "../../src/features/timesheet/utils/breakStatus";
import { TicketSelectorModal } from "../../src/features/timesheet/components/TicketSelectorModal";
import { ReasonSelectorModal, getAllocationLabel } from "../../src/features/timesheet/components/ReasonSelectorModal";
import type { BreakType, ClockEventType } from "../../src/features/timesheet/types";
import { Q } from "@nozbe/watermelondb";
import { formatDuration } from "../../src/utils/formatDuration";

type TimelineItem =
  | { kind: "clock_in"; time: number; allocation?: string }
  | { kind: "clock_out"; time: number }
  | { kind: "allocation_change"; time: number; newAllocation?: string }
  | { kind: "lunch"; startTime: number; endTime?: number; duration?: number }
  | { kind: "personal"; startTime: number; endTime?: number; duration?: number };

function buildTimelineItems(
  events: ClockEvent[],
  sessions: DaySession[],
): TimelineItem[] {
  const sorted = [...events].sort((a, b) => a.occurredAt - b.occurredAt);
  const sessionMap = new Map(sessions.map((s) => [s.id, s]));
  const items: TimelineItem[] = [];

  for (const event of sorted) {
    switch (event.eventType) {
      case "CLOCK_IN": {
        const sess = sessionMap.get(event.sessionId);
        items.push({
          kind: "clock_in",
          time: event.occurredAt,
          allocation: sess?.clockInReason || sess?.allocationType,
        });
        break;
      }
      case "CLOCK_OUT":
        items.push({ kind: "clock_out", time: event.occurredAt });
        break;
      case "ALLOCATION_CHANGE": {
        items.push({
          kind: "allocation_change",
          time: event.occurredAt,
          newAllocation: event.allocationType,
        });
        break;
      }
      case "LUNCH_START":
        items.push({ kind: "lunch", startTime: event.occurredAt });
        break;
      case "LUNCH_END": {
        for (let i = items.length - 1; i >= 0; i--) {
          const it = items[i];
          if (it.kind === "lunch" && it.endTime === undefined) {
            it.endTime = event.occurredAt;
            it.duration = event.occurredAt - it.startTime;
            break;
          }
        }
        break;
      }
      case "PERSONAL_START":
        items.push({ kind: "personal", startTime: event.occurredAt });
        break;
      case "PERSONAL_END": {
        for (let i = items.length - 1; i >= 0; i--) {
          const it = items[i];
          if (it.kind === "personal" && it.endTime === undefined) {
            it.endTime = event.occurredAt;
            it.duration = event.occurredAt - it.startTime;
            break;
          }
        }
        break;
      }
    }
  }

  return items;
}

export default function Timesheet() {
  const { user } = useAuth();
  const insets = useSafeAreaInsets();
  const [session, setSession] = useState<DaySession | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isProcessing, setIsProcessing] = useState(false);
  const [breakStartedAt, setBreakStartedAt] = useState<number | null>(null);
  const [currentBreakType, setCurrentBreakType] = useState<BreakType | null>(null);
  const [showTicketSelector, setShowTicketSelector] = useState(false);
  const [showReasonSelector, setShowReasonSelector] = useState(false);
  const [showAllocationChanger, setShowAllocationChanger] = useState(false);
  const [elapsedSec, setElapsedSec] = useState(0);
  const [timelineEvents, setTimelineEvents] = useState<ClockEvent[]>([]);
  const [todaySessions, setTodaySessions] = useState<DaySession[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Dynamic duration timer — updates every second while clocked in.
  // Tracks break elapsed time when on break, session elapsed otherwise.
  useEffect(() => {
    if (session?.status === "ACTIVE" && session.clockInAt) {
      const baseTime =
        currentBreakType && breakStartedAt ? breakStartedAt : session.clockInAt;
      setElapsedSec(Math.floor((Date.now() - baseTime) / 1000));
      timerRef.current = setInterval(() => {
        setElapsedSec(Math.floor((Date.now() - baseTime) / 1000));
      }, 1000);
    } else {
      if (timerRef.current) clearInterval(timerRef.current);
    }
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [session?.status, session?.clockInAt, currentBreakType, breakStartedAt]);

  const loadTodaySession = useCallback(async () => {
    if (!user) return;

    try {
      setIsLoading(true);
      const today = getTodayDateString();

      const sessionsCollection = database.collections.get<DaySession>("day_sessions");
      const sessions = await sessionsCollection
        .query(
          Q.where("user_id", user.id),
          Q.where("date", today),
          Q.sortBy("created_at", Q.desc),
        )
        .fetch();

      if (sessions.length > 0) {
        setSession(sessions[0]);

        const breakStatus = await checkUserBreakStatus(user.id, today);
        setCurrentBreakType(breakStatus.isOnBreak ? breakStatus.breakType : null);
        setBreakStartedAt(breakStatus.isOnBreak ? breakStatus.startedAt : null);
      } else {
        setSession(null);
        setCurrentBreakType(null);
        setBreakStartedAt(null);
      }
    } catch (error) {
      console.error("[Timesheet] Failed to load session:", error);
    } finally {
      setIsLoading(false);
    }
  }, [user]);

  useEffect(() => {
    loadTodaySession();
    // Pull timesheet from server on screen mount so multi-device
    // clock state converges (e.g. another device clocked in/out).
    SyncEngine.pullTimesheet(true).then(() => loadTodaySession());
  }, [loadTodaySession]);

  // Subscribe to today's clock events (reactive timeline source)
  useEffect(() => {
    if (!user) return;
    const todayStart = getTodayStartTimestamp();
    const eventsCollection = database.collections.get<ClockEvent>("clock_events");
    const subscription = eventsCollection
      .query(
        Q.where("user_id", user.id),
        Q.where("occurred_at", Q.gte(todayStart)),
        Q.sortBy("occurred_at", Q.asc),
      )
      .observe()
      .subscribe((events) => {
        setTimelineEvents(events);
      });
    return () => subscription.unsubscribe();
  }, [user]);

  // Subscribe to today's sessions (for timeline allocation lookup)
  useEffect(() => {
    if (!user) return;
    const today = getTodayDateString();
    const sessionsCollection = database.collections.get<DaySession>("day_sessions");
    const subscription = sessionsCollection
      .query(
        Q.where("user_id", user.id),
        Q.where("date", today),
        Q.sortBy("created_at", Q.asc),
      )
      .observe()
      .subscribe((sessions) => {
        setTodaySessions(sessions);
      });
    return () => subscription.unsubscribe();
  }, [user]);

  // ── Clock In ──────────────────────────────────────────────
  const handleClockInPress = () => {
    setShowReasonSelector(true);
  };

  const handleClockInReasonSelected = async (reason: AllocationType, otherReason?: string) => {
    setShowReasonSelector(false);
    if (!user) return;

    try {
      setIsProcessing(true);

      // Multi-device guard: check if the server already has an ACTIVE
      // session for this user (e.g. from another device). If so, refuse
      // the local clock-in and pull the server's session so the UI
      // converges. When offline, the check returns null and we proceed
      // with the offline-first local clock-in; the server will refuse
      // the duplicate when the outbox flushes.
      const serverCheck = await checkServerActiveSession(user.id);
      if (serverCheck.activeSessionId) {
        Alert.alert(
          "Already Clocked In",
          "You are already clocked in on another device. The active session has been synced to this device.",
          [{ text: "OK" }],
        );
        // Pull the server's session so local state converges
        await SyncEngine.pullTimesheet(true);
        await loadTodaySession();
        return;
      }

      const now = Date.now();
      const today = getTodayDateString();

      // Pre-generate outbox events so we can use their requestIds as
      // local ClockEvent IDs. This prevents duplicate timeline entries
      // when the server echoes back the same event with requestId as ID.
      const clockInEvent = createClockEvent({
        sessionId: "", // will be set after session creation
        userId: user.id,
        eventType: "CLOCK_IN",
        occurredAt: now,
        date: today,
        clockInAt: now,
        status: "ACTIVE",
        clockInReason: reason,
        allocationType: reason,
        otherReason: reason === "other" ? otherReason : undefined,
      });

      let newSessionId = "";
      const orphanCloseOuts: Array<{
        sessionId: string;
        clockInAt: number;
        clockOutAt: number;
        date: string;
        requestId: string;
      }> = [];

      await database.write(async () => {
        const sessionsCollection = database.collections.get<DaySession>("day_sessions");
        const eventsCollection = database.collections.get<ClockEvent>("clock_events");

        // Auto-close orphaned ACTIVE sessions.
        const orphaned = await sessionsCollection
          .query(Q.where("user_id", user.id), Q.where("status", "ACTIVE"))
          .fetch();
        if (orphaned.length > 0) {
          for (const old of orphaned) {
            const closedAt = old.clockInAt + 1000;
            const orphanOutbox = createClockEvent({
              sessionId: old.id,
              userId: user.id,
              eventType: "CLOCK_OUT",
              occurredAt: closedAt,
              date: old.date,
              clockInAt: old.clockInAt,
              clockOutAt: closedAt,
              status: "CLOCKED_OUT",
              reason: "AUTO_CLOSE_ORPHAN",
            });
            orphanCloseOuts.push({
              sessionId: old.id,
              clockInAt: old.clockInAt,
              clockOutAt: closedAt,
              date: old.date,
              requestId: orphanOutbox.requestId,
            });
            await old.update((s) => {
              s.status = "CLOCKED_OUT";
              s.clockOutAt = closedAt;
            });
            await eventsCollection.create((e) => {
              e._raw.id = orphanOutbox.requestId;
              e.sessionId = old.id;
              e.userId = user.id;
              e.eventType = "CLOCK_OUT";
              e.occurredAt = closedAt;
              e.reason = "AUTO_CLOSE_ORPHAN";
            });
            await SyncEngine.queueEvent(orphanOutbox);
          }
        }

        // Create new session with clock-in reason.
        const newSession = await sessionsCollection.create((s) => {
          s.userId = user.id;
          s.date = today;
          s.clockInAt = now;
          s.status = "ACTIVE";
          s.clockInReason = reason;
          s.allocationType = reason;
          if (reason === "other" && otherReason) {
            s.otherReason = otherReason;
          }
        });

        newSessionId = newSession.id;

        // Update the pre-generated outbox event with the real session ID
        const updatedPayload = JSON.parse(clockInEvent.payloadJson);
        updatedPayload.sessionId = newSession.id;
        clockInEvent.payloadJson = JSON.stringify(updatedPayload);

        await eventsCollection.create((e) => {
          e._raw.id = clockInEvent.requestId;
          e.sessionId = newSession.id;
          e.userId = user.id;
          e.eventType = "CLOCK_IN";
          e.occurredAt = now;
        });

        setSession(newSession);
      });

      await SyncEngine.queueEvent(clockInEvent);

      // Pull tickets to refresh the board after clock-in. Guard against
      // the race where SyncEngine.setCurrentUser hasn't run yet.
      if (user?.id) {
        SyncEngine.pullTickets(true).catch((e) =>
          console.warn("[Timesheet] Post-clock-in ticket pull failed:", e),
        );
      }
    } catch (error) {
      console.error("[Timesheet] Clock in failed:", error);
    } finally {
      setIsProcessing(false);
    }
  };

  // ── Change Allocation ─────────────────────────────────────
  const handleChangeAllocation = async (newType: AllocationType, otherReason?: string) => {
    setShowAllocationChanger(false);
    if (!user || !session) return;

    try {
      setIsProcessing(true);
      const now = Date.now();

      // Pre-generate the outbox event to get the requestId
      const clockEvent = createClockEvent({
        sessionId: session.id,
        userId: user.id,
        eventType: "ALLOCATION_CHANGE",
        occurredAt: now,
        date: session.date,
        clockInAt: session.clockInAt,
        status: "ACTIVE",
        allocationType: newType,
        otherReason: newType === "other" ? otherReason : undefined,
      });

      await database.write(async () => {
        await session.update((s) => {
          s.allocationType = newType;
          if (newType === "other" && otherReason) {
            s.otherReason = otherReason;
          }
        });

        // Create a local ClockEvent so the timeline updates immediately.
        // Use the outbox requestId as the local ID to prevent duplicates
        // when the server echoes the event back.
        const eventsCollection = database.collections.get<ClockEvent>("clock_events");
        await eventsCollection.create((e) => {
          e._raw.id = clockEvent.requestId;
          e.sessionId = session.id;
          e.userId = user.id;
          e.eventType = "ALLOCATION_CHANGE";
          e.occurredAt = now;
          e.allocationType = newType;
        });
      });

      await SyncEngine.queueEvent(clockEvent);

      // Refresh session state.
      await loadTodaySession();
      console.log(`[Timesheet] Allocation changed to ${newType}`);
    } catch (error) {
      console.error("[Timesheet] Allocation change failed:", error);
    } finally {
      setIsProcessing(false);
    }
  };

  // ── Clock Out ─────────────────────────────────────────────
  const handleClockOut = async () => {
    if (!user || !session) return;

    try {
      setIsProcessing(true);

      const activeCheck = await checkActiveTickets(user.id);
      if (activeCheck.hasActiveTickets) {
        setIsProcessing(false);
        const errorMsg = getActiveTicketsErrorMessage(activeCheck.count, "clock out");
        Alert.alert(errorMsg.title, errorMsg.message, [{ text: "OK" }]);
        return;
      }

      setIsProcessing(false);
      setShowTicketSelector(true);
    } catch (error) {
      console.error("[Timesheet] Clock out validation failed:", error);
      setIsProcessing(false);
    }
  };

  const handleTicketSelected = async (ticketId: string | null) => {
    if (!user || !session) return;
    setShowTicketSelector(false);
    setIsProcessing(true);

    try {
      await closeActiveSession({
        userId: user.id,
        ticketId: ticketId || undefined,
        endActiveBreak: false,
        requireNoActiveTickets: true,
      });
      await loadTodaySession();
    } catch (error) {
      console.error("[Timesheet] Clock out failed:", error);
    } finally {
      setIsProcessing(false);
    }
  };

  const handleTicketSelectorCancel = () => {
    setShowTicketSelector(false);
    handleTicketSelected(null);
  };

  // ── Breaks ────────────────────────────────────────────────
  const handleStartBreak = async (breakType: BreakType) => {
    if (!user || !session) return;

    try {
      setIsProcessing(true);

      const activeCheck = await checkActiveTickets(user.id);
      if (activeCheck.hasActiveTickets) {
        setIsProcessing(false);
        const errorMsg = getActiveTicketsErrorMessage(
          activeCheck.count,
          breakType === "lunch" ? "start lunch" : "start personal time",
        );
        Alert.alert(errorMsg.title, errorMsg.message, [{ text: "OK" }]);
        return;
      }

      const now = Date.now();
      const startEventType: ClockEventType =
        breakType === "lunch" ? "LUNCH_START" : "PERSONAL_START";

      const clockEvent = createClockEvent({
        sessionId: session.id,
        userId: user.id,
        eventType: startEventType,
        occurredAt: now,
        date: session.date,
        clockInAt: session.clockInAt,
        reason: breakType === "personal" ? "PERSONAL_TIME" : undefined,
      });

      await database.write(async () => {
        const eventsCollection = database.collections.get<ClockEvent>("clock_events");
        await eventsCollection.create((e) => {
          e._raw.id = clockEvent.requestId;
          e.sessionId = session.id;
          e.userId = user.id;
          e.eventType = startEventType;
          e.occurredAt = now;
          if (breakType === "personal") e.reason = "PERSONAL_TIME";
        });
      });

      setCurrentBreakType(breakType);
      setBreakStartedAt(now);

      await SyncEngine.queueEvent(clockEvent);
    } catch (error) {
      console.error(`[Timesheet] Start ${breakType} failed:`, error);
    } finally {
      setIsProcessing(false);
    }
  };

  const handleEndBreak = async () => {
    if (!user || !session || !currentBreakType) return;

    try {
      setIsProcessing(true);
      const now = Date.now();
      const endEventType: ClockEventType =
        currentBreakType === "lunch" ? "LUNCH_END" : "PERSONAL_END";

      const clockEvent = createClockEvent({
        sessionId: session.id,
        userId: user.id,
        eventType: endEventType,
        occurredAt: now,
        date: session.date,
        clockInAt: session.clockInAt,
        reason: currentBreakType === "personal" ? "PERSONAL_TIME" : undefined,
      });

      await database.write(async () => {
        const eventsCollection = database.collections.get<ClockEvent>("clock_events");
        await eventsCollection.create((e) => {
          e._raw.id = clockEvent.requestId;
          e.sessionId = session.id;
          e.userId = user.id;
          e.eventType = endEventType;
          e.occurredAt = now;
          if (currentBreakType === "personal") e.reason = "PERSONAL_TIME";
        });
      });

      setCurrentBreakType(null);
      setBreakStartedAt(null);

      await SyncEngine.queueEvent(clockEvent);
    } catch (error) {
      console.error("[Timesheet] End break failed:", error);
    } finally {
      setIsProcessing(false);
    }
  };

  // ── Formatting ────────────────────────────────────────────
  const formatTime = (timestamp: number) => {
    return new Date(timestamp).toLocaleTimeString("en-US", {
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    });
  };



  if (isLoading) {
    return (
      <View className="flex-1 items-center justify-center" style={{ backgroundColor: colors.bg }}>
        <ActivityIndicator size="large" color={colors.accent} />
      </View>
    );
  }

  const isClockedIn = session?.status === "ACTIVE";
  const isClockedOut = session?.status === "CLOCKED_OUT";
  const isOnBreak = currentBreakType !== null;
  const isOnLunch = currentBreakType === "lunch";
  const isOnPersonal = currentBreakType === "personal";

  const timelineItems = buildTimelineItems(timelineEvents, todaySessions);

  const heroColor = isOnBreak
    ? colors.accent
    : isClockedIn
      ? colors.success
      : colors.muted;
  const heroLabel = isOnLunch
    ? "ON LUNCH"
    : isOnPersonal
      ? "ON BREAK"
      : isClockedIn
        ? "CLOCKED IN"
        : isClockedOut
          ? "CLOCKED OUT"
          : "NOT CLOCKED IN";
  const heroSubtitle = isOnBreak && breakStartedAt
    ? `Started ${formatTime(breakStartedAt)}`
    : isClockedIn && session?.clockInAt
      ? `Since ${formatTime(session.clockInAt)}`
      : isClockedOut && session?.clockOutAt
        ? `Clocked out at ${formatTime(session.clockOutAt)}`
        : "Ready to start your day";

  const timelineDotColor = (kind: TimelineItem["kind"]) => {
    switch (kind) {
      case "clock_in":
        return colors.success;
      case "clock_out":
        return colors.danger;
      case "allocation_change":
        return colors.primary;
      case "lunch":
      case "personal":
        return colors.accent;
    }
  };

  return (
    <View className="flex-1" style={{ backgroundColor: colors.bg }}>
      <ScrollView
        className="flex-1 px-5 pt-6"
        contentContainerStyle={{ paddingBottom: insets.bottom + 80 }}
      >
        {/* Header */}
        <View className="flex-row items-center justify-between mb-5">
          <Text className="text-2xl font-bold" style={{ color: colors.text }}>
            Timesheet
          </Text>
          {isClockedIn && (
            <View className="flex-row items-center" style={{ gap: 4 }}>
              <View
                className="w-2.5 h-2.5 rounded-full"
                style={{ backgroundColor: colors.success }}
              />
              <Text className="text-sm font-semibold" style={{ color: colors.success }}>
                Live
              </Text>
            </View>
          )}
        </View>

        {/* Current State Hero */}
        <View
          className="rounded-2xl p-6 mb-5"
          style={{
            backgroundColor: heroColor + "15",
            borderWidth: 1,
            borderColor: heroColor + "30",
          }}
        >
          <Text
            className="text-sm font-bold uppercase tracking-widest"
            style={{ color: heroColor }}
          >
            {heroLabel}
          </Text>
          {isClockedIn && !isOnBreak && session?.allocationType && (
            <Text
              className="text-xl font-semibold mt-2"
              style={{ color: colors.text }}
            >
              {getAllocationLabel(session.allocationType as AllocationType)}
            </Text>
          )}
          {isClockedIn && !isOnBreak && session?.otherReason && (
            <Text className="text-xs mt-1 italic" style={{ color: colors.muted }}>
              &ldquo;{session.otherReason}&rdquo;
            </Text>
          )}
          {isClockedIn && (
            <Text
              className="text-4xl font-bold mt-2"
              style={{ color: heroColor }}
            >
              {formatDuration(elapsedSec * 1000, { includeSeconds: true })}
            </Text>
          )}
          <Text className="text-sm mt-2" style={{ color: colors.muted }}>
            {heroSubtitle}
          </Text>
        </View>

        {/* Today's Timeline */}
        {timelineItems.length > 0 && (
          <View
            className="rounded-2xl p-5 mb-5"
            style={{ backgroundColor: colors.surface }}
          >
            <Text
              className="text-xs font-semibold uppercase tracking-wider mb-4"
              style={{ color: colors.muted }}
            >
              Today&apos;s Timeline
            </Text>
            {timelineItems.map((item, index) => (
              <View key={index} className="flex-row" style={{ minHeight: 44 }}>
                {/* Timeline rail */}
                <View className="items-center mr-3" style={{ width: 20 }}>
                  <View
                    className="rounded-full"
                    style={{
                      width: 10,
                      height: 10,
                      backgroundColor: timelineDotColor(item.kind),
                      marginTop: 5,
                    }}
                  />
                  {index < timelineItems.length - 1 && (
                    <View
                      style={{
                        width: 2,
                        flex: 1,
                        backgroundColor: colors.muted + "30",
                        marginTop: 2,
                      }}
                    />
                  )}
                </View>
                {/* Content */}
                <View className="flex-1 mb-4">
                  {item.kind === "clock_in" && (
                    <View className="flex-row items-center justify-between">
                      <View className="flex-1" style={{ flexShrink: 1 }}>
                        <Text
                          className="text-sm font-semibold"
                          style={{ color: colors.text }}
                        >
                          Clocked In
                        </Text>
                        {item.allocation && (
                          <Text
                            className="text-xs mt-0.5"
                            style={{ color: colors.primary }}
                          >
                            {getAllocationLabel(item.allocation as AllocationType)}
                          </Text>
                        )}
                      </View>
                      <Text
                        className="text-xs font-medium ml-2"
                        style={{ color: colors.muted }}
                      >
                        {formatTime(item.time)}
                      </Text>
                    </View>
                  )}
                  {item.kind === "clock_out" && (
                    <View className="flex-row items-center justify-between">
                      <Text
                        className="text-sm font-semibold flex-1"
                        style={{ color: colors.danger, flexShrink: 1 }}
                      >
                        Clocked Out
                      </Text>
                      <Text
                        className="text-xs font-medium ml-2"
                        style={{ color: colors.muted }}
                      >
                        {formatTime(item.time)}
                      </Text>
                    </View>
                  )}
                  {item.kind === "allocation_change" && (
                    <View className="flex-row items-center justify-between">
                      <View className="flex-1" style={{ flexShrink: 1 }}>
                        <Text
                          className="text-sm font-semibold"
                          style={{ color: colors.text }}
                        >
                          Switched to{" "}
                          {item.newAllocation
                            ? getAllocationLabel(item.newAllocation as AllocationType)
                            : "New Allocation"}
                        </Text>
                      </View>
                      <Text
                        className="text-xs font-medium ml-2"
                        style={{ color: colors.muted }}
                      >
                        {formatTime(item.time)}
                      </Text>
                    </View>
                  )}
                  {item.kind === "lunch" && (
                    <View className="flex-row items-center justify-between">
                      <View className="flex-1" style={{ flexShrink: 1 }}>
                        <Text
                          className="text-sm font-semibold"
                          style={{ color: colors.accent }}
                        >
                          Lunch
                        </Text>
                        {item.duration !== undefined ? (
                          <Text
                            className="text-xs mt-0.5"
                            style={{ color: colors.muted }}
                          >
                            {formatDuration(item.duration)}
                          </Text>
                        ) : (
                          <Text
                            className="text-xs mt-0.5 italic"
                            style={{ color: colors.accent }}
                          >
                            In progress...
                          </Text>
                        )}
                      </View>
                      <Text
                        className="text-xs font-medium ml-2"
                        style={{ color: colors.muted }}
                      >
                        {formatTime(item.startTime)}
                        {item.endTime ? ` – ${formatTime(item.endTime)}` : ""}
                      </Text>
                    </View>
                  )}
                  {item.kind === "personal" && (
                    <View className="flex-row items-center justify-between">
                      <View className="flex-1" style={{ flexShrink: 1 }}>
                        <Text
                          className="text-sm font-semibold"
                          style={{ color: colors.accent }}
                        >
                          Personal Time
                        </Text>
                        {item.duration !== undefined ? (
                          <Text
                            className="text-xs mt-0.5"
                            style={{ color: colors.muted }}
                          >
                            {formatDuration(item.duration)}
                          </Text>
                        ) : (
                          <Text
                            className="text-xs mt-0.5 italic"
                            style={{ color: colors.accent }}
                          >
                            In progress...
                          </Text>
                        )}
                      </View>
                      <Text
                        className="text-xs font-medium ml-2"
                        style={{ color: colors.muted }}
                      >
                        {formatTime(item.startTime)}
                        {item.endTime ? ` – ${formatTime(item.endTime)}` : ""}
                      </Text>
                    </View>
                  )}
                </View>
              </View>
            ))}
          </View>
        )}

        {/* Secondary Controls — Change Allocation */}
        {isClockedIn && !isOnBreak && session?.allocationType && (
          <Pressable
            onPress={() => setShowAllocationChanger(true)}
            disabled={isProcessing}
            className="rounded-xl px-4 py-3 mb-3 flex-row items-center justify-between"
            style={{
              backgroundColor: colors.surface,
              borderWidth: 1,
              borderColor: colors.primary + "40",
              opacity: isProcessing ? 0.5 : 1,
              minHeight: 48,
            }}
          >
            <View className="flex-1 mr-2">
              <Text
                className="text-[11px] font-medium uppercase tracking-wider"
                style={{ color: colors.muted }}
              >
                Active Work Allocation
              </Text>
              <Text
                className="text-sm font-bold mt-0.5"
                style={{ color: colors.text }}
              >
                {getAllocationLabel(session.allocationType as AllocationType)}
              </Text>
            </View>
            <View
              className="flex-row items-center rounded-lg px-2.5 py-1.5"
              style={{ backgroundColor: colors.primary + "20", gap: 4 }}
            >
              <Text className="text-xs font-semibold" style={{ color: colors.primary }}>
                Change
              </Text>
              <Ionicons name="swap-horizontal" size={14} color={colors.primary} />
            </View>
          </Pressable>
        )}

        {/* Secondary Controls — Lunch / Break */}
        {isClockedIn && (
          <View
            className="rounded-2xl p-5 mb-3"
            style={{
              backgroundColor: isOnBreak ? colors.accent + "15" : colors.surface,
              borderWidth: 1,
              borderColor: isOnBreak ? colors.accent + "30" : "transparent",
            }}
          >
            <Text
              className="text-xs font-semibold uppercase tracking-wider mb-3"
              style={{ color: colors.muted }}
            >
              Breaks
            </Text>

            {isOnBreak ? (
              <Pressable
                onPress={handleEndBreak}
                disabled={isProcessing}
                className="rounded-xl px-4 py-3"
                style={{
                  backgroundColor: colors.success,
                  opacity: isProcessing ? 0.5 : 1,
                  minHeight: 48,
                }}
              >
                {isProcessing ? (
                  <ActivityIndicator color={colors.text} />
                ) : (
                  <Text
                    className="font-semibold text-center"
                    style={{ color: colors.text }}
                  >
                    End {isOnLunch ? "Lunch" : "Personal Time"}
                  </Text>
                )}
              </Pressable>
            ) : (
              <>
                <Text className="text-xs mb-3" style={{ color: colors.muted }}>
                  Take a break when no tickets are active.
                </Text>
                <View className="flex-row" style={{ gap: 10 }}>
                  <Pressable
                    onPress={() => handleStartBreak("lunch")}
                    disabled={isProcessing}
                    className="flex-1 rounded-xl px-4 py-3"
                    style={{
                      backgroundColor: colors.accent,
                      opacity: isProcessing ? 0.5 : 1,
                      minHeight: 48,
                    }}
                  >
                    <Text
                      className="font-semibold text-center text-sm"
                      style={{ color: colors.text }}
                    >
                      Lunch
                    </Text>
                  </Pressable>
                  <Pressable
                    onPress={() => handleStartBreak("personal")}
                    disabled={isProcessing}
                    className="flex-1 rounded-xl px-4 py-3"
                    style={{
                      backgroundColor: colors.primary,
                      opacity: isProcessing ? 0.5 : 1,
                      minHeight: 48,
                    }}
                  >
                    <Text
                      className="font-semibold text-center text-sm"
                      style={{ color: colors.text }}
                    >
                      Personal
                    </Text>
                  </Pressable>
                </View>
              </>
            )}
          </View>
        )}

        {/* Primary Control — Clock In / Out */}
        <Pressable
          onPress={isClockedIn ? handleClockOut : handleClockInPress}
          disabled={isProcessing || isOnBreak}
          className="rounded-2xl px-5 py-5 mb-4"
          style={{
            backgroundColor: isClockedIn ? colors.danger : colors.success,
            opacity: isProcessing || isOnBreak ? 0.5 : 1,
            minHeight: 56,
          }}
        >
          {isProcessing ? (
            <ActivityIndicator color={colors.text} />
          ) : (
            <Text
              className="text-xl font-bold text-center"
              style={{ color: colors.text }}
            >
              {isClockedIn
                ? "Clock Out"
                : isClockedOut
                  ? "Clock In (New Session)"
                  : "Clock In"}
            </Text>
          )}
        </Pressable>

        {isOnBreak && (
          <Text className="text-xs text-center mb-4" style={{ color: colors.muted }}>
            End your break before clocking out
          </Text>
        )}
        {isClockedOut && (
          <Text className="text-xs text-center mb-6" style={{ color: colors.muted }}>
            Previous session ended. Clock in to start a new one.
          </Text>
        )}
      </ScrollView>

      {/* Reason Selector Modal */}
      <ReasonSelectorModal
        visible={showReasonSelector}
        onSelect={handleClockInReasonSelected}
        onCancel={() => setShowReasonSelector(false)}
        isProcessing={isProcessing}
        title="Why are you clocking in?"
      />

      {/* Allocation Changer Modal */}
      <ReasonSelectorModal
        visible={showAllocationChanger}
        onSelect={handleChangeAllocation}
        onCancel={() => setShowAllocationChanger(false)}
        isProcessing={isProcessing}
        title="Change allocation type"
        currentValue={(session?.allocationType as AllocationType) || null}
      />

      {/* Ticket Selector Modal */}
      <TicketSelectorModal
        visible={showTicketSelector}
        userId={user?.id || ""}
        onSelect={handleTicketSelected}
        onCancel={handleTicketSelectorCancel}
      />
    </View>
  );
}
