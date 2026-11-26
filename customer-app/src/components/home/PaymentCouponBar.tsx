import React, { useState } from 'react';
import {
  Modal,
  ScrollView,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { COLORS } from '../../constants/colors';
import type { PaymentMode, RideCoupon } from '../../hooks/useRideBookingSheet';
import { QuotesService } from '../../services/quotes.service';
import { styles } from '../../styles/home/PaymentCouponBar.styles';

export type PaymentCouponBarProps = {
  paymentMode: PaymentMode;
  walletBalancePaise: number;
  selectedCoupon: RideCoupon | null;
  activeCouponCode?: string | null;
  activeOffers?: RideCoupon[];
  couponError?: string | null;
  onCyclePaymentMode: () => void;
  onToggleCoupon: () => void;
  onSelectCoupon?: (coupon: RideCoupon | null) => void;
  onApplyCouponCode?: (code: string) => void;
  onClearCoupon: () => void;
};

export const PaymentCouponBar: React.FC<PaymentCouponBarProps> = ({
  paymentMode,
  walletBalancePaise,
  selectedCoupon,
  activeCouponCode = null,
  activeOffers = [],
  couponError = null,
  onCyclePaymentMode,
  onToggleCoupon,
  onSelectCoupon,
  onApplyCouponCode,
  onClearCoupon,
}) => {
  const [pickerVisible, setPickerVisible] = useState(false);
  const [draftCode, setDraftCode] = useState('');

  const effectiveCode = activeCouponCode ?? selectedCoupon?.code ?? null;
  const hasPicker = Boolean(onSelectCoupon || onApplyCouponCode);

  const handleOpenCoupons = () => {
    if (hasPicker) {
      setDraftCode(effectiveCode ?? '');
      setPickerVisible(true);
    } else {
      onToggleCoupon();
    }
  };

  const handleApplyDraft = () => {
    const cleaned = draftCode.trim().toUpperCase();
    if (!cleaned || !onApplyCouponCode) return;
    onApplyCouponCode(cleaned);
    setPickerVisible(false);
  };

  return (
    <View style={styles.wrapper}>
      <View style={styles.paymentRow}>
        <TouchableOpacity style={styles.paymentPill} onPress={onCyclePaymentMode}>
          <Ionicons
            name={
              paymentMode === 'WALLET'
                ? 'wallet'
                : paymentMode === 'CASH'
                ? 'cash'
                : 'card'
            }
            size={16}
            color={COLORS.primary}
          />
          <Text style={styles.paymentText}>
            {paymentMode === 'WALLET'
              ? `Wallet (${QuotesService.formatPaise(walletBalancePaise, 'INR', {
                  showDecimals: false,
                })})`
              : paymentMode}
          </Text>
          <Ionicons name="chevron-down" size={14} color={COLORS.textSecondary} />
        </TouchableOpacity>

        <TouchableOpacity
          style={[
            styles.couponPill,
            effectiveCode
              ? { backgroundColor: selectedCoupon?.badgeBg || '#FEF3C7' }
              : { backgroundColor: '#F1F5F9' },
          ]}
          onPress={handleOpenCoupons}
          activeOpacity={0.7}
        >
          <Ionicons
            name={
              effectiveCode
                ? (selectedCoupon?.icon as keyof typeof Ionicons.glyphMap) ||
                  (selectedCoupon?.type === 'PERCENT' ? 'pricetag' : 'gift')
                : 'pricetag-outline'
            }
            size={12}
            color={
              effectiveCode
                ? selectedCoupon?.badgeColor || '#B45309'
                : COLORS.textSecondary
            }
          />
          <Text
            style={[
              styles.couponText,
              {
                color: effectiveCode
                  ? selectedCoupon?.badgeColor || '#B45309'
                  : COLORS.textSecondary,
              },
            ]}
          >
            {effectiveCode
              ? effectiveCode
              : activeOffers.length > 0
              ? `Offers (${activeOffers.length})`
              : 'Apply Offer'}
          </Text>
          {effectiveCode ? (
            <TouchableOpacity
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              onPress={(e) => {
                e.stopPropagation();
                onClearCoupon();
              }}
            >
              <Ionicons
                name="close-circle"
                size={14}
                color={selectedCoupon?.badgeColor || '#B45309'}
              />
            </TouchableOpacity>
          ) : null}
        </TouchableOpacity>
      </View>

      {couponError ? (
        <View style={styles.couponErrorRow}>
          <Ionicons name="alert-circle-outline" size={14} color={COLORS.error} />
          <Text style={styles.couponErrorText}>{couponError}</Text>
        </View>
      ) : null}

      {hasPicker ? (
        <Modal
          visible={pickerVisible}
          animationType="slide"
          transparent
          onRequestClose={() => setPickerVisible(false)}
        >
          <View style={styles.modalOverlay}>
            <View style={styles.modalCard}>
              <View style={styles.modalHeader}>
                <Text style={styles.modalTitle}>Promo Code & Offers</Text>
                <TouchableOpacity onPress={() => setPickerVisible(false)}>
                  <Ionicons name="close" size={22} color={COLORS.text} />
                </TouchableOpacity>
              </View>

              {onApplyCouponCode ? (
                <View style={styles.inputRow}>
                  <TextInput
                    style={styles.codeInput}
                    value={draftCode}
                    onChangeText={setDraftCode}
                    placeholder="Enter promo code"
                    placeholderTextColor={COLORS.textSecondary}
                    autoCapitalize="characters"
                    autoCorrect={false}
                    maxLength={30}
                  />
                  <TouchableOpacity
                    style={[
                      styles.applyBtn,
                      draftCode.trim().length < 3 && styles.applyBtnDisabled,
                    ]}
                    disabled={draftCode.trim().length < 3}
                    onPress={handleApplyDraft}
                  >
                    <Text style={styles.applyBtnText}>Apply</Text>
                  </TouchableOpacity>
                </View>
              ) : null}

              <ScrollView showsVerticalScrollIndicator={false}>
                {activeOffers.length === 0 ? (
                  <Text style={styles.emptyText}>
                    No active offers available in this zone right now.
                  </Text>
                ) : (
                  activeOffers.map((offer) => {
                    const isActive = effectiveCode === offer.code;
                    const benefitText =
                      offer.description ||
                      (offer.type === 'PERCENT' && offer.value
                        ? `${(offer.value / 100).toFixed(0)}% off`
                        : offer.value
                        ? `${QuotesService.formatPaise(offer.value)} off`
                        : 'Promo discount');

                    return (
                      <TouchableOpacity
                        key={offer.id || offer.code}
                        style={[
                          styles.offerCard,
                          isActive && styles.offerCardActive,
                        ]}
                        onPress={() => {
                          if (isActive) {
                            onClearCoupon();
                          } else {
                            onSelectCoupon?.(offer);
                          }
                          setPickerVisible(false);
                        }}
                      >
                        <View style={styles.offerInfo}>
                          <Text style={styles.offerCode}>{offer.code}</Text>
                          <Text style={styles.offerDesc}>{benefitText}</Text>
                        </View>
                        <Ionicons
                          name={isActive ? 'checkmark-circle' : 'add-circle-outline'}
                          size={20}
                          color={isActive ? COLORS.primary : COLORS.textSecondary}
                        />
                      </TouchableOpacity>
                    );
                  })
                )}
              </ScrollView>
            </View>
          </View>
        </Modal>
      ) : null}
    </View>
  );
};
