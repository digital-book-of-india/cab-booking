import React, { useCallback, useEffect, useState } from "react";
import {
  RefreshControl,
  ScrollView,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { RideBookingModal } from "../../src/components/home/RideBookingModal";
import { ServiceCategories } from "../../src/components/home/ServiceCategories";
import { COLORS } from "../../src/constants/colors";
import { useAuth } from "../../src/context/AuthContext";
import { PaymentService } from "../../src/services/payment.service";
import { styles } from "../../src/styles/home.styles";
import type {
  CustomerBalance,
  WalletView,
} from "../../src/types/payment.types";

export default function HomeScreen() {
  const { user } = useAuth();
  const [wallet, setWallet] = useState<WalletView | null>(null);
  const [balance, setBalance] = useState<CustomerBalance | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  // Booking Modal State
  const [bookingModalVisible, setBookingModalVisible] = useState(false);
  const [selectedDestination, setSelectedDestination] = useState("");
  const [selectedServiceId, setSelectedServiceId] = useState("cab_go");

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

  const onRefresh = async () => {
    setRefreshing(true);
    await loadData();
    setRefreshing(false);
  };

  const handleOpenBooking = (destination = "", serviceId = "cab_go") => {
    setSelectedDestination(destination);
    setSelectedServiceId(serviceId);
    setBookingModalVisible(true);
  };

  const outstandingPaise =
    balance?.outstandingBalancePaise ?? balance?.unpaidPaise ?? 0;

  return (
    <SafeAreaView style={styles.container}>
      {/* Top Header Bar */}
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
            <Ionicons
              name="chevron-down"
              size={14}
              color={COLORS.textSecondary}
            />
          </TouchableOpacity>

          {/* Top Actions: SOS, Notifications, Profile */}
          <View style={styles.topActions}>
            <TouchableOpacity
              style={styles.iconButton}
              onPress={() => router.push("/(app)/contacts" as any)}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <Ionicons name="shield-checkmark" size={20} color="#DC2626" />
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.iconButton}
              onPress={() => router.push("/(app)/notifications")}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <Ionicons
                name="notifications-outline"
                size={20}
                color={COLORS.text}
              />
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

        {/* 2. Outstanding Dues Banner (Only displays if customer has dues) */}
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

        {/* 3. 6-Item Circular Services Categories ("For you ›") */}
        <ServiceCategories
          title="Explore"
          onSelectCategory={(serviceId, title) => {
            if (title === "Parcel") {
              handleOpenBooking("Courier Delivery", "cab_go");
            } else {
              handleOpenBooking("", serviceId);
            }
          }}
        />
      </ScrollView>

      {/* Ride Booking Bottom Sheet Modal */}
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
