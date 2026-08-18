import { useEffect, useMemo, useRef, useState } from "react";
import { Alert, Pressable, ScrollView, Text, View } from "react-native";
import { Stack, router, useLocalSearchParams } from "expo-router";
import withObservables from "@nozbe/with-observables";
import { Q } from "@nozbe/watermelondb";

import { database } from "../../src/db/database";
import Ticket from "../../src/db/models/Ticket";
import DaySession from "../../src/db/models/DaySession";
import { useAuth } from "../../src/features/auth/AuthContext";
import { AllocationReconcileModal } from "../../src/features/tickets/components/AllocationReconcileModal";
import {
  CustomersTab,
  type CustomerMarkingByCustomerId,
} from "../../src/features/tickets/components/CustomersTab";
import type { TicketPayload, TicketStatus } from "../../src/features/tickets/types";
import { getAllocatableMinutes } from "../../src/features/tickets/utils/ticketTime";
import {
  DetailTabs,
  type DetailTabKey,
} from "../../src/features/tickets/components/DetailTabs";
import { SectionCard } from "../../src/features/tickets/components/SectionCard";
import { NotesTab } from "../../src/features/tickets/components/NotesTab";
import { AttachmentsTab } from "../../src/features/tickets/components/AttachmentsTab";
import { HistoryTab } from "../../src/features/tickets/components/HistoryTab";
import {
  createTicketCustomerMarkingSetEvent,
  createTicketStatusSetEvent,
} from "../../src/features/tickets/domain/outbox";
import { triggerLightHaptic, triggerMediumHaptic, triggerSuccessHaptic } from "../../src/utils/haptics";
import {
  canTransitionStatus,
  isTicketClosed,
  type LocatorStatus,
} from "../../src/features/tickets/domain/statusMachine";
import { SyncEngine } from "../../src/features/tickets/sync/SyncEngine";
import { getActiveTicket } from "../../src/features/tickets/utils/activeTicketCheck";
import {
  formatTicketType,
  getTicketDisplayData,
  parseTicketPayload,
} from "../../src/features/tickets/utils/ticketPayload";
import { getTicketTypeColor } from "../../src/features/tickets/utils/ticketPresentation";
import { colors } from "../../src/ui/colors";
import { formatDueDateTime } from "../../src/utils/date";
import { logger } from "../../src/utils/logger";

function normalizeNumericString(value: unknown): string {
  if (typeof value !== "string") {
    return "";
  }

  const digitsOnly = value.replace(/\D/g, "");
  if (!digitsOnly) {
    return "";
  }

  return String(parseInt(digitsOnly, 10));
}

function normalizeCustomerMarking(
  customerMarking: CustomerMarkingByCustomerId,
): CustomerMarkingByCustomerId {
  return Object.fromEntries(
    Object.entries(customerMarking).map(([customerId, data]) => [
      customerId,
      {
        status: data?.status || "",
        result: data?.result || "",
        minutes: normalizeNumericString(data?.minutes ?? ""),
        footage: normalizeNumericString(data?.footage ?? ""),
        completed: data?.completed === true,
      },
    ]),
  );
}

function customerMarkingEquals(
  left: CustomerMarkingByCustomerId,
  right: CustomerMarkingByCustomerId,
): boolean {
  return (
    JSON.stringify(normalizeCustomerMarking(left)) ===
    JSON.stringify(normalizeCustomerMarking(right))
  );
}

function getAllocatedMinutes(customerMarking: CustomerMarkingByCustomerId): number {
  return Object.values(customerMarking).reduce((sum, data) => {
    const mins = parseInt(data.minutes || "0", 10);
    return sum + (isNaN(mins) ? 0 : mins);
  }, 0);
}

function getRemainingAllocatableMinutes(
  payload: TicketPayload,
  locatorStatus: string,
  customerMarking: CustomerMarkingByCustomerId,
): number {
  return (
    getAllocatableMinutes(payload, locatorStatus) -
    getAllocatedMinutes(customerMarking)
  );
}

