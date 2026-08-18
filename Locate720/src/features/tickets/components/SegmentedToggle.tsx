import { Pressable, Text, View } from "react-native";

import { colors } from "../../../ui/colors";
import { triggerLightHaptic } from "../../../utils/haptics";

export type SegmentedToggleOption = "LIST" | "COMPACT" | "MAP" | "RESCHEDULE";

export function SegmentedToggle({
  value,
  onChange,
}: {
  value: SegmentedToggleOption;
  onChange: (next: SegmentedToggleOption) => void;
}) {
  const handleSelect = (option: SegmentedToggleOption) => {
    triggerLightHaptic();
    onChange(option);
  };

  return (
    <View
      className="flex-row rounded-xl p-1"
      style={{ backgroundColor: colors.surface }}
    >
      <Pressable
        onPress={() => handleSelect("LIST")}
        className="px-3 py-1.5 rounded-lg"
        style={{ backgroundColor: value === "LIST" ? colors.primary : "transparent" }}
      >
        <Text className="text-xs font-semibold" style={{ color: colors.text }}>
          List
        </Text>
      </Pressable>
      <View className="w-0.5" />
      <Pressable
        onPress={() => handleSelect("COMPACT")}
        className="px-3 py-1.5 rounded-lg"
        style={{ backgroundColor: value === "COMPACT" ? colors.primary : "transparent" }}
      >
        <Text className="text-xs font-semibold" style={{ color: colors.text }}>
          Compact
        </Text>
      </Pressable>
      <View className="w-0.5" />
      <Pressable
        onPress={() => handleSelect("MAP")}
        className="px-3 py-1.5 rounded-lg"
        style={{ backgroundColor: value === "MAP" ? colors.primary : "transparent" }}
      >
        <Text className="text-xs font-semibold" style={{ color: colors.text }}>
          Map
        </Text>
      </Pressable>
      <View className="w-0.5" />
      <Pressable
        onPress={() => handleSelect("RESCHEDULE")}
        className="px-3 py-1.5 rounded-lg"
        style={{
          backgroundColor:
            value === "RESCHEDULE" ? colors.primary : "transparent",
        }}
      >
        <Text className="text-xs font-semibold" style={{ color: colors.text }}>
          Reschedule
        </Text>
      </Pressable>
    </View>
  );
}
