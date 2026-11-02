import React from 'react';
import {
  Alert,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { COLORS, RADIUS, SPACING } from '../../constants/colors';
import { APP_CONFIG } from '../../constants/config';
import type { WalletRewardItem } from '../../types/payment.types';

export type RewardsSectionProps = {
  rewards: WalletRewardItem[];
};

export const RewardsSection: React.FC<RewardsSectionProps> = ({ rewards }) => {
  const cashbackItems = rewards.filter((r) => r.type === 'CASHBACK');
  const referralItems = rewards.filter((r) => r.type === 'REFERRAL');
  const couponItems = rewards.filter((r) => r.type === 'COUPON');

  const totalBonusPaise = cashbackItems.reduce((sum, r) => sum + r.amountPaise, 0);

  const handleCopyCode = (code: string) => {
    Alert.alert('Referral Code', `Share code "${code}" with your friends to earn rewards!`);
  };

  return (
    <View style={styles.container}>
      {/* Promotional Bonus Card */}
      <View style={styles.bonusHeroCard}>
        <View style={styles.bonusTop}>
          <View>
            <Text style={styles.bonusSubTitle}>WALLET PROMO BONUS</Text>
            <Text style={styles.bonusAmount}>
              {APP_CONFIG.currencySymbol}
              {(totalBonusPaise / 100).toFixed(2)}
            </Text>
          </View>
          <View style={styles.giftCircle}>
            <Ionicons name="gift" size={24} color="#FFFFFF" />
          </View>
        </View>
        <Text style={styles.bonusNote}>
          Applied automatically to discount your upcoming ride fares.
        </Text>
      </View>

      {/* Referral Program Card */}
      <View style={[styles.headerRow, { marginTop: SPACING.md }]}>
        <Text style={styles.sectionTitle}>Referral Program</Text>
      </View>

      {referralItems.map((ref) => (
        <View key={ref.id} style={styles.referralCard}>
          <View style={styles.referralHeader}>
            <View style={styles.referralIcon}>
              <Ionicons name="people" size={18} color="#10B981" />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.referralTitle}>{ref.title}</Text>
              <Text style={styles.referralDesc}>{ref.description}</Text>
            </View>
          </View>

          {ref.code && (
            <View style={styles.codeRow}>
              <Text style={styles.codeText}>{ref.code}</Text>
              <TouchableOpacity
                style={styles.copyBtn}
                onPress={() => handleCopyCode(ref.code!)}
              >
                <Ionicons name="copy-outline" size={14} color="#10B981" />
                <Text style={styles.copyBtnText}>Copy Code</Text>
              </TouchableOpacity>
            </View>
          )}
        </View>
      ))}

      {/* Available Coupons */}
      <View style={[styles.headerRow, { marginTop: SPACING.lg }]}>
        <Text style={styles.sectionTitle}>Available Coupons</Text>
      </View>

      {couponItems.length === 0 ? (
        <View style={styles.emptyCard}>
          <Text style={styles.emptyText}>No active coupons right now.</Text>
        </View>
      ) : (
        <View style={styles.cardList}>
          {couponItems.map((c) => (
            <View key={c.id} style={styles.couponCard}>
              <View style={styles.couponLeft}>
                <View style={styles.couponBadge}>
                  <Text style={styles.couponBadgeText}>{c.code || 'OFFER'}</Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.couponTitle}>{c.title}</Text>
                  <Text style={styles.couponDesc}>{c.description}</Text>
                  {c.terms && (
                    <Text style={styles.couponTerms}>
                      • {c.terms.join(' • ')}
                    </Text>
                  )}
                </View>
              </View>
            </View>
          ))}
        </View>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    paddingBottom: SPACING.lg,
  },
  bonusHeroCard: {
    backgroundColor: '#7C3AED',
    borderRadius: RADIUS.xl,
    padding: SPACING.md + 2,
    shadowColor: '#7C3AED',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 4,
  },
  bonusTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  bonusSubTitle: {
    fontSize: 10,
    fontWeight: '800',
    color: '#DDD6FE',
    letterSpacing: 0.8,
  },
  bonusAmount: {
    fontSize: 26,
    fontWeight: '900',
    color: '#FFFFFF',
    marginTop: 2,
  },
  giftCircle: {
    width: 44,
    height: 44,
    borderRadius: RADIUS.full,
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  bonusNote: {
    fontSize: 11,
    color: '#EDE9FE',
  },
  headerRow: {
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
  referralCard: {
    backgroundColor: COLORS.white,
    padding: SPACING.md,
    borderRadius: RADIUS.lg,
    borderWidth: 1,
    borderColor: COLORS.border,
    gap: 12,
  },
  referralHeader: {
    flexDirection: 'row',
    gap: 10,
    alignItems: 'center',
  },
  referralIcon: {
    width: 36,
    height: 36,
    borderRadius: RADIUS.full,
    backgroundColor: '#DCFCE7',
    justifyContent: 'center',
    alignItems: 'center',
  },
  referralTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: COLORS.text,
  },
  referralDesc: {
    fontSize: 11,
    color: COLORS.textSecondary,
    marginTop: 2,
  },
  codeRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: COLORS.background,
    padding: 8,
    borderRadius: RADIUS.md,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderStyle: 'dashed',
  },
  codeText: {
    fontSize: 13,
    fontWeight: '800',
    color: '#10B981',
    letterSpacing: 1,
  },
  copyBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  copyBtnText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#10B981',
  },
  cardList: {
    gap: 10,
  },
  couponCard: {
    backgroundColor: COLORS.white,
    padding: SPACING.md,
    borderRadius: RADIUS.lg,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  couponLeft: {
    flexDirection: 'row',
    gap: 10,
    alignItems: 'flex-start',
  },
  couponBadge: {
    backgroundColor: '#EFF6FF',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: '#BFDBFE',
  },
  couponBadgeText: {
    fontSize: 10,
    fontWeight: '800',
    color: '#2563EB',
  },
  couponTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: COLORS.text,
  },
  couponDesc: {
    fontSize: 11,
    color: COLORS.textSecondary,
    marginTop: 2,
  },
  couponTerms: {
    fontSize: 10,
    color: COLORS.textSecondary,
    marginTop: 4,
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
});
