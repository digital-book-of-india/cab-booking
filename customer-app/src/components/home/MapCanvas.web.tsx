import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { COLORS, SPACING } from '../../constants/colors';
import type { LocationPoint } from '../../types/location.types';
import type { Coordinates } from '../../types/ride.types';

export type MapCanvasProps = {
  center: Coordinates;
  pickupPoint?: LocationPoint | null;
  dropPoint?: LocationPoint | null;
  encodedPolyline?: string | null;
  showsUserLocation?: boolean;
  interactive?: boolean;
  edgePadding?: { top: number; right: number; bottom: number; left: number };
  onRegionChangeComplete?: (coords: Coordinates) => void;
  style?: object;
};

export const MapCanvas: React.FC<MapCanvasProps> = ({
  center,
  pickupPoint = null,
  dropPoint = null,
  encodedPolyline = null,
  style,
}) => {
  return (
    <View style={[styles.container, style]}>
      <Ionicons name="map-outline" size={28} color={COLORS.primary} />
      <Text style={styles.title}>
        {pickupPoint && dropPoint
          ? 'Route Preview Active'
          : 'Live Map Coordinates'}
      </Text>
      <Text style={styles.coords}>
        {center.lat.toFixed(4)}, {center.lng.toFixed(4)}
      </Text>
      {pickupPoint ? (
        <Text style={styles.meta} numberOfLines={1}>
          Pickup: {pickupPoint.label}
        </Text>
      ) : null}
      {dropPoint ? (
        <Text style={styles.meta} numberOfLines={1}>
          Drop: {dropPoint.label}
        </Text>
      ) : null}
      {encodedPolyline ? (
        <Text style={styles.polylineNote}>
          Road path ready (native map tiles render on iOS/Android)
        </Text>
      ) : null}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#EFF6FF',
    alignItems: 'center',
    justifyContent: 'center',
    padding: SPACING.md,
    gap: 4,
  },
  title: {
    fontSize: 13,
    fontWeight: '700',
    color: COLORS.text,
  },
  coords: {
    fontSize: 12,
    fontWeight: '600',
    color: COLORS.primary,
  },
  meta: {
    fontSize: 11,
    color: COLORS.textSecondary,
    maxWidth: '90%',
  },
  polylineNote: {
    fontSize: 11,
    color: COLORS.success,
    fontWeight: '600',
    marginTop: 2,
  },
});
