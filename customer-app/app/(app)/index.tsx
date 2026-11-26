import React, { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  RefreshControl,
  ScrollView,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { router, useFocusEffect } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { HomeMap } from "../../src/components/home/HomeMap";
import { PinAdjusterModal } from "../../src/components/home/PinAdjusterModal";
import { RideBookingModal } from "../../src/components/home/RideBookingModal";
import { ServiceCategories } from "../../src/components/home/ServiceCategories";
import { ZoneStatusBanner } from "../../src/components/home/ZoneStatusBanner";
import { COLORS } from "../../src/constants/colors";
import { useAuth } from "../../src/context/AuthContext";
import { useNotifications } from "../../src/context/NotificationContext";
import {
  useZoneStatus,
  type ZoneStatusState,
} from "../../src/hooks/useZoneStatus";
import { PaymentService } from "../../src/services/payment.service";
import { styles } from "../../src/styles/home.styles";
import type {
  LocationPoint,
  TripMode,
} from "../../src/types/location.types";
import type {
  CustomerBalance,
  WalletView,
} from "../../src/types/payment.types";

function getLocationPillMeta(zone: ZoneStatusState): {
  label: string;
  dotStyle: object;
  needsRetryOnPress: boolean;
} {
  if (zone.locationStatus === "DETECTING") {
    return {
      label: "Detecting location...",
      dotStyle: styles.locationDotNeutral,
      needsRetryOnPress: false,
    };
  }
  if (zone.locationStatus === "PERMISSION_DENIED") {
    return {
      label: "Location permission needed",
      dotStyle: styles.locationDotError,
      needsRetryOnPress: true,
    };
  }
  if (zone.locationStatus === "GPS_UNAVAILABLE") {
    return {
      label: "Turn on GPS",
      dotStyle: styles.locationDotError,
      needsRetryOnPress: true,
    };
  }
  if (zone.locationStatus === "CHECK_FAILED") {
    return {
      label: "Tap to retry location",
      dotStyle: styles.locationDotWarning,
      needsRetryOnPress: true,
    };
  }

  const pickup = zone.serviceability?.pickup;
  if (pickup?.serviceable) {
    return {
      label: pickup.zoneName,
      dotStyle: styles.locationDotSuccess,
      needsRetryOnPress: false,
    };
  }
  if (pickup && !pickup.serviceable && pickup.reason === "OUTSIDE_OPERATING_HOURS") {
    return {
      label: "Service closed right now",
      dotStyle: styles.locationDotWarning,
      needsRetryOnPress: false,
    };
  }
  return {
    label: "Outside service area",
    dotStyle: styles.locationDotError,
    needsRetryOnPress: false,
  };
}

export default function HomeScreen() {
  const { user } = useAuth();
  const { unreadCount, refreshUnreadCount } = useNotifications();
  const zone = useZoneStatus();
  const [wallet, setWallet] = useState<WalletView | null>(null);
  const [balance, setBalance] = useState<CustomerBalance | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  // Booking Modal State
  const [bookingModalVisible, setBookingModalVisible] = useState(false);
  const [selectedServiceId, setSelectedServiceId] = useState("MINI");
  const [selectedTripMode, setSelectedTripMode] = useState<TripMode>("CITY");
  const [autoOpenSearchField, setAutoOpenSearchField] = useState<
    "pickup" | "drop" | null
  >(null);
  const [homePinModalVisible, setHomePinModalVisible] = useState(false);
  const [customPickup, setCustomPickup] = useState<LocationPoint | null>(null);

  const loadData = useCallback(async () => {
    try {
      const [walletData, balanceData] = await Promise.allSettled([
        PaymentService.getWallet(5),
        PaymentService.getBalance(),
      ]);

      if (walletData.status === "fulfilled") {
        setWallet(walletData.value);
      }
      if (balanceData.status === "fulfilled") {
        setBalance(balanceData.value);
      }
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Re-check unread notifications whenever the home screen comes into focus
  useFocusEffect(
    useCallback(() => {
      refreshUnreadCount();
    }, [refreshUnreadCount]),
  );

  const onRefresh = async () => {
    setRefreshing(true);
    setCustomPickup(null);
    await Promise.allSettled([
      loadData(),
      refreshUnreadCount(),
      zone.refreshZone(),
    ]);
    setRefreshing(false);
  };

  const handleOpenBooking = (
    serviceId = "MINI",
    tripMode: TripMode = "CITY",
    openSearchFor: "pickup" | "drop" | null = null,
  ) => {
    setSelectedServiceId(serviceId);
    setSelectedTripMode(tripMode);
    setAutoOpenSearchField(openSearchFor);
    setBookingModalVisible(true);
  };

  const gpsPickup: LocationPoint | null = zone.coords
    ? {
        ...zone.coords,
        label:
          zone.resolvedAddress ||
          (zone.serviceability?.pickup.serviceable
            ? `Current Location (${zone.serviceability.pickup.zoneName})`
            : "Current Location"),
        ...(zone.resolvedAddress ? { address: zone.resolvedAddress } : {}),
      }
    : null;

  const initialPickup: LocationPoint | null = customPickup ?? gpsPickup;

  const outstandingPaise =
    balance?.outstandingBalancePaise ?? balance?.unpaidPaise ?? 0;
  const pillMeta = getLocationPillMeta(zone);

  return (
    <SafeAreaView style={styles.container}>
      {/* Top Header Bar */}
      <View style={styles.header}>
        <View style={styles.topRow}>
          {/* Detected Current Location / Zone Pill */}
          <TouchableOpacity
            style={styles.locationPill}
            onPress={() => {
              if (pillMeta.needsRetryOnPress) {
                zone.refreshZone();
              } else {
                handleOpenBooking();
              }
            }}
            activeOpacity={0.7}
          >
            {zone.locationStatus === "DETECTING" ? (
              <ActivityIndicator size="small" color={COLORS.primary} />
            ) : (
              <View style={[styles.locationDot, pillMeta.dotStyle]} />
            )}
            <Text style={styles.locationText} numberOfLines={1}>
              {pillMeta.label}
            </Text>
            <Ionicons
              name={pillMeta.needsRetryOnPress ? "refresh" : "chevron-down"}
              size={14}
              color={COLORS.textSecondary}
            />
          </TouchableOpacity>

          {/* Top Actions: Notifications, Profile */}
          <View style={styles.topActions}>
            <TouchableOpacity
              style={styles.iconButton}
              onPress={() => router.push("/(app)/notifications")}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              accessibilityRole="button"
              accessibilityLabel={`Notifications, ${unreadCount} unread`}
            >
              <Ionicons
                name={unreadCount > 0 ? "notifications" : "notifications-outline"}
                size={20}
                color={unreadCount > 0 ? COLORS.primary : COLORS.text}
              />
              {unreadCount > 0 && (
                <View style={styles.notificationBadge}>
                  <Text style={styles.notificationBadgeText}>
                    {unreadCount > 9 ? "9+" : unreadCount}
                  </Text>
                </View>
              )}
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.avatarPill}
              onPress={() => router.push("/(app)/profile")}
              activeOpacity={0.8}
            >
              <Text style={styles.avatarText}>
                {user?.name ? user.name[0].toUpperCase() : "U"}
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>

      <ScrollView
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            colors={[COLORS.primary]}
          />
        }
      >
        {/* 1. "Where to?" Search Box */}
        <View style={styles.searchSection}>
          <TouchableOpacity
            style={styles.searchBar}
            onPress={() =>
              handleOpenBooking("MINI", "CITY", initialPickup ? "drop" : "pickup")
            }
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

        {/* 2. Live Home Map (M06) */}
        <HomeMap
          userCoords={zone.coords}
          resolvedAddress={customPickup?.label ?? zone.resolvedAddress}
          locationStatus={zone.locationStatus}
          pickupPoint={initialPickup}
          onRefreshLocation={() => {
            setCustomPickup(null);
            zone.refreshZone();
          }}
          onPressAdjustPin={() => setHomePinModalVisible(true)}
          onPressSetDestination={() =>
            handleOpenBooking("MINI", "CITY", initialPickup ? "drop" : "pickup")
          }
        />

        {/* 3. Zone Serviceability / Location Status Banner */}
        <ZoneStatusBanner zone={zone} />

        {/* 4. Outstanding Dues Banner (Only displays if customer has dues) */}
        {outstandingPaise > 0 && (
          <TouchableOpacity
            style={styles.alertCard}
            onPress={() => router.push("/(app)/wallet")}
            activeOpacity={0.8}
          >
            <Ionicons name="alert-circle" size={22} color={COLORS.error} />
            <View style={{ flex: 1 }}>
              <Text style={styles.alertTitle}>Pending Ride Dues</Text>
              <Text style={styles.alertDesc}>
                You have an outstanding balance of ₹
                {(outstandingPaise / 100).toFixed(2)}.
              </Text>
            </View>
            <Ionicons name="chevron-forward" size={16} color={COLORS.error} />
          </TouchableOpacity>
        )}

        {/* 5. Circular Services Categories */}
        <ServiceCategories
          title="Explore"
          onSelectCategory={(serviceId, title) => {
            if (title === "Intercity") {
              handleOpenBooking("SEDAN", "OUTSTATION");
            } else {
              handleOpenBooking(serviceId, "CITY");
            }
          }}
        />
      </ScrollView>

      {/* Ride Booking Bottom Sheet Modal */}
      <RideBookingModal
        visible={bookingModalVisible}
        onClose={() => {
          setBookingModalVisible(false);
          setAutoOpenSearchField(null);
        }}
        initialServiceId={selectedServiceId}
        currentCoords={zone.coords}
        initialPickup={initialPickup}
        initialZoneServiceability={zone.serviceability}
        initialTripMode={selectedTripMode}
        autoOpenSearchField={autoOpenSearchField}
        walletBalancePaise={wallet?.balancePaise ?? 125000}
      />

      {/* Direct Home Pickup Pin Adjuster */}
      <PinAdjusterModal
        visible={homePinModalVisible}
        field="pickup"
        initialCoords={customPickup ?? zone.coords}
        onConfirm={(_field, point) => setCustomPickup(point)}
        onClose={() => setHomePinModalVisible(false)}
      />
    </SafeAreaView>
  );
}