function useOnsiteTick(ticket?: Ticket) {
  const [tick, setTick] = useState(0);

  useEffect(() => {
    const isOnsite = ticket?.locatorStatus === "ONSITE";
    const isClosed =
      ticket?.status === "CLOSED" ||
      ticket?.locatorStatus === "CLOSED" ||
      ticket?.locatorStatus === "UNABLE";
    const isPaused = ticket?.locatorStatus === "PAUSED";

    if (!isOnsite || isPaused || isClosed) return;

    setTick((prev) => prev + 1);

    const interval = setInterval(() => {
      setTick((prev) => prev + 1);
    }, 10000);

    return () => clearInterval(interval);
  }, [ticket?.locatorStatus, ticket?.status]);

  return tick;
}

function useClockedInStatus(userId?: string) {
  const [isClockedIn, setIsClockedIn] = useState(true);

  useEffect(() => {
    if (!userId) return;

    const today = new Date().toISOString().split("T")[0];
    const sessionsCollection = database.collections.get<DaySession>("day_sessions");

    const checkClockedInStatus = async () => {
      try {
        const allSessions = await sessionsCollection
          .query(
            Q.where("user_id", userId),
            Q.where("date", today),
            Q.sortBy("created_at", Q.desc),
          )
          .fetch();

        const mostRecentSession =
          allSessions.length > 0 ? allSessions[0] : null;
        const clockedIn = mostRecentSession?.status === "ACTIVE";

        logger.log("[TicketDetails] Clock status check:", {
          today,
          clockedIn,
          totalSessions: allSessions.length,
          mostRecent: mostRecentSession
            ? {
                id: mostRecentSession.id.slice(0, 8),
                status: mostRecentSession.status,
                clockInAt: mostRecentSession.clockInAt,
                clockOutAt: mostRecentSession.clockOutAt,
              }
            : null,
        });

        setIsClockedIn(clockedIn);
      } catch (error) {
        logger.error("[TicketDetails] Failed to check clock status:", error);
        setIsClockedIn(true);
      }
    };

    checkClockedInStatus();

    const subscription = sessionsCollection
      .query(
        Q.where("user_id", userId),
        Q.where("date", today),
      )
      .observe()
      .subscribe(() => {
        checkClockedInStatus();
      });

    return () => subscription.unsubscribe();
  }, [userId]);

  return isClockedIn;
}

function useCustomerMarkingState(ticket?: Ticket) {
  const [customerMarking, setCustomerMarking] =
    useState<CustomerMarkingByCustomerId>({});
  const [isInitialized, setIsInitialized] = useState(false);

  useEffect(() => {
    if (!ticket || isInitialized) return;

    try {
      const payload = parseTicketPayload(ticket.payloadJson);
      const existingMarkings =
        payload.customerMarking || payload.customerMarkings;
      if (existingMarkings && Object.keys(existingMarkings).length > 0) {
        setCustomerMarking(normalizeCustomerMarking(existingMarkings));
      }
      setIsInitialized(true);
    } catch (error) {
      logger.error("[TicketDetail] Failed to load customer marking:", error);
      setIsInitialized(true);
    }
  }, [ticket, isInitialized]);

  useEffect(() => {
    if (!ticket || !isInitialized || Object.keys(customerMarking).length === 0) {
      return;
    }

    const timer = setTimeout(async () => {
      try {
        const normalizedCustomerMarking =
          normalizeCustomerMarking(customerMarking);
        const existingPayload = parseTicketPayload(ticket.payloadJson);
        const existingMarkings = normalizeCustomerMarking(
          existingPayload.customerMarking ||
            existingPayload.customerMarkings ||
            {},
        );

        if (
          customerMarkingEquals(existingMarkings, normalizedCustomerMarking)
        ) {
          return;
        }

        await database.write(async () => {
          await ticket.update((t) => {
            const payload = parseTicketPayload(t.payloadJson);
            payload.customerMarking = normalizedCustomerMarking;
            payload.customerMarkings = normalizedCustomerMarking;
            t.payloadJson = JSON.stringify(payload);
            t.syncState = "PENDING";
            t.updatedAt = Date.now();
            t.version = t.version + 1;
          });
        });

        await SyncEngine.queueEvent(
          createTicketCustomerMarkingSetEvent(
            ticket.id,
            normalizedCustomerMarking,
          ),
        );
      } catch (error) {
        logger.error("[TicketDetail] Failed to save customer marking:", error);
      }
    }, 400);

    return () => clearTimeout(timer);
  }, [customerMarking, ticket, isInitialized]);

  return { customerMarking, setCustomerMarking };
}

