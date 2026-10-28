import React, { useEffect, useState } from "react";
import {
  Alert,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  Text,
  TouchableOpacity,
  TouchableWithoutFeedback,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { SafeAreaView } from "react-native-safe-area-context";
import { AppButton } from "../../../src/components/common/AppButton";
import { AppInput } from "../../../src/components/common/AppInput";
import { Header } from "../../../src/components/common/Header";
import { COLORS } from "../../../src/constants/colors";
import { AppStorage } from "../../../src/services/storage";
import { styles } from "../../../src/styles/family.styles";

export type MemberRole = "SENIOR" | "TEEN" | "ADULT";
export type PaymentMethod = "WALLET" | "UPI" | "SAVED_CARD";

export type FamilyMember = {
  id: string;
  name: string;
  phone: string;
  role: MemberRole;
  paymentMethod: PaymentMethod;
  createdAt: string;
};

const STORAGE_KEY = "@customer_family_members";

// Default initial demo family members
const DEFAULT_MEMBERS: FamilyMember[] = [
  {
    id: "fam_1",
    name: "Dad",
    phone: "+91 9811122233",
    role: "SENIOR",
    paymentMethod: "WALLET",
    createdAt: new Date().toISOString(),
  },
  {
    id: "fam_2",
    name: "Aarav",
    phone: "+91 9822233344",
    role: "TEEN",
    paymentMethod: "WALLET",
    createdAt: new Date().toISOString(),
  },
];

export default function FamilyScreen() {
  const [members, setMembers] = useState<FamilyMember[]>([]);
  const [modalVisible, setModalVisible] = useState(false);

  // Form State
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [role, setRole] = useState<MemberRole>("SENIOR");
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>("WALLET");
  const [error, setError] = useState<string | null>(null);

  // Load members on startup
  useEffect(() => {
    async function loadMembers() {
      const stored = await AppStorage.getItem(STORAGE_KEY);
      if (stored) {
        try {
          setMembers(JSON.parse(stored));
          return;
        } catch {
          // ignore parsing error
        }
      }
      setMembers(DEFAULT_MEMBERS);
    }
    loadMembers();
  }, []);

  // Save members to persistent storage
  const persistMembers = async (updated: FamilyMember[]) => {
    setMembers(updated);
    await AppStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
  };

  // Add Member Handler
  const handleAddMember = async () => {
    const trimmedName = name.trim();
    const cleanPhone = phone.trim();

    if (!trimmedName) {
      setError("Please enter family member name");
      return;
    }
    const digits = cleanPhone.replace(/\D/g, "");
    if (digits.length < 10) {
      setError("Please enter a valid 10-digit phone number");
      return;
    }

    const newMember: FamilyMember = {
      id: `fam_${Date.now()}`,
      name: trimmedName,
      phone: cleanPhone.startsWith("+91") ? cleanPhone : `+91 ${cleanPhone}`,
      role,
      paymentMethod,
      createdAt: new Date().toISOString(),
    };

    const updated = [newMember, ...members];
    await persistMembers(updated);

    // Reset Form
    setName("");
    setPhone("");
    setRole("SENIOR");
    setPaymentMethod("WALLET");
    setError(null);
    setModalVisible(false);

    Alert.alert("Success", `${trimmedName} was added to your Family profile.`);
  };

  // Delete Member Handler
  const handleDeleteMember = (member: FamilyMember) => {
    Alert.alert(
      "Remove Member",
      `Are you sure you want to remove ${member.name} from your Family profile?`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Remove",
          style: "destructive",
          onPress: async () => {
            const updated = members.filter((m) => m.id !== member.id);
            await persistMembers(updated);
          },
        },
      ]
    );
  };

  const getRoleBadgeStyle = (r: MemberRole) => {
    switch (r) {
      case "SENIOR":
        return { bg: "#FEF3C7", color: "#D97706", label: "Senior (60+)" };
      case "TEEN":
        return { bg: "#EFF6FF", color: "#2563EB", label: "Teen (13-17)" };
      default:
        return { bg: "#F3E8FF", color: "#9333EA", label: "Adult" };
    }
  };

  const getPaymentLabel = (pm: PaymentMethod) => {
    switch (pm) {
      case "WALLET":
        return "Cab Wallet (Shared)";
      case "UPI":
        return "UPI Autopay";
      case "SAVED_CARD":
        return "Family Card";
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <Header title="Family" showBack />

      <ScrollView
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {/* Hero Explanation Banner */}
        <View style={styles.bannerCard}>
          <View style={styles.bannerIconBox}>
            <Ionicons name="people" size={24} color={COLORS.primary} />
          </View>
          <View style={styles.bannerTextContainer}>
            <Text style={styles.bannerTitle}>Family Profile</Text>
            <Text style={styles.bannerDesc}>
              Pay for your family's rides, receive automated safety
              notifications, and track their trips in real time.
            </Text>
          </View>
        </View>

        {/* Section Header */}
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>Family Members</Text>
          <Text style={styles.memberCount}>{members.length} Active</Text>
        </View>

        {/* Member List */}
        {members.length > 0 ? (
          members.map((member) => {
            const badge = getRoleBadgeStyle(member.role);
            return (
              <View key={member.id} style={styles.memberCard}>
                <View
                  style={[styles.memberAvatar, { backgroundColor: badge.bg }]}
                >
                  <Ionicons
                    name={
                      member.role === "SENIOR"
                        ? "heart"
                        : member.role === "TEEN"
                        ? "school"
                        : "person"
                    }
                    size={22}
                    color={badge.color}
                  />
                </View>

                <View style={styles.memberInfo}>
                  <View style={styles.memberNameRow}>
                    <Text style={styles.memberName}>{member.name}</Text>
                    <View
                      style={[styles.roleBadge, { backgroundColor: badge.bg }]}
                    >
                      <Text
                        style={[styles.roleBadgeText, { color: badge.color }]}
                      >
                        {badge.label}
                      </Text>
                    </View>
                  </View>

                  <Text style={styles.memberPhone}>{member.phone}</Text>

                  <View style={styles.paymentPill}>
                    <Ionicons
                      name="card-outline"
                      size={12}
                      color={COLORS.textSecondary}
                    />
                    <Text style={styles.paymentPillText}>
                      {getPaymentLabel(member.paymentMethod)}
                    </Text>
                  </View>
                </View>

                <TouchableOpacity
                  style={styles.deleteBtn}
                  onPress={() => handleDeleteMember(member)}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                >
                  <Ionicons
                    name="trash-outline"
                    size={18}
                    color={COLORS.error}
                  />
                </TouchableOpacity>
              </View>
            );
          })
        ) : (
          <View style={styles.emptyCard}>
            <Ionicons
              name="people-outline"
              size={40}
              color={COLORS.textSecondary}
            />
            <Text style={styles.emptyTitle}>No Family Members Yet</Text>
            <Text style={styles.emptyDesc}>
              Add teen or senior family members to pay for their rides and track
              their safety automatically.
            </Text>
          </View>
        )}

        {/* Add Family Member Button */}
        <View style={styles.addBtnContainer}>
          <AppButton
            title="+ Add Family Member"
            onPress={() => {
              setError(null);
              setModalVisible(true);
            }}
          />
        </View>
      </ScrollView>

      {/* Add Member Bottom Sheet Modal */}
      {modalVisible && (
        <TouchableWithoutFeedback onPress={() => setModalVisible(false)}>
          <View style={styles.modalOverlay}>
            <TouchableWithoutFeedback onPress={() => {}}>
              <KeyboardAvoidingView
                behavior={Platform.OS === "ios" ? "padding" : undefined}
                style={styles.modalContent}
              >
                <View style={styles.modalHeader}>
                  <Text style={styles.modalTitle}>Add Family Member</Text>
                  <TouchableOpacity onPress={() => setModalVisible(false)}>
                    <Ionicons
                      name="close"
                      size={24}
                      color={COLORS.textSecondary}
                    />
                  </TouchableOpacity>
                </View>

                <AppInput
                  label="Member Name"
                  placeholder="e.g. Mom, Aarav, Grandma"
                  value={name}
                  onChangeText={(val) => {
                    setName(val);
                    setError(null);
                  }}
                />

                <AppInput
                  label="Mobile Number"
                  placeholder="10-digit mobile number"
                  keyboardType="phone-pad"
                  value={phone}
                  onChangeText={(val) => {
                    setPhone(val);
                    setError(null);
                  }}
                />

                {/* Account Type Selector */}
                <Text style={styles.fieldLabel}>Account Type</Text>
                <View style={styles.chipRow}>
                  <TouchableOpacity
                    style={[
                      styles.chip,
                      role === "SENIOR" && styles.chipActive,
                    ]}
                    onPress={() => setRole("SENIOR")}
                  >
                    <Text
                      style={[
                        styles.chipText,
                        role === "SENIOR" && styles.chipTextActive,
                      ]}
                    >
                      Senior (60+)
                    </Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={[styles.chip, role === "TEEN" && styles.chipActive]}
                    onPress={() => setRole("TEEN")}
                  >
                    <Text
                      style={[
                        styles.chipText,
                        role === "TEEN" && styles.chipTextActive,
                      ]}
                    >
                      Teen (13-17)
                    </Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={[styles.chip, role === "ADULT" && styles.chipActive]}
                    onPress={() => setRole("ADULT")}
                  >
                    <Text
                      style={[
                        styles.chipText,
                        role === "ADULT" && styles.chipTextActive,
                      ]}
                    >
                      Adult
                    </Text>
                  </TouchableOpacity>
                </View>

                {/* Linked Payment Method Selector */}
                <Text style={styles.fieldLabel}>Linked Payment Method</Text>
                <View style={styles.chipRow}>
                  <TouchableOpacity
                    style={[
                      styles.chip,
                      paymentMethod === "WALLET" && styles.chipActive,
                    ]}
                    onPress={() => setPaymentMethod("WALLET")}
                  >
                    <Text
                      style={[
                        styles.chipText,
                        paymentMethod === "WALLET" && styles.chipTextActive,
                      ]}
                    >
                      Cab Wallet
                    </Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={[
                      styles.chip,
                      paymentMethod === "SAVED_CARD" && styles.chipActive,
                    ]}
                    onPress={() => setPaymentMethod("SAVED_CARD")}
                  >
                    <Text
                      style={[
                        styles.chipText,
                        paymentMethod === "SAVED_CARD" && styles.chipTextActive,
                      ]}
                    >
                      Card
                    </Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={[
                      styles.chip,
                      paymentMethod === "UPI" && styles.chipActive,
                    ]}
                    onPress={() => setPaymentMethod("UPI")}
                  >
                    <Text
                      style={[
                        styles.chipText,
                        paymentMethod === "UPI" && styles.chipTextActive,
                      ]}
                    >
                      UPI
                    </Text>
                  </TouchableOpacity>
                </View>

                {error ? <Text style={styles.errorText}>{error}</Text> : null}

                <View style={styles.modalActions}>
                  <AppButton
                    title="Save Family Member"
                    onPress={handleAddMember}
                  />
                </View>
              </KeyboardAvoidingView>
            </TouchableWithoutFeedback>
          </View>
        </TouchableWithoutFeedback>
      )}
    </SafeAreaView>
  );
}
