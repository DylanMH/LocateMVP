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
import { getAllocatableMinutes, type TicketPayload } from "../utils/ticketTime";
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

interface CustomersTabProps {
  customers: Customer[];
  value: CustomerMarkingByCustomerId;
  onChange: (next: CustomerMarkingByCustomerId) => void;
  ticketStatus: TicketStatus;
  locatorStatus?: LocatorStatus;
  payload: TicketPayload;
  scrollViewRef?: React.RefObject<ScrollView | null>;
  isReadOnly?: boolean;
}

function getResultOptionsForStatus(status: MarkingStatus): MarkingResult[] {
  switch (status) {
    case "MARKED":
      return ["PAINT_AND_FLAG", "PAINT_ONLY"];
    case "NOT_MARKED":
      return ["EXCAVATION_SITE_CLEAR", "UNLOCATABLE", "NO_ACCESS"];
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
    case "EXCAVATION_SITE_CLEAR":
      return "Excavation Site Clear";
    case "UNLOCATABLE":
      return "Unlocatable";
    case "NO_ACCESS":
      return "No Access";
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

function formatMinutesAsHours(minutes: number): string {
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
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
  return value.replace(/\D/g, "");
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
}: CustomersTabProps) {
  const sectionOffsets = useRef<Record<string, number>>({});
  const [tick, setTick] = useState(0);
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

    onChange(patchCustomerMarking(value, customerId, { completed: true }));
  };

  const scrollToOffset = (y?: number) => {
    if (scrollViewRef?.current && typeof y === "number") {
      scrollViewRef.current.scrollTo({
        y: Math.max(0, y - 20),
        animated: true,
      });
    }
  };

  const scrollToSection = (customerId: string, offsetWithinSection = 0) => {
    scrollToOffset(sectionOffsets.current[customerId] + offsetWithinSection);
  };

  return (
    <View onLayout={initMissing}>
      {!isClosed && (
        <Text className="text-sm mb-4" style={{ color: colors.muted }}>
          {isOnsite
            ? "Select marking status and result for each customer."
            : "You must be on site to enter customer data."}
        </Text>
      )}

      {payload.onsiteStartedAt && (
        <View
          className="rounded-xl p-4 mb-4"
          style={{ backgroundColor: colors.surface }}
        >
          <Text
            className="text-xs font-semibold mb-2"
            style={{ color: colors.muted }}
          >
            Time Allocation
          </Text>
          <View className="flex-row items-center justify-between">
            <View>
              <Text className="text-sm" style={{ color: colors.text }}>
                Allocatable: {formatMinutesAsHours(allocatableMinutes)}
              </Text>
              <Text className="text-sm mt-1" style={{ color: colors.text }}>
                Allocated: {formatMinutesAsHours(allocatedMinutes)}
              </Text>
            </View>
            <View className="items-end">
              <Text className="text-xs" style={{ color: colors.muted }}>
                Remaining
              </Text>
              <Text
                className="text-2xl font-bold"
                style={{
                  color: remainingMinutes < 0 ? colors.danger : colors.accent,
                }}
              >
                {formatMinutesAsHours(Math.abs(remainingMinutes))}
              </Text>
              {remainingMinutes < 0 && (
                <Text className="text-xs mt-1" style={{ color: colors.danger }}>
                  Over-allocated
                </Text>
              )}
            </View>
          </View>
        </View>
      )}

      <View style={{ gap: 12 }}>
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
            (data.completed && remainingMinutes <= 0);

          return (
            <View
              key={customer.id}
              onLayout={(event) => {
                sectionOffsets.current[customer.id] = event.nativeEvent.layout.y;
              }}
              className="rounded-2xl p-4"
              style={{
                backgroundColor: data.completed ? colors.bg : colors.surface,
                borderLeftWidth: 4,
                borderLeftColor: getUtilityColor(customer.utility),
                opacity: data.completed ? 0.6 : 1,
              }}
            >
              <View className="flex-row items-center justify-between">
                <Text
                  className="text-base font-semibold"
                  style={{ color: colors.text }}
                >
                  {customer.name}
                </Text>
                {data.completed && (
                  <Ionicons
                    name="checkmark-circle"
                    size={24}
                    color={colors.success}
                  />
                )}
              </View>

              <Text className="text-xs mt-1" style={{ color: colors.muted }}>
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
                  <View
                    onLayout={(event) => {
                      const localY = event.nativeEvent.layout.y;
                      setTimeout(() => scrollToSection(customer.id, localY), 100);
                    }}
                  >
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
                      setTimeout(() => scrollToSection(customer.id, localY), 100);
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
            </View>
          );
        })}
      </View>
    </View>
  );
}
