import { Pressable, ScrollView, Text, View } from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";

import { colors } from "../../../ui/colors";
import type {
  TicketAssignedFilter,
  TicketViewStatusFilter,
  TicketFilters,
} from "../types";
import { countActiveFilters } from "../types";

function Chip({
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
      hitSlop={10}
      className="px-4 py-2 rounded-full"
      style={{ backgroundColor: selected ? colors.primary : colors.surface }}
    >
      <Text className="text-xs font-semibold" style={{ color: colors.text }}>
        {label}
      </Text>
    </Pressable>
  );
}

function RemovableChip({ label, onRemove }: { label: string; onRemove: () => void }) {
  return (
    <Pressable
      onPress={onRemove}
      hitSlop={8}
      className="flex-row items-center px-3 py-1.5 rounded-full"
      style={{ backgroundColor: colors.primary }}
    >
      <Text className="text-xs font-semibold mr-1.5" style={{ color: colors.text }}>
        {label}
      </Text>
      <Ionicons name="close-circle" size={14} color={colors.text} />
    </Pressable>
  );
}

export function FilterChips({
  status,
  onChangeStatus,
  assigned,
  onChangeAssigned,
  filters,
  onRemoveFilter,
  onClearAllFilters,
}: {
  status: TicketViewStatusFilter;
  onChangeStatus: (next: TicketViewStatusFilter) => void;
  assigned: TicketAssignedFilter;
  onChangeAssigned: (next: TicketAssignedFilter) => void;
  filters: TicketFilters;
  onRemoveFilter: (key: keyof TicketFilters) => void;
  onClearAllFilters: () => void;
}) {
  const activeCount = countActiveFilters(filters);

  // Build the list of active filter chips to display.
  const activeChips: { label: string; key: keyof TicketFilters }[] = [];
  if (filters.contractor) {
    activeChips.push({ label: filters.contractor, key: "contractor" });
  }
  if (filters.due !== "ALL") {
    const dueLabels: Record<string, string> = {
      OVERDUE: "Overdue",
      DUE_WITHIN_2_HOURS: "Due < 2h",
      DUE_TODAY: "Due Today",
      DUE_WITHIN_72_HOURS: "Due < 72h",
      FUTURE: "Future",
    };
    activeChips.push({ label: dueLabels[filters.due] || filters.due, key: "due" });
  }
  if (filters.rescheduled !== "ALL") {
    activeChips.push({
      label: filters.rescheduled === "RESCHEDULED" ? "Rescheduled" : "Not Rescheduled",
      key: "rescheduled",
    });
  }
  if (filters.emergency) {
    activeChips.push({ label: "Emergency", key: "emergency" });
  }
  if (filters.noResponse) {
    activeChips.push({ label: "No Response", key: "noResponse" });
  }

  return (
    <View className="pb-3">
      {/* Status chips row */}
      <View className="px-4">
        <View className="flex-row items-center" style={{ gap: 10 }}>
          <Chip label="Open" selected={status === "OPEN"} onPress={() => onChangeStatus("OPEN")} />
          <Chip label="Closed" selected={status === "CLOSED"} onPress={() => onChangeStatus("CLOSED")} />
        </View>
      </View>

      {/* Active filter chips + Clear all */}
      {activeCount > 0 && (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          className="mt-2"
          contentContainerStyle={{ paddingHorizontal: 16, gap: 8, alignItems: "center" }}
        >
          {activeChips.map((chip) => (
            <RemovableChip
              key={chip.key}
              label={chip.label}
              onRemove={() => onRemoveFilter(chip.key)}
            />
          ))}
          <Pressable
            onPress={onClearAllFilters}
            hitSlop={8}
            className="px-3 py-1.5 rounded-full"
            style={{ backgroundColor: colors.surface }}
          >
            <Text className="text-xs font-semibold" style={{ color: colors.muted }}>
              Clear all
            </Text>
          </Pressable>
        </ScrollView>
      )}
    </View>
  );
}
