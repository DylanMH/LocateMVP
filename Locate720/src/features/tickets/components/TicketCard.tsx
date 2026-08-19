import { Pressable, Text, View, Linking, Platform } from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";
import { memo } from "react";

import Ticket from "../../../db/models/Ticket";
import { colors } from "../../../ui/colors";
import { formatDueDateTime } from "../../../utils/date";
import { logger } from "../../../utils/logger";
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

function handlePhonePress(phone: string) {
  const cleanPhone = phone.replace(/[^0-9]/g, '');
  Linking.openURL(`tel:${cleanPhone}`);
}

async function handleAddressPress(address: string) {
  const trimmedAddress = address.trim();
  if (!trimmedAddress) {
    return;
  }

  const encodedAddress = encodeURIComponent(trimmedAddress);
  const primaryUrl =
    Platform.OS === "ios"
      ? `maps:0,0?q=${encodedAddress}`
      : `geo:0,0?q=${encodedAddress}`;
  const fallbackUrl = `https://www.google.com/maps/search/?api=1&query=${encodedAddress}`;

  try {
    const canOpenPrimary = await Linking.canOpenURL(primaryUrl);
    await Linking.openURL(canOpenPrimary ? primaryUrl : fallbackUrl);
  } catch (error) {
    logger.error("[TicketCard] Failed to open navigation app:", error);
  }
}

const TicketCardComponent = ({ ticket, onPress }: { ticket: Ticket; onPress: () => void }) => {
  const dueBorderColor = getDueAccentColorFromTimestamp(ticket.dueAt);
  const halfColors = getRescheduledHalfColors(ticket.dueAt, ticket.originalDueAt);
  const isRescheduledLate = isLateButRescheduled(ticket.dueAt, ticket.originalDueAt);
  const { workType, contractor, contractorPhone, customers } =
    getTicketDisplayData(ticket.payloadJson);

  // Active-status highlighting: when the ticket is ENROUTE, ONSITE, or
  // PAUSED, use the status color for the left border and add a subtle
  // background tint so the active ticket stands out from the list.
  const isActiveStatus = shouldShowLocatorStatusBadge(ticket.locatorStatus);
  const accentColor = isActiveStatus
    ? getLocatorStatusColor(ticket.locatorStatus)
    : dueBorderColor;

  const handlePhoneTap = (e: { stopPropagation: () => void }) => {
    e.stopPropagation();
    if (contractorPhone) {
      handlePhonePress(contractorPhone);
    }
  };

  const handleAddressTap = async (e: { stopPropagation: () => void }) => {
    e.stopPropagation();
    await handleAddressPress(ticket.address);
  };

  return (
    <Pressable
      onPress={onPress}
      className="mx-4 rounded-2xl flex-row"
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
          borderTopLeftRadius: 16,
          borderBottomLeftRadius: 16,
        }}
      >
        {halfColors ? (
          <View style={{ flex: 1 }}>
            <View style={{ flex: 1, backgroundColor: halfColors.topColor }} />
            <View style={{ flex: 1, backgroundColor: halfColors.bottomColor }} />
          </View>
        ) : (
          <View style={{ flex: 1, backgroundColor: accentColor }} />
        )}
      </View>
      <View className="flex-1 p-4">
      <View className="flex-row items-start justify-between mb-2">
        <View className="flex-1 pr-3">
          <Text className="text-base font-bold" style={{ color: colors.text }}>
            {ticket.ticketNumber}
          </Text>
          {/* Sequence badge for linked tickets. Sequence 1 is the original and
              renders no badge to keep the list clean. */}
          {(ticket.sequenceNumber ?? 1) > 1 && ticket.externalRootNumber ? (
            <Text className="text-xs mt-0.5" style={{ color: colors.muted }}>
              Update #{(ticket.sequenceNumber ?? 1) - 1} of {ticket.externalRootNumber}
            </Text>
          ) : null}
        </View>
        <View style={{ gap: 4, alignItems: 'flex-end' }}>
          <View className="px-3 py-1 rounded-full" style={{ backgroundColor: getTicketTypeColor(ticket.ticketType) }}>
            <Text className="text-xs font-semibold" style={{ color: colors.bg }} numberOfLines={1}>
              {formatTicketType(ticket.ticketType)}
            </Text>
          </View>
          {shouldShowLocatorStatusBadge(ticket.locatorStatus) && (
            <View className="px-2 py-0.5 rounded" style={{ 
              backgroundColor: getLocatorStatusColor(ticket.locatorStatus),
            }}>
              <Text className="text-xs font-semibold" style={{ color: colors.bg }}>
                {formatLocatorStatus(ticket.locatorStatus)}
              </Text>
            </View>
          )}
        </View>
      </View>

      <Pressable onPress={handleAddressTap} hitSlop={8}>
        <Text className="text-sm" style={{ color: colors.accent, textDecorationLine: 'underline' }} numberOfLines={2}>
          {ticket.address}
        </Text>
      </Pressable>

      {customers.length > 0 && (
        <View className="flex-row items-center mt-2" style={{ gap: 6 }}>
          {customers.map((customer) => (
            <View 
              key={customer.id}
              className="w-6 h-6 rounded-full items-center justify-center"
              style={{ backgroundColor: getUtilityColor(customer.utility) }}
            >
              <Ionicons 
                name={getUtilityIcon(customer.utility)}
                size={14} 
                color="#fff" 
              />
            </View>
          ))}
        </View>
      )}

      {workType ? (
        <Text className="text-xs mt-2" style={{ color: colors.muted }}>
          {workType}
        </Text>
      ) : null}

      <View className="flex-row items-center justify-between mt-3 pt-3" style={{ borderTopWidth: 1, borderTopColor: colors.bg }}>
        <View className="flex-1 pr-2">
          <Text className="text-xs font-semibold" style={{ color: colors.text }}>
            {contractor}
          </Text>
          {contractorPhone ? (
            <Pressable onPress={handlePhoneTap} hitSlop={8}>
              <View className="flex-row items-center mt-1">
                <Ionicons name="call" size={12} color={colors.accent} />
                <Text className="text-xs ml-1" style={{ color: colors.accent }}>
                  {contractorPhone}
                </Text>
              </View>
            </Pressable>
          ) : null}
        </View>
        <View className="items-end">
          <Text className="text-xs" style={{ color: colors.muted }}>
            {formatDueDateTime(ticket.dueAt)}
          </Text>
          {isRescheduledLate && ticket.originalDueAt && (
            <Text
              className="text-[10px] mt-0.5"
              style={{ color: DUE_URGENCY_COLORS.overdue }}
              numberOfLines={1}
            >
              Orig: {formatDueDateTime(ticket.originalDueAt)}
            </Text>
          )}
        </View>
      </View>
      </View>
    </Pressable>
  );
};

export const TicketCard = memo(TicketCardComponent);
