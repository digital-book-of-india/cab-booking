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
  form: {
    marginVertical: SPACING.xl,
  },
  footer: {
    marginBottom: SPACING.xl,
  },
});
