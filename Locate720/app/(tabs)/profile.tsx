import { useCallback, useEffect, useState } from "react";
import { View, Text, ScrollView, Pressable, Alert, ActivityIndicator } from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import { Q } from "@nozbe/watermelondb";
import { colors } from "../../src/ui/colors";
import { useAuth } from "../../src/features/auth/AuthContext";
import { database } from "../../src/db/database";
import Ticket from "../../src/db/models/Ticket";
import DaySession from "../../src/db/models/DaySession";
import { closeActiveSession } from "../../src/features/timesheet/utils/validation";
import { logger } from "../../src/utils/logger";
import { API_BASE_URL, ENDPOINTS } from "../../src/config/api";
import { fetchWithTimeout } from "../../src/utils/fetchWithTimeout";
import { getTodayDateString } from "../../src/features/timesheet/utils/breakStatus";
import { parseTicketPayload } from "../../src/features/tickets/utils/ticketPayload";

interface ProfileMetrics {
  supervisor: string;
  ticketsOnBoard: number;
  closedToday: number;
  totalFootageAllocated: number;
  totalUtilitiesClosed: number;
  lph: number;
  fph: number;
  accumulatedClockInTimeMs: number;
}

const defaultMetrics: ProfileMetrics = {
  supervisor: "Not assigned",
  ticketsOnBoard: 0,
  closedToday: 0,
  totalFootageAllocated: 0,
  totalUtilitiesClosed: 0,
  lph: 0,
  fph: 0,
  accumulatedClockInTimeMs: 0,
};

interface LocalMetricsSnapshot {
  ticketsOnBoard: number;
  closedToday: number;
  totalFootageAllocated: number;
  totalUtilitiesClosed: number;
  accumulatedClockInTimeMs: number;
  hasActiveSession: boolean;
}

async function buildLocalMetricsSnapshot(id: string): Promise<LocalMetricsSnapshot> {
  const today = getTodayDateString();
  const todayStartMs = new Date().setHours(0, 0, 0, 0);
  const ticketsCollection = database.collections.get<Ticket>("tickets");
  const sessionsCollection = database.collections.get<DaySession>("day_sessions");

  const [userTickets, todaySessions] = await Promise.all([
    ticketsCollection.query(Q.where("assigned_tech_id", id)).fetch(),
    sessionsCollection
      .query(
        Q.where("user_id", id),
        Q.where("date", today),
        Q.sortBy("created_at", Q.desc),
      )
      .fetch(),
  ]);

  let closedToday = 0;
  let totalFootageAllocated = 0;
  let totalUtilitiesClosed = 0;

  for (const ticket of userTickets) {
    const wasClosedToday = !!ticket.closedAt && ticket.closedAt >= todayStartMs;

    if (!wasClosedToday) {
      continue;
    }

    closedToday += 1;

    if (ticket.closedAt && ticket.closedAt >= todayStartMs) {
      const payload = parseTicketPayload(ticket.payloadJson);
      const customerMarking = payload.customerMarking || payload.customerMarkings || {};

      for (const marking of Object.values(customerMarking) as any[]) {
        if (marking?.completed) {
          totalUtilitiesClosed += 1;
        }

        const footage = parseInt(marking?.footage || "0", 10);
        if (!Number.isNaN(footage)) {
          totalFootageAllocated += footage;
        }
      }
    }
  }

  const ticketsOnBoard = userTickets.filter(
    (ticket) =>
      ticket.locatorStatus !== "CLOSED" && ticket.locatorStatus !== "UNABLE",
  ).length;

  const accumulatedClockInTimeMs = todaySessions.reduce((total, session) => {
    if (!session.clockInAt) {
      return total;
    }

    const endTime =
      session.status === "ACTIVE"
        ? Date.now()
        : session.clockOutAt && session.clockOutAt > session.clockInAt
          ? session.clockOutAt
          : session.clockInAt;

    return total + Math.max(0, endTime - session.clockInAt);
  }, 0);

  return {
    ticketsOnBoard,
    closedToday,
    totalFootageAllocated,
    totalUtilitiesClosed,
    accumulatedClockInTimeMs,
    hasActiveSession: todaySessions.some((session) => session.status === "ACTIVE"),
  };
}

function formatDuration(ms: number): string {
  const totalMinutes = Math.max(0, Math.floor(ms / 60000));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return `${hours}h ${minutes}m`;
}

function formatRate(value: number): string {
  return Number.isFinite(value) ? value.toFixed(1) : "0.0";
}

function InfoCard({ label, value }: { label: string; value: string }) {
  return (
    <View className="rounded-xl p-4 mb-4" style={{ backgroundColor: colors.surface }}>
      <Text className="text-sm font-semibold mb-1" style={{ color: colors.muted }}>
        {label}
      </Text>
      <Text className="text-lg" style={{ color: colors.text }}>
        {value}
      </Text>
    </View>
  );
}

