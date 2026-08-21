import { useEffect, useMemo, useRef, useState } from "react";
import { Alert, Animated, Keyboard, KeyboardAvoidingView, Linking, Platform, Pressable, ScrollView, Text, View } from "react-native";
import { Stack, router, useLocalSearchParams } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import withObservables from "@nozbe/with-observables";
import { Q } from "@nozbe/watermelondb";
import { Ionicons } from "@expo/vector-icons";

import { database } from "../../src/db/database";
import Ticket from "../../src/db/models/Ticket";
import DaySession from "../../src/db/models/DaySession";
import { useAuth } from "../../src/features/auth/AuthContext";
import { AllocationReconcileModal } from "../../src/features/tickets/components/AllocationReconcileModal";
import {
  CustomersTab,
  TimeAllocationCard,
  type CustomerMarkingByCustomerId,
  type ScrollHandlers,
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
import { getDueUrgencyBucket, getDueAccentColorFromTimestamp } from "../../src/features/tickets/domain/dueColor";
import { colors } from "../../src/ui/colors";
import { spacing } from "../../src/ui/spacing";
import { typography } from "../../src/ui/typography";
import { radius } from "../../src/ui/radius";
import { shadows } from "../../src/ui/shadows";
import { formatDueDateTime, formatTime } from "../../src/utils/date";
import { getTodayDateString } from "../../src/features/timesheet/utils/breakStatus";
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

    const today = getTodayDateString();
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
        // Guard against updating a ticket that has been deleted locally
        // (e.g. reassigned to another tech and reconciled during sync).
        if (ticket._raw._status === "deleted") {
          logger.log("[TicketDetail] Ticket was deleted locally, skipping marking save");
          return;
        }

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

function getDueRemainingLabel(dueAt?: number): string {
  if (!dueAt) return "";
  const now = Date.now();
  const diffMs = dueAt - now;
  if (diffMs <= 0) return "";
  const absMinutes = Math.floor(diffMs / 60000);
  const absHours = Math.floor(absMinutes / 60);
  const remMinutes = absMinutes % 60;
  if (absHours > 0) {
    return `${absHours}h ${remMinutes}m remaining`;
  }
  return `${absMinutes}m remaining`;
}

function getDueLabel(dueAt?: number): string {
  if (!dueAt) return "No due date";
  const bucket = getDueUrgencyBucket(dueAt);
  const now = new Date();
  const due = new Date(dueAt);
  const isToday =
    now.getFullYear() === due.getFullYear() &&
    now.getMonth() === due.getMonth() &&
    now.getDate() === due.getDate();
  const tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  const isTomorrow =
    due.getFullYear() === tomorrow.getFullYear() &&
    due.getMonth() === tomorrow.getMonth() &&
    due.getDate() === tomorrow.getDate();

  const timeStr = formatTime(dueAt);
  if (isToday) return `Today · ${timeStr}`;
  if (isTomorrow) return `Tomorrow · ${timeStr}`;
  if (bucket === "overdue") return `Overdue · ${formatDueDateTime(dueAt)}`;
  return formatDueDateTime(dueAt);
}

function StickyActionBar({
  locatorStatus,
  isReadOnly,
  allCustomersCompleted,
  bottomInset,
  onEnroute,
  onOnsite,
  onPause,
  onClose,
  onCustomerWork,
}: {
  locatorStatus: string;
  isReadOnly: boolean;
  allCustomersCompleted: boolean;
  bottomInset: number;
  onEnroute: () => void;
  onOnsite: () => void;
  onPause: () => void;
  onClose: () => void;
  onCustomerWork: () => void;
}) {
  const canEnroute = canTransitionStatus(locatorStatus as LocatorStatus, "ENROUTE");
  const canOnsite = canTransitionStatus(locatorStatus as LocatorStatus, "ONSITE");
  const canPause = canTransitionStatus(locatorStatus as LocatorStatus, "PAUSED");

  // Determine primary + secondary actions based on current state
  let primaryLabel = "";
  let primaryIcon: React.ComponentProps<typeof Ionicons>["name"] = "arrow-forward";
  let primaryOnPress: () => void = () => {};
  let primaryDisabled = true;
  let primaryColor: string = colors.primary;

  let secondaryLabel: string | null = null;
  let secondaryOnPress: (() => void) | null = null;
  let secondaryDisabled = true;

  if (canEnroute) {
    primaryLabel = "EN ROUTE";
    primaryIcon = "navigate";
    primaryOnPress = onEnroute;
    primaryDisabled = isReadOnly;
    primaryColor = colors.accent;
  } else if (canOnsite) {
    primaryLabel = "ON SITE";
    primaryIcon = "locate";
    primaryOnPress = onOnsite;
    primaryDisabled = isReadOnly;
    primaryColor = colors.success;
  } else if (canPause) {
    // ONSITE: primary = Pause, secondary = Customer Work (switch to customer tab)
    primaryLabel = "PAUSE";
    primaryIcon = "pause";
    primaryOnPress = onPause;
    primaryDisabled = isReadOnly;
    primaryColor = colors.warning;
    secondaryLabel = "CUSTOMER WORK";
    secondaryOnPress = onCustomerWork;
    secondaryDisabled = isReadOnly;
  } else if (allCustomersCompleted && locatorStatus === "ONSITE") {
    primaryLabel = "CLOSE TICKET";
    primaryIcon = "checkmark-circle";
    primaryOnPress = onClose;
    primaryDisabled = isReadOnly;
    primaryColor = colors.success;
  } else {
    return null;
  }

  return (
    <View
      style={{
        position: "absolute",
        bottom: 0,
        left: 0,
        right: 0,
        backgroundColor: colors.surface,
        borderTopWidth: 1,
        borderTopColor: colors.bg,
        paddingBottom: bottomInset,
        paddingTop: spacing.sm,
        paddingHorizontal: spacing.screen,
        ...shadows.bar,
      }}
    >
      <View className="flex-row items-center" style={{ gap: spacing.sm }}>
        {secondaryLabel && secondaryOnPress && (
          <Pressable
            onPress={() => secondaryOnPress()}
            disabled={secondaryDisabled}
            style={{
              flex: 1,
              flexDirection: "row",
              alignItems: "center",
              justifyContent: "center",
              gap: 6,
              borderRadius: radius.button,
              paddingVertical: 14,
              backgroundColor: secondaryDisabled ? colors.surface : colors.bg,
              opacity: secondaryDisabled ? 0.5 : 1,
              borderWidth: 1,
              borderColor: colors.muted,
            }}
          >
            <Ionicons name="people" size={18} color={colors.text} />
            <Text className="font-semibold" style={{ color: colors.text, fontSize: typography.bodySm }}>
              {secondaryLabel}
            </Text>
          </Pressable>
        )}
        <Pressable
          onPress={primaryOnPress}
          disabled={primaryDisabled}
          style={{
            flex: 1,
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "center",
            gap: 8,
            borderRadius: radius.button,
            paddingVertical: 14,
            backgroundColor: primaryDisabled ? colors.surface : primaryColor,
            opacity: primaryDisabled ? 0.5 : 1,
          }}
        >
          <Ionicons name={primaryIcon} size={20} color={colors.text} />
          <Text className="font-bold" style={{ color: colors.text, fontSize: typography.body }}>
            {primaryLabel}
          </Text>
        </Pressable>
      </View>
      {isReadOnly && (
        <Text style={{ color: colors.muted, fontSize: typography.caption, textAlign: "center", marginTop: 6 }}>
          Clock in on the Timesheet tab to change status
        </Text>
      )}
    </View>
  );
}

function TicketDetailScreen({ ticket, relatedTickets }: TicketDetailProps) {
  const { user } = useAuth();
  const scrollViewRef = useRef<ScrollView>(null);
  const insets = useSafeAreaInsets();
  const [tab, setTab] = useState<DetailTabKey>("INFO");
  const [showReconcileModal, setShowReconcileModal] = useState(false);
  const skipReconcileRef = useRef(false);
  const tick = useOnsiteTick(ticket);
  const isClockedIn = useClockedInStatus(user?.id);
  const { customerMarking, setCustomerMarking } = useCustomerMarkingState(ticket);
  const [scrollHandlers, setScrollHandlers] = useState<ScrollHandlers | null>(null);
  const [keyboardHeight, setKeyboardHeight] = useState(0);
  const floatingCardAnim = useRef(new Animated.Value(0)).current;
  const floatingCardVisible = useRef(false);
  const scrollYRef = useRef(0);

  useEffect(() => {
    const showListener = Keyboard.addListener("keyboardDidShow", (e) => {
      setKeyboardHeight(e.endCoordinates.height);
    });
    const hideListener = Keyboard.addListener("keyboardDidHide", () => {
      setKeyboardHeight(0);
    });
    return () => {
      showListener.remove();
      hideListener.remove();
    };
  }, []);

  const handleStatusChange = async (nextStatus: LocatorStatus) => {
    if (!ticket) return;
    // Guard against updating a ticket that has been deleted locally
    // (e.g. reassigned to another tech and reconciled during sync).
    if (ticket._raw._status === "deleted") {
      logger.log("[TicketDetail] Ticket was deleted locally, skipping status change");
      return;
    }
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
      if (allocationValidation.type === "reconcile" && !skipReconcileRef.current) {
        setShowReconcileModal(true);
        return;
      }
      if (allocationValidation.type === "invalid" && !skipReconcileRef.current) {
        showCustomerTabAlert(
          allocationValidation.title,
          allocationValidation.message,
          () => setTab("CUSTOMER"),
        );
        return;
      }
      // Clear the skip flag after it's been used
      skipReconcileRef.current = false;

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

  // These useMemo hooks must be called unconditionally (before any early
  // return) to satisfy the Rules of Hooks.  When ticket is null we use
  // safe defaults so the memos still execute.
  // Recompute displayData whenever payloadJson or locatorStatus changes.
  // WatermelonDB model instances keep the same reference after update(),
  // so depending on [ticket] alone would NOT recompute when fields change.
  // We depend on the primitive field values to detect changes.
  const payloadJson = ticket?.payloadJson ?? "";
  const locatorStatusRaw = ticket?.locatorStatus ?? "";
  const ticketVersion = ticket?.version ?? 0;

  const displayData = useMemo(() => {
    if (!ticket) return getTicketDisplayData("{}");
    return getTicketDisplayData(ticket.payloadJson);
  }, [ticket, payloadJson, ticketVersion]);

  const allocatableMinutes = useMemo(() => {
    if (!ticket) return 0;
    return getAllocatableMinutes(displayData.payload, ticket.locatorStatus);
  }, [displayData.payload, ticket, locatorStatusRaw, ticketVersion]);

  const allocatedMinutesValue = useMemo(() => {
    return Object.values(customerMarking).reduce((sum, data) => {
      const mins = parseInt(data.minutes || "0", 10);
      return sum + (isNaN(mins) ? 0 : mins);
    }, 0);
  }, [customerMarking]);

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

  const {
    payload,
    customers,
    contractor,
    contractorPhone,
    contactName,
    contactEmail,
    markingInstructions,
    workType,
  } = displayData;

  const isClosed =
    isTicketClosed(ticket.status) || isTicketClosed(ticket.locatorStatus);
  const isReadOnly = !isClockedIn || isClosed; // Read-only when clocked out OR closed

  // Check if all customers are completed
  const allCustomersCompleted =
    customers.length > 0 &&
    customers.every((c) => {
      const marking = customerMarking[c.id];
      return marking && marking.completed === true;
    });

  const remainingMinutes = allocatableMinutes - allocatedMinutesValue;
  const isOnsiteActive = Boolean(payload.onsiteStartedAt) && !isClosed;
  const showFloatingTimeCard = tab === "CUSTOMER" && isOnsiteActive;

  // Show the floating time card only after the user has scrolled down
  // past 80px. Animate it in/out from the top with a smooth slide.
  const handleScrollForFloatingCard = (event: { nativeEvent: { contentOffset: { y: number } } }) => {
    const y = event.nativeEvent.contentOffset.y;
    scrollYRef.current = y;
    const shouldShow = y > 80;
    if (shouldShow && !floatingCardVisible.current) {
      floatingCardVisible.current = true;
      Animated.timing(floatingCardAnim, {
        toValue: 1,
        duration: 250,
        useNativeDriver: false,
      }).start();
    } else if (!shouldShow && floatingCardVisible.current) {
      floatingCardVisible.current = false;
      Animated.timing(floatingCardAnim, {
        toValue: 0,
        duration: 200,
        useNativeDriver: false,
      }).start();
    }
  };

  // Sticky action bar: visible when ticket is not closed and there are
  // available workflow transitions.  We show the bar even when read-only
  // (not clocked in) so the tech can see the workflow — buttons are
  // disabled in that case via isReadOnly.  Hide the bar when the keyboard
  // is open so it doesn't block input fields near the bottom of the screen.
  const showStickyActionBar =
    !isClosed &&
    keyboardHeight === 0 &&
    (canTransitionStatus(ticket.locatorStatus as LocatorStatus, "ENROUTE") ||
      canTransitionStatus(ticket.locatorStatus as LocatorStatus, "ONSITE") ||
      canTransitionStatus(ticket.locatorStatus as LocatorStatus, "PAUSED") ||
      (allCustomersCompleted && ticket.locatorStatus === "ONSITE"));
  const stickyBarHeight = 56 + insets.bottom;

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      className="flex-1"
      style={{ backgroundColor: colors.bg }}
    >
      <Stack.Screen options={{ title: "Ticket Details" }} />

      {/* Floating Time Allocation Card — slides in from the top when
          the user scrolls down past 80px on the Customer tab while
          on-site. Hidden at the top of the scroll to avoid redundancy
          with the inline customers card. */}
      {showFloatingTimeCard && (
        <Animated.View
          pointerEvents="none"
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            right: 0,
            zIndex: 10,
            opacity: floatingCardAnim,
            transform: [{
              translateY: floatingCardAnim.interpolate({
                inputRange: [0, 1],
                outputRange: [-80, 0],
              }),
            }],
          }}
        >
          <TimeAllocationCard
            allocatableMinutes={allocatableMinutes}
            allocatedMinutes={allocatedMinutesValue}
            remainingMinutes={remainingMinutes}
          />
        </Animated.View>
      )}

      <ScrollView
        ref={scrollViewRef}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="interactive"
        scrollEventThrottle={16}
        onScroll={(e) => {
          if (showFloatingTimeCard) handleScrollForFloatingCard(e);
        }}
        onScrollBeginDrag={scrollHandlers?.onScrollBeginDrag}
        onScrollEndDrag={scrollHandlers?.onScrollEndDrag}
        onMomentumScrollEnd={scrollHandlers?.onMomentumScrollEnd}
        contentContainerStyle={{
          paddingHorizontal: spacing.screen,
          paddingTop: spacing.screen,
          paddingBottom: showStickyActionBar
            ? stickyBarHeight + 20
            : 40 + Math.max(insets.bottom, keyboardHeight),
          gap: spacing.normal,
        }}
      >
        <View className="flex-row items-center" style={{ gap: spacing.sm, flexWrap: "wrap" }}>
          <Text style={{ color: colors.text, fontSize: typography.title, fontWeight: typography.weightBold, flexShrink: 1 }}>
            {ticket.ticketNumber}
          </Text>
          {ticket.ticketType === "EMERGENCY" && (
            <View
              style={{
                backgroundColor: "#EF5350",
                borderRadius: radius.pill,
                paddingHorizontal: spacing.sm,
                paddingVertical: 3,
              }}
            >
              <Text style={{ color: "#fff", fontSize: typography.caption, fontWeight: typography.weightBold }}>
                EMERGENCY
              </Text>
            </View>
          )}
        </View>

        <Text style={{ color: colors.muted, fontSize: typography.bodySm }}>
          {ticket.address}
        </Text>

        <View className="flex-row items-center justify-between" style={{ marginTop: spacing.tightSm }}>
          <View
            style={{ backgroundColor: getTicketTypeColor(ticket.ticketType), borderRadius: radius.pill, paddingHorizontal: spacing.sm, paddingVertical: 4 }}
          >
            <Text
              className="font-semibold"
              style={{ color: colors.bg, fontSize: typography.caption }}
              numberOfLines={1}
            >
              {formatTicketType(ticket.ticketType)}
            </Text>
          </View>
          <Text style={{ color: colors.muted, fontSize: typography.bodySm }}>
            {customers.length} utilit{customers.length !== 1 ? "ies" : "y"}
          </Text>
        </View>

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
            ) : null}

            {/* Overview: address + Open Map */}
            <SectionCard title="Location">
              <Text style={{ color: colors.text, fontSize: typography.body }}>
                {ticket.address}
              </Text>
              <Pressable
                onPress={() => {
                  const encodedAddress = encodeURIComponent(ticket.address);
                  const primaryUrl =
                    Platform.OS === "ios"
                      ? `maps:0,0?q=${encodedAddress}`
                      : `geo:0,0?q=${encodedAddress}`;
                  const fallbackUrl = `https://www.google.com/maps/search/?api=1&query=${encodedAddress}`;
                  Linking.canOpenURL(primaryUrl).then((canOpen) => {
                    Linking.openURL(canOpen ? primaryUrl : fallbackUrl);
                  });
                }}
                hitSlop={8}
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  gap: 6,
                  marginTop: spacing.tightSm,
                  backgroundColor: colors.bg,
                  borderRadius: radius.button,
                  paddingHorizontal: spacing.normal,
                  paddingVertical: spacing.tight,
                  alignSelf: "flex-start",
                }}
              >
                <Ionicons name="map" size={16} color={colors.accent} />
                <Text style={{ color: colors.accent, fontSize: typography.metadata, fontWeight: typography.weightSemibold }}>
                  Open Map
                </Text>
              </Pressable>
            </SectionCard>

            {/* Due: "Today · 2:40 PM" + "1h 12m remaining" */}
            <SectionCard title="Due">
              <Text style={{ color: colors.text, fontSize: typography.body }}>
                {getDueLabel(ticket.dueAt)}
              </Text>
              {(() => {
                const remainingLabel = getDueRemainingLabel(ticket.dueAt);
                const urgencyBucket = getDueUrgencyBucket(ticket.dueAt);
                const urgencyColor = getDueAccentColorFromTimestamp(ticket.dueAt);
                if (remainingLabel) {
                  return (
                    <Text style={{ color: urgencyColor, fontSize: typography.metadata, fontWeight: typography.weightSemibold, marginTop: 4 }}>
                      {remainingLabel}
                    </Text>
                  );
                }
                if (urgencyBucket === "overdue") {
                  return (
                    <Text style={{ color: urgencyColor, fontSize: typography.metadata, fontWeight: typography.weightBold, marginTop: 4 }}>
                      OVERDUE
                    </Text>
                  );
                }
                return null;
              })()}
              {ticket.originalDueAt && ticket.originalDueAt !== ticket.dueAt && (
                <Text
                  style={{ color: colors.muted, fontSize: typography.metadata, marginTop: 4 }}
                >
                  Original: {formatDueDateTime(ticket.originalDueAt)}
                </Text>
              )}
            </SectionCard>

            {/* Contractor: name + phone (tappable) + email (tappable) */}
            {(contractor || contractorPhone || contactName || contactEmail) && (
              <SectionCard title="Contact">
                <View style={{ gap: spacing.sectionSm }}>
                  {contractor ? (
                    <View>
                      <Text
                        className="font-semibold"
                        style={{ color: colors.muted, fontSize: typography.metadata }}
                      >
                        Contractor
                      </Text>
                      <Text style={{ color: colors.text, fontSize: typography.body, marginTop: 4 }}>
                        {contractor}
                      </Text>
                      {contractorPhone ? (
                        <Pressable
                          onPress={() => {
                            const cleanPhone = contractorPhone.replace(/[^0-9]/g, "");
                            Linking.openURL(`tel:${cleanPhone}`);
                          }}
                          hitSlop={8}
                          style={{ flexDirection: "row", alignItems: "center", gap: 6, marginTop: 4 }}
                        >
                          <Ionicons name="call" size={14} color={colors.accent} />
                          <Text style={{ color: colors.accent, fontSize: typography.bodySm, textDecorationLine: "underline" }}>
                            {contractorPhone}
                          </Text>
                        </Pressable>
                      ) : null}
                    </View>
                  ) : null}

                  {contactName ? (
                    <View>
                      <Text
                        className="font-semibold"
                        style={{ color: colors.muted, fontSize: typography.metadata }}
                      >
                        Contact Name
                      </Text>
                      <Text style={{ color: colors.text, fontSize: typography.body, marginTop: 4 }}>
                        {contactName}
                      </Text>
                    </View>
                  ) : null}

                  {contactEmail ? (
                    <View>
                      <Text
                        className="font-semibold"
                        style={{ color: colors.muted, fontSize: typography.metadata }}
                      >
                        Contact Email
                      </Text>
                      <Pressable
                        onPress={() => {
                          const subject = encodeURIComponent(`Ticket ${ticket.ticketNumber} - ${ticket.address}`);
                          const body = encodeURIComponent(
                            `Ticket: ${ticket.ticketNumber}\nAddress: ${ticket.address}\nWork Type: ${workType || "N/A"}\n\n`,
                          );
                          Linking.openURL(`mailto:${contactEmail}?subject=${subject}&body=${body}`);
                        }}
                        hitSlop={8}
                        style={{ flexDirection: "row", alignItems: "center", gap: 6, marginTop: 4 }}
                      >
                        <Ionicons name="mail" size={14} color={colors.accent} />
                        <Text style={{ color: colors.accent, fontSize: typography.bodySm, textDecorationLine: "underline" }}>
                          {contactEmail}
                        </Text>
                      </Pressable>
                    </View>
                  ) : null}
                </View>
              </SectionCard>
            )}

            {/* Work Type */}
            {workType && (
              <SectionCard title="Work Type">
                <Text style={{ color: colors.text, fontSize: typography.body }}>
                  {workType}
                </Text>
              </SectionCard>
            )}

            {/* Marking Instructions */}
            {markingInstructions && (
              <SectionCard title="Marking Instructions">
                <Text style={{ color: colors.text, fontSize: typography.body }}>
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
              currentTechName={user?.name}
              onScrollHandlersReady={setScrollHandlers}
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

      {showStickyActionBar && (
        <StickyActionBar
          locatorStatus={ticket.locatorStatus}
          isReadOnly={isReadOnly}
          allCustomersCompleted={allCustomersCompleted}
          bottomInset={Math.max(insets.bottom, keyboardHeight)}
          onEnroute={() => handleStatusChange("ENROUTE")}
          onOnsite={() => handleStatusChange("ONSITE")}
          onPause={() => handleStatusChange("PAUSED")}
          onClose={() => {
            triggerSuccessHaptic();
            handleStatusChange("CLOSED");
          }}
          onCustomerWork={() => setTab("CUSTOMER")}
        />
      )}

      <AllocationReconcileModal
        visible={showReconcileModal}
        onClose={() => setShowReconcileModal(false)}
        onConfirm={(updatedMarking) => {
          setCustomerMarking(updatedMarking);
          setShowReconcileModal(false);
          // Set the skip flag so handleStatusChange("CLOSED") doesn't
          // re-trigger the reconcile modal.  The marking has already
          // been adjusted by the user.
          skipReconcileRef.current = true;
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
    </KeyboardAvoidingView>
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
