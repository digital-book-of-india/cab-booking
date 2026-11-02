import React from 'react';
import {
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { COLORS, RADIUS, SPACING } from '../../constants/colors';
import { APP_CONFIG } from '../../constants/config';
import type { FailedPaymentRecord, RefundRecord } from '../../types/payment.types';

export type RefundsTrackerSectionProps = {
  refunds: RefundRecord[];
  failedPayments: FailedPaymentRecord[];
};

export const RefundsTrackerSection: React.FC<RefundsTrackerSectionProps> = ({
  refunds,
  failedPayments,
}) => {
  const router = useRouter();

  const handleSupportTicket = (refId?: string) => {
    router.push({
      pathname: '/(app)/support',
      params: {
        referenceId: refId ?? undefined,
      },
    });
  };

  return (
    <View style={styles.container}>
      {/* Refunds Section */}
      <View style={styles.headerRow}>
        <Text style={styles.sectionTitle}>Refund Status Tracker</Text>
        <Text style={styles.countBadge}>{refunds.length} Active</Text>
      </View>

      {refunds.length === 0 ? (
        <View style={styles.emptyCard}>
          <Ionicons name="shield-checkmark-outline" size={28} color="#10B981" />
          <Text style={styles.emptyTitle}>No pending refunds</Text>
          <Text style={styles.emptySub}>
            All past refunds have been processed and credited to your account.
          </Text>
        </View>
      ) : (
        <View style={styles.cardList}>
          {refunds.map((r) => {
            const isCompleted = r.status === 'PROCESSED';
            const isFailed = r.status === 'FAILED';

            const formattedDate = new Date(r.createdAt).toLocaleDateString('en-IN', {
              day: 'numeric',
              month: 'short',
            });

            return (
              <View key={r.id} style={styles.refundCard}>
                <View style={styles.cardTop}>
                  <View>
                    <Text style={styles.amountText}>
                      {APP_CONFIG.currencySymbol}
                      {(r.amountPaise / 100).toFixed(2)}
                    </Text>
                    <Text style={styles.reasonText}>{r.reason}</Text>
                  </View>

                  <View
                    style={[
                      styles.statusPill,
                      {
                        backgroundColor: isCompleted
                          ? '#DCFCE7'
                          : isFailed
                            ? '#FEE2E2'
                            : '#FEF3C7',
                      },
                    ]}
                  >
                    <Text
                      style={[
                        styles.statusPillText,
                        {
                          color: isCompleted
                            ? '#059669'
                            : isFailed
                              ? '#DC2626'
                              : '#D97706',
                        },
                      ]}
                    >
                      {r.status}
                    </Text>
                  </View>
                </View>

                {/* Progress / Timeline info */}
                <View style={styles.infoBox}>
                  <Ionicons
                    name={
                      isCompleted
                        ? 'checkmark-circle'
                        : isFailed
                          ? 'close-circle'
                          : 'time-outline'
                    }
                    size={16}
                    color={
                      isCompleted
                        ? '#10B981'
                        : isFailed
                          ? '#EF4444'
                          : '#F59E0B'
                    }
                  />
                  <Text style={styles.infoText}>
                    {isCompleted
                      ? `Credited to ${r.destination === 'WALLET' ? 'Wallet Balance' : 'Original UPI Account'}`
                      : isFailed
                        ? 'Refund failed. Please contact customer support.'
                        : `Expected completion in 2–3 business days (${formattedDate})`}
                  </Text>
                </View>

                <View style={styles.footerRow}>
                  <Text style={styles.idText}>Ref: {r.publicId}</Text>
                  <TouchableOpacity
                    onPress={() => handleSupportTicket(r.publicId)}
                    style={styles.helpLink}
                  >
                    <Text style={styles.helpLinkText}>Help</Text>
                  </TouchableOpacity>
                </View>
              </View>
            );
          })}
        </View>
      )}

      {/* Failed Payments Section */}
      <View style={[styles.headerRow, { marginTop: SPACING.xl }]}>
        <Text style={styles.sectionTitle}>Failed Transactions</Text>
      </View>

      {failedPayments.length === 0 ? (
        <View style={styles.emptyCard}>
          <Text style={styles.emptySub}>No failed payments recorded recently.</Text>
        </View>
      ) : (
        <View style={styles.cardList}>
          {failedPayments.map((f) => (
            <View key={f.id} style={styles.failedCard}>
              <View style={styles.failedHeader}>
                <Ionicons name="alert-circle" size={20} color="#EF4444" />
                <View style={{ flex: 1 }}>
                  <Text style={styles.failedTitle}>
                    Top-up of {APP_CONFIG.currencySymbol}
                    {(f.amountPaise / 100).toFixed(2)} Failed
                  </Text>
                  <Text style={styles.failedReason}>{f.failureReason}</Text>
                </View>
              </View>

              <View style={styles.failedNoticeBox}>
                <Text style={styles.failedNoticeText}>
                  If money was debited from your bank, it will be automatically refunded by your bank within 48–72 hours.
                </Text>
              </View>

              <TouchableOpacity
                style={styles.supportBtn}
                onPress={() => handleSupportTicket(f.publicId)}
                activeOpacity={0.8}
              >
                <Ionicons name="headset-outline" size={16} color="#FFFFFF" />
                <Text style={styles.supportBtnText}>Raise Support Request</Text>
              </TouchableOpacity>
            </View>
          ))}
        </View>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    paddingBottom: SPACING.lg,
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: SPACING.sm,
  },
  sectionTitle: {
    fontSize: 13,
    fontWeight: '800',
    color: COLORS.text,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  countBadge: {
    fontSize: 11,
    color: COLORS.textSecondary,
    fontWeight: '600',
  },
  cardList: {
    gap: 12,
  },
  refundCard: {
    backgroundColor: COLORS.white,
    padding: SPACING.md,
    borderRadius: RADIUS.lg,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  cardTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 8,
  },
  amountText: {
    fontSize: 18,
    fontWeight: '900',
    color: COLORS.text,
  },
  reasonText: {
    fontSize: 12,
    color: COLORS.textSecondary,
    marginTop: 2,
  },
  statusPill: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: RADIUS.full,
  },
  statusPillText: {
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  infoBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: COLORS.background,
    padding: 8,
    borderRadius: RADIUS.sm,
    marginVertical: 6,
  },
  infoText: {
    fontSize: 11,
    color: COLORS.text,
    flex: 1,
  },
  footerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 4,
  },
  idText: {
    fontSize: 10,
    color: COLORS.textSecondary,
    fontFamily: 'monospace',
  },
  helpLink: {
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  helpLinkText: {
    fontSize: 11,
    fontWeight: '700',
    color: COLORS.primary,
  },
  failedCard: {
    backgroundColor: '#FEF2F2',
    borderWidth: 1,
    borderColor: '#FECACA',
    borderRadius: RADIUS.lg,
    padding: SPACING.md,
    gap: 10,
  },
  failedHeader: {
    flexDirection: 'row',
    gap: 10,
    alignItems: 'flex-start',
  },
  failedTitle: {
    fontSize: 13,
    fontWeight: '800',
    color: '#991B1B',
  },
  failedReason: {
    fontSize: 11,
    color: '#B91C1C',
    marginTop: 2,
  },
  failedNoticeBox: {
    backgroundColor: '#FFFFFF',
    padding: 8,
    borderRadius: RADIUS.sm,
  },
  failedNoticeText: {
    fontSize: 10,
    color: '#7F1D1D',
    lineHeight: 14,
  },
  supportBtn: {
    backgroundColor: '#DC2626',
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 10,
    borderRadius: RADIUS.md,
  },
  supportBtnText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '700',
  },
  emptyCard: {
    backgroundColor: COLORS.white,
    padding: SPACING.lg,
    borderRadius: RADIUS.lg,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: COLORS.border,
    gap: 4,
  },
  emptyTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: COLORS.text,
    marginTop: 4,
  },
  emptySub: {
    fontSize: 11,
    color: COLORS.textSecondary,
    textAlign: 'center',
  },
});
