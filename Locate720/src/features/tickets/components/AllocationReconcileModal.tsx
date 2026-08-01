import { useState } from "react";
import { Modal, Pressable, ScrollView, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";

import { colors } from "../../../ui/colors";
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

  const allocatedMinutes = Object.values(marking).reduce((sum, data) => {
    const mins = parseInt(data.minutes || "0", 10);
    return sum + (isNaN(mins) ? 0 : mins);
  }, 0);

  const remainingMinutes = initialRemaining + (Object.values(currentMarking).reduce((sum, data) => {
    const mins = parseInt(data.minutes || "0", 10);
    return sum + (isNaN(mins) ? 0 : mins);
  }, 0) - allocatedMinutes);

  const canConfirm = remainingMinutes === 0;

  const handleAdjust = (customerId: string, delta: number) => {
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
          <View className="flex-row items-center justify-between mb-4">
            <Text className="text-xl font-bold" style={{ color: colors.text }}>
              Allocate Remaining Time
            </Text>
            <Pressable onPress={onClose}>
              <Ionicons name="close" size={28} color={colors.text} />
            </Pressable>
          </View>

          <View className="rounded-xl p-4 mb-4" style={{ backgroundColor: colors.surface }}>
            <View className="flex-row items-center justify-between">
              <Text className="text-sm" style={{ color: colors.muted }}>
                Remaining Minutes
              </Text>
              <Text 
                className="text-2xl font-bold" 
                style={{ color: remainingMinutes === 0 ? colors.success : colors.accent }}
              >
                {remainingMinutes}
              </Text>
            </View>
          </View>

          <Text className="text-sm mb-3" style={{ color: colors.muted }}>
            Adjust allocated time for each customer to distribute all remaining minutes.
          </Text>

          <ScrollView className="mb-4" style={{ maxHeight: 400 }}>
            <View style={{ gap: 12 }}>
              {customers.map((c) => {
                const data = marking[c.id];
                if (!data) return null;

                const minutes = parseInt(data.minutes || "0", 10);

                return (
                  <View
                    key={c.id}
                    className="rounded-xl p-4"
                    style={{ backgroundColor: colors.surface }}
                  >
                    <Text className="text-sm font-semibold mb-3" style={{ color: colors.text }}>
                      {c.name}
                    </Text>
                    <View className="flex-row items-center justify-between">
                      <Pressable
                        onPress={() => handleAdjust(c.id, -5)}
                        className="rounded-lg px-3 py-2"
                        style={{ backgroundColor: colors.bg }}
                        disabled={minutes <= 0}
                      >
                        <Text className="text-lg font-bold" style={{ color: minutes <= 0 ? colors.muted : colors.text }}>
                          -5
                        </Text>
                      </Pressable>

                      <Pressable
                        onPress={() => handleAdjust(c.id, -1)}
                        className="rounded-lg px-3 py-2"
                        style={{ backgroundColor: colors.bg }}
                        disabled={minutes <= 0}
                      >
                        <Text className="text-lg font-bold" style={{ color: minutes <= 0 ? colors.muted : colors.text }}>
                          -1
                        </Text>
                      </Pressable>

                      <View className="px-4">
                        <Text className="text-xl font-bold text-center" style={{ color: colors.text }}>
                          {minutes} min
                        </Text>
                      </View>

                      <Pressable
                        onPress={() => handleAdjust(c.id, 1)}
                        className="rounded-lg px-3 py-2"
                        style={{ backgroundColor: colors.bg }}
                      >
                        <Text className="text-lg font-bold" style={{ color: colors.text }}>
                          +1
                        </Text>
                      </Pressable>

                      <Pressable
                        onPress={() => handleAdjust(c.id, 5)}
                        className="rounded-lg px-3 py-2"
                        style={{ backgroundColor: colors.bg }}
                      >
                        <Text className="text-lg font-bold" style={{ color: colors.text }}>
                          +5
                        </Text>
                      </Pressable>
                    </View>
                  </View>
                );
              })}
            </View>
          </ScrollView>

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
