import { StyleSheet } from 'react-native';
import { COLORS, RADIUS, SPACING } from '../constants/colors';

export const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  scrollContent: {
    padding: SPACING.lg,
  },
  card: {
    backgroundColor: COLORS.surface,
    borderRadius: RADIUS.lg,
    padding: SPACING.lg,
    borderWidth: 1,
    borderColor: COLORS.border,
    marginBottom: SPACING.md,
  },
  cardTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: COLORS.text,
    marginBottom: SPACING.md,
  },
  routeRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginVertical: SPACING.xs,
  },
  dotPickup: {
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: COLORS.success,
    marginTop: 4,
    marginRight: SPACING.sm,
  },
  dotDropoff: {
    width: 12,
    height: 12,
    borderRadius: 3,
    backgroundColor: COLORS.primary,
    marginTop: 4,
    marginRight: SPACING.sm,
  },
  routeLine: {
    width: 2,
    height: 24,
    backgroundColor: COLORS.border,
    marginLeft: 5,
  },
  routeAddress: {
    flex: 1,
    fontSize: 14,
    fontWeight: '500',
    color: COLORS.text,
    lineHeight: 20,
  },
  routeLabel: {
    fontSize: 11,
    color: COLORS.textSecondary,
    marginBottom: 2,
    textTransform: 'uppercase',
    fontWeight: '600',
  },
  driverRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.md,
  },
  driverAvatar: {
    width: 50,
    height: 50,
    borderRadius: 25,
    backgroundColor: '#DBEAFE',
    alignItems: 'center',
    justifyContent: 'center',
  },
  driverName: {
    fontSize: 16,
    fontWeight: '700',
    color: COLORS.text,
  },
  driverVehicle: {
    fontSize: 13,
    color: COLORS.textSecondary,
    marginTop: 2,
  },
  otpBanner: {
    backgroundColor: '#FEF3C7',
    padding: SPACING.md,
    borderRadius: RADIUS.md,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: SPACING.md,
  },
  otpText: {
    fontSize: 14,
    color: '#92400E',
    fontWeight: '600',
  },
  otpCode: {
    fontSize: 20,
    fontWeight: '800',
    letterSpacing: 2,
    color: '#92400E',
  },
  breakdownRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: SPACING.xs + 2,
  },
  breakdownLabel: {
    fontSize: 14,
    color: COLORS.textSecondary,
  },
  breakdownValue: {
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.text,
  },
  totalRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingTop: SPACING.md,
    marginTop: SPACING.sm,
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
  },
  totalLabel: {
    fontSize: 16,
    fontWeight: '700',
    color: COLORS.text,
  },
  totalValue: {
    fontSize: 20,
    fontWeight: '800',
    color: COLORS.primary,
  },
  actionsRow: {
    gap: SPACING.sm,
    marginVertical: SPACING.md,
  },
});
