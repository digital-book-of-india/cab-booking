import React, { useCallback, useEffect, useState } from 'react';
import {
  Alert,
  RefreshControl,
  ScrollView,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Header } from '../../../src/components/common/Header';
import { AddMoneyModal } from '../../../src/components/wallet/AddMoneyModal';
import { PaymentMethodsSection } from '../../../src/components/wallet/PaymentMethodsSection';
import { RefundsTrackerSection } from '../../../src/components/wallet/RefundsTrackerSection';
import { RewardsSection } from '../../../src/components/wallet/RewardsSection';
import { TransactionDetailModal } from '../../../src/components/wallet/TransactionDetailModal';
import { TransactionHistoryList } from '../../../src/components/wallet/TransactionHistoryList';
import { WalletBalanceCard } from '../../../src/components/wallet/WalletBalanceCard';
import { PaymentService } from '../../../src/services/payment.service';
import { styles } from '../../../src/styles/wallet.styles';
import type {
  CustomerBalance,
  EnrichedWalletView,
  FailedPaymentRecord,
  RefundRecord,
  SavedPaymentMethod,
  WalletEntry,
  WalletRewardItem,
} from '../../../src/types/payment.types';

type WalletTab = 'TXNS' | 'METHODS' | 'REFUNDS' | 'REWARDS';

