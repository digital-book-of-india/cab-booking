import { StyleSheet } from 'react-native';
import { COLORS, RADIUS, SPACING } from '../../constants/colors';

export const styles = StyleSheet.create({
  card: {
    backgroundColor: COLORS.surface,
    borderRadius: RADIUS.lg,
    padding: SPACING.md,
    marginBottom: SPACING.md,
    borderWidth: 1,
    borderColor: COLORS.border,
    shadowColor: COLORS.black,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 2,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: SPACING.sm,
    paddingBottom: SPACING.xs,
    borderBottomWidth: 1,
    borderBottomColor: '#F1F5F9',
  },
  date: {
    fontSize: 13,
    color: COLORS.textSecondary,
    fontWeight: '500',
  },
  routeContainer: {
    marginVertical: SPACING.xs,
  },
  pointRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginVertical: 3,
  },
  dotPickup: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: COLORS.success,
    marginRight: SPACING.sm,
  },
  dotDropoff: {
    width: 10,
    height: 10,
    borderRadius: 2,
    backgroundColor: COLORS.primary,
    marginRight: SPACING.sm,
  },
  routeLine: {
    width: 2,
    height: 12,
    backgroundColor: COLORS.border,
    marginLeft: 4,
  },
  addressText: {
    flex: 1,
    fontSize: 14,
    color: COLORS.text,
    fontWeight: '500',
  },
  footer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: SPACING.sm,
    paddingTop: SPACING.xs,
    borderTopWidth: 1,
    borderTopColor: '#F1F5F9',
  },
  driverInfo: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  driverName: {
    fontSize: 13,
    color: COLORS.textSecondary,
    marginLeft: 4,
  },
  fareText: {
    fontSize: 16,
    fontWeight: '700',
    color: COLORS.text,
  },
});
