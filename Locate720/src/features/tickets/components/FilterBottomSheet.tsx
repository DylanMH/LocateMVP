import { useState } from "react";
import { Modal, Pressable, ScrollView, Text, View } from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";

import { colors } from "../../../ui/colors";
import type {
  DueFilterCategory,
  RescheduledFilterCategory,
  TicketFilters,
} from "../types";
import { NO_FILTERS } from "../types";

interface FilterBottomSheetProps {
  visible: boolean;
  filters: TicketFilters;
  contractors: string[];
  onApply: (filters: TicketFilters) => void;
  onClose: () => void;
}

const DUE_OPTIONS: { value: DueFilterCategory; label: string }[] = [
  { value: "ALL", label: "All" },
  { value: "OVERDUE", label: "Overdue" },
  { value: "DUE_WITHIN_2_HOURS", label: "Due within 2 hours" },
  { value: "DUE_TODAY", label: "Due today" },
  { value: "DUE_WITHIN_72_HOURS", label: "Due within 72 hours" },
  { value: "FUTURE", label: "Future" },
];

const RESCHEDULED_OPTIONS: {
  value: RescheduledFilterCategory;
  label: string;
}[] = [
  { value: "ALL", label: "All" },
  { value: "RESCHEDULED", label: "Rescheduled" },
  { value: "NOT_RESCHEDULED", label: "Not Rescheduled" },
];

export function FilterBottomSheet({
  visible,
  filters,
  contractors,
  onApply,
  onClose,
}: FilterBottomSheetProps) {
  // Temporary state so Cancel preserves previous filters (plan §23).
  const [draft, setDraft] = useState<TicketFilters>(filters);

  // Reset draft to current filters whenever the sheet opens.
  const handleShow = () => setDraft(filters);

  const handleApply = () => {
    onApply(draft);
    onClose();
  };

  const handleClearAll = () => {
    setDraft(NO_FILTERS);
  };

  const handleCancel = () => {
    setDraft(filters);
    onClose();
  };

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent={true}
      onRequestClose={handleCancel}
      onShow={handleShow}
    >
      <Pressable
        className="flex-1"
        style={{ backgroundColor: "rgba(0,0,0,0.5)" }}
        onPress={handleCancel}
      >
        <Pressable
          className="mt-auto rounded-t-3xl"
          style={{ backgroundColor: colors.bg, maxHeight: "85%" }}
          onPress={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <View className="flex-row items-center justify-between px-6 pt-6 pb-4">
            <Text className="text-xl font-bold" style={{ color: colors.text }}>
              Filter Tickets
            </Text>
            <Pressable onPress={handleCancel} hitSlop={10}>
              <Ionicons name="close" size={24} color={colors.muted} />
            </Pressable>
          </View>

          <ScrollView
            className="px-6"
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
          >
            {/* Contractor */}
            <Text
              className="text-xs uppercase tracking-widest mb-2 mt-2"
              style={{ color: colors.muted }}
            >
              Contractor
            </Text>
            <View className="flex-row flex-wrap" style={{ gap: 8 }}>
              <FilterChip
                label="Any contractor"
                selected={draft.contractor === null}
                onPress={() => setDraft({ ...draft, contractor: null })}
              />
              {contractors.map((c) => (
                <FilterChip
                  key={c}
                  label={c}
                  selected={
                    draft.contractor !== null &&
                    draft.contractor.toLowerCase() === c.toLowerCase()
                  }
                  onPress={() => setDraft({ ...draft, contractor: c })}
                />
              ))}
            </View>

            {/* Due */}
            <Text
              className="text-xs uppercase tracking-widest mb-2 mt-6"
              style={{ color: colors.muted }}
            >
              Due
            </Text>
            <View className="flex-row flex-wrap" style={{ gap: 8 }}>
              {DUE_OPTIONS.map((opt) => (
                <FilterChip
                  key={opt.value}
                  label={opt.label}
                  selected={draft.due === opt.value}
                  onPress={() =>
                    setDraft({ ...draft, due: opt.value })
                  }
                />
              ))}
            </View>

            {/* Rescheduled */}
            <Text
              className="text-xs uppercase tracking-widest mb-2 mt-6"
              style={{ color: colors.muted }}
            >
              Rescheduled
            </Text>
            <View className="flex-row flex-wrap" style={{ gap: 8 }}>
              {RESCHEDULED_OPTIONS.map((opt) => (
                <FilterChip
                  key={opt.value}
                  label={opt.label}
                  selected={draft.rescheduled === opt.value}
                  onPress={() =>
                    setDraft({ ...draft, rescheduled: opt.value })
                  }
                />
              ))}
            </View>

            {/* Toggles */}
            <Text
              className="text-xs uppercase tracking-widest mb-2 mt-6"
              style={{ color: colors.muted }}
            >
              Ticket Type
            </Text>
            <View className="flex-row" style={{ gap: 8 }}>
              <FilterChip
                label="Emergency"
                selected={draft.emergency}
                onPress={() =>
                  setDraft({ ...draft, emergency: !draft.emergency })
                }
              />
              <FilterChip
                label="No Response"
                selected={draft.noResponse}
                onPress={() =>
                  setDraft({ ...draft, noResponse: !draft.noResponse })
                }
              />
            </View>

            <View style={{ height: 24 }} />
          </ScrollView>

          {/* Footer */}
          <View
            className="flex-row items-center justify-between px-6 py-4"
            style={{
              borderTopWidth: 1,
              borderTopColor: colors.surface,
            }}
          >
            <Pressable
              onPress={handleClearAll}
              className="px-4 py-3 rounded-xl"
              style={{ backgroundColor: colors.surface }}
            >
              <Text
                className="text-sm font-semibold"
                style={{ color: colors.muted }}
              >
                Clear All
              </Text>
            </Pressable>
            <Pressable
              onPress={handleApply}
              className="px-6 py-3 rounded-xl"
              style={{ backgroundColor: colors.primary }}
            >
              <Text
                className="text-sm font-bold"
                style={{ color: colors.text }}
              >
                Apply Filters
              </Text>
            </Pressable>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

function FilterChip({
  label,
  selected,
  onPress,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      hitSlop={6}
      className="px-4 py-2.5 rounded-xl"
      style={{
        backgroundColor: selected ? colors.primary : colors.surface,
        minHeight: 44,
        justifyContent: "center",
      }}
    >
      <Text
        className="text-sm font-semibold"
        style={{ color: selected ? colors.text : colors.muted }}
      >
        {label}
      </Text>
    </Pressable>
  );
}
