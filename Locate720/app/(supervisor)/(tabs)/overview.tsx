import { useCallback, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  ScrollView,
  Text,
  View,
} from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";

import { useAuth } from "../../../src/features/auth/AuthContext";
import {
  fetchOpsOverview,
  type OpsOverview,
} from "../../../src/features/ops/api/opsApiClient";
import { colors } from "../../../src/ui/colors";
import { logger } from "../../../src/utils/logger";
import { formatDuration } from "../../../src/utils/formatDuration";
import { getUtilityColor, getUtilityIcon } from "../../../src/features/tickets/utils/ticketPresentation";

function StatCard({
  label,
  value,
  color,
}: {
  label: string;
  value: string;
  color?: string;
}) {
  return (
    <View
      className="rounded-xl p-3 flex-1"
      style={{ backgroundColor: colors.surface }}
    >
      <Text
        className="text-2xl font-bold"
        style={{ color: color || colors.text }}
      >
        {value}
      </Text>
      <Text className="text-xs mt-0.5" style={{ color: colors.muted }}>
        {label}
      </Text>
    </View>
  );
}

function needsAttentionIcon(type: string): string {
  switch (type) {
    case "EMERGENCY":
      return "flash";
    case "NO_RESPONSE":
      return "alert-circle";
    case "break":
      return "cafe";
    default:
      return "warning";
  }
}

