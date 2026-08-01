import { Text, View } from "react-native";

import { colors } from "../../../ui/colors";
import { formatTicketStatusLabel } from "../domain/formatters";
import type { TicketStatus } from "../types";

function getStatusColor(status: TicketStatus): string {
  switch (status) {
    case "ASSIGNED":
      return colors.primary;
    case "PAUSED":
      return colors.muted;
    case "ENROUTE":
      return colors.accent;
    case "ONSITE":
      return colors.accent;
    case "CLOSED":
      return colors.muted;
  }

  return colors.muted;
}

export function StatusPill({ status }: { status: TicketStatus }) {
  return (
    <View
      className="px-3 rounded-2xl items-center justify-center m-3"
      style={{ backgroundColor: getStatusColor(status), height: 24, minWidth: 92 }}
    >
      <Text
        className="text-[10px] font-bold"
        style={{ color: colors.bg }}
        numberOfLines={1}
      >
        {formatTicketStatusLabel(status)}
      </Text>
    </View>
  );
}
