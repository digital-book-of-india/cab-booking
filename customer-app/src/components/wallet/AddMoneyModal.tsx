import React, { useMemo, useState } from 'react';
import {
  Modal,
  StyleSheet,
  Text,
  TouchableOpacity,
  TouchableWithoutFeedback,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { AppButton } from '../common/AppButton';
import { AppInput } from '../common/AppInput';
import { COLORS, RADIUS, SPACING } from '../../constants/colors';
import type { WalletLimits } from '../../types/payment.types';

const BASE_QUICK_AMOUNTS = [100, 200, 500, 1000];

export type AddMoneyModalProps = {
  visible: boolean;
  loading: boolean;
  onClose: () => void;
  onSubmit: (amountPaise: number, paymentMethod: 'UPI' | 'CARD') => void;
  limits?: WalletLimits;
  currentBalancePaise?: number;
};

export const AddMoneyModal: React.FC<AddMoneyModalProps> = ({
  visible,
  loading,
  onClose,
  onSubmit,
  limits,
  currentBalancePaise = 0,
}) => {
  const minRupees = Math.round((limits?.minTopupPaise ?? 5000) / 100);
  const maxRupees = Math.round((limits?.maxTopupPaise ?? 500000) / 100);
  const maxBalanceRupees = Math.round((limits?.maxBalancePaise ?? 1000000) / 100);
  const currentBalanceRupees = currentBalancePaise / 100;
  const remainingWalletSpace = Math.max(0, maxBalanceRupees - currentBalanceRupees);
  const effectiveMaxRupees = Math.min(maxRupees, remainingWalletSpace);

  const [amountStr, setAmountStr] = useState('200');
  const [selectedMethod, setSelectedMethod] = useState<'UPI' | 'CARD'>('UPI');

  const parsedAmount = parseFloat(amountStr);

  const validation = useMemo(() => {
    if (isNaN(parsedAmount) || parsedAmount <= 0) {
      return { isValid: false, message: `Enter an amount (Min ₹${minRupees})` };
    }
    if (parsedAmount < minRupees) {
      return { isValid: false, message: `Minimum top-up is ₹${minRupees}` };
    }
    if (parsedAmount > maxRupees) {
      return { isValid: false, message: `Maximum top-up is ₹${maxRupees}` };
    }
    if (parsedAmount > remainingWalletSpace) {
      return {
        isValid: false,
        message: `Wallet capacity is ₹${maxBalanceRupees}. You can add up to ₹${Math.floor(
          remainingWalletSpace,
        )}`,
      };
    }
    return { isValid: true, message: null };
  }, [parsedAmount, minRupees, maxRupees, remainingWalletSpace, maxBalanceRupees]);

  const handleSubmit = () => {
    if (!validation.isValid) return;
    const amountPaise = Math.round(parsedAmount * 100);
    onSubmit(amountPaise, selectedMethod);
  };

  const quickAmounts = useMemo(() => {
    return BASE_QUICK_AMOUNTS.filter(
      (amt) => amt >= minRupees && amt <= effectiveMaxRupees,
    );
  }, [minRupees, effectiveMaxRupees]);

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
    >
      <TouchableWithoutFeedback onPress={onClose}>
        <View style={styles.overlay}>
          <TouchableWithoutFeedback>
            <View style={styles.content}>
              {/* Header */}
              <View style={styles.header}>
                <View>
                  <Text style={styles.title}>Top Up Wallet</Text>
                  <Text style={styles.subtitle}>
                    Balance: ₹{currentBalanceRupees.toFixed(2)} / Max: ₹{maxBalanceRupees}
                  </Text>
                </View>
                <TouchableOpacity onPress={onClose} style={styles.closeBtn}>
                  <Ionicons name="close" size={20} color={COLORS.textSecondary} />
                </TouchableOpacity>
              </View>

              {/* Quick Amount Chips */}
              {quickAmounts.length > 0 && (
                <>
                  <Text style={styles.sectionLabel}>Select Quick Amount</Text>
                  <View style={styles.quickRow}>
                    {quickAmounts.map((amt) => {
                      const active = amountStr === String(amt);
                      return (
                        <TouchableOpacity
                          key={amt}
                          style={[styles.quickBtn, active && styles.quickBtnActive]}
                          onPress={() => setAmountStr(String(amt))}
                        >
                          <Text style={[styles.quickText, active && styles.quickTextActive]}>
                            +₹{amt}
                          </Text>
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                </>
              )}

              {/* Custom Input */}
              <View style={{ marginTop: SPACING.md }}>
                <AppInput
                  label="Enter Amount (in INR)"
                  placeholder={`₹${minRupees} - ₹${effectiveMaxRupees}`}
                  keyboardType="numeric"
                  value={amountStr}
                  onChangeText={setAmountStr}
                  error={validation.isValid ? undefined : validation.message || undefined}
                />
                <Text style={styles.limitsHint}>
                  Min ₹{minRupees} • Max single top-up ₹{maxRupees}
                </Text>
              </View>

              {/* Payment Gateway Options */}
              <Text style={[styles.sectionLabel, { marginTop: SPACING.md }]}>
                Choose Payment Method
              </Text>
              <View style={styles.methodList}>
                <TouchableOpacity
                  style={[
                    styles.methodCard,
                    selectedMethod === 'UPI' && styles.methodCardActive,
                  ]}
                  onPress={() => setSelectedMethod('UPI')}
                  activeOpacity={0.8}
                >
                  <View style={styles.methodLeft}>
                    <View style={[styles.iconCircle, { backgroundColor: '#DCFCE7' }]}>
                      <Ionicons name="phone-portrait-outline" size={18} color="#10B981" />
                    </View>
                    <View>
                      <Text style={styles.methodTitle}>UPI Payments</Text>
                      <Text style={styles.methodSub}>Google Pay, PhonePe, Paytm, BHIM</Text>
                    </View>
                  </View>
                  <Ionicons
                    name={selectedMethod === 'UPI' ? 'radio-button-on' : 'radio-button-off'}
                    size={20}
                    color={selectedMethod === 'UPI' ? '#10B981' : COLORS.textSecondary}
                  />
                </TouchableOpacity>

                <TouchableOpacity
                  style={[
                    styles.methodCard,
                    selectedMethod === 'CARD' && styles.methodCardActive,
                  ]}
                  onPress={() => setSelectedMethod('CARD')}
                  activeOpacity={0.8}
                >
                  <View style={styles.methodLeft}>
                    <View style={[styles.iconCircle, { backgroundColor: '#DBEAFE' }]}>
                      <Ionicons name="card-outline" size={18} color="#3B82F6" />
                    </View>
                    <View>
                      <Text style={styles.methodTitle}>Debit / Credit Card</Text>
                      <Text style={styles.methodSub}>Visa, Mastercard, RuPay</Text>
                    </View>
                  </View>
                  <Ionicons
                    name={selectedMethod === 'CARD' ? 'radio-button-on' : 'radio-button-off'}
                    size={20}
                    color={selectedMethod === 'CARD' ? '#10B981' : COLORS.textSecondary}
                  />
                </TouchableOpacity>
              </View>

              {/* Submit CTA */}
              <View style={{ marginTop: SPACING.lg }}>
                <AppButton
                  title={
                    validation.isValid
                      ? `Add ₹${parsedAmount.toFixed(2)} to Wallet`
                      : validation.message || 'Enter Valid Amount'
                  }
                  onPress={handleSubmit}
                  loading={loading}
                  disabled={!validation.isValid || loading}
                />
              </View>
            </View>
          </TouchableWithoutFeedback>
        </View>
      </TouchableWithoutFeedback>
    </Modal>
  );
};

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
    justifyContent: 'flex-end',
  },
  content: {
    backgroundColor: COLORS.white,
    borderTopLeftRadius: RADIUS.xl,
    borderTopRightRadius: RADIUS.xl,
    padding: SPACING.lg,
    paddingBottom: SPACING.xl + 10,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: SPACING.md,
  },
  title: {
    fontSize: 18,
    fontWeight: '800',
    color: COLORS.text,
  },
  subtitle: {
    fontSize: 12,
    color: COLORS.textSecondary,
    marginTop: 2,
  },
  closeBtn: {
    width: 32,
    height: 32,
    borderRadius: RADIUS.full,
    backgroundColor: COLORS.background,
    justifyContent: 'center',
    alignItems: 'center',
  },
  sectionLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: COLORS.textSecondary,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: SPACING.xs,
  },
  quickRow: {
    flexDirection: 'row',
    gap: 8,
  },
  quickBtn: {
    flex: 1,
    paddingVertical: 10,
    backgroundColor: COLORS.background,
    borderRadius: RADIUS.md,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'transparent',
  },
  quickBtnActive: {
    backgroundColor: '#ECFDF5',
    borderColor: '#10B981',
  },
  quickText: {
    fontSize: 13,
    fontWeight: '700',
    color: COLORS.text,
  },
  quickTextActive: {
    color: '#059669',
  },
  limitsHint: {
    fontSize: 11,
    color: COLORS.textSecondary,
    marginTop: 4,
    marginLeft: 2,
  },
  methodList: {
    gap: 10,
  },
  methodCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: SPACING.sm + 4,
    borderRadius: RADIUS.md,
    backgroundColor: COLORS.background,
    borderWidth: 1.5,
    borderColor: 'transparent',
  },
  methodCardActive: {
    backgroundColor: '#F0FDF4',
    borderColor: '#10B981',
  },
  methodLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  iconCircle: {
    width: 36,
    height: 36,
    borderRadius: RADIUS.full,
    justifyContent: 'center',
    alignItems: 'center',
  },
  methodTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: COLORS.text,
  },
  methodSub: {
    fontSize: 11,
    color: COLORS.textSecondary,
    marginTop: 2,
  },
});
