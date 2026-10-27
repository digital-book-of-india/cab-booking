import { StyleSheet } from 'react-native';
import { COLORS, RADIUS, SPACING } from '../../constants/colors';

export const styles = StyleSheet.create({
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.55)',
    justifyContent: 'flex-end',
  },
  modalContent: {
    backgroundColor: COLORS.surface,
    borderTopLeftRadius: RADIUS.xl,
    borderTopRightRadius: RADIUS.xl,
    maxHeight: '90%',
    paddingBottom: SPACING.xl,
  },
  dragHandleBar: {
    alignItems: 'center',
    paddingVertical: 10,
  },
  dragHandle: {
    width: 44,
    height: 5,
    borderRadius: 3,
    backgroundColor: '#CBD5E1',
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: SPACING.lg,
    paddingBottom: SPACING.sm,
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: '800',
    color: COLORS.text,
  },
  closeBtn: {
    width: 36,
    height: 36,
    borderRadius: RADIUS.full,
    backgroundColor: '#F1F5F9',
    alignItems: 'center',
    justifyContent: 'center',
  },

  /* Route Locations Box */
  routeBox: {
    marginHorizontal: SPACING.lg,
    backgroundColor: '#F8FAFC',
    borderRadius: RADIUS.lg,
    padding: SPACING.md,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    marginTop: SPACING.xs,
  },
  locationInputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm,
  },
  pickupDot: {
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: COLORS.success,
  },
  dropoffSquare: {
    width: 12,
    height: 12,
    borderRadius: 2,
    backgroundColor: COLORS.error,
  },
  routeDivider: {
    height: 16,
    width: 2,
    backgroundColor: '#CBD5E1',
    marginLeft: 5,
    marginVertical: 4,
  },
  locationTextInput: {
    flex: 1,
    fontSize: 14,
    color: COLORS.text,
    fontWeight: '600',
    paddingVertical: 4,
  },

  /* Suggestions Horizontal Chips */
  suggestionsContainer: {
    paddingHorizontal: SPACING.lg,
    paddingVertical: SPACING.sm + 2,
    gap: SPACING.xs + 2,
  },
  suggestionChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#F1F5F9',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: RADIUS.full,
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  suggestionChipText: {
    fontSize: 12,
    fontWeight: '700',
    color: COLORS.text,
  },

  /* Vehicle Selection List */
  vehiclesSectionTitle: {
    fontSize: 15,
    fontWeight: '800',
    color: COLORS.text,
    paddingHorizontal: SPACING.lg,
    marginTop: SPACING.sm,
    marginBottom: SPACING.xs,
  },
  vehicleCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 12,
    paddingHorizontal: SPACING.lg,
    borderBottomWidth: 1,
    borderBottomColor: '#F1F5F9',
  },
  vehicleCardSelected: {
    backgroundColor: '#EFF6FF',
    borderLeftWidth: 4,
    borderLeftColor: COLORS.primary,
  },
  vehicleLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.md,
    flex: 1,
  },
  vehicleIconBox: {
    width: 48,
    height: 48,
    borderRadius: RADIUS.md,
    backgroundColor: '#F8FAFC',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  vehicleNameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  vehicleName: {
    fontSize: 15,
    fontWeight: '800',
    color: COLORS.text,
  },
  tagBadge: {
    backgroundColor: '#DCFCE7',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  tagBadgeText: {
    fontSize: 10,
    fontWeight: '800',
    color: '#15803D',
  },
  vehicleMeta: {
    fontSize: 12,
    color: COLORS.textSecondary,
    marginTop: 2,
  },
  vehicleRight: {
    alignItems: 'flex-end',
  },
  vehiclePrice: {
    fontSize: 16,
    fontWeight: '800',
    color: COLORS.text,
  },
  vehicleOriginalPrice: {
    fontSize: 12,
    color: COLORS.textSecondary,
    textDecorationLine: 'line-through',
    marginTop: 2,
  },

  /* Payment & Coupon Row */
  paymentRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: SPACING.lg,
    paddingTop: SPACING.md,
    paddingBottom: SPACING.sm,
  },
  paymentPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#F8FAFC',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: RADIUS.full,
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  paymentText: {
    fontSize: 12,
    fontWeight: '700',
    color: COLORS.text,
  },
  couponPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#FEF3C7',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: RADIUS.full,
  },
  couponText: {
    fontSize: 11,
    fontWeight: '800',
    color: '#B45309',
  },

  /* Booking CTA Button */
  ctaContainer: {
    paddingHorizontal: SPACING.lg,
    paddingTop: SPACING.xs,
  },

  /* Booking Confirmation State */
  confirmContainer: {
    padding: SPACING.xl,
    alignItems: 'center',
  },
  confirmIconBox: {
    width: 72,
    height: 72,
    borderRadius: RADIUS.full,
    backgroundColor: '#DCFCE7',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: SPACING.md,
  },
  confirmTitle: {
    fontSize: 22,
    fontWeight: '800',
    color: COLORS.text,
    textAlign: 'center',
  },
  confirmSub: {
    fontSize: 14,
    color: COLORS.textSecondary,
    textAlign: 'center',
    marginTop: 4,
    marginBottom: SPACING.lg,
  },
  driverInfoCard: {
    width: '100%',
    backgroundColor: '#F8FAFC',
    borderRadius: RADIUS.lg,
    padding: SPACING.md,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: SPACING.lg,
  },
  driverLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm,
  },
  driverAvatar: {
    width: 44,
    height: 44,
    borderRadius: RADIUS.full,
    backgroundColor: '#DBEAFE',
    alignItems: 'center',
    justifyContent: 'center',
  },
  driverName: {
    fontSize: 15,
    fontWeight: '700',
    color: COLORS.text,
  },
  driverCar: {
    fontSize: 12,
    color: COLORS.textSecondary,
    marginTop: 2,
  },
  otpBadge: {
    backgroundColor: '#1E293B',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: RADIUS.md,
    alignItems: 'center',
  },
  otpLabel: {
    fontSize: 9,
    color: '#94A3B8',
    fontWeight: '700',
  },
  otpCode: {
    fontSize: 14,
    color: COLORS.white,
    fontWeight: '900',
    letterSpacing: 1,
  },
});
