import React, { useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  ScrollView,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { AppButton } from '../common/AppButton';
import { COLORS } from '../../constants/colors';
import { styles } from './RideBookingModal.styles';

export type RideOption = {
  id: string;
  name: string;
  desc: string;
  eta: string;
  price: number;
  originalPrice: number;
  icon: keyof typeof Ionicons.glyphMap;
  tag?: string;
};

const RIDE_OPTIONS: RideOption[] = [
  {
    id: 'cab_go',
    name: 'Cab Go',
    desc: 'Affordable, compact rides',
    eta: '3 mins away',
    price: 190,
    originalPrice: 240,
    icon: 'car-sport',
    tag: 'Fastest',
  },
  {
    id: 'cab_premier',
    name: 'Cab Premier',
    desc: 'Top-rated drivers & comfy sedans',
    eta: '5 mins away',
    price: 280,
    originalPrice: 330,
    icon: 'car',
    tag: 'Popular',
  },
  {
    id: 'cab_auto',
    name: 'Auto',
    desc: 'Doorstep pick-up, no bargaining',
    eta: '2 mins away',
    price: 110,
    originalPrice: 135,
    icon: 'bicycle',
  },
  {
    id: 'cab_moto',
    name: 'Moto Bike',
    desc: 'Beat city traffic, quick commute',
    eta: '1 min away',
    price: 65,
    originalPrice: 85,
    icon: 'flash',
    tag: 'Cheapest',
  },
  {
    id: 'cab_rentals',
    name: 'Hourly Rentals',
    desc: 'Keep cab for multiple stops (2 hrs)',
    eta: 'Available now',
    price: 550,
    originalPrice: 650,
    icon: 'time',
  },
];

const SUGGESTED_DESTINATIONS = [
  { title: 'Airport T3', subtitle: 'Indira Gandhi Int Airport' },
  { title: 'Cyber Hub', subtitle: 'DLF Cyber City, Gurugram' },
  { title: 'New Delhi Rly Stn', subtitle: 'Paharganj, Central Delhi' },
  { title: 'Select Citywalk', subtitle: 'Saket District Centre' },
];

export type RideBookingModalProps = {
  visible: boolean;
  onClose: () => void;
  initialDestination?: string;
  initialServiceId?: string;
  walletBalancePaise?: number;
};

export const RideBookingModal: React.FC<RideBookingModalProps> = ({
  visible,
  onClose,
  initialDestination = '',
  initialServiceId = 'cab_go',
  walletBalancePaise = 125000,
}) => {
  const [destination, setDestination] = useState(initialDestination);
  const [selectedRide, setSelectedRide] = useState<string>(initialServiceId);
  const [paymentMode, setPaymentMode] = useState<'WALLET' | 'CASH' | 'UPI'>('WALLET');
  const [bookingStep, setBookingStep] = useState<'SELECT' | 'CONFIRMING' | 'CONFIRMED'>('SELECT');

  const selectedOption =
    RIDE_OPTIONS.find((r) => r.id === selectedRide) || RIDE_OPTIONS[0];

  const handleBookNow = () => {
    setBookingStep('CONFIRMING');
    setTimeout(() => {
      setBookingStep('CONFIRMED');
    }, 1800);
  };

  const handleDone = () => {
    setBookingStep('SELECT');
    onClose();
    router.push('/(app)/rides');
  };

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.modalOverlay}>
        <View style={styles.modalContent}>
          {/* Top Drag Handle */}
          <View style={styles.dragHandleBar}>
            <View style={styles.dragHandle} />
          </View>

          {/* Header */}
          <View style={styles.headerRow}>
            <Text style={styles.modalTitle}>
              {bookingStep === 'CONFIRMED' ? 'Ride Confirmed! 🎉' : 'Choose a Ride'}
            </Text>
            <TouchableOpacity
              style={styles.closeBtn}
              onPress={() => {
                setBookingStep('SELECT');
                onClose();
              }}
            >
              <Ionicons name="close" size={20} color={COLORS.text} />
            </TouchableOpacity>
          </View>

          {bookingStep === 'CONFIRMING' ? (
            <View style={{ paddingVertical: 48, alignItems: 'center', gap: 12 }}>
              <ActivityIndicator size="large" color={COLORS.primary} />
              <Text style={{ fontSize: 16, fontWeight: '700', color: COLORS.text }}>
                Connecting to nearest driver...
              </Text>
              <Text style={{ fontSize: 13, color: COLORS.textSecondary }}>
                Finding best fare & ETA for you
              </Text>
            </View>
          ) : bookingStep === 'CONFIRMED' ? (
            /* Confirmed Driver Details (Uber / Ola Style) */
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
                    <Text style={styles.driverName}>Vikram Singh • 4.9 ⭐</Text>
                    <Text style={styles.driverCar}>White Dzire • DL 01 CA 9988</Text>
                  </View>
                </View>

                <View style={styles.otpBadge}>
                  <Text style={styles.otpLabel}>START OTP</Text>
                  <Text style={styles.otpCode}>5491</Text>
                </View>
              </View>

              <AppButton title="View Live Ride Details" onPress={handleDone} />
            </View>
          ) : (
            <ScrollView showsVerticalScrollIndicator={false}>
              {/* Route Input Box */}
              <View style={styles.routeBox}>
                {/* Pickup Row */}
                <View style={styles.locationInputRow}>
                  <View style={styles.pickupDot} />
                  <Text
                    style={[styles.locationTextInput, { color: COLORS.text }]}
                    numberOfLines={1}
                  >
                    Current Location (Connaught Place, New Delhi)
                  </Text>
                </View>

                <View style={styles.routeDivider} />

                {/* Dropoff Row */}
                <View style={styles.locationInputRow}>
                  <View style={styles.dropoffSquare} />
                  <TextInput
                    style={styles.locationTextInput}
                    placeholder="Where to? Enter destination"
                    placeholderTextColor={COLORS.textSecondary}
                    value={destination}
                    onChangeText={setDestination}
                  />
                </View>
              </View>

              {/* Destination Suggestions Chips */}
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.suggestionsContainer}
              >
                {SUGGESTED_DESTINATIONS.map((sug, i) => (
                  <TouchableOpacity
                    key={i}
                    style={styles.suggestionChip}
                    onPress={() => setDestination(`${sug.title}, ${sug.subtitle}`)}
                  >
                    <Ionicons name="navigate-outline" size={14} color={COLORS.primary} />
                    <Text style={styles.suggestionChipText}>{sug.title}</Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>

              {/* Available Cabs List */}
              <Text style={styles.vehiclesSectionTitle}>Available Cabs & Auto</Text>
              {RIDE_OPTIONS.map((opt) => {
                const isSelected = selectedRide === opt.id;
                return (
                  <TouchableOpacity
                    key={opt.id}
                    style={[
                      styles.vehicleCard,
                      isSelected && styles.vehicleCardSelected,
                    ]}
                    onPress={() => setSelectedRide(opt.id)}
                    activeOpacity={0.7}
                  >
                    <View style={styles.vehicleLeft}>
                      <View
                        style={[
                          styles.vehicleIconBox,
                          isSelected && { backgroundColor: '#DBEAFE' },
                        ]}
                      >
                        <Ionicons
                          name={opt.icon}
                          size={24}
                          color={isSelected ? COLORS.primary : COLORS.text}
                        />
                      </View>
                      <View>
                        <View style={styles.vehicleNameRow}>
                          <Text style={styles.vehicleName}>{opt.name}</Text>
                          {opt.tag ? (
                            <View style={styles.tagBadge}>
                              <Text style={styles.tagBadgeText}>{opt.tag}</Text>
                            </View>
                          ) : null}
                        </View>
                        <Text style={styles.vehicleMeta}>
                          {opt.eta} • {opt.desc}
                        </Text>
                      </View>
                    </View>

                    <View style={styles.vehicleRight}>
                      <Text style={styles.vehiclePrice}>₹{opt.price}</Text>
                      <Text style={styles.vehicleOriginalPrice}>
                        ₹{opt.originalPrice}
                      </Text>
                    </View>
                  </TouchableOpacity>
                );
              })}

              {/* Payment & Coupon Row */}
              <View style={styles.paymentRow}>
                <TouchableOpacity
                  style={styles.paymentPill}
                  onPress={() =>
                    setPaymentMode((prev) =>
                      prev === 'WALLET' ? 'CASH' : prev === 'CASH' ? 'UPI' : 'WALLET',
                    )
                  }
                >
                  <Ionicons
                    name={
                      paymentMode === 'WALLET'
                        ? 'wallet'
                        : paymentMode === 'CASH'
                        ? 'cash'
                        : 'card'
                    }
                    size={16}
                    color={COLORS.primary}
                  />
                  <Text style={styles.paymentText}>
                    {paymentMode === 'WALLET'
                      ? `Wallet (₹${(walletBalancePaise / 100).toFixed(0)})`
                      : paymentMode}
                  </Text>
                  <Ionicons name="chevron-down" size={14} color={COLORS.textSecondary} />
                </TouchableOpacity>

                <View style={styles.couponPill}>
                  <Ionicons name="pricetag" size={12} color="#B45309" />
                  <Text style={styles.couponText}>WELCOME50 applied</Text>
                </View>
              </View>

              {/* CTA Button */}
              <View style={styles.ctaContainer}>
                <AppButton
                  title={`Book ${selectedOption.name} • ₹${selectedOption.price}`}
                  onPress={handleBookNow}
                />
              </View>
            </ScrollView>
          )}
        </View>
      </View>
    </Modal>
  );
};
