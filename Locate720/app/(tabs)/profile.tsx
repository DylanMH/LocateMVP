import { useCallback, useEffect, useState } from "react";
import { View, Text, ScrollView, Pressable, Alert, ActivityIndicator } from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import { Q } from "@nozbe/watermelondb";
import { Ionicons } from "@expo/vector-icons";
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
import { formatDuration } from "../../src/utils/formatDuration";

// ── Types ──────────────────────────────────────────────────
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
  allocationType: string | null;
}

// ── Local Metrics ─────────────────────────────────────────
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
        Q.or(Q.where("date", today), Q.where("status", "ACTIVE")),
        Q.sortBy("created_at", Q.desc),
      )
      .fetch(),
  ]);

  let closedToday = 0;
  let totalFootageAllocated = 0;
  let totalUtilitiesClosed = 0;

  for (const ticket of userTickets) {
    if (!ticket.closedAt || ticket.closedAt < todayStartMs) continue;
    closedToday += 1;
    const payload = parseTicketPayload(ticket.payloadJson);
    const markings = payload.customerMarkings || payload.customerMarking || {};
    for (const marking of Object.values(markings) as any[]) {
      if (marking?.completed) totalUtilitiesClosed += 1;
      const footage = parseInt(marking?.footage || "0", 10);
      if (!Number.isNaN(footage)) totalFootageAllocated += footage;
    }
  }

  const ticketsOnBoard = userTickets.filter(
    (t) => t.locatorStatus !== "CLOSED" && t.locatorStatus !== "UNABLE",
  ).length;

  const accumulatedClockInTimeMs = todaySessions.reduce((total, session) => {
    if (!session.clockInAt) return total;
    const endTime =
      session.status === "ACTIVE"
        ? Date.now()
        : session.clockOutAt && session.clockOutAt > session.clockInAt
          ? session.clockOutAt
          : session.clockInAt;
    return total + Math.max(0, endTime - session.clockInAt);
  }, 0);

  const activeSession = todaySessions.find((s) => s.status === "ACTIVE");

  return {
    ticketsOnBoard,
    closedToday,
    totalFootageAllocated,
    totalUtilitiesClosed,
    accumulatedClockInTimeMs,
    hasActiveSession: Boolean(activeSession),
    allocationType: activeSession?.allocationType || null,
  };
}

// ── Formatting ─────────────────────────────────────────────
function formatRate(value: number): string {
  return Number.isFinite(value) ? value.toFixed(1) : "0.0";
}

// ── Mini Components ────────────────────────────────────────
function StatPill({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <View className="items-center flex-1">
      <Text className="text-2xl font-bold" style={{ color: color || colors.text }}>
        {value}
      </Text>
      <Text className="text-xs mt-0.5 text-center" style={{ color: colors.muted }}>
        {label}
      </Text>
    </View>
  );
}

