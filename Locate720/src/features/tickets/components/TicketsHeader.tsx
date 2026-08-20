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
  onPressFilter,
  filterCount = 0,
}: {
  userName?: string;
  view: SegmentedToggleOption;
  onChangeView: (next: SegmentedToggleOption) => void;
  onPressSearch: () => void;
  onPressFilter: () => void;
  filterCount?: number;
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
        <View className="flex-row items-center ml-3" style={{ gap: 8 }}>
          <Pressable
            onPress={onPressFilter}
            className="w-11 h-11 rounded-2xl items-center justify-center"
            style={{ backgroundColor: filterCount > 0 ? colors.primary : colors.surface }}
          >
            <Ionicons
              name="filter"
              size={20}
              color={filterCount > 0 ? colors.text : colors.muted}
            />
            {filterCount > 0 && (
              <View
                className="absolute -top-1 -right-1 w-5 h-5 rounded-full items-center justify-center"
                style={{ backgroundColor: colors.accent }}
              >
                <Text
                  className="text-xs font-bold"
                  style={{ color: colors.bg, fontSize: 10 }}
                >
                  {filterCount}
                </Text>
              </View>
            )}
          </Pressable>
          <Pressable
            onPress={onPressSearch}
            className="w-11 h-11 rounded-2xl items-center justify-center"
            style={{ backgroundColor: colors.surface }}
          >
            <Ionicons name="search" size={20} color={colors.text} />
          </Pressable>
        </View>
      </View>
    </View>
  );
}
