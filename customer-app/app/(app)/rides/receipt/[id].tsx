import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  ScrollView,
  Text,
  View,
} from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Header } from '../../../../src/components/common/Header';
import { COLORS } from '../../../../src/constants/colors';
import { APP_CONFIG } from '../../../../src/constants/config';
import { RidesService } from '../../../../src/services/rides.service';
import { styles } from '../../../../src/styles/receipt.styles';
import type { RideReceipt } from '../../../../src/types/ride.types';

export default function RideReceiptScreen() {
  const params = useLocalSearchParams<{ id: string }>();
  const rideId = params.id;
  const [receipt, setReceipt] = useState<RideReceipt | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;
    async function load() {
      if (!rideId) return;
      try {
        setLoading(true);
        const data = await RidesService.getReceipt(rideId);
        if (mounted) setReceipt(data);
      } catch (err) {
        Alert.alert('Error', err instanceof Error ? err.message : 'Could not fetch receipt');
        router.back();
      } finally {
        if (mounted) setLoading(false);
      }
    }
    load();
    return () => {
      mounted = false;
    };
  }, [rideId]);

  if (loading || !receipt) {
    return (
      <SafeAreaView style={styles.container}>
        <Header title="Receipt" showBack />
        <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
          <ActivityIndicator size="large" color={COLORS.primary} />
        </View>
      </SafeAreaView>
    );
  }

  const breakdown = receipt.fareBreakdown;
  const formattedDate = new Date(receipt.date).toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });

  return (
    <SafeAreaView style={styles.container}>
      <Header title="Trip Receipt" showBack />

      <ScrollView contentContainerStyle={styles.scrollContent}>
        <View style={styles.receiptPaper}>
          <View style={styles.logoRow}>
            <Text style={styles.appName}>{APP_CONFIG.appName}</Text>
            <Text style={styles.receiptNumber}>Receipt #{receipt.receiptNumber}</Text>
          </View>

          <View style={styles.divider} />

          <View style={styles.metaRow}>
            <Text style={styles.metaLabel}>Date & Time</Text>
            <Text style={styles.metaValue}>{formattedDate}</Text>
          </View>

          <View style={styles.metaRow}>
            <Text style={styles.metaLabel}>Customer Name</Text>
            <Text style={styles.metaValue}>{receipt.customerName}</Text>
          </View>

          <View style={styles.metaRow}>
            <Text style={styles.metaLabel}>Driver Name</Text>
            <Text style={styles.metaValue}>{receipt.driverName}</Text>
          </View>

          <View style={styles.metaRow}>
            <Text style={styles.metaLabel}>Vehicle Details</Text>
            <Text style={styles.metaValue}>{receipt.vehicleDetails}</Text>
          </View>

          {receipt.gstNumber ? (
            <View style={styles.metaRow}>
              <Text style={styles.metaLabel}>GSTIN</Text>
              <Text style={styles.metaValue}>{receipt.gstNumber}</Text>
            </View>
          ) : null}

          <View style={styles.dashedDivider} />

          <Text style={styles.sectionTitle}>Trip Route</Text>
          <View style={styles.metaRow}>
            <Text style={styles.metaLabel}>From</Text>
            <Text style={[styles.metaValue, { flex: 1, textAlign: 'right' }]}>
              {receipt.pickupAddress}
            </Text>
          </View>
          <View style={styles.metaRow}>
            <Text style={styles.metaLabel}>To</Text>
            <Text style={[styles.metaValue, { flex: 1, textAlign: 'right' }]}>
              {receipt.dropoffAddress}
            </Text>
          </View>

          <View style={styles.dashedDivider} />

          <Text style={styles.sectionTitle}>Charges</Text>
          <View style={styles.metaRow}>
            <Text style={styles.metaLabel}>Base Fare</Text>
            <Text style={styles.metaValue}>₹{(breakdown.baseFarePaise / 100).toFixed(2)}</Text>
          </View>

          {breakdown.distanceFarePaise > 0 && (
            <View style={styles.metaRow}>
              <Text style={styles.metaLabel}>Distance Charge</Text>
              <Text style={styles.metaValue}>₹{(breakdown.distanceFarePaise / 100).toFixed(2)}</Text>
            </View>
          )}

          {breakdown.timeFarePaise > 0 && (
            <View style={styles.metaRow}>
              <Text style={styles.metaLabel}>Time & Waiting Charge</Text>
              <Text style={styles.metaValue}>₹{(breakdown.timeFarePaise / 100).toFixed(2)}</Text>
            </View>
          )}

          {breakdown.taxPaise > 0 && (
            <View style={styles.metaRow}>
              <Text style={styles.metaLabel}>GST / Taxes</Text>
              <Text style={styles.metaValue}>₹{(breakdown.taxPaise / 100).toFixed(2)}</Text>
            </View>
          )}

          <View style={styles.totalSection}>
            <View style={styles.totalRow}>
              <Text style={styles.totalLabel}>Total Paid</Text>
              <Text style={styles.totalValue}>
                ₹{(breakdown.totalFarePaise / 100).toFixed(2)}
              </Text>
            </View>
          </View>

          <Text style={styles.footerNote}>
            Thank you for riding with us! This is a computer-generated tax receipt.
          </Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