export default function OverviewScreen() {
  const { user, token } = useAuth();
  const router = useRouter();
  const [overview, setOverview] = useState<OpsOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadOverview = useCallback(
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
        const data = await fetchOpsOverview(token);
        setOverview(data);
      } catch (e) {
        logger.error("[Supervisor Overview] Failed to load:", e);
        setError(e instanceof Error ? e.message : "Failed to load overview");
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [token],
  );

  useFocusEffect(
    useCallback(() => {
      loadOverview();
    }, [loadOverview]),
  );

  const handleRefresh = () => loadOverview(true);

  if (loading) {
    return (
      <View
        className="flex-1 items-center justify-center"
        style={{ backgroundColor: colors.bg }}
      >
        <ActivityIndicator size="large" color={colors.accent} />
        <Text className="text-sm mt-3" style={{ color: colors.muted }}>
          Loading team overview...
        </Text>
      </View>
    );
  }

  if (error && !overview) {
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
          Failed to load overview
        </Text>
        <Text className="text-sm mt-2 text-center" style={{ color: colors.muted }}>
          {error}
        </Text>
        <Pressable
          onPress={() => loadOverview()}
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

  const techs = overview?.techs;
  const tickets = overview?.tickets;
  const teamSummary = overview?.teamSummary;

  return (
    <ScrollView
      className="flex-1"
      style={{ backgroundColor: colors.bg }}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={handleRefresh} />
      }
    >
      <View className="px-5 pt-6 pb-24">
        <Text className="text-2xl font-bold" style={{ color: colors.text }}>
          Team Overview
        </Text>
        <Text className="text-sm mt-1" style={{ color: colors.muted }}>
          {user?.name}
        </Text>

        {error ? (
          <View
            className="rounded-xl p-3 mt-4"
            style={{ backgroundColor: colors.danger + "15" }}
          >
            <Text className="text-sm" style={{ color: colors.danger }}>
              {error}
            </Text>
          </View>
        ) : null}

        {/* Tech stats grid */}
        {techs ? (
          <>
            <Text
              className="text-xs font-semibold uppercase tracking-wider mt-6 mb-3"
              style={{ color: colors.muted }}
            >
              Techs
            </Text>
            <View className="flex-row" style={{ gap: 10 }}>
              <StatCard
                label="Total Techs"
                value={String(techs.totalTechs)}
                color={colors.text}
              />
              <StatCard
                label="Clocked In"
                value={String(techs.clockedIn)}
                color={colors.success}
              />
            </View>
            <View className="flex-row mt-3" style={{ gap: 10 }}>
              <StatCard
                label="Onsite"
                value={String(techs.onsite)}
                color={colors.accent}
              />
              <StatCard
                label="Enroute"
                value={String(techs.enroute)}
                color={colors.lightBlue}
              />
            </View>
            <View className="flex-row mt-3" style={{ gap: 10 }}>
              <StatCard
                label="Paused"
                value={String(techs.paused)}
                color={colors.warning}
              />
              <StatCard
                label="On Lunch"
                value={String(techs.onLunch)}
                color={colors.warning}
              />
            </View>
          </>
        ) : null}

        {/* Ticket stats */}
        {tickets ? (
          <>
            <Text
              className="text-xs font-semibold uppercase tracking-wider mt-6 mb-3"
              style={{ color: colors.muted }}
            >
              Tickets
            </Text>
            <View className="flex-row flex-wrap" style={{ gap: 10 }}>
              <StatCard
                label="Open"
                value={String(tickets.open)}
                color={colors.text}
              />
              <StatCard
                label="Overdue"
                value={String(tickets.overdue)}
                color={colors.danger}
              />
              <StatCard
                label="Due Soon"
                value={String(tickets.dueSoon)}
                color={colors.warning}
              />
              <StatCard
                label="Completed Today"
                value={String(tickets.completedToday)}
                color={colors.success}
              />
            </View>
          </>
        ) : null}

        {/* Team summary */}
        {teamSummary ? (
          <>
            <Text
              className="text-xs font-semibold uppercase tracking-wider mt-6 mb-3"
              style={{ color: colors.muted }}
            >
              Team Summary
            </Text>
            <View
              className="rounded-2xl p-5"
              style={{ backgroundColor: colors.surface }}
            >
              <View className="flex-row justify-between mb-3">
                <Text className="text-sm flex-1" style={{ color: colors.muted }}>
                  Total Worked
                </Text>
                <Text className="text-sm font-semibold ml-3" style={{ color: colors.text }}>
                  {formatDuration(teamSummary.totalWorkedMinutes * 60 * 1000)}
                </Text>
              </View>
              <View className="flex-row justify-between mb-3">
                <Text className="text-sm flex-1" style={{ color: colors.muted }}>
                  Completed Tickets
                </Text>
                <Text className="text-sm font-semibold ml-3" style={{ color: colors.text }}>
                  {teamSummary.totalCompletedTickets}
                </Text>
              </View>
              <View className="flex-row justify-between mb-3">
                <Text className="text-sm flex-1" style={{ color: colors.muted }}>
                  Total Footage
                </Text>
                <Text className="flex-row ml-3">
                  <Text className="text-sm font-semibold" style={{ color: colors.text }}>
                    {teamSummary.totalFootage.toLocaleString()}
                  </Text>
                  <Text className="text-sm" style={{ color: colors.muted }}> ft</Text>
                </Text>
              </View>
              <View className="flex-row justify-between mb-3">
                <Text className="text-sm flex-1" style={{ color: colors.muted }}>
                  Open Backlog
                </Text>
                <Text className="text-sm font-semibold ml-3" style={{ color: colors.text }}>
                  {teamSummary.openBacklog}
                </Text>
              </View>
              <View className="flex-row justify-between mb-3 pt-3" style={{ borderTopColor: colors.bg, borderTopWidth: 1 }}>
                <Text className="text-sm flex-1" style={{ color: colors.muted }}>
                  Avg LPH (locates/hr)
                </Text>
                <Text className="text-sm font-semibold ml-3" style={{ color: colors.accent }}>
                  {teamSummary.totalWorkedMinutes > 0
                    ? (teamSummary.totalCompletedTickets / (teamSummary.totalWorkedMinutes / 60)).toFixed(1)
                    : "0.0"}
                </Text>
              </View>
              <View className="flex-row justify-between">
                <Text className="text-sm flex-1" style={{ color: colors.muted }}>
                  Avg FPH (ft/hr)
                </Text>
                <Text className="text-sm font-semibold ml-3" style={{ color: colors.accent }}>
                  {teamSummary.totalWorkedMinutes > 0
                    ? (teamSummary.totalFootage / (teamSummary.totalWorkedMinutes / 60)).toFixed(1)
                    : "0.0"}
                </Text>
              </View>
            </View>
          </>
        ) : null}

        {/* Needs attention */}
        {overview?.needsAttention && overview.needsAttention.length > 0 ? (
          <>
            <Text
              className="text-xs font-semibold uppercase tracking-wider mt-6 mb-3"
              style={{ color: colors.muted }}
            >
              Needs Attention
            </Text>
            <FlatList
              data={overview.needsAttention}
              keyExtractor={(item, index) => `${item.type}-${item.id}-${index}`}
              scrollEnabled={false}
              ItemSeparatorComponent={() => <View className="h-2" />}
              renderItem={({ item }) => {
                const isEmergency = item.type === "EMERGENCY";
                const accentColor = isEmergency ? colors.danger : colors.warning;
                return (
                  <Pressable
                    onPress={() =>
                      router.push({
                        pathname: "/(supervisor)/ops-ticket/[id]",
                        params: { id: item.id },
                      })
                    }
                    className="rounded-xl p-4 flex-row items-start"
                    style={{
                      backgroundColor: colors.surface,
                      borderLeftWidth: 4,
                      borderLeftColor: accentColor,
                    }}
                  >
                    <Ionicons
                      name={needsAttentionIcon(item.type) as any}
                      size={20}
                      color={accentColor}
                      style={{ marginRight: 10, marginTop: 2 }}
                    />
                    <View className="flex-1">
                      <View className="flex-row items-center" style={{ gap: 6 }}>
                        <Text
                          className="text-sm font-semibold"
                          style={{ color: colors.text }}
                        >
                          {item.label}
                        </Text>
                        <View
                          className="rounded-full px-2 py-0.5"
                          style={{ backgroundColor: accentColor + "25" }}
                        >
                          <Text
                            className="text-[10px] font-bold uppercase"
                            style={{ color: accentColor }}
                          >
                            {isEmergency ? "Emergency" : "No Response"}
                          </Text>
                        </View>
                      </View>
                      <Text
                        className="text-xs mt-1"
                        style={{ color: colors.muted }}
                      >
                        {item.detail}
                      </Text>
                      {(item.assignedTechName || item.contractor) ? (
                        <View className="flex-row items-center mt-1" style={{ gap: 8 }}>
                          {item.assignedTechName ? (
                            <View className="flex-row items-center" style={{ gap: 3 }}>
                              <Ionicons name="person-outline" size={11} color={colors.muted} />
                              <Text className="text-[11px]" style={{ color: colors.muted }}>
                                {item.assignedTechName}
                              </Text>
                            </View>
                          ) : null}
                          {item.contractor ? (
                            <View className="flex-row items-center" style={{ gap: 3 }}>
                              <Ionicons name="business-outline" size={11} color={colors.muted} />
                              <Text className="text-[11px]" style={{ color: colors.muted }} numberOfLines={1}>
                                {item.contractor}
                              </Text>
                            </View>
                          ) : null}
                        </View>
                      ) : null}
                      {item.customers && item.customers.length > 0 ? (
                        <View className="flex-row items-center mt-1.5" style={{ gap: 4 }}>
                          {item.customers.map((c) => (
                            <View
                              key={c.id}
                              className="w-4 h-4 rounded-full items-center justify-center"
                              style={{ backgroundColor: getUtilityColor(c.utility as any) }}
                            >
                              <Ionicons name={getUtilityIcon(c.utility as any)} size={10} color="#fff" />
                            </View>
                          ))}
                        </View>
                      ) : null}
                    </View>
                    <Ionicons
                      name="chevron-forward"
                      size={18}
                      color={colors.muted}
                      style={{ marginTop: 2 }}
                    />
                  </Pressable>
                );
              }}
            />
          </>
        ) : null}

        {/* Active techs */}
        {overview?.activeTechs && overview.activeTechs.length > 0 ? (
          <>
            <Text
              className="text-xs font-semibold uppercase tracking-wider mt-6 mb-3"
              style={{ color: colors.muted }}
            >
              Active Techs
            </Text>
            <FlatList
              data={overview.activeTechs}
              keyExtractor={(item) => item.id}
              scrollEnabled={false}
              ItemSeparatorComponent={() => <View className="h-2" />}
              renderItem={({ item }) => (
                <View
                  className="rounded-xl p-4"
                  style={{ backgroundColor: colors.surface }}
                >
                  <View className="flex-row items-center justify-between">
                    <Text
                      className="text-sm font-semibold"
                      style={{ color: colors.text }}
                    >
                      {item.name}
                    </Text>
                    <Text className="text-xs" style={{ color: colors.muted }}>
                      {item.timesheetState.replace(/_/g, " ")}
                    </Text>
                  </View>
                  {item.activeTicket ? (
                    <Text
                      className="text-xs mt-1"
                      style={{ color: colors.muted }}
                    >
                      {item.activeTicket.ticketNumber} ·{" "}
                      {item.activeTicket.locatorStatus}
                    </Text>
                  ) : null}
                  <Text className="text-xs mt-1" style={{ color: colors.muted }}>
                    Completed today: {item.today.completedTickets}
                  </Text>
                </View>
              )}
            />
          </>
        ) : null}
      </View>
    </ScrollView>
  );
}
