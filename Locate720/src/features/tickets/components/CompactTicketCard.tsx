import { memo } from "react";
import { Pressable, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";

import Ticket from "../../../db/models/Ticket";
import { formatDueDateTime } from "../../../utils/date";
import { getDueAccentColorFromTimestamp, getRescheduledHalfColors, isLateButRescheduled, DUE_URGENCY_COLORS } from "../domain/dueColor";
import {
  formatTicketType,
  getTicketDisplayData,
} from "../utils/ticketPayload";
import {
  formatLocatorStatus,
  getLocatorStatusColor,
  getTicketTypeColor,
  getUtilityColor,
  getUtilityIcon,
  shouldShowLocatorStatusBadge,
} from "../utils/ticketPresentation";
import { colors } from "../../../ui/colors";
import { triggerLightHaptic } from "../../../utils/haptics";

const CompactTicketCardComponent = ({
  ticket,
  onPress,
}: {
  ticket: Ticket;
  onPress: () => void;
}) => {
  const dueBorderColor = getDueAccentColorFromTimestamp(ticket.dueAt);
  const halfColors = getRescheduledHalfColors(ticket.dueAt, ticket.originalDueAt);
  const isRescheduledLate = isLateButRescheduled(ticket.dueAt, ticket.originalDueAt);
  const { customers, workType } = getTicketDisplayData(ticket.payloadJson);

  // Active-status highlighting: use status color for border + subtle tint
  const isActiveStatus = shouldShowLocatorStatusBadge(ticket.locatorStatus);
  const accentColor = isActiveStatus
    ? getLocatorStatusColor(ticket.locatorStatus)
    : dueBorderColor;

  const handlePress = () => {
    triggerLightHaptic();
    onPress();
  };

  return (
    <Pressable
      onPress={handlePress}
      className="mx-4 rounded-xl flex-row"
      style={{
        backgroundColor: isActiveStatus
          ? `${getLocatorStatusColor(ticket.locatorStatus)}10`
          : colors.surface,
      }}
    >
      {/* Left color bar — half red / half new-due-color when late-but-rescheduled */}
      <View
        style={{
          width: isActiveStatus ? 6 : 4,
          borderTopLeftRadius: 12,
          borderBottomLeftRadius: 12,
          ...(halfColors
            ? { backgroundColor: halfColors.topColor }
            : { backgroundColor: accentColor, flex: 1 }),
        }}
      >
        {halfColors && (
          <View style={{ flex: 1 }}>
            <View style={{ flex: 1, backgroundColor: halfColors.topColor }} />
            <View style={{ flex: 1, backgroundColor: halfColors.bottomColor }} />
          </View>
        )}
      </View>
      <View className="flex-1 px-3 py-2.5">
      <View className="flex-row items-center justify-between">
        <View className="flex-1 mr-2">
          <View className="flex-row items-center">
            <Text
              className="text-sm font-bold mr-2"
              style={{ color: colors.text }}
              numberOfLines={1}
            >
              {ticket.ticketNumber}
            </Text>
            {shouldShowLocatorStatusBadge(ticket.locatorStatus) && (
              <View
                className="px-1.5 py-0.5 rounded"
                style={{
                  backgroundColor: getLocatorStatusColor(ticket.locatorStatus),
                }}
              >
                <Text
                  className="text-[10px] font-bold"
                  style={{ color: colors.bg }}
                >
                  {formatLocatorStatus(ticket.locatorStatus)}
                </Text>
              </View>
            )}
          </View>
          <Text
            className="text-xs mt-0.5"
            style={{ color: colors.muted }}
            numberOfLines={1}
          >
            {ticket.address}
          </Text>
        </View>

        <View className="items-end">
          <View
            className="px-2 py-0.5 rounded-full mb-1"
            style={{ backgroundColor: getTicketTypeColor(ticket.ticketType) }}
          >
            <Text
              className="text-[10px] font-semibold"
              style={{ color: colors.bg }}
              numberOfLines={1}
            >
              {formatTicketType(ticket.ticketType)}
            </Text>
          </View>
          <Text className="text-[11px]" style={{ color: colors.muted }}>
            {formatDueDateTime(ticket.dueAt)}
          </Text>
          {isRescheduledLate && ticket.originalDueAt && (
            <Text
              className="text-[9px] mt-0.5"
              style={{ color: DUE_URGENCY_COLORS.overdue }}
              numberOfLines={1}
            >
              Orig: {formatDueDateTime(ticket.originalDueAt)}
            </Text>
          )}
        </View>
      </View>

      {customers.length > 0 && (
        <View className="flex-row items-center mt-1.5" style={{ gap: 4 }}>
          {customers.map((customer) => (
            <View
              key={customer.id}
              className="w-4 h-4 rounded-full items-center justify-center"
              style={{ backgroundColor: getUtilityColor(customer.utility) }}
            >
              <Ionicons
                name={getUtilityIcon(customer.utility)}
                size={10}
                color="#fff"
              />
            </View>
          ))}
          {workType ? (
            <Text
              className="text-[11px] ml-1.5 flex-1"
              style={{ color: colors.muted }}
              numberOfLines={1}
            >
              {workType}
            </Text>
          ) : null}
        </View>
      )}
      </View>
    </Pressable>
  );
};

export const CompactTicketCard = memo(CompactTicketCardComponent);