// ── Main Screen ────────────────────────────────────────────
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

  const displayedClockMs = Math.max(metrics.accumulatedClockInTimeMs, localClockMs);

  const clockOutBeforeSignOut = async () => {
    if (!user) return;
    await closeActiveSession({
      userId: user.id,
      endActiveBreak: true,
      requireNoActiveTickets: true,
    });
  };

  const loadProfileMetrics = useCallback(async () => {
    if (!user) return;
    setIsRefreshing(true);
    setMetricsError(null);

    try {
      const fallback = await buildLocalMetricsSnapshot(user.id);
      const fallbackHours = fallback.accumulatedClockInTimeMs / 3600000;

      const response = await fetchWithTimeout(
        `${API_BASE_URL}${ENDPOINTS.users}/${encodeURIComponent(user.id)}/productivity-summary`,
      );

      if (!response.ok) throw new Error(`Failed (${response.status})`);

      const d = await response.json();
      const uClosed = d?.totalUtilitiesClosed ?? fallback.totalUtilitiesClosed;
      const footage = d?.totalFootageAllocated ?? fallback.totalFootageAllocated;
      const clockMs = d?.accumulatedClockInTimeMs ?? fallback.accumulatedClockInTimeMs;
      const workedH = clockMs / 3600000;

      setMetrics({
        supervisor: d?.supervisor || "Not assigned",
        ticketsOnBoard: d?.ticketsOnBoard ?? fallback.ticketsOnBoard,
        closedToday: d?.closedToday ?? fallback.closedToday,
        totalFootageAllocated: footage,
        totalUtilitiesClosed: uClosed,
        lph: d?.lph ?? (fallbackHours > 0 ? uClosed / fallbackHours : 0),
        fph: d?.fph ?? (fallbackHours > 0 ? footage / fallbackHours : 0),
        accumulatedClockInTimeMs: clockMs,
      });
      setLocalClockMs(fallback.accumulatedClockInTimeMs);
      setHasActiveSession(fallback.hasActiveSession);
    } catch (error) {
      logger.error("[Profile] Failed to load metrics:", error);
      const fallback = await buildLocalMetricsSnapshot(user.id);
      const fallbackHours = fallback.accumulatedClockInTimeMs / 3600000;
      setMetrics({
        supervisor: "Not assigned",
        ticketsOnBoard: fallback.ticketsOnBoard,
        closedToday: fallback.closedToday,
        totalFootageAllocated: fallback.totalFootageAllocated,
        totalUtilitiesClosed: fallback.totalUtilitiesClosed,
        lph: fallbackHours > 0 ? fallback.totalUtilitiesClosed / fallbackHours : 0,
        fph: fallbackHours > 0 ? fallback.totalFootageAllocated / fallbackHours : 0,
        accumulatedClockInTimeMs: fallback.accumulatedClockInTimeMs,
      });
      setLocalClockMs(fallback.accumulatedClockInTimeMs);
      setHasActiveSession(fallback.hasActiveSession);
      setMetricsError(error instanceof Error ? `${error.message}. Showing local values.` : "Failed to load metrics");
    } finally {
      setIsRefreshing(false);
    }
  }, [user]);

  useEffect(() => { loadProfileMetrics(); }, [loadProfileMetrics]);
  useFocusEffect(useCallback(() => { loadProfileMetrics(); }, [loadProfileMetrics]));

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    const refresh = async () => {
      const snap = await buildLocalMetricsSnapshot(user.id);
      if (cancelled) return;
      setLocalClockMs(snap.accumulatedClockInTimeMs);
      setHasActiveSession(snap.hasActiveSession);
      const next = getTodayDateString();
      if (next !== todayKey) { setTodayKey(next); loadProfileMetrics(); }
    };
    refresh();
    const iv = setInterval(refresh, 60000);
    return () => { cancelled = true; clearInterval(iv); };
  }, [user, todayKey, loadProfileMetrics]);

  const handleSignOut = () => {
    Alert.alert("Sign Out", "Are you sure? If clocked in, you'll be clocked out first.", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Sign Out", style: "destructive",
        onPress: async () => {
          if (!user) return;
          setIsSigningOut(true);
          try {
            await logout({ beforeLogout: clockOutBeforeSignOut });
            router.replace("/");
          } catch (error) {
            logger.error("[Profile] Sign out failed:", error);
            Alert.alert("Unable to Sign Out", error instanceof Error ? error.message : "Try again.");
          } finally {
            setIsSigningOut(false);
          }
        },
      },
    ]);
  };

  // ── Render ───────────────────────────────────────────────
  return (
    <View className="flex-1" style={{ backgroundColor: colors.bg }}>
      <ScrollView className="flex-1 px-5 pt-6">
        {/* Header */}
        <View className="flex-row items-center justify-between mb-6">
          <Text className="text-2xl font-bold" style={{ color: colors.text }}>Profile</Text>
          {hasActiveSession && (
            <View className="flex-row items-center" style={{ gap: 4 }}>
              <View className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: colors.success }} />
              <Text className="text-sm font-semibold" style={{ color: colors.success }}>On the Clock</Text>
            </View>
          )}
        </View>

        {/* User Identity Card */}
        <View className="rounded-2xl p-5 mb-5" style={{ backgroundColor: colors.surface }}>
          <View className="flex-row items-center mb-3">
            <View className="w-12 h-12 rounded-full items-center justify-center mr-3" style={{ backgroundColor: colors.primary }}>
              <Text className="text-lg font-bold" style={{ color: colors.text }}>
                {(user?.name || "U")[0].toUpperCase()}
              </Text>
            </View>
            <View className="flex-1">
              <Text className="text-lg font-bold" style={{ color: colors.text }}>{user?.name || "Unknown"}</Text>
              <Text className="text-sm" style={{ color: colors.muted }}>{user?.email || "N/A"}</Text>
            </View>
            <View className="rounded-lg px-2.5 py-1" style={{ backgroundColor: colors.primary + "20" }}>
              <Text className="text-xs font-semibold" style={{ color: colors.primary }}>{user?.role || "N/A"}</Text>
            </View>
          </View>
          {metrics.supervisor !== "Not assigned" && (
            <View className="flex-row items-center mt-2 pt-2" style={{ borderTopWidth: 1, borderTopColor: colors.bg, gap: 6 }}>
              <Ionicons name="people" size={14} color={colors.muted} />
              <Text className="text-sm" style={{ color: colors.muted }}>
                Supervisor: <Text style={{ color: colors.text }}>{metrics.supervisor}</Text>
              </Text>
            </View>
          )}
        </View>

        {/* Stats Grid */}
        <View className="rounded-2xl p-5 mb-5" style={{ backgroundColor: colors.surface }}>
          <Text className="text-xs font-semibold uppercase tracking-wider mb-4" style={{ color: colors.muted }}>
            Today's Performance
          </Text>
          <View className="flex-row mb-5" style={{ gap: 12 }}>
            <StatPill label="On Board" value={String(metrics.ticketsOnBoard)} color={colors.accent} />
            <StatPill label="Closed" value={String(metrics.closedToday)} color={colors.success} />
            <StatPill label="Utilities" value={String(metrics.totalUtilitiesClosed)} color={colors.lightBlue} />
          </View>
          <View className="flex-row" style={{ gap: 12 }}>
            <StatPill label="Footage" value={`${metrics.totalFootageAllocated} ft`} />
            <StatPill label="LPH" value={formatRate(metrics.lph)} color={colors.accent} />
            <StatPill label="FPH" value={formatRate(metrics.fph)} color={colors.accent} />
          </View>
        </View>

        {/* Total Clocked Today */}
        <View className="rounded-2xl p-5 mb-5" style={{ backgroundColor: colors.surface }}>
          <View className="flex-row items-center justify-between">
            <View>
              <Text className="text-xs font-semibold uppercase tracking-wider" style={{ color: colors.muted }}>
                Total Clocked Today
              </Text>
              <Text className="text-xl font-bold mt-1" style={{ color: colors.text }}>
                {formatDuration(displayedClockMs)}
              </Text>
            </View>
            <Ionicons name="time-outline" size={28} color={colors.muted} />
          </View>
        </View>

        {/* Error banner */}
        {metricsError ? (
          <View className="rounded-xl p-4 mb-5" style={{ backgroundColor: colors.danger + "15" }}>
            <Text className="text-sm" style={{ color: colors.danger }}>{metricsError}</Text>
          </View>
        ) : null}

        {/* Actions */}
        <Pressable
          onPress={loadProfileMetrics}
          disabled={isRefreshing || isSigningOut}
          className="rounded-xl px-4 py-3.5 mb-3 flex-row items-center justify-center"
          style={{ backgroundColor: colors.primary, opacity: isRefreshing || isSigningOut ? 0.5 : 1, gap: 8 }}
        >
          {isRefreshing ? (
            <ActivityIndicator color={colors.text} />
          ) : (
            <Ionicons name="refresh" size={18} color={colors.text} />
          )}
          <Text className="text-base font-semibold" style={{ color: colors.text }}>Refresh</Text>
        </Pressable>

        <Pressable
          onPress={handleSignOut}
          disabled={isSigningOut}
          className="rounded-xl px-4 py-3.5 mb-10 flex-row items-center justify-center"
          style={{ backgroundColor: colors.danger, opacity: isSigningOut ? 0.5 : 1, gap: 8, minHeight: 48 }}
        >
          <Ionicons name="log-out" size={18} color={colors.text} />
          <Text
            className="text-base font-semibold"
            style={{ color: colors.text, includeFontPadding: false }}
            numberOfLines={1}
          >
            Sign Out
          </Text>
        </Pressable>
      </ScrollView>
    </View>
  );
}
