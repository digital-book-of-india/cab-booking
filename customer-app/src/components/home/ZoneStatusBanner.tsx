import React from 'react';
import {
  Linking,
  Platform,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { COLORS, SPACING } from '../../constants/colors';
import type { ZoneStatusState } from '../../hooks/useZoneStatus';
import { LocationService } from '../../services/location.service';
import { styles } from '../../styles/home/ZoneStatusBanner.styles';

type ZoneBannerSpec = {
  variant: 'warning' | 'error';
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  description: string;
  actions: { label: string; onPress: () => void }[];
};

function getZoneBannerSpec(zone: ZoneStatusState): ZoneBannerSpec | null {
  const retryAction = { label: 'Retry', onPress: zone.refreshZone };
  const savedPlacesAction = {
    label: 'Saved Places',
    onPress: () => router.push('/(app)/places'),
  };

  if (zone.locationStatus === 'DETECTING') return null;

  if (zone.locationStatus === 'PERMISSION_DENIED') {
    return {
      variant: 'warning',
      icon: 'location-outline',
      title: 'Location Access Needed',
      description:
        'Enable location access to check service availability in your area.',
      actions: [
        retryAction,
        ...(Platform.OS !== 'web'
          ? [{ label: 'Open Settings', onPress: () => Linking.openSettings() }]
          : []),
        savedPlacesAction,
      ],
    };
  }

  if (zone.locationStatus === 'GPS_UNAVAILABLE') {
    return {
      variant: 'warning',
      icon: 'navigate-outline',
      title: 'GPS Unavailable',
      description:
        zone.errorMessage ??
        'Turn on location services to detect your service zone.',
      actions: [retryAction, savedPlacesAction],
    };
  }

  if (zone.locationStatus === 'CHECK_FAILED') {
    return {
      variant: 'warning',
      icon: 'cloud-offline-outline',
      title: 'Could Not Check Service Area',
      description:
        zone.errorMessage ??
        'Unable to reach the server to verify your service zone.',
      actions: [retryAction],
    };
  }

  const pickup = zone.serviceability?.pickup;
  if (!pickup || pickup.serviceable) return null;

  if (pickup.reason === 'OUTSIDE_OPERATING_HOURS') {
    return {
      variant: 'warning',
      icon: 'time-outline',
      title: 'Service Closed Right Now',
      description: LocationService.getNotServiceableMessage(
        'OUTSIDE_OPERATING_HOURS',
        'trip',
      ),
      actions: [{ label: 'Refresh', onPress: zone.refreshZone }],
    };
  }

  return {
    variant: 'error',
    icon: 'location-sharp',
    title: 'Outside Service Area',
    description: LocationService.getNotServiceableMessage(
      'OUTSIDE_SERVICE_AREA',
      'trip',
    ),
    actions: [savedPlacesAction, { label: 'Retry GPS', onPress: zone.refreshZone }],
  };
}

export type ZoneStatusBannerProps = {
  zone: ZoneStatusState;
  horizontalMargin?: number;
  marginBottom?: number;
};

export const ZoneStatusBanner: React.FC<ZoneStatusBannerProps> = ({
  zone,
  horizontalMargin = SPACING.lg,
  marginBottom = 0,
}) => {
  const banner = getZoneBannerSpec(zone);
  if (!banner) return null;

  const isError = banner.variant === 'error';

  return (
    <View
      style={[
        styles.card,
        isError ? styles.errorCard : styles.warningCard,
        { marginHorizontal: horizontalMargin, marginBottom },
      ]}
    >
      <Ionicons
        name={banner.icon}
        size={22}
        color={isError ? COLORS.error : COLORS.warning}
      />
      <View style={styles.body}>
        <Text style={[styles.title, isError ? styles.errorTitle : styles.warningTitle]}>
          {banner.title}
        </Text>
        <Text style={[styles.desc, isError ? styles.errorDesc : styles.warningDesc]}>
          {banner.description}
        </Text>
        <View style={styles.actionsRow}>
          {banner.actions.map((action) => (
            <TouchableOpacity
              key={action.label}
              style={styles.actionBtn}
              onPress={action.onPress}
              activeOpacity={0.7}
            >
              <Text style={styles.actionBtnText}>{action.label}</Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>
    </View>
  );
};
