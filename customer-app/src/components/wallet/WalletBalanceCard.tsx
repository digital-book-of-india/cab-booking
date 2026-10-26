import React from 'react';
import { Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { COLORS } from '../../constants/colors';
import { APP_CONFIG } from '../../constants/config';
import { styles } from './WalletBalanceCard.styles';

export type WalletBalanceCardProps = {
  balancePaise: number;
  outstandingBalancePaise?: number;
  onTopupPress: () => void;
};

export const WalletBalanceCard: React.FC<WalletBalanceCardProps> = ({
  balancePaise,
  outstandingBalancePaise = 0,
  onTopupPress,
}) => {
  const balanceRupees = (balancePaise / 100).toFixed(2);
  const duesRupees = (outstandingBalancePaise / 100).toFixed(2);

  return (
    <View style={styles.card}>
      <View style={styles.topRow}>
        <Text style={styles.label}>Wallet Balance</Text>
        <Ionicons name="wallet-outline" size={24} color={COLORS.white} />
      </View>

      <Text style={styles.balanceText}>
        {APP_CONFIG.currencySymbol}
        {balanceRupees}
      </Text>

      <View style={styles.bottomRow}>
        <View style={styles.duesContainer}>
          {outstandingBalancePaise > 0 ? (
            <>
              <Text style={styles.duesLabel}>Outstanding Balance:</Text>
              <Text style={styles.duesValue}>
                {APP_CONFIG.currencySymbol}
                {duesRupees}
              </Text>
            </>
          ) : (
            <Text style={styles.duesLabel}>No pending dues</Text>
          )}
        </View>

        <TouchableOpacity
          style={styles.topupButton}
          onPress={onTopupPress}
          activeOpacity={0.8}
        >
          <Ionicons name="add-circle" size={18} color={COLORS.primary} />
          <Text style={styles.topupText}>Add Money</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
};
