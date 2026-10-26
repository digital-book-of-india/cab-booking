import { StyleSheet } from 'react-native';
import { COLORS, SPACING } from '../constants/colors';

export const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.surface,
    paddingHorizontal: SPACING.lg,
    justifyContent: 'space-between',
  },
  header: {
    marginTop: SPACING.xl,
  },
  title: {
    fontSize: 26,
    fontWeight: '800',
    color: COLORS.text,
    marginBottom: SPACING.xs,
  },
  subtitle: {
    fontSize: 15,
    color: COLORS.textSecondary,
    lineHeight: 22,
  },
  phoneHighlight: {
    fontWeight: '700',
    color: COLORS.text,
  },
  otpSection: {
    marginVertical: SPACING.xl,
  },
  resendRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: SPACING.lg,
  },
  resendText: {
    fontSize: 14,
    color: COLORS.textSecondary,
  },
  resendAction: {
    fontSize: 14,
    fontWeight: '700',
    color: COLORS.primary,
    marginLeft: 4,
  },
  resendDisabled: {
    color: COLORS.disabled,
  },
  errorText: {
    color: COLORS.error,
    fontSize: 13,
    textAlign: 'center',
    marginTop: SPACING.sm,
  },
  testOtpBanner: {
    backgroundColor: '#EFF6FF',
    borderWidth: 1,
    borderColor: '#BFDBFE',
    borderRadius: 8,
    padding: SPACING.sm,
    alignItems: 'center',
    marginTop: SPACING.md,
  },
  testOtpText: {
    fontSize: 13,
    color: COLORS.primary,
    fontWeight: '600',
  },
  footer: {
    marginBottom: SPACING.xl,
  },
});
