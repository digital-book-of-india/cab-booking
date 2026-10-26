import React from "react";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  ViewStyle,
} from "react-native";

import { COLORS, RADIUS, SPACING, TYPOGRAPHY } from "../../constants/colors";

type Props = {
  title: string;
  onPress: () => void;
  loading?: boolean;
  disabled?: boolean;
  variant?: "primary" | "outline";
  style?: ViewStyle;
};

export default function AppButton({
  title,
  onPress,
  loading = false,
  disabled = false,
  variant = "primary",
  style,
}: Props) {
  const unavailable = disabled || loading;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={title}
      disabled={unavailable}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        variant === "primary" ? styles.primary : styles.outline,
        unavailable && styles.disabled,
        pressed && !unavailable && styles.pressed,
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator
          color={variant === "primary" ? COLORS.white : COLORS.primary}
        />
      ) : (
        <Text
          style={[
            styles.label,
            variant === "primary" ? styles.primaryLabel : styles.outlineLabel,
          ]}
        >
          {title}
        </Text>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    minHeight: 52,
    paddingHorizontal: SPACING.lg,
    borderRadius: RADIUS.md,
    alignItems: "center",
    justifyContent: "center",
  },
  primary: {
    backgroundColor: COLORS.primary,
  },
  outline: {
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.primary,
  },
  label: {
    fontSize: TYPOGRAPHY.body,
    fontWeight: "600",
  },
  primaryLabel: {
    color: COLORS.white,
  },
  outlineLabel: {
    color: COLORS.primary,
  },
  disabled: {
    opacity: 0.5,
  },
  pressed: {
    opacity: 0.8,
  },
});
