import { useState } from "react";
import {
  View,
  Text,
  Modal,
  Pressable,
  TextInput,
  ActivityIndicator,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { colors } from "../../../ui/colors";
import type { AllocationType } from "../../../db/models/DaySession";

interface ReasonOption {
  value: AllocationType;
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
  description: string;
}

const REASON_OPTIONS: ReasonOption[] = [
  {
    value: "locating",
    label: "Locating",
    icon: "locate",
    description: "Field work — locating utilities",
  },
  {
    value: "training",
    label: "Training",
    icon: "school",
    description: "Training session or ride-along",
  },
  {
    value: "truck_support",
    label: "Truck Support",
    icon: "car",
    description: "Vehicle maintenance or supply run",
  },
  {
    value: "meeting",
    label: "Meeting",
    icon: "people",
    description: "Team meeting or conference call",
  },
  {
    value: "oncall",
    label: "On Call",
    icon: "call",
    description: "Standby / on-call duty",
  },
  {
    value: "other",
    label: "Other",
    icon: "ellipsis-horizontal",
    description: "Specify a custom reason",
  },
];

interface Props {
  visible: boolean;
  onSelect: (reason: AllocationType, otherReason?: string) => void;
  onCancel: () => void;
  isProcessing?: boolean;
  title?: string;
  currentValue?: AllocationType | null;
}

export function ReasonSelectorModal({
  visible,
  onSelect,
  onCancel,
  isProcessing = false,
  title = "Why are you clocking in?",
  currentValue,
}: Props) {
  const [selectedReason, setSelectedReason] = useState<AllocationType | null>(
    currentValue || null
  );
  const [otherText, setOtherText] = useState("");
  const [step, setStep] = useState<"select" | "other">("select");

  const handleSelect = (reason: AllocationType) => {
    if (reason === "other") {
      setSelectedReason(reason);
      setStep("other");
    } else {
      onSelect(reason);
    }
  };

  const handleOtherSubmit = () => {
    if (otherText.trim().length > 0) {
      onSelect("other", otherText.trim());
    }
  };

  const handleClose = () => {
    setStep("select");
    setSelectedReason(null);
    setOtherText("");
    onCancel();
  };

  const formatLabel = (value: string) =>
    value.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

  return (
    <Modal visible={visible} transparent animationType="fade">
      <View
        className="flex-1 justify-end"
        style={{ backgroundColor: "rgba(0,0,0,0.6)" }}
      >
        <View
          className="rounded-t-3xl px-6 pt-6 pb-10"
          style={{ backgroundColor: colors.surface, maxHeight: "85%" }}
        >
          {/* Header */}
          <View className="flex-row items-center justify-between mb-6">
            <Text className="text-xl font-bold" style={{ color: colors.text }}>
              {title}
            </Text>
            <Pressable
              onPress={handleClose}
              hitSlop={12}
              disabled={isProcessing}
            >
              <Ionicons name="close" size={24} color={colors.muted} />
            </Pressable>
          </View>

          {step === "select" ? (
            /* Reason Selection Grid */
            <View style={{ gap: 10 }}>
              {REASON_OPTIONS.map((option) => {
                const isSelected = selectedReason === option.value;
                return (
                  <Pressable
                    key={option.value}
                    onPress={() => handleSelect(option.value)}
                    disabled={isProcessing}
                    className="rounded-xl p-4 flex-row items-center"
                    style={{
                      backgroundColor: isSelected
                        ? colors.primary + "20"
                        : colors.bg,
                      borderWidth: 1,
                      borderColor: isSelected
                        ? colors.primary
                        : colors.bg,
                      opacity: isProcessing ? 0.5 : 1,
                    }}
                  >
                    <View
                      className="w-10 h-10 rounded-full items-center justify-center mr-3"
                      style={{
                        backgroundColor: isSelected
                          ? colors.primary
                          : colors.surface,
                      }}
                    >
                      <Ionicons
                        name={option.icon}
                        size={20}
                        color={isSelected ? colors.text : colors.accent}
                      />
                    </View>
                    <View className="flex-1">
                      <Text
                        className="text-base font-semibold"
                        style={{ color: colors.text }}
                      >
                        {option.label}
                      </Text>
                      <Text
                        className="text-xs mt-0.5"
                        style={{ color: colors.muted }}
                      >
                        {option.description}
                      </Text>
                    </View>
                    {isSelected && (
                      <Ionicons
                        name="checkmark-circle"
                        size={22}
                        color={colors.primary}
                      />
                    )}
                  </Pressable>
                );
              })}
            </View>
          ) : (
            /* Other Reason Input */
            <View style={{ gap: 16 }}>
              <Text className="text-sm" style={{ color: colors.muted }}>
                Please describe why you're clocking in:
              </Text>
              <TextInput
                className="rounded-xl p-4 text-base"
                style={{
                  backgroundColor: colors.bg,
                  color: colors.text,
                  borderWidth: 1,
                  borderColor: colors.primary,
                  minHeight: 80,
                  textAlignVertical: "top",
                }}
                placeholder="e.g., Office admin work, inventory count..."
                placeholderTextColor={colors.muted}
                value={otherText}
                onChangeText={setOtherText}
                multiline
                autoFocus
                maxLength={200}
              />
              <Text className="text-xs text-right" style={{ color: colors.muted }}>
                {otherText.length}/200
              </Text>
              <View className="flex-row" style={{ gap: 10 }}>
                <Pressable
                  onPress={() => {
                    setStep("select");
                    setOtherText("");
                  }}
                  disabled={isProcessing}
                  className="flex-1 rounded-xl px-4 py-3"
                  style={{
                    backgroundColor: colors.surface,
                    borderWidth: 1,
                    borderColor: colors.muted,
                    opacity: isProcessing ? 0.5 : 1,
                  }}
                >
                  <Text
                    className="text-base font-semibold text-center"
                    style={{ color: colors.muted }}
                  >
                    Back
                  </Text>
                </Pressable>
                <Pressable
                  onPress={handleOtherSubmit}
                  disabled={isProcessing || otherText.trim().length === 0}
                  className="flex-1 rounded-xl px-4 py-3"
                  style={{
                    backgroundColor: colors.primary,
                    opacity:
                      isProcessing || otherText.trim().length === 0 ? 0.5 : 1,
                  }}
                >
                  {isProcessing ? (
                    <ActivityIndicator color={colors.text} />
                  ) : (
                    <Text
                      className="text-base font-semibold text-center"
                      style={{ color: colors.text }}
                    >
                      Confirm
                    </Text>
                  )}
                </Pressable>
              </View>
            </View>
          )}
        </View>
      </View>
    </Modal>
  );
}

/**
 * Human-readable label for an allocation type value.
 */
export function getAllocationLabel(value: string | null | undefined): string {
  if (!value) return "Not set";
  const labels: Record<string, string> = {
    locating: "Locating",
    training: "Training",
    truck_support: "Truck Support",
    meeting: "Meeting",
    oncall: "On Call",
    other: "Other",
  };
  return labels[value] || value.replace(/_/g, " ");
}
