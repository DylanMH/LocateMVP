import { Pressable, Text, View } from "react-native";

import { colors } from "../../../ui/colors";

export type DetailTabKey = "INFO" | "CUSTOMER" | "ATTACHMENTS" | "NOTES" | "HISTORY";

function Tab({
  label,
  active,
  onPress,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      className="px-4 py-2 rounded-lg"
      style={{ backgroundColor: active ? colors.primary : colors.surface }}
      hitSlop={10}
    >
      <Text className="text-sm font-semibold" style={{ color: colors.text }}>
        {label}
      </Text>
    </Pressable>
  );
}

export function DetailTabs({
  value,
  onChange,
}: {
  value: DetailTabKey;
  onChange: (next: DetailTabKey) => void;
}) {
  return (
    <View className="flex-row" style={{ gap: 10, flexWrap: "wrap" }}>
      <Tab
        label="Info"
        active={value === "INFO"}
        onPress={() => onChange("INFO")}
      />
      <Tab
        label="Customer"
        active={value === "CUSTOMER"}
        onPress={() => onChange("CUSTOMER")}
      />
      <Tab
        label="Attachments"
        active={value === "ATTACHMENTS"}
        onPress={() => onChange("ATTACHMENTS")}
      />
      <Tab
        label="Notes"
        active={value === "NOTES"}
        onPress={() => onChange("NOTES")}
      />
      <Tab
        label="History"
        active={value === "HISTORY"}
        onPress={() => onChange("HISTORY")}
      />
    </View>
  );
}
