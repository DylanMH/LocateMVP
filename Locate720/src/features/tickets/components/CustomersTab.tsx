import { useEffect, useMemo, useRef, useState } from "react";
import {
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";

import { colors } from "../../../ui/colors";
import { spacing } from "../../../ui/spacing";
import { typography } from "../../../ui/typography";
import { radius } from "../../../ui/radius";
import { getAllocatableMinutes, type TicketPayload } from "../utils/ticketTime";
import { formatDuration } from "../../../utils/formatDuration";
import type { LocatorStatus } from "../domain/statusMachine";
import type {
  Customer,
  CustomerMarkingByCustomerId,
  CustomerMarkingData,
  MarkingResult,
  MarkingStatus,
  TicketStatus,
} from "../types";
import { getUtilityColor } from "../utils/ticketPresentation";

export type { CustomerMarkingByCustomerId, CustomerMarkingData };

export type ScrollHandlers = {
  onScrollBeginDrag: () => void;
  onScrollEndDrag: () => void;
  onMomentumScrollEnd: () => void;
};

interface CustomersTabProps {
  customers: Customer[];
  value: CustomerMarkingByCustomerId;
  onChange: (next: CustomerMarkingByCustomerId) => void;
  ticketStatus: TicketStatus;
  locatorStatus?: LocatorStatus;
  payload: TicketPayload;
  scrollViewRef?: React.RefObject<ScrollView | null>;
  isReadOnly?: boolean;
  currentTechName?: string;
  onScrollHandlersReady?: (handlers: ScrollHandlers) => void;
}

interface TimeAllocationCardProps {
  allocatableMinutes: number;
  allocatedMinutes: number;
  remainingMinutes: number;
}

export function TimeAllocationCard({
  allocatableMinutes,
  allocatedMinutes,
  remainingMinutes,
}: TimeAllocationCardProps) {
  return (
    <View
      className="rounded-xl px-4 py-3 mx-4 mt-2"
      style={{
        backgroundColor: colors.surface,
        borderWidth: 1,
        borderColor: remainingMinutes < 0 ? colors.danger : colors.primary + "30",
        shadowColor: "#000",
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.15,
        shadowRadius: 4,
        elevation: 4,
      }}
    >
      <View className="flex-row items-center justify-between">
        <View>
          <Text
            className="text-[11px] font-semibold uppercase tracking-wider mb-1"
            style={{ color: colors.muted }}
          >
            Time Allocation
          </Text>
          <Text className="text-xs" style={{ color: colors.text }}>
            Allocatable: {formatDuration(allocatableMinutes * 60 * 1000)}
          </Text>
          <Text className="text-xs mt-0.5" style={{ color: colors.text }}>
            Allocated: {formatDuration(allocatedMinutes * 60 * 1000)}
          </Text>
        </View>
        <View className="items-end">
          <Text className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: colors.muted }}>
            Remaining
          </Text>
          <Text
            className="text-xl font-bold"
            style={{
              color: remainingMinutes < 0 ? colors.danger : colors.accent,
            }}
          >
            {formatDuration(Math.abs(remainingMinutes) * 60 * 1000)}
          </Text>
          {remainingMinutes < 0 && (
            <Text className="text-[10px] font-bold mt-0.5" style={{ color: colors.danger }}>
              Over-allocated
            </Text>
          )}
        </View>
      </View>
    </View>
  );
}

function getResultOptionsForStatus(status: MarkingStatus): MarkingResult[] {
  switch (status) {
    case "MARKED":
      return ["PAINT_AND_FLAG", "PAINT_ONLY", "FLAG_ONLY"];
    case "NOT_MARKED":
      return [
        "EXCAVATION_SITE_CLEAR",
        "UNLOCATABLE",
        "NO_ACCESS",
        "OVERHEAD_NO_FACILITIES",
      ];
    case "NOT_YET_MARKED":
      return ["MEETING_WITH_CONTRACTOR"];
    default:
      return [];
  }
}

