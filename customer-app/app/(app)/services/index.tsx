import React, { useState } from "react";
import {
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { SafeAreaView } from "react-native-safe-area-context";
import { Header } from "../../../src/components/common/Header";
import { RideBookingModal } from "../../../src/components/home/RideBookingModal";
import { COLORS, RADIUS, SPACING } from "../../../src/constants/colors";

interface ServiceItem {
  id: string;
  title: string;
  description: string;
  icon: keyof typeof Ionicons.glyphMap;
  serviceId: string;
  badge?: string;
  badgeColor?: string;
  iconBg: string;
  iconColor: string;
}

const RIDE_SERVICES: ServiceItem[] = [
  {
    id: "daily_cab",
    title: "Daily Cab",
    description: "Affordable rides, everyday compact & sedan",
    icon: "car-sport",
    serviceId: "cab_go",
    badge: "POPULAR",
    badgeColor: "#10B981",
    iconBg: "#EFF6FF",
    iconColor: COLORS.primary,
  },
  {
    id: "auto",
    title: "Auto Rickshaw",
    description: "Quick & affordable doorstep auto rides",
    icon: "bicycle",
    serviceId: "cab_auto",
    badge: "METERED",
    badgeColor: "#F59E0B",
    iconBg: "#FEF3C7",
    iconColor: "#D97706",
  },
  {
    id: "moto",
    title: "Moto Bike",
    description: "Beat traffic fast on two wheels",
    icon: "flash",
    serviceId: "cab_moto",
    badge: "FASTEST",
    badgeColor: "#059669",
    iconBg: "#ECFDF5",
    iconColor: "#059669",
  },
  {
    id: "intercity",
    title: "Intercity Outstation",
    description: "Comfortable one-way and round trips",
    icon: "navigate",
    serviceId: "cab_premier",
    iconBg: "#F5F3FF",
    iconColor: "#7C3AED",
  },
  {
    id: "rentals",
    title: "Hourly Rentals",
    description: "Cab and driver stay with you by the hour",
    icon: "time",
    serviceId: "cab_rentals",
    iconBg: "#FDF2F8",
    iconColor: "#DB2777",
  },
];

const DELIVERY_SERVICES: ServiceItem[] = [
  {
    id: "package",
    title: "Send a Package",
    description: "Same-day on-demand item delivery across town",
    icon: "cube",
    serviceId: "cab_go",
    iconBg: "#F1F5F9",
    iconColor: COLORS.text,
  },
];

export default function ServicesScreen() {
  const [bookingModalVisible, setBookingModalVisible] = useState(false);
  const [selectedServiceId, setSelectedServiceId] = useState("cab_go");

  const handleOpenBooking = (serviceId: string) => {
    setSelectedServiceId(serviceId);
    setBookingModalVisible(true);
  };

  return (
    <SafeAreaView style={styles.container}>
      <Header title="Services" showBack={false} />

      <ScrollView
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {/* Section 1: Go Anywhere */}
        <Text style={styles.sectionHeading}>Go Anywhere</Text>
        <View style={styles.cardsList}>
          {RIDE_SERVICES.map((item) => (
            <TouchableOpacity
              key={item.id}
              style={styles.serviceCard}
              onPress={() => handleOpenBooking(item.serviceId)}
              activeOpacity={0.7}
            >
              <View style={[styles.iconBox, { backgroundColor: item.iconBg }]}>
                <Ionicons name={item.icon} size={26} color={item.iconColor} />
              </View>

              <View style={styles.cardContent}>
                <View style={styles.cardHeaderRow}>
                  <Text style={styles.cardTitle}>{item.title}</Text>
                  {item.badge && (
                    <View
                      style={[
                        styles.badgePill,
                        { backgroundColor: item.badgeColor ?? COLORS.primary },
                      ]}
                    >
                      <Text style={styles.badgeText}>{item.badge}</Text>
                    </View>
                  )}
                </View>
                <Text style={styles.cardDesc} numberOfLines={2}>
                  {item.description}
                </Text>
              </View>

              <Ionicons
                name="chevron-forward"
                size={18}
                color={COLORS.textSecondary}
              />
            </TouchableOpacity>
          ))}
        </View>

        {/* Section 2: Delivery & Express */}
        <Text style={[styles.sectionHeading, { marginTop: SPACING.xl }]}>
          Get Anything Delivered
        </Text>
        <View style={styles.cardsList}>
          {DELIVERY_SERVICES.map((item) => (
            <TouchableOpacity
              key={item.id}
              style={styles.serviceCard}
              onPress={() => handleOpenBooking(item.serviceId)}
              activeOpacity={0.7}
            >
              <View style={[styles.iconBox, { backgroundColor: item.iconBg }]}>
                <Ionicons name={item.icon} size={26} color={item.iconColor} />
              </View>

              <View style={styles.cardContent}>
                <Text style={styles.cardTitle}>{item.title}</Text>
                <Text style={styles.cardDesc}>{item.description}</Text>
              </View>

              <Ionicons
                name="chevron-forward"
                size={18}
                color={COLORS.textSecondary}
              />
            </TouchableOpacity>
          ))}
        </View>
      </ScrollView>

      {/* Ride Booking Bottom Sheet Modal */}
      <RideBookingModal
        visible={bookingModalVisible}
        onClose={() => setBookingModalVisible(false)}
        initialServiceId={selectedServiceId}
        walletBalancePaise={125000}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#F8FAFC",
  },
  scrollContent: {
    paddingHorizontal: SPACING.lg,
    paddingTop: SPACING.md,
    paddingBottom: 110,
  },
  sectionHeading: {
    fontSize: 18,
    fontWeight: "800",
    color: COLORS.text,
    marginBottom: SPACING.sm + 2,
  },
  cardsList: {
    gap: SPACING.sm + 2,
  },
  serviceCard: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: COLORS.surface,
    padding: SPACING.md,
    borderRadius: RADIUS.lg,
    borderWidth: 1,
    borderColor: "#E2E8F0",
    gap: SPACING.md,
  },
  iconBox: {
    width: 48,
    height: 48,
    borderRadius: RADIUS.md,
    alignItems: "center",
    justifyContent: "center",
  },
  cardContent: {
    flex: 1,
  },
  cardHeaderRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: SPACING.xs + 2,
    marginBottom: 2,
  },
  cardTitle: {
    fontSize: 15,
    fontWeight: "700",
    color: COLORS.text,
  },
  cardDesc: {
    fontSize: 12,
    color: COLORS.textSecondary,
    marginTop: 2,
  },
  badgePill: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: RADIUS.full,
  },
  badgeText: {
    color: COLORS.white,
    fontSize: 9,
    fontWeight: "800",
  },
});