function validateStatusAllocationChange(
  nextStatus: LocatorStatus,
  ticket: Ticket,
  customerMarking: CustomerMarkingByCustomerId,
) {
  if (nextStatus !== "CLOSED" && nextStatus !== "PAUSED") {
    return { type: "ok" as const };
  }

  const currentPayload = parseTicketPayload(ticket.payloadJson);
  const remainingMinutes = getRemainingAllocatableMinutes(
    currentPayload,
    ticket.locatorStatus,
    customerMarking,
  );

  if (remainingMinutes === 0) {
    return { type: "ok" as const };
  }

  if (nextStatus === "CLOSED" && remainingMinutes > 0) {
    return { type: "reconcile" as const };
  }

  return {
    type: "invalid" as const,
    title:
      remainingMinutes > 0 ? "Unallocated Time" : "Over-allocated Time",
    message:
      nextStatus === "CLOSED" && remainingMinutes < 0
        ? `You have over-allocated by ${Math.abs(remainingMinutes)} minute(s). Please reduce allocated time in the Customer tab before closing.`
        : `You have ${Math.abs(remainingMinutes)} minute(s) ${remainingMinutes > 0 ? "unallocated" : "over-allocated"}. Please adjust time allocations in the Customer tab before pausing.`,
  };
}

function showCustomerTabAlert(
  title: string,
  message: string,
  onConfirm: () => void,
) {
  Alert.alert(title, message, [{ text: "OK", onPress: onConfirm }]);
}

function showActiveTicketAlert(ticketNumber: string) {
  Alert.alert(
    "Active Ticket Found",
    `Please pause ticket ${ticketNumber} before changing status on another ticket.`,
    [{ text: "OK" }],
  );
}

function resumeLatestPauseEvent(
  pauseEvents: NonNullable<TicketPayload["pauseEvents"]>,
  now: number,
) {
  return pauseEvents.map((pause, index) => {
    if (index === pauseEvents.length - 1 && pause && !pause.end) {
      return { ...pause, end: now };
    }

    return pause;
  });
}

