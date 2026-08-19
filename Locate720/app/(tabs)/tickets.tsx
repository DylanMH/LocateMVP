import { useCallback, useEffect, useState, useMemo } from "react";
import {
  FlatList,
  RefreshControl,
  Text,
  View,
  AppState,
  Alert,
  Pressable,
} from "react-native";
import { useRouter, useFocusEffect } from "expo-router";
import { Q } from "@nozbe/watermelondb";

import { database } from "../../src/db/database";
import Ticket from "../../src/db/models/Ticket";
import DaySession from "../../src/db/models/DaySession";
import ClockEvent from "../../src/db/models/ClockEvent";
import { useAuth } from "../../src/features/auth/AuthContext";
import { getTodayStartTimestamp, getTodayDateString } from "../../src/features/timesheet/utils/breakStatus";
import { TicketCard } from "../../src/features/tickets/components/TicketCard";
import { CompactTicketCard } from "../../src/features/tickets/components/CompactTicketCard";
import { FilterChips } from "../../src/features/tickets/components/FilterChips";
import { TicketsHeader } from "../../src/features/tickets/components/TicketsHeader";
import { TicketMapView } from "../../src/features/tickets/components/TicketMapView";
import { RescheduleModal } from "../../src/features/tickets/components/RescheduleModal";
import { SyncEngine } from "../../src/features/tickets/sync/SyncEngine";
import { sortTickets } from "../../src/features/tickets/utils/ticketSorting";
import { isTicketClosed } from "../../src/features/tickets/domain/statusMachine";
import {
  getDueUrgencyBucket,
  getDueAccentColorFromTimestamp,
  DUE_URGENCY_LABELS,
} from "../../src/features/tickets/domain/dueColor";
import { getTicketDisplayData, parseTicketPayload } from "../../src/features/tickets/utils/ticketPayload";
import { formatDueDateTime } from "../../src/utils/date";
import { colors } from "../../src/ui/colors";
import type { SegmentedToggleOption } from "../../src/features/tickets/components/SegmentedToggle";

type TicketViewStatusFilter = "OPEN" | "CLOSED";
type TicketAssignedFilter = "MINE" | "ALL";

