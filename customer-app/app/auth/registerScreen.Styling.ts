import { StyleSheet } from "react-native";
import { COLORS, SPACING, RADIUS } from "../../src/constants/colors";

export const styles = StyleSheet.create({
  flex: {
    flex: 1,
  },

  screen: {
    flex: 1,
  },

  backButton: {
    width: 44,
    height: 44,
    borderRadius: RADIUS.full,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: COLORS.surface,
  },

  backText: {
    fontSize: 32,
    color: COLORS.text,
    marginTop: -4,
  },

  content: {
    marginTop: 30,
  },

  iconCircle: {
    width: 60,
    height: 60,
    borderRadius: RADIUS.lg,
    backgroundColor: "#DBEAFE",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: SPACING.lg,
  },

  phoneIcon: {
    fontSize: 28,
    color: COLORS.primary,
  },

  title: {
    fontSize: 28,
    fontWeight: "800",
    color: COLORS.text,
    marginBottom: SPACING.sm,
  },

  description: {
    fontSize: 15,
    lineHeight: 23,
    color: COLORS.textSecondary,
    marginBottom: SPACING.lg,
  },

  label: {
    fontSize: 14,
    fontWeight: "600",
    color: COLORS.text,
    marginBottom: SPACING.sm,
  },

  phoneRow: {
    minHeight: 58,
    flexDirection: "row",
    alignItems: "center",
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: RADIUS.md,
    backgroundColor: COLORS.surface,
    paddingHorizontal: SPACING.sm,
  },

  inputError: {
    borderColor: COLORS.error,
  },

  countrySelector: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: 5,
    minHeight: 48,
  },

  callingCode: {
    fontSize: 14,
    fontWeight: "600",
    color: COLORS.text,
  },

  chevron: {
    color: COLORS.textSecondary,
    fontSize: 15,
  },

  separator: {
    width: 1,
    height: 28,
    backgroundColor: COLORS.border,
    marginHorizontal: SPACING.sm,
  },

  phoneInput: {
    flex: 1,
    minWidth: 0,
    fontSize: 16,
    color: COLORS.text,
    paddingVertical: 12,
  },

  error: {
    color: COLORS.error,
    fontSize: 13,
    marginTop: SPACING.sm,
  },

  privacy: {
    color: COLORS.textSecondary,
    fontSize: 12,
    lineHeight: 19,
    marginTop: SPACING.lg,
  },

  footer: {
    marginTop: "auto",
    paddingTop: SPACING.lg,
    gap: SPACING.md,
  },

  loginLink: {
    alignItems: "center",
    paddingVertical: SPACING.sm,
  },

  loginText: {
    color: COLORS.textSecondary,
    fontSize: 14,
  },

  loginHighlight: {
    color: COLORS.primary,
    fontWeight: "700",
  },
});