function buildStatusPayloadUpdates(
  currentPayload: TicketPayload,
  currentStatus: string,
  nextStatus: LocatorStatus,
  customerMarking: CustomerMarkingByCustomerId,
  closedByName: string,
  now: number,
) {
  const payloadUpdates: Record<string, unknown> = {
    customerMarking,
    customerMarkings: customerMarking,
  };
  const nextPauseEvents = Array.isArray(currentPayload.pauseEvents)
    ? [...currentPayload.pauseEvents]
    : [];

  if (currentPayload.enrouteStartedAt) {
    payloadUpdates.enrouteStartedAt = currentPayload.enrouteStartedAt;
  }
  if (currentPayload.enrouteEndedAt) {
    payloadUpdates.enrouteEndedAt = currentPayload.enrouteEndedAt;
  }
  if (currentPayload.onsiteStartedAt) {
    payloadUpdates.onsiteStartedAt = currentPayload.onsiteStartedAt;
  }
  if (currentPayload.onsiteEndedAt) {
    payloadUpdates.onsiteEndedAt = currentPayload.onsiteEndedAt;
  }
  if (currentPayload.pauseEvents) {
    payloadUpdates.pauseEvents = currentPayload.pauseEvents;
  }
  if (currentPayload.closedAt) {
    payloadUpdates.closedAt = currentPayload.closedAt;
  }

  if (nextStatus === "ENROUTE" && !currentPayload.enrouteStartedAt) {
    payloadUpdates.enrouteStartedAt = now;
  }
  if (nextStatus === "ONSITE" && !currentPayload.onsiteStartedAt) {
    payloadUpdates.onsiteStartedAt = now;
  }
  if (nextStatus === "CLOSED" && !currentPayload.closedAt) {
    payloadUpdates.closedAt = now;
  }
  if (nextStatus === "CLOSED" || nextStatus === "UNABLE") {
    payloadUpdates.closedByName = closedByName;
  }

  if (
    nextStatus === "ONSITE" &&
    currentStatus === "ENROUTE" &&
    currentPayload.enrouteStartedAt &&
    !currentPayload.enrouteEndedAt
  ) {
    payloadUpdates.enrouteEndedAt = now;
  }

  if (
    nextStatus === "ENROUTE" &&
    currentStatus === "ONSITE" &&
    currentPayload.onsiteStartedAt &&
    !currentPayload.onsiteEndedAt
  ) {
    payloadUpdates.onsiteEndedAt = now;
  }

  if (nextStatus === "PAUSED") {
    nextPauseEvents.push({ start: now });
    payloadUpdates.pauseEvents = nextPauseEvents;
  }

  if (
    (nextStatus === "ONSITE" || nextStatus === "ENROUTE") &&
    currentStatus === "PAUSED"
  ) {
    payloadUpdates.pauseEvents = resumeLatestPauseEvent(nextPauseEvents, now);
  }

  if (
    (nextStatus === "CLOSED" || nextStatus === "UNABLE") &&
    currentPayload.onsiteStartedAt &&
    !currentPayload.onsiteEndedAt
  ) {
    payloadUpdates.onsiteEndedAt = now;
  }

  return payloadUpdates;
}

function applyOptimisticStatusUpdate(
  payload: TicketPayload,
  oldStatus: string,
  nextStatus: LocatorStatus,
  customerMarking: CustomerMarkingByCustomerId,
  closedByName: string,
  now: number,
) {
  if (!payload.pauseEvents) {
    payload.pauseEvents = [];
  }

  if (nextStatus === "ENROUTE") {
    if (!payload.enrouteStartedAt) {
      payload.enrouteStartedAt = now;
    }
    if (oldStatus === "PAUSED" && payload.pauseEvents.length > 0) {
      const lastPause = payload.pauseEvents[payload.pauseEvents.length - 1];
      if (!lastPause.end) {
        lastPause.end = now;
      }
    }
    if (oldStatus === "ONSITE" && payload.onsiteStartedAt && !payload.onsiteEndedAt) {
      payload.onsiteEndedAt = now;
    }
  }

  if (nextStatus === "ONSITE") {
    if (!payload.onsiteStartedAt) {
      payload.onsiteStartedAt = now;
      logger.log("[TicketDetail] Set onsiteStartedAt:", payload.onsiteStartedAt);
    }
    if (oldStatus === "ENROUTE" && payload.enrouteStartedAt && !payload.enrouteEndedAt) {
      payload.enrouteEndedAt = now;
    }
    if (oldStatus === "PAUSED" && payload.pauseEvents.length > 0) {
      const lastPause = payload.pauseEvents[payload.pauseEvents.length - 1];
      if (!lastPause.end) {
        lastPause.end = now;
      }
    }
  }

  if (nextStatus === "PAUSED") {
    payload.pauseEvents.push({ start: now });
  }

  if (nextStatus === "CLOSED" || nextStatus === "UNABLE") {
    if (payload.onsiteStartedAt && !payload.onsiteEndedAt) {
      payload.onsiteEndedAt = now;
    }
    payload.closedAt = now;
    payload.closedByName = closedByName;
  }

  payload.customerMarking = customerMarking;
  payload.customerMarkings = customerMarking;
}

