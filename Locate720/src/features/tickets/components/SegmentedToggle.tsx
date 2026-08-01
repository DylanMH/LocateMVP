import { Pressable, Text, View } from "react-native";

import { colors } from "../../../ui/colors";

export type SegmentedToggleOption = "LIST" | "MAP" | "RESCHEDULE";

export function SegmentedToggle({
  value,
  onChange,
}: {
  value: SegmentedToggleOption;
  onChange: (next: SegmentedToggleOption) => void;
}) {
  return (
    <View
      className="flex-row rounded-xl p-1"
      style={{ backgroundColor: colors.surface }}
    >
      <Pressable
        onPress={() => onChange("LIST")}
        className="px-4 py-2 rounded-lg"
        style={{ backgroundColor: value === "LIST" ? colors.primary : "transparent" }}
      >
        <Text className="text-sm font-semibold" style={{ color: colors.text }}>
          List
        </Text>
      </Pressable>
      <View className="w-1" />
      <Pressable
        onPress={() => onChange("MAP")}
        className="px-4 py-2 rounded-lg"
        style={{ backgroundColor: value === "MAP" ? colors.primary : "transparent" }}
      >
        <Text className="text-sm font-semibold" style={{ color: colors.text }}>
          Map
        </Text>
      </Pressable>
      <View className="w-1" />
      <Pressable
        onPress={() => onChange("RESCHEDULE")}
        className="px-4 py-2 rounded-lg"
        style={{
          backgroundColor:
            value === "RESCHEDULE" ? colors.primary : "transparent",
        }}
      >
        <Text className="text-sm font-semibold" style={{ color: colors.text }}>
          Reschedule
        </Text>
      </Pressable>
    </View>
  );
}