export default function TicketsScreen() {
  const router = useRouter();
  const { user } = useAuth();
  const [view, setView] = useState<SegmentedToggleOption>("LIST");
  const [statusFilter, setStatusFilter] =
    useState<TicketViewStatusFilter>("OPEN");
  const [assignedFilter, setAssignedFilter] =
    useState<TicketAssignedFilter>("MINE");
  const [refreshing, setRefreshing] = useState(false);
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [clockedInSession, setClockedInSession] = useState<DaySession | null>(
    null,
  );
  const [isCheckingClock, setIsCheckingClock] = useState(true);
  const [isOnBreak, setIsOnBreak] = useState(false);
  const [breakType, setBreakType] = useState<"lunch" | "personal" | null>(null);
  const [clockOutTicketId, setClockOutTicketId] = useState<string | null>(null);
  const [rescheduleSelected, setRescheduleSelected] = useState<Set<string>>(new Set());
  const [showRescheduleModal, setShowRescheduleModal] = useState(false);
  const currentUserId = user?.id || "";

  // Set current user on SyncEngine when auth user changes
  useEffect(() => {
    if (user?.id) {
      SyncEngine.setCurrentUser(user.id);
    }
  }, [user]);

  // Check clock status, break status, and clock-out ticket selection
  const checkBreakStatus = useCallback(async () => {
    if (!user) return;

    try {
      const today = getTodayDateString();
      const sessionsCollection =
        database.collections.get<DaySession>("day_sessions");

      const sessions = await sessionsCollection
        .query(
          Q.where("user_id", user.id),
          Q.where("date", today),
          Q.sortBy("created_at", Q.desc),
        )
        .fetch();

      if (sessions.length > 0 && sessions[0].status === "ACTIVE") {
        const mostRecent = sessions[0];

        // Use shared utility to check break status
        const { checkUserBreakStatus } =
          await import("../../src/features/timesheet/utils/breakStatus");
        const breakStatus = await checkUserBreakStatus(user.id, today);

        if (breakStatus.isOnBreak) {
          console.log(
            `[Tickets] User is on ${breakStatus.breakType} break - hiding tickets`,
          );
          setIsOnBreak(true);
          setBreakType(breakStatus.breakType);
          setClockedInSession(null);
          setClockOutTicketId(null);
        } else {
          console.log("[Tickets] User is actively working - showing tickets");
          setIsOnBreak(false);
          setBreakType(null);
          setClockedInSession(mostRecent);
          setClockOutTicketId(null);
        }
      } else {
        console.log("[Tickets] User is clocked out or no session");
        setIsOnBreak(false);
        setBreakType(null);
        setClockedInSession(null);

        // Check for clocked out session with ticket selection
        const clockedOutSessions = sessions.filter(
          (s) => s.status === "CLOCKED_OUT",
        );
        if (
          clockedOutSessions.length > 0 &&
          clockedOutSessions[0].clockOutTicketId
        ) {
          console.log(
            "[Tickets] Showing clock-out ticket:",
            clockedOutSessions[0].clockOutTicketId,
          );
          setClockOutTicketId(clockedOutSessions[0].clockOutTicketId);
        } else {
          setClockOutTicketId(null);
        }
      }
    } catch (error) {
      console.error("[Tickets] Error checking break status:", error);
    } finally {
      setIsCheckingClock(false);
    }
  }, [user]);

  // Subscribe to clock status changes (reactive)
  useEffect(() => {
    if (!user) return;

    setIsCheckingClock(true);
    const today = getTodayDateString();
    const sessionsCollection =
      database.collections.get<DaySession>("day_sessions");

    const subscription = sessionsCollection
      .query(
        Q.where("user_id", user.id),
        Q.where("date", today),
        Q.sortBy("created_at", Q.desc),
      )
      .observeWithColumns(["status", "clock_out_at"])
      .subscribe(() => {
        console.log("[Tickets] Session changed - rechecking break status");
        checkBreakStatus();
      });

    return () => subscription.unsubscribe();
  }, [user, checkBreakStatus]);

  // Subscribe to clock events (lunch/personal) changes
  useEffect(() => {
    if (!user) return;

    // Only observe today's events (performance optimization)
    const todayStart = getTodayStartTimestamp();
    const eventsCollection =
      database.collections.get<ClockEvent>("clock_events");

    const subscription = eventsCollection
      .query(
        Q.where("user_id", user.id),
        Q.where("occurred_at", Q.gte(todayStart)), // Only today's events
        Q.or(
          Q.where("event_type", "LUNCH_START"),
          Q.where("event_type", "LUNCH_END"),
          Q.where("event_type", "PERSONAL_START"),
          Q.where("event_type", "PERSONAL_END"),
        ),
      )
      .observe()
      .subscribe(() => {
        console.log("[Tickets] Clock event changed - rechecking break status");
        checkBreakStatus();
      });

    return () => subscription.unsubscribe();
  }, [user, checkBreakStatus]);

  // Subscribe to tickets observable
  useEffect(() => {
    const ticketsCollection = database.collections.get<Ticket>("tickets");
    const subscription = ticketsCollection
      .query(Q.sortBy("due_at", Q.asc))
      .observe()
      .subscribe((updatedTickets) => {
        setTickets(updatedTickets);
      });

    return () => subscription.unsubscribe();
  }, []);

  // Pull from backend only when clocked in
  useEffect(() => {
    if (clockedInSession && !isCheckingClock) {
      console.log("[Tickets] Clocked in - pulling fresh tickets from server");
      SyncEngine.syncNow(true);
    }
  }, [clockedInSession, isCheckingClock]);

  // Refresh when screen comes into focus (e.g., navigating back from detail)
  useFocusEffect(
    useCallback(() => {
      // Force immediate re-query on focus to catch any pending DB changes
      const ticketsCollection = database.collections.get<Ticket>("tickets");
      ticketsCollection
        .query(Q.sortBy("due_at", Q.asc))
        .fetch()
        .then((freshTickets) => {
          setTickets(freshTickets);
        });

      // Periodic refresh while focused (every 3 minutes)
      const interval = setInterval(() => {
        SyncEngine.syncNow();
      }, 180000); // 3 minutes

      return () => clearInterval(interval);
    }, []),
  );

  // App foreground refresh
  useEffect(() => {
    const subscription = AppState.addEventListener("change", (nextAppState) => {
      if (nextAppState === "active") {
        SyncEngine.syncNow();
      }
    });

    return () => subscription.remove();
  }, []);

  const handleRefresh = async () => {
    setRefreshing(true);
    await SyncEngine.syncNow(true);
    setRefreshing(false);
  };

  const handleSearchPress = useCallback(() => {
    Alert.alert(
      "Ticket Search",
      "Search is planned for a later phase. This button is now in place so the tickets workspace layout is ready for that flow.",
    );
  }, []);

  const filteredTickets = tickets.filter((ticket) => {
    // If on break, hide all tickets
    if (isOnBreak) {
      return false;
    }

    // If clocked out, only show selected ticket (if any)
    if (!clockedInSession) {
      // If there's a clock-out ticket selected, show only that one
      if (clockOutTicketId) {
        return ticket.id === clockOutTicketId;
      }
      // Otherwise, hide all tickets when clocked out
      return false;
    }

    // When clocked in and working, apply normal filters
    // Status filter - check locatorStatus for ticket lifecycle state
    const isOpen =
      ticket.locatorStatus !== "CLOSED" && ticket.locatorStatus !== "UNABLE";
    if (statusFilter === "OPEN" && !isOpen) return false;
    if (statusFilter === "CLOSED" && isOpen) return false;

    // Assigned filter
    if (assignedFilter === "MINE" && ticket.assignedTechId !== currentUserId) {
      return false;
    }

    return true;
  });

  // Apply sophisticated sorting: ONSITE > ENROUTE > Emergency/No Response > Regular, then by due date
  const sorted = sortTickets(filteredTickets);

  return (
    <View className="flex-1" style={{ backgroundColor: colors.bg }}>
      <TicketsHeader
        userName={user?.name}
        view={view}
        onChangeView={setView}
        onPressSearch={handleSearchPress}
      />
      {view !== "RESCHEDULE" ? (
        <FilterChips
          status={statusFilter}
          onChangeStatus={setStatusFilter}
          assigned={assignedFilter}
          onChangeAssigned={setAssignedFilter}
        />
      ) : null}

      {view === "MAP" ? (
        <TicketMapView
          tickets={sorted}
          onOpenTicket={(ticketId) =>
            router.push({
              pathname: "/ticket-details/[id]",
              params: { id: ticketId },
            })
          }
        />
      ) : view === "RESCHEDULE" ? (
        <RescheduleTab
          tickets={sorted.filter((t) => {
            // Only open, non-late tickets can be rescheduled
            if (isTicketClosed(t.locatorStatus)) return false;
            if (t.dueAt && t.dueAt < Date.now()) return false;
            return true;
          })}
          selected={rescheduleSelected}
          onToggleSelect={(id) => {
            const next = new Set(rescheduleSelected);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            setRescheduleSelected(next);
          }}
          onClearSelection={() => setRescheduleSelected(new Set())}
          onReschedule={() => setShowRescheduleModal(true)}
        />
      ) : (
        <FlatList
          data={sorted}
          keyExtractor={(item) => item.id}
          contentContainerStyle={{ paddingTop: 8, paddingBottom: 24 }}
          ItemSeparatorComponent={() => (
            <View className={view === "COMPACT" ? "h-1.5" : "h-3"} />
          )}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={handleRefresh} />
          }
          renderItem={({ item }) =>
            view === "COMPACT" ? (
              <CompactTicketCard
                ticket={item}
                onPress={() =>
                  router.push({
                    pathname: "/ticket-details/[id]",
                    params: { id: item.id },
                  })
                }
              />
            ) : (
              <TicketCard
                ticket={item}
                onPress={() =>
                  router.push({
                    pathname: "/ticket-details/[id]",
                    params: { id: item.id },
                  })
                }
              />
            )
          }
          ListEmptyComponent={
            <View className="px-4 pt-8">
              {!clockedInSession ? (
                <>
                  {isOnBreak ? (
                    <>
                      <Text
                        className="text-2xl font-bold mb-3"
                        style={{ color: colors.text }}
                      >
                        {breakType === "lunch"
                          ? "On Lunch Break"
                          : "On Personal Time"}
                      </Text>
                      <Text
                        className="text-base mb-2"
                        style={{ color: colors.text }}
                      >
                        You are currently on{" "}
                        {breakType === "lunch"
                          ? "lunch break"
                          : "personal time"}
                        .
                      </Text>
                      <Text
                        className="text-sm mb-4"
                        style={{ color: colors.muted }}
                      >
                        End your{" "}
                        {breakType === "lunch"
                          ? "lunch break"
                          : "personal time"}{" "}
                        from the Timesheet tab to resume work and view tickets.
                      </Text>
                    </>
                  ) : (
                    <>
                      <Text
                        className="text-2xl font-bold mb-3"
                        style={{ color: colors.text }}
                      >
                        Clocked Out
                      </Text>
                      <Text
                        className="text-base mb-2"
                        style={{ color: colors.text }}
                      >
                        You are currently clocked out.
                      </Text>
                      <Text
                        className="text-sm mb-4"
                        style={{ color: colors.muted }}
                      >
                        When you clock in from the Timesheet tab, your tickets
                        will load here.
                      </Text>
                      <Text className="text-xs" style={{ color: colors.muted }}>
                        Phase 5 will add clock-out ticket selection
                      </Text>
                    </>
                  )}
                </>
              ) : (
                <>
                  <Text
                    className="text-base font-semibold"
                    style={{ color: colors.text }}
                  >
                    No tickets
                  </Text>
                  <Text
                    className="text-sm mt-2"
                    style={{ color: colors.muted }}
                  >
                    Try adjusting filters.
                  </Text>
                </>
              )}
            </View>
          }
        />
      )}
      {showRescheduleModal && (
        <RescheduleModal
          visible={showRescheduleModal}
          onClose={() => setShowRescheduleModal(false)}
          ticketIds={Array.from(rescheduleSelected)}
          ticketNumbers={sorted
            .filter((t) => rescheduleSelected.has(t.id))
            .map((t) => t.ticketNumber)}
          currentDueAt={(() => {
            const selected = sorted.filter((t) => rescheduleSelected.has(t.id));
            if (selected.length === 0) return Date.now();
            return Math.min(...selected.map((t) => t.dueAt || Date.now()));
          })()}
          contractorName={(() => {
            const selected = sorted.filter((t) => rescheduleSelected.has(t.id));
            if (selected.length === 0) return undefined;
            const payload = parseTicketPayload(selected[0].payloadJson);
            return payload.contractor;
          })()}
          contractorPhone={(() => {
            const selected = sorted.filter((t) => rescheduleSelected.has(t.id));
            if (selected.length === 0) return undefined;
            const payload = parseTicketPayload(selected[0].payloadJson);
            return payload.contractorPhone;
          })()}
          onRescheduled={() => {
            setRescheduleSelected(new Set());
            SyncEngine.syncNow(true);
          }}
        />
      )}
    </View>
  );
}

