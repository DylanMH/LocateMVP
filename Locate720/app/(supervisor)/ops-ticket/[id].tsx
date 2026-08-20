import { useCallback, useState } from "react";
import {
  ActivityIndicator,
  Linking,
  Modal,
  Pressable,
  RefreshControl,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";

import { useAuth } from "../../../src/features/auth/AuthContext";
import {
  fetchOpsTicketDetail,
  fetchOpsTechs,
  assignOpsTicket,
  rescheduleOpsTicket,
  type OpsTicketDetail,
  type TechOpsSummary,
  DUE_URGENCY_COLORS,
  DUE_URGENCY_LABELS,
} from "../../../src/features/ops/api/opsApiClient";
import { colors } from "../../../src/ui/colors";
import { logger } from "../../../src/utils/logger";
import { formatDuration } from "../../../src/utils/formatDuration";
import { formatDueDateTime } from "../../../src/utils/date";
import { getUtilityColor, getUtilityIcon } from "../../../src/features/tickets/utils/ticketPresentation";

const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const DAYS = Array.from({ length: 31 }, (_, i) => i + 1);
const thisYear = new Date().getFullYear();
const YEARS = [thisYear, thisYear + 1];
const HOURS = Array.from({ length: 24 }, (_, i) => i);
const MINUTES = [0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55];

function StatRow({ label, value }: { label: string; value: string }) {
  return (
    <View className="flex-row justify-between py-2">
      <Text className="text-sm" style={{ color: colors.muted }}>
        {label}
      </Text>
      <Text
        className="text-sm font-semibold flex-1 text-right ml-3"
        style={{ color: colors.text }}
        numberOfLines={2}
      >
        {value}
      </Text>
    </View>
  );
}

export default function OpsTicketDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { token } = useAuth();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [ticket, setTicket] = useState<OpsTicketDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [rescheduleVisible, setRescheduleVisible] = useState(false);
  const [reassignVisible, setReassignVisible] = useState(false);
  const [techs, setTechs] = useState<TechOpsSummary[]>([]);
  const [techsLoading, setTechsLoading] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);

  // Reschedule picker state
  const [customYear, setCustomYear] = useState<number>(new Date().getFullYear());
  const [customMonth, setCustomMonth] = useState<number>(new Date().getMonth());
  const [customDay, setCustomDay] = useState<number>(new Date().getDate());
  const [customHour, setCustomHour] = useState<number>(12);
  const [customMinute, setCustomMinute] = useState<number>(0);
  const [reason, setReason] = useState("");

  const loadTicket = useCallback(
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
        const data = await fetchOpsTicketDetail(token, id);
        setTicket(data);
      } catch (e) {
        logger.error("[OpsTicketDetail] Failed to load:", e);
        setError(e instanceof Error ? e.message : "Failed to load ticket");
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [token, id],
  );

  useFocusEffect(
    useCallback(() => {
      loadTicket();
    }, [loadTicket]),
  );

  const handleRefresh = () => loadTicket(true);

  const handleOpenReassign = async () => {
    if (!token) return;
    setReassignVisible(true);
    setTechsLoading(true);
    try {
      const data = await fetchOpsTechs(token, undefined, 200, 0);
      setTechs(data.techs);
    } catch (e) {
      logger.error("[OpsTicketDetail] Failed to load techs for reassign:", e);
    } finally {
      setTechsLoading(false);
    }
  };

  const handleAssign = async (techId: string | null) => {
    if (!token || !id) return;
    setActionLoading(true);
    try {
      await assignOpsTicket(token, id, techId);
      setReassignVisible(false);
      await loadTicket(true);
    } catch (e) {
      logger.error("[OpsTicketDetail] Failed to assign:", e);
      setError(e instanceof Error ? e.message : "Failed to assign ticket");
    } finally {
      setActionLoading(false);
    }
  };

  const handleReschedule = async () => {
    if (!token || !id) return;
    const newDueAt = new Date(
      customYear,
      customMonth,
      customDay,
      customHour,
      customMinute,
      0,
      0,
    ).getTime();
    setActionLoading(true);
    try {
      await rescheduleOpsTicket(token, id, newDueAt, reason.trim() || undefined);
      setRescheduleVisible(false);
      setReason("");
      await loadTicket(true);
    } catch (e) {
      logger.error("[OpsTicketDetail] Failed to reschedule:", e);
      setError(e instanceof Error ? e.message : "Failed to reschedule ticket");
    } finally {
      setActionLoading(false);
    }
  };

  if (loading) {
    return (
      <View
        className="flex-1 items-center justify-center"
        style={{ backgroundColor: colors.bg }}
      >
        <ActivityIndicator size="large" color={colors.accent} />
        <Text className="text-sm mt-3" style={{ color: colors.muted }}>
          Loading ticket...
        </Text>
      </View>
    );
  }

  if (error && !ticket) {
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
          Failed to load ticket
        </Text>
        <Text className="text-sm mt-2 text-center" style={{ color: colors.muted }}>
          {error}
        </Text>
        <Pressable
          onPress={() => loadTicket()}
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

  if (!ticket) return null;

  const recentEvents = ticket.events.slice(-5).reverse();

  return (
    <View className="flex-1" style={{ backgroundColor: colors.bg }}>
      <ScrollView
        className="flex-1"
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={handleRefresh} />
        }
      >
        <View className="px-5 pb-32" style={{ paddingTop: insets.top + 8 }}>
          {/* Header */}
          <View className="flex-row items-center mb-6">
            <Pressable
              onPress={() => {
                if (router.canGoBack()) {
                  router.back();
                } else {
                  router.replace("/(supervisor)/(tabs)/overview" as any);
                }
              }}
              hitSlop={10}
            >
              <Ionicons name="arrow-back" size={24} color={colors.text} />
            </Pressable>
            <View className="ml-3 flex-1">
              <Text
                className="text-xl font-bold"
                style={{ color: colors.text }}
              >
                {ticket.ticketNumber}
              </Text>
              <Text
                className="text-sm mt-1"
                style={{ color: colors.muted }}
                numberOfLines={2}
              >
                {ticket.address}
              </Text>
            </View>
          </View>

          {error ? (
            <View
              className="rounded-xl p-3 mb-4"
              style={{ backgroundColor: colors.danger + "15" }}
            >
              <Text className="text-sm" style={{ color: colors.danger }}>
                {error}
              </Text>
            </View>
          ) : null}

          {/* Badges row */}
          <View className="flex-row flex-wrap mb-4" style={{ gap: 8 }}>
            <View
              className="rounded-full px-3 py-1"
              style={{ backgroundColor: colors.primary }}
            >
              <Text
                className="text-xs font-semibold"
                style={{ color: colors.text }}
              >
                {ticket.ticketType}
              </Text>
            </View>
            <View
              className="rounded-full px-3 py-1"
              style={{ backgroundColor: colors.accent + "30" }}
            >
              <Text
                className="text-xs font-semibold"
                style={{ color: colors.accent }}
              >
                {ticket.locatorStatus}
              </Text>
            </View>
            {ticket.dueUrgency ? (
              <View
                className="rounded-full px-3 py-1"
                style={{
                  backgroundColor:
                    DUE_URGENCY_COLORS[ticket.dueUrgency] + "30",
                }}
              >
                <Text
                  className="text-xs font-semibold"
                  style={{ color: DUE_URGENCY_COLORS[ticket.dueUrgency] }}
                >
                  {DUE_URGENCY_LABELS[ticket.dueUrgency]}
                </Text>
              </View>
            ) : null}
            <View
              className="rounded-full px-3 py-1"
              style={{ backgroundColor: colors.bg }}
            >
              <Text
                className="text-xs font-semibold"
                style={{ color: colors.muted }}
              >
                {ticket.priority}
              </Text>
            </View>
          </View>

          {/* Due date and assigned tech */}
          <View
            className="rounded-2xl p-5 mb-4"
            style={{ backgroundColor: colors.surface }}
          >
            <StatRow
              label="Due"
              value={formatDueDateTime(ticket.dueAt)}
            />
            {ticket.originalDueAt ? (
              <StatRow
                label="Original Due"
                value={formatDueDateTime(ticket.originalDueAt)}
              />
            ) : null}
            {ticket.rescheduleCount !== undefined ? (
              <StatRow
                label="Reschedules"
                value={String(ticket.rescheduleCount)}
              />
            ) : null}
            <StatRow
              label="Assigned Tech"
              value={ticket.assignedTech?.name || "Unassigned"}
            />
            <StatRow
              label="Created"
              value={formatDueDateTime(ticket.createdAt)}
            />
            {ticket.closedAt ? (
              <StatRow
                label="Closed"
                value={formatDueDateTime(ticket.closedAt)}
              />
            ) : null}
          </View>

          {/* Time allocation */}
          <View
            className="rounded-2xl p-5 mb-4"
            style={{ backgroundColor: colors.surface }}
          >
            <Text
              className="text-xs font-semibold uppercase tracking-wider mb-3"
              style={{ color: colors.muted }}
            >
              Time Allocation
            </Text>
            <StatRow
              label="Enroute"
              value={formatDuration(ticket.timeAllocation.enrouteMs)}
            />
            <StatRow
              label="Onsite"
              value={formatDuration(ticket.timeAllocation.onsiteMs)}
            />
            <StatRow
              label="Paused"
              value={formatDuration(ticket.timeAllocation.pausedMs)}
            />
            <StatRow
              label="Total"
              value={formatDuration(ticket.timeAllocation.totalMs)}
            />
          </View>

          {/* Customers */}
          {ticket.customers.length > 0 ? (
            <View
              className="rounded-2xl p-5 mb-4"
              style={{ backgroundColor: colors.surface }}
            >
              <Text
                className="text-xs font-semibold uppercase tracking-wider mb-3"
                style={{ color: colors.muted }}
              >
                Customers
              </Text>
              {ticket.customers.map((c, idx) => (
                <View
                  key={c.customerId + idx}
                  className="rounded-xl p-3 mb-2"
                  style={{ backgroundColor: colors.bg }}
                >
                  <View className="flex-row items-center justify-between">
                    <View className="flex-row items-center flex-1" style={{ gap: 8 }}>
                      <View
                        className="w-6 h-6 rounded-full items-center justify-center"
                        style={{ backgroundColor: getUtilityColor((c.utilityType || "UNKNOWN") as any) }}
                      >
                        <Ionicons name={getUtilityIcon((c.utilityType || "UNKNOWN") as any)} size={14} color="#fff" />
                      </View>
                      <Text
                        className="text-sm font-semibold flex-1"
                        style={{ color: colors.text }}
                        numberOfLines={1}
                      >
                        {c.customerName || c.customerId}
                      </Text>
                    </View>
                    {c.completed ? (
                      <View className="rounded-full px-2 py-0.5" style={{ backgroundColor: colors.success + "25" }}>
                        <Text className="text-[10px] font-bold" style={{ color: colors.success }}>DONE</Text>
                      </View>
                    ) : c.status ? (
                      <View className="rounded-full px-2 py-0.5" style={{ backgroundColor: colors.warning + "25" }}>
                        <Text className="text-[10px] font-bold" style={{ color: colors.warning }}>{c.status}</Text>
                      </View>
                    ) : null}
                  </View>
                  <View className="flex-row flex-wrap mt-2" style={{ gap: 12 }}>
                    {c.result ? (
                      <View className="flex-row items-center" style={{ gap: 4 }}>
                        <Text className="text-[10px] uppercase" style={{ color: colors.muted }}>Result</Text>
                        <Text className="text-xs font-semibold" style={{ color: colors.text }}>{c.result}</Text>
                      </View>
                    ) : null}
                    {c.minutes && c.minutes !== "0" ? (
                      <View className="flex-row items-center" style={{ gap: 4 }}>
                        <Ionicons name="time-outline" size={12} color={colors.muted} />
                        <Text className="text-xs font-semibold" style={{ color: colors.text }}>{c.minutes}m</Text>
                      </View>
                    ) : null}
                    {c.footage && c.footage !== "0" ? (
                      <View className="flex-row items-center" style={{ gap: 4 }}>
                        <Ionicons name="footsteps" size={12} color={colors.muted} />
                        <Text className="text-xs font-semibold" style={{ color: colors.text }}>{c.footage}ft</Text>
                      </View>
                    ) : null}
                  </View>
                  {c.notes ? (
                    <Text className="text-xs mt-2" style={{ color: colors.muted }}>
                      {c.notes}
                    </Text>
                  ) : null}
                </View>
              ))}
            </View>
          ) : null}

          {/* Contractor */}
          {(ticket.contractor || ticket.contractorPhone || ticket.contactName || ticket.contactEmail) ? (
            <View
              className="rounded-2xl p-5 mb-4"
              style={{ backgroundColor: colors.surface }}
            >
              <Text
                className="text-xs font-semibold uppercase tracking-wider mb-3"
                style={{ color: colors.muted }}
              >
                Contractor
              </Text>
              {ticket.contractor ? (
                <View className="flex-row items-center mb-2" style={{ gap: 8 }}>
                  <Ionicons name="business-outline" size={16} color={colors.muted} />
                  <Text className="text-sm" style={{ color: colors.text }}>
                    {ticket.contractor}
                  </Text>
                </View>
              ) : null}
              {ticket.contractorPhone ? (
                <View className="flex-row items-center mb-2" style={{ gap: 8 }}>
                  <Ionicons name="call-outline" size={16} color={colors.muted} />
                  <Text className="text-sm" style={{ color: colors.accent }}>
                    {ticket.contractorPhone}
                  </Text>
                </View>
              ) : null}
              {ticket.contactName ? (
                <View className="flex-row items-center mb-2" style={{ gap: 8 }}>
                  <Ionicons name="person-outline" size={16} color={colors.muted} />
                  <Text className="text-sm" style={{ color: colors.text }}>
                    {ticket.contactName}
                  </Text>
                </View>
              ) : null}
              {ticket.contactEmail ? (
                <Pressable
                  onPress={() => {
                    const subject = encodeURIComponent(`Ticket ${ticket.ticketNumber}`);
                    Linking.openURL(`mailto:${ticket.contactEmail}?subject=${subject}`);
                  }}
                  hitSlop={8}
                >
                  <View className="flex-row items-center mb-2" style={{ gap: 8 }}>
                    <Ionicons name="mail-outline" size={16} color={colors.muted} />
                    <Text className="text-sm" style={{ color: colors.accent, textDecorationLine: "underline" }}>
                      {ticket.contactEmail}
                    </Text>
                  </View>
                </Pressable>
              ) : null}
            </View>
          ) : null}

          {/* Notes */}
          {ticket.notes.length > 0 ? (
            <View
              className="rounded-2xl p-5 mb-4"
              style={{ backgroundColor: colors.surface }}
            >
              <Text
                className="text-xs font-semibold uppercase tracking-wider mb-3"
                style={{ color: colors.muted }}
              >
                Notes
              </Text>
              {ticket.notes.map((note) => (
                <View
                  key={note.id}
                  className="rounded-xl p-3 mb-2"
                  style={{ backgroundColor: colors.bg }}
                >
                  <View className="flex-row items-center justify-between">
                    <Text
                      className="text-xs font-semibold"
                      style={{ color: colors.text }}
                    >
                      {note.author_name || "Unknown"}
                    </Text>
                    <Text className="text-xs" style={{ color: colors.muted }}>
                      {formatDueDateTime(note.created_at)}
                    </Text>
                  </View>
                  <Text
                    className="text-sm mt-1"
                    style={{ color: colors.muted }}
                  >
                    {note.body}
                  </Text>
                </View>
              ))}
            </View>
          ) : null}

          {/* Recent events */}
          {recentEvents.length > 0 ? (
            <View
              className="rounded-2xl p-5 mb-4"
              style={{ backgroundColor: colors.surface }}
            >
              <Text
                className="text-xs font-semibold uppercase tracking-wider mb-3"
                style={{ color: colors.muted }}
              >
                Recent Events
              </Text>
              {recentEvents.map((event) => (
                <View
                  key={event.id}
                  className="rounded-xl p-3 mb-2"
                  style={{ backgroundColor: colors.bg }}
                >
                  <View className="flex-row items-center justify-between">
                    <Text
                      className="text-xs font-semibold"
                      style={{ color: colors.text }}
                    >
                      {event.type}
                    </Text>
                    <Text className="text-xs" style={{ color: colors.muted }}>
                      {formatDueDateTime(event.createdAt)}
                    </Text>
                  </View>
                  {event.oldStatus || event.newStatus ? (
                    <Text
                      className="text-xs mt-1"
                      style={{ color: colors.muted }}
                    >
                      {event.oldStatus || "—"} → {event.newStatus || "—"}
                    </Text>
                  ) : null}
                  {event.oldLocatorStatus || event.newLocatorStatus ? (
                    <Text
                      className="text-xs mt-1"
                      style={{ color: colors.muted }}
                    >
                      {event.oldLocatorStatus || "—"} →{" "}
                      {event.newLocatorStatus || "—"}
                    </Text>
                  ) : null}
                  {event.notes ? (
                    <Text
                      className="text-xs mt-1"
                      style={{ color: colors.muted }}
                    >
                      {event.notes}
                    </Text>
                  ) : null}
                </View>
              ))}
            </View>
          ) : null}
        </View>
      </ScrollView>

      {/* Sticky action footer */}
      <View
        className="flex-row px-5 pt-3 pb-6"
        style={{
          backgroundColor: colors.surface,
          borderTopColor: colors.bg,
          borderTopWidth: 1,
          gap: 12,
        }}
      >
        <Pressable
          onPress={() => {
            const now = new Date();
            setCustomYear(now.getFullYear());
            setCustomMonth(now.getMonth());
            setCustomDay(now.getDate());
            setCustomHour(12);
            setCustomMinute(0);
            setReason("");
            setRescheduleVisible(true);
          }}
          className="flex-1 rounded-xl py-3 items-center"
          style={{ backgroundColor: colors.primary }}
        >
          <View className="flex-row items-center" style={{ gap: 6 }}>
            <Ionicons name="calendar-outline" size={18} color={colors.text} />
            <Text
              className="text-sm font-semibold"
              style={{ color: colors.text }}
            >
              Reschedule
            </Text>
          </View>
        </Pressable>
        <Pressable
          onPress={handleOpenReassign}
          className="flex-1 rounded-xl py-3 items-center"
          style={{ backgroundColor: colors.accent + "30" }}
        >
          <View className="flex-row items-center" style={{ gap: 6 }}>
            <Ionicons name="people-outline" size={18} color={colors.accent} />
            <Text
              className="text-sm font-semibold"
              style={{ color: colors.accent }}
            >
              Reassign
            </Text>
          </View>
        </Pressable>
      </View>

      {/* Reschedule modal */}
      <Modal
        visible={rescheduleVisible}
        animationType="slide"
        transparent={true}
        onRequestClose={() => setRescheduleVisible(false)}
      >
        <View
          className="flex-1 justify-end"
          style={{ backgroundColor: "rgba(0,0,0,0.5)" }}
        >
          <View
            className="rounded-t-3xl"
            style={{ backgroundColor: colors.surface, maxHeight: "90%" }}
          >
            <View className="flex-row items-center justify-between px-5 pt-5 pb-3">
              <Text
                className="text-lg font-bold"
                style={{ color: colors.text }}
              >
                Reschedule
              </Text>
              <Pressable
                onPress={() => setRescheduleVisible(false)}
                hitSlop={12}
              >
                <Text className="text-base" style={{ color: colors.muted }}>
                  Cancel
                </Text>
              </Pressable>
            </View>

            <ScrollView
              className="px-5 pb-5"
              showsVerticalScrollIndicator={false}
            >
              <Text
                className="text-xs font-semibold mb-1"
                style={{ color: colors.muted }}
              >
                Ticket
              </Text>
              <Text className="text-sm" style={{ color: colors.text }}>
                {ticket.ticketNumber}
              </Text>
              <Text
                className="text-xs mt-1"
                style={{ color: colors.muted }}
              >
                Current due: {formatDueDateTime(ticket.dueAt)}
              </Text>

              <Text
                className="text-sm font-semibold mt-4 mb-2"
                style={{ color: colors.text }}
              >
                Date
              </Text>
              <View className="flex-row" style={{ gap: 6 }}>
                <View className="flex-1">
                  <Text
                    className="text-[10px] mb-1"
                    style={{ color: colors.muted }}
                  >
                    Month
                  </Text>
                  <ScrollView
                    style={{
                      maxHeight: 120,
                      backgroundColor: colors.bg,
                      borderRadius: 8,
                    }}
                    showsVerticalScrollIndicator={false}
                  >
                    {MONTH_NAMES.map((m, idx) => (
                      <Pressable
                        key={idx}
                        onPress={() => setCustomMonth(idx)}
                        className="py-1.5 px-2"
                        style={{
                          backgroundColor:
                            idx === customMonth
                              ? colors.primary
                              : "transparent",
                          borderRadius: 4,
                        }}
                      >
                        <Text
                          className="text-xs text-center"
                          style={{
                            color:
                              idx === customMonth ? "#fff" : colors.text,
                          }}
                        >
                          {m}
                        </Text>
                      </Pressable>
                    ))}
                  </ScrollView>
                </View>
                <View style={{ width: 50 }}>
                  <Text
                    className="text-[10px] mb-1"
                    style={{ color: colors.muted }}
                  >
                    Day
                  </Text>
                  <ScrollView
                    style={{
                      maxHeight: 120,
                      backgroundColor: colors.bg,
                      borderRadius: 8,
                    }}
                    showsVerticalScrollIndicator={false}
                  >
                    {DAYS.map((d) => (
                      <Pressable
                        key={d}
                        onPress={() => setCustomDay(d)}
                        className="py-1.5 px-2"
                        style={{
                          backgroundColor:
                            d === customDay
                              ? colors.primary
                              : "transparent",
                          borderRadius: 4,
                        }}
                      >
                        <Text
                          className="text-xs text-center"
                          style={{
                            color: d === customDay ? "#fff" : colors.text,
                          }}
                        >
                          {d}
                        </Text>
                      </Pressable>
                    ))}
                  </ScrollView>
                </View>
                <View style={{ width: 60 }}>
                  <Text
                    className="text-[10px] mb-1"
                    style={{ color: colors.muted }}
                  >
                    Year
                  </Text>
                  <ScrollView
                    style={{
                      maxHeight: 120,
                      backgroundColor: colors.bg,
                      borderRadius: 8,
                    }}
                    showsVerticalScrollIndicator={false}
                  >
                    {YEARS.map((y) => (
                      <Pressable
                        key={y}
                        onPress={() => setCustomYear(y)}
                        className="py-1.5 px-2"
                        style={{
                          backgroundColor:
                            y === customYear
                              ? colors.primary
                              : "transparent",
                          borderRadius: 4,
                        }}
                      >
                        <Text
                          className="text-xs text-center"
                          style={{
                            color: y === customYear ? "#fff" : colors.text,
                          }}
                        >
                          {y}
                        </Text>
                      </Pressable>
                    ))}
                  </ScrollView>
                </View>
              </View>

              <Text
                className="text-sm font-semibold mt-4 mb-2"
                style={{ color: colors.text }}
              >
                Time
              </Text>
              <View className="flex-row items-center" style={{ gap: 6 }}>
                <View style={{ width: 50 }}>
                  <Text
                    className="text-[10px] mb-1"
                    style={{ color: colors.muted }}
                  >
                    Hour
                  </Text>
                  <ScrollView
                    style={{
                      maxHeight: 120,
                      backgroundColor: colors.bg,
                      borderRadius: 8,
                    }}
                    showsVerticalScrollIndicator={false}
                  >
                    {HOURS.map((h) => (
                      <Pressable
                        key={h}
                        onPress={() => setCustomHour(h)}
                        className="py-1.5 px-2"
                        style={{
                          backgroundColor:
                            h === customHour
                              ? colors.primary
                              : "transparent",
                          borderRadius: 4,
                        }}
                      >
                        <Text
                          className="text-xs text-center"
                          style={{
                            color: h === customHour ? "#fff" : colors.text,
                          }}
                        >
                          {String(h).padStart(2, "0")}
                        </Text>
                      </Pressable>
                    ))}
                  </ScrollView>
                </View>
                <Text
                  className="text-lg font-bold"
                  style={{ color: colors.text }}
                >
                  :
                </Text>
                <View style={{ width: 50 }}>
                  <Text
                    className="text-[10px] mb-1"
                    style={{ color: colors.muted }}
                  >
                    Min
                  </Text>
                  <ScrollView
                    style={{
                      maxHeight: 120,
                      backgroundColor: colors.bg,
                      borderRadius: 8,
                    }}
                    showsVerticalScrollIndicator={false}
                  >
                    {MINUTES.map((m) => (
                      <Pressable
                        key={m}
                        onPress={() => setCustomMinute(m)}
                        className="py-1.5 px-2"
                        style={{
                          backgroundColor:
                            m === customMinute
                              ? colors.primary
                              : "transparent",
                          borderRadius: 4,
                        }}
                      >
                        <Text
                          className="text-xs text-center"
                          style={{
                            color: m === customMinute ? "#fff" : colors.text,
                          }}
                        >
                          {String(m).padStart(2, "0")}
                        </Text>
                      </Pressable>
                    ))}
                  </ScrollView>
                </View>
                <View className="flex-1 ml-1">
                  <Text
                    className="text-[10px]"
                    style={{ color: colors.muted }}
                  >
                    Selected
                  </Text>
                  <Text
                    className="text-sm font-medium"
                    style={{ color: colors.text }}
                  >
                    {String(customHour).padStart(2, "0")}:
                    {String(customMinute).padStart(2, "0")}
                  </Text>
                </View>
              </View>

              <Text
                className="text-sm font-semibold mt-4 mb-2"
                style={{ color: colors.text }}
              >
                Reason (optional)
              </Text>
              <TextInput
                className="px-3 py-2 rounded-lg text-sm"
                style={{ backgroundColor: colors.bg, color: colors.text }}
                placeholder="Reason for reschedule"
                placeholderTextColor={colors.muted}
                value={reason}
                onChangeText={setReason}
                multiline
              />

              <View
                className="mt-2 px-3 py-2 rounded-lg"
                style={{ backgroundColor: colors.bg }}
              >
                <Text className="text-xs" style={{ color: colors.muted }}>
                  Proposed new due:
                </Text>
                <Text
                  className="text-sm font-semibold mt-0.5"
                  style={{ color: colors.text }}
                >
                  {formatDueDateTime(
                    new Date(
                      customYear,
                      customMonth,
                      customDay,
                      customHour,
                      customMinute,
                      0,
                      0,
                    ).getTime(),
                  )}
                </Text>
              </View>

              <Pressable
                onPress={handleReschedule}
                disabled={actionLoading}
                className="mt-4 rounded-xl py-3 items-center"
                style={{
                  backgroundColor: actionLoading
                    ? colors.muted
                    : colors.primary,
                }}
              >
                <Text
                  className="text-sm font-semibold"
                  style={{ color: colors.text }}
                >
                  {actionLoading ? "Rescheduling..." : "Confirm Reschedule"}
                </Text>
              </Pressable>
            </ScrollView>
          </View>
        </View>
      </Modal>

      {/* Reassign modal */}
      <Modal
        visible={reassignVisible}
        animationType="slide"
        transparent={true}
        onRequestClose={() => setReassignVisible(false)}
      >
        <View
          className="flex-1 justify-end"
          style={{ backgroundColor: "rgba(0,0,0,0.5)" }}
        >
          <View
            className="rounded-t-3xl"
            style={{ backgroundColor: colors.surface, maxHeight: "80%" }}
          >
            <View className="flex-row items-center justify-between px-5 pt-5 pb-3">
              <Text
                className="text-lg font-bold"
                style={{ color: colors.text }}
              >
                Reassign Ticket
              </Text>
              <Pressable
                onPress={() => setReassignVisible(false)}
                hitSlop={12}
              >
                <Text className="text-base" style={{ color: colors.muted }}>
                  Cancel
                </Text>
              </Pressable>
            </View>

            {techsLoading ? (
              <View className="px-5 pb-5 items-center py-8">
                <ActivityIndicator size="large" color={colors.accent} />
                <Text
                  className="text-sm mt-3"
                  style={{ color: colors.muted }}
                >
                  Loading techs...
                </Text>
              </View>
            ) : (
              <ScrollView
                className="px-5 pb-5"
                showsVerticalScrollIndicator={false}
              >
                {ticket.assignedTechId ? (
                  <Pressable
                    onPress={() => handleAssign(null)}
                    disabled={actionLoading}
                    className="rounded-xl p-4 mb-2 flex-row items-center"
                    style={{ backgroundColor: colors.bg }}
                  >
                    <Ionicons
                      name="close-circle-outline"
                      size={20}
                      color={colors.danger}
                      style={{ marginRight: 10 }}
                    />
                    <Text
                      className="text-sm font-semibold"
                      style={{ color: colors.danger }}
                    >
                      Unassign
                    </Text>
                  </Pressable>
                ) : null}
                {techs.map((t) => (
                  <Pressable
                    key={t.id}
                    onPress={() => handleAssign(t.id)}
                    disabled={actionLoading}
                    className="rounded-xl p-4 mb-2 flex-row items-center justify-between"
                    style={{
                      backgroundColor:
                        t.id === ticket.assignedTechId
                          ? colors.primary + "30"
                          : colors.bg,
                    }}
                  >
                    <View className="flex-1">
                      <Text
                        className="text-sm font-semibold"
                        style={{ color: colors.text }}
                      >
                        {t.name}
                      </Text>
                      <Text
                        className="text-xs mt-1"
                        style={{ color: colors.muted }}
                      >
                        {t.timesheetState.replace(/_/g, " ")} ·{" "}
                        {t.today.completedTickets} done today
                      </Text>
                    </View>
                    {t.id === ticket.assignedTechId ? (
                      <Ionicons
                        name="checkmark-circle"
                        size={20}
                        color={colors.success}
                      />
                    ) : null}
                  </Pressable>
                ))}
              </ScrollView>
            )}
          </View>
        </View>
      </Modal>
    </View>
  );
}
