import React, { useEffect, useState } from "react";
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  Text,
  TouchableOpacity,
  TouchableWithoutFeedback,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { AppButton } from "../common/AppButton";
import { AppInput } from "../common/AppInput";
import { COLORS } from "../../constants/colors";
import { useAuth } from "../../context/AuthContext";
import { styles } from "../../styles/profile.styles";

export type EditProfileModalProps = {
  visible: boolean;
  onClose: () => void;
  currentName: string;
  currentPhone: string;
  currentEmail?: string;
  onSaveSuccess?: () => void;
};

export const EditProfileModal: React.FC<EditProfileModalProps> = ({
  visible,
  onClose,
  currentName,
  currentPhone,
  currentEmail = "",
  onSaveSuccess,
}) => {
  const { updateProfile } = useAuth();

  const [name, setName] = useState(currentName);
  const [email, setEmail] = useState(currentEmail);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  // Sync inputs whenever the modal opens with the latest data
  useEffect(() => {
    if (visible) {
      setName(currentName);
      setEmail(currentEmail || "");
      setError(null);
      setSuccessMsg(null);
    }
  }, [visible, currentName, currentEmail]);

  const handleSave = async () => {
    const trimmedName = name.trim();
    const trimmedEmail = email.trim();

    // 1. Name validation
    if (!trimmedName) {
      setError("Name cannot be empty");
      return;
    }

    // 2. Email format validation (optional, but must be valid if provided)
    if (trimmedEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmedEmail)) {
      setError("Please enter a valid email address");
      return;
    }

    try {
      setError(null);
      setSaving(true);

      // Call updateProfile with the updated name and email matching backend PATCH schema
      await updateProfile(trimmedName, trimmedEmail || null);

      setSuccessMsg("Profile updated successfully!");
      if (onSaveSuccess) onSaveSuccess();

      setTimeout(() => {
        onClose();
      }, 700);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update profile");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent
      onRequestClose={onClose}
    >
      <TouchableWithoutFeedback onPress={onClose}>
        <View style={styles.modalOverlay}>
          <TouchableWithoutFeedback onPress={() => {}}>
            <KeyboardAvoidingView
              behavior={Platform.OS === "ios" ? "padding" : undefined}
              style={styles.modalContent}
            >
              {/* Header */}
              <View style={styles.modalHeader}>
                <Text style={styles.modalTitle}>Edit Profile</Text>
                <TouchableOpacity
                  onPress={onClose}
                  style={styles.modalCloseBtn}
                  hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                >
                  <Ionicons
                    name="close"
                    size={24}
                    color={COLORS.textSecondary}
                  />
                </TouchableOpacity>
              </View>

              {/* Avatar Preview */}
              <View style={styles.modalAvatarPreview}>
                <View style={styles.modalAvatarCircle}>
                  <Text style={styles.avatarText}>
                    {name.trim() ? name.trim()[0].toUpperCase() : "U"}
                  </Text>
                </View>
                <Text style={styles.modalChangePhotoText}>Profile Initial</Text>
              </View>

              {/* Form Inputs: Full Name, Email Address, and Read-Only Mobile Number */}
              <View style={styles.modalForm}>
                <AppInput
                  label="Full Name *"
                  placeholder="Enter your full name"
                  value={name}
                  onChangeText={(val) => {
                    setName(val);
                    setError(null);
                  }}
                  autoCapitalize="words"
                />

                <AppInput
                  label="Email Address"
                  placeholder="Enter your email address (optional)"
                  value={email}
                  onChangeText={(val) => {
                    setEmail(val);
                    setError(null);
                  }}
                  keyboardType="email-address"
                  autoCapitalize="none"
                  autoCorrect={false}
                  error={error || undefined}
                />

                <View>
                  <AppInput
                    label="Mobile Number"
                    value={currentPhone || "Not linked"}
                    editable={false}
                    style={{ backgroundColor: "#F1F5F9", color: COLORS.textSecondary }}
                  />
                  <Text
                    style={{
                      fontSize: 11,
                      color: COLORS.textSecondary,
                      marginTop: -8,
                      marginBottom: 8,
                    }}
                  >
                    Mobile number is verified via OTP and linked to your account.
                  </Text>
                </View>

                {successMsg ? (
                  <Text
                    style={{
                      color: COLORS.success,
                      fontSize: 13,
                      fontWeight: "600",
                      textAlign: "center",
                      marginTop: 4,
                    }}
                  >
                    {successMsg}
                  </Text>
                ) : null}

                {/* Save Button */}
                <View style={styles.modalButtonContainer}>
                  <AppButton
                    title="Save Changes"
                    onPress={handleSave}
                    loading={saving}
                    disabled={!name.trim()}
                  />
                </View>
              </View>
            </KeyboardAvoidingView>
          </TouchableWithoutFeedback>
        </View>
      </TouchableWithoutFeedback>
    </Modal>
  );
};
