import React from 'react';
import { ActivityIndicator, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { COLORS } from '../../constants/colors';
import { LocationService } from '../../services/location.service';
import { styles } from '../../styles/home/ServiceabilityAlert.styles';
import type {
  LocationPoint,
  OutstationOptionItem,
  RentalPackageItem,
  ServiceabilityResponse,
  TripMode,
} from '../../types/location.types';

export type ServiceabilityAlertProps = {
  pickupPoint: LocationPoint | null;
  dropPoint: LocationPoint | null;
  tripMode: TripMode;
  checkingServiceability: boolean;
  tripModeLoading: boolean;
  routeLoading?: boolean;
  serviceabilityError: string | null;
  tripModeError: string | null;
  routeError?: string | null;
  serviceabilityResult: ServiceabilityResponse | null;
  rentalPackages: RentalPackageItem[] | null;
  outstationOptions: OutstationOptionItem[] | null;
  onRetry: () => void;
};

type AlertSpec = {
  variant: 'info' | 'warning' | 'error';
  icon?: keyof typeof Ionicons.glyphMap;
  loading?: boolean;
  message: string;
  showRetry?: boolean;
};

function getAlertSpec(props: ServiceabilityAlertProps): AlertSpec | null {
  const {
    pickupPoint,
    dropPoint,
    tripMode,
    checkingServiceability,
    tripModeLoading,
    routeLoading = false,
    serviceabilityError,
    tripModeError,
    routeError = null,
    serviceabilityResult,
    rentalPackages,
    outstationOptions,
  } = props;

  if (!pickupPoint) {
    return {
      variant: 'info',
      icon: 'location-outline',
      message: 'Select a pickup location above to check zone serviceability.',
    };
  }

  if (checkingServiceability || tripModeLoading || routeLoading) {
    return {
      variant: 'info',
      loading: true,
      message: 'Checking route & service availability...',
    };
  }

  if (routeError) {
    return {
      variant: 'error',
      icon: 'alert-circle-outline',
      message: routeError,
      showRetry: true,
    };
  }

  if (serviceabilityError) {
    return {
      variant: 'warning',
      icon: 'cloud-offline-outline',
      message: serviceabilityError,
      showRetry: true,
    };
  }

  const pickup = serviceabilityResult?.pickup;
  if (pickup && !pickup.serviceable) {
    return {
      variant: pickup.reason === 'OUTSIDE_OPERATING_HOURS' ? 'warning' : 'error',
      icon: pickup.reason === 'OUTSIDE_OPERATING_HOURS' ? 'time-outline' : 'alert-circle',
      message: LocationService.getNotServiceableMessage(pickup.reason, 'pickup'),
    };
  }

  const drop = serviceabilityResult?.drop;
  if (tripMode !== 'RENTAL' && dropPoint && drop && !drop.serviceable) {
    return {
      variant: drop.reason === 'OUTSIDE_OPERATING_HOURS' ? 'warning' : 'error',
      icon: drop.reason === 'OUTSIDE_OPERATING_HOURS' ? 'time-outline' : 'alert-circle',
      message: LocationService.getNotServiceableMessage(drop.reason, 'drop'),
    };
  }

  if (tripModeError) {
    return {
      variant: 'warning',
      icon: 'alert-circle-outline',
      message: tripModeError,
      showRetry: true,
    };
  }

  if (tripMode === 'RENTAL' && rentalPackages && rentalPackages.length === 0) {
    return {
      variant: 'warning',
      icon: 'time-outline',
      message: 'Hourly rentals are not available in this zone right now.',
    };
  }

  if (tripMode === 'OUTSTATION' && outstationOptions && outstationOptions.length === 0) {
    return {
      variant: 'warning',
      icon: 'navigate-outline',
      message: 'Outstation trips are not available from this zone right now.',
    };
  }

  return null;
}

export const ServiceabilityAlert: React.FC<ServiceabilityAlertProps> = (props) => {
  const spec = getAlertSpec(props);
  if (!spec) return null;

  const bannerStyle =
    spec.variant === 'error'
      ? styles.errorBanner
      : spec.variant === 'warning'
      ? styles.warningBanner
      : styles.infoBanner;

  const iconColor =
    spec.variant === 'error'
      ? COLORS.error
      : spec.variant === 'warning'
      ? COLORS.warning
      : COLORS.primary;

  return (
    <View style={[styles.banner, bannerStyle]}>
      {spec.loading ? (
        <ActivityIndicator size="small" color={COLORS.primary} />
      ) : spec.icon ? (
        <Ionicons name={spec.icon} size={18} color={iconColor} />
      ) : null}

      <Text style={styles.text}>{spec.message}</Text>

      {spec.showRetry && (
        <TouchableOpacity style={styles.retryBtn} onPress={props.onRetry}>
          <Text style={styles.retryText}>Retry</Text>
        </TouchableOpacity>
      )}
    </View>
  );
};
