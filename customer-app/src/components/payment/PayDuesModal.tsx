import React, { useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Modal,
  ScrollView,
  Text,
  TouchableOpacity,
  TouchableWithoutFeedback,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { APP_CONFIG } from '../../constants/config';
import { COLORS } from '../../constants/colors';
import { PaymentService } from '../../services/payment.service';
import type { CustomerBalance } from '../../types/payment.types';
import { AppButton } from '../common/AppButton';
import { styles } from './PayDuesModal.styles';

export type PayDuesModalProps = {
  visible: boolean;
  onClose: () => void;
  balance: CustomerBalance | null;
  walletBalancePaise?: number;
  onPaidSuccess: () => void;
};

export const PayDuesModal: React.FC<PayDuesModalProps> = ({
  visible,
  onClose,
  balance,
  walletBalancePaise = 0,
  onPaidSuccess,
}) => {
  const [selectedMethod, setSelectedMethod] = useState<'ONLINE' | 'WALLET'>('ONLINE');
  const [payingBookingId, setPayingBookingId] = useState<string | null>(null);
  const [payingAll, setPayingAll] = useState(false);

  const unpaidPaise = balance?.unpaidPaise ?? balance?.outstandingBalancePaise ?? 0;
  const isBlocked = Boolean(balance?.blocked);
  const items = balance?.items || [];
  const canPayFromWallet = walletBalancePaise >= unpaidPaise;

  const handlePayItem = async (bookingId: string, amountPaise: number) => {
    try {
      setPayingBookingId(bookingId);
      await PaymentService.payOutstandingDue(bookingId, selectedMethod);
      Alert.alert(
        'Payment Successful',
        `₹${(amountPaise / 100).toFixed(2)} has been paid successfully. Your balance has been updated.`,
      );
      onPaidSuccess();
      onClose();
    } catch (err) {
      Alert.alert('Payment Failed', err instanceof Error ? err.message : 'Could not settle dues');
    } finally {
      setPayingBookingId(null);
    }
  };

  const handlePayAll = async () => {
    if (items.length === 0) return;
    try {
      setPayingAll(true);
      for (const item of items) {
        if (item.payable) {
          await PaymentService.payOutstandingDue(item.bookingId, selectedMethod);
        }
      }
      Alert.alert(
        'All Dues Cleared!',
        'Your outstanding balance has been cleared and any ride restrictions are now lifted.',
      );
      onPaidSuccess();
      onClose();
    } catch (err) {
      Alert.alert('Payment Failed', err instanceof Error ? err.message : 'Could not complete all payments');
    } finally {
      setPayingAll(false);
    }
  };

  const formatItemDate = (dateStr?: string | null) => {
    if (!dateStr) return 'Recently';
    try {
      const d = new Date(dateStr);
      return d.toLocaleDateString('en-IN', {
        day: 'numeric',
        month: 'short',
        hour: '2-digit',
        minute: '2-digit',
      });
    } catch {
      return 'Recently';
    }
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <TouchableWithoutFeedback onPress={onClose}>
        <View style={styles.modalOverlay}>
          <TouchableWithoutFeedback>
            <View style={styles.sheetContainer}>
              {/* Header */}
              <View style={styles.header}>
                <View style={styles.headerTitleRow}>
                  <Ionicons name="card" size={20} color={COLORS.primary} />
                  <Text style={styles.headerTitle}>Outstanding Dues</Text>
                </View>
                <TouchableOpacity
                  style={styles.closeBtn}
                  onPress={onClose}
                  hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                >
                  <Ionicons name="close" size={22} color={COLORS.textSecondary} />
                </TouchableOpacity>
              </View>

              <ScrollView
                contentContainerStyle={styles.scrollContent}
                showsVerticalScrollIndicator={false}
              >
                {/* Account Blocked Alert Banner */}
                {isBlocked && (
                  <View style={styles.blockedAlertBox}>
                    <Ionicons name="warning" size={22} color="#DC2626" />
                    <Text style={styles.blockedAlertText}>
                      Account Restricted: You cannot book new rides until your overdue balance is cleared.
                    </Text>
                  </View>
                )}

                {/* Hero Due Summary Card */}
                <View style={styles.heroDueCard}>
                  <Text style={styles.heroDueLabel}>Total Amount Due</Text>
                  <Text style={styles.heroDueAmount}>
                    {APP_CONFIG.currencySymbol}
                    {(unpaidPaise / 100).toFixed(2)}
                  </Text>
                  <Text style={styles.heroDueSubtext}>
                    {items.length} pending ride payment{items.length === 1 ? '' : 's'}
                  </Text>
                </View>

                {/* Payment Method Selector */}
                <Text style={styles.sectionTitle}>Select Payment Method</Text>
                <View style={styles.methodSelector}>
                  <TouchableOpacity
                    style={[
                      styles.methodOption,
                      selectedMethod === 'ONLINE' && styles.methodOptionActive,
                    ]}
                    onPress={() => setSelectedMethod('ONLINE')}
                    activeOpacity={0.8}
                  >
                    <View style={styles.methodOptionLeft}>
                      <Ionicons name="card-outline" size={20} color={COLORS.primary} />
                      <View>
                        <Text style={styles.methodOptionTitle}>Pay Online (UPI / Cards / NetBanking)</Text>
                        <Text style={styles.methodOptionSub}>Instant settlement via Razorpay</Text>
                      </View>
                    </View>
                    <Ionicons
                      name={selectedMethod === 'ONLINE' ? 'radio-button-on' : 'radio-button-off'}
                      size={20}
                      color={selectedMethod === 'ONLINE' ? COLORS.primary : COLORS.disabled}
                    />
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={[
                      styles.methodOption,
                      selectedMethod === 'WALLET' && styles.methodOptionActive,
                      !canPayFromWallet && { opacity: 0.5 },
                    ]}
                    onPress={() => {
                      if (canPayFromWallet) setSelectedMethod('WALLET');
                      else {
                        Alert.alert(
                          'Insufficient Wallet Balance',
                          `Your wallet has ₹${(walletBalancePaise / 100).toFixed(2)}. Please top up or pay online.`,
                        );
                      }
                    }}
                    activeOpacity={canPayFromWallet ? 0.8 : 1}
                  >
                    <View style={styles.methodOptionLeft}>
                      <Ionicons name="wallet-outline" size={20} color="#D97706" />
                      <View>
                        <Text style={styles.methodOptionTitle}>Wallet Balance</Text>
                        <Text style={styles.methodOptionSub}>
                          Available: ₹{(walletBalancePaise / 100).toFixed(2)}
                        </Text>
                      </View>
                    </View>
                    <Ionicons
                      name={selectedMethod === 'WALLET' ? 'radio-button-on' : 'radio-button-off'}
                      size={20}
                      color={selectedMethod === 'WALLET' ? COLORS.primary : COLORS.disabled}
                    />
                  </TouchableOpacity>
                </View>

                {/* List of Pending Items */}
                <Text style={styles.sectionTitle}>Pending Dues List</Text>
                {items.map((item) => {
                  const itemLoading = payingBookingId === item.bookingId;
                  return (
                    <View key={item.bookingId} style={styles.dueItemCard}>
                      <View style={styles.dueItemTop}>
                        <Text style={styles.dueItemBookingId}>{item.bookingId}</Text>
                        <View
                          style={[
                            styles.dueItemBadge,
                            item.overdue ? styles.dueItemBadgeOverdue : styles.dueItemBadgeDue,
                          ]}
                        >
                          <Text
                            style={[
                              styles.dueItemBadgeText,
                              item.overdue ? styles.dueItemBadgeTextOverdue : styles.dueItemBadgeTextDue,
                            ]}
                          >
                            {item.overdue ? 'OVERDUE' : item.paymentStatus || 'DUE'}
                          </Text>
                        </View>
                      </View>

                      <View style={styles.dueItemDetails}>
                        <View>
                          <Text style={styles.dueItemPurpose}>
                            {item.purpose === 'RIDE' ? 'Trip Fare' : item.purpose}
                          </Text>
                          <Text style={styles.dueItemDate}>{formatItemDate(item.since)}</Text>
                        </View>
                        <Text style={styles.dueItemAmount}>
                          ₹{(item.amountPaise / 100).toFixed(2)}
                        </Text>
                      </View>

                      {item.payable && (
                        <TouchableOpacity
                          style={styles.dueItemPayBtn}
                          disabled={itemLoading || payingAll}
                          onPress={() => handlePayItem(item.bookingId, item.amountPaise)}
                          activeOpacity={0.8}
                        >
                          {itemLoading ? (
                            <ActivityIndicator size="small" color={COLORS.white} />
                          ) : (
                            <Text style={styles.dueItemPayBtnText}>
                              Pay ₹{(item.amountPaise / 100).toFixed(2)} Now
                            </Text>
                          )}
                        </TouchableOpacity>
                      )}
                    </View>
                  );
                })}
              </ScrollView>

              {/* Footer Action: Pay All */}
              {items.length > 1 && (
                <View style={styles.footerActions}>
                  <AppButton
                    title={`Clear All Dues (₹${(unpaidPaise / 100).toFixed(2)})`}
                    onPress={handlePayAll}
                    loading={payingAll}
                    disabled={payingAll || payingBookingId !== null}
                  />
                </View>
              )}
            </View>
          </TouchableWithoutFeedback>
        </View>
      </TouchableWithoutFeedback>
    </Modal>
  );
};
