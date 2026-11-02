import React, { useState } from 'react';
import {
  Alert,
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
import { PaymentService } from '../../services/payment.service';
import type { SavedPaymentMethod } from '../../types/payment.types';

export type PaymentMethodsSectionProps = {
  methods: SavedPaymentMethod[];
  onRefreshMethods: () => void;
};

export const PaymentMethodsSection: React.FC<PaymentMethodsSectionProps> = ({
  methods,
  onRefreshMethods,
}) => {
  const [addModalVisible, setAddModalVisible] = useState(false);
  const [modalType, setModalType] = useState<'UPI' | 'CARD'>('UPI');
  const [upiInput, setUpiInput] = useState('');
  const [cardNumber, setCardNumber] = useState('');
  const [cardHolder, setCardHolder] = useState('');
  const [saving, setSaving] = useState(false);

  const upiMethods = methods.filter((m) => m.type === 'UPI');
  const cardMethods = methods.filter((m) => m.type === 'CARD');

  const handleSetDefault = async (id: string) => {
    try {
      await PaymentService.setDefaultPaymentMethod(id);
      onRefreshMethods();
    } catch {
      Alert.alert('Error', 'Could not set default payment method.');
    }
  };

  const handleDelete = (id: string, label: string) => {
    Alert.alert(
      'Remove Payment Method',
      `Are you sure you want to remove ${label}?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: async () => {
            try {
              await PaymentService.deletePaymentMethod(id);
              onRefreshMethods();
            } catch {
              Alert.alert('Error', 'Could not remove payment method.');
            }
          },
        },
      ],
    );
  };

  const handleSaveMethod = async () => {
    if (modalType === 'UPI') {
      const trimmed = upiInput.trim();
      if (!trimmed.includes('@') || trimmed.length < 5) {
        Alert.alert('Invalid UPI ID', 'Please enter a valid UPI VPA (e.g. name@okhdfcbank)');
        return;
      }
      setSaving(true);
      try {
        await PaymentService.addPaymentMethod({
          type: 'UPI',
          upiId: trimmed,
          isDefault: methods.length === 0,
        });
        setAddModalVisible(false);
        setUpiInput('');
        onRefreshMethods();
      } catch {
        Alert.alert('Error', 'Could not save UPI method.');
      } finally {
        setSaving(false);
      }
    } else {
      if (cardNumber.length < 16) {
        Alert.alert('Invalid Card', 'Please enter a 16-digit card number.');
        return;
      }
      setSaving(true);
      try {
        await PaymentService.addPaymentMethod({
          type: 'CARD',
          card: {
            brand: 'Visa',
            last4: cardNumber.slice(-4),
            expiryMonth: 12,
            expiryYear: 2029,
            cardholderName: cardHolder || 'Rider',
          },
          isDefault: methods.length === 0,
        });
        setAddModalVisible(false);
        setCardNumber('');
        setCardHolder('');
        onRefreshMethods();
      } catch {
        Alert.alert('Error', 'Could not save Card.');
      } finally {
        setSaving(false);
      }
    }
  };

  return (
    <View style={styles.container}>
      {/* Saved UPI IDs */}
      <View style={styles.sectionHeader}>
        <Text style={styles.sectionTitle}>Saved UPI Accounts</Text>
        <TouchableOpacity
          onPress={() => {
            setModalType('UPI');
            setAddModalVisible(true);
          }}
        >
          <Text style={styles.addLink}>+ Add UPI ID</Text>
        </TouchableOpacity>
      </View>

      {upiMethods.length === 0 ? (
        <View style={styles.emptyCard}>
          <Text style={styles.emptyText}>No UPI IDs linked yet.</Text>
        </View>
      ) : (
        <View style={styles.cardList}>
          {upiMethods.map((m) => (
            <View key={m.id} style={styles.methodCard}>
              <View style={styles.methodLeft}>
                <View style={[styles.brandIconCircle, { backgroundColor: '#DCFCE7' }]}>
                  <Ionicons name="phone-portrait-outline" size={18} color="#10B981" />
                </View>
                <View>
                  <View style={styles.titleRow}>
                    <Text style={styles.methodTitle}>{m.upiId}</Text>
                    {m.isDefault && (
                      <View style={styles.defaultBadge}>
                        <Text style={styles.defaultText}>DEFAULT</Text>
                      </View>
                    )}
                  </View>
                  <Text style={styles.methodSub}>Instant UPI Payment</Text>
                </View>
              </View>

              <View style={styles.actionRow}>
                {!m.isDefault && (
                  <TouchableOpacity
                    onPress={() => handleSetDefault(m.id)}
                    style={styles.setDefaultBtn}
                  >
                    <Text style={styles.setDefaultText}>Set Default</Text>
                  </TouchableOpacity>
                )}
                <TouchableOpacity
                  onPress={() => handleDelete(m.id, m.upiId || 'UPI ID')}
                  style={styles.deleteBtn}
                >
                  <Ionicons name="trash-outline" size={18} color="#EF4444" />
                </TouchableOpacity>
              </View>
            </View>
          ))}
        </View>
      )}

      {/* Saved Cards */}
      <View style={[styles.sectionHeader, { marginTop: SPACING.lg }]}>
        <Text style={styles.sectionTitle}>Saved Debit & Credit Cards</Text>
        <TouchableOpacity
          onPress={() => {
            setModalType('CARD');
            setAddModalVisible(true);
          }}
        >
          <Text style={styles.addLink}>+ Add Card</Text>
        </TouchableOpacity>
      </View>

      {cardMethods.length === 0 ? (
        <View style={styles.emptyCard}>
          <Text style={styles.emptyText}>No debit or credit cards saved.</Text>
        </View>
      ) : (
        <View style={styles.cardList}>
          {cardMethods.map((m) => (
            <View key={m.id} style={styles.methodCard}>
              <View style={styles.methodLeft}>
                <View style={[styles.brandIconCircle, { backgroundColor: '#DBEAFE' }]}>
                  <Ionicons name="card" size={18} color="#2563EB" />
                </View>
                <View>
                  <View style={styles.titleRow}>
                    <Text style={styles.methodTitle}>
                      {m.card?.brand || 'Card'} •••• {m.card?.last4}
                    </Text>
                    {m.isDefault && (
                      <View style={styles.defaultBadge}>
                        <Text style={styles.defaultText}>DEFAULT</Text>
                      </View>
                    )}
                  </View>
                  <Text style={styles.methodSub}>
                    Expires {m.card?.expiryMonth}/{m.card?.expiryYear}
                  </Text>
                </View>
              </View>

              <View style={styles.actionRow}>
                {!m.isDefault && (
                  <TouchableOpacity
                    onPress={() => handleSetDefault(m.id)}
                    style={styles.setDefaultBtn}
                  >
                    <Text style={styles.setDefaultText}>Set Default</Text>
                  </TouchableOpacity>
                )}
                <TouchableOpacity
                  onPress={() =>
                    handleDelete(
                      m.id,
                      `Card ending in ${m.card?.last4 || '****'}`,
                    )
                  }
                  style={styles.deleteBtn}
                >
                  <Ionicons name="trash-outline" size={18} color="#EF4444" />
                </TouchableOpacity>
              </View>
            </View>
          ))}
        </View>
      )}

      {/* Add Method Modal */}
      <Modal
        visible={addModalVisible}
        transparent
        animationType="slide"
        onRequestClose={() => setAddModalVisible(false)}
      >
        <TouchableWithoutFeedback onPress={() => setAddModalVisible(false)}>
          <View style={styles.overlay}>
            <TouchableWithoutFeedback>
              <View style={styles.modalContent}>
                <View style={styles.modalHeader}>
                  <Text style={styles.modalTitle}>
                    {modalType === 'UPI' ? 'Add UPI Account' : 'Save New Card'}
                  </Text>
                  <TouchableOpacity
                    onPress={() => setAddModalVisible(false)}
                    style={styles.closeBtn}
                  >
                    <Ionicons name="close" size={20} color={COLORS.textSecondary} />
                  </TouchableOpacity>
                </View>

                {modalType === 'UPI' ? (
                  <View style={{ gap: 14 }}>
                    <AppInput
                      label="UPI ID / VPA"
                      placeholder="e.g. mobile@upi or name@okhdfcbank"
                      value={upiInput}
                      onChangeText={setUpiInput}
                      autoCapitalize="none"
                    />
                    <Text style={styles.hintText}>
                      We will verify your UPI ID before linking it for one-click ride bookings.
                    </Text>
                  </View>
                ) : (
                  <View style={{ gap: 12 }}>
                    <AppInput
                      label="Card Number"
                      placeholder="16-digit card number"
                      keyboardType="numeric"
                      value={cardNumber}
                      onChangeText={setCardNumber}
                    />
                    <AppInput
                      label="Cardholder Name"
                      placeholder="Name as printed on card"
                      value={cardHolder}
                      onChangeText={setCardHolder}
                    />
                  </View>
                )}

                <View style={{ marginTop: SPACING.lg }}>
                  <AppButton
                    title={modalType === 'UPI' ? 'Verify & Link UPI ID' : 'Save Card'}
                    onPress={handleSaveMethod}
                    loading={saving}
                  />
                </View>
              </View>
            </TouchableWithoutFeedback>
          </View>
        </TouchableWithoutFeedback>
      </Modal>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    paddingBottom: SPACING.md,
  },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: SPACING.sm,
  },
  sectionTitle: {
    fontSize: 13,
    fontWeight: '800',
    color: COLORS.text,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  addLink: {
    fontSize: 12,
    fontWeight: '700',
    color: '#10B981',
  },
  cardList: {
    gap: 10,
  },
  methodCard: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: COLORS.white,
    padding: SPACING.md,
    borderRadius: RADIUS.lg,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  methodLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    flex: 1,
  },
  brandIconCircle: {
    width: 38,
    height: 38,
    borderRadius: RADIUS.full,
    justifyContent: 'center',
    alignItems: 'center',
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  methodTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: COLORS.text,
  },
  defaultBadge: {
    backgroundColor: '#DCFCE7',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  defaultText: {
    fontSize: 9,
    fontWeight: '800',
    color: '#059669',
  },
  methodSub: {
    fontSize: 11,
    color: COLORS.textSecondary,
    marginTop: 2,
  },
  actionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  setDefaultBtn: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: RADIUS.sm,
    backgroundColor: COLORS.background,
  },
  setDefaultText: {
    fontSize: 11,
    color: COLORS.textSecondary,
    fontWeight: '600',
  },
  deleteBtn: {
    padding: 4,
  },
  emptyCard: {
    padding: SPACING.md,
    backgroundColor: COLORS.background,
    borderRadius: RADIUS.md,
    alignItems: 'center',
  },
  emptyText: {
    fontSize: 12,
    color: COLORS.textSecondary,
  },
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
    justifyContent: 'flex-end',
  },
  modalContent: {
    backgroundColor: COLORS.white,
    borderTopLeftRadius: RADIUS.xl,
    borderTopRightRadius: RADIUS.xl,
    padding: SPACING.lg,
    paddingBottom: SPACING.xl + 10,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: SPACING.md,
  },
  modalTitle: {
    fontSize: 17,
    fontWeight: '800',
    color: COLORS.text,
  },
  closeBtn: {
    width: 32,
    height: 32,
    borderRadius: RADIUS.full,
    backgroundColor: COLORS.background,
    justifyContent: 'center',
    alignItems: 'center',
  },
  hintText: {
    fontSize: 11,
    color: COLORS.textSecondary,
    lineHeight: 16,
  },
});