function ActionButton({
  label,
  disabled,
  active,
  onPress,
}: {
  label: string;
  disabled?: boolean;
  active?: boolean;
  onPress: () => void;
}) {
  const handlePress = () => {
    triggerMediumHaptic();
    onPress();
  };

  return (
    <Pressable
      onPress={handlePress}
      disabled={disabled}
      className="rounded-xl px-4 py-3 mr-3"
      style={{
        backgroundColor: active
          ? colors.success
          : disabled
            ? colors.surface
            : colors.primary,
        opacity: disabled ? 0.5 : 1,
        borderWidth: active ? 2 : 0,
        borderColor: active ? colors.accent : "transparent",
      }}
    >
      <Text className="text-sm font-semibold" style={{ color: colors.text }}>
        {label}
      </Text>
    </Pressable>
  );
}

interface TicketDetailProps {
  ticket?: Ticket;
  relatedTickets?: Ticket[];
}

function TicketDetailScreen({ ticket, relatedTickets }: TicketDetailProps) {
  const { user } = useAuth();
  const scrollViewRef = useRef<ScrollView>(null);
  const [tab, setTab] = useState<DetailTabKey>("INFO");
  const [showReconcileModal, setShowReconcileModal] = useState(false);
  const tick = useOnsiteTick(ticket);
  const isClockedIn = useClockedInStatus(user?.id);
  const { customerMarking, setCustomerMarking } = useCustomerMarkingState(ticket);

  const handleStatusChange = async (nextStatus: LocatorStatus) => {
    if (!ticket) return;
    if (ticket.locatorStatus === nextStatus) {
      logger.log(`[TicketDetail] Ticket is already in status ${nextStatus}, ignoring duplicate transition`);
      return;
    }

    try {
      if (nextStatus === "ENROUTE" || nextStatus === "ONSITE") {
        const activeTicket = await getActiveTicket(
          user?.id || "",
          ticket.id,
        );
        if (activeTicket) {
          showActiveTicketAlert(activeTicket.ticketNumber);
          return;
        }
      }

      const allocationValidation = validateStatusAllocationChange(
        nextStatus,
        ticket,
        customerMarking,
      );
      if (allocationValidation.type === "reconcile") {
        setShowReconcileModal(true);
        return;
      }
      if (allocationValidation.type === "invalid") {
        showCustomerTabAlert(
          allocationValidation.title,
          allocationValidation.message,
          () => setTab("CUSTOMER"),
        );
        return;
      }

      const currentPayload = parseTicketPayload(ticket.payloadJson);
      const now = Date.now();
      const closedByName = user?.name || "L720 Technician";
      const payloadUpdates = buildStatusPayloadUpdates(
        currentPayload,
        ticket.locatorStatus,
        nextStatus,
        customerMarking,
        closedByName,
        now,
      );

      const event = createTicketStatusSetEvent(
        ticket.id,
        nextStatus,
        payloadUpdates,
      );
      await SyncEngine.queueEvent(event);

      const updatedTicket = await database.write(async () => {
        return await ticket.update((t) => {
          const payload = parseTicketPayload(t.payloadJson);
          const oldStatus = t.locatorStatus;
          t.locatorStatus = nextStatus;
          applyOptimisticStatusUpdate(
            payload,
            oldStatus,
            nextStatus,
            customerMarking,
            closedByName,
            now,
          );
          if (nextStatus === "CLOSED" || nextStatus === "UNABLE") {
            t.closedByName = closedByName;
            t.closedAt = now;
          }
          t.payloadJson = JSON.stringify(payload);
          t.syncState = "PENDING";
          t.version = t.version + 1;
          t.updatedAt = Date.now();
        });
      });

      logger.log(
        `[TicketDetail] Updated ticket ${ticket.id} to ${nextStatus}, new version: ${updatedTicket.version}`,
      );

      // After closing a ticket, return the user to the ticket list view.
      if (nextStatus === "CLOSED" || nextStatus === "UNABLE") {
        if (router.canGoBack()) {
          router.back();
        } else {
          router.replace("/");
        }
      }
    } catch (error) {
      logger.error("[TicketDetail] Failed to update status:", error);
      Alert.alert("Error", "Failed to update ticket status");
    }
  };

  if (!ticket) {
    return (
      <View
        className="flex-1 items-center justify-center px-6"
        style={{ backgroundColor: colors.bg }}
      >
        <Stack.Screen options={{ title: "Ticket" }} />
        <Text
          className="text-base font-semibold"
          style={{ color: colors.text }}
        >
          Ticket not found
        </Text>
      </View>
    );
  }

  const isClosed =
    isTicketClosed(ticket.status) || isTicketClosed(ticket.locatorStatus);
  const isReadOnly = !isClockedIn || isClosed; // Read-only when clocked out OR closed

  const {
    payload,
    customers,
    contractor,
    contractorPhone,
    contactName,
    contactEmail,
    markingInstructions,
    workType,
  } = useMemo(() => getTicketDisplayData(ticket.payloadJson), [ticket.payloadJson]);

  // Check if all customers are completed
  const allCustomersCompleted =
    customers.length > 0 &&
    customers.every((c) => {
      const marking = customerMarking[c.id];
      return marking && marking.completed === true;
    });

  return (
    <View className="flex-1" style={{ backgroundColor: colors.bg }}>
      <Stack.Screen options={{ title: "Ticket Details" }} />

      <ScrollView
        ref={scrollViewRef}
        contentContainerStyle={{
          paddingHorizontal: 16,
          paddingTop: 16,
          paddingBottom: 24,
          gap: 12,
        }}
      >
        <Text className="text-xl font-bold" style={{ color: colors.text }}>
          {ticket.ticketNumber}
        </Text>

        <Text className="text-sm" style={{ color: colors.muted }}>
          {ticket.address}
        </Text>

        <View className="flex-row items-center justify-between mt-3">
          <View
            className="px-3 py-1 rounded-full"
            style={{ backgroundColor: getTicketTypeColor(ticket.ticketType) }}
          >
            <Text
              className="text-xs font-semibold"
              style={{ color: colors.bg }}
              numberOfLines={1}
            >
              {formatTicketType(ticket.ticketType)}
            </Text>
          </View>
          <Text className="text-sm" style={{ color: colors.muted }}>
            {customers.length} utilit{customers.length !== 1 ? "ies" : "y"}
          </Text>
        </View>

        {payload.onsiteStartedAt && (
          <View
            className="rounded-xl p-3 mt-2"
            style={{ backgroundColor: colors.surface }}
          >
            <Text
              className="text-xs font-semibold"
              style={{ color: colors.muted }}
            >
              Time on Site
            </Text>
            <Text
              className="text-lg font-bold mt-1"
              style={{ color: colors.accent }}
            >
              {(() => {
                // Force recalculation when tick changes
                // eslint-disable-next-line @typescript-eslint/no-unused-vars
                const _ = tick;
                const allocatableMinutes = getAllocatableMinutes(
                  payload,
                  ticket.locatorStatus,
                );
                const hours = Math.floor(allocatableMinutes / 60);
                const minutes = allocatableMinutes % 60;
                return `${hours}h ${minutes}m`;
              })()}
            </Text>
          </View>
        )}

        <DetailTabs value={tab} onChange={setTab} />

        {tab === "INFO" ? (
          <>
            {isClosed ? (
              <SectionCard title="Closed">
                <Text className="text-sm" style={{ color: colors.muted }}>
                  {ticket.closedByName
                    ? `Closed by ${ticket.closedByName} at ${new Date(ticket.closedAt || 0).toLocaleString()}`
                    : "This ticket is closed."}
                </Text>
              </SectionCard>
            ) : (
              <SectionCard title="Status actions">
                <View
                  className="flex-row"
                  style={{ gap: 10, flexWrap: "wrap" }}
                >
                  <ActionButton
                    label="En Route"
                    active={ticket.locatorStatus === "ENROUTE"}
                    disabled={
                      isReadOnly ||
                      !canTransitionStatus(
                        ticket.locatorStatus as LocatorStatus,
                        "ENROUTE",
                      )
                    }
                    onPress={() => handleStatusChange("ENROUTE")}
                  />
                  <ActionButton
                    label="On Site"
                    active={ticket.locatorStatus === "ONSITE"}
                    disabled={
                      isReadOnly ||
                      !canTransitionStatus(
                        ticket.locatorStatus as LocatorStatus,
                        "ONSITE",
                      )
                    }
                    onPress={() => handleStatusChange("ONSITE")}
                  />
                  <ActionButton
                    label="Pause"
                    active={ticket.locatorStatus === "PAUSED"}
                    disabled={
                      isReadOnly ||
                      !canTransitionStatus(
                        ticket.locatorStatus as LocatorStatus,
                        "PAUSED",
                      )
                    }
                    onPress={() => handleStatusChange("PAUSED")}
                  />
                </View>
              </SectionCard>
            )}

            <SectionCard title="Ticket Info">
              <View style={{ gap: 16 }}>
                <View>
                  <Text
                    className="text-xs font-semibold"
                    style={{ color: colors.muted }}
                  >
                    Due Date/Time
                  </Text>
                  <Text className="text-sm mt-1" style={{ color: colors.text }}>
                    {formatDueDateTime(ticket.dueAt)}
                  </Text>
                </View>

                <View>
                  <Text
                    className="text-xs font-semibold"
                    style={{ color: colors.muted }}
                  >
                    Ticket Number
                  </Text>
                  <Text className="text-sm mt-1" style={{ color: colors.text }}>
                    {ticket.ticketNumber}
                  </Text>
                </View>

                <View>
                  <Text
                    className="text-xs font-semibold"
                    style={{ color: colors.muted }}
                  >
                    Address
                  </Text>
                  <Text className="text-sm mt-1" style={{ color: colors.text }}>
                    {ticket.address}
                  </Text>
                </View>
              </View>
            </SectionCard>

            {workType && (
              <SectionCard title="Work Details">
                <View>
                  <Text
                    className="text-xs font-semibold"
                    style={{ color: colors.muted }}
                  >
                    Work Type
                  </Text>
                  <Text className="text-sm mt-1" style={{ color: colors.text }}>
                    {workType}
                  </Text>
                </View>
              </SectionCard>
            )}

            {(contractor || contactName || contactEmail) && (
              <SectionCard title="Contact Info">
                <View style={{ gap: 16 }}>
                  {contractor ? (
                    <View>
                      <Text
                        className="text-xs font-semibold"
                        style={{ color: colors.muted }}
                      >
                        Contractor
                      </Text>
                      <Text
                        className="text-sm mt-1"
                        style={{ color: colors.text }}
                      >
                        {contractor}
                      </Text>
                      {contractorPhone ? (
                        <Text
                          className="text-sm mt-1"
                          style={{ color: colors.accent }}
                        >
                          {contractorPhone}
                        </Text>
                      ) : null}
                    </View>
                  ) : null}

                  {contactName ? (
                    <View>
                      <Text
                        className="text-xs font-semibold"
                        style={{ color: colors.muted }}
                      >
                        Contact Name
                      </Text>
                      <Text
                        className="text-sm mt-1"
                        style={{ color: colors.text }}
                      >
                        {contactName}
                      </Text>
                    </View>
                  ) : null}

                  {contactEmail ? (
                    <View>
                      <Text
                        className="text-xs font-semibold"
                        style={{ color: colors.muted }}
                      >
                        Contact Email
                      </Text>
                      <Text
                        className="text-sm mt-1"
                        style={{ color: colors.text }}
                      >
                        {contactEmail}
                      </Text>
                    </View>
                  ) : null}
                </View>
              </SectionCard>
            )}

            {markingInstructions && (
              <SectionCard title="Marking Instructions">
                <Text className="text-sm" style={{ color: colors.text }}>
                  {markingInstructions}
                </Text>
              </SectionCard>
            )}
          </>
        ) : tab === "CUSTOMER" ? (
          <>
            <CustomersTab
              customers={customers}
              value={customerMarking}
              onChange={setCustomerMarking}
              ticketStatus={ticket.status as TicketStatus}
              locatorStatus={ticket.locatorStatus as LocatorStatus}
              payload={payload}
              scrollViewRef={scrollViewRef}
              isReadOnly={isReadOnly}
            />

            {allCustomersCompleted && !isClosed && (
              <SectionCard title="Close Ticket">
                <Text className="text-sm mb-4" style={{ color: colors.muted }}>
                  All customers have been marked. You can now close this ticket.
                </Text>
                <Pressable
                  onPress={() => {
                    triggerSuccessHaptic();
                    handleStatusChange("CLOSED");
                  }}
                  disabled={isReadOnly}
                  className="rounded-xl px-4 py-3"
                  style={{
                    backgroundColor: isReadOnly ? colors.muted : colors.success,
                    opacity: isReadOnly ? 0.5 : 1,
                  }}
                >
                  <Text
                    className="text-sm font-semibold text-center"
                    style={{ color: colors.text }}
                  >
                    Close Ticket
                  </Text>
                </Pressable>
              </SectionCard>
            )}
          </>
        ) : tab === "ATTACHMENTS" ? (
          <AttachmentsTab ticket={ticket} isReadOnly={isReadOnly} />
        ) : tab === "NOTES" ? (
          <NotesTab
            ticketId={ticket.id}
            ticketNumber={ticket.ticketNumber}
            isReadOnly={isReadOnly}
          />
        ) : (
          <HistoryTab currentTicket={ticket} relatedTickets={relatedTickets ?? []} />
        )}
      </ScrollView>

      <AllocationReconcileModal
        visible={showReconcileModal}
        onClose={() => setShowReconcileModal(false)}
        onConfirm={(updatedMarking) => {
          setCustomerMarking(updatedMarking);
          setShowReconcileModal(false);
          // After updating marking, proceed with close
          setTimeout(() => handleStatusChange("CLOSED"), 100);
        }}
        customers={customers}
        currentMarking={customerMarking}
        remainingMinutes={(() => {
          return getRemainingAllocatableMinutes(
            payload,
            ticket.locatorStatus,
            customerMarking,
          );
        })()}
      />
    </View>
  );
}

