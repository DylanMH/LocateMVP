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
import { typography } from "../../../ui/typography";
import { logger } from "../../../utils/logger";
import { SegmentedToggle, type SegmentedToggleOption } from "./SegmentedToggle";
import { SyncBadge } from "./SyncBadge";

// Width the search input bar animates to when expanded (px).
const SEARCH_BAR_WIDTH = 220;

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

  // Animated width for the expanding search bar.  The bar slides out to the
  // left from the search-icon position, so we animate width from 0 -> full.
  const widthAnim = useRef(
    new Animated.Value(isSearchVisible ? SEARCH_BAR_WIDTH : 0),
  ).current;

  useEffect(() => {
    Animated.timing(widthAnim, {
      toValue: isSearchVisible ? SEARCH_BAR_WIDTH : 0,
      duration: 250,
      useNativeDriver: false, // width animation requires JS driver
    }).start(({ finished }) => {
      if (finished) {
        logger.log(
          `[TicketsHeader] search bar ${
            isSearchVisible ? "expanded" : "collapsed"
          }`,
        );
      }
    });
  }, [isSearchVisible, widthAnim]);

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
          {/* Filter button — always visible */}
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

          {/* Search icon — shown when the search bar is collapsed */}
          {!isSearchVisible && (
            <Pressable
              onPress={onToggleSearch}
              className="w-11 h-11 rounded-2xl items-center justify-center"
              style={{ backgroundColor: colors.surface }}
            >
              <Ionicons name="search-outline" size={20} color={colors.text} />
            </Pressable>
          )}

          {/* Expanding search input bar — slides out to the left.
              Animated width grows from 0 -> SEARCH_BAR_WIDTH.  Overflow is
              hidden so the inner content is clipped during the animation. */}
          <Animated.View
            style={{
              width: widthAnim,
              height: 44,
              overflow: "hidden",
            }}
          >
            <View
              className="flex-row items-center px-3 h-11"
              style={{
                width: SEARCH_BAR_WIDTH,
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
    </View>
  );
}
