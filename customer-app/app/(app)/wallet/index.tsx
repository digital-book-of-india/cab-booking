import React, { useCallback, useEffect, useState } from 'react';
import {
  Alert,
  FlatList,
  Modal,
  RefreshControl,
  Text,
  TouchableOpacity,
  TouchableWithoutFeedback,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { AppButton } from '../../../src/components/common/AppButton';
import { AppInput } from '../../../src/components/common/AppInput';
import { EmptyState } from '../../../src/components/common/EmptyState';
import { Header } from '../../../src/components/common/Header';
import { WalletBalanceCard } from '../../../src/components/wallet/WalletBalanceCard';
import { COLORS } from '../../../src/constants/colors';
import { APP_CONFIG } from '../../../src/constants/config';
import { PaymentService } from '../../../src/services/payment.service';
import { styles } from '../../../src/styles/wallet.styles';
import type {
  CustomerBalance,
  WalletEntry,
  WalletView,
} from '../../../src/types/payment.types';

const QUICK_AMOUNTS = [100, 200, 500, 1000];

export default function WalletScreen() {
  const [wallet, setWallet] = useState<WalletView | null>(null);
  const [balance, setBalance] = useState<CustomerBalance | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [topupModalVisible, setTopupModalVisible] = useState(false);
  const [customAmount, setCustomAmount] = useState('200');
  const [topupLoading, setTopupLoading] = useState(false);

  const loadData = useCallback(async () => {
    try {
      const [walletRes, balanceRes] = await Promise.allSettled([
        PaymentService.getWallet(30),
        PaymentService.getBalance(),
      ]);

      if (walletRes.status === 'fulfilled') {
        setWallet(walletRes.value);
      }
      if (balanceRes.status === 'fulfilled') {
        setBalance(balanceRes.value);
      }
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const onRefresh = async () => {
    setRefreshing(true);
    await loadData();
    setRefreshing(false);
  };

  const handleTopupSubmit = async () => {
    const amountRupees = parseFloat(customAmount);
    if (isNaN(amountRupees) || amountRupees < 10) {
      Alert.alert('Invalid Amount', 'Minimum top-up amount is ₹10.');
      return;
    }

    const amountPaise = Math.round(amountRupees * 100);

    try {
      setTopupLoading(true);
      const res = await PaymentService.topupWallet(amountPaise);

      // In dev / mock provider mode, auto-complete the payment
      try {
        await PaymentService.completeDevPayment(res.paymentId);
      } catch {
        // If not dev endpoint, verify
        await PaymentService.verifyPayment({
          paymentId: res.paymentId,
          razorpayPaymentId: `mock_rzp_${Date.now()}`,
        });
      }

      setTopupModalVisible(false);
      Alert.alert('Success', `Added ₹${amountRupees.toFixed(2)} to your wallet!`);
      await loadData();
    } catch (err) {
      Alert.alert('Top-up Failed', err instanceof Error ? err.message : 'Could not complete topup');
    } finally {
      setTopupLoading(false);
    }
  };

  const renderTransaction = ({ item }: { item: WalletEntry }) => {
    const isCredit = item.amountPaise > 0 || item.type === 'CREDIT';
    const absAmount = Math.abs(item.amountPaise);
    const formattedAmount = (absAmount / 100).toFixed(2);
    const dateVal = item.at || item.createdAt || new Date();
    const formattedDate = new Date(dateVal).toLocaleDateString('en-IN', {
      day: 'numeric',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
    });

    return (
      <View style={styles.entryItem}>
        <View style={styles.entryLeft}>
          <View
            style={[
              styles.entryIconCircle,
              { backgroundColor: isCredit ? '#DCFCE7' : '#FEE2E2' },
            ]}
          >
            <Ionicons
              name={isCredit ? 'arrow-down' : 'arrow-up'}
              size={18}
              color={isCredit ? COLORS.success : COLORS.error}
            />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.entryDesc} numberOfLines={1}>
              {item.description || (isCredit ? 'Wallet Top-up' : 'Ride Payment')}
            </Text>
            <Text style={styles.entryDate}>{formattedDate}</Text>
          </View>
        </View>

        <Text
          style={[
            styles.entryAmount,
            isCredit ? styles.creditAmount : styles.debitAmount,
          ]}
        >
          {isCredit ? '+' : '-'} {APP_CONFIG.currencySymbol}
          {formattedAmount}
        </Text>
      </View>
    );
  };

  return (
    <SafeAreaView style={styles.container}>
      <Header title="Wallet & Payments" />

      <FlatList
        data={Array.isArray(wallet?.entries) ? wallet.entries : []}
        keyExtractor={(item, index) => item.id || `txn_${index}_${String(item.at || item.createdAt || '')}`}
        contentContainerStyle={styles.scrollContent}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
        }
        ListHeaderComponent={
          <>
            <WalletBalanceCard
              balancePaise={wallet?.balancePaise ?? 0}
              outstandingBalancePaise={balance?.outstandingBalancePaise ?? balance?.unpaidPaise ?? 0}
              onTopupPress={() => setTopupModalVisible(true)}
            />
            <Text style={styles.sectionTitle}>Recent Transactions</Text>
          </>
        }
        renderItem={renderTransaction}
        ListEmptyComponent={
          <EmptyState
            icon="wallet-outline"
            title="No transactions yet"
            subtitle="Top up your wallet to enjoy fast, cashless one-tap ride bookings."
            actionTitle="Add Money Now"
            onAction={() => setTopupModalVisible(true)}
          />
        }
      />

      {/* Topup Modal */}
      <Modal
        visible={topupModalVisible}
        transparent
        animationType="slide"
        onRequestClose={() => setTopupModalVisible(false)}
      >
        <TouchableWithoutFeedback onPress={() => setTopupModalVisible(false)}>
          <View style={styles.topupModalOverlay}>
            <TouchableWithoutFeedback>
              <View style={styles.topupModalContent}>
                <Text style={styles.topupTitle}>Top Up Wallet</Text>

                {/* Quick amount chips */}
                <View style={styles.quickAmountsRow}>
                  {QUICK_AMOUNTS.map((amt) => {
                    const active = customAmount === String(amt);
                    return (
                      <TouchableOpacity
                        key={amt}
                        style={[
                          styles.quickAmountBtn,
                          active && styles.quickAmountBtnActive,
                        ]}
                        onPress={() => setCustomAmount(String(amt))}
                      >
                        <Text
                          style={[
                            styles.quickAmountText,
                            active && styles.quickAmountTextActive,
                          ]}
                        >
                          +₹{amt}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>

                <AppInput
                  label="Amount (in INR)"
                  placeholder="Enter custom amount"
                  keyboardType="numeric"
                  value={customAmount}
                  onChangeText={setCustomAmount}
                />

                <View style={{ marginTop: 16 }}>
                  <AppButton
                    title={`Add ₹${customAmount || '0'} to Wallet`}
                    onPress={handleTopupSubmit}
                    loading={topupLoading}
                    disabled={!customAmount || parseFloat(customAmount) < 10}
                  />
                </View>
              </View>
            </TouchableWithoutFeedback>
          </View>
        </TouchableWithoutFeedback>
      </Modal>
    </SafeAreaView>
  );
}
