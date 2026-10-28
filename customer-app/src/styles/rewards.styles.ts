import { StyleSheet } from "react-native";
import { COLORS, RADIUS, SPACING } from "../constants/colors";

export const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  scrollContent: {
    padding: SPACING.md,
    paddingBottom: SPACING.xxl,
  },

  /* Hero Points Balance Card */
  heroCard: {
    backgroundColor: "#1E1B4B",
    borderRadius: RADIUS.lg,
    padding: SPACING.lg,
    marginBottom: SPACING.md,
    shadowColor: "#4338CA",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 10,
    elevation: 3,
  },
  heroTopRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: SPACING.sm,
  },
  heroBadge: {
    backgroundColor: "#312E81",
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: RADIUS.sm,
    borderWidth: 1,
    borderColor: "#4338CA",
  },
  heroBadgeText: {
    color: "#A5B4FC",
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 0.5,
  },
  heroLabel: {
    color: "#94A3B8",
    fontSize: 12,
    fontWeight: "500",
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  pointsRow: {
    flexDirection: "row",
    alignItems: "baseline",
    gap: 6,
    marginBottom: SPACING.xs,
  },
  pointsValue: {
    color: COLORS.white,
    fontSize: 32,
    fontWeight: "800",
  },
  pointsUnit: {
    color: "#818CF8",
    fontSize: 14,
    fontWeight: "600",
  },
  heroDesc: {
    color: "#CBD5E1",
    fontSize: 12,
    lineHeight: 16,
  },

  /* Category Filter Chips */
  categoryScroll: {
    marginBottom: SPACING.md,
  },
  categoryChip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: RADIUS.full,
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.border,
    marginRight: 8,
  },
  categoryChipActive: {
    backgroundColor: COLORS.primary,
    borderColor: COLORS.primary,
  },
  categoryChipText: {
    fontSize: 12,
    fontWeight: "600",
    color: COLORS.textSecondary,
  },
  categoryChipTextActive: {
    color: COLORS.white,
  },

  /* Section Header */
  sectionHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: SPACING.sm,
  },
  sectionTitle: {
    fontSize: 13,
    fontWeight: "700",
    color: COLORS.textSecondary,
    textTransform: "uppercase",
    letterSpacing: 0.6,
  },

  /* Partner Reward Card */
  rewardCard: {
    backgroundColor: COLORS.surface,
    borderRadius: RADIUS.lg,
    padding: SPACING.md,
    marginBottom: SPACING.sm,
    borderWidth: 1,
    borderColor: COLORS.border,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 4,
    elevation: 1,
  },
  rewardHeader: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 10,
  },
  brandIconBox: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
    marginRight: 12,
  },
  brandInfo: {
    flex: 1,
  },
  brandName: {
    fontSize: 13,
    fontWeight: "600",
    color: COLORS.textSecondary,
    marginBottom: 2,
  },
  offerTitle: {
    fontSize: 15,
    fontWeight: "700",
    color: COLORS.text,
  },
  pointsTag: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#FEF3C7",
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: RADIUS.sm,
    gap: 3,
  },
  pointsTagText: {
    fontSize: 11,
    fontWeight: "700",
    color: "#D97706",
  },
  rewardDesc: {
    fontSize: 13,
    color: COLORS.textSecondary,
    lineHeight: 18,
    marginBottom: 12,
  },
  cardFooter: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    borderTopWidth: 1,
    borderTopColor: "#F1F5F9",
    paddingTop: 10,
  },
  expiryText: {
    fontSize: 11,
    color: COLORS.textSecondary,
  },
  claimBtn: {
    backgroundColor: "#EFF6FF",
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: RADIUS.full,
    borderWidth: 1,
    borderColor: "#BFDBFE",
  },
  claimBtnClaimed: {
    backgroundColor: "#F0FDF4",
    borderColor: "#BBF7D0",
  },
  claimBtnText: {
    fontSize: 12,
    fontWeight: "700",
    color: COLORS.primary,
  },
  claimBtnTextClaimed: {
    color: COLORS.success,
  },

  /* Claim Voucher Modal */
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.5)",
    justifyContent: "flex-end",
  },
  modalContent: {
    backgroundColor: COLORS.surface,
    borderTopLeftRadius: RADIUS.xl,
    borderTopRightRadius: RADIUS.xl,
    padding: SPACING.lg,
    paddingBottom: SPACING.xxl,
  },
  modalHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: SPACING.md,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: "700",
    color: COLORS.text,
  },
  voucherBox: {
    backgroundColor: "#F8FAFC",
    borderRadius: RADIUS.md,
    borderWidth: 1.5,
    borderColor: COLORS.primary,
    borderStyle: "dashed",
    padding: SPACING.md,
    alignItems: "center",
    marginVertical: SPACING.md,
  },
  voucherCode: {
    fontSize: 22,
    fontWeight: "800",
    color: COLORS.primary,
    letterSpacing: 1.5,
    marginBottom: 4,
  },
  voucherSub: {
    fontSize: 12,
    color: COLORS.textSecondary,
  },
  instructionText: {
    fontSize: 13,
    color: COLORS.textSecondary,
    lineHeight: 18,
    marginBottom: SPACING.lg,
  },
});