function formatMarkingResult(result: MarkingResult): string {
  switch (result) {
    case "PAINT_AND_FLAG":
      return "Paint and Flag";
    case "PAINT_ONLY":
      return "Paint Only";
    case "FLAG_ONLY":
      return "Flag Only";
    case "EXCAVATION_SITE_CLEAR":
      return "Excavation Site Clear";
    case "UNLOCATABLE":
      return "Unlocatable";
    case "NO_ACCESS":
      return "No Access";
    case "OVERHEAD_NO_FACILITIES":
      return "Overhead / No Facilities";
    case "MEETING_WITH_CONTRACTOR":
      return "Meeting with Contractor";
    default:
      return "";
  }
}

function formatMarkingStatus(status: MarkingStatus): string {
  switch (status) {
    case "MARKED":
      return "Marked";
    case "NOT_MARKED":
      return "Not Marked";
    case "NOT_YET_MARKED":
      return "Not Yet Marked";
    default:
      return "";
  }
}

function createEmptyCustomerMarking(
  overrides: Partial<CustomerMarkingData> = {},
): CustomerMarkingData {
  return {
    status: "",
    result: "",
    minutes: "",
    footage: "",
    completed: false,
    ...overrides,
  };
}

function patchCustomerMarking(
  value: CustomerMarkingByCustomerId,
  customerId: string,
  updates: Partial<CustomerMarkingData>,
): CustomerMarkingByCustomerId {
  return {
    ...value,
    [customerId]: {
      ...createEmptyCustomerMarking(),
      ...value[customerId],
      ...updates,
    },
  };
}

function getAllocatedMinutes(value: CustomerMarkingByCustomerId): number {
  return Object.values(value).reduce((sum, data) => {
    const mins = parseInt(data.minutes || "0", 10);
    return sum + (isNaN(mins) ? 0 : mins);
  }, 0);
}

function isCustomerMarkingComplete(
  data: CustomerMarkingData,
  wouldExceedTime: boolean,
): boolean {
  return Boolean(
    data.status &&
      data.result &&
      data.minutes &&
      (data.status !== "MARKED" || data.footage) &&
      !wouldExceedTime,
  );
}

function sanitizeNumericInput(value: string) {
  const digits = value.replace(/\D/g, "");
  if (!digits) return "";
  // Strip leading zeroes so user typing "5" doesn't produce "05"
  return String(parseInt(digits, 10));
}

