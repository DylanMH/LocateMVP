import { useState, useMemo } from "react";
import {
  Modal,
  View,
  Text,
  Pressable,
  TextInput,
  ScrollView,
  Alert,
  Platform,
} from "react-native";
import DateTimePicker from "@react-native-community/datetimepicker";
import { colors } from "../../../ui/colors";
import { triggerLightHaptic, triggerSuccessHaptic } from "../../../utils/haptics";
import {
  rescheduleTickets,
  type ExtensionType,
  type ReasonCode,
  type ExcavatorResponse,
  type RescheduleSource,
} from "../services/rescheduleService";
import { formatDueDateTime } from "../../../utils/date";

interface RescheduleModalProps {
  visible: boolean;
  onClose: () => void;
  ticketIds: string[];
  ticketNumbers: string[];
  currentDueAt: number;
  contractorName?: string;
  contractorPhone?: string;
  onRescheduled?: () => void;
}

const REASON_OPTIONS: { code: ReasonCode; label: string }[] = [
  { code: "ACCESS_ISSUE", label: "Access issue" },
  { code: "CANNOT_FIND_ADDRESS", label: "Can't find address" },
  { code: "DAMAGE_INVESTIGATION", label: "Damage investigation" },
  { code: "PROJECT_TICKET", label: "Project ticket" },
  { code: "WEATHER", label: "Weather" },
  { code: "OTHER", label: "Other" },
];

const EXTENSION_OPTIONS: { type: ExtensionType; label: string; hours: number }[] = [
  { type: "24_HOURS", label: "Extend 24 hours", hours: 24 },
  { type: "48_HOURS", label: "Extend 48 hours", hours: 48 },
];

const EXCAVATOR_RESPONSES: { value: ExcavatorResponse; label: string }[] = [
  { value: "AGREED_TO_RESCHEDULE", label: "Agree to reschedule" },
  { value: "DISAGREED", label: "Disagree" },
  { value: "PENDING", label: "Pending" },
];

