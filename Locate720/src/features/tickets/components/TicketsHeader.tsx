import Ionicons from "@expo/vector-icons/Ionicons";
import { Pressable, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { colors } from "../../../ui/colors";
import { SegmentedToggle, type SegmentedToggleOption } from "./SegmentedToggle";
import { SyncBadge } from "./SyncBadge";

export function TicketsHeader({
  userName,
  view,
  onChangeView,
  onPressSearch,
}: {
  userName?: string;
  view: SegmentedToggleOption;
  onChangeView: (next: SegmentedToggleOption) => void;
  onPressSearch: () => void;
}) {
  const insets = useSafeAreaInsets();
  const initials = (userName || "Locate Technician")
    .split(" ")
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

  return (
    <View className="px-4 pb-3" style={{ paddingTop: insets.top + 12 }}>
      <View
        className="rounded-3xl px-4 py-4"
        style={{ backgroundColor: colors.surface }}
      >
        <View className="flex-row items-center justify-between">
          <View className="flex-row items-center flex-1 pr-3">
            <View
              className="w-14 h-14 rounded-2xl items-center justify-center mr-3"
              style={{ backgroundColor: colors.primary }}
            >
              <Text className="text-lg font-bold" style={{ color: colors.text }}>
                {initials}
              </Text>
            </View>

            <View className="flex-1">
              <Text className="text-xs uppercase tracking-widest" style={{ color: colors.accent }}>
                Locate720
              </Text>
              <Text className="text-xl font-bold mt-1" style={{ color: colors.text }}>
                Ticket Workspace
              </Text>
              <Text className="text-sm mt-1" style={{ color: colors.muted }}>
                Signed in as {userName || "Tech"}
              </Text>
            </View>
          </View>

          <SyncBadge />
        </View>
      </View>

      <View className="flex-row items-center justify-between mt-4">
        <SegmentedToggle value={view} onChange={onChangeView} />
        <Pressable
          onPress={onPressSearch}
          className="w-11 h-11 rounded-2xl items-center justify-center ml-3"
          style={{ backgroundColor: colors.surface }}
        >
          <Ionicons name="search" size={20} color={colors.text} />
        </Pressable>
      </View>
    </View>
  );
}
