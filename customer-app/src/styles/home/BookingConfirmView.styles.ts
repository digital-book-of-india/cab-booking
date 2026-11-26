import { StyleSheet } from 'react-native';
import { COLORS, RADIUS, SPACING } from '../../constants/colors';

export const styles = StyleSheet.create({
  confirmingBox: {
    paddingVertical: 48,
    alignItems: 'center',
    gap: 12,
  },
  confirmingTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: COLORS.text,
  },
  confirmingSub: {
    fontSize: 13,
    color: COLORS.textSecondary,
  },
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
