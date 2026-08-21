import { useEffect, useState } from "react";
import { Modal, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";

import { colors } from "../../../ui/colors";
import { typography } from "../../../ui/typography";
import { radius } from "../../../ui/radius";
import type { Customer, CustomerMarkingByCustomerId } from "../types";

interface AllocationReconcileModalProps {
  visible: boolean;
  onClose: () => void;
  onConfirm: (updatedMarking: CustomerMarkingByCustomerId) => void;
  customers: Customer[];
  currentMarking: CustomerMarkingByCustomerId;
  remainingMinutes: number;
}

export function AllocationReconcileModal({
  visible,
  onClose,
  onConfirm,
  customers,
  currentMarking,
  remainingMinutes: initialRemaining,
}: AllocationReconcileModalProps) {
  const [marking, setMarking] = useState<CustomerMarkingByCustomerId>(currentMarking);

  // Reset local state when the modal is opened or the source marking changes
  useEffect(() => {
    if (visible) {
      setMarking(currentMarking);
    }
  }, [visible, currentMarking]);

  const allocatedMinutes = Object.values(marking).reduce((sum, data) => {
    const mins = parseInt(data.minutes || "0", 10);
    return sum + (isNaN(mins) ? 0 : mins);
  }, 0);

  const remainingMinutes = initialRemaining + (Object.values(currentMarking).reduce((sum, data) => {
    const mins = parseInt(data.minutes || "0", 10);
    return sum + (isNaN(mins) ? 0 : mins);
  }, 0) - allocatedMinutes);

  const canConfirm = remainingMinutes === 0;

  const updateField = (customerId: string, field: "minutes" | "footage", rawValue: string) => {
    const current = marking[customerId];
    if (!current) return;

    // Allow empty string while editing; validate on confirm
    const sanitized = rawValue.replace(/[^\d]/g, "");

    setMarking({
      ...marking,
      [customerId]: {
        ...current,
        [field]: sanitized,
      },
    });
  };

  const adjustMinutes = (customerId: string, delta: number) => {
    const current = marking[customerId];
    if (!current) return;
    const currentMinutes = parseInt(current.minutes || "0", 10);
    const newMinutes = Math.max(0, currentMinutes + delta);
    setMarking({
      ...marking,
      [customerId]: {
        ...current,
        minutes: newMinutes.toString(),
      },
    });
  };

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent={true}
      onRequestClose={onClose}
    >
      <View className="flex-1" style={{ backgroundColor: 'rgba(0,0,0,0.5)' }}>
        <View
          className="mt-auto rounded-t-3xl p-6"
          style={{ backgroundColor: colors.bg, maxHeight: '85%' }}
        >
          {/* Header */}
          <View className="flex-row items-center justify-between mb-4">
            <View className="flex-1">
              <Text className="text-xl font-bold" style={{ color: colors.text }}>
                Allocate Remaining Time
              </Text>
              <Text className="text-sm mt-1" style={{ color: colors.muted }}>
                Review and adjust time/footage before closing
              </Text>
            </View>
            <Pressable onPress={onClose} hitSlop={12}>
              <Ionicons name="close" size={28} color={colors.text} />
            </Pressable>
          </View>

          {/* Remaining minutes banner */}
          <View
            className="rounded-xl p-4 mb-4 flex-row items-center justify-between"
            style={{
              backgroundColor: colors.surface,
              borderWidth: 1,
              borderColor: remainingMinutes === 0 ? colors.success + "40" : colors.accent + "40",
            }}
          >
            <View className="flex-row items-center" style={{ gap: 8 }}>
              <Ionicons
                name={remainingMinutes === 0 ? "checkmark-circle" : "time-outline"}
                size={22}
                color={remainingMinutes === 0 ? colors.success : colors.accent}
              />
              <Text className="text-sm font-semibold" style={{ color: colors.muted }}>
                Remaining Minutes
              </Text>
            </View>
            <Text
              className="text-2xl font-bold"
              style={{ color: remainingMinutes === 0 ? colors.success : colors.accent }}
            >
              {remainingMinutes}
            </Text>
          </View>

          {/* Customer list with editable time + footage */}
          <ScrollView className="mb-4" style={{ maxHeight: 400 }} keyboardShouldPersistTaps="handled">
            <View style={{ gap: 12 }}>
              {customers.map((c) => {
                const data = marking[c.id];
                if (!data) return null;

                const minutes = parseInt(data.minutes || "0", 10);
                const utilityLabel =
                  c.utility === "ELECTRIC" ? "Electric" :
                  c.utility === "GAS" ? "Gas" :
                  c.utility === "FIBER" ? "Fiber" :
                  c.utility === "WATER" ? "Water" :
                  c.utility === "SEWER" ? "Sewer" :
                  c.utility === "COPPER" ? "Copper" : c.name;

                return (
                  <View
                    key={c.id}
                    className="rounded-xl p-4"
                    style={{ backgroundColor: colors.surface }}
                  >
                    {/* Customer name + utility */}
                    <View className="flex-row items-center justify-between mb-3">
                      <View className="flex-row items-center flex-1" style={{ gap: 6 }}>
                        <Ionicons name="checkmark-circle" size={16} color={colors.success} />
                        <Text className="text-sm font-semibold" style={{ color: colors.text, flexShrink: 1 }}>
                          {utilityLabel}
                        </Text>
                      </View>
                      <Text className="text-xs" style={{ color: colors.muted }}>
                        {c.accountNumber}
                      </Text>
                    </View>

                    {/* Time row: -5 / -1 / input / +1 / +5 */}
                    <View className="flex-row items-center mb-3" style={{ gap: 8 }}>
                      <Text className="text-xs font-semibold" style={{ color: colors.muted, width: 50 }}>
                        Time
                      </Text>
                      <Pressable
                        onPress={() => adjustMinutes(c.id, -5)}
                        className="rounded-lg px-3 py-2"
                        style={{ backgroundColor: colors.bg }}
                        disabled={minutes <= 0}
                      >
                        <Text className="text-sm font-bold" style={{ color: minutes <= 0 ? colors.muted : colors.text }}>
                          -5
                        </Text>
                      </Pressable>
                      <Pressable
                        onPress={() => adjustMinutes(c.id, -1)}
                        className="rounded-lg px-3 py-2"
                        style={{ backgroundColor: colors.bg }}
                        disabled={minutes <= 0}
                      >
                        <Text className="text-sm font-bold" style={{ color: minutes <= 0 ? colors.muted : colors.text }}>
                          -1
                        </Text>
                      </Pressable>
                      <View
                        className="flex-1 flex-row items-center rounded-lg"
                        style={{ backgroundColor: colors.bg, paddingHorizontal: 8 }}
                      >
                        <TextInput
                          value={data.minutes || ""}
                          onChangeText={(v) => updateField(c.id, "minutes", v)}
                          keyboardType="numeric"
                          placeholder="0"
                          style={{
                            flex: 1,
                            color: colors.text,
                            fontSize: typography.body,
                            fontWeight: "bold",
                            paddingVertical: 8,
                            textAlign: "center",
                          }}
                        />
                        <Text className="text-xs" style={{ color: colors.muted }}>min</Text>
                      </View>
                      <Pressable
                        onPress={() => adjustMinutes(c.id, 1)}
                        className="rounded-lg px-3 py-2"
                        style={{ backgroundColor: colors.bg }}
                      >
                        <Text className="text-sm font-bold" style={{ color: colors.text }}>
                          +1
                        </Text>
                      </Pressable>
                      <Pressable
                        onPress={() => adjustMinutes(c.id, 5)}
                        className="rounded-lg px-3 py-2"
                        style={{ backgroundColor: colors.bg }}
                      >
                        <Text className="text-sm font-bold" style={{ color: colors.text }}>
                          +5
                        </Text>
                      </Pressable>
                    </View>

                    {/* Footage row: label + editable input */}
                    <View className="flex-row items-center" style={{ gap: 8 }}>
                      <Text className="text-xs font-semibold" style={{ color: colors.muted, width: 50 }}>
                        Footage
                      </Text>
                      <View
                        className="flex-1 flex-row items-center rounded-lg"
                        style={{ backgroundColor: colors.bg, paddingHorizontal: 8 }}
                      >
                        <TextInput
                          value={data.footage || ""}
                          onChangeText={(v) => updateField(c.id, "footage", v)}
                          keyboardType="numeric"
                          placeholder="0"
                          style={{
                            flex: 1,
                            color: colors.text,
                            fontSize: typography.body,
                            fontWeight: "bold",
                            paddingVertical: 8,
                            textAlign: "center",
                          }}
                        />
                        <Text className="text-xs" style={{ color: colors.muted }}>ft</Text>
                      </View>
                    </View>
                  </View>
                );
              })}
            </View>
          </ScrollView>

          {/* Action buttons */}
          <View className="flex-row" style={{ gap: 12 }}>
            <Pressable
              onPress={onClose}
              className="flex-1 rounded-xl px-4 py-3"
              style={{ backgroundColor: colors.surface }}
            >
              <Text className="text-sm font-semibold text-center" style={{ color: colors.text }}>
                Cancel
              </Text>
            </Pressable>

            <Pressable
              onPress={() => onConfirm(marking)}
              disabled={!canConfirm}
              className="flex-1 rounded-xl px-4 py-3"
              style={{
                backgroundColor: canConfirm ? colors.success : colors.muted,
                opacity: canConfirm ? 1 : 0.5,
              }}
            >
              <Text className="text-sm font-semibold text-center" style={{ color: colors.text }}>
                Confirm & Close Ticket
              </Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}
