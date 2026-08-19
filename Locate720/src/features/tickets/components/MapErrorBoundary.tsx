import { Component, type ReactNode } from "react";
import { Pressable, Text, View } from "react-native";

import { colors } from "../../../ui/colors";
import { logger } from "../../../utils/logger";

type Props = {
  children: ReactNode;
};

type State = {
  hasError: boolean;
};

export class MapErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: { componentStack: string }) {
    logger.error("[MapErrorBoundary] Map render error:", error, info);
  }

  handleRetry = () => {
    this.setState({ hasError: false });
  };

  render() {
    if (this.state.hasError) {
      return (
        <View className="flex-1 items-center justify-center p-5">
          <Text className="text-lg font-bold" style={{ color: colors.text }}>
            Map unavailable
          </Text>
          <Text className="text-sm mt-2 text-center" style={{ color: colors.muted }}>
            An error occurred while loading the map. Try again or use the ticket list.
          </Text>
          <Pressable
            onPress={this.handleRetry}
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

    return this.props.children;
  }
}
