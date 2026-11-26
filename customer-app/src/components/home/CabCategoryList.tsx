import React from 'react';
import { ActivityIndicator, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { COLORS } from '../../constants/colors';
import type { DisplayCategory } from '../../hooks/useRideBookingSheet';
import { QuotesService } from '../../services/quotes.service';
import { styles } from '../../styles/home/CabCategoryList.styles';
import type { FareQuote } from '../../types/quotes.types';
import { formatDistanceMeters, formatDurationSeconds } from '../../utils/polyline';

export type CabCategoryListProps = {
  zoneName?: string;
  loading: boolean;
  categories: DisplayCategory[];
  selectedCategoryId?: string;
  onSelectCategory: (categoryId: string) => void;
  quotesByCategory?: Record<string, FareQuote>;
  quotesLoading?: boolean;
  isSelectedQuoteExpired?: boolean;
  onOpenFareDetails?: () => void;
};

export const CabCategoryList: React.FC<CabCategoryListProps> = ({
  zoneName,
  loading,
  categories,
  selectedCategoryId,
  onSelectCategory,
  quotesByCategory = {},
  quotesLoading = false,
  isSelectedQuoteExpired = false,
  onOpenFareDetails,
}) => {
  return (
    <View>
      <Text style={styles.sectionTitle}>
        {zoneName ? `Available Cabs in ${zoneName}` : 'Available Cabs'}
      </Text>

      {loading && categories.length === 0 ? (
        <View style={styles.statusBox}>
          <ActivityIndicator size="small" color={COLORS.primary} />
          <Text style={styles.statusText}>Loading cab categories...</Text>
        </View>
      ) : categories.length === 0 ? (
        <View style={styles.statusBox}>
          <Ionicons name="car-outline" size={24} color={COLORS.textSecondary} />
          <Text style={styles.statusText}>
            No cab categories available for this zone.
          </Text>
        </View>
      ) : (
        categories.map((cat) => {
          const isSelected = selectedCategoryId === cat.id && cat.available;
          const quote = quotesByCategory[cat.id];
          const hasDiscount =
            Boolean(quote?.coupon) && (quote?.coupon?.discountPaise ?? 0) > 0;

          return (
            <TouchableOpacity
              key={cat.id}
              style={[
                styles.vehicleCard,
                isSelected && styles.vehicleCardSelected,
                !cat.available && styles.vehicleCardDisabled,
              ]}
              onPress={() => {
                if (cat.available) onSelectCategory(cat.id);
              }}
              disabled={!cat.available}
              activeOpacity={0.7}
            >
              <View style={styles.vehicleLeft}>
                <View
                  style={[
                    styles.vehicleIconBox,
                    isSelected && styles.vehicleIconBoxSelected,
                  ]}
                >
                  <Ionicons
                    name={cat.icon}
                    size={24}
                    color={
                      !cat.available
                        ? COLORS.disabled
                        : isSelected
                        ? COLORS.primary
                        : COLORS.text
                    }
                  />
                </View>

                <View style={styles.vehicleInfo}>
                  <View style={styles.vehicleNameRow}>
                    <Text style={styles.vehicleName}>{cat.name}</Text>
                    {cat.available && cat.tag ? (
                      <View style={styles.tagBadge}>
                        <Text style={styles.tagBadgeText}>{cat.tag}</Text>
                      </View>
                    ) : null}
                    {!cat.available ? (
                      <View style={styles.unavailableBadge}>
                        <Text style={styles.unavailableBadgeText}>
                          Unavailable in zone
                        </Text>
                      </View>
                    ) : null}
                  </View>
                  <Text style={styles.vehicleMeta} numberOfLines={1}>
                    {quote
                      ? `${formatDurationSeconds(
                          quote.estimatedDurationSeconds,
                        )} • ${formatDistanceMeters(
                          quote.estimatedDistanceMeters,
                        )}`
                      : cat.desc}
                  </Text>
                </View>
              </View>

              <View style={styles.vehicleRight}>
                {!cat.available ? (
                  <Text style={styles.vehicleMeta}>N/A</Text>
                ) : quotesLoading && !quote ? (
                  <ActivityIndicator size="small" color={COLORS.primary} />
                ) : quote ? (
                  <>
                    <Text style={styles.priceText}>
                      {QuotesService.formatPaise(
                        quote.estimatedPayablePaise,
                        quote.currency,
                      )}
                    </Text>
                    {hasDiscount ? (
                      <Text style={styles.strikePriceText}>
                        {QuotesService.formatPaise(
                          quote.breakdown.estimatedTotalPaise,
                          quote.currency,
                        )}
                      </Text>
                    ) : null}
                    {isSelected && onOpenFareDetails ? (
                      <TouchableOpacity
                        style={styles.detailsChip}
                        onPress={(e) => {
                          e.stopPropagation();
                          onOpenFareDetails();
                        }}
                        hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
                      >
                        <Text style={styles.detailsChipText}>
                          {isSelectedQuoteExpired ? 'Expired' : 'Breakdown'}
                        </Text>
                        <Ionicons
                          name="chevron-forward"
                          size={10}
                          color={COLORS.primaryDark}
                        />
                      </TouchableOpacity>
                    ) : null}
                  </>
                ) : (
                  <Text style={styles.vehicleMeta}>Ready</Text>
                )}
              </View>
            </TouchableOpacity>
          );
        })
      )}
    </View>
  );
};
