import { useCallback, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  Text,
  View,
} from "react-native";
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";

import { useAuth } from "../../../src/features/auth/AuthContext";
import {
  fetchOpsTechs,
  type TechOpsSummary,
  DUE_URGENCY_COLORS,
  DUE_URGENCY_LABELS,
} from "../../../src/features/ops/api/opsApiClient";
import { colors } from "../../../src/ui/colors";
import { logger } from "../../../src/utils/logger";
import { formatDuration } from "../../../src/utils/formatDuration";
import { formatDueDateTime } from "../../../src/utils/date";

function timesheetStateColor(state: string): string {
  switch (state) {
    case "CLOCKED_IN":
      return colors.success;
    case "ON_LUNCH":
    case "ON_PERSONAL":
      return colors.warning;
    case "CLOCKED_OUT":
    default:
      return colors.danger;
  }
}

function StatRow({ label, value }: { label: string; value: string }) {
  return (
    <View className="flex-row justify-between py-2">
      <Text className="text-sm" style={{ color: colors.muted }}>
        {label}
      </Text>
      <Text className="text-sm font-semibold" style={{ color: colors.text }}>
        {value}
      </Text>
    </View>
  );
}

export default function TechDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { token } = useAuth();
  const router = useRouter();
  const [tech, setTech] = useState<TechOpsSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadTech = useCallback(
    async (isRefresh = false) => {
      if (!token || !id) {
        setError("Not authenticated");
        setLoading(false);
        return;
      }
      if (isRefresh) setRefreshing(true);
      else setLoading(true);
      setError(null);
      try {
        const data = await fetchOpsTechs(token, undefined, 200, 0);
        const found = data.techs.find((t) => t.id === id);
        if (!found) {
          setError("Tech not found");
        } else {
          setTech(found);
        }
      } catch (e) {
        logger.error("[Supervisor TechDetail] Failed to load:", e);
        setError(e instanceof Error ? e.message : "Failed to load tech");
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [token, id],
  );

  useFocusEffect(
    useCallback(() => {
      loadTech();
    }, [loadTech]),
  );

  const handleRefresh = () => loadTech(true);

  if (loading) {
    return (
      <View
        className="flex-1 items-center justify-center"
        style={{ backgroundColor: colors.bg }}
      >
        <ActivityIndicator size="large" color={colors.accent} />
        <Text className="text-sm mt-3" style={{ color: colors.muted }}>
          Loading tech details...
        </Text>
      </View>
    );
  }

  if (error && !tech) {
    return (
      <View
        className="flex-1 items-center justify-center px-5"
        style={{ backgroundColor: colors.bg }}
      >
        <Ionicons name="cloud-offline" size={48} color={colors.danger} />
        <Text
          className="text-base font-semibold mt-4"
          style={{ color: colors.text }}
        >
          Failed to load tech
        </Text>
        <Text className="text-sm mt-2 text-center" style={{ color: colors.muted }}>
          {error}
        </Text>
        <Pressable
          onPress={() => loadTech()}
          className="mt-4 rounded-xl px-5 py-3"
          style={{ backgroundColor: colors.primary }}
        >
          <Text className="text-sm font-semibold" style={{ color: colors.text }}>
            Retry
          </Text>
        </Pressable>
      </View>
    );
  }

  if (!tech) return null;

  const stateColor = timesheetStateColor(tech.timesheetState);

  return (
    <ScrollView
      className="flex-1"
      style={{ backgroundColor: colors.bg }}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={handleRefresh} />
      }
    >
      <View className="px-5 pt-6 pb-24">
        {/* Header */}
        <View className="flex-row items-center mb-6">
          <Pressable onPress={() => router.back()} hitSlop={10}>
            <Ionicons name="arrow-back" size={24} color={colors.text} />
          </Pressable>
          <View className="ml-3 flex-1">
            <Text className="text-xl font-bold" style={{ color: colors.text }}>
              {tech.name}
            </Text>
            {tech.employeeId ? (
              <Text className="text-sm" style={{ color: colors.muted }}>
                {tech.employeeId}
              </Text>
            ) : null}
          </View>
        </View>

        {/* Current state card */}
        <View
          className="rounded-2xl p-5 mb-4"
          style={{ backgroundColor: colors.surface }}
        >
          <Text
            className="text-xs font-semibold uppercase tracking-wider mb-3"
            style={{ color: colors.muted }}
          >
            Current State
          </Text>
          <View className="flex-row items-center mb-3">
            <View
              className="rounded-full px-3 py-1"
              style={{ backgroundColor: stateColor }}
            >
              <Text
                className="text-xs font-semibold"
                style={{ color: colors.bg }}
              >
                {tech.timesheetState.replace(/_/g, " ")}
              </Text>
            </View>
          </View>

          {tech.activeTicket ? (
            <View
              className="rounded-xl p-4 mt-2"
              style={{ backgroundColor: colors.bg }}
            >
              <View className="flex-row items-center" style={{ gap: 8 }}>
                <Ionicons name="ticket" size={16} color={colors.accent} />
                <Text
                  className="text-sm font-bold"
                  style={{ color: colors.text }}
                >
                  {tech.activeTicket.ticketNumber}
                </Text>
              </View>
              {tech.activeTicket.address ? (
                <Text
                  className="text-sm mt-2"
                  style={{ color: colors.muted }}
                  numberOfLines={2}
                >
                  {tech.activeTicket.address}
                </Text>
              ) : null}
              <View className="flex-row items-center mt-2" style={{ gap: 8 }}>
                <View
                  className="rounded-full px-2 py-0.5"
                  style={{ backgroundColor: colors.primary }}
                >
                  <Text
                    className="text-[10px] font-semibold"
                    style={{ color: colors.text }}
                  >
                    {tech.activeTicket.locatorStatus}
                  </Text>
                </View>
                {tech.activeTicket.dueUrgency ? (
                  <View
                    className="rounded-full px-2 py-0.5"
                    style={{
                      backgroundColor:
                        DUE_URGENCY_COLORS[tech.activeTicket.dueUrgency] +
                        "30",
                    }}
                  >
                    <Text
                      className="text-[10px] font-semibold"
                      style={{
                        color: DUE_URGENCY_COLORS[tech.activeTicket.dueUrgency],
                      }}
                    >
                      {DUE_URGENCY_LABELS[tech.activeTicket.dueUrgency]}
                    </Text>
                  </View>
                ) : null}
              </View>
              {tech.activeTicket.dueAt ? (
                <Text
                  className="text-xs mt-2"
                  style={{ color: colors.muted }}
                >
                  Due: {formatDueDateTime(tech.activeTicket.dueAt)}
                </Text>
              ) : null}
            </View>
          ) : (
            <Text className="text-sm" style={{ color: colors.muted }}>
              No active ticket
            </Text>
          )}
        </View>

        {/* Today stats */}
        <View
          className="rounded-2xl p-5 mb-4"
          style={{ backgroundColor: colors.surface }}
        >
          <Text
            className="text-xs font-semibold uppercase tracking-wider mb-3"
            style={{ color: colors.muted }}
          >
            Today
          </Text>
          <StatRow
            label="Worked"
            value={formatDuration(tech.today.workedMinutes * 60 * 1000)}
          />
          <StatRow
            label="Completed Tickets"
            value={String(tech.today.completedTickets)}
          />
          <StatRow label="Footage" value={`${tech.today.footageFeet} ft`} />
        </View>

        {/* Assigned counts */}
        <View
          className="rounded-2xl p-5 mb-4"
          style={{ backgroundColor: colors.surface }}
        >
          <Text
            className="text-xs font-semibold uppercase tracking-wider mb-3"
            style={{ color: colors.muted }}
          >
            Assigned Tickets
          </Text>
          <StatRow label="Open" value={String(tech.assigned.open)} />
          <StatRow label="Overdue" value={String(tech.assigned.overdue)} />
          <StatRow label="Due Soon" value={String(tech.assigned.dueSoon)} />
        </View>

        {tech.lastActivityAt ? (
          <Text className="text-xs text-center" style={{ color: colors.muted }}>
            Last activity: {formatDueDateTime(tech.lastActivityAt)}
          </Text>
        ) : null}
      </View>
    </ScrollView>
  );
}
