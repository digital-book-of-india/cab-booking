import React, { ReactNode } from "react";
import { SafeAreaView, StyleSheet, View, ViewStyle } from "react-native";

import { COLORS } from "../../constants/colors";

type ScreenContainerProps = {
  children: ReactNode;
  style?: ViewStyle;
};

export default function ScreenContainer({
  children,
  style,
}: ScreenContainerProps) {
  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={[styles.container, style]}>{children}</View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  container: {
    flex: 1,
    paddingHorizontal: 20,
    paddingVertical: 16,
  },
});
