import React, { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Modal,
  Platform,
  ScrollView,
  Text,
  TextInput,
  TouchableOpacity,
  TouchableWithoutFeedback,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { AppButton } from "../common/AppButton";
import { AppInput } from "../common/AppInput";
import { COLORS } from "../../constants/colors";
import { RidesService } from "../../services/rides.service";
import { SupportService } from "../../services/support.service";
import { styles } from "../../styles/support.styles";
import type { RideHistoryItem } from "../../types/ride.types";
import type { SupportTicket, TicketCategory } from "../../types/support.types";

export type IssueModalProps = {
  visible: boolean;
  onClose: () => void;
  subIssueTitle: string;
  backendCategory: TicketCategory;
  requiresRide?: boolean;
  initialBookingId?: string;
  onTicketCreated?: (ticket: SupportTicket) => void;
};

export const IssueModal: React.FC<IssueModalProps> = ({
  visible,
  onClose,
  subIssueTitle,
  backendCategory,
  requiresRide = false,
  initialBookingId,
  onTicketCreated,
}) => {
  const [message, setMessage] = useState("");
  const [itemName, setItemName] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Recent rides state for ride picker
  const [rides, setRides] = useState<RideHistoryItem[]>([]);
  const [selectedRideId, setSelectedRideId] = useState<string | undefined>(
    initialBookingId
  );
  const [loadingRides, setLoadingRides] = useState(false);

  const isLostItem = backendCategory === "LOST_ITEM";

  // Load recent trips whenever the modal opens with a ride-related issue
  useEffect(() => {
    if (visible) {
      setMessage("");
      setItemName("");
      setError(null);
      setSelectedRideId(initialBookingId);

      if (requiresRide || isLostItem) {
        setLoadingRides(true);
        RidesService.getHistory()
          .then((items) => {
            setRides(items);
            if (!initialBookingId && items.length > 0) {
              setSelectedRideId(items[0].bookingId || items[0].id);
            }
          })
          .catch(() => setRides([]))
          .finally(() => setLoadingRides(false));
      }
    }
  }, [visible, requiresRide, isLostItem, initialBookingId]);

  const handleSubmit = async () => {
    const trimmedMessage = message.trim();

    if (isLostItem && !itemName.trim()) {
      setError("Please specify which item was lost (e.g. Phone, Wallet, Keys)");
      return;
    }

    if (!trimmedMessage) {
      setError("Please provide a brief description of the issue");
      return;
    }

    try {
      setSubmitting(true);
      setError(null);

      // Build context details into message
      let fullMessage = trimmedMessage;
      if (isLostItem && itemName.trim()) {
        fullMessage = `[Lost Item: ${itemName.trim()}]\n${fullMessage}`;
      }

      const selectedRide = rides.find(
        (r) => r.bookingId === selectedRideId || r.id === selectedRideId
      );
      if (selectedRide) {
        const fare = (
          (selectedRide.farePaise ?? selectedRide.estimatedFarePaise ?? 0) / 100
        ).toFixed(0);
        const pickup =
          selectedRide.pickupLabel || selectedRide.pickup?.address || "Pickup";
        const drop =
          selectedRide.dropLabel || selectedRide.dropoff?.address || "Drop";
        fullMessage = `${fullMessage}\n\n[Ride Details: ${pickup} ➔ ${drop} | Fare: ₹${fare}]`;
      }

      // Create ticket via backend service
      const createdTicket = await SupportService.createTicket({
        subject: subIssueTitle,
        message: fullMessage,
        category: backendCategory,
        bookingId: selectedRideId,
      });

      if (onTicketCreated) {
        onTicketCreated(createdTicket);
      }

      Alert.alert(
        "Request Submitted ✓",
        "Our customer support team has received your request and will follow up shortly.",
        [{ text: "OK", onPress: onClose }]
      );
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to submit support request"
      );
    } finally {
      setSubmitting(false);
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
              {/* Modal Top Header */}
              <View style={styles.modalHeader}>
                <Text style={styles.modalTitle}>Report an Issue</Text>
                <TouchableOpacity
                  onPress={onClose}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                >
                  <Ionicons
                    name="close"
                    size={24}
                    color={COLORS.textSecondary}
                  />
                </TouchableOpacity>
              </View>

              <ScrollView showsVerticalScrollIndicator={false}>
                {/* Issue Subject Highlight Box */}
                <View style={styles.issueSubjectBanner}>
                  <Text style={styles.issueSubjectLabel}>Selected Problem</Text>
                  <Text style={styles.issueSubjectText}>{subIssueTitle}</Text>
                </View>

                {/* Ride Picker (for Ride Issues or Lost & Found) */}
                {(requiresRide || isLostItem) && (
                  <View style={{ marginBottom: 16 }}>
                    <Text style={styles.ridePickerLabel}>
                      Select Affected Trip:
                    </Text>
                    {loadingRides ? (
                      <ActivityIndicator
                        size="small"
                        color={COLORS.primary}
                        style={{ marginVertical: 8 }}
                      />
                    ) : rides.length > 0 ? (
                      <ScrollView
                        horizontal
                        showsHorizontalScrollIndicator={false}
                        style={{ marginTop: 4 }}
                      >
                        {rides.map((ride) => {
                          const id = ride.bookingId || ride.id;
                          const isSelected = selectedRideId === id;
                          const displayFare = (
                            (ride.farePaise ?? ride.estimatedFarePaise ?? 0) /
                            100
                          ).toFixed(0);
                          const dropText =
                            ride.dropLabel ||
                            ride.dropoff?.address ||
                            "Completed Ride";

                          return (
                            <TouchableOpacity
                              key={id}
                              style={[
                                styles.ridePickerBox,
                                {
                                  marginRight: 8,
                                  width: 220,
                                  borderColor: isSelected
                                    ? COLORS.primary
                                    : COLORS.border,
                                  backgroundColor: isSelected
                                    ? "#EFF6FF"
                                    : "#F8FAFC",
                                },
                              ]}
                              onPress={() => setSelectedRideId(id)}
                              activeOpacity={0.7}
                            >
                              <View
                                style={{
                                  flexDirection: "row",
                                  justifyContent: "space-between",
                                  alignItems: "center",
                                  marginBottom: 2,
                                }}
                              >
                                <Text
                                  style={{
                                    fontSize: 11,
                                    color: COLORS.textSecondary,
                                  }}
                                >
                                  {new Date(
                                    ride.createdAt
                                  ).toLocaleDateString()}
                                </Text>
                                <Ionicons
                                  name={
                                    isSelected
                                      ? "checkmark-circle"
                                      : "ellipse-outline"
                                  }
                                  size={16}
                                  color={
                                    isSelected
                                      ? COLORS.primary
                                      : COLORS.textSecondary
                                  }
                                />
                              </View>
                              <Text
                                style={styles.ridePickerValue}
                                numberOfLines={1}
                              >
                                {dropText}
                              </Text>
                              <Text
                                style={{
                                  fontSize: 12,
                                  fontWeight: "700",
                                  color: COLORS.text,
                                  marginTop: 4,
                                }}
                              >
                                ₹{displayFare}
                              </Text>
                            </TouchableOpacity>
                          );
                        })}
                      </ScrollView>
                    ) : (
                      <Text
                        style={{
                          fontSize: 12,
                          color: COLORS.textSecondary,
                          fontStyle: "italic",
                          marginVertical: 4,
                        }}
                      >
                        No recent rides found on this account.
                      </Text>
                    )}
                  </View>
                )}

                {/* Lost Item Specific Name Field */}
                {isLostItem && (
                  <AppInput
                    label="Item Lost"
                    placeholder="e.g. Black Leather Wallet, iPhone 14, Keys"
                    value={itemName}
                    onChangeText={(t) => {
                      setItemName(t);
                      setError(null);
                    }}
                  />
                )}

                {/* Details Text Area */}
                <Text style={styles.ridePickerLabel}>
                  Describe what happened:
                </Text>
                <TextInput
                  style={styles.textAreaInput}
                  placeholder="Provide any details to help our team investigate and resolve this quickly..."
                  placeholderTextColor={COLORS.textSecondary}
                  multiline
                  value={message}
                  onChangeText={(t) => {
                    setMessage(t);
                    setError(null);
                  }}
                />

                {error ? (
                  <Text
                    style={{
                      color: COLORS.error,
                      fontSize: 12,
                      marginBottom: 8,
                    }}
                  >
                    {error}
                  </Text>
                ) : null}

                {/* Submit Button */}
                <View style={styles.modalActions}>
                  <AppButton
                    title="Submit Issue"
                    onPress={handleSubmit}
                    loading={submitting}
                    disabled={
                      !message.trim() || (isLostItem && !itemName.trim())
                    }
                  />
                </View>
              </ScrollView>
            </KeyboardAvoidingView>
          </TouchableWithoutFeedback>
        </View>
      </TouchableWithoutFeedback>
    </Modal>
  );
};
