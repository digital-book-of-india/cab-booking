import React from 'react';
import { Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { APP_CONFIG } from '../../constants/config';
import { styles } from './WalletBalanceCard.styles';

export type WalletBalanceCardProps = {
  balancePaise: number;
  totalAddedPaise?: number;
  ridePaymentsPaise?: number;
  outstandingBalancePaise?: number;
  onTopupPress: () => void;
};

export const WalletBalanceCard: React.FC<WalletBalanceCardProps> = ({
  balancePaise,
  totalAddedPaise = 0,
  ridePaymentsPaise = 0,
  outstandingBalancePaise = 0,
  onTopupPress,
}) => {
  const balanceRupees = (balancePaise / 100).toFixed(2);
  const addedRupees = (totalAddedPaise / 100).toFixed(2);
  const rideRupees = (ridePaymentsPaise / 100).toFixed(2);
  const duesRupees = (outstandingBalancePaise / 100).toFixed(2);

  return (
    <View style={styles.card}>
      {/* Top Header */}
      <View style={styles.topRow}>
        <View>
          <Text style={styles.label}>AVAILABLE BALANCE</Text>
          <Text style={styles.balanceText}>
            {APP_CONFIG.currencySymbol}
            {balanceRupees}
          </Text>
        </View>
        <View style={styles.statusBadge}>
          <View style={styles.statusDot} />
          <Text style={styles.statusText}>Active</Text>
        </View>
      </View>

      {/* Dynamic Metric Chips: Total Added & Ride Payments */}
      <View style={styles.metricsRow}>
        <View style={styles.metricBox}>
          <View style={styles.metricHeader}>
            <Ionicons name="arrow-down-circle" size={14} color="#34D399" />
            <Text style={styles.metricLabel}>Total Added</Text>
          </View>
          <Text style={styles.metricValueCredit}>
            {APP_CONFIG.currencySymbol}
            {addedRupees}
          </Text>
        </View>

        <View style={styles.metricBox}>
          <View style={styles.metricHeader}>
            <Ionicons name="arrow-up-circle" size={14} color="#FBBF24" />
            <Text style={styles.metricLabel}>Ride Payments</Text>
          </View>
          <Text style={styles.metricValueDebit}>
            {APP_CONFIG.currencySymbol}
            {rideRupees}
          </Text>
        </View>
      </View>

      {/* Outstanding Dues warning if any */}
      {outstandingBalancePaise > 0 && (
        <View style={styles.duesBanner}>
          <Ionicons name="alert-circle" size={16} color="#F87171" />
          <Text style={styles.duesBannerText}>
            Unpaid Dues: {APP_CONFIG.currencySymbol}
            {duesRupees}
          </Text>
        </View>
      )}

      {/* Add Money Button */}
      <TouchableOpacity
        style={styles.addMoneyBtn}
        onPress={onTopupPress}
        activeOpacity={0.85}
      >
        <Ionicons name="add" size={18} color="#FFFFFF" />
        <Text style={styles.addMoneyBtnText}>Add Money to Wallet</Text>
      </TouchableOpacity>
    </View>
  );
};