export function CustomersTab({
  customers,
  value,
  onChange,
  ticketStatus,
  locatorStatus,
  payload,
  scrollViewRef,
  isReadOnly = false,
  currentTechName,
  onScrollHandlersReady,
}: CustomersTabProps) {
  const sectionOffsets = useRef<Record<string, number>>({});
  const inputOffsets = useRef<Record<string, number>>({});
  const rootYInScroll = useRef(0);
  const isUserScrollingRef = useRef(false);
  const lastAutoScrollTargetRef = useRef<number | null>(null);
  const pendingScrollTargetRef = useRef<number | null>(null);
  const [tick, setTick] = useState(0);
  const [expandedCompleted, setExpandedCompleted] = useState<Set<string>>(new Set());
  const isOnsite = locatorStatus === "ONSITE";
  const isClosed =
    ticketStatus === "CLOSED" ||
    locatorStatus === "CLOSED" ||
    locatorStatus === "UNABLE";
  const isPaused = locatorStatus === "PAUSED";

  useEffect(() => {
    if (!isOnsite || isPaused || isClosed) return;

    setTick((prev) => prev + 1);

    const interval = setInterval(() => {
      setTick((prev) => prev + 1);
    }, 10000);

    return () => clearInterval(interval);
  }, [isOnsite, isPaused, isClosed, locatorStatus]);

  const allocatableMinutes = useMemo(() => {
    const _ = tick;
    return getAllocatableMinutes(payload, locatorStatus || "");
  }, [payload, locatorStatus, tick]);

  const allocatedMinutes = getAllocatedMinutes(value);
  const remainingMinutes = allocatableMinutes - allocatedMinutes;

  const initMissing = () => {
    let changed = false;
    const next: CustomerMarkingByCustomerId = { ...value };

    for (const customer of customers) {
      if (!next[customer.id]) {
        next[customer.id] = createEmptyCustomerMarking();
        changed = true;
      }
    }

    if (changed) {
      onChange(next);
    }
  };

  const handleSubmit = (customerId: string) => {
    const data = value[customerId];
    if (!data?.status || !data?.result || !data?.minutes) return;
    if (data.status === "MARKED" && !data.footage) return;

    onChange(patchCustomerMarking(value, customerId, {
      completed: true,
      closedByTechName: currentTechName || undefined,
    }));

    // Find next uncompleted customer and auto-scroll to it
    const currentIndex = customers.findIndex((c) => c.id === customerId);
    const nextUncompleted = customers
      .slice(currentIndex + 1)
      .find((c) => !value[c.id]?.completed);

    if (nextUncompleted) {
      setTimeout(() => {
        scrollToSection(nextUncompleted.id);
      }, 150);
    }
  };

  const scrollToOffset = (y?: number) => {
    if (scrollViewRef?.current && typeof y === "number") {
      scrollViewRef.current.scrollTo({
        y: Math.max(0, y - 60),
        animated: true,
      });
    }
  };

  const scrollToSection = (customerId: string, offsetWithinSection = 0) => {
    const absoluteY =
      rootYInScroll.current +
      (sectionOffsets.current[customerId] || 0) +
      offsetWithinSection;

    if (isUserScrollingRef.current) {
      pendingScrollTargetRef.current = absoluteY;
      return;
    }

    if (lastAutoScrollTargetRef.current === absoluteY) {
      return;
    }

    lastAutoScrollTargetRef.current = absoluteY;
    scrollToOffset(absoluteY);
  };

  const scrollToInput = (key: string) => {
    const absoluteY = rootYInScroll.current + (inputOffsets.current[key] || 0);
    if (scrollViewRef?.current) {
      // Scroll so the input is visible above the keyboard
      scrollViewRef.current.scrollTo({
        y: Math.max(0, absoluteY - 120),
        animated: true,
      });
    }
  };

  const handleScrollBeginDrag = () => {
    isUserScrollingRef.current = true;
  };

  const handleScrollEndDrag = () => {
    // Don't clear immediately — wait for momentum to end
  };

  const handleMomentumScrollEnd = () => {
    isUserScrollingRef.current = false;
    if (pendingScrollTargetRef.current !== null) {
      const target = pendingScrollTargetRef.current;
      pendingScrollTargetRef.current = null;
      lastAutoScrollTargetRef.current = target;
      scrollToOffset(target);
    }
  };

  useEffect(() => {
    onScrollHandlersReady?.({
      onScrollBeginDrag: handleScrollBeginDrag,
      onScrollEndDrag: handleScrollEndDrag,
      onMomentumScrollEnd: handleMomentumScrollEnd,
    });
  }, []);

  return (
    <View
      onLayout={(event) => {
        rootYInScroll.current = event.nativeEvent.layout.y;
        initMissing();
      }}
    >
      {!isClosed && (
        <Text className="text-sm mb-4" style={{ color: colors.muted }}>
          {isOnsite
            ? "Select marking status and result for each customer."
            : "You must be on site to enter customer data."}
        </Text>
      )}

      {/* Customer progress bar */}
      {customers.length > 0 && (
        <View
          style={{
            backgroundColor: colors.surface,
            borderRadius: radius.card,
            padding: spacing.card,
            marginBottom: spacing.normal,
          }}
        >
          <View className="flex-row items-center justify-between" style={{ marginBottom: spacing.tightSm }}>
            <Text className="font-bold" style={{ color: colors.text, fontSize: typography.sectionSm }}>
              Customers
            </Text>
            <Text style={{ color: colors.muted, fontSize: typography.metadata }}>
              {customers.filter((c) => value[c.id]?.completed === true).length} of {customers.length} complete
            </Text>
          </View>
          {/* Progress bar */}
          <View
            style={{
              height: 8,
              backgroundColor: colors.bg,
              borderRadius: 4,
              overflow: "hidden",
            }}
          >
            <View
              style={{
                height: "100%",
                width: `${customers.length > 0 ? (customers.filter((c) => value[c.id]?.completed === true).length / customers.length) * 100 : 0}%`,
                backgroundColor: colors.success,
                borderRadius: 4,
              }}
            />
          </View>
          {/* Time allocation summary */}
          {Boolean(payload.onsiteStartedAt) && (
            <View className="flex-row" style={{ marginTop: spacing.tightSm, gap: spacing.normal }}>
              <View className="flex-1">
                <Text style={{ color: colors.muted, fontSize: typography.caption }}>
                  Onsite
                </Text>
                <Text style={{ color: colors.text, fontSize: typography.metadata, fontWeight: typography.weightSemibold }}>
                  {formatDuration(allocatableMinutes * 60 * 1000)}
                </Text>
              </View>
              <View className="flex-1">
                <Text style={{ color: colors.muted, fontSize: typography.caption }}>
                  Allocated
                </Text>
                <Text style={{ color: colors.text, fontSize: typography.metadata, fontWeight: typography.weightSemibold }}>
                  {formatDuration(allocatedMinutes * 60 * 1000)}
                </Text>
              </View>
              <View className="flex-1">
                <Text style={{ color: colors.muted, fontSize: typography.caption }}>
                  Remaining
                </Text>
                <Text
                  style={{
                    color: remainingMinutes < 0 ? colors.danger : colors.accent,
                    fontSize: typography.metadata,
                    fontWeight: typography.weightBold,
                  }}
                >
                  {formatDuration(Math.abs(remainingMinutes) * 60 * 1000)}
                </Text>
              </View>
            </View>
          )}
        </View>
      )}

      <View style={{ gap: spacing.normal }}>
        {customers.map((customer) => {
          const data = value[customer.id] ?? createEmptyCustomerMarking();
          const resultOptions = getResultOptionsForStatus(data.status);
          const wouldExceedTime =
            Boolean(payload.onsiteStartedAt) && remainingMinutes < 0;
          const isComplete = isCustomerMarkingComplete(data, wouldExceedTime);
          const isDisabled =
            isReadOnly ||
            isClosed ||
            !isOnsite ||
            data.completed === true;
          const isCollapsedCompleted =
            data.completed === true && !expandedCompleted.has(customer.id);

          return (
            <View
              key={customer.id}
              onLayout={(event) => {
                sectionOffsets.current[customer.id] = event.nativeEvent.layout.y;
              }}
              className="rounded-2xl"
              style={{
                backgroundColor: data.completed ? colors.bg : colors.surface,
                borderLeftWidth: 4,
                borderLeftColor: getUtilityColor(customer.utility),
                padding: spacing.card,
                opacity: data.completed ? 0.85 : 1,
              }}
            >
              {/* Collapsed completed summary */}
              {isCollapsedCompleted ? (
                <Pressable
                  onPress={() => {
                    setExpandedCompleted((prev) => {
                      const next = new Set(prev);
                      next.add(customer.id);
                      return next;
                    });
                  }}
                  hitSlop={8}
                >
                  <View className="flex-row items-center justify-between">
                    <View className="flex-1" style={{ marginRight: spacing.sm }}>
                      <View className="flex-row items-center" style={{ gap: 6 }}>
                        <Ionicons name="checkmark-circle" size={20} color={colors.success} />
                        <Text className="font-semibold" style={{ color: colors.text, fontSize: typography.bodySm }}>
                          {customer.utility === "ELECTRIC" ? "Electric" :
                           customer.utility === "GAS" ? "Gas" :
                           customer.utility === "FIBER" ? "Fiber" :
                           customer.utility === "COPPER" ? "Copper" :
                           customer.utility === "WATER" ? "Water" :
                           customer.utility === "SEWER" ? "Sewer" : customer.name} — {formatMarkingStatus(data.status)}
                        </Text>
                      </View>
                      <Text style={{ color: colors.muted, fontSize: typography.metadata, marginTop: 4 }}>
                        {data.minutes ? `${data.minutes} min` : "0 min"}
                        {data.footage ? ` · ${data.footage} ft` : ""}
                      </Text>
                    </View>
                    <Pressable
                      onPress={() => {
                        setExpandedCompleted((prev) => {
                          const next = new Set(prev);
                          next.add(customer.id);
                          return next;
                        });
                      }}
                      hitSlop={8}
                      style={{
                        backgroundColor: colors.surface,
                        borderRadius: radius.buttonSm,
                        paddingHorizontal: spacing.normal,
                        paddingVertical: spacing.tight,
                      }}
                    >
                      <Text style={{ color: colors.accent, fontSize: typography.metadata, fontWeight: typography.weightSemibold }}>
                        Edit
                      </Text>
                    </Pressable>
                  </View>
                </Pressable>
              ) : (
                <>
              <View className="flex-row items-center justify-between">
                <View className="flex-row items-center flex-1" style={{ gap: 6 }}>
                  {data.completed && (
                    <Ionicons
                      name="checkmark-circle"
                      size={20}
                      color={colors.success}
                    />
                  )}
                  <Text
                    className="font-semibold"
                    style={{ color: colors.text, fontSize: typography.body, flexShrink: 1 }}
                  >
                    {customer.name}
                  </Text>
                </View>
                {data.completed && (
                  <View className="flex-row items-center" style={{ gap: 4 }}>
                    {data.closedByTechName && (
                      <Text style={{ color: colors.muted, fontSize: typography.captionSm }}>
                        by {data.closedByTechName}
                      </Text>
                    )}
                    <Pressable
                      onPress={() => {
                        setExpandedCompleted((prev) => {
                          const next = new Set(prev);
                          next.delete(customer.id);
                          return next;
                        });
                      }}
                      hitSlop={8}
                    >
                      <Text style={{ color: colors.muted, fontSize: typography.caption, fontWeight: typography.weightSemibold }}>
                        Collapse
                      </Text>
                    </Pressable>
                  </View>
                )}
              </View>

              <Text style={{ color: colors.muted, fontSize: typography.metadata, marginTop: 4 }}>
                {`${customer.accountNumber} | ${customer.utility}`}
              </Text>

              <Pressable onPress={() => {}} hitSlop={8} className="mt-2">
                <Text
                  className="text-xs"
                  style={{
                    color: colors.accent,
                    textDecorationLine: "underline",
                  }}
                >
                  Prints
                </Text>
              </Pressable>

              {isClosed && data.status && (
                <View
                  className="mt-3 p-3 rounded-xl"
                  style={{ backgroundColor: colors.bg }}
                >
                  <View style={{ gap: 8 }}>
                    <View className="flex-row items-center justify-between">
                      <Text
                        className="text-xs font-semibold"
                        style={{ color: colors.muted }}
                      >
                        Status:
                      </Text>
                      <Text className="text-sm" style={{ color: colors.text }}>
                        {formatMarkingStatus(data.status)}
                      </Text>
                    </View>
                    {data.result && (
                      <View className="flex-row items-center justify-between">
                        <Text
                          className="text-xs font-semibold"
                          style={{ color: colors.muted }}
                        >
                          Result:
                        </Text>
                        <Text className="text-sm" style={{ color: colors.text }}>
                          {formatMarkingResult(data.result)}
                        </Text>
                      </View>
                    )}
                    {data.minutes && (
                      <View className="flex-row items-center justify-between">
                        <Text
                          className="text-xs font-semibold"
                          style={{ color: colors.muted }}
                        >
                          Time:
                        </Text>
                        <Text className="text-sm" style={{ color: colors.text }}>
                          {data.minutes} minutes
                        </Text>
                      </View>
                    )}
                    {data.footage && (
                      <View className="flex-row items-center justify-between">
                        <Text
                          className="text-xs font-semibold"
                          style={{ color: colors.muted }}
                        >
                          Footage:
                        </Text>
                        <Text className="text-sm" style={{ color: colors.text }}>
                          {data.footage} ft
                        </Text>
                      </View>
                    )}
                  </View>
                </View>
              )}

              <View className="mt-4" style={{ gap: 12 }}>
                <View>
                  <Text
                    className="text-xs font-semibold mb-2"
                    style={{ color: colors.muted }}
                  >
                    Marking Status
                  </Text>
                  <View className="flex-row flex-wrap" style={{ gap: 8 }}>
                    <Pressable
                      disabled={isDisabled}
                      onPress={() => {
                        onChange(
                          patchCustomerMarking(
                            value,
                            customer.id,
                            createEmptyCustomerMarking({ status: "MARKED" }),
                          ),
                        );
                      }}
                      className="rounded-xl px-4 py-2"
                      style={{
                        backgroundColor:
                          data.status === "MARKED" ? colors.primary : colors.bg,
                        borderWidth: 1,
                        borderColor:
                          data.status === "MARKED"
                            ? colors.primary
                            : colors.surface,
                        opacity: isDisabled ? 0.5 : 1,
                      }}
                    >
                      <Text
                        className="text-sm font-semibold text-center"
                        style={{ color: colors.text }}
                      >
                        Marked
                      </Text>
                    </Pressable>
                    <Pressable
                      disabled={isDisabled}
                      onPress={() => {
                        onChange(
                          patchCustomerMarking(
                            value,
                            customer.id,
                            createEmptyCustomerMarking({
                              status: "NOT_MARKED",
                              minutes: "0",
                            }),
                          ),
                        );
                      }}
                      className="rounded-xl px-4 py-2"
                      style={{
                        backgroundColor:
                          data.status === "NOT_MARKED"
                            ? colors.primary
                            : colors.bg,
                        borderWidth: 1,
                        borderColor:
                          data.status === "NOT_MARKED"
                            ? colors.primary
                            : colors.surface,
                        opacity: isDisabled ? 0.5 : 1,
                      }}
                    >
                      <Text
                        className="text-sm font-semibold text-center"
                        style={{ color: colors.text }}
                      >
                        Not Marked
                      </Text>
                    </Pressable>
                    <Pressable
                      disabled={isDisabled}
                      onPress={() => {
                        onChange(
                          patchCustomerMarking(
                            value,
                            customer.id,
                            createEmptyCustomerMarking({
                              status: "NOT_YET_MARKED",
                            }),
                          ),
                        );
                      }}
                      className="rounded-xl px-4 py-2"
                      style={{
                        backgroundColor:
                          data.status === "NOT_YET_MARKED"
                            ? colors.primary
                            : colors.bg,
                        borderWidth: 1,
                        borderColor:
                          data.status === "NOT_YET_MARKED"
                            ? colors.primary
                            : colors.surface,
                        opacity: isDisabled ? 0.5 : 1,
                      }}
                    >
                      <Text
                        className="text-sm font-semibold text-center"
                        style={{ color: colors.text }}
                      >
                        Not Yet Marked
                      </Text>
                    </Pressable>
                  </View>
                </View>

                {data.status && resultOptions.length > 0 && (
                  <View>
                    <Text
                      className="text-xs font-semibold mb-2"
                      style={{ color: colors.muted }}
                    >
                      Marking Result
                    </Text>
                    <View className="flex-row flex-wrap" style={{ gap: 8 }}>
                      {resultOptions.map((option) => (
                        <Pressable
                          key={option}
                          disabled={isDisabled}
                          onPress={() => {
                            const updates: CustomerMarkingData = {
                              ...data,
                              result: option,
                              completed: false,
                            };

                            if (
                              option === "EXCAVATION_SITE_CLEAR" &&
                              !data.minutes
                            ) {
                              updates.minutes = "0";
                            }

                            onChange(
                              patchCustomerMarking(
                                value,
                                customer.id,
                                updates,
                              ),
                            );
                          }}
                          className="rounded-xl px-4 py-2"
                          style={{
                            backgroundColor:
                              data.result === option
                                ? colors.primary
                                : colors.bg,
                            borderWidth: 1,
                            borderColor:
                              data.result === option
                                ? colors.primary
                                : colors.surface,
                            opacity: isDisabled ? 0.5 : 1,
                          }}
                        >
                          <Text
                            className="text-sm font-semibold text-center"
                            style={{ color: colors.text }}
                          >
                            {formatMarkingResult(option)}
                          </Text>
                        </Pressable>
                      ))}
                    </View>
                  </View>
                )}

                {data.result && (
                  <View
                    onLayout={(event) => {
                      const localY = event.nativeEvent.layout.y;
                      // Store the input section offset for this customer
                      // so we can scroll to it on focus
                      const customerSectionY =
                        sectionOffsets.current[customer.id] || 0;
                      inputOffsets.current[`${customer.id}-inputs`] =
                        customerSectionY + localY;
                    }}
                  >
                    <Text
                      className="text-xs font-semibold mb-2"
                      style={{ color: colors.muted }}
                    >
                      {data.status === "MARKED" ? "Time & Footage" : "Time"}
                    </Text>
                    <View className="flex-row" style={{ gap: 10 }}>
                      <View className="flex-1">
                        <TextInput
                          value={data.minutes || ""}
                          placeholder="Minutes"
                          placeholderTextColor={colors.muted}
                          keyboardType="numeric"
                          editable={!isDisabled && !isReadOnly}
                          onFocus={() => scrollToInput(`${customer.id}-inputs`)}
                          onChangeText={(text) =>
                            onChange(
                              patchCustomerMarking(value, customer.id, {
                                minutes: sanitizeNumericInput(text),
                                completed: false,
                              }),
                            )
                          }
                          className="rounded-xl px-3 py-2"
                          style={{
                            backgroundColor: colors.bg,
                            color: colors.text,
                            borderWidth: 1,
                            borderColor: colors.surface,
                            opacity: isDisabled || isReadOnly ? 0.5 : 1,
                          }}
                        />
                      </View>
                      {data.status === "MARKED" && (
                        <View className="flex-1">
                          <TextInput
                            value={data.footage || ""}
                            placeholder="Footage"
                            placeholderTextColor={colors.muted}
                            keyboardType="numeric"
                            editable={!isDisabled}
                            onFocus={() => scrollToInput(`${customer.id}-inputs`)}
                            onChangeText={(text) =>
                              onChange(
                                patchCustomerMarking(value, customer.id, {
                                  footage: sanitizeNumericInput(text),
                                  completed: false,
                                }),
                              )
                            }
                            className="rounded-xl px-3 py-2"
                            style={{
                              backgroundColor: colors.bg,
                              color: colors.text,
                              borderWidth: 1,
                              borderColor: colors.surface,
                              opacity: isDisabled ? 0.5 : 1,
                            }}
                          />
                        </View>
                      )}
                    </View>
                  </View>
                )}

                {isComplete && !data.completed && isOnsite && (
                  <Pressable
                    onPress={() => handleSubmit(customer.id)}
                    className="rounded-xl px-4 py-3 mt-2"
                    style={{ backgroundColor: colors.success }}
                  >
                    <Text
                      className="text-sm font-semibold text-center"
                      style={{ color: colors.text }}
                    >
                      Complete
                    </Text>
                  </Pressable>
                )}
              </View>
                </>
              )}
            </View>
          );
        })}
      </View>
    </View>
  );
}
