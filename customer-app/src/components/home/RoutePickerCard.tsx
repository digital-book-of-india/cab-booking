import React from 'react';
import { ScrollView, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { COLORS } from '../../constants/colors';
import { MAX_QUOTE_STOPS } from '../../services/quotes.service';
import { styles } from '../../styles/home/RoutePickerCard.styles';
import type { LocationPoint, TripMode } from '../../types/location.types';

export type RoutePickerCardProps = {
  pickupPoint: LocationPoint | null;
  dropPoint: LocationPoint | null;
  stops?: LocationPoint[];
  activeField: 'pickup' | 'drop';
  tripMode: TripMode;
  quickLocations: LocationPoint[];
  onPressSearchField: (field: 'pickup' | 'drop') => void;
  onPressPinField: (field: 'pickup' | 'drop') => void;
  onPressStopSearch?: (stopIndex: number) => void;
  onPressStopPin?: (stopIndex: number) => void;
  onRemoveStop?: (stopIndex: number) => void;
  onSelectLocation: (point: LocationPoint) => void;
  onPressManageSavedPlaces?: () => void;
};

export const RoutePickerCard: React.FC<RoutePickerCardProps> = ({
  pickupPoint,
  dropPoint,
  stops = [],
  activeField,
  tripMode,
  quickLocations,
  onPressSearchField,
  onPressPinField,
  onPressStopSearch,
  onPressStopPin,
  onRemoveStop,
  onSelectLocation,
  onPressManageSavedPlaces,
}) => {
  const canAddStop =
    tripMode === 'CITY' &&
    Boolean(pickupPoint) &&
    Boolean(dropPoint) &&
    stops.length < MAX_QUOTE_STOPS &&
    Boolean(onPressStopSearch);

  return (
    <View>
      <View style={styles.routeBox}>
        <View
          style={[
            styles.locationInputRow,
            activeField === 'pickup' && styles.locationRowActive,
          ]}
        >
          <TouchableOpacity
            style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8 }}
            onPress={() => onPressSearchField('pickup')}
            activeOpacity={0.7}
          >
            <View style={styles.pickupDot} />
            <Text
              style={[
                styles.locationTextInput,
                { color: pickupPoint ? COLORS.text : COLORS.textSecondary },
              ]}
              numberOfLines={1}
            >
              {pickupPoint?.label ?? 'Tap to search pickup location'}
            </Text>
            <Text style={styles.fieldRoleTag}>PICKUP</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.pinIconBtn}
            onPress={() => onPressPinField('pickup')}
            accessibilityLabel="Set pickup pin on map"
          >
            <Ionicons name="map-outline" size={15} color={COLORS.primary} />
          </TouchableOpacity>
        </View>

        {tripMode === 'CITY' &&
          stops.map((stop, index) => (
            <React.Fragment key={`stop-${index}`}>
              <View style={styles.routeDivider} />
              <View style={styles.locationInputRow}>
                <TouchableOpacity
                  style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8 }}
                  onPress={() => onPressStopSearch?.(index)}
                  activeOpacity={0.7}
                >
                  <View style={styles.stopBadge}>
                    <Text style={styles.stopBadgeText}>{index + 1}</Text>
                  </View>
                  <Text style={styles.locationTextInput} numberOfLines={1}>
                    {stop.label}
                  </Text>
                </TouchableOpacity>
                {onPressStopPin ? (
                  <TouchableOpacity
                    style={styles.pinIconBtn}
                    onPress={() => onPressStopPin(index)}
                    accessibilityLabel={`Adjust stop ${index + 1} pin on map`}
                  >
                    <Ionicons name="map-outline" size={14} color={COLORS.primary} />
                  </TouchableOpacity>
                ) : null}
                {onRemoveStop ? (
                  <TouchableOpacity
                    style={styles.removeStopBtn}
                    onPress={() => onRemoveStop(index)}
                    accessibilityLabel={`Remove stop ${index + 1}`}
                  >
                    <Ionicons name="close" size={14} color={COLORS.error} />
                  </TouchableOpacity>
                ) : null}
              </View>
            </React.Fragment>
          ))}

        {tripMode !== 'RENTAL' && (
          <>
            <View style={styles.routeDivider} />
            <View
              style={[
                styles.locationInputRow,
                activeField === 'drop' && styles.locationRowActive,
              ]}
            >
              <TouchableOpacity
                style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8 }}
                onPress={() => onPressSearchField('drop')}
                activeOpacity={0.7}
              >
                <View style={styles.dropoffSquare} />
                <Text
                  style={[
                    styles.locationTextInput,
                    { color: dropPoint ? COLORS.text : COLORS.textSecondary },
                  ]}
                  numberOfLines={1}
                >
                  {dropPoint?.label ?? 'Tap to search drop-off location'}
                </Text>
                <Text style={styles.fieldRoleTag}>DROP</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.pinIconBtn}
                onPress={() => onPressPinField('drop')}
                accessibilityLabel="Set drop-off pin on map"
              >
                <Ionicons name="map-outline" size={15} color={COLORS.primary} />
              </TouchableOpacity>
            </View>
          </>
        )}
      </View>

      {canAddStop ? (
        <View style={styles.addStopRow}>
          <TouchableOpacity
            style={styles.addStopBtn}
            onPress={() => onPressStopSearch?.(stops.length)}
          >
            <Ionicons name="add" size={14} color={COLORS.primary} />
            <Text style={styles.addStopText}>
              Add Stop ({stops.length}/{MAX_QUOTE_STOPS})
            </Text>
          </TouchableOpacity>
        </View>
      ) : null}

      <Text style={styles.suggestionLabel}>
        Saved Places (tap to set {activeField === 'pickup' ? 'Pickup' : 'Drop-off'})
      </Text>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.suggestionsContainer}
      >
        {quickLocations.map((loc, i) => (
          <TouchableOpacity
            key={`${loc.label}-${i}`}
            style={styles.suggestionChip}
            onPress={() => onSelectLocation(loc)}
          >
            <Ionicons name="bookmark-outline" size={14} color={COLORS.primary} />
            <Text style={styles.suggestionChipText} numberOfLines={1}>
              {loc.label}
            </Text>
          </TouchableOpacity>
        ))}

        {quickLocations.length === 0 && onPressManageSavedPlaces ? (
          <TouchableOpacity
            style={styles.suggestionChip}
            onPress={onPressManageSavedPlaces}
          >
            <Ionicons name="add-circle-outline" size={14} color={COLORS.primary} />
            <Text style={styles.suggestionChipText}>Add Saved Place</Text>
          </TouchableOpacity>
        ) : null}
      </ScrollView>
    </View>
  );
};
