import React, { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Modal,
  ScrollView,
  Text,
  TouchableOpacity,
  TouchableWithoutFeedback,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { AppButton } from "../../../src/components/common/AppButton";
import { Header } from "../../../src/components/common/Header";
import { EditProfileModal } from "../../../src/components/profile/EditProfileModal";
import { COLORS } from "../../../src/constants/colors";
import { useAuth } from "../../../src/context/AuthContext";
import { apiRequest } from "../../../src/services/api";
import { CustomerService } from "../../../src/services/customer.service";
import { styles } from "../../../src/styles/profile.styles";
import type { CustomerProfile } from "../../../src/types/customer.types";

export type DynamicOffer = {
  id: string;
  code: string;
  description: string;
  discountPaise?: number;
  percentage?: number;
  expiresAt?: string;
};

export default function ProfileScreen() {
  const { user, logout } = useAuth();
  const [profile, setProfile] = useState<CustomerProfile | null>(null);

  // Modal States
  const [isEditModalVisible, setIsEditModalVisible] = useState(false);
  const [isOffersModalVisible, setIsOffersModalVisible] = useState(false);
  const [simpleModeActive, setSimpleModeActive] = useState(false);

  // Dynamic Offers State
  const [offers, setOffers] = useState<DynamicOffer[]>([]);
  const [loadingOffers, setLoadingOffers] = useState(false);

  // 1. Fetch user profile data
  const loadProfile = useCallback(async () => {
    try {
      const p = await CustomerService.getProfile();
      setProfile(p);
    } catch {
      // Fallback handled via AuthContext user
    }
  }, []);

  // 2. Fetch dynamic active offers from API
  const fetchActiveOffers = async () => {
    setIsOffersModalVisible(true);
    setLoadingOffers(true);
    try {
      const response = await apiRequest<
        DynamicOffer[] | { items: DynamicOffer[] }
      >("coupons/active");
      if (Array.isArray(response)) {
        setOffers(response);
      } else if (
        response &&
        "items" in response &&
        Array.isArray(response.items)
      ) {
        setOffers(response.items);
      } else {
        setOffers([]);
      }
    } catch {
      setOffers([]);
    } finally {
      setLoadingOffers(false);
    }
  };

  useEffect(() => {
    loadProfile();
  }, [loadProfile, user]);

  const handleLogout = () => {
    Alert.alert(
      "Sign Out",
      "Are you sure you want to log out of your account?",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Log Out",
          style: "destructive",
          onPress: async () => {
            await logout();
            router.replace("/(auth)/login");
          },
        },
      ]
    );
  };

  // Simple Mode toggle handler
  const handleToggleSimpleMode = () => {
    const nextState = !simpleModeActive;
    setSimpleModeActive(nextState);
    Alert.alert(
      nextState ? "Simple Mode Enabled" : "Simple Mode Disabled",
      nextState
        ? "Simple mode provides larger text, high-contrast buttons, and an easy booking flow for older adults."
        : "Restored standard app view."
    );
  };

  const displayName = user?.name || profile?.name || "Customer";
  const displayPhone = user?.phone || profile?.phone || "";

  return (
    <SafeAreaView style={styles.container}>
      <Header title="Account" />

      <ScrollView
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {/* ========================================================
         * 1. Top Profile Header Card (User Icon on Left)
         * ======================================================== */}
        <View style={styles.profileHeaderCard}>
          {/* Left Avatar Icon with Edit Badge */}
          <TouchableOpacity
            style={styles.avatarContainer}
            onPress={() => setIsEditModalVisible(true)}
            activeOpacity={0.7}
          >
            <View style={styles.avatarCircle}>
              <Ionicons name="person" size={28} color={COLORS.primary} />
            </View>
            <View style={styles.avatarEditBadge}>
              <Ionicons name="pencil" size={11} color={COLORS.white} />
            </View>
          </TouchableOpacity>

          {/* User Details */}
          <View style={styles.profileInfo}>
            <Text style={styles.userName} numberOfLines={1}>
              {displayName}
            </Text>
            {Boolean(displayPhone) && (
              <Text style={styles.userPhone}>{displayPhone}</Text>
            )}

            <View style={styles.userMetaRow}>
              <View style={styles.ratingBadge}>
                <Ionicons name="star" size={12} color="#D97706" />
                <Text style={styles.ratingText}>
                  {profile?.ratingAverage
                    ? profile.ratingAverage.toFixed(1)
                    : "4.9"}
                </Text>
              </View>
            </View>
          </View>

          {/* Right Chevron Button */}
          <TouchableOpacity
            style={styles.editArrowBtn}
            onPress={() => setIsEditModalVisible(true)}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          >
            <Ionicons
              name="chevron-forward"
              size={20}
              color={COLORS.textSecondary}
            />
          </TouchableOpacity>
        </View>

        {/* ========================================================
         * 2. 4 Quick Action Cards (Help, Wallet, Safety, Offers)
         * ======================================================== */}
        <View style={styles.quickActionsGrid}>
          {/* Help */}
          <TouchableOpacity
            style={styles.actionCard}
            onPress={() => router.navigate("/(app)/support" as any)}
            activeOpacity={0.7}
          >
            <View
              style={[styles.actionIconBox, { backgroundColor: "#EFF6FF" }]}
            >
              <Ionicons name="help-buoy" size={22} color="#2563EB" />
            </View>
            <Text style={styles.actionLabel}>Help</Text>
          </TouchableOpacity>

          {/* Wallet */}
          <TouchableOpacity
            style={styles.actionCard}
            onPress={() => router.navigate("/(app)/wallet" as any)}
            activeOpacity={0.7}
          >
            <View
              style={[styles.actionIconBox, { backgroundColor: "#FEF3C7" }]}
            >
              <Ionicons name="wallet" size={22} color="#D97706" />
            </View>
            <Text style={styles.actionLabel}>Wallet</Text>
          </TouchableOpacity>

          {/* Safety */}
          <TouchableOpacity
            style={styles.actionCard}
            onPress={() => router.navigate("/(app)/contacts" as any)}
            activeOpacity={0.7}
          >
            <View
              style={[styles.actionIconBox, { backgroundColor: "#F0FDF4" }]}
            >
              <Ionicons name="shield-checkmark" size={22} color="#16A34A" />
            </View>
            <Text style={styles.actionLabel}>Safety</Text>
          </TouchableOpacity>

          {/* Offers (Dynamic) */}
          <TouchableOpacity
            style={styles.actionCard}
            onPress={fetchActiveOffers}
            activeOpacity={0.7}
          >
            <View
              style={[styles.actionIconBox, { backgroundColor: "#FAF5FF" }]}
            >
              <Ionicons name="pricetag" size={22} color="#9333EA" />
            </View>
            <Text style={styles.actionLabel}>Offers</Text>
          </TouchableOpacity>
        </View>

        {/* ========================================================
         * 3. Account & Settings Section (8 Items, Clean & Consistent)
         * ======================================================== */}
        <View style={styles.sectionCard}>
          <Text style={styles.sectionTitle}>Account & Settings</Text>

          {/* 1. Family */}
          <TouchableOpacity
            style={styles.menuItem}
            onPress={() => router.navigate("/(app)/family" as any)}
            activeOpacity={0.7}
          >
            <View style={styles.menuItemLeft}>
              <View style={styles.menuIconCircle}>
                <Ionicons
                  name="people-outline"
                  size={20}
                  color={COLORS.primary}
                />
              </View>
              <View style={styles.menuItemTextContainer}>
                <Text style={styles.menuItemTitle}>Family</Text>
                <Text style={styles.menuItemSubtitle}>
                  Manage adult and senior accounts
                </Text>
              </View>
            </View>
            <Ionicons
              name="chevron-forward"
              size={18}
              color={COLORS.textSecondary}
            />
          </TouchableOpacity>

          {/* 2. Simple mode */}
          <TouchableOpacity
            style={styles.menuItem}
            onPress={handleToggleSimpleMode}
            activeOpacity={0.7}
          >
            <View style={styles.menuItemLeft}>
              <View style={styles.menuIconCircle}>
                <Ionicons
                  name="phone-portrait-outline"
                  size={20}
                  color={COLORS.primary}
                />
              </View>
              <View style={styles.menuItemTextContainer}>
                <Text style={styles.menuItemTitle}>Simple mode</Text>
                <Text style={styles.menuItemSubtitle}>
                  A simplified app for older adults
                </Text>
              </View>
            </View>
            <Ionicons
              name="chevron-forward"
              size={18}
              color={COLORS.textSecondary}
            />
          </TouchableOpacity>

          {/* 3. Contacts */}
          <TouchableOpacity
            style={styles.menuItem}
            onPress={() => router.navigate("/(app)/contacts" as any)}
            activeOpacity={0.7}
          >
            <View style={styles.menuItemLeft}>
              <View style={styles.menuIconCircle}>
                <Ionicons
                  name="book-outline"
                  size={20}
                  color={COLORS.primary}
                />
              </View>
              <View style={styles.menuItemTextContainer}>
                <Text style={styles.menuItemTitle}>Contacts</Text>
                <Text style={styles.menuItemSubtitle}>
                  Manage all your trusted ride contacts
                </Text>
              </View>
            </View>
            <Ionicons
              name="chevron-forward"
              size={18}
              color={COLORS.textSecondary}
            />
          </TouchableOpacity>

          {/* 4. Settings */}
          <TouchableOpacity
            style={styles.menuItem}
            onPress={() => router.navigate("/(app)/preferences" as any)}
            activeOpacity={0.7}
          >
            <View style={styles.menuItemLeft}>
              <View style={styles.menuIconCircle}>
                <Ionicons
                  name="settings-outline"
                  size={20}
                  color={COLORS.primary}
                />
              </View>
              <View style={styles.menuItemTextContainer}>
                <Text style={styles.menuItemTitle}>Settings</Text>
                <Text style={styles.menuItemSubtitle}>
                  Ride preferences, safety & privacy
                </Text>
              </View>
            </View>
            <Ionicons
              name="chevron-forward"
              size={18}
              color={COLORS.textSecondary}
            />
          </TouchableOpacity>

          {/* 5. Wallets */}
          <TouchableOpacity
            style={styles.menuItem}
            onPress={() => router.navigate("/(app)/wallet" as any)}
            activeOpacity={0.7}
          >
            <View style={styles.menuItemLeft}>
              <View style={styles.menuIconCircle}>
                <Ionicons
                  name="wallet-outline"
                  size={20}
                  color={COLORS.primary}
                />
              </View>
              <View style={styles.menuItemTextContainer}>
                <Text style={styles.menuItemTitle}>Wallets</Text>
                <Text style={styles.menuItemSubtitle}>
                  Payment methods, UPI, cards & credits
                </Text>
              </View>
            </View>
            <Ionicons
              name="chevron-forward"
              size={18}
              color={COLORS.textSecondary}
            />
          </TouchableOpacity>

          {/* 6. Partner Rewards */}
          <TouchableOpacity
            style={styles.menuItem}
            onPress={() => router.navigate("/(app)/rewards" as any)}
            activeOpacity={0.7}
          >
            <View style={styles.menuItemLeft}>
              <View style={styles.menuIconCircle}>
                <Ionicons
                  name="gift-outline"
                  size={20}
                  color={COLORS.primary}
                />
              </View>
              <View style={styles.menuItemTextContainer}>
                <Text style={styles.menuItemTitle}>Partner Rewards</Text>
                <Text style={styles.menuItemSubtitle}>
                  Rewards, coupons & perks
                </Text>
              </View>
            </View>
            <Ionicons
              name="chevron-forward"
              size={18}
              color={COLORS.textSecondary}
            />
          </TouchableOpacity>

          {/* 7. Manage Account */}
          <TouchableOpacity
            style={styles.menuItem}
            onPress={() => router.navigate("/(app)/sessions" as any)}
            activeOpacity={0.7}
          >
            <View style={styles.menuItemLeft}>
              <View style={styles.menuIconCircle}>
                <Ionicons
                  name="shield-checkmark-outline"
                  size={20}
                  color={COLORS.primary}
                />
              </View>
              <View style={styles.menuItemTextContainer}>
                <Text style={styles.menuItemTitle}>Manage Account</Text>
                <Text style={styles.menuItemSubtitle}>Manage your details</Text>
              </View>
            </View>
            <Ionicons
              name="chevron-forward"
              size={18}
              color={COLORS.textSecondary}
            />
          </TouchableOpacity>

          {/* 8. Log Out */}
          <TouchableOpacity
            style={[styles.menuItem, { borderBottomWidth: 0 }]}
            onPress={handleLogout}
            activeOpacity={0.7}
          >
            <View style={styles.menuItemLeft}>
              <View
                style={[styles.menuIconCircle, { backgroundColor: "#FEF2F2" }]}
              >
                <Ionicons
                  name="log-out-outline"
                  size={20}
                  color={COLORS.error}
                />
              </View>
              <View style={styles.menuItemTextContainer}>
                <Text style={[styles.menuItemTitle, { color: COLORS.error }]}>
                  Log Out
                </Text>
                <Text style={styles.menuItemSubtitle}>
                  Sign out of your account on this device
                </Text>
              </View>
            </View>
            <Ionicons name="chevron-forward" size={18} color={COLORS.error} />
          </TouchableOpacity>
        </View>
      </ScrollView>

      {/* ========================================================
       * 4. Edit Profile Modal (Name & Mobile Number)
       * ======================================================== */}
      <EditProfileModal
        visible={isEditModalVisible}
        onClose={() => setIsEditModalVisible(false)}
        currentName={displayName}
        currentPhone={displayPhone}
      />

      {/* ========================================================
       * 5. Dynamic Offers Modal
       * ======================================================== */}
      <Modal
        visible={isOffersModalVisible}
        animationType="slide"
        transparent
        onRequestClose={() => setIsOffersModalVisible(false)}
      >
        <TouchableWithoutFeedback
          onPress={() => setIsOffersModalVisible(false)}
        >
          <View style={styles.modalOverlay}>
            <TouchableWithoutFeedback onPress={() => {}}>
              <View style={styles.modalContent}>
                <View style={styles.modalHeader}>
                  <Text style={styles.modalTitle}>Available Offers</Text>
                  <TouchableOpacity
                    onPress={() => setIsOffersModalVisible(false)}
                    style={styles.modalCloseBtn}
                  >
                    <Ionicons
                      name="close"
                      size={24}
                      color={COLORS.textSecondary}
                    />
                  </TouchableOpacity>
                </View>

                {loadingOffers ? (
                  <ActivityIndicator
                    size="large"
                    color={COLORS.primary}
                    style={{ marginVertical: 32 }}
                  />
                ) : offers.length > 0 ? (
                  <ScrollView style={{ maxHeight: 320 }}>
                    {offers.map((offer) => (
                      <View
                        key={offer.id || offer.code}
                        style={styles.offerCard}
                      >
                        <View style={styles.offerIconBox}>
                          <Ionicons name="pricetag" size={20} color="#7E22CE" />
                        </View>
                        <View style={styles.offerInfo}>
                          <Text style={styles.offerCode}>{offer.code}</Text>
                          <Text style={styles.offerDesc}>
                            {offer.description}
                          </Text>
                        </View>
                      </View>
                    ))}
                  </ScrollView>
                ) : (
                  <Text style={styles.emptyOffersText}>
                    No promotions or discount offers available right now.
                  </Text>
                )}
              </View>
            </TouchableWithoutFeedback>
          </View>
        </TouchableWithoutFeedback>
      </Modal>
    </SafeAreaView>
  );
}