export default function WalletScreen() {
  const [wallet, setWallet] = useState<EnrichedWalletView | null>(null);
  const [balance, setBalance] = useState<CustomerBalance | null>(null);
  const [paymentMethods, setPaymentMethods] = useState<SavedPaymentMethod[]>([]);
  const [refunds, setRefunds] = useState<RefundRecord[]>([]);
  const [failedPayments, setFailedPayments] = useState<FailedPaymentRecord[]>([]);
  const [rewards, setRewards] = useState<WalletRewardItem[]>([]);

  const [activeTab, setActiveTab] = useState<WalletTab>('TXNS');
  const [refreshing, setRefreshing] = useState(false);
  const [topupModalVisible, setTopupModalVisible] = useState(false);
  const [topupLoading, setTopupLoading] = useState(false);
  const [selectedEntry, setSelectedEntry] = useState<WalletEntry | null>(null);

  const loadData = useCallback(async () => {
    try {
      const [
        walletRes,
        balanceRes,
        methodsRes,
      ] = await Promise.allSettled([
        PaymentService.getWallet(50),
        PaymentService.getBalance(),
        PaymentService.getPaymentMethods(),
      ]);

      let loadedWallet: EnrichedWalletView | null = null;
      if (walletRes.status === 'fulfilled') {
        loadedWallet = walletRes.value;
        setWallet(loadedWallet);
      }
      if (balanceRes.status === 'fulfilled') {
        setBalance(balanceRes.value);
      }
      if (methodsRes.status === 'fulfilled') {
        setPaymentMethods(methodsRes.value);
      }

      // Populate refunds and rewards dynamically from live ledger events
      const [refundsRes, failedRes, rewardsRes] = await Promise.allSettled([
        PaymentService.getRefunds(loadedWallet?.entries),
        PaymentService.getFailedPayments(),
        PaymentService.getRewards(loadedWallet?.entries),
      ]);

      if (refundsRes.status === 'fulfilled') {
        setRefunds(refundsRes.value);
      }
      if (failedRes.status === 'fulfilled') {
        setFailedPayments(failedRes.value);
      }
      if (rewardsRes.status === 'fulfilled') {
        setRewards(rewardsRes.value);
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

  const handleTopupSubmit = async (
    amountPaise: number,
    paymentMethod: 'UPI' | 'CARD',
  ) => {
    try {
      setTopupLoading(true);
      const res = await PaymentService.topupWallet(amountPaise);

      // In dev / mock provider mode, auto-complete the payment
      try {
        await PaymentService.completeDevPayment(res.paymentId);
      } catch {
        await PaymentService.verifyPayment({
          paymentId: res.paymentId,
          providerPaymentId: `mock_${paymentMethod.toLowerCase()}_${Date.now()}`,
          providerSignature: `mock_sig_${Date.now()}`,
        });
      }

      setTopupModalVisible(false);
      Alert.alert(
        'Top-up Successful',
        `₹${(amountPaise / 100).toFixed(2)} has been added to your wallet balance!`,
      );
      await loadData();
    } catch (err) {
      Alert.alert(
        'Top-up Failed',
        err instanceof Error ? err.message : 'Could not complete top-up',
      );
    } finally {
      setTopupLoading(false);
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <Header
        title="Wallet & Payments"
        showBack
        onBack={() => (router.canGoBack() ? router.back() : router.replace('/(app)/profile'))}
      />

      <ScrollView
        contentContainerStyle={styles.scrollContent}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
        }
      >
        {/* 1. Wallet Balance Card (Top Hero) */}
        <WalletBalanceCard
          balancePaise={wallet?.balancePaise ?? 0}
          totalAddedPaise={wallet?.stats?.totalAddedPaise ?? 0}
          ridePaymentsPaise={wallet?.stats?.ridePaymentsPaise ?? 0}
          outstandingBalancePaise={
            balance?.outstandingBalancePaise ?? balance?.unpaidPaise ?? 0
          }
          onTopupPress={() => setTopupModalVisible(true)}
        />

        {/* 2. Segmented Navigation Tab Bar */}
        <View style={styles.tabBar}>
          <TouchableOpacity
            style={[styles.tabButton, activeTab === 'TXNS' && styles.tabButtonActive]}
            onPress={() => setActiveTab('TXNS')}
            activeOpacity={0.8}
          >
            <Text
              style={[
                styles.tabButtonText,
                activeTab === 'TXNS' && styles.tabButtonTextActive,
              ]}
            >
              Transactions
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[
              styles.tabButton,
              activeTab === 'METHODS' && styles.tabButtonActive,
            ]}
            onPress={() => setActiveTab('METHODS')}
            activeOpacity={0.8}
          >
            <Text
              style={[
                styles.tabButtonText,
                activeTab === 'METHODS' && styles.tabButtonTextActive,
              ]}
            >
              Methods
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[
              styles.tabButton,
              activeTab === 'REFUNDS' && styles.tabButtonActive,
            ]}
            onPress={() => setActiveTab('REFUNDS')}
            activeOpacity={0.8}
          >
            <Text
              style={[
                styles.tabButtonText,
                activeTab === 'REFUNDS' && styles.tabButtonTextActive,
              ]}
            >
              Refunds
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[
              styles.tabButton,
              activeTab === 'REWARDS' && styles.tabButtonActive,
            ]}
            onPress={() => setActiveTab('REWARDS')}
            activeOpacity={0.8}
          >
            <Text
              style={[
                styles.tabButtonText,
                activeTab === 'REWARDS' && styles.tabButtonTextActive,
              ]}
            >
              Rewards
            </Text>
          </TouchableOpacity>
        </View>

        {/* 3. Active Tab Content */}
        <View style={styles.tabContent}>
          {activeTab === 'TXNS' && (
            <TransactionHistoryList
              entries={wallet?.entries || []}
              onSelectEntry={(entry) => setSelectedEntry(entry)}
            />
          )}

          {activeTab === 'METHODS' && (
            <PaymentMethodsSection
              methods={paymentMethods}
              onRefreshMethods={loadData}
            />
          )}

          {activeTab === 'REFUNDS' && (
            <RefundsTrackerSection
              refunds={refunds}
              failedPayments={failedPayments}
            />
          )}

          {activeTab === 'REWARDS' && <RewardsSection rewards={rewards} />}
        </View>
      </ScrollView>

      {/* Add Money Modal */}
      <AddMoneyModal
        visible={topupModalVisible}
        loading={topupLoading}
        onClose={() => setTopupModalVisible(false)}
        onSubmit={handleTopupSubmit}
        limits={wallet?.limits}
        currentBalancePaise={wallet?.balancePaise ?? 0}
      />

      {/* Transaction Detail & Digital Receipt Modal */}
      <TransactionDetailModal
        visible={!!selectedEntry}
        entry={selectedEntry}
        onClose={() => setSelectedEntry(null)}
      />
    </SafeAreaView>
  );
}
