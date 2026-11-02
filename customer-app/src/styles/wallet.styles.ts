import { StyleSheet } from 'react-native';
import { COLORS, RADIUS, SPACING } from '../constants/colors';

export const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  scrollContent: {
    padding: SPACING.md,
    paddingBottom: SPACING.xxl,
  },
  tabBar: {
    flexDirection: 'row',
    backgroundColor: 'rgba(0, 0, 0, 0.04)',
    padding: 4,
    borderRadius: RADIUS.lg,
    marginVertical: SPACING.md,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  tabButton: {
    flex: 1,
    paddingVertical: 9,
    borderRadius: RADIUS.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tabButtonActive: {
    backgroundColor: COLORS.white,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 4,
    elevation: 2,
  },
  tabButtonText: {
    fontSize: 11,
    fontWeight: '700',
    color: COLORS.textSecondary,
  },
  tabButtonTextActive: {
    color: '#10B981',
    fontWeight: '800',
  },
  tabContent: {
    marginTop: 2,
  },
});
