import React from 'react';
import { ActivityIndicator, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { COLORS } from '../../constants/colors';
import type { ZoneLocationStatus } from '../../hooks/useZoneStatus';
import { styles } from '../../styles/home/HomeMap.styles';
import type { LocationPoint, RouteEstimate } from '../../types/location.types';
import type { Coordinates } from '../../types/ride.types';
import { formatDistanceMeters, formatDurationSeconds } from '../../utils/polyline';
import { MapCanvas } from './MapCanvas';

export type HomeMapProps = {
  userCoords: Coordinates | null;
  resolvedAddress?: string | null;
  locationStatus?: ZoneLocationStatus;
  pickupPoint?: LocationPoint | null;
  dropPoint?: LocationPoint | null;
  routeEstimate?: RouteEstimate | null;
  routeLoading?: boolean;
  compact?: boolean;
  onRefreshLocation?: () => void;
  onPressAdjustPin?: () => void;
  onPressSetDestination?: () => void;
};

export const HomeMap: React.FC<HomeMapProps> = ({
  userCoords,
  resolvedAddress = null,
  locationStatus = 'OK',
  pickupPoint = null,
  dropPoint = null,
  routeEstimate = null,
  routeLoading = false,
  compact = false,
  onRefreshLocation,
  onPressAdjustPin,
  onPressSetDestination,
}) => {
  const activeCenter = pickupPoint ?? userCoords ?? dropPoint;
  const containerStyle = compact ? styles.compactCard : styles.card;

  if (!activeCenter) {
    return (
      <View style={containerStyle}>
        <View style={styles.placeholderContainer}>
          {locationStatus === 'DETECTING' ? (
            <>
              <ActivityIndicator size="small" color={COLORS.primary} />
              <Text style={styles.placeholderTitle}>Finding your location...</Text>
              <Text style={styles.placeholderSub}>
                Waiting for GPS coordinates to load the map.
              </Text>
            </>
          ) : (
            <>
              <Ionicons
                name="location-outline"
                size={26}
                color={COLORS.warning}
              />
              <Text style={styles.placeholderTitle}>
                {locationStatus === 'PERMISSION_DENIED'
                  ? 'Location Permission Needed'
                  : 'Map Waiting for Coordinates'}
              </Text>
              <Text style={styles.placeholderSub}>
                Enable GPS or pick a location manually to preview routes.
              </Text>
              {onRefreshLocation ? (
                <TouchableOpacity
                  style={styles.retryBtn}
                  onPress={onRefreshLocation}
                >
                  <Text style={styles.retryBtnText}>Detect Location</Text>
                </TouchableOpacity>
              ) : null}
            </>
          )}
        </View>
      </View>
    );
  }

  const routeSummaryText = routeLoading
    ? 'Calculating route preview...'
    : routeEstimate
    ? `${formatDistanceMeters(routeEstimate.distanceMeters)} • ~${formatDurationSeconds(
        routeEstimate.durationSeconds,
      )} est.`
    : resolvedAddress || pickupPoint?.label || 'GPS position ready';

  return (
    <View style={containerStyle}>
      <MapCanvas
        center={activeCenter}
        pickupPoint={pickupPoint}
        dropPoint={dropPoint}
        encodedPolyline={routeEstimate?.polyline ?? null}
        interactive={!compact}
        showsUserLocation
      />

      {/* Top map controls */}
      <View style={styles.topControls}>
        {onPressAdjustPin ? (
          <TouchableOpacity
            style={styles.mapControlBtn}
            onPress={onPressAdjustPin}
            activeOpacity={0.8}
          >
            <Ionicons name="pin-outline" size={13} color={COLORS.primary} />
            <Text style={styles.mapControlText}>Adjust Pin</Text>
          </TouchableOpacity>
        ) : null}

        {onRefreshLocation ? (
          <TouchableOpacity
            style={styles.mapControlBtn}
            onPress={onRefreshLocation}
            activeOpacity={0.8}
          >
            <Ionicons name="locate" size={14} color={COLORS.primary} />
          </TouchableOpacity>
        ) : null}
      </View>

      {/* Bottom status / route preview pill */}
      <View style={styles.bottomOverlayPill}>
        <View style={styles.bottomLeft}>
          {routeLoading ? (
            <ActivityIndicator size="small" color={COLORS.white} />
          ) : (
            <View style={styles.statusDot} />
          )}
          <Text style={styles.bottomPrimaryText} numberOfLines={1}>
            {routeSummaryText}
          </Text>
        </View>

        {!dropPoint && onPressSetDestination ? (
          <TouchableOpacity onPress={onPressSetDestination}>
            <Text style={styles.bottomActionText}>Set Drop ›</Text>
          </TouchableOpacity>
        ) : null}
      </View>
    </View>
  );
};
