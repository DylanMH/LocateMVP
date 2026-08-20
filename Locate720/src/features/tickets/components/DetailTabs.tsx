import { Pressable, Text, View } from "react-native";

import { colors } from "../../../ui/colors";
import { spacing } from "../../../ui/spacing";
import { typography } from "../../../ui/typography";
import { triggerLightHaptic } from "../../../utils/haptics";

export type DetailTabKey = "INFO" | "CUSTOMER" | "ATTACHMENTS" | "NOTES" | "HISTORY";

const TABS: { key: DetailTabKey; label: string }[] = [
  { key: "INFO", label: "Info" },
  { key: "CUSTOMER", label: "Customer" },
  { key: "ATTACHMENTS", label: "Files" },
  { key: "NOTES", label: "Notes" },
  { key: "HISTORY", label: "History" },
];

export function DetailTabs({
  value,
  onChange,
}: {
  value: DetailTabKey;
  onChange: (next: DetailTabKey) => void;
}) {
  return (
    <View
      style={{
        flexDirection: "row",
        borderBottomWidth: 1,
        borderBottomColor: colors.bg,
      }}
    >
      {TABS.map((tab) => {
        const active = value === tab.key;
        return (
          <Pressable
            key={tab.key}
            onPress={() => {
              triggerLightHaptic();
              onChange(tab.key);
            }}
            hitSlop={{ top: 8, bottom: 8, left: 2, right: 2 }}
            style={{
              flex: 1,
              paddingVertical: spacing.tight,
              paddingHorizontal: spacing.xs,
              alignItems: "center",
              borderBottomWidth: 2,
              borderBottomColor: active ? colors.accent : "transparent",
            }}
          >
            <Text
              numberOfLines={1}
              adjustsFontSizeToFit
              style={{
                color: active ? colors.accent : colors.muted,
                fontSize: typography.metadata,
                fontWeight: active ? typography.weightSemibold : typography.weightRegular,
              }}
            >
              {tab.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}