function MetricCard({ label, value }: { label: string; value: string }) {
  return (
    <View className="flex-1 rounded-xl p-4" style={{ backgroundColor: colors.surface }}>
      <Text className="text-xs font-semibold mb-1" style={{ color: colors.muted }}>
        {label}
      </Text>
      <Text className="text-xl font-bold" style={{ color: colors.text }}>
        {value}
      </Text>
    </View>
  );
}

export default function ProfileScreen() {
  const { user, logout } = useAuth();
  const router = useRouter();
  const [isSigningOut, setIsSigningOut] = useState(false);
  const [metrics, setMetrics] = useState<ProfileMetrics>(defaultMetrics);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [metricsError, setMetricsError] = useState<string | null>(null);
  const [localClockMs, setLocalClockMs] = useState(0);
  const [hasActiveSession, setHasActiveSession] = useState(false);
  const [todayKey, setTodayKey] = useState(getTodayDateString());

  const displayedClockMs = Math.max(
    metrics.accumulatedClockInTimeMs,
    localClockMs,
  );

  const clockOutBeforeSignOut = async () => {
    if (!user) return;
    await closeActiveSession({
      userId: user.id,
      endActiveBreak: true,
      requireNoActiveTickets: true,
    });
    logger.log("[Profile] Session closeout completed before sign out");
  };

  const loadProfileMetrics = useCallback(async () => {
    if (!user) return;

    setIsRefreshing(true);
    setMetricsError(null);

    try {
      const fallbackMetrics = await buildLocalMetricsSnapshot(user.id);
      const fallbackHours = fallbackMetrics.accumulatedClockInTimeMs / 3600000;

      const response = await fetchWithTimeout(
        `${API_BASE_URL}${ENDPOINTS.users}/${encodeURIComponent(user.id)}/productivity-summary`,
      );

      if (!response.ok) {
        throw new Error(`Failed to load productivity summary (${response.status})`);
      }

      const summaryData = await response.json();
      const totalUtilitiesClosed =
        summaryData?.totalUtilitiesClosed ?? fallbackMetrics.totalUtilitiesClosed;
      const totalFootageAllocated =
        summaryData?.totalFootageAllocated ?? fallbackMetrics.totalFootageAllocated;
      const accumulatedClockInTimeMs =
        summaryData?.accumulatedClockInTimeMs ?? fallbackMetrics.accumulatedClockInTimeMs;
      const workedHours = accumulatedClockInTimeMs / 3600000;

      setMetrics({
        supervisor: summaryData?.supervisor || "Not assigned",
        ticketsOnBoard: summaryData?.ticketsOnBoard ?? fallbackMetrics.ticketsOnBoard,
        closedToday: summaryData?.closedToday ?? fallbackMetrics.closedToday,
        totalFootageAllocated,
        totalUtilitiesClosed,
        lph:
          summaryData?.lph ??
          (fallbackHours > 0 ? totalUtilitiesClosed / fallbackHours : 0),
        fph:
          summaryData?.fph ??
          (fallbackHours > 0 ? totalFootageAllocated / fallbackHours : 0),
        accumulatedClockInTimeMs,
      });
      setLocalClockMs(fallbackMetrics.accumulatedClockInTimeMs);
      setHasActiveSession(fallbackMetrics.hasActiveSession);
    } catch (error) {
      logger.error("[Profile] Failed to load metrics:", error);
      const fallbackMetrics = await buildLocalMetricsSnapshot(user.id);
      const fallbackHours = fallbackMetrics.accumulatedClockInTimeMs / 3600000;

      setMetrics({
        supervisor: "Not assigned",
        ticketsOnBoard: fallbackMetrics.ticketsOnBoard,
        closedToday: fallbackMetrics.closedToday,
        totalFootageAllocated: fallbackMetrics.totalFootageAllocated,
        totalUtilitiesClosed: fallbackMetrics.totalUtilitiesClosed,
        lph:
          fallbackHours > 0
            ? fallbackMetrics.totalUtilitiesClosed / fallbackHours
            : 0,
        fph:
          fallbackHours > 0
            ? fallbackMetrics.totalFootageAllocated / fallbackHours
            : 0,
        accumulatedClockInTimeMs: fallbackMetrics.accumulatedClockInTimeMs,
      });
      setLocalClockMs(fallbackMetrics.accumulatedClockInTimeMs);
      setHasActiveSession(fallbackMetrics.hasActiveSession);
      setMetricsError(
        error instanceof Error
          ? `${error.message}. Showing local fallback values where available.`
          : "Failed to load profile metrics",
      );
    } finally {
      setIsRefreshing(false);
    }
  }, [user]);

  useEffect(() => {
    loadProfileMetrics();
  }, [loadProfileMetrics]);

  useFocusEffect(
    useCallback(() => {
      loadProfileMetrics();
    }, [loadProfileMetrics]),
  );

  useEffect(() => {
    if (!user) return;

    let cancelled = false;

    const refreshLocalClock = async () => {
      const snapshot = await buildLocalMetricsSnapshot(user.id);
      if (cancelled) return;

      setLocalClockMs(snapshot.accumulatedClockInTimeMs);
      setHasActiveSession(snapshot.hasActiveSession);

      const nextTodayKey = getTodayDateString();
      if (nextTodayKey !== todayKey) {
        setTodayKey(nextTodayKey);
        loadProfileMetrics();
      }
    };

    refreshLocalClock();

    const interval = setInterval(() => {
      refreshLocalClock();
    }, 60000);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [user, todayKey, loadProfileMetrics]);

  const handleSignOut = () => {
    Alert.alert(
      'Sign Out',
      'Are you sure you want to sign out? If you are clocked in, the app will clock you out first.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Sign Out',
          style: 'destructive',
          onPress: async () => {
            if (!user) return;

            setIsSigningOut(true);

            try {
              await logout({ beforeLogout: clockOutBeforeSignOut });
              router.replace('/');
            } catch (error) {
              logger.error("[Profile] Failed to sign out cleanly:", error);
              Alert.alert(
                "Unable to Sign Out",
                error instanceof Error
                  ? error.message
                  : "Failed to complete sign out. Please try again.",
              );
            } finally {
              setIsSigningOut(false);
            }
          },
        },
      ]
    );
  };

  return (
    <View className="flex-1" style={{ backgroundColor: colors.bg }}>
      <ScrollView className="flex-1 px-6 pt-6">
        <Text className="text-2xl font-bold mb-6" style={{ color: colors.text }}>
          Profile
        </Text>

        <InfoCard label="Name" value={user?.name || "Unknown"} />
        <InfoCard label="Email" value={user?.email || "N/A"} />
        <InfoCard label="Role" value={user?.role || "N/A"} />
        <InfoCard label="Supervisor" value={metrics.supervisor} />

        <View className="flex-row mb-4" style={{ gap: 12 }}>
          <MetricCard label="Tickets On Board" value={String(metrics.ticketsOnBoard)} />
          <MetricCard label="Closed Today" value={String(metrics.closedToday)} />
        </View>

        <View className="flex-row mb-4" style={{ gap: 12 }}>
          <MetricCard label="Utilities Closed" value={String(metrics.totalUtilitiesClosed)} />
          <MetricCard label="Footage Allocated" value={`${metrics.totalFootageAllocated} ft`} />
        </View>

        <View className="flex-row mb-6" style={{ gap: 12 }}>
          <MetricCard label="LPH" value={formatRate(metrics.lph)} />
          <MetricCard label="FPH" value={formatRate(metrics.fph)} />
        </View>

        <InfoCard
          label={hasActiveSession ? "Accumulated Clock In Time (Live Today)" : "Accumulated Clock In Time"}
          value={formatDuration(displayedClockMs)}
        />

        <Pressable
          onPress={loadProfileMetrics}
          disabled={isRefreshing || isSigningOut}
          className="rounded-xl px-4 py-3 mb-4"
          style={{ backgroundColor: colors.primary, opacity: isRefreshing || isSigningOut ? 0.5 : 1 }}
        >
          {isRefreshing ? (
            <ActivityIndicator color={colors.text} />
          ) : (
            <Text className="text-base font-semibold text-center" style={{ color: colors.text }}>
              Refresh Metrics
            </Text>
          )}
        </Pressable>

        {metricsError ? (
          <View className="rounded-xl p-4 mb-4" style={{ backgroundColor: colors.danger + "20" }}>
            <Text style={{ color: colors.danger }}>{metricsError}</Text>
          </View>
        ) : null}

        <Pressable
          onPress={handleSignOut}
          disabled={isSigningOut}
          className="rounded-xl px-4 py-3 mb-4"
          style={{ backgroundColor: colors.danger, opacity: isSigningOut ? 0.5 : 1 }}
        >
          {isSigningOut ? (
            <ActivityIndicator color={colors.text} />
          ) : (
            <Text className="text-base font-semibold text-center" style={{ color: colors.text }}>
              Sign Out (Dev Testing)
            </Text>
          )}
        </Pressable>

        <Text className="text-sm text-center mt-4" style={{ color: colors.muted }}>
          Use sign out to test as different users
        </Text>
      </ScrollView>
    </View>
  );
}
