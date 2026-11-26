import React from 'react';
import { ActivityIndicator, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { AppButton } from '../common/AppButton';
import { COLORS } from '../../constants/colors';
import { styles } from '../../styles/home/BookingConfirmView.styles';

export type BookingConfirmViewProps = {
  step: 'CONFIRMING' | 'CONFIRMED';
  onDone: () => void;
};

export const BookingConfirmView: React.FC<BookingConfirmViewProps> = ({
  step,
  onDone,
}) => {
  if (step === 'CONFIRMING') {
    return (
      <View style={styles.confirmingBox}>
        <ActivityIndicator size="large" color={COLORS.primary} />
        <Text style={styles.confirmingTitle}>Connecting to nearest driver...</Text>
        <Text style={styles.confirmingSub}>Checking zone dispatch availability</Text>
      </View>
    );
  }

  return (
    <View style={styles.confirmContainer}>
      <View style={styles.confirmIconBox}>
        <Ionicons name="checkmark-circle" size={48} color="#16A34A" />
      </View>

      <Text style={styles.confirmTitle}>Driver is on the way!</Text>
      <Text style={styles.confirmSub}>
        Arriving in 3 mins at your pickup location
      </Text>

      <View style={styles.driverInfoCard}>
        <View style={styles.driverLeft}>
          <View style={styles.driverAvatar}>
            <Ionicons name="person" size={24} color={COLORS.primary} />
          </View>
          <View>
            <Text style={styles.driverName}>Vikram Singh • 4.9 ★</Text>
            <Text style={styles.driverCar}>White Dzire • DL 01 CA 9988</Text>
          </View>
        </View>

        <View style={styles.otpBadge}>
          <Text style={styles.otpLabel}>START OTP</Text>
          <Text style={styles.otpCode}>5491</Text>
        </View>
      </View>

      <AppButton title="View Live Ride Details" onPress={onDone} />
    </View>
  );
};
