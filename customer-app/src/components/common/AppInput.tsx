import React from "react";
import {
  StyleSheet,
  Text,
  TextInput,
  TextInputProps,
  View,
} from "react-native";

import { COLORS, RADIUS, SPACING, TYPOGRAPHY } from "../../constants/colors";

type Props = TextInputProps & {
  label: string;
  error?: string;
};

export default function AppInput({
  label,
  error,
  style,
  ...inputProps
}: Props) {
  return (
    <View style={styles.container}>
      <Text style={styles.label}>{label}</Text>

      <TextInput
        {...inputProps}
        accessibilityLabel={label}
        placeholderTextColor={COLORS.textSecondary}
        style={[styles.input, error ? styles.inputError : undefined, style]}
      />

      {error ? (
        <Text accessibilityRole="alert" style={styles.error}>
          {error}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: SPACING.sm,
  },
  label: {
    color: COLORS.text,
    fontSize: TYPOGRAPHY.caption,
    fontWeight: "600",
  },
  input: {
    minHeight: 52,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: RADIUS.md,
    backgroundColor: COLORS.surface,
    paddingHorizontal: SPACING.md,
    fontSize: TYPOGRAPHY.body,
    color: COLORS.text,
  },
  inputError: {
    borderColor: COLORS.error,
  },
  error: {
    color: COLORS.error,
    fontSize: TYPOGRAPHY.caption,
  },
});
