import React from 'react';
import {
  StyleSheet,
  Text,
  TextInput,
  TextInputProps,
  View,
} from 'react-native';

import { COLORS, RADIUS, SPACING, TYPOGRAPHY } from '../../constants/colors';

export type AppInputProps = TextInputProps & {
  label?: string;
  error?: string;
};

export function AppInput({
  label,
  error,
  style,
  ...inputProps
}: AppInputProps) {
  return (
    <View style={styles.container}>
      {Boolean(label) && <Text style={styles.label}>{label}</Text>}

      <TextInput
        {...inputProps}
        accessibilityLabel={label || inputProps.placeholder}
        placeholderTextColor={COLORS.textSecondary}
        style={[
          styles.input,
          error ? styles.inputError : undefined,
          inputProps.multiline ? styles.multiline : undefined,
          style,
        ]}
      />

      {Boolean(error) && <Text style={styles.error}>{error}</Text>}
    </View>
  );
}

export default AppInput;

const styles = StyleSheet.create({
  container: {
    marginBottom: SPACING.md,
  },
  label: {
    fontSize: TYPOGRAPHY.caption + 1,
    fontWeight: '600',
    color: COLORS.text,
    marginBottom: SPACING.xs,
  },
  input: {
    height: 48,
    borderRadius: RADIUS.md,
    borderWidth: 1.5,
    borderColor: COLORS.border,
    paddingHorizontal: SPACING.md,
    fontSize: TYPOGRAPHY.body,
    color: COLORS.text,
    backgroundColor: COLORS.surface,
  },
  multiline: {
    height: 80,
    paddingTop: SPACING.sm,
    textAlignVertical: 'top',
  },
  inputError: {
    borderColor: COLORS.error,
  },
  error: {
    fontSize: TYPOGRAPHY.caption,
    color: COLORS.error,
    marginTop: SPACING.xs,
  },
});