// Enhance with WatermelonDB observables. Two layers:
// 1. Observe the primary ticket by id.
// 2. Once we have the ticket, observe related tickets that share the same
//    root_ticket_id (true 811 linked-ticket lineage). See
//    docs/linked-tickets-architecture.md. Falls back to observing self when
//    the ticket is an original with no siblings yet, and falls back to
//    external_root_number if root_ticket_id is not yet populated locally.
const enhanceRelated = withObservables(
  ["ticket"],
  ({ ticket }: { ticket?: Ticket }) => {
    if (!ticket) {
      return {
        relatedTickets: database.collections
          .get<Ticket>("tickets")
          .query(Q.where("id", "__none__"))
          .observe(),
      };
    }
    const rootId = ticket.rootTicketId || ticket.id;
    const externalRoot = ticket.externalRootNumber;
    return {
      relatedTickets: database.collections
        .get<Ticket>("tickets")
        .query(
          externalRoot
            ? Q.or(
                Q.where("root_ticket_id", rootId),
                Q.where("external_root_number", externalRoot),
              )
            : Q.where("root_ticket_id", rootId),
        )
        .observe(),
    };
  },
);

const enhancePrimary = withObservables(
  ["route"],
  ({ route }: { route: { params: { id: string } } }) => ({
    ticket: database.collections
      .get<Ticket>("tickets")
      .findAndObserve(route.params.id),
  }),
);

const enhance = (
  Component: React.ComponentType<TicketDetailProps>,
) => enhancePrimary(enhanceRelated(Component));

export default function TicketDetailScreenWrapper() {
  const params = useLocalSearchParams<{ id?: string }>();

  if (!params.id) {
    return (
      <View
        className="flex-1 items-center justify-center px-6"
        style={{ backgroundColor: colors.bg }}
      >
        <Stack.Screen options={{ title: "Ticket" }} />
        <Text
          className="text-base font-semibold"
          style={{ color: colors.text }}
        >
          No ticket ID provided
        </Text>
      </View>
    );
  }

  const EnhancedScreen = enhance(TicketDetailScreen);
  return <EnhancedScreen route={{ params: { id: params.id } }} />;
}
