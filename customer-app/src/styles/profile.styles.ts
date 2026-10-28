import { StyleSheet } from "react-native";
import { COLORS, RADIUS, SPACING } from "../constants/colors";

export const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  scrollContent: {
    padding: SPACING.md,
    paddingBottom: SPACING.xl,
  },

  /* ========================================================
   * 1. Top Profile Header Card (Left Icon + User Details)
   * ======================================================== */
  profileHeaderCard: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: COLORS.surface,
    borderRadius: RADIUS.lg,
    padding: SPACING.md,
    marginBottom: SPACING.md,
    borderWidth: 1,
    borderColor: COLORS.border,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.04,
    shadowRadius: 6,
    elevation: 2,
  },
  avatarContainer: {
    position: "relative",
    marginRight: SPACING.md,
  },
  avatarCircle: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: "#EFF6FF",
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 2,
    borderColor: "#DBEAFE",
  },
  avatarText: {
    fontSize: 22,
    fontWeight: "700",
    color: COLORS.primary,
  },
  avatarEditBadge: {
    position: "absolute",
    bottom: -2,
    right: -2,
    backgroundColor: COLORS.primary,
    width: 22,
    height: 22,
    borderRadius: 11,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 2,
    borderColor: COLORS.surface,
  },
  profileInfo: {
    flex: 1,
    justifyContent: "center",
  },
  userName: {
    fontSize: 18,
    fontWeight: "700",
    color: COLORS.text,
    marginBottom: 2,
  },
  userPhone: {
    fontSize: 13,
    color: COLORS.textSecondary,
    marginBottom: 4,
  },
  userMetaRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  ratingBadge: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#FEF3C7",
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: RADIUS.sm,
    gap: 3,
  },
  ratingText: {
    fontSize: 12,
    fontWeight: "700",
    color: "#D97706",
  },
  editArrowBtn: {
    padding: SPACING.xs,
  },

  /* ========================================================
   * 2. 4 Quick Action Cards (Help, Wallet, Safety, Offers)
   * ======================================================== */
  quickActionsGrid: {
    flexDirection: "row",
    justifyContent: "space-between",
    gap: 8,
    marginBottom: SPACING.lg,
  },
  actionCard: {
    flex: 1,
    backgroundColor: COLORS.surface,
    borderRadius: RADIUS.md,
    paddingVertical: SPACING.md,
    paddingHorizontal: 4,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: COLORS.border,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.03,
    shadowRadius: 4,
    elevation: 1,
  },
  actionIconBox: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 6,
  },
  actionLabel: {
    fontSize: 12,
    fontWeight: "600",
    color: COLORS.text,
  },

  /* ========================================================
   * 3. Enhanced 2-Line Menu Items (Title + Subtitle + Badge)
   * ======================================================== */
  sectionCard: {
    backgroundColor: COLORS.surface,
    borderRadius: RADIUS.lg,
    paddingHorizontal: SPACING.md,
    paddingTop: SPACING.md,
    paddingBottom: SPACING.xs,
    borderWidth: 1,
    borderColor: COLORS.border,
    marginBottom: SPACING.md,
  },
  sectionTitle: {
    fontSize: 12,
    fontWeight: "700",
    color: COLORS.textSecondary,
    textTransform: "uppercase",
    letterSpacing: 0.6,
    marginBottom: SPACING.xs,
  },
  menuItem: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: "#F1F5F9",
  },
  menuItemLeft: {
    flexDirection: "row",
    alignItems: "center",
    flex: 1,
    marginRight: SPACING.sm,
  },
  menuIconCircle: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: "#F8FAFC",
    alignItems: "center",
    justifyContent: "center",
    marginRight: 12,
  },
  menuItemTextContainer: {
    flex: 1,
    justifyContent: "center",
  },
  menuItemTitle: {
    fontSize: 15,
    fontWeight: "600",
    color: COLORS.text,
    marginBottom: 2,
  },
  menuItemSubtitle: {
    fontSize: 12,
    color: COLORS.textSecondary,
    lineHeight: 16,
  },
  menuItemRight: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  menuBadgeNew: {
    backgroundColor: "#1E40AF",
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 4,
  },
  menuBadgeNewText: {
    color: "#FFFFFF",
    fontSize: 10,
    fontWeight: "700",
    letterSpacing: 0.5,
  },

  /* ========================================================
   * 4. Modals (Edit Profile & Offers)
   * ======================================================== */
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0, 0, 0, 0.5)",
    justifyContent: "flex-end",
  },
  modalContent: {
    backgroundColor: COLORS.surface,
    borderTopLeftRadius: RADIUS.xl,
    borderTopRightRadius: RADIUS.xl,
    padding: SPACING.lg,
    paddingBottom: SPACING.xl,
    maxHeight: "85%",
  },
  modalHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: SPACING.lg,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: "700",
    color: COLORS.text,
  },
  modalCloseBtn: {
    padding: SPACING.xs,
  },
  modalAvatarPreview: {
    alignItems: "center",
    marginBottom: SPACING.lg,
  },
  modalAvatarCircle: {
    width: 76,
    height: 76,
    borderRadius: 38,
    backgroundColor: "#EFF6FF",
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 2,
    borderColor: "#BFDBFE",
    marginBottom: 6,
  },
  modalChangePhotoText: {
    fontSize: 12,
    fontWeight: "600",
    color: COLORS.primary,
  },
  modalForm: {
    gap: SPACING.md,
  },
  modalButtonContainer: {
    marginTop: SPACING.md,
  },

  /* Offers Modal Styles */
  offerCard: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#FAF5FF",
    borderRadius: RADIUS.md,
    borderWidth: 1,
    borderColor: "#E9D5FF",
    borderStyle: "dashed",
    padding: SPACING.md,
    marginBottom: SPACING.sm,
  },
  offerIconBox: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: "#F3E8FF",
    alignItems: "center",
    justifyContent: "center",
    marginRight: SPACING.md,
  },
  offerInfo: {
    flex: 1,
  },
  offerCode: {
    fontSize: 15,
    fontWeight: "800",
    color: "#7E22CE",
    letterSpacing: 0.5,
  },
  offerDesc: {
    fontSize: 12,
    color: COLORS.textSecondary,
    marginTop: 2,
  },
  emptyOffersText: {
    textAlign: "center",
    color: COLORS.textSecondary,
    paddingVertical: SPACING.xl,
    fontSize: 14,
  },

  /* ========================================================
   * 5. Logout Button
   * ======================================================== */
  logoutBtnContainer: {
    marginTop: SPACING.sm,
    marginBottom: SPACING.xl,
  },
});
