import { StyleSheet } from 'react-native';
import { COLORS, RADIUS, SPACING } from '../constants/colors';

export const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  headerBanner: {
    backgroundColor: COLORS.surface,
    padding: SPACING.md,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  subjectRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
  },
  subjectText: {
    fontSize: 16,
    fontWeight: '700',
    color: COLORS.text,
    flex: 1,
    marginRight: SPACING.sm,
  },
  categoryText: {
    fontSize: 12,
    color: COLORS.textSecondary,
    textTransform: 'capitalize',
  },
  messagesList: {
    padding: SPACING.md,
  },
  msgContainer: {
    marginBottom: SPACING.md,
    maxWidth: '82%',
  },
  msgCustomer: {
    alignSelf: 'flex-end',
  },
  msgSupport: {
    alignSelf: 'flex-start',
  },
  msgBubble: {
    borderRadius: RADIUS.lg,
    padding: SPACING.md,
  },
  bubbleCustomer: {
    backgroundColor: COLORS.primary,
    borderBottomRightRadius: 2,
  },
  bubbleSupport: {
    backgroundColor: COLORS.surface,
    borderBottomLeftRadius: 2,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  msgText: {
    fontSize: 14,
    lineHeight: 20,
  },
  textCustomer: {
    color: COLORS.white,
  },
  textSupport: {
    color: COLORS.text,
  },
  msgTime: {
    fontSize: 11,
    marginTop: 4,
    alignSelf: 'flex-end',
  },
  timeCustomer: {
    color: 'rgba(255, 255, 255, 0.7)',
  },
  timeSupport: {
    color: COLORS.textSecondary,
  },
  inputBar: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: SPACING.sm,
    backgroundColor: COLORS.surface,
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
    gap: SPACING.sm,
  },
  input: {
    flex: 1,
    backgroundColor: '#F8FAFC',
    borderRadius: RADIUS.full,
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.xs + 4,
    fontSize: 15,
    maxHeight: 100,
    color: COLORS.text,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  sendBtn: {
    width: 44,
    height: 44,
    borderRadius: RADIUS.full,
    backgroundColor: COLORS.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  closedBanner: {
    backgroundColor: '#F1F5F9',
    padding: SPACING.md,
    alignItems: 'center',
  },
  closedText: {
    fontSize: 13,
    color: COLORS.textSecondary,
    fontWeight: '500',
  },
});
