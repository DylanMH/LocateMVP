import { Pressable, Text, View } from "react-native";

import { colors } from "../../../ui/colors";
import type { TicketAssignedFilter, TicketViewStatusFilter } from "../types";

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

export function FilterChips({
  status,
  onChangeStatus,
  assigned,
  onChangeAssigned,
}: {
  status: TicketViewStatusFilter;
  onChangeStatus: (next: TicketViewStatusFilter) => void;
  assigned: TicketAssignedFilter;
  onChangeAssigned: (next: TicketAssignedFilter) => void;
}) {
  return (
    <View className="px-4 pb-3">
      <View className="flex-row items-center" style={{ gap: 10 }}>
        <Chip label="Open" selected={status === "OPEN"} onPress={() => onChangeStatus("OPEN")} />
        <Chip label="Closed" selected={status === "CLOSED"} onPress={() => onChangeStatus("CLOSED")} />
      </View>
    </View>
  );
}
