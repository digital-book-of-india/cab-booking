import React, { useEffect, useMemo, useRef } from 'react';
import { StyleSheet, View } from 'react-native';
import MapView, { Marker, Polyline, type Region } from 'react-native-maps';
import { COLORS } from '../../constants/colors';
import type { LocationPoint } from '../../types/location.types';
import type { Coordinates } from '../../types/ride.types';
import { decodePolyline } from '../../utils/polyline';

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

const DEFAULT_DELTA = {
  latitudeDelta: 0.015,
  longitudeDelta: 0.015,
};

export const MapCanvas: React.FC<MapCanvasProps> = ({
  center,
  pickupPoint = null,
  dropPoint = null,
  encodedPolyline = null,
  showsUserLocation = true,
  interactive = true,
  edgePadding = { top: 48, right: 48, bottom: 48, left: 48 },
  onRegionChangeComplete,
  style,
}) => {
  const mapRef = useRef<MapView | null>(null);
  const decodedPath = useMemo(
    () => (encodedPolyline ? decodePolyline(encodedPolyline) : []),
    [encodedPolyline],
  );

  // Re-center camera when center changes and no two-point route is being framed
  useEffect(() => {
    if (pickupPoint && dropPoint) return;
    mapRef.current?.animateToRegion(
      {
        latitude: center.lat,
        longitude: center.lng,
        ...DEFAULT_DELTA,
      },
      300,
    );
  }, [center.lat, center.lng, pickupPoint, dropPoint]);

  // Fit bounds when pickup + drop (or decoded route polyline) are present
  useEffect(() => {
    if (!pickupPoint || !dropPoint || !mapRef.current) return;

    const coordsToFit =
      decodedPath.length >= 2
        ? decodedPath
        : [
            { latitude: pickupPoint.lat, longitude: pickupPoint.lng },
            { latitude: dropPoint.lat, longitude: dropPoint.lng },
          ];

    const timer = setTimeout(() => {
      mapRef.current?.fitToCoordinates(coordsToFit, {
        edgePadding,
        animated: true,
      });
    }, 120);

    return () => clearTimeout(timer);
  }, [pickupPoint, dropPoint, decodedPath, edgePadding]);

  const handleRegionComplete = (region: Region) => {
    onRegionChangeComplete?.({
      lat: region.latitude,
      lng: region.longitude,
    });
  };

  return (
    <View style={[styles.container, style]}>
      <MapView
        ref={mapRef}
        style={StyleSheet.absoluteFill}
        initialRegion={{
          latitude: center.lat,
          longitude: center.lng,
          ...DEFAULT_DELTA,
        }}
        showsUserLocation={showsUserLocation}
        showsMyLocationButton={false}
        scrollEnabled={interactive}
        zoomEnabled={interactive}
        rotateEnabled={interactive}
        pitchEnabled={false}
        onRegionChangeComplete={
          onRegionChangeComplete ? handleRegionComplete : undefined
        }
      >
        {pickupPoint ? (
          <Marker
            coordinate={{
              latitude: pickupPoint.lat,
              longitude: pickupPoint.lng,
            }}
            title="Pickup"
            description={pickupPoint.label}
            pinColor={COLORS.success}
          />
        ) : null}

        {dropPoint ? (
          <Marker
            coordinate={{
              latitude: dropPoint.lat,
              longitude: dropPoint.lng,
            }}
            title="Drop-off"
            description={dropPoint.label}
            pinColor={COLORS.error}
          />
        ) : null}

        {decodedPath.length >= 2 ? (
          <Polyline
            coordinates={decodedPath}
            strokeColor={COLORS.primary}
            strokeWidth={4}
          />
        ) : pickupPoint && dropPoint ? (
          <Polyline
            coordinates={[
              { latitude: pickupPoint.lat, longitude: pickupPoint.lng },
              { latitude: dropPoint.lat, longitude: dropPoint.lng },
            ]}
            strokeColor={COLORS.primary}
            strokeWidth={3}
            lineDashPattern={[6, 6]}
          />
        ) : null}
      </MapView>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    overflow: 'hidden',
  },
});
