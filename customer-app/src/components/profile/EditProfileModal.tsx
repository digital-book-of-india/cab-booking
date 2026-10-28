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
  currentPhone: string; // <-- Changed from currentEmail to currentPhone
  onSaveSuccess?: () => void;
};

export const EditProfileModal: React.FC<EditProfileModalProps> = ({
  visible,
  onClose,
  currentName,
  currentPhone,
  onSaveSuccess,
}) => {
  const { updateProfile } = useAuth();

  const [name, setName] = useState(currentName);
  const [phone, setPhone] = useState(currentPhone); // <-- Phone state
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  // Sync inputs whenever the modal opens with the latest data
  useEffect(() => {
    if (visible) {
      setName(currentName);
      setPhone(currentPhone || "");
      setError(null);
      setSuccessMsg(null);
    }
  }, [visible, currentName, currentPhone]);

  const handleSave = async () => {
    const trimmedName = name.trim();
    const cleanPhone = phone.trim();

    // 1. Name validation
    if (!trimmedName) {
      setError("Name cannot be empty");
      return;
    }

    // 2. Mobile number validation (e.g., standard 10 digits)
    const phoneDigits = cleanPhone.replace(/\D/g, ""); // strip spaces or '+'
    if (phoneDigits.length < 10) {
      setError("Please enter a valid 10-digit mobile number");
      return;
    }

    try {
      setError(null);
      setSaving(true);

      // Call updateProfile with the updated name and phone
      await updateProfile(trimmedName, cleanPhone);

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

              {/* Form Inputs: Full Name & Mobile Number */}
              <View style={styles.modalForm}>
                <AppInput
                  label="Full Name"
                  placeholder="Enter your full name"
                  value={name}
                  onChangeText={(val) => {
                    setName(val);
                    setError(null);
                  }}
                  autoCapitalize="words"
                />

                <AppInput
                  label="Mobile Number"
                  placeholder="Enter 10-digit mobile number"
                  value={phone}
                  onChangeText={(val) => {
                    setPhone(val);
                    setError(null);
                  }}
                  keyboardType="phone-pad"
                  maxLength={13} // Allows for +91 or standard 10 digits
                  error={error || undefined}
                />

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
                    disabled={!name.trim() || !phone.trim()}
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
