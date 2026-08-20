import { useCallback, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  Text,
  View,
} from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";

import { useAuth } from "../../src/features/auth/AuthContext";
import {
  fetchOpsTechs,
  type TechOpsSummary,
} from "../../src/features/ops/api/opsApiClient";
import { colors } from "../../src/ui/colors";
import { logger } from "../../src/utils/logger";
import { formatDuration } from "../../src/utils/formatDuration";
import { formatTime } from "../../src/utils/date";

type StatusFilter = "all" | "clocked_in" | "onsite" | "enroute" | "paused";

const FILTERS: { label: string; value: StatusFilter }[] = [
  { label: "All", value: "all" },
  { label: "Clocked In", value: "clocked_in" },
  { label: "Onsite", value: "onsite" },
  { label: "Enroute", value: "enroute" },
  { label: "Paused", value: "paused" },
];

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

function Chip({
  label,
  selected,
  onPress,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      hitSlop={10}
      className="px-4 py-2 rounded-full"
      style={{ backgroundColor: selected ? colors.primary : colors.surface }}
    >
      <Text className="text-xs font-semibold" style={{ color: colors.text }}>
        {label}
      </Text>
    </Pressable>
  );
}

export default function TechsScreen() {
  const { token } = useAuth();
  const router = useRouter();
  const [techs, setTechs] = useState<TechOpsSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");

  const loadTechs = useCallback(
    async (isRefresh = false) => {
      if (!token) {
        setError("Not authenticated");
        setLoading(false);
        return;
      }
      if (isRefresh) setRefreshing(true);
      else setLoading(true);
      setError(null);
      try {
        const statusParam =
          statusFilter === "all" ? undefined : statusFilter;
        const data = await fetchOpsTechs(token, statusParam, 50, 0);
        setTechs(data.techs);
      } catch (e) {
        logger.error("[Supervisor Techs] Failed to load:", e);
        setError(e instanceof Error ? e.message : "Failed to load techs");
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [token, statusFilter],
  );

  useFocusEffect(
    useCallback(() => {
      loadTechs();
    }, [loadTechs]),
  );

  const handleRefresh = () => loadTechs(true);

  if (loading) {
    return (
      <View
        className="flex-1 items-center justify-center"
        style={{ backgroundColor: colors.bg }}
      >
        <ActivityIndicator size="large" color={colors.accent} />
        <Text className="text-sm mt-3" style={{ color: colors.muted }}>
          Loading techs...
        </Text>
      </View>
    );
  }

  if (error && techs.length === 0) {
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
          Failed to load techs
        </Text>
        <Text className="text-sm mt-2 text-center" style={{ color: colors.muted }}>
          {error}
        </Text>
        <Pressable
          onPress={() => loadTechs()}
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

  return (
    <View className="flex-1" style={{ backgroundColor: colors.bg }}>
      <View className="px-4 pt-3 pb-2">
        <View className="flex-row flex-wrap" style={{ gap: 8 }}>
          {FILTERS.map((f) => (
            <Chip
              key={f.value}
              label={f.label}
              selected={statusFilter === f.value}
              onPress={() => setStatusFilter(f.value)}
            />
          ))}
        </View>
      </View>

      {error ? (
        <View
          className="rounded-xl p-3 mx-4 mb-2"
          style={{ backgroundColor: colors.danger + "15" }}
        >
          <Text className="text-sm" style={{ color: colors.danger }}>
            {error}
          </Text>
        </View>
      ) : null}

      <FlatList
        data={techs}
        keyExtractor={(item) => item.id}
        contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 24 }}
        ItemSeparatorComponent={() => <View className="h-3" />}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={handleRefresh} />
        }
        ListEmptyComponent={
          <View className="pt-12 items-center">
            <Text
              className="text-base font-semibold"
              style={{ color: colors.text }}
            >
              No techs found
            </Text>
            <Text className="text-sm mt-2" style={{ color: colors.muted }}>
              Try adjusting filters.
            </Text>
          </View>
        }
        renderItem={({ item }) => (
          <Pressable
            onPress={() =>
              router.push({
                pathname: "/(supervisor)/tech-details/[id]",
                params: { id: item.id },
              })
            }
            className="rounded-2xl p-4"
            style={{ backgroundColor: colors.surface }}
          >
            <View className="flex-row items-center justify-between">
              <View className="flex-1">
                <Text
                  className="text-base font-semibold"
                  style={{ color: colors.text }}
                >
                  {item.name}
                </Text>
                {item.employeeId ? (
                  <Text className="text-xs" style={{ color: colors.muted }}>
                    {item.employeeId}
                  </Text>
                ) : null}
              </View>
              <View
                className="rounded-full px-2.5 py-1"
                style={{
                  backgroundColor: timesheetStateColor(item.timesheetState),
                }}
              >
                <Text
                  className="text-[10px] font-semibold"
                  style={{ color: colors.bg }}
                >
                  {item.timesheetState.replace(/_/g, " ")}
                </Text>
              </View>
            </View>

            {item.activeTicket ? (
              <View className="mt-3 flex-row items-center" style={{ gap: 8 }}>
                <Ionicons name="ticket" size={14} color={colors.accent} />
                <Text
                  className="text-sm font-semibold"
                  style={{ color: colors.text }}
                >
                  {item.activeTicket.ticketNumber}
                </Text>
                <View
                  className="rounded-full px-2 py-0.5"
                  style={{ backgroundColor: colors.primary }}
                >
                  <Text
                    className="text-[10px] font-semibold"
                    style={{ color: colors.text }}
                  >
                    {item.activeTicket.locatorStatus}
                  </Text>
                </View>
              </View>
            ) : null}

            <View className="flex-row mt-3" style={{ gap: 16 }}>
              <View className="flex-row items-center" style={{ gap: 4 }}>
                <Ionicons name="time-outline" size={12} color={colors.muted} />
                <Text className="text-xs" style={{ color: colors.muted }}>
                  {formatDuration(item.today.workedMinutes * 60 * 1000)}
                </Text>
              </View>
              <View className="flex-row items-center" style={{ gap: 4 }}>
                <Ionicons name="checkmark-circle-outline" size={12} color={colors.muted} />
                <Text className="text-xs" style={{ color: colors.muted }}>
                  {item.today.completedTickets} done
                </Text>
              </View>
              <View className="flex-row items-center" style={{ gap: 4 }}>
                <Ionicons name="footsteps" size={12} color={colors.muted} />
                <Text className="text-xs" style={{ color: colors.muted }}>
                  {item.today.footageFeet} ft
                </Text>
              </View>
              <View className="flex-row items-center" style={{ gap: 4 }}>
                <Ionicons name="speedometer-outline" size={12} color={colors.muted} />
                <Text className="text-xs" style={{ color: colors.muted }}>
                  LPH: {item.today.lph.toFixed(1)}
                </Text>
              </View>
              <View className="flex-row items-center" style={{ gap: 4 }}>
                <Ionicons name="trending-up-outline" size={12} color={colors.muted} />
                <Text className="text-xs" style={{ color: colors.muted }}>
                  FPH: {item.today.fph.toFixed(1)}
                </Text>
              </View>
            </View>

            <View className="flex-row mt-2" style={{ gap: 8 }}>
              <View
                className="rounded-full px-2 py-0.5"
                style={{ backgroundColor: colors.bg }}
              >
                <Text className="text-[10px]" style={{ color: colors.muted }}>
                  Open: {item.assigned.open}
                </Text>
              </View>
              {item.assigned.overdue > 0 ? (
                <View
                  className="rounded-full px-2 py-0.5"
                  style={{ backgroundColor: colors.danger + "30" }}
                >
                  <Text className="text-[10px]" style={{ color: colors.danger }}>
                    Overdue: {item.assigned.overdue}
                  </Text>
                </View>
              ) : null}
              {item.assigned.dueSoon > 0 ? (
                <View
                  className="rounded-full px-2 py-0.5"
                  style={{ backgroundColor: colors.warning + "30" }}
                >
                  <Text className="text-[10px]" style={{ color: colors.warning }}>
                    Due soon: {item.assigned.dueSoon}
                  </Text>
                </View>
              ) : null}
            </View>

            {item.lastActivityAt ? (
              <Text className="text-[10px] mt-2" style={{ color: colors.muted }}>
                Last activity: {formatTime(item.lastActivityAt)}
              </Text>
            ) : null}
          </Pressable>
        )}
      />
    </View>
  );
}
