import { StyleSheet } from "react-native";
import { COLORS, SPACING, TYPOGRAPHY, RADIUS } from "../constants/colors";

export const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: "space-between",
    backgroundColor: COLORS.background,
  },

  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: SPACING.sm,
    paddingTop: SPACING.md,
  },

  logo: {
    width: 42,
    height: 42,
    borderRadius: RADIUS.md,
    backgroundColor: COLORS.primary,
    alignItems: "center",
    justifyContent: "center",
  },

  logoText: {
    color: COLORS.white,
    fontSize: TYPOGRAPHY.heading,
    fontWeight: "800",
  },

  brandName: {
    color: COLORS.text,
    fontSize: TYPOGRAPHY.subtitle,
    fontWeight: "700",
  },

  content: {
    alignItems: "flex-start",
    marginVertical: SPACING.xl,
  },

  illustration: {
    width: 150,
    height: 150,
    borderRadius: 75,
    backgroundColor: "#DBEAFE",
    alignItems: "center",
    justifyContent: "center",
    alignSelf: "center",
    marginBottom: SPACING.xl,
  },

  title: {
    color: COLORS.text,
    fontSize: 36,
    lineHeight: 44,
    fontWeight: "800",
    marginBottom: SPACING.md,
  },

  description: {
    color: COLORS.textSecondary,
    fontSize: TYPOGRAPHY.body,
    lineHeight: 25,
  },

  footer: {
    gap: SPACING.md,
    paddingBottom: SPACING.md,
  },

  loginRow: {
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "center",
    gap: SPACING.xs,
    flexWrap: "wrap",
  },

  loginText: {
    color: COLORS.textSecondary,
    fontSize: TYPOGRAPHY.caption + 2,
  },

  loginLink: {
    color: COLORS.primary,
    fontSize: TYPOGRAPHY.caption + 2,
    fontWeight: "700",
    padding: SPACING.xs,
  },

  terms: {
    color: COLORS.textSecondary,
    fontSize: TYPOGRAPHY.caption,
    textAlign: "center",
    lineHeight: 18,
  },
});
