import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  ScrollView,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { AppButton } from '../../../src/components/common/AppButton';
import { Badge } from '../../../src/components/common/Badge';
import { Header } from '../../../src/components/common/Header';
import { RatingModal } from '../../../src/components/ratings/RatingModal';
import { COLORS } from '../../../src/constants/colors';
import { APP_CONFIG } from '../../../src/constants/config';
import { RidesService } from '../../../src/services/rides.service';
import { styles } from '../../../src/styles/rideDetail.styles';
import type { RatingView, RideDetails, RideRatingInput } from '../../../src/types/ride.types';

export default function RideDetailScreen() {
  const params = useLocalSearchParams<{ id: string }>();
  const rideId = params.id;

  const [ride, setRide] = useState<RideDetails | null>(null);
  const [rating, setRating] = useState<RatingView | null>(null);
  const [loading, setLoading] = useState(true);
  const [ratingModalVisible, setRatingModalVisible] = useState(false);
  const [ratingSubmitting, setRatingSubmitting] = useState(false);

  const loadRide = useCallback(async () => {
    if (!rideId) return;
    try {
      setLoading(true);
      const [rideData, ratingData] = await Promise.allSettled([
        RidesService.getRide(rideId),
        RidesService.getRideRating(rideId),
      ]);

      if (rideData.status === 'fulfilled') {
        setRide(rideData.value);
      }
      if (ratingData.status === 'fulfilled') {
        setRating(ratingData.value);
      }
    } catch (err) {
      Alert.alert('Error', err instanceof Error ? err.message : 'Could not fetch ride details');
    } finally {
      setLoading(false);
    }
  }, [rideId]);

  useEffect(() => {
    loadRide();
  }, [loadRide]);

  const handleRateSubmit = async (input: RideRatingInput) => {
    if (!rideId) return;
    setRatingSubmitting(true);
    try {
      const res = await RidesService.rateRide(rideId, input);
      setRating(res);
      Alert.alert('Thank You!', 'Your rating has been recorded.');
    } catch (err) {
      Alert.alert('Rating Error', err instanceof Error ? err.message : 'Failed to submit rating');
    } finally {
      setRatingSubmitting(false);
    }
  };

  const handleResendOtp = async () => {
    if (!rideId) return;
    try {
      await RidesService.resendPickupOtp(rideId);
      Alert.alert('Sent', 'Pickup OTP has been resent via SMS.');
    } catch (err) {
      Alert.alert('Error', err instanceof Error ? err.message : 'Could not resend OTP');
    }
  };

  if (loading || !ride) {
    return (
      <SafeAreaView style={styles.container}>
        <Header title="Trip Details" showBack />
        <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
          <ActivityIndicator size="large" color={COLORS.primary} />
        </View>
      </SafeAreaView>
    );
  }

  const breakdown = ride.fareBreakdown || {
    baseFarePaise: ride.farePaise,
    distanceFarePaise: 0,
    timeFarePaise: 0,
    taxPaise: 0,
    totalFarePaise: ride.farePaise,
  };

  const isCompleted = ride.status === 'COMPLETED';
  const displayRideId = ride.rideId || ride.id || ride.bookingId || '';

  return (
    <SafeAreaView style={styles.container}>
      <Header
        title={`Trip #${displayRideId.slice(-6).toUpperCase()}`}
        showBack
        rightElement={
          <Badge
            label={ride.status}
            variant={isCompleted ? 'success' : ride.status === 'CANCELLED' ? 'error' : 'info'}
          />
        }
      />

      <ScrollView contentContainerStyle={styles.scrollContent}>
        {/* Pickup OTP Banner (for ongoing rides) */}
        {ride.pickupOtp && !isCompleted && ride.status !== 'CANCELLED' && (
          <View style={styles.otpBanner}>
            <View>
              <Text style={styles.otpText}>Share OTP with driver</Text>
              <Text style={styles.otpCode}>{ride.pickupOtp}</Text>
            </View>
            <TouchableOpacity onPress={handleResendOtp}>
              <Ionicons name="refresh" size={20} color="#92400E" />
            </TouchableOpacity>
          </View>
        )}

        {/* Route Card */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Route Information</Text>

          <View style={styles.routeRow}>
            <View style={styles.dotPickup} />
            <View style={{ flex: 1 }}>
              <Text style={styles.routeLabel}>Pickup Point</Text>
              <Text style={styles.routeAddress}>
                {ride.pickup?.address || (ride as any).pickupLabel || 'Pickup location'}
              </Text>
            </View>
          </View>

          <View style={styles.routeLine} />

          <View style={styles.routeRow}>
            <View style={styles.dotDropoff} />
            <View style={{ flex: 1 }}>
              <Text style={styles.routeLabel}>Dropoff Point</Text>
              <Text style={styles.routeAddress}>
                {ride.dropoff?.address || (ride as any).dropLabel || 'Dropoff location'}
              </Text>
            </View>
          </View>
        </View>

        {/* Driver Card */}
        {ride.driver && (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Driver & Vehicle</Text>
            <View style={styles.driverRow}>
              <View style={styles.driverAvatar}>
                <Ionicons name="person" size={28} color={COLORS.primary} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.driverName}>{ride.driver.name}</Text>
                {ride.driver.vehicle ? (
                  <Text style={styles.driverVehicle}>
                    {ride.driver.vehicle.color} {ride.driver.vehicle.make} {ride.driver.vehicle.model} • {ride.driver.vehicle.plateNumber}
                  </Text>
                ) : null}
              </View>
              {ride.driver.rating ? (
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 2 }}>
                  <Ionicons name="star" size={16} color="#F59E0B" />
                  <Text style={{ fontWeight: '700', fontSize: 14 }}>{ride.driver.rating.toFixed(1)}</Text>
                </View>
              ) : null}
            </View>
          </View>
        )}

        {/* Fare Breakdown Card */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Fare Breakdown</Text>

          <View style={styles.breakdownRow}>
            <Text style={styles.breakdownLabel}>Base Fare</Text>
            <Text style={styles.breakdownValue}>
              ₹{(breakdown.baseFarePaise / 100).toFixed(2)}
            </Text>
          </View>

          {breakdown.distanceFarePaise > 0 && (
            <View style={styles.breakdownRow}>
              <Text style={styles.breakdownLabel}>Distance Fare</Text>
              <Text style={styles.breakdownValue}>
                ₹{(breakdown.distanceFarePaise / 100).toFixed(2)}
              </Text>
            </View>
          )}

          {breakdown.timeFarePaise > 0 && (
            <View style={styles.breakdownRow}>
              <Text style={styles.breakdownLabel}>Time Fare</Text>
              <Text style={styles.breakdownValue}>
                ₹{(breakdown.timeFarePaise / 100).toFixed(2)}
              </Text>
            </View>
          )}

          {breakdown.taxPaise > 0 && (
            <View style={styles.breakdownRow}>
              <Text style={styles.breakdownLabel}>Taxes & GST</Text>
              <Text style={styles.breakdownValue}>
                ₹{(breakdown.taxPaise / 100).toFixed(2)}
              </Text>
            </View>
          )}

          {breakdown.couponDiscountPaise ? (
            <View style={styles.breakdownRow}>
              <Text style={[styles.breakdownLabel, { color: COLORS.success }]}>Promo Discount</Text>
              <Text style={[styles.breakdownValue, { color: COLORS.success }]}>
                - ₹{(breakdown.couponDiscountPaise / 100).toFixed(2)}
              </Text>
            </View>
          ) : null}

          <View style={styles.totalRow}>
            <Text style={styles.totalLabel}>Total Fare Paid</Text>
            <Text style={styles.totalValue}>
              {APP_CONFIG.currencySymbol}
              {(breakdown.totalFarePaise / 100).toFixed(2)}
            </Text>
          </View>
        </View>

        {/* Rating Summary (if already rated) */}
        {rating && (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Your Review</Text>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginBottom: 6 }}>
              {[1, 2, 3, 4, 5].map((s) => (
                <Ionicons
                  key={s}
                  name={s <= rating.stars ? 'star' : 'star-outline'}
                  size={20}
                  color={s <= rating.stars ? '#F59E0B' : COLORS.disabled}
                />
              ))}
            </View>
            {rating.comment ? (
              <Text style={{ color: COLORS.text, fontSize: 14 }}>"{rating.comment}"</Text>
            ) : null}
          </View>
        )}

        {/* Actions */}
        <View style={styles.actionsRow}>
          {isCompleted && (
            <>
              <AppButton
                title="View Official Receipt"
                variant="outline"
                onPress={() =>
                  router.push({
                    pathname: '/(app)/rides/receipt/[id]',
                    params: { id: ride.rideId || ride.id || ride.bookingId || '' },
                  })
                }
              />

              {!rating && (
                <AppButton
                  title="Rate This Ride"
                  onPress={() => setRatingModalVisible(true)}
                />
              )}
            </>
          )}

          <AppButton
            title="Need Help with this Ride?"
            variant="outline"
            onPress={() =>
              router.push({
                pathname: '/(app)/support',
                params: { rideId: ride.id },
              })
            }
          />
        </View>
      </ScrollView>

      <RatingModal
        visible={ratingModalVisible}
        onClose={() => setRatingModalVisible(false)}
        onSubmit={handleRateSubmit}
        isLoading={ratingSubmitting}
      />
    </SafeAreaView>
  );
}
