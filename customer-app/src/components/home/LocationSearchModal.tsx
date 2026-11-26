import React, { useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Modal,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { COLORS } from '../../constants/colors';
import { useLocationSearch } from '../../hooks/useLocationSearch';
import { LocationService } from '../../services/location.service';
import { styles } from '../../styles/home/LocationSearchModal.styles';
import type { SavedPlace } from '../../types/customer.types';
import type {
  LocationPoint,
  PlaceSuggestion,
  TripMode,
} from '../../types/location.types';
import type { Coordinates } from '../../types/ride.types';
import { formatCoordinatesLabel } from '../../utils/polyline';

export type LocationSearchModalProps = {
  visible: boolean;
  initialField: 'pickup' | 'drop';
  pickupPoint: LocationPoint | null;
  dropPoint: LocationPoint | null;
  currentCoords: Coordinates | null;
  savedPlaces: SavedPlace[];
  tripMode?: TripMode;
  singleFieldMode?: boolean;
  onSelectPoint: (field: 'pickup' | 'drop', point: LocationPoint) => void;
  onOpenMapPicker: (field: 'pickup' | 'drop') => void;
  onClose: () => void;
};

type InnerProps = Omit<LocationSearchModalProps, 'visible'>;

const LocationSearchContent: React.FC<InnerProps> = ({
  initialField,
  pickupPoint,
  dropPoint,
  currentCoords,
  savedPlaces,
  tripMode = 'CITY',
  singleFieldMode = false,
  onSelectPoint,
  onOpenMapPicker,
  onClose,
}) => {
  const [activeField, setActiveField] = useState<'pickup' | 'drop'>(initialField);
  const [locatingCurrent, setLocatingCurrent] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);

  const search = useLocationSearch({ near: currentCoords });

  const handleSwitchField = (field: 'pickup' | 'drop') => {
    setActiveField(field);
    setLocalError(null);
    const point = field === 'pickup' ? pickupPoint : dropPoint;
    search.setQuery(point?.label ?? '');
  };

  const handleClose = () => {
    search.resetSearch();
    onClose();
  };

  const handlePickSuggestion = async (item: PlaceSuggestion) => {
    setLocalError(null);
    const point = await search.selectSuggestion(item);
    if (!point) return;

    onSelectPoint(activeField, point);

    if (
      !singleFieldMode &&
      activeField === 'pickup' &&
      tripMode !== 'RENTAL' &&
      !dropPoint
    ) {
      setActiveField('drop');
      search.setQuery('');
      return;
    }
    handleClose();
  };

  const handlePickSavedPlace = (place: SavedPlace) => {
    const point: LocationPoint = {
      lat: place.lat,
      lng: place.lng,
      label: place.name || place.address,
      address: place.address,
    };
    onSelectPoint(activeField, point);

    if (
      !singleFieldMode &&
      activeField === 'pickup' &&
      tripMode !== 'RENTAL' &&
      !dropPoint
    ) {
      setActiveField('drop');
      search.setQuery('');
      return;
    }
    handleClose();
  };

  const handleUseCurrentLocation = async () => {
    setLocatingCurrent(true);
    setLocalError(null);
    try {
      const gps = currentCoords
        ? { status: 'OK' as const, coords: currentCoords }
        : await LocationService.getCurrentLocation();

      if (gps.status !== 'OK') {
        setLocalError(
          gps.status === 'PERMISSION_DENIED'
            ? 'Location permission is required to use your current spot.'
            : gps.message,
        );
        return;
      }

      let resolvedAddress: string | null = null;
      try {
        resolvedAddress = await LocationService.reverseGeocode(gps.coords);
      } catch {
        resolvedAddress = null;
      }

      const point: LocationPoint = {
        lat: gps.coords.lat,
        lng: gps.coords.lng,
        label: resolvedAddress?.trim() || formatCoordinatesLabel(gps.coords),
        ...(resolvedAddress?.trim() ? { address: resolvedAddress.trim() } : {}),
      };

      onSelectPoint(activeField, point);

      if (
        !singleFieldMode &&
        activeField === 'pickup' &&
        tripMode !== 'RENTAL' &&
        !dropPoint
      ) {
        setActiveField('drop');
        search.setQuery('');
        return;
      }
      handleClose();
    } finally {
      setLocatingCurrent(false);
    }
  };

  const showDropRow =
    (!singleFieldMode && tripMode !== 'RENTAL') ||
    (singleFieldMode && initialField === 'drop');
  const showPickupRow = !singleFieldMode || initialField === 'pickup';
  const activeQueryTrimmed = search.query.trim();
  const displayError = localError || search.error;

  const getSavedPlaceIcon = (
    type: SavedPlace['type'],
  ): keyof typeof Ionicons.glyphMap => {
    if (type === 'home') return 'home-outline';
    if (type === 'work') return 'briefcase-outline';
    return 'bookmark-outline';
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>
          {singleFieldMode
            ? 'Search Address'
            : activeField === 'pickup'
            ? 'Set Pickup Location'
            : 'Set Drop-off Location'}
        </Text>
        <TouchableOpacity style={styles.closeBtn} onPress={handleClose}>
          <Ionicons name="close" size={20} color={COLORS.text} />
        </TouchableOpacity>
      </View>

      <View style={styles.inputsCard}>
        {showPickupRow && (
          <TouchableOpacity
            style={[
              styles.inputRow,
              activeField === 'pickup' && styles.inputRowActive,
            ]}
            activeOpacity={1}
            onPress={() => handleSwitchField('pickup')}
          >
            <View style={styles.pickupDot} />
            {activeField === 'pickup' ? (
              <TextInput
                style={styles.textInput}
                placeholder="Search pickup area, street or landmark"
                placeholderTextColor={COLORS.textSecondary}
                value={search.query}
                onChangeText={search.setQuery}
                autoFocus
                returnKeyType="search"
              />
            ) : (
              <Text
                style={[
                  styles.textInput,
                  !pickupPoint && { color: COLORS.textSecondary },
                ]}
                numberOfLines={1}
              >
                {pickupPoint?.label ?? 'Tap to enter pickup location'}
              </Text>
            )}
            {activeField === 'pickup' && search.query.length > 0 && (
              <TouchableOpacity
                style={styles.clearIconBtn}
                onPress={() => search.setQuery('')}
              >
                <Ionicons
                  name="close-circle"
                  size={18}
                  color={COLORS.textSecondary}
                />
              </TouchableOpacity>
            )}
          </TouchableOpacity>
        )}

        {showDropRow && (
          <TouchableOpacity
            style={[
              styles.inputRow,
              activeField === 'drop' && styles.inputRowActive,
            ]}
            activeOpacity={1}
            onPress={() => handleSwitchField('drop')}
          >
            <View style={styles.dropSquare} />
            {activeField === 'drop' ? (
              <TextInput
                style={styles.textInput}
                placeholder="Where are you going?"
                placeholderTextColor={COLORS.textSecondary}
                value={search.query}
                onChangeText={search.setQuery}
                autoFocus={initialField === 'drop'}
                returnKeyType="search"
              />
            ) : (
              <Text
                style={[
                  styles.textInput,
                  !dropPoint && { color: COLORS.textSecondary },
                ]}
                numberOfLines={1}
              >
                {dropPoint?.label ?? 'Tap to enter drop-off location'}
              </Text>
            )}
            {activeField === 'drop' && search.query.length > 0 && (
              <TouchableOpacity
                style={styles.clearIconBtn}
                onPress={() => search.setQuery('')}
              >
                <Ionicons
                  name="close-circle"
                  size={18}
                  color={COLORS.textSecondary}
                />
              </TouchableOpacity>
            )}
          </TouchableOpacity>
        )}
      </View>

      <View style={styles.quickActionsRow}>
        <TouchableOpacity
          style={styles.quickActionBtn}
          onPress={handleUseCurrentLocation}
          disabled={locatingCurrent}
        >
          {locatingCurrent ? (
            <ActivityIndicator size="small" color={COLORS.primary} />
          ) : (
            <Ionicons name="locate" size={16} color={COLORS.primary} />
          )}
          <Text style={styles.quickActionText}>Use Current GPS</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.quickActionBtn}
          onPress={() => {
            handleClose();
            onOpenMapPicker(activeField);
          }}
        >
          <Ionicons name="map-outline" size={16} color={COLORS.primary} />
          <Text style={styles.quickActionText}>Set on Map</Text>
        </TouchableOpacity>
      </View>

      {displayError ? (
        <View style={styles.errorBanner}>
          <Ionicons name="alert-circle" size={16} color={COLORS.error} />
          <Text style={styles.errorText}>{displayError}</Text>
        </View>
      ) : null}

      {activeQueryTrimmed.length >= 2 ? (
        <FlatList
          data={search.suggestions}
          keyExtractor={(item) => item.placeId}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={styles.listContent}
          ListHeaderComponent={
            search.searching ? (
              <View style={styles.loadingRow}>
                <ActivityIndicator size="small" color={COLORS.primary} />
                <Text style={styles.loadingText}>Searching places...</Text>
              </View>
            ) : search.suggestions.length > 0 ? (
              <Text style={styles.sectionHeader}>Search Results</Text>
            ) : undefined
          }
          renderItem={({ item }) => {
            const isResolving = search.resolvingPlaceId === item.placeId;
            return (
              <TouchableOpacity
                style={styles.resultRow}
                onPress={() => handlePickSuggestion(item)}
                disabled={Boolean(search.resolvingPlaceId)}
              >
                <View style={styles.resultIconBox}>
                  {isResolving ? (
                    <ActivityIndicator size="small" color={COLORS.primary} />
                  ) : (
                    <Ionicons
                      name="location-outline"
                      size={18}
                      color={COLORS.text}
                    />
                  )}
                </View>
                <View style={styles.resultTextWrap}>
                  <Text style={styles.resultMainText} numberOfLines={1}>
                    {item.mainText}
                  </Text>
                  {item.secondaryText ? (
                    <Text style={styles.resultSecondaryText} numberOfLines={1}>
                      {item.secondaryText}
                    </Text>
                  ) : null}
                </View>
              </TouchableOpacity>
            );
          }}
          ListEmptyComponent={
            !search.searching && !displayError ? (
              <View style={styles.emptyBox}>
                <Ionicons
                  name="search-outline"
                  size={26}
                  color={COLORS.textSecondary}
                />
                <Text style={styles.emptyTitle}>No matching places found</Text>
                <Text style={styles.emptySub}>
                  Try another search term or tap &ldquo;Set on Map&rdquo; to drop a pin.
                </Text>
              </View>
            ) : undefined
          }
        />
      ) : (
        <FlatList
          data={savedPlaces}
          keyExtractor={(item) => item.id}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={styles.listContent}
          ListHeaderComponent={
            <Text style={styles.sectionHeader}>Saved Places</Text>
          }
          renderItem={({ item }) => (
            <TouchableOpacity
              style={styles.resultRow}
              onPress={() => handlePickSavedPlace(item)}
            >
              <View style={styles.resultIconBox}>
                <Ionicons
                  name={getSavedPlaceIcon(item.type)}
                  size={18}
                  color={COLORS.primary}
                />
              </View>
              <View style={styles.resultTextWrap}>
                <Text style={styles.resultMainText} numberOfLines={1}>
                  {item.name}
                </Text>
                <Text style={styles.resultSecondaryText} numberOfLines={1}>
                  {item.address}
                </Text>
              </View>
            </TouchableOpacity>
          )}
          ListEmptyComponent={
            <View style={styles.emptyBox}>
              <Ionicons
                name="bookmark-outline"
                size={26}
                color={COLORS.textSecondary}
              />
              <Text style={styles.emptyTitle}>
                Type at least 2 characters to search
              </Text>
              <Text style={styles.emptySub}>
                Or use your current GPS / drop a pin directly on the map.
              </Text>
            </View>
          }
        />
      )}
    </SafeAreaView>
  );
};

export const LocationSearchModal: React.FC<LocationSearchModalProps> = ({
  visible,
  ...rest
}) => {
  return (
    <Modal visible={visible} animationType="slide" onRequestClose={rest.onClose}>
      {visible ? (
        <LocationSearchContent
          key={`${rest.initialField}-${rest.singleFieldMode ? '1' : '2'}`}
          {...rest}
        />
      ) : null}
    </Modal>
  );
};
