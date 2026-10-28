import React, { useState } from "react";
import {
  Alert,
  Modal,
  ScrollView,
  Text,
  TouchableOpacity,
  TouchableWithoutFeedback,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { SafeAreaView } from "react-native-safe-area-context";
import { AppButton } from "../../../src/components/common/AppButton";
import { Header } from "../../../src/components/common/Header";
import { COLORS } from "../../../src/constants/colors";
import { styles } from "../../../src/styles/rewards.styles";

export type PartnerCategory = "ALL" | "FOOD" | "TRAVEL" | "SHOPPING";

export type PartnerReward = {
  id: string;
  brandName: string;
  brandIcon: keyof typeof Ionicons.glyphMap;
  brandColor: string;
  brandBg: string;
  category: PartnerCategory;
  title: string;
  description: string;
  pointsCost: number;
  voucherCode: string;
  expiresIn: string;
  claimed?: boolean;
};

const INITIAL_REWARDS: PartnerReward[] = [
  {
    id: "rew_1",
    brandName: "Starbucks Coffee",
    brandIcon: "cafe",
    brandColor: "#059669",
    brandBg: "#ECFDF5",
    category: "FOOD",
    title: "Free Beverage Upgrade",
    description:
      "Complimentary size upgrade on all handcrafted espresso drinks.",
    pointsCost: 350,
    voucherCode: "STARBUCKS-CAB",
    expiresIn: "Valid till 30 Nov",
  },
  {
    id: "rew_2",
    brandName: "Zomato Dining",
    brandIcon: "restaurant",
    brandColor: "#E11D48",
    brandBg: "#FFF1F2",
    category: "FOOD",
    title: "Flat ₹150 OFF",
    description:
      "Get ₹150 OFF on dining bills above ₹750 at partner restaurants.",
    pointsCost: 500,
    voucherCode: "CABZOMATO150",
    expiresIn: "Valid till 15 Nov",
  },
  {
    id: "rew_3",
    brandName: "MakeMyTrip Flights",
    brandIcon: "airplane",
    brandColor: "#2563EB",
    brandBg: "#EFF6FF",
    category: "TRAVEL",
    title: "₹600 Domestic Flight OFF",
    description:
      "Instant discount on domestic flight bookings across all major airlines.",
    pointsCost: 1200,
    voucherCode: "MMTRIP-CAB600",
    expiresIn: "Valid till 31 Dec",
  },
  {
    id: "rew_4",
    brandName: "Indian Oil / Fuel",
    brandIcon: "speedometer",
    brandColor: "#D97706",
    brandBg: "#FEF3C7",
    category: "TRAVEL",
    title: "₹50 Fuel Cashback",
    description:
      "Receive ₹50 cashback at Indian Oil stations on minimum ₹500 fuel.",
    pointsCost: 200,
    voucherCode: "IOCL-RIDER50",
    expiresIn: "Valid till 10 Dec",
  },
  {
    id: "rew_5",
    brandName: "Myntra Fashion",
    brandIcon: "shirt",
    brandColor: "#7C3AED",
    brandBg: "#F5F3FF",
    category: "SHOPPING",
    title: "15% Extra OFF",
    description: "Get extra 15% discount on top fashion brands above ₹1,999.",
    pointsCost: 400,
    voucherCode: "MYNTRA-CAB15",
    expiresIn: "Valid till 25 Nov",
  },
];

export default function RewardsScreen() {
  const [points, setPoints] = useState(2450);
  const [rewards, setRewards] = useState<PartnerReward[]>(INITIAL_REWARDS);
  const [selectedCategory, setSelectedCategory] =
    useState<PartnerCategory>("ALL");
  const [activeVoucher, setActiveVoucher] = useState<PartnerReward | null>(
    null
  );

  // Filter rewards by category
  const filteredRewards = rewards.filter((r) =>
    selectedCategory === "ALL" ? true : r.category === selectedCategory
  );

  // Claim voucher handler
  const handleClaim = (reward: PartnerReward) => {
    if (reward.claimed) {
      setActiveVoucher(reward);
      return;
    }

    if (points < reward.pointsCost) {
      Alert.alert(
        "Insufficient Points",
        `You need ${reward.pointsCost} points to claim this offer. Complete more rides to earn points!`
      );
      return;
    }

    // Deduct points and mark claimed
    setPoints((prev) => prev - reward.pointsCost);
    setRewards((prev) =>
      prev.map((r) => (r.id === reward.id ? { ...r, claimed: true } : r))
    );
    setActiveVoucher({ ...reward, claimed: true });
  };

  return (
    <SafeAreaView style={styles.container}>
      <Header title="Partner Rewards" showBack />

      <ScrollView
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {/* Points Hero Banner */}
        <View style={styles.heroCard}>
          <View style={styles.heroTopRow}>
            <Text style={styles.heroLabel}>Your Partner Balance</Text>
            <View style={styles.heroBadge}>
              <Text style={styles.heroBadgeText}>GOLD TIER</Text>
            </View>
          </View>

          <View style={styles.pointsRow}>
            <Text style={styles.pointsValue}>{points.toLocaleString()}</Text>
            <Text style={styles.pointsUnit}>Points</Text>
          </View>

          <Text style={styles.heroDesc}>
            Earn 10 points for every ₹100 spent on rides. Redeem for exclusive
            brand partner perks!
          </Text>
        </View>

        {/* Category Horizontal Filter */}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={styles.categoryScroll}
        >
          <TouchableOpacity
            style={[
              styles.categoryChip,
              selectedCategory === "ALL" && styles.categoryChipActive,
            ]}
            onPress={() => setSelectedCategory("ALL")}
          >
            <Text
              style={[
                styles.categoryChipText,
                selectedCategory === "ALL" && styles.categoryChipTextActive,
              ]}
            >
              All Perks
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[
              styles.categoryChip,
              selectedCategory === "FOOD" && styles.categoryChipActive,
            ]}
            onPress={() => setSelectedCategory("FOOD")}
          >
            <Text
              style={[
                styles.categoryChipText,
                selectedCategory === "FOOD" && styles.categoryChipTextActive,
              ]}
            >
              Food & Dining
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[
              styles.categoryChip,
              selectedCategory === "TRAVEL" && styles.categoryChipActive,
            ]}
            onPress={() => setSelectedCategory("TRAVEL")}
          >
            <Text
              style={[
                styles.categoryChipText,
                selectedCategory === "TRAVEL" && styles.categoryChipTextActive,
              ]}
            >
              Travel & Fuel
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[
              styles.categoryChip,
              selectedCategory === "SHOPPING" && styles.categoryChipActive,
            ]}
            onPress={() => setSelectedCategory("SHOPPING")}
          >
            <Text
              style={[
                styles.categoryChipText,
                selectedCategory === "SHOPPING" &&
                  styles.categoryChipTextActive,
              ]}
            >
              Shopping
            </Text>
          </TouchableOpacity>
        </ScrollView>

        {/* Rewards Section */}
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>Exclusive Partner Deals</Text>
        </View>

        {filteredRewards.map((reward) => (
          <View key={reward.id} style={styles.rewardCard}>
            <View style={styles.rewardHeader}>
              <View
                style={[
                  styles.brandIconBox,
                  { backgroundColor: reward.brandBg },
                ]}
              >
                <Ionicons
                  name={reward.brandIcon}
                  size={22}
                  color={reward.brandColor}
                />
              </View>
              <View style={styles.brandInfo}>
                <Text style={styles.brandName}>{reward.brandName}</Text>
                <Text style={styles.offerTitle}>{reward.title}</Text>
              </View>
              <View style={styles.pointsTag}>
                <Ionicons name="sparkles" size={11} color="#D97706" />
                <Text style={styles.pointsTagText}>
                  {reward.pointsCost} pts
                </Text>
              </View>
            </View>

            <Text style={styles.rewardDesc}>{reward.description}</Text>

            <View style={styles.cardFooter}>
              <Text style={styles.expiryText}>{reward.expiresIn}</Text>
              <TouchableOpacity
                style={[
                  styles.claimBtn,
                  reward.claimed && styles.claimBtnClaimed,
                ]}
                onPress={() => handleClaim(reward)}
                activeOpacity={0.7}
              >
                <Text
                  style={[
                    styles.claimBtnText,
                    reward.claimed && styles.claimBtnTextClaimed,
                  ]}
                >
                  {reward.claimed ? "View Voucher ✓" : "Claim Perk"}
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        ))}
      </ScrollView>

      {/* Voucher Code Details Modal */}
      {activeVoucher && (
        <Modal
          visible
          transparent
          animationType="slide"
          onRequestClose={() => setActiveVoucher(null)}
        >
          <TouchableWithoutFeedback onPress={() => setActiveVoucher(null)}>
            <View style={styles.modalOverlay}>
              <TouchableWithoutFeedback onPress={() => {}}>
                <View style={styles.modalContent}>
                  <View style={styles.modalHeader}>
                    <Text style={styles.modalTitle}>
                      {activeVoucher.brandName} Voucher
                    </Text>
                    <TouchableOpacity onPress={() => setActiveVoucher(null)}>
                      <Ionicons
                        name="close"
                        size={24}
                        color={COLORS.textSecondary}
                      />
                    </TouchableOpacity>
                  </View>

                  <View style={styles.voucherBox}>
                    <Text style={styles.voucherCode}>
                      {activeVoucher.voucherCode}
                    </Text>
                    <Text style={styles.voucherSub}>
                      {activeVoucher.expiresIn}
                    </Text>
                  </View>

                  <Text style={styles.instructionText}>
                    Use this exclusive coupon code at {activeVoucher.brandName}
                    's app or checkout page to enjoy your discount.
                  </Text>

                  <AppButton
                    title="Done"
                    onPress={() => setActiveVoucher(null)}
                  />
                </View>
              </TouchableWithoutFeedback>
            </View>
          </TouchableWithoutFeedback>
        </Modal>
      )}
    </SafeAreaView>
  );
}
