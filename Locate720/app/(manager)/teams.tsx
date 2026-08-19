import { useCallback, useMemo, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  Text,
  View,
} from "react-native";
import { useFocusEffect } from "expo-router";
import { Ionicons } from "@expo/vector-icons";

import { useAuth } from "../../src/features/auth/AuthContext";
import {
  fetchOpsTeams,
  type TerritoryNode,
} from "../../src/features/ops/api/opsApiClient";
import { colors } from "../../src/ui/colors";
import { logger } from "../../src/utils/logger";

const TYPE_COLORS: Record<string, string> = {
  DISTRICT: "#7c3aed",
  AREA: "#2563eb",
  SUPERVISOR_TERRITORY: "#0891b2",
  TECH_TERRITORY: "#059669",
};

const TYPE_LABELS: Record<string, string> = {
  DISTRICT: "District",
  AREA: "Area",
  SUPERVISOR_TERRITORY: "Supervisor",
  TECH_TERRITORY: "Tech",
};

interface FlatNode {
  node: TerritoryNode;
  depth: number;
  hasChildren: boolean;
}

function flattenTree(
  nodes: TerritoryNode[],
  expanded: Set<string>,
  depth = 0,
): FlatNode[] {
  const result: FlatNode[] = [];
  for (const node of nodes) {
    const hasChildren = node.children && node.children.length > 0;
    result.push({ node, depth, hasChildren });
    if (hasChildren && expanded.has(node.id)) {
      result.push(...flattenTree(node.children, expanded, depth + 1));
    }
  }
  return result;
}

export default function ManagerTeamsScreen() {
  const { token } = useAuth();
  const [teams, setTeams] = useState<TerritoryNode[]>([]);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadTeams = useCallback(
    async (isRefresh = false) => {
      if (!token) {
        setError("Not authenticated");
        setLoading(false);
        return;
      }
      if (isRefresh) setRefreshing(true);
      else setLoading(true);
      setError(null);
      try {
        const data = await fetchOpsTeams(token);
        setTeams(data.teams || []);
      } catch (e) {
        logger.error("[Manager Teams] Failed to load:", e);
        setError(e instanceof Error ? e.message : "Failed to load teams");
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [token],
  );

  useFocusEffect(
    useCallback(() => {
      loadTeams();
    }, [loadTeams]),
  );

  const handleRefresh = () => loadTeams(true);

  const toggleExpand = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const flatNodes = useMemo(() => flattenTree(teams, expanded), [teams, expanded]);

  if (loading) {
    return (
      <View
        className="flex-1 items-center justify-center"
        style={{ backgroundColor: colors.bg }}
      >
        <ActivityIndicator size="large" color={colors.accent} />
        <Text className="text-sm mt-3" style={{ color: colors.muted }}>
          Loading teams...
        </Text>
      </View>
    );
  }

  if (error && teams.length === 0) {
    return (
      <View
        className="flex-1 items-center justify-center px-5"
        style={{ backgroundColor: colors.bg }}
      >
        <Ionicons name="cloud-offline" size={48} color={colors.danger} />
        <Text
          className="text-base font-semibold mt-4"
          style={{ color: colors.text }}
        >
          Failed to load teams
        </Text>
        <Text className="text-sm mt-2 text-center" style={{ color: colors.muted }}>
          {error}
        </Text>
        <Pressable
          onPress={() => loadTeams()}
          className="mt-4 rounded-xl px-5 py-3"
          style={{ backgroundColor: colors.primary }}
        >
          <Text className="text-sm font-semibold" style={{ color: colors.text }}>
            Retry
          </Text>
        </Pressable>
      </View>
    );
  }

  const renderItem = ({ item }: { item: FlatNode }) => {
    const { node, depth, hasChildren } = item;
    const isExpanded = expanded.has(node.id);
    const typeColor = TYPE_COLORS[node.type] || colors.muted;
    const typeLabel = TYPE_LABELS[node.type] || node.type;

    return (
      <Pressable
        onPress={() => hasChildren && toggleExpand(node.id)}
        style={{
          paddingLeft: 16 + depth * 20,
          paddingRight: 16,
          paddingVertical: 12,
        }}
      >
        <View className="flex-row items-center">
          {hasChildren ? (
            <Ionicons
              name={isExpanded ? "chevron-down" : "chevron-forward"}
              size={16}
              color={colors.muted}
              style={{ marginRight: 8 }}
            />
          ) : (
            <View style={{ width: 24 }} />
          )}

          <View className="flex-1">
            <View className="flex-row items-center" style={{ gap: 8 }}>
              <Text
                className="text-sm font-semibold flex-1"
                style={{ color: colors.text }}
                numberOfLines={1}
              >
                {node.name}
              </Text>
              <View
                className="rounded px-2 py-0.5"
                style={{ backgroundColor: typeColor + "20" }}
              >
                <Text
                  className="text-xs font-semibold"
                  style={{ color: typeColor }}
                >
                  {typeLabel}
                </Text>
              </View>
            </View>
            {node.supervisorName ? (
              <Text
                className="text-xs mt-1"
                style={{ color: colors.muted }}
                numberOfLines={1}
              >
                {node.supervisorName}
              </Text>
            ) : null}
            <Text className="text-xs mt-0.5" style={{ color: colors.muted }}>
              {node.techCount} {node.techCount === 1 ? "tech" : "techs"}
            </Text>
          </View>
        </View>
      </Pressable>
    );
  };

  return (
    <View className="flex-1" style={{ backgroundColor: colors.bg }}>
      {error ? (
        <View
          className="rounded-xl p-3 mx-4 mt-3"
          style={{ backgroundColor: colors.danger + "15" }}
        >
          <Text className="text-sm" style={{ color: colors.danger }}>
            {error}
          </Text>
        </View>
      ) : null}

      {teams.length === 0 && !error ? (
        <View
          className="flex-1 items-center justify-center px-5"
          style={{ backgroundColor: colors.bg }}
        >
          <Ionicons name="git-branch-outline" size={48} color={colors.muted} />
          <Text
            className="text-base font-semibold mt-4"
            style={{ color: colors.text }}
          >
            No teams found
          </Text>
          <Text className="text-sm mt-2 text-center" style={{ color: colors.muted }}>
            No territories are assigned to your hierarchy.
          </Text>
        </View>
      ) : (
        <FlatList
          data={flatNodes}
          keyExtractor={(item) => item.node.id}
          renderItem={renderItem}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={handleRefresh} />
          }
          ItemSeparatorComponent={() => (
            <View style={{ height: 1, backgroundColor: colors.bg, marginLeft: 40 }} />
          )}
          contentContainerStyle={{ paddingVertical: 8, paddingBottom: 24 }}
        />
      )}
    </View>
  );
}
