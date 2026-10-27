import React, { useCallback, useEffect, useState } from 'react';
import {
  Alert,
  RefreshControl,
  ScrollView,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { RideBookingModal } from '../../src/components/home/RideBookingModal';
import { COLORS } from '../../src/constants/colors';
import { useAuth } from '../../src/context/AuthContext';
import { CustomerService } from '../../src/services/customer.service';
import { PaymentService } from '../../src/services/payment.service';
import { styles } from '../../src/styles/home.styles';
import type { CustomerBalance, WalletView } from '../../src/types/payment.types';
import type { SavedPlace } from '../../src/types/customer.types';

export default function HomeScreen() {
  const { user } = useAuth();
  const [wallet, setWallet] = useState<WalletView | null>(null);
  const [balance, setBalance] = useState<CustomerBalance | null>(null);
  const [savedPlaces, setSavedPlaces] = useState<SavedPlace[]>([]);
  const [refreshing, setRefreshing] = useState(false);

  // Booking Modal State
  const [bookingModalVisible, setBookingModalVisible] = useState(false);
  const [selectedDestination, setSelectedDestination] = useState('');
  const [selectedServiceId, setSelectedServiceId] = useState('cab_go');

  const loadData = useCallback(async () => {
    try {
      const [walletData, balanceData, placesData] = await Promise.allSettled([
        PaymentService.getWallet(5),
        PaymentService.getBalance(),
        CustomerService.listSavedPlaces(),
      ]);

      if (walletData.status === 'fulfilled') {
        setWallet(walletData.value);
      }
      if (balanceData.status === 'fulfilled') {
        setBalance(balanceData.value);
      }
      if (placesData.status === 'fulfilled') {
        setSavedPlaces(placesData.value);
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

  const handleOpenBooking = (destination = '', serviceId = 'cab_go') => {
    setSelectedDestination(destination);
    setSelectedServiceId(serviceId);
    setBookingModalVisible(true);
  };

  const homePlace = savedPlaces.find((p) => p.type === 'home');
  const workPlace = savedPlaces.find((p) => p.type === 'work');
  const outstandingPaise = balance?.outstandingBalancePaise ?? balance?.unpaidPaise ?? 0;

  return (
    <SafeAreaView style={styles.container}>
      {/* Uber/Ola Top Header Bar */}
      <View style={styles.header}>
        <View style={styles.topRow}>
          {/* Detected Current Location Pill */}
          <TouchableOpacity
            style={styles.locationPill}
            onPress={() => handleOpenBooking()}
            activeOpacity={0.7}
          >
            <View style={styles.locationDot} />
            <Text style={styles.locationText} numberOfLines={1}>
              Connaught Place, New Delhi
            </Text>
            <Ionicons name="chevron-down" size={14} color={COLORS.textSecondary} />
          </TouchableOpacity>

          {/* Top Actions: SOS, Notifications, Profile */}
          <View style={styles.topActions}>
            <TouchableOpacity
              style={styles.iconButton}
              onPress={() => router.push('/(app)/contacts' as any)}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <Ionicons name="shield-checkmark" size={20} color="#DC2626" />
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.iconButton}
              onPress={() => router.push('/(app)/notifications')}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <Ionicons name="notifications-outline" size={20} color={COLORS.text} />
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.avatarPill}
              onPress={() => router.push('/(app)/profile')}
              activeOpacity={0.8}
            >
              <Text style={styles.avatarText}>
                {user?.name ? user.name[0].toUpperCase() : 'U'}
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>

      <ScrollView
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={[COLORS.primary]} />
        }
      >
        {/* 1. Signature Uber/Ola "Where to?" Search Box */}
        <View style={styles.searchSection}>
          <TouchableOpacity
            style={styles.searchBar}
            onPress={() => handleOpenBooking()}
            activeOpacity={0.85}
          >
            <View style={styles.searchIconBox}>
              <Ionicons name="search" size={22} color={COLORS.text} />
            </View>
            <Text style={styles.searchPlaceholder}>Where to?</Text>
            <View style={styles.schedulePill}>
              <Ionicons name="time" size={15} color={COLORS.text} />
              <Text style={styles.scheduleText}>Now ▾</Text>
            </View>
          </TouchableOpacity>
        </View>

        {/* 2. Quick Saved Places (1-Tap Destination) */}
        <View style={styles.quickPlacesRow}>
          <TouchableOpacity
            style={styles.quickPlaceChip}
            onPress={() =>
              handleOpenBooking(homePlace ? `${homePlace.name}, ${homePlace.address}` : 'Home')
            }
            activeOpacity={0.7}
          >
            <View style={styles.chipIconCircle}>
              <Ionicons name="home" size={15} color={COLORS.primary} />
            </View>
            <View style={styles.chipContent}>
              <Text style={styles.chipTitle}>Home</Text>
              <Text style={styles.chipSubtitle} numberOfLines={1}>
                {homePlace ? homePlace.address : 'Set Home'}
              </Text>
            </View>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.quickPlaceChip}
            onPress={() =>
              handleOpenBooking(workPlace ? `${workPlace.name}, ${workPlace.address}` : 'Work')
            }
            activeOpacity={0.7}
          >
            <View style={[styles.chipIconCircle, { backgroundColor: '#F0FDF4' }]}>
              <Ionicons name="briefcase" size={15} color={COLORS.success} />
            </View>
            <View style={styles.chipContent}>
              <Text style={styles.chipTitle}>Work</Text>
              <Text style={styles.chipSubtitle} numberOfLines={1}>
                {workPlace ? workPlace.address : 'Set Work'}
              </Text>
            </View>
          </TouchableOpacity>
        </View>

        {/* Outstanding Dues Banner */}
        {outstandingPaise > 0 && (
          <TouchableOpacity
            style={styles.alertCard}
            onPress={() => router.push('/(app)/wallet')}
            activeOpacity={0.8}
          >
            <Ionicons name="alert-circle" size={22} color={COLORS.error} />
            <View style={{ flex: 1 }}>
              <Text style={styles.alertTitle}>Pending Ride Dues</Text>
              <Text style={styles.alertDesc}>
                You have an outstanding balance of ₹{(outstandingPaise / 100).toFixed(2)}.
              </Text>
            </View>
            <Ionicons name="chevron-forward" size={16} color={COLORS.error} />
          </TouchableOpacity>
        )}

        {/* 3. Services & Ride Categories (Uber / Ola Style Grid) */}
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>Suggestions</Text>
          <TouchableOpacity onPress={() => handleOpenBooking()}>
            <Text style={styles.seeAllText}>Book Cab</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.servicesGrid}>
          {/* Daily Cab */}
          <TouchableOpacity
            style={styles.serviceCard}
            onPress={() => handleOpenBooking('', 'cab_go')}
            activeOpacity={0.7}
          >
            <View style={styles.serviceBadge}>
              <Text style={styles.serviceBadgeText}>POPULAR</Text>
            </View>
            <View style={[styles.serviceIconBox, { backgroundColor: '#EFF6FF' }]}>
              <Ionicons name="car-sport" size={28} color={COLORS.primary} />
            </View>
            <Text style={styles.serviceTitle}>Daily Cab</Text>
            <Text style={styles.serviceDesc}>Economy & Sedan</Text>
          </TouchableOpacity>

          {/* Auto */}
          <TouchableOpacity
            style={styles.serviceCard}
            onPress={() => handleOpenBooking('', 'cab_auto')}
            activeOpacity={0.7}
          >
            <View style={[styles.serviceBadge, { backgroundColor: '#F59E0B' }]}>
              <Text style={styles.serviceBadgeText}>METERED</Text>
            </View>
            <View style={[styles.serviceIconBox, { backgroundColor: '#FEF3C7' }]}>
              <Ionicons name="bicycle" size={28} color="#D97706" />
            </View>
            <Text style={styles.serviceTitle}>Auto</Text>
            <Text style={styles.serviceDesc}>Doorstep autos</Text>
          </TouchableOpacity>

          {/* Moto */}
          <TouchableOpacity
            style={styles.serviceCard}
            onPress={() => handleOpenBooking('', 'cab_moto')}
            activeOpacity={0.7}
          >
            <View style={[styles.serviceBadge, { backgroundColor: '#059669' }]}>
              <Text style={styles.serviceBadgeText}>FASTEST</Text>
            </View>
            <View style={[styles.serviceIconBox, { backgroundColor: '#ECFDF5' }]}>
              <Ionicons name="flash" size={28} color="#059669" />
            </View>
            <Text style={styles.serviceTitle}>Moto Bike</Text>
            <Text style={styles.serviceDesc}>Quick commute</Text>
          </TouchableOpacity>

          {/* Outstation */}
          <TouchableOpacity
            style={styles.serviceCard}
            onPress={() => handleOpenBooking('', 'cab_premier')}
            activeOpacity={0.7}
          >
            <View style={[styles.serviceIconBox, { backgroundColor: '#F5F3FF' }]}>
              <Ionicons name="navigate" size={28} color="#7C3AED" />
            </View>
            <Text style={styles.serviceTitle}>Outstation</Text>
            <Text style={styles.serviceDesc}>Intercity travel</Text>
          </TouchableOpacity>

          {/* Rentals */}
          <TouchableOpacity
            style={styles.serviceCard}
            onPress={() => handleOpenBooking('', 'cab_rentals')}
            activeOpacity={0.7}
          >
            <View style={[styles.serviceIconBox, { backgroundColor: '#FDF2F8' }]}>
              <Ionicons name="time" size={28} color="#DB2777" />
            </View>
            <Text style={styles.serviceTitle}>Rentals</Text>
            <Text style={styles.serviceDesc}>Hourly packages</Text>
          </TouchableOpacity>

          {/* Parcel */}
          <TouchableOpacity
            style={styles.serviceCard}
            onPress={() => handleOpenBooking('Courier Delivery', 'cab_go')}
            activeOpacity={0.7}
          >
            <View style={[styles.serviceIconBox, { backgroundColor: '#F1F5F9' }]}>
              <Ionicons name="cube" size={28} color={COLORS.textSecondary} />
            </View>
            <Text style={styles.serviceTitle}>Package</Text>
            <Text style={styles.serviceDesc}>Send parcels</Text>
          </TouchableOpacity>
        </View>

        {/* 4. Stylized Nearby Cabs Live Visual Map Card */}
        <TouchableOpacity
          style={styles.mapCard}
          onPress={() => handleOpenBooking()}
          activeOpacity={0.9}
        >
          <View style={styles.mapBgPattern}>
            <View style={styles.mapRoadH} />
            <View style={styles.mapRoadV} />
            <View style={styles.cabPin1}>
              <Ionicons name="car" size={16} color={COLORS.white} />
            </View>
            <View style={styles.cabPin2}>
              <Ionicons name="car" size={16} color={COLORS.white} />
            </View>
            <View style={styles.cabPin3}>
              <Ionicons name="car" size={16} color={COLORS.white} />
            </View>
            {/* User Pulsing Location Pin */}
            <View style={styles.userPin}>
              <View style={styles.userPinPulse}>
                <View style={styles.userPinCore} />
              </View>
            </View>
          </View>

          {/* Bottom Live Pill */}
          <View style={styles.mapLivePill}>
            <View style={styles.mapLiveLeft}>
              <View style={styles.mapLiveDot} />
              <Text style={styles.mapLiveText}>5 cabs nearby • Pickup in 3 mins</Text>
            </View>
            <Text style={styles.mapActionText}>Book Now →</Text>
          </View>
        </TouchableOpacity>

        {/* 5. Wallet Quick Balance Bar */}
        <TouchableOpacity
          style={styles.walletMiniBar}
          onPress={() => router.push('/(app)/wallet')}
          activeOpacity={0.7}
        >
          <View style={styles.walletMiniLeft}>
            <View style={styles.walletIconBox}>
              <Ionicons name="wallet" size={20} color="#D97706" />
            </View>
            <View>
              <Text style={styles.walletMiniTitle}>Cab Wallet Balance</Text>
              <Text style={styles.walletMiniAmount}>
                ₹{((wallet?.balancePaise ?? 125000) / 100).toFixed(0)}
              </Text>
            </View>
          </View>

          <View style={styles.walletMiniAction}>
            <Text style={styles.walletMiniActionText}>+ Top Up</Text>
            <Ionicons name="chevron-forward" size={16} color={COLORS.primary} />
          </View>
        </TouchableOpacity>

        {/* 6. Promotional Offer Banner */}
        <TouchableOpacity
          style={styles.promoCard}
          onPress={() => handleOpenBooking()}
          activeOpacity={0.8}
        >
          <View style={styles.promoIconBox}>
            <Ionicons name="pricetag" size={24} color={COLORS.primary} />
          </View>
          <View style={styles.promoContent}>
            <Text style={styles.promoTitle}>Flat ₹50 OFF on your next 3 rides!</Text>
            <Text style={styles.promoDesc}>Use coupon code FIRST50 at checkout</Text>
          </View>
          <Ionicons name="chevron-forward" size={18} color="#3B82F6" />
        </TouchableOpacity>

        {/* 7. Safety Toolkit Card */}
        <TouchableOpacity
          style={styles.safetyCard}
          onPress={() => router.push('/(app)/contacts' as any)}
          activeOpacity={0.8}
        >
          <View style={styles.safetyIconBox}>
            <Ionicons name="shield-checkmark" size={22} color="#15803D" />
          </View>
          <View style={styles.safetyContent}>
            <Text style={styles.safetyTitle}>Your Safety Matters</Text>
            <Text style={styles.safetyDesc}>
              24/7 SOS alert & automatic trip sharing with trusted contacts
            </Text>
          </View>
          <Ionicons name="chevron-forward" size={18} color="#15803D" />
        </TouchableOpacity>
      </ScrollView>

      {/* Uber/Ola Ride Booking Bottom Sheet Modal */}
      <RideBookingModal
        visible={bookingModalVisible}
        onClose={() => setBookingModalVisible(false)}
        initialDestination={selectedDestination}
        initialServiceId={selectedServiceId}
        walletBalancePaise={wallet?.balancePaise ?? 125000}
      />
    </SafeAreaView>
  );
}
