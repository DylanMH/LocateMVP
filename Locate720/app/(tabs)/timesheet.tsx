import { View, Text, Pressable, ScrollView, ActivityIndicator, Alert } from "react-native";
import { useEffect, useState, useCallback, useRef } from "react";
import { Ionicons } from "@expo/vector-icons";
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
} from "../../src/features/timesheet/utils/validation";
import { checkUserBreakStatus, getTodayDateString } from "../../src/features/timesheet/utils/breakStatus";
import { TicketSelectorModal } from "../../src/features/timesheet/components/TicketSelectorModal";
import { ReasonSelectorModal, getAllocationLabel } from "../../src/features/timesheet/components/ReasonSelectorModal";
import type { BreakType, ClockEventType } from "../../src/features/timesheet/types";
import { Q } from "@nozbe/watermelondb";

export default function Timesheet() {
  const { user } = useAuth();
  const [session, setSession] = useState<DaySession | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isProcessing, setIsProcessing] = useState(false);
  const [breakStartedAt, setBreakStartedAt] = useState<number | null>(null);
  const [currentBreakType, setCurrentBreakType] = useState<BreakType | null>(null);
  const [showTicketSelector, setShowTicketSelector] = useState(false);
  const [showReasonSelector, setShowReasonSelector] = useState(false);
  const [showAllocationChanger, setShowAllocationChanger] = useState(false);
  const [elapsedSec, setElapsedSec] = useState(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Dynamic duration timer — updates every second while clocked in.
  useEffect(() => {
    if (session?.status === "ACTIVE" && session.clockInAt) {
      setElapsedSec(Math.floor((Date.now() - session.clockInAt) / 1000));
      timerRef.current = setInterval(() => {
        setElapsedSec(Math.floor((Date.now() - session.clockInAt) / 1000));
      }, 1000);
    } else {
      if (timerRef.current) clearInterval(timerRef.current);
    }
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [session?.status, session?.clockInAt]);

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
  }, [loadTodaySession]);

  // ── Clock In ──────────────────────────────────────────────
  const handleClockInPress = () => {
    setShowReasonSelector(true);
  };

  const handleClockInReasonSelected = async (reason: AllocationType, otherReason?: string) => {
    setShowReasonSelector(false);
    if (!user) return;

    try {
      setIsProcessing(true);
      const now = Date.now();
      const today = new Date().toISOString().split("T")[0];

      let newSessionId = "";
      const orphanCloseOuts: Array<{
        sessionId: string;
        clockInAt: number;
        clockOutAt: number;
        date: string;
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
            orphanCloseOuts.push({
              sessionId: old.id,
              clockInAt: old.clockInAt,
              clockOutAt: closedAt,
              date: old.date,
            });
            await old.update((s) => {
              s.status = "CLOCKED_OUT";
              s.clockOutAt = closedAt;
            });
            await eventsCollection.create((e) => {
              e.sessionId = old.id;
              e.userId = user.id;
              e.eventType = "CLOCK_OUT";
              e.occurredAt = closedAt;
              e.reason = "AUTO_CLOSE_ORPHAN";
            });
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

        await eventsCollection.create((e) => {
          e.sessionId = newSession.id;
          e.userId = user.id;
          e.eventType = "CLOCK_IN";
          e.occurredAt = now;
        });

        setSession(newSession);
      });

      // Queue orphan close-outs.
      for (const orphan of orphanCloseOuts) {
        const orphanEvent = createClockEvent({
          sessionId: orphan.sessionId,
          userId: user.id,
          eventType: "CLOCK_OUT",
          occurredAt: orphan.clockOutAt,
          date: orphan.date,
          clockInAt: orphan.clockInAt,
          clockOutAt: orphan.clockOutAt,
          status: "CLOCKED_OUT",
          reason: "AUTO_CLOSE_ORPHAN",
        });
        await SyncEngine.queueEvent(orphanEvent);
      }

      // Queue clock-in with reason.
      const clockEvent = createClockEvent({
        sessionId: newSessionId,
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
      await SyncEngine.queueEvent(clockEvent);

      SyncEngine.pullTickets(true);
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
      await database.write(async () => {
        await session.update((s) => {
          s.allocationType = newType;
          if (newType === "other" && otherReason) {
            s.otherReason = otherReason;
          }
        });
      });
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

      await database.write(async () => {
        const eventsCollection = database.collections.get<ClockEvent>("clock_events");
        await eventsCollection.create((e) => {
          e.sessionId = session.id;
          e.userId = user.id;
          e.eventType = startEventType;
          e.occurredAt = now;
          if (breakType === "personal") e.reason = "PERSONAL_TIME";
        });
      });

      setCurrentBreakType(breakType);
      setBreakStartedAt(now);

      const clockEvent = createClockEvent({
        sessionId: session.id,
        userId: user.id,
        eventType: startEventType,
        occurredAt: now,
        date: session.date,
        clockInAt: session.clockInAt,
        reason: breakType === "personal" ? "PERSONAL_TIME" : undefined,
      });
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

      await database.write(async () => {
        const eventsCollection = database.collections.get<ClockEvent>("clock_events");
        await eventsCollection.create((e) => {
          e.sessionId = session.id;
          e.userId = user.id;
          e.eventType = endEventType;
          e.occurredAt = now;
          if (currentBreakType === "personal") e.reason = "PERSONAL_TIME";
        });
      });

      setCurrentBreakType(null);
      setBreakStartedAt(null);

      const clockEvent = createClockEvent({
        sessionId: session.id,
        userId: user.id,
        eventType: endEventType,
        occurredAt: now,
        date: session.date,
        clockInAt: session.clockInAt,
        reason: currentBreakType === "personal" ? "PERSONAL_TIME" : undefined,
      });
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

  const formatElapsed = (sec: number) => {
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    const s = sec % 60;
    if (h > 0) return `${h}h ${m}m ${s}s`;
    return `${m}m ${s}s`;
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

  return (
    <View className="flex-1" style={{ backgroundColor: colors.bg }}>
      <ScrollView className="flex-1 px-5 pt-6">
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

        {/* Status Card */}
        <View
          className="rounded-2xl p-5 mb-5"
          style={{
            backgroundColor: isClockedIn ? colors.success + "15" : colors.surface,
            borderWidth: 1,
            borderColor: isClockedIn ? colors.success + "30" : "transparent",
          }}
        >
          <View className="flex-row items-center justify-between mb-3">
            <Text className="text-xs font-semibold uppercase tracking-wider" style={{ color: colors.muted }}>
              Status
            </Text>
          </View>
          <Text
            className="text-2xl font-bold"
            style={{ color: isClockedIn ? colors.success : isClockedOut ? colors.muted : colors.text }}
          >
            {isClockedIn ? "On the Clock" : isClockedOut ? "Clocked Out" : "Not Clocked In"}
          </Text>
          {isClockedIn && session?.allocationType && (
            <Pressable
              onPress={() => setShowAllocationChanger(true)}
              className="mt-3 flex-row items-center justify-between rounded-xl p-3"
              style={{ backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.primary + "40" }}
            >
              <View className="flex-1 mr-2">
                <Text className="text-[11px] font-medium uppercase tracking-wider" style={{ color: colors.muted }}>
                  Active Work Allocation
                </Text>
                <Text className="text-sm font-bold mt-0.5" style={{ color: colors.text }}>
                  {getAllocationLabel(session.allocationType)}
                </Text>
              </View>
              <View className="flex-row items-center rounded-lg px-2.5 py-1.5" style={{ backgroundColor: colors.primary + "20", gap: 4 }}>
                <Text className="text-xs font-semibold" style={{ color: colors.primary }}>
                  Change
                </Text>
                <Ionicons name="swap-horizontal" size={14} color={colors.primary} />
              </View>
            </Pressable>
          )}
          {isClockedIn && session?.otherReason && (
            <Text className="text-xs mt-2 italic" style={{ color: colors.muted }}>
              &ldquo;{session.otherReason}&rdquo;
            </Text>
          )}
        </View>

        {/* Live Duration */}
        {isClockedIn && (
          <View className="rounded-2xl p-5 mb-5 items-center" style={{ backgroundColor: colors.surface }}>
            <Text className="text-xs font-semibold uppercase tracking-wider mb-1" style={{ color: colors.muted }}>
              Elapsed
            </Text>
            <Text className="text-3xl font-bold" style={{ color: colors.success }}>
              {formatElapsed(elapsedSec)}
            </Text>
          </View>
        )}

        {/* Session Details */}
        {session && (
          <View className="rounded-2xl p-5 mb-5" style={{ backgroundColor: colors.surface }}>
            <Text className="text-xs font-semibold uppercase tracking-wider mb-3" style={{ color: colors.muted }}>
              Today's Session
            </Text>

            <View className="flex-row justify-between mb-2.5">
              <Text style={{ color: colors.text }}>Clock In</Text>
              <Text className="font-semibold" style={{ color: colors.accent }}>
                {formatTime(session.clockInAt)}
              </Text>
            </View>

            {session.clockOutAt && (
              <View className="flex-row justify-between mb-2.5">
                <Text style={{ color: colors.text }}>Clock Out</Text>
                <Text className="font-semibold" style={{ color: colors.accent }}>
                  {formatTime(session.clockOutAt)}
                </Text>
              </View>
            )}

            {session.clockInReason && (
              <View className="flex-row justify-between mb-2.5">
                <Text style={{ color: colors.text }}>Reason</Text>
                <Text className="font-semibold" style={{ color: colors.primary }}>
                  {getAllocationLabel(session.clockInReason)}
                </Text>
              </View>
            )}

            {isOnBreak && breakStartedAt && (
              <View className="flex-row justify-between mb-2.5">
                <Text style={{ color: colors.text }}>
                  {isOnLunch ? "Lunch" : "Personal"} started
                </Text>
                <Text className="font-semibold" style={{ color: colors.accent }}>
                  {formatTime(breakStartedAt)}
                </Text>
              </View>
            )}
          </View>
        )}

        {/* Break Section */}
        {isClockedIn && (
          <View
            className="rounded-2xl p-5 mb-5"
            style={{
              backgroundColor: isOnBreak ? colors.accent + "15" : colors.surface,
              borderWidth: 1,
              borderColor: isOnBreak ? colors.accent + "30" : "transparent",
            }}
          >
            <Text className="text-xs font-semibold uppercase tracking-wider mb-3" style={{ color: colors.muted }}>
              Breaks
            </Text>

            {isOnBreak ? (
              <>
                <Pressable
                  onPress={handleEndBreak}
                  disabled={isProcessing}
                  className="rounded-xl px-4 py-3"
                  style={{ backgroundColor: colors.success, opacity: isProcessing ? 0.5 : 1 }}
                >
                  {isProcessing ? (
                    <ActivityIndicator color={colors.text} />
                  ) : (
                    <Text className="font-semibold text-center" style={{ color: colors.text }}>
                      End {isOnLunch ? "Lunch" : "Personal Time"}
                    </Text>
                  )}
                </Pressable>
              </>
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
                    style={{ backgroundColor: colors.accent, opacity: isProcessing ? 0.5 : 1 }}
                  >
                    <Text className="font-semibold text-center text-sm" style={{ color: colors.text }}>
                      Lunch
                    </Text>
                  </Pressable>
                  <Pressable
                    onPress={() => handleStartBreak("personal")}
                    disabled={isProcessing}
                    className="flex-1 rounded-xl px-4 py-3"
                    style={{ backgroundColor: colors.primary, opacity: isProcessing ? 0.5 : 1 }}
                  >
                    <Text className="font-semibold text-center text-sm" style={{ color: colors.text }}>
                      Personal
                    </Text>
                  </Pressable>
                </View>
              </>
            )}
          </View>
        )}

        {/* Clock In / Out Button */}
        <Pressable
          onPress={isClockedIn ? handleClockOut : handleClockInPress}
          disabled={isProcessing || isOnBreak}
          className="rounded-2xl px-5 py-4 mb-4"
          style={{
            backgroundColor: isClockedIn ? colors.danger : colors.success,
            opacity: isProcessing || isOnBreak ? 0.5 : 1,
          }}
        >
          {isProcessing ? (
            <ActivityIndicator color={colors.text} />
          ) : (
            <Text className="text-lg font-bold text-center" style={{ color: colors.text }}>
              {isClockedIn ? "Clock Out" : isClockedOut ? "Clock In (New Session)" : "Clock In"}
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
