import React from "react";
import { ActivityIndicator, StyleSheet, View } from "react-native";

import { COLORS, SPACING } from "../../constants/colors";

type Props = {
  fullScreen?: boolean;
};

export default function LoadingIndicator({ fullScreen = false }: Props) {
  return (
    <View
      style={[styles.container, fullScreen && styles.fullScreen]}
      accessibilityLabel="Loading"
    >
      <ActivityIndicator size="large" color={COLORS.primary} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: "center",
    justifyContent: "center",
    padding: SPACING.lg,
  },
  fullScreen: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
});