export function RescheduleModal({
  visible,
  onClose,
  ticketIds,
  ticketNumbers,
  currentDueAt,
  contractorName,
  contractorPhone,
  onRescheduled,
}: RescheduleModalProps) {
  const [extensionType, setExtensionType] = useState<ExtensionType | null>(null);
  const [customDate, setCustomDate] = useState<Date | null>(null);
  const [customTime, setCustomTime] = useState<Date | null>(null);
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [showTimePicker, setShowTimePicker] = useState(false);
  const [reasonCode, setReasonCode] = useState<ReasonCode | null>(null);
  const [otherReason, setOtherReason] = useState("");
  const [approvalName, setApprovalName] = useState(contractorName || "");
  const [approvalPhone, setApprovalPhone] = useState(contractorPhone || "");
  const [excavatorResponse, setExcavatorResponse] = useState<ExcavatorResponse>("AGREED_TO_RESCHEDULE");
  const [notes, setNotes] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const proposedDueAt = useMemo(() => {
    if (extensionType === "CUSTOM" && customDate) {
      // Combine date and time — default to noon if no time selected
      const combined = new Date(customDate);
      if (customTime) {
        combined.setHours(customTime.getHours(), customTime.getMinutes(), 0, 0);
      } else {
        combined.setHours(12, 0, 0, 0);
      }
      const ts = combined.getTime();
      if (!isNaN(ts)) return ts;
    }
    if (extensionType === "24_HOURS") return currentDueAt + 24 * 60 * 60 * 1000;
    if (extensionType === "48_HOURS") return currentDueAt + 48 * 60 * 60 * 1000;
    return null;
  }, [extensionType, customDate, customTime, currentDueAt]);

  // Auto-generate notes when key fields change
  const generatedNotes = useMemo(() => {
    if (notes) return notes; // Don't override user edits
    if (!proposedDueAt || !reasonCode) return "";
    const newDateStr = formatDueDateTime(proposedDueAt);
    const reasonLabel = REASON_OPTIONS.find((r) => r.code === reasonCode)?.label || reasonCode;
    if (ticketNumbers.length === 1) {
      return `Ticket ${ticketNumbers[0]} is being rescheduled due to ${reasonLabel} to ${newDateStr}. The technician will complete the locate as soon as possible.`;
    }
    const numList = ticketNumbers.slice(0, 3).join(", ");
    const extra = ticketNumbers.length > 3 ? ` and ${ticketNumbers.length - 3} others` : "";
    return `Tickets ${numList}${extra} are being rescheduled due to ${reasonLabel} to ${newDateStr}. The technician will complete the locates as soon as possible.`;
  }, [proposedDueAt, reasonCode, ticketNumbers, notes]);

  const resetState = () => {
    setExtensionType(null);
    setCustomDate(null);
    setCustomTime(null);
    setShowDatePicker(false);
    setShowTimePicker(false);
    setReasonCode(null);
    setOtherReason("");
    setApprovalName(contractorName || "");
    setApprovalPhone(contractorPhone || "");
    setExcavatorResponse("AGREED_TO_RESCHEDULE");
    setNotes("");
  };

  const handleClose = () => {
    resetState();
    onClose();
  };

  const handleSubmit = async () => {
    if (!proposedDueAt) {
      Alert.alert("Select extension", "Please choose an extension option or custom date.");
      return;
    }
    if (!reasonCode) {
      Alert.alert("Select reason", "Please choose a reason for the reschedule.");
      return;
    }
    if (reasonCode === "OTHER" && !otherReason.trim()) {
      Alert.alert("Details required", "Please provide details when selecting 'Other'.");
      return;
    }

    setIsSubmitting(true);
    try {
      const result = await rescheduleTickets({
        ticketIds,
        newDueAt: proposedDueAt,
        extensionType: extensionType || "CUSTOM",
        reasonCode,
        reason: reasonCode === "OTHER" ? otherReason : undefined,
        approvalName: approvalName.trim() || undefined,
        approvalPhone: approvalPhone.trim() || undefined,
        excavatorResponse,
        notes: generatedNotes,
        source: "L720_INTERNAL",
      });

      if (result.status === "OK") {
        triggerSuccessHaptic();
        Alert.alert(
          "Rescheduled",
          ticketIds.length === 1
            ? `Ticket rescheduled to ${formatDueDateTime(proposedDueAt)}`
            : `${result.rescheduledCount} tickets rescheduled to ${formatDueDateTime(proposedDueAt)}`,
        );
        resetState();
        onRescheduled?.();
        onClose();
      } else {
        Alert.alert("Reschedule failed", result.error || "Unknown error");
      }
    } catch (error) {
      Alert.alert(
        "Reschedule failed",
        error instanceof Error ? error.message : "Unknown error",
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Modal visible={visible} animationType="slide" transparent={true} onRequestClose={handleClose}>
      <View className="flex-1 justify-end" style={{ backgroundColor: "rgba(0,0,0,0.5)" }}>
        <View
          className="rounded-t-3xl"
          style={{ backgroundColor: colors.surface, maxHeight: "90%" }}
        >
          {/* Header */}
          <View className="flex-row items-center justify-between px-5 pt-5 pb-3">
            <Text className="text-lg font-bold" style={{ color: colors.text }}>
              Reschedule
            </Text>
            <Pressable onPress={handleClose} hitSlop={12}>
              <Text className="text-base" style={{ color: colors.muted }}>
                Cancel
              </Text>
            </Pressable>
          </View>

          <ScrollView className="px-5 pb-5" showsVerticalScrollIndicator={false}>
            {/* Ticket summary */}
            <View className="mb-4">
              <Text className="text-xs font-semibold mb-1" style={{ color: colors.muted }}>
                {ticketIds.length === 1 ? "Ticket" : `${ticketIds.length} Tickets`}
              </Text>
              <Text className="text-sm" style={{ color: colors.text }}>
                {ticketNumbers.join(", ")}
              </Text>
              <Text className="text-xs mt-1" style={{ color: colors.muted }}>
                Current due: {formatDueDateTime(currentDueAt)}
              </Text>
            </View>

            {/* Extension options */}
            <View className="mb-4">
              <Text className="text-sm font-semibold mb-2" style={{ color: colors.text }}>
                Extension
              </Text>
              <View className="flex-row" style={{ gap: 8, flexWrap: "wrap" }}>
                {EXTENSION_OPTIONS.map((opt) => (
                  <Pressable
                    key={opt.type}
                    onPress={() => { triggerLightHaptic(); setExtensionType(opt.type); }}
                    className="px-4 py-2 rounded-lg"
                    style={{
                      backgroundColor: extensionType === opt.type ? colors.primary : colors.bg,
                    }}
                  >
                    <Text
                      className="text-sm font-medium"
                      style={{ color: extensionType === opt.type ? "#fff" : colors.text }}
                    >
                      {opt.label}
                    </Text>
                  </Pressable>
                ))}
                <Pressable
                  onPress={() => { triggerLightHaptic(); setExtensionType("CUSTOM"); }}
                  className="px-4 py-2 rounded-lg"
                  style={{
                    backgroundColor: extensionType === "CUSTOM" ? colors.primary : colors.bg,
                  }}
                >
                  <Text
                    className="text-sm font-medium"
                    style={{ color: extensionType === "CUSTOM" ? "#fff" : colors.text }}
                  >
                    Custom
                  </Text>
                </Pressable>
              </View>

              {/* Custom date and time pickers */}
              {extensionType === "CUSTOM" && (
                <View className="mt-2" style={{ gap: 8 }}>
                  <View className="flex-row" style={{ gap: 8 }}>
                    <Pressable
                      onPress={() => { triggerLightHaptic(); setShowDatePicker(true); setShowTimePicker(false); }}
                      className="flex-1 px-3 py-2.5 rounded-lg"
                      style={{ backgroundColor: colors.bg }}
                    >
                      <Text className="text-xs" style={{ color: colors.muted }}>
                        Date
                      </Text>
                      <Text className="text-sm font-medium" style={{ color: colors.text }}>
                        {customDate ? customDate.toLocaleDateString() : "Select date"}
                      </Text>
                    </Pressable>
                    <Pressable
                      onPress={() => { triggerLightHaptic(); setShowTimePicker(true); setShowDatePicker(false); }}
                      className="flex-1 px-3 py-2.5 rounded-lg"
                      style={{ backgroundColor: colors.bg }}
                    >
                      <Text className="text-xs" style={{ color: colors.muted }}>
                        Time
                      </Text>
                      <Text className="text-sm font-medium" style={{ color: colors.text }}>
                        {customTime
                          ? customTime.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
                          : "Select time"}
                      </Text>
                    </Pressable>
                  </View>

                  {showDatePicker && (
                    <DateTimePicker
                      value={customDate || new Date()}
                      mode="date"
                      display={Platform.OS === "ios" ? "spinner" : "default"}
                      minimumDate={new Date()}
                      onChange={(event, selectedDate) => {
                        setShowDatePicker(Platform.OS === "ios");
                        if (selectedDate) setCustomDate(selectedDate);
                      }}
                    />
                  )}

                  {showTimePicker && (
                    <DateTimePicker
                      value={customTime || new Date()}
                      mode="time"
                      display={Platform.OS === "ios" ? "spinner" : "default"}
                      onChange={(event, selectedTime) => {
                        setShowTimePicker(Platform.OS === "ios");
                        if (selectedTime) setCustomTime(selectedTime);
                      }}
                    />
                  )}

                  {customDate && (
                    <Pressable
                      onPress={() => { setCustomDate(null); setCustomTime(null); }}
                      hitSlop={8}
                    >
                      <Text className="text-xs" style={{ color: colors.muted }}>
                        Clear date selection
                      </Text>
                    </Pressable>
                  )}
                </View>
              )}

              {/* Proposed due date */}
              {proposedDueAt && (
                <View className="mt-2 px-3 py-2 rounded-lg" style={{ backgroundColor: colors.bg }}>
                  <Text className="text-xs" style={{ color: colors.muted }}>
                    Proposed new due:
                  </Text>
                  <Text className="text-sm font-semibold mt-0.5" style={{ color: colors.text }}>
                    {formatDueDateTime(proposedDueAt)}
                  </Text>
                </View>
              )}
            </View>

            {/* Approved By */}
            <View className="mb-4">
              <Text className="text-sm font-semibold mb-2" style={{ color: colors.text }}>
                Approved By
              </Text>
              <TextInput
                className="px-3 py-2 rounded-lg text-sm mb-2"
                style={{ backgroundColor: colors.bg, color: colors.text }}
                placeholder="Name"
                placeholderTextColor={colors.muted}
                value={approvalName}
                onChangeText={setApprovalName}
              />
              <TextInput
                className="px-3 py-2 rounded-lg text-sm"
                style={{ backgroundColor: colors.bg, color: colors.text }}
                placeholder="Phone"
                placeholderTextColor={colors.muted}
                value={approvalPhone}
                onChangeText={setApprovalPhone}
                keyboardType="phone-pad"
              />
            </View>

            {/* Reason */}
            <View className="mb-4">
              <Text className="text-sm font-semibold mb-2" style={{ color: colors.text }}>
                Reason
              </Text>
              <View className="flex-row" style={{ gap: 8, flexWrap: "wrap" }}>
                {REASON_OPTIONS.map((opt) => (
                  <Pressable
                    key={opt.code}
                    onPress={() => { triggerLightHaptic(); setReasonCode(opt.code); }}
                    className="px-3 py-1.5 rounded-lg"
                    style={{
                      backgroundColor: reasonCode === opt.code ? colors.primary : colors.bg,
                    }}
                  >
                    <Text
                      className="text-xs font-medium"
                      style={{ color: reasonCode === opt.code ? "#fff" : colors.text }}
                    >
                      {opt.label}
                    </Text>
                  </Pressable>
                ))}
              </View>
              {reasonCode === "OTHER" && (
                <TextInput
                  className="mt-2 px-3 py-2 rounded-lg text-sm"
                  style={{ backgroundColor: colors.bg, color: colors.text }}
                  placeholder="Provide details..."
                  placeholderTextColor={colors.muted}
                  value={otherReason}
                  onChangeText={setOtherReason}
                  multiline
                />
              )}
            </View>

            {/* Excavator Response */}
            <View className="mb-4">
              <Text className="text-sm font-semibold mb-2" style={{ color: colors.text }}>
                Excavator Response
              </Text>
              <View className="flex-row" style={{ gap: 8, flexWrap: "wrap" }}>
                {EXCAVATOR_RESPONSES.map((opt) => (
                  <Pressable
                    key={opt.value}
                    onPress={() => { triggerLightHaptic(); setExcavatorResponse(opt.value); }}
                    className="px-3 py-1.5 rounded-lg"
                    style={{
                      backgroundColor: excavatorResponse === opt.value ? colors.primary : colors.bg,
                    }}
                  >
                    <Text
                      className="text-xs font-medium"
                      style={{ color: excavatorResponse === opt.value ? "#fff" : colors.text }}
                    >
                      {opt.label}
                    </Text>
                  </Pressable>
                ))}
              </View>
            </View>

            {/* Notes */}
            <View className="mb-4">
              <Text className="text-sm font-semibold mb-2" style={{ color: colors.text }}>
                Notes
              </Text>
              <TextInput
                className="px-3 py-2 rounded-lg text-sm"
                style={{ backgroundColor: colors.bg, color: colors.text, minHeight: 80 }}
                placeholder="Message to contractor..."
                placeholderTextColor={colors.muted}
                value={notes || generatedNotes}
                onChangeText={setNotes}
                multiline
                textAlignVertical="top"
              />
            </View>

            {/* Submit */}
            <Pressable
              onPress={handleSubmit}
              disabled={isSubmitting}
              className="py-3 rounded-xl"
              style={{
                backgroundColor: isSubmitting ? colors.muted : colors.primary,
              }}
            >
              <Text className="text-center text-base font-bold" style={{ color: "#fff" }}>
                {isSubmitting ? "Rescheduling..." : "Reschedule"}
              </Text>
            </Pressable>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}