// --- Reschedule Tab Component ---

function RescheduleTab({
  tickets,
  selected,
  onToggleSelect,
  onClearSelection,
  onReschedule,
}: {
  tickets: Ticket[];
  selected: Set<string>;
  onToggleSelect: (id: string) => void;
  onClearSelection: () => void;
  onReschedule: () => void;
}) {
  // Validate contractor grouping — can only reschedule tickets from same contractor
  const selectedTickets = tickets.filter((t) => selected.has(t.id));
  const selectedContractors = new Set(
    selectedTickets.map((t) => {
      const payload = parseTicketPayload(t.payloadJson);
      return payload.contractor || "Unknown";
    }),
  );
  const canReschedule = selected.size > 0 && selectedContractors.size <= 1;

  return (
    <View className="flex-1 px-4 pt-3">
      {/* Selection summary bar */}
      {selected.size > 0 && (
        <View
          className="flex-row items-center justify-between rounded-xl px-4 py-3 mb-3"
          style={{ backgroundColor: colors.surface }}
        >
          <Text className="text-sm" style={{ color: colors.text }}>
            {selected.size} selected
            {selectedContractors.size > 1 ? " — different contractors" : ""}
          </Text>
          <View className="flex-row" style={{ gap: 12 }}>
            <Pressable onPress={onClearSelection} hitSlop={8}>
              <Text className="text-sm" style={{ color: colors.muted }}>
                Clear
              </Text>
            </Pressable>
            <Pressable
              onPress={onReschedule}
              disabled={!canReschedule}
              hitSlop={8}
            >
              <Text
                className="text-sm font-bold"
                style={{ color: canReschedule ? colors.accent : colors.muted }}
              >
                Reschedule
              </Text>
            </Pressable>
          </View>
        </View>
      )}

      {tickets.length === 0 ? (
        <View className="flex-1 items-center justify-center">
          <Text className="text-base font-semibold mb-2" style={{ color: colors.text }}>
            No eligible tickets
          </Text>
          <Text className="text-sm text-center" style={{ color: colors.muted }}>
            Open, non-late tickets will appear here for rescheduling. Late
            tickets cannot be rescheduled.
          </Text>
        </View>
      ) : (
        <FlatList
          data={tickets}
          keyExtractor={(item) => item.id}
          contentContainerStyle={{ paddingBottom: 24 }}
          ItemSeparatorComponent={() => <View className="h-2" />}
          renderItem={({ item }) => {
            const isSelected = selected.has(item.id);
            const payload = parseTicketPayload(item.payloadJson);
            const { contractor, workType } = getTicketDisplayData(item.payloadJson);
            const dueBucket = getDueUrgencyBucket(item.dueAt);
            const dueColor = getDueAccentColorFromTimestamp(item.dueAt);
            const dueLabel = DUE_URGENCY_LABELS[dueBucket];
            return (
              <Pressable
                onPress={() => onToggleSelect(item.id)}
                className="rounded-2xl p-4"
                style={{
                  backgroundColor: colors.surface,
                  borderLeftWidth: 4,
                  borderLeftColor: dueColor,
                }}
              >
                <View className="flex-row items-center justify-between">
                  <View className="flex-1">
                    <View className="flex-row items-center" style={{ gap: 6 }}>
                      <Text className="text-sm font-bold" style={{ color: colors.text }}>
                        {item.ticketNumber}
                      </Text>
                      <View
                        className="px-1.5 py-0.5 rounded-full"
                        style={{ backgroundColor: dueColor }}
                      >
                        <Text className="text-[10px] font-semibold" style={{ color: colors.bg }}>
                          {dueLabel}
                        </Text>
                      </View>
                    </View>
                    <Text
                      className="text-xs mt-0.5"
                      style={{ color: colors.muted }}
                      numberOfLines={1}
                    >
                      {item.address}
                    </Text>
                    <View className="flex-row mt-1" style={{ gap: 8 }}>
                      <Text className="text-xs" style={{ color: colors.muted }}>
                        Due: {formatDueDateTime(item.dueAt)}
                      </Text>
                      {contractor && (
                        <Text className="text-xs" style={{ color: colors.muted }}>
                          · {contractor}
                        </Text>
                      )}
                    </View>
                  </View>
                  <View
                    className="w-6 h-6 rounded-full border-2 items-center justify-center"
                    style={{
                      borderColor: isSelected ? colors.accent : colors.muted,
                      backgroundColor: isSelected ? colors.accent : "transparent",
                    }}
                  >
                    {isSelected && (
                      <Text className="text-xs font-bold" style={{ color: "#fff" }}>
                        ✓
                      </Text>
                    )}
                  </View>
                </View>
              </Pressable>
            );
          }}
        />
      )}
    </View>
  );
}
