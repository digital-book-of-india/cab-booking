import React, { useState } from 'react';
import {
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { COLORS, RADIUS, SPACING } from '../../constants/colors';
import { APP_CONFIG } from '../../constants/config';
import type { WalletEntry } from '../../types/payment.types';

export type TransactionFilter = 'ALL' | 'RIDES' | 'TOPUPS' | 'REFUNDS';

export type TransactionHistoryListProps = {
  entries: WalletEntry[];
  onSelectEntry: (entry: WalletEntry) => void;
};

export const TransactionHistoryList: React.FC<TransactionHistoryListProps> = ({
  entries,
  onSelectEntry,
}) => {
  const [filter, setFilter] = useState<TransactionFilter>('ALL');

  const filteredEntries = entries.filter((item) => {
    if (filter === 'ALL') return true;
    const isCredit = item.amountPaise > 0 || item.type === 'CREDIT';
    if (filter === 'RIDES') {
      return (
        item.kind === 'WALLET_PAYMENT' ||
        item.kind === 'TIP_PAYMENT' ||
        (!isCredit && !!item.bookingId)
      );
    }
    if (filter === 'TOPUPS') {
      return (
        item.kind === 'WALLET_TOPUP' ||
        (isCredit && item.kind !== 'REFUND' && item.kind !== 'WALLET_BONUS')
      );
    }
    if (filter === 'REFUNDS') {
      return item.kind === 'REFUND' || item.kind === 'WALLET_BONUS';
    }
    return true;
  });

  return (
    <View style={styles.container}>
      {/* Filter Chips */}
      <View style={styles.filterRow}>
        <TouchableOpacity
          style={[styles.filterChip, filter === 'ALL' && styles.filterChipActive]}
          onPress={() => setFilter('ALL')}
        >
          <Text
            style={[
              styles.filterText,
              filter === 'ALL' && styles.filterTextActive,
            ]}
          >
            All
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.filterChip, filter === 'RIDES' && styles.filterChipActive]}
          onPress={() => setFilter('RIDES')}
        >
          <Text
            style={[
              styles.filterText,
              filter === 'RIDES' && styles.filterTextActive,
            ]}
          >
            Rides
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.filterChip, filter === 'TOPUPS' && styles.filterChipActive]}
          onPress={() => setFilter('TOPUPS')}
        >
          <Text
            style={[
              styles.filterText,
              filter === 'TOPUPS' && styles.filterTextActive,
            ]}
          >
            Top-ups
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.filterChip, filter === 'REFUNDS' && styles.filterChipActive]}
          onPress={() => setFilter('REFUNDS')}
        >
          <Text
            style={[
              styles.filterText,
              filter === 'REFUNDS' && styles.filterTextActive,
            ]}
          >
            Refunds & Bonus
          </Text>
        </TouchableOpacity>
      </View>

      {/* List items */}
      {filteredEntries.length === 0 ? (
        <View style={styles.emptyContainer}>
          <Ionicons name="receipt-outline" size={32} color={COLORS.disabled} />
          <Text style={styles.emptyTitle}>No transactions found</Text>
          <Text style={styles.emptySub}>
            Transactions will appear here when you take rides or add money.
          </Text>
        </View>
      ) : (
        <View style={styles.list}>
          {filteredEntries.map((item, index) => {
            const isCredit = item.amountPaise > 0 || item.type === 'CREDIT';
            const absAmount = (Math.abs(item.amountPaise) / 100).toFixed(2);
            const dateVal = item.at || item.createdAt || new Date();
            const formattedDate = new Date(dateVal).toLocaleDateString('en-IN', {
              day: 'numeric',
              month: 'short',
              hour: '2-digit',
              minute: '2-digit',
            });

            const isRefund = item.kind === 'REFUND';
            const isBonus = item.kind === 'WALLET_BONUS';

            return (
              <TouchableOpacity
                key={item.id || `txn_${index}_${dateVal}`}
                style={styles.itemCard}
                onPress={() => onSelectEntry(item)}
                activeOpacity={0.7}
              >
                <View style={styles.itemLeft}>
                  <View
                    style={[
                      styles.iconCircle,
                      {
                        backgroundColor: isBonus
                          ? '#F3E8FF'
                          : isRefund
                            ? '#E0F2FE'
                            : isCredit
                              ? '#DCFCE7'
                              : '#FEE2E2',
                      },
                    ]}
                  >
                    <Ionicons
                      name={
                        isBonus
                          ? 'gift'
                          : isRefund
                            ? 'refresh'
                            : isCredit
                              ? 'arrow-down'
                              : 'car'
                      }
                      size={18}
                      color={
                        isBonus
                          ? '#9333EA'
                          : isRefund
                            ? '#0284C7'
                            : isCredit
                              ? '#10B981'
                              : '#EF4444'
                      }
                    />
                  </View>

                  <View style={{ flex: 1 }}>
                    <Text style={styles.itemTitle} numberOfLines={1}>
                      {item.description ||
                        (isBonus
                          ? 'Cashback Bonus'
                          : isRefund
                            ? 'Fare Refund'
                            : isCredit
                              ? 'Wallet Top-up'
                              : 'Ride Payment')}
                    </Text>
                    <Text style={styles.itemDate}>
                      {formattedDate} {item.bookingId ? `• ${item.bookingId}` : ''}
                    </Text>
                  </View>
                </View>

                <View style={{ alignItems: 'flex-end' }}>
                  <Text
                    style={[
                      styles.itemAmount,
                      { color: isCredit ? '#10B981' : '#EF4444' },
                    ]}
                  >
                    {isCredit ? '+' : '-'} {APP_CONFIG.currencySymbol}
                    {absAmount}
                  </Text>
                  <Text style={styles.statusLabel}>Completed</Text>
                </View>
              </TouchableOpacity>
            );
          })}
        </View>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    paddingBottom: SPACING.md,
  },
  filterRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: SPACING.md,
  },
  filterChip: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: RADIUS.full,
    backgroundColor: COLORS.background,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  filterChipActive: {
    backgroundColor: '#059669',
  },
  filterText: {
    fontSize: 12,
    fontWeight: '700',
    color: COLORS.textSecondary,
  },
  filterTextActive: {
    color: COLORS.white,
  },
  emptyContainer: {
    paddingVertical: SPACING.xxl,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.surface,
    borderRadius: RADIUS.lg,
    marginTop: SPACING.sm,
  },
  emptyTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: COLORS.text,
    marginTop: SPACING.sm,
  },
  emptySub: {
    fontSize: 12,
    color: COLORS.textSecondary,
    textAlign: 'center',
    maxWidth: '75%',
    marginTop: 4,
  },
  list: {
    gap: 10,
  },
  itemCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: SPACING.sm + 4,
    backgroundColor: COLORS.surface,
    borderRadius: RADIUS.md,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  itemLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    flex: 1,
    marginRight: 8,
  },
  iconCircle: {
    width: 38,
    height: 38,
    borderRadius: RADIUS.full,
    justifyContent: 'center',
    alignItems: 'center',
  },
  itemTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: COLORS.text,
  },
  itemDate: {
    fontSize: 11,
    color: COLORS.textSecondary,
    marginTop: 2,
  },
  itemAmount: {
    fontSize: 14,
    fontWeight: '800',
  },
  statusLabel: {
    fontSize: 10,
    fontWeight: '600',
    color: '#059669',
    marginTop: 2,
  },
});
