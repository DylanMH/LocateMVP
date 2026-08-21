import Ionicons from "@expo/vector-icons/Ionicons";
import {
  Animated,
  Pressable,
  TextInput,
  Text,
  View,
} from "react-native";
import { useEffect, useRef } from "react";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { colors } from "../../../ui/colors";
import { radius } from "../../../ui/radius";
import { spacing } from "../../../ui/spacing";
import { typography } from "../../../ui/typography";
import { logger } from "../../../utils/logger";
import { SegmentedToggle, type SegmentedToggleOption } from "./SegmentedToggle";
import { SyncBadge } from "./SyncBadge";

export function TicketsHeader({
  userName,
  view,
  onChangeView,
  isSearchVisible,
  searchQuery,
  onSearchQueryChange,
  onToggleSearch,
  onClearSearch,
  onPressFilter,
  filterCount = 0,
}: {
  userName?: string;
  view: SegmentedToggleOption;
  onChangeView: (next: SegmentedToggleOption) => void;
  isSearchVisible: boolean;
  searchQuery: string;
  onSearchQueryChange: (query: string) => void;
  onToggleSearch: () => void;
  onClearSearch: () => void;
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

  // Animate the search bar expanding from the right side, pushing left.
  // When visible: search bar takes the full row width, hiding the toggle
  // and filter button. When hidden: toggle + filter + search icon show.
  const searchExpandAnim = useRef(new Animated.Value(isSearchVisible ? 1 : 0)).current;
  const navFadeAnim = useRef(new Animated.Value(isSearchVisible ? 0 : 1)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(searchExpandAnim, {
        toValue: isSearchVisible ? 1 : 0,
        duration: 250,
        useNativeDriver: false,
      }),
      Animated.timing(navFadeAnim, {
        toValue: isSearchVisible ? 0 : 1,
        duration: 200,
        useNativeDriver: false,
      }),
    ]).start(({ finished }) => {
      if (finished) {
        logger.log(
          `[TicketsHeader] search bar ${isSearchVisible ? "expanded" : "collapsed"}`,
        );
      }
    });
  }, [isSearchVisible, searchExpandAnim, navFadeAnim]);

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

      {/* Nav row: toggle + filter on the left, search icon on the right.
          When search is active, the search bar expands to fill the entire
          row, hiding the toggle and filter button with a fade. */}
      <View className="flex-row items-center justify-between mt-4" style={{ minHeight: 44 }}>
        {/* Normal nav items — fade out when search expands */}
        <Animated.View
          pointerEvents={isSearchVisible ? "none" : "auto"}
          style={{
            opacity: navFadeAnim,
            flexDirection: "row",
            alignItems: "center",
            flex: 1,
            gap: spacing.sm,
          }}
        >
          <SegmentedToggle value={view} onChange={onChangeView} />
          <View className="flex-row items-center" style={{ gap: 8, marginLeft: "auto" }}>
            {/* Filter button */}
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

            {/* Search icon — triggers the expand */}
            <Pressable
              onPress={onToggleSearch}
              className="w-11 h-11 rounded-2xl items-center justify-center"
              style={{ backgroundColor: colors.surface }}
            >
              <Ionicons name="search-outline" size={20} color={colors.text} />
            </Pressable>
          </View>
        </Animated.View>

        {/* Expanded search bar — slides in from the right, fills the row.
            Positioned absolutely over the nav items so it covers them. */}
        <Animated.View
          pointerEvents={isSearchVisible ? "auto" : "none"}
          style={{
            position: "absolute",
            top: 0,
            bottom: 0,
            right: 0,
            left: 0,
            opacity: searchExpandAnim,
            transform: [{
              translateX: searchExpandAnim.interpolate({
                inputRange: [0, 1],
                outputRange: [200, 0], // slide in from the right
              }),
            }],
            flexDirection: "row",
            alignItems: "center",
            gap: spacing.sm,
          }}
        >
          <View
            className="flex-1 flex-row items-center px-3"
            style={{
              height: 44,
              borderRadius: radius.button,
              backgroundColor: colors.surface,
              gap: 6,
            }}
          >
            <Ionicons name="search-outline" size={18} color={colors.muted} />
            <TextInput
              value={searchQuery}
              onChangeText={onSearchQueryChange}
              placeholder="Search ticket number..."
              placeholderTextColor={colors.muted}
              className="flex-1"
              style={{
                color: colors.text,
                fontSize: typography.bodySm,
                paddingVertical: 0,
              }}
              autoCapitalize="characters"
              autoCorrect={false}
              returnKeyType="search"
              // When the input loses focus (user taps elsewhere or hits
              // search/done key), only collapse the search bar if the
              // query is empty.  If there's an active query, keep the
              // search results visible so the user can scroll and tap
              // a result.
              onBlur={() => {
                if (!searchQuery.trim()) {
                  onClearSearch();
                }
              }}
            />
            <Pressable
              onPress={onClearSearch}
              hitSlop={8}
              className="w-6 h-6 rounded-full items-center justify-center"
              style={{ backgroundColor: colors.bg }}
            >
              <Ionicons name="close" size={14} color={colors.text} />
            </Pressable>
          </View>
        </Animated.View>
      </View>
    </View>
  );
}
