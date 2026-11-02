import { Platform, StyleSheet } from 'react-native';
import { COLORS, RADIUS, SPACING } from '../constants/colors';

export const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F8FAFC',
  },
  scrollContent: {
    paddingBottom: Platform.OS === 'ios' ? 44 : 32,
  },

  /* ========================================================
   * 1. Header & Title Section
   * ======================================================== */
  headerSection: {
    paddingHorizontal: SPACING.lg,
    paddingTop: SPACING.sm,
    paddingBottom: SPACING.md,
  },
  pageTitle: {
    fontSize: 24,
    fontWeight: '800',
    color: COLORS.text,
    letterSpacing: -0.5,
  },
  pageSubtitle: {
    fontSize: 14,
    color: COLORS.textSecondary,
    marginTop: 4,
    lineHeight: 20,
  },

  /* ========================================================
   * 2. Live Active Ride Banner (When Ride is Underway)
   * ======================================================== */
  activeRideBanner: {
    backgroundColor: '#EFF6FF',
    marginHorizontal: SPACING.md,
    marginBottom: SPACING.md,
    borderRadius: RADIUS.lg,
    padding: SPACING.md,
    borderWidth: 1.5,
    borderColor: '#BFDBFE',
    shadowColor: '#2563EB',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 6,
    elevation: 2,
  },
  activeRideHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  activeRideBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#DCFCE7',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: RADIUS.full,
    gap: 4,
  },
  activeRideDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#16A34A',
  },
  activeRideBadgeText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#15803D',
  },
  activeRideTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: COLORS.text,
  },
  activeRideSubtitle: {
    fontSize: 13,
    color: COLORS.textSecondary,
    marginTop: 2,
    marginBottom: 10,
  },
  activeRideActionsRow: {
    flexDirection: 'row',
    gap: 8,
  },
  shareLiveBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.primary,
    borderRadius: RADIUS.md,
    paddingVertical: 9,
    gap: 6,
  },
  shareLiveBtnText: {
    color: COLORS.white,
    fontSize: 13,
    fontWeight: '700',
  },
  sosQuickBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#DC2626',
    borderRadius: RADIUS.md,
    paddingVertical: 9,
    paddingHorizontal: 16,
    gap: 4,
  },
  sosQuickBtnText: {
    color: COLORS.white,
    fontSize: 13,
    fontWeight: '700',
  },

  /* ========================================================
   * 3. Feature List Card (Uber Style Clean Rows)
   * ======================================================== */
  cardContainer: {
    backgroundColor: COLORS.surface,
    marginHorizontal: SPACING.md,
    borderRadius: RADIUS.lg,
    borderWidth: 1,
    borderColor: COLORS.border,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 6,
    elevation: 2,
  },
  featureRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 18,
    paddingHorizontal: SPACING.lg,
    backgroundColor: COLORS.surface,
  },
  featureRowDivider: {
    borderBottomWidth: 1,
    borderBottomColor: '#F1F5F9',
  },
  iconBox: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 14,
  },
  iconBoxContacts: {
    backgroundColor: '#EFF6FF',
  },
  iconBoxShare: {
    backgroundColor: '#F0FDF4',
  },
  iconBoxSos: {
    backgroundColor: '#FEF2F2',
  },
  iconBoxAudio: {
    backgroundColor: '#FAF5FF',
  },
  featureTextCol: {
    flex: 1,
    paddingRight: 12,
  },
  featureTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  featureTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: COLORS.text,
  },
  featureSubtitle: {
    fontSize: 13,
    color: COLORS.textSecondary,
    lineHeight: 18,
    marginTop: 3,
  },
  featureStatusPill: {
    marginTop: 5,
    alignSelf: 'flex-start',
    backgroundColor: '#F1F5F9',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 6,
  },
  featureStatusText: {
    fontSize: 11,
    fontWeight: '600',
    color: COLORS.textSecondary,
  },
  activeIndicatorDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#2563EB',
    marginRight: 8,
  },

  /* ========================================================
   * 4. Bottom Sheet Modal Overlay & Content
   * ======================================================== */
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.45)',
    justifyContent: 'flex-end',
  },
  sheetContainer: {
    backgroundColor: COLORS.surface,
    borderTopLeftRadius: RADIUS.xl,
    borderTopRightRadius: RADIUS.xl,
    maxHeight: '85%',
    minHeight: '40%',
    paddingBottom: Platform.OS === 'ios' ? 34 : 20,
  },
  sheetHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: SPACING.lg,
    paddingTop: SPACING.lg,
    paddingBottom: SPACING.md,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  sheetHeaderTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: COLORS.text,
  },
  sheetSubHeader: {
    paddingHorizontal: SPACING.lg,
    paddingVertical: SPACING.sm,
    fontSize: 13,
    color: COLORS.textSecondary,
    lineHeight: 19,
  },

  /* ========================================================
   * 5. Emergency SOS Modal Elements
   * ======================================================== */
  sosSheetContent: {
    paddingHorizontal: SPACING.lg,
    paddingTop: SPACING.sm,
    paddingBottom: SPACING.lg,
  },
  sosHeroBox: {
    alignItems: 'center',
    paddingVertical: SPACING.md,
  },
  sosIconCircle: {
    width: 68,
    height: 68,
    borderRadius: 34,
    backgroundColor: '#FEE2E2',
    borderWidth: 2,
    borderColor: '#FECACA',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
  },
  sosHeroTitle: {
    fontSize: 20,
    fontWeight: '800',
    color: '#DC2626',
    textAlign: 'center',
  },
  sosHeroText: {
    fontSize: 13,
    color: COLORS.textSecondary,
    textAlign: 'center',
    lineHeight: 19,
    marginTop: 6,
    paddingHorizontal: SPACING.sm,
  },
  sosStatusActiveBanner: {
    backgroundColor: '#FEF2F2',
    borderRadius: RADIUS.md,
    padding: SPACING.md,
    borderWidth: 1.5,
    borderColor: '#F87171',
    marginVertical: SPACING.sm,
    alignItems: 'center',
  },
  sosStatusActiveTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: '#B91C1C',
  },
  sosStatusActiveSub: {
    fontSize: 12,
    color: '#991B1B',
    marginTop: 2,
    textAlign: 'center',
  },
  sosActionList: {
    gap: 10,
    marginTop: SPACING.sm,
  },
  sosPrimaryTriggerBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#DC2626',
    borderRadius: RADIUS.md,
    paddingVertical: 14,
    gap: 8,
    shadowColor: '#DC2626',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.25,
    shadowRadius: 6,
    elevation: 3,
  },
  sosPrimaryTriggerBtnText: {
    color: COLORS.white,
    fontSize: 16,
    fontWeight: '700',
    letterSpacing: 0.3,
  },
  sosDialerBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#F8FAFC',
    borderRadius: RADIUS.md,
    paddingVertical: 13,
    borderWidth: 1.5,
    borderColor: '#CBD5E1',
    gap: 8,
  },
  sosDialerBtnText: {
    color: COLORS.text,
    fontSize: 14,
    fontWeight: '700',
  },
  sosSupportBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#EFF6FF',
    borderRadius: RADIUS.md,
    paddingVertical: 13,
    borderWidth: 1.5,
    borderColor: '#BFDBFE',
    gap: 8,
  },
  sosSupportBtnText: {
    color: COLORS.primary,
    fontSize: 14,
    fontWeight: '700',
  },

  /* ========================================================
   * 6. Audio Recording Sheet Elements
   * ======================================================== */
  audioSheetContent: {
    paddingHorizontal: SPACING.lg,
    paddingTop: SPACING.md,
    paddingBottom: SPACING.lg,
  },
  audioHeroBox: {
    alignItems: 'center',
    paddingVertical: SPACING.md,
  },
  audioIconCircle: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: '#FAF5FF',
    borderWidth: 1.5,
    borderColor: '#E9D5FF',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
  },
  audioHeroTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: COLORS.text,
    textAlign: 'center',
  },
  audioHeroText: {
    fontSize: 13,
    color: COLORS.textSecondary,
    textAlign: 'center',
    lineHeight: 19,
    marginTop: 6,
    paddingHorizontal: SPACING.sm,
  },
  privacyHighlightBox: {
    backgroundColor: '#F8FAFC',
    borderRadius: RADIUS.md,
    padding: SPACING.md,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    marginVertical: SPACING.md,
    gap: 10,
  },
  privacyPointRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
  },
  privacyPointText: {
    flex: 1,
    fontSize: 12,
    color: COLORS.textSecondary,
    lineHeight: 17,
  },
  audioToggleCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#F1F5F9',
    borderRadius: RADIUS.md,
    padding: SPACING.md,
    marginTop: SPACING.sm,
  },
  audioToggleTextCol: {
    flex: 1,
    paddingRight: SPACING.md,
  },
  audioToggleTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: COLORS.text,
  },
  audioToggleSub: {
    fontSize: 12,
    color: COLORS.textSecondary,
    marginTop: 2,
  },
});
