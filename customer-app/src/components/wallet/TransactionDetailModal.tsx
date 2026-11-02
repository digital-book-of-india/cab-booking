import React from 'react';
import {
  Modal,
  StyleSheet,
  Text,
  TouchableOpacity,
  TouchableWithoutFeedback,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { COLORS, RADIUS, SPACING } from '../../constants/colors';
import { APP_CONFIG } from '../../constants/config';
import type { WalletEntry } from '../../types/payment.types';

export type TransactionDetailModalProps = {
  visible: boolean;
  entry: WalletEntry | null;
  onClose: () => void;
};

export const TransactionDetailModal: React.FC<TransactionDetailModalProps> = ({
  visible,
  entry,
  onClose,
}) => {
  const router = useRouter();

  if (!entry) return null;

  const isCredit = entry.amountPaise > 0 || entry.type === 'CREDIT';
  const absAmount = (Math.abs(entry.amountPaise) / 100).toFixed(2);
  const dateVal = entry.at || entry.createdAt || new Date();
  const formattedDate = new Date(dateVal).toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });

  const handleNeedHelp = () => {
    onClose();
    router.push({
      pathname: '/(app)/support',
      params: {
        bookingId: entry.bookingId ?? undefined,
        referenceId: entry.referenceId ?? entry.id ?? undefined,
      },
    });
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
    >
      <TouchableWithoutFeedback onPress={onClose}>
        <View style={styles.overlay}>
          <TouchableWithoutFeedback>
            <View style={styles.content}>
              {/* Header */}
              <View style={styles.header}>
                <Text style={styles.title}>Transaction Details</Text>
                <TouchableOpacity onPress={onClose} style={styles.closeBtn}>
                  <Ionicons name="close" size={20} color={COLORS.textSecondary} />
                </TouchableOpacity>
              </View>

              {/* Amount hero */}
              <View style={styles.amountHero}>
                <Text
                  style={[
                    styles.amountText,
                    { color: isCredit ? '#10B981' : '#EF4444' },
                  ]}
                >
                  {isCredit ? '+' : '-'} {APP_CONFIG.currencySymbol}
                  {absAmount}
                </Text>
                <View
                  style={[
                    styles.statusPill,
                    { backgroundColor: isCredit ? '#DCFCE7' : '#FEE2E2' },
                  ]}
                >
                  <Text
                    style={[
                      styles.statusPillText,
                      { color: isCredit ? '#059669' : '#DC2626' },
                    ]}
                  >
                    {isCredit ? 'CREDITED' : 'DEBITED'}
                  </Text>
                </View>
                <Text style={styles.descText}>
                  {entry.description || (isCredit ? 'Wallet Top-up' : 'Ride Payment')}
                </Text>
              </View>

              {/* Detail fields */}
              <View style={styles.detailsBox}>
                <View style={styles.detailRow}>
                  <Text style={styles.detailLabel}>Date & Time</Text>
                  <Text style={styles.detailValue}>{formattedDate}</Text>
                </View>

                {entry.bookingId && (
                  <View style={styles.detailRow}>
                    <Text style={styles.detailLabel}>Booking ID</Text>
                    <Text style={[styles.detailValue, { color: COLORS.primary }]}>
                      {entry.bookingId}
                    </Text>
                  </View>
                )}

                {(entry.referenceId || entry.id) && (
                  <View style={styles.detailRow}>
                    <Text style={styles.detailLabel}>Reference ID</Text>
                    <Text style={styles.detailValueMono}>
                      {entry.referenceId || entry.id}
                    </Text>
                  </View>
                )}

                <View style={styles.detailRow}>
                  <Text style={styles.detailLabel}>Category</Text>
                  <Text style={styles.detailValue}>
                    {entry.kind?.replace('_', ' ') || (isCredit ? 'Top-up' : 'Ride')}
                  </Text>
                </View>
              </View>

              {/* Help & Support CTA */}
              <TouchableOpacity
                style={styles.helpButton}
                onPress={handleNeedHelp}
                activeOpacity={0.8}
              >
                <Ionicons name="help-buoy-outline" size={18} color={COLORS.primary} />
                <Text style={styles.helpButtonText}>Need help with this transaction?</Text>
              </TouchableOpacity>
            </View>
          </TouchableWithoutFeedback>
        </View>
      </TouchableWithoutFeedback>
    </Modal>
  );
};

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
    justifyContent: 'flex-end',
  },
  content: {
    backgroundColor: COLORS.white,
    borderTopLeftRadius: RADIUS.xl,
    borderTopRightRadius: RADIUS.xl,
    padding: SPACING.lg,
    paddingBottom: SPACING.xl + 10,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: SPACING.sm,
  },
  title: {
    fontSize: 17,
    fontWeight: '800',
    color: COLORS.text,
  },
  closeBtn: {
    width: 32,
    height: 32,
    borderRadius: RADIUS.full,
    backgroundColor: COLORS.background,
    justifyContent: 'center',
    alignItems: 'center',
  },
  amountHero: {
    alignItems: 'center',
    paddingVertical: SPACING.md,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  amountText: {
    fontSize: 32,
    fontWeight: '900',
    marginBottom: 6,
  },
  statusPill: {
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderRadius: RADIUS.full,
    marginBottom: 6,
  },
  statusPillText: {
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  descText: {
    fontSize: 13,
    color: COLORS.textSecondary,
    fontWeight: '500',
  },
  detailsBox: {
    marginVertical: SPACING.md,
    backgroundColor: COLORS.background,
    borderRadius: RADIUS.md,
    padding: SPACING.md,
    gap: 12,
  },
  detailRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  detailLabel: {
    fontSize: 12,
    color: COLORS.textSecondary,
    fontWeight: '500',
  },
  detailValue: {
    fontSize: 13,
    fontWeight: '700',
    color: COLORS.text,
  },
  detailValueMono: {
    fontSize: 12,
    fontWeight: '600',
    color: COLORS.text,
    fontFamily: 'monospace',
  },
  helpButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
    borderRadius: RADIUS.md,
    backgroundColor: '#F0FDF4',
    borderWidth: 1,
    borderColor: '#DCFCE7',
    gap: 8,
    marginTop: SPACING.xs,
  },
  helpButtonText: {
    fontSize: 13,
    fontWeight: '700',
    color: COLORS.primary,
  },
});
