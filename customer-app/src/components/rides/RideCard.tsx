import React from 'react';
import { Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { COLORS } from '../../constants/colors';
import { APP_CONFIG } from '../../constants/config';
import type { RideHistoryItem, RideStatus } from '../../types/ride.types';
import { Badge, type BadgeVariant } from '../common/Badge';
import { styles } from './RideCard.styles';

export type RideCardProps = {
  ride: RideHistoryItem;
  onPress: (ride: RideHistoryItem) => void;
};

const getStatusBadge = (status: RideStatus): { label: string; variant: BadgeVariant } => {
  switch (status) {
    case 'COMPLETED':
      return { label: 'Completed', variant: 'success' };
    case 'CANCELLED':
      return { label: 'Cancelled', variant: 'error' };
    case 'IN_PROGRESS':
    case 'ARRIVED':
    case 'ARRIVING':
      return { label: 'Active', variant: 'info' };
    default:
      return { label: status, variant: 'neutral' };
  }
};

export const RideCard: React.FC<RideCardProps> = ({ ride, onPress }) => {
  const badge = getStatusBadge(ride.status);
  const formattedDate = new Date(ride.createdAt).toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
  const fareVal = ride.finalFarePaise ?? ride.estimatedFarePaise ?? ride.farePaise ?? 0;
  const fareRupees = (fareVal / 100).toFixed(2);
  const tripId = ride.rideId || ride.id || ride.bookingId || '';

  return (
    <TouchableOpacity
      style={styles.card}
      onPress={() => onPress(ride)}
      activeOpacity={0.7}
    >
      <View style={styles.header}>
        <Text style={styles.date}>{formattedDate}</Text>
        <Badge label={badge.label} variant={badge.variant} />
      </View>

      <View style={styles.routeContainer}>
        <View style={styles.pointRow}>
          <View style={styles.dotPickup} />
          <Text style={styles.addressText} numberOfLines={1}>
            {ride.pickup?.address || ride.pickupLabel || 'Pickup location'}
          </Text>
        </View>

        <View style={styles.routeLine} />

        <View style={styles.pointRow}>
          <View style={styles.dotDropoff} />
          <Text style={styles.addressText} numberOfLines={1}>
            {ride.dropoff?.address || ride.dropLabel || 'Dropoff location'}
          </Text>
        </View>
      </View>

      <View style={styles.footer}>
        <View style={styles.driverInfo}>
          {ride.driver ? (
            <>
              <Ionicons name="person-circle" size={18} color={COLORS.textSecondary} />
              <Text style={styles.driverName}>{ride.driver.name}</Text>
            </>
          ) : (
            <Text style={styles.driverName}>Trip #{tripId.slice(-6).toUpperCase()}</Text>
          )}
        </View>
        <Text style={styles.fareText}>
          {APP_CONFIG.currencySymbol}
          {fareRupees}
        </Text>
      </View>
    </TouchableOpacity>
  );
};
