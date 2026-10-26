import React, { useCallback, useEffect, useState } from 'react';
import {
  RefreshControl,
  ScrollView,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { WalletBalanceCard } from '../../src/components/wallet/WalletBalanceCard';
import { COLORS } from '../../src/constants/colors';
import { useAuth } from '../../src/context/AuthContext';
import { PaymentService } from '../../src/services/payment.service';
import { styles } from '../../src/styles/home.styles';
import type { CustomerBalance, WalletView } from '../../src/types/payment.types';

export default function HomeScreen() {
  const { user } = useAuth();
  const [wallet, setWallet] = useState<WalletView | null>(null);
  const [balance, setBalance] = useState<CustomerBalance | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const loadData = useCallback(async () => {
    try {
      const [walletData, balanceData] = await Promise.allSettled([
        PaymentService.getWallet(5),
        PaymentService.getBalance(),
      ]);

      if (walletData.status === 'fulfilled') {
        setWallet(walletData.value);
      }
      if (balanceData.status === 'fulfilled') {
        setBalance(balanceData.value);
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

  const outstandingPaise = balance?.outstandingBalancePaise ?? balance?.unpaidPaise ?? 0;

  return (
    <SafeAreaView style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <View style={styles.greetingRow}>
          <View>
            <Text style={styles.greeting}>
              Hello, {user?.name?.split(' ')[0] || 'Rider'} 👋
            </Text>
            <Text style={styles.phoneText}>{user?.phone}</Text>
          </View>
          <TouchableOpacity
            style={styles.notificationIconBtn}
            onPress={() => router.push('/(app)/notifications')}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <Ionicons name="notifications-outline" size={22} color={COLORS.text} />
          </TouchableOpacity>
        </View>
      </View>

      <ScrollView
        contentContainerStyle={styles.scrollContent}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
        }
      >
        {/* Outstanding Dues Banner */}
        {outstandingPaise > 0 && (
          <TouchableOpacity
            style={styles.alertCard}
            onPress={() => router.push('/(app)/wallet')}
            activeOpacity={0.8}
          >
            <Ionicons name="alert-circle" size={24} color={COLORS.error} />
            <View style={{ flex: 1 }}>
              <Text style={styles.alertTitle}>Pending Ride Dues</Text>
              <Text style={styles.alertDesc}>
                You have an outstanding balance of ₹{(outstandingPaise / 100).toFixed(2)}. Please clear to avoid booking delays.
              </Text>
            </View>
          </TouchableOpacity>
        )}

        {/* Wallet Balance Card */}
        <WalletBalanceCard
          balancePaise={wallet?.balancePaise ?? 0}
          outstandingBalancePaise={outstandingPaise}
          onTopupPress={() => router.push('/(app)/wallet')}
        />

        {/* Quick Services Grid */}
        <Text style={styles.quickActionsTitle}>Customer Services</Text>
        <View style={styles.grid}>
          <TouchableOpacity
            style={styles.actionCard}
            onPress={() => router.push('/(app)/rides')}
            activeOpacity={0.7}
          >
            <View style={[styles.actionIconContainer, { backgroundColor: '#EFF6FF' }]}>
              <Ionicons name="car-sport" size={24} color={COLORS.primary} />
            </View>
            <Text style={styles.actionTitle}>Your Rides</Text>
            <Text style={styles.actionSubtitle}>History & Receipts</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.actionCard}
            onPress={() => router.push('/(app)/places')}
            activeOpacity={0.7}
          >
            <View style={[styles.actionIconContainer, { backgroundColor: '#F0FDF4' }]}>
              <Ionicons name="bookmark" size={24} color={COLORS.success} />
            </View>
            <Text style={styles.actionTitle}>Saved Places</Text>
            <Text style={styles.actionSubtitle}>Home, Work & More</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.actionCard}
            onPress={() => router.push('/(app)/wallet')}
            activeOpacity={0.7}
          >
            <View style={[styles.actionIconContainer, { backgroundColor: '#FEF3C7' }]}>
              <Ionicons name="card" size={24} color="#D97706" />
            </View>
            <Text style={styles.actionTitle}>Payments</Text>
            <Text style={styles.actionSubtitle}>Top-up & Status</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.actionCard}
            onPress={() => router.push('/(app)/support')}
            activeOpacity={0.7}
          >
            <View style={[styles.actionIconContainer, { backgroundColor: '#F3E8FF' }]}>
              <Ionicons name="headset" size={24} color="#7C3AED" />
            </View>
            <Text style={styles.actionTitle}>Help & Support</Text>
            <Text style={styles.actionSubtitle}>Tickets & Issues</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
