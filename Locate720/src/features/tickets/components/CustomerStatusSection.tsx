import { Pressable, Text, TextInput, View } from "react-native";

import { colors } from "../../../ui/colors";
import type { Customer } from "../types";

export type CustomerStatusDraft = {
  minutes: string;
  footage: string;
};

export type CustomerStatusDraftByCustomerId = Record<string, CustomerStatusDraft>;

function FieldLabel({ label }: { label: string }) {
  return (
    <Text className="text-xs font-semibold" style={{ color: colors.muted }}>
      {label}
    </Text>
  );
}

function TextField({
  value,
  placeholder,
  onChangeText,
  keyboardType,
}: {
  value: string;
  placeholder: string;
  onChangeText: (next: string) => void;
  keyboardType?: "default" | "numeric";
}) {
  return (
    <TextInput
      value={value}
      placeholder={placeholder}
      placeholderTextColor={colors.muted}
      keyboardType={keyboardType}
      onChangeText={onChangeText}
      className="rounded-xl px-3 py-2"
      style={{ backgroundColor: colors.bg, color: colors.text, borderWidth: 1, borderColor: colors.surface }}
    />
  );
}

export function CustomerStatusSection({
  customers,
  value,
  onChange,
}: {
  customers: Customer[];
  value: CustomerStatusDraftByCustomerId;
  onChange: (next: CustomerStatusDraftByCustomerId) => void;
}) {
  const initMissing = () => {
    let changed = false;
    const next: CustomerStatusDraftByCustomerId = { ...value };
    for (const c of customers) {
      if (!next[c.id]) {
        next[c.id] = { minutes: "", footage: "" };
        changed = true;
      }
    }
    if (changed) onChange(next);
  };

  return (
    <View onLayout={initMissing}>
      <Text className="text-sm" style={{ color: colors.muted }}>
        Enter your statusing time and footage allocation per customer.
      </Text>

      <View className="mt-3" style={{ gap: 12 }}>
        {customers.map((c) => {
          const draft = value[c.id] ?? { minutes: "", footage: "" };
          return (
            <View key={c.id} className="rounded-2xl p-3" style={{ backgroundColor: colors.bg }}>
              <Text className="text-sm font-semibold" style={{ color: colors.text }}>
                {c.name}
              </Text>
              <Text className="text-xs mt-1" style={{ color: colors.muted }}>
                {c.accountNumber}
              </Text>

              <View className="flex-row mt-3" style={{ gap: 10 }}>
                <View className="flex-1">
                  <FieldLabel label="Minutes" />
                  <View className="h-1" />
                  <TextField
                    value={draft.minutes}
                    placeholder="e.g. 18"
                    keyboardType="numeric"
                    onChangeText={(t) => onChange({ ...value, [c.id]: { ...draft, minutes: t } })}
                  />
                </View>
                <View className="flex-1">
                  <FieldLabel label="Footage" />
                  <View className="h-1" />
                  <TextField
                    value={draft.footage}
                    placeholder="e.g. 240"
                    keyboardType="numeric"
                    onChangeText={(t) => onChange({ ...value, [c.id]: { ...draft, footage: t } })}
                  />
                </View>
              </View>

              <View className="flex-row mt-3" style={{ gap: 10 }}>
                <Pressable
                  className="rounded-xl px-3 py-2"
                  style={{ backgroundColor: colors.surface }}
                  onPress={() => onChange({ ...value, [c.id]: { minutes: "", footage: "" } })}
                >
                  <Text className="text-xs font-semibold" style={{ color: colors.text }}>
                    Clear
                  </Text>
                </Pressable>
              </View>
            </View>
          );
        })}
      </View>
    </View>
  );
}

export function isCustomerStatusComplete(
  customers: Customer[],
  value: CustomerStatusDraftByCustomerId
): boolean {
  for (const c of customers) {
    const draft = value[c.id];
    if (!draft) return false;

    const minutes = Number(draft.minutes);
    const footage = Number(draft.footage);

    if (!Number.isFinite(minutes) || minutes <= 0) return false;
    if (!Number.isFinite(footage) || footage <= 0) return false;
  }

  return true;
}
