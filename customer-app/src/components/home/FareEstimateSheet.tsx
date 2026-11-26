import React from 'react';
import {
  ActivityIndicator,
  Modal,
  ScrollView,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { COLORS } from '../../constants/colors';
import { QuotesService } from '../../services/quotes.service';
import { styles } from '../../styles/home/FareEstimateSheet.styles';
import type { FareQuote } from '../../types/quotes.types';
import { formatDistanceMeters, formatDurationSeconds } from '../../utils/polyline';

export type FareEstimateSheetProps = {
  visible: boolean;
  quote: FareQuote | null;
  categoryName?: string;
  secondsUntilExpiry: number | null;
  isExpired: boolean;
  refreshing: boolean;
  onRefresh: () => void;
  onClose: () => void;
};

function formatCountdown(seconds: number): string {
  const safe = Math.max(0, Math.floor(seconds));
  const mins = Math.floor(safe / 60);
  const secs = safe % 60;
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

export const FareEstimateSheet: React.FC<FareEstimateSheetProps> = ({
  visible,
  quote,
  categoryName,
  secondsUntilExpiry,
  isExpired,
  refreshing,
  onRefresh,
  onClose,
}) => {
  if (!quote) return null;

  const { breakdown, currency } = quote;
  const format = (paise: number) => QuotesService.formatPaise(paise, currency);

  const lines: { label: string; amountPaise: number }[] = [];
  if (breakdown.baseFarePaise > 0 || quote.tripKind === 'CITY') {
    lines.push({
      label:
        quote.tripKind === 'RENTAL' && quote.rental
          ? `Package (${quote.rental.name})`
          : 'Base Fare',
      amountPaise: breakdown.baseFarePaise,
    });
  }
  if (breakdown.distanceFarePaise > 0) {
    lines.push({ label: 'Distance Fare', amountPaise: breakdown.distanceFarePaise });
  }
  if (breakdown.timeFarePaise > 0) {
    lines.push({ label: 'Time Fare', amountPaise: breakdown.timeFarePaise });
  }
  if (breakdown.waitingFarePaise > 0) {
    lines.push({ label: 'Waiting Charge', amountPaise: breakdown.waitingFarePaise });
  }
  if (breakdown.tollEstimatePaise > 0) {
    lines.push({ label: 'Estimated Tolls', amountPaise: breakdown.tollEstimatePaise });
  }
  if (breakdown.demandAdjustmentPaise !== 0) {
    lines.push({
      label: 'Demand Adjustment',
      amountPaise: breakdown.demandAdjustmentPaise,
    });
  }
  if (breakdown.minimumFareAdjustmentPaise > 0) {
    lines.push({
      label: 'Minimum Fare Adjustment',
      amountPaise: breakdown.minimumFareAdjustmentPaise,
    });
  }
  if (breakdown.roundingAdjustmentPaise !== 0) {
    lines.push({
      label: 'Rounding Adjustment',
      amountPaise: breakdown.roundingAdjustmentPaise,
    });
  }
  if (breakdown.taxPaise > 0) {
    lines.push({ label: 'Taxes & GST', amountPaise: breakdown.taxPaise });
  }

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent
      onRequestClose={onClose}
    >
      <View style={styles.overlay}>
        <View style={styles.sheet}>
          <View style={styles.handleRow}>
            <View style={styles.handle} />
          </View>

          <View style={styles.header}>
            <View style={styles.headerLeft}>
              <View style={styles.titleRow}>
                <Text style={styles.title}>
                  {categoryName ? `${categoryName} Fare` : 'Fare Estimate'}
                </Text>
                <View style={styles.kindBadge}>
                  <Text style={styles.kindBadgeText}>{quote.tripKind}</Text>
                </View>
              </View>
              <Text style={styles.subtitle}>
                {formatDistanceMeters(quote.estimatedDistanceMeters)} •{' '}
                {formatDurationSeconds(quote.estimatedDurationSeconds)}
                {quote.stops.length > 0
                  ? ` • ${quote.stops.length} stop${quote.stops.length > 1 ? 's' : ''}`
                  : ''}
              </Text>
            </View>

            <TouchableOpacity style={styles.closeBtn} onPress={onClose}>
              <Ionicons name="close" size={18} color={COLORS.text} />
            </TouchableOpacity>
          </View>

          <ScrollView contentContainerStyle={styles.content}>
            <View
              style={[
                styles.expiryBanner,
                isExpired ? styles.expiryExpired : styles.expiryActive,
              ]}
            >
              <View style={styles.expiryLeft}>
                <Ionicons
                  name={isExpired ? 'time-outline' : 'shield-checkmark-outline'}
                  size={18}
                  color={isExpired ? COLORS.warning : COLORS.success}
                />
                <Text style={styles.expiryText}>
                  {isExpired
                    ? 'Quote expired — refresh to get latest price'
                    : secondsUntilExpiry !== null
                    ? `Price locked for ${formatCountdown(secondsUntilExpiry)}`
                    : 'Active fare quote'}
                </Text>
              </View>

              <TouchableOpacity
                style={styles.refreshBtn}
                onPress={onRefresh}
                disabled={refreshing}
              >
                {refreshing ? (
                  <ActivityIndicator size="small" color={COLORS.white} />
                ) : (
                  <>
                    <Ionicons name="refresh" size={13} color={COLORS.white} />
                    <Text style={styles.refreshBtnText}>Refresh</Text>
                  </>
                )}
              </TouchableOpacity>
            </View>

            <View style={styles.breakdownCard}>
              <Text style={styles.sectionLabel}>Fare Breakdown</Text>

              {lines.map((line) => (
                <View key={line.label} style={styles.lineRow}>
                  <Text style={styles.lineLabel}>{line.label}</Text>
                  <Text style={styles.lineValue}>{format(line.amountPaise)}</Text>
                </View>
              ))}

              {quote.coupon && quote.coupon.discountPaise > 0 ? (
                <View style={styles.lineRow}>
                  <Text style={styles.discountLabel}>
                    Promo ({quote.coupon.code})
                  </Text>
                  <Text style={styles.discountValue}>
                    -{format(quote.coupon.discountPaise)}
                  </Text>
                </View>
              ) : null}

              <View style={styles.divider} />

              <View style={styles.totalRow}>
                <Text style={styles.totalLabel}>Estimated Payable</Text>
                <Text style={styles.totalValue}>
                  {format(quote.estimatedPayablePaise)}
                </Text>
              </View>
            </View>

            {quote.rental ? (
              <View style={styles.infoCard}>
                <Text style={styles.infoTitle}>
                  Rental Package: {quote.rental.hours} hr / {quote.rental.includedKm} km
                </Text>
                <Text style={styles.infoBody}>
                  Extra distance is billed at {format(quote.rental.extraKmPaise)}/km and
                  extra time at {format(quote.rental.extraHourPaise)}/hr beyond the
                  package. Tolls and parking are paid on actuals.
                </Text>
              </View>
            ) : null}

            {quote.outstation ? (
              <View style={styles.infoCard}>
                <Text style={styles.infoTitle}>
                  Outstation (
                  {quote.outstation.tripType === 'ROUND_TRIP' ? 'Round Trip' : 'One Way'})
                </Text>
                <Text style={styles.infoBody}>
                  {quote.outstation.days} day(s)
                  {quote.outstation.nights > 0
                    ? ` • ${quote.outstation.nights} night(s)`
                    : ''}{' '}
                  • Est. {Math.round(quote.outstation.estimatedKm)} km @{' '}
                  {format(quote.outstation.perKmPaise)}/km. Tolls and parking are paid on
                  actuals.
                </Text>
              </View>
            ) : null}

            <Text style={styles.metaNote}>
              Quote {quote.quoteId}
              {quote.configVersion > 0 ? ` • Pricing v${quote.configVersion}` : ''}
            </Text>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
};
