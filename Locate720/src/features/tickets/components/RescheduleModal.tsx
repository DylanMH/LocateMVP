import { useState, useMemo } from "react";
import {
  Modal,
  View,
  Text,
  Pressable,
  TextInput,
  ScrollView,
  Alert,
} from "react-native";
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

// Picker option arrays — pure JS, no native module required
const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const DAYS = Array.from({ length: 31 }, (_, i) => i + 1);
const thisYear = new Date().getFullYear();
const YEARS = [thisYear, thisYear + 1];
const HOURS = Array.from({ length: 24 }, (_, i) => i);
const MINUTES = [0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55];

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
  // Custom date/time as simple numeric fields for a pure-JS picker
  const today = new Date();
  const [customYear, setCustomYear] = useState<number>(today.getFullYear());
  const [customMonth, setCustomMonth] = useState<number>(today.getMonth()); // 0-based
  const [customDay, setCustomDay] = useState<number>(today.getDate());
  const [customHour, setCustomHour] = useState<number>(12);
  const [customMinute, setCustomMinute] = useState<number>(0);
  const [reasonCode, setReasonCode] = useState<ReasonCode | null>(null);
  const [otherReason, setOtherReason] = useState("");
  const [approvalName, setApprovalName] = useState(contractorName || "");
  const [approvalPhone, setApprovalPhone] = useState(contractorPhone || "");
  const [excavatorResponse, setExcavatorResponse] = useState<ExcavatorResponse>("AGREED_TO_RESCHEDULE");
  const [notes, setNotes] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Build the proposed due timestamp from the picker fields
  const customDateValid = useMemo(() => {
    if (extensionType !== "CUSTOM") return false;
    const d = new Date(customYear, customMonth, customDay, customHour, customMinute, 0, 0);
    return !isNaN(d.getTime());
  }, [extensionType, customYear, customMonth, customDay, customHour, customMinute]);

  const proposedDueAt = useMemo(() => {
    if (extensionType === "CUSTOM" && customDateValid) {
      return new Date(customYear, customMonth, customDay, customHour, customMinute, 0, 0).getTime();
    }
    if (extensionType === "24_HOURS") return currentDueAt + 24 * 60 * 60 * 1000;
    if (extensionType === "48_HOURS") return currentDueAt + 48 * 60 * 60 * 1000;
    return null;
  }, [extensionType, customDateValid, customYear, customMonth, customDay, customHour, customMinute, currentDueAt]);

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
    const now = new Date();
    setCustomYear(now.getFullYear());
    setCustomMonth(now.getMonth());
    setCustomDay(now.getDate());
    setCustomHour(12);
    setCustomMinute(0);
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
    // Prevent rescheduling tickets that are already past due
    if (currentDueAt && currentDueAt < Date.now()) {
      Alert.alert(
        "Cannot reschedule",
        "This ticket is already past its due date and cannot be rescheduled.",
      );
      return;
    }
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

              {/* Custom date and time pickers — pure JS, no native module */}
              {extensionType === "CUSTOM" && (
                <View className="mt-2" style={{ gap: 8 }}>
                  {/* Date section */}
                  <View>
                    <Text className="text-xs font-semibold mb-1.5" style={{ color: colors.muted }}>
                      Date
                    </Text>
                    <View className="flex-row" style={{ gap: 6 }}>
                      {/* Month */}
                      <View className="flex-1">
                        <Text className="text-[10px] mb-1" style={{ color: colors.muted }}>Month</Text>
                        <ScrollView
                          style={{ maxHeight: 120, backgroundColor: colors.bg, borderRadius: 8 }}
                          showsVerticalScrollIndicator={false}
                        >
                          {MONTH_NAMES.map((m, idx) => (
                            <Pressable
                              key={idx}
                              onPress={() => { triggerLightHaptic(); setCustomMonth(idx); }}
                              className="py-1.5 px-2"
                              style={{
                                backgroundColor: idx === customMonth ? colors.primary : "transparent",
                                borderRadius: 4,
                              }}
                            >
                              <Text
                                className="text-xs text-center"
                                style={{ color: idx === customMonth ? "#fff" : colors.text }}
                              >
                                {m}
                              </Text>
                            </Pressable>
                          ))}
                        </ScrollView>
                      </View>
                      {/* Day */}
                      <View style={{ width: 50 }}>
                        <Text className="text-[10px] mb-1" style={{ color: colors.muted }}>Day</Text>
                        <ScrollView
                          style={{ maxHeight: 120, backgroundColor: colors.bg, borderRadius: 8 }}
                          showsVerticalScrollIndicator={false}
                        >
                          {DAYS.map((d) => (
                            <Pressable
                              key={d}
                              onPress={() => { triggerLightHaptic(); setCustomDay(d); }}
                              className="py-1.5 px-2"
                              style={{
                                backgroundColor: d === customDay ? colors.primary : "transparent",
                                borderRadius: 4,
                              }}
                            >
                              <Text
                                className="text-xs text-center"
                                style={{ color: d === customDay ? "#fff" : colors.text }}
                              >
                                {d}
                              </Text>
                            </Pressable>
                          ))}
                        </ScrollView>
                      </View>
                      {/* Year */}
                      <View style={{ width: 60 }}>
                        <Text className="text-[10px] mb-1" style={{ color: colors.muted }}>Year</Text>
                        <ScrollView
                          style={{ maxHeight: 120, backgroundColor: colors.bg, borderRadius: 8 }}
                          showsVerticalScrollIndicator={false}
                        >
                          {YEARS.map((y) => (
                            <Pressable
                              key={y}
                              onPress={() => { triggerLightHaptic(); setCustomYear(y); }}
                              className="py-1.5 px-2"
                              style={{
                                backgroundColor: y === customYear ? colors.primary : "transparent",
                                borderRadius: 4,
                              }}
                            >
                              <Text
                                className="text-xs text-center"
                                style={{ color: y === customYear ? "#fff" : colors.text }}
                              >
                                {y}
                              </Text>
                            </Pressable>
                          ))}
                        </ScrollView>
                      </View>
                    </View>
                  </View>

                  {/* Time section */}
                  <View>
                    <Text className="text-xs font-semibold mb-1.5" style={{ color: colors.muted }}>
                      Time
                    </Text>
                    <View className="flex-row items-center" style={{ gap: 6 }}>
                      {/* Hour */}
                      <View style={{ width: 50 }}>
                        <Text className="text-[10px] mb-1" style={{ color: colors.muted }}>Hour</Text>
                        <ScrollView
                          style={{ maxHeight: 120, backgroundColor: colors.bg, borderRadius: 8 }}
                          showsVerticalScrollIndicator={false}
                        >
                          {HOURS.map((h) => (
                            <Pressable
                              key={h}
                              onPress={() => { triggerLightHaptic(); setCustomHour(h); }}
                              className="py-1.5 px-2"
                              style={{
                                backgroundColor: h === customHour ? colors.primary : "transparent",
                                borderRadius: 4,
                              }}
                            >
                              <Text
                                className="text-xs text-center"
                                style={{ color: h === customHour ? "#fff" : colors.text }}
                              >
                                {String(h).padStart(2, "0")}
                              </Text>
                            </Pressable>
                          ))}
                        </ScrollView>
                      </View>
                      <Text className="text-lg font-bold" style={{ color: colors.text }}>:</Text>
                      {/* Minute */}
                      <View style={{ width: 50 }}>
                        <Text className="text-[10px] mb-1" style={{ color: colors.muted }}>Min</Text>
                        <ScrollView
                          style={{ maxHeight: 120, backgroundColor: colors.bg, borderRadius: 8 }}
                          showsVerticalScrollIndicator={false}
                        >
                          {MINUTES.map((m) => (
                            <Pressable
                              key={m}
                              onPress={() => { triggerLightHaptic(); setCustomMinute(m); }}
                              className="py-1.5 px-2"
                              style={{
                                backgroundColor: m === customMinute ? colors.primary : "transparent",
                                borderRadius: 4,
                              }}
                            >
                              <Text
                                className="text-xs text-center"
                                style={{ color: m === customMinute ? "#fff" : colors.text }}
                              >
                                {String(m).padStart(2, "0")}
                              </Text>
                            </Pressable>
                          ))}
                        </ScrollView>
                      </View>
                      <View className="flex-1 ml-1">
                        <Text className="text-[10px]" style={{ color: colors.muted }}>Selected</Text>
                        <Text className="text-sm font-medium" style={{ color: colors.text }}>
                          {String(customHour).padStart(2, "0")}:{String(customMinute).padStart(2, "0")}
                        </Text>
                      </View>
                    </View>
                  </View>
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
