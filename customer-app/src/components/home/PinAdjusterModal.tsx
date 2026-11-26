import React from 'react';
import {
  ActivityIndicator,
  Modal,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { COLORS } from '../../constants/colors';
import { usePinAdjuster } from '../../hooks/usePinAdjuster';
import { LocationService } from '../../services/location.service';
import { styles } from '../../styles/home/PinAdjusterModal.styles';
import type { LocationPoint } from '../../types/location.types';
import type { Coordinates } from '../../types/ride.types';
import { formatCoordinatesLabel } from '../../utils/polyline';
import { AppButton } from '../common/AppButton';
import { MapCanvas } from './MapCanvas';

export type PinAdjusterModalProps = {
  visible: boolean;
  field: 'pickup' | 'drop';
  initialCoords: Coordinates | null;
  checkServiceability?: boolean;
  onConfirm: (field: 'pickup' | 'drop', point: LocationPoint) => void;
  onClose: () => void;
};

export const PinAdjusterModal: React.FC<PinAdjusterModalProps> = ({
  visible,
  field,
  initialCoords,
  checkServiceability = true,
  onConfirm,
  onClose,
}) => {
  const pin = usePinAdjuster({
    visible,
    initialCoords,
    checkServiceability,
  });

  const handleConfirm = () => {
    const point = pin.buildConfirmedPoint();
    if (!point) return;
    onConfirm(field, point);
    onClose();
  };

  const zoneSide = pin.serviceability?.pickup;

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <SafeAreaView style={styles.container}>
        <View style={styles.header}>
          <Text style={styles.headerTitle}>
            {field === 'pickup' ? 'Adjust Pickup Pin' : 'Adjust Drop-off Pin'}
          </Text>
          <TouchableOpacity style={styles.closeBtn} onPress={onClose}>
            <Ionicons name="close" size={20} color={COLORS.text} />
          </TouchableOpacity>
        </View>

        <View style={styles.mapArea}>
          {pin.coords ? (
            <>
              <MapCanvas
                center={pin.coords}
                interactive
                showsUserLocation
                onRegionChangeComplete={pin.handleRegionChange}
              />

              {/* Fixed Center Pin */}
              <View style={styles.centerPinOverlay} pointerEvents="none">
                <Ionicons
                  name="location-sharp"
                  size={36}
                  color={field === 'pickup' ? COLORS.success : COLORS.error}
                />
                <View style={styles.pinShadow} />
              </View>

              {/* Recenter to GPS */}
              <TouchableOpacity
                style={styles.recenterBtn}
                onPress={pin.recenterToCurrentGps}
                disabled={pin.locatingGps}
              >
                {pin.locatingGps ? (
                  <ActivityIndicator size="small" color={COLORS.primary} />
                ) : (
                  <Ionicons name="locate" size={20} color={COLORS.primary} />
                )}
              </TouchableOpacity>
            </>
          ) : (
            <View style={styles.emptyGpsState}>
              {pin.locatingGps ? (
                <>
                  <ActivityIndicator size="large" color={COLORS.primary} />
                  <Text style={styles.emptyGpsTitle}>
                    Locating your current position...
                  </Text>
                </>
              ) : (
                <>
                  <Ionicons
                    name="navigate-outline"
                    size={32}
                    color={COLORS.warning}
                  />
                  <Text style={styles.emptyGpsTitle}>
                    GPS Position Unavailable
                  </Text>
                  <Text style={styles.emptyGpsSub}>
                    {pin.addressError ??
                      'Enable location access or search an address to pick coordinates.'}
                  </Text>
                  <AppButton
                    title="Retry GPS"
                    onPress={pin.recenterToCurrentGps}
                  />
                </>
              )}
            </View>
          )}
        </View>

        <View style={styles.bottomCard}>
          <View style={styles.addressRow}>
            <Ionicons
              name="pin"
              size={20}
              color={field === 'pickup' ? COLORS.success : COLORS.error}
            />
            <View style={styles.addressBody}>
              <Text style={styles.addressLabel}>
                {field === 'pickup' ? 'Selected Pickup' : 'Selected Drop-off'}
              </Text>
              {pin.resolvingAddress ? (
                <Text style={styles.addressValue}>Resolving address...</Text>
              ) : (
                <Text style={styles.addressValue} numberOfLines={2}>
                  {pin.address ??
                    (pin.coords
                      ? formatCoordinatesLabel(pin.coords)
                      : 'No location selected')}
                </Text>
              )}
              {pin.coords ? (
                <Text style={styles.coordsCaption}>
                  {pin.coords.lat.toFixed(5)}, {pin.coords.lng.toFixed(5)}
                </Text>
              ) : null}
            </View>
          </View>

          {checkServiceability && zoneSide ? (
            <View
              style={[
                styles.zonePill,
                zoneSide.serviceable ? styles.zonePillOk : styles.zonePillWarn,
              ]}
            >
              <Ionicons
                name={zoneSide.serviceable ? 'checkmark-circle' : 'alert-circle'}
                size={15}
                color={zoneSide.serviceable ? COLORS.success : COLORS.error}
              />
              <Text
                style={[
                  styles.zonePillText,
                  { color: zoneSide.serviceable ? COLORS.success : COLORS.error },
                ]}
              >
                {zoneSide.serviceable
                  ? `Serviceable in ${zoneSide.zoneName}`
                  : LocationService.getNotServiceableMessage(
                      zoneSide.reason,
                      field,
                    )}
              </Text>
            </View>
          ) : null}

          {pin.addressError && pin.coords ? (
            <View style={styles.errorRow}>
              <Text style={styles.errorText}>{pin.addressError}</Text>
              <TouchableOpacity onPress={pin.retryResolve}>
                <Text style={styles.retryLink}>Retry</Text>
              </TouchableOpacity>
            </View>
          ) : null}

          <AppButton
            title={
              field === 'pickup' ? 'Confirm Pickup Pin' : 'Confirm Drop-off Pin'
            }
            disabled={!pin.coords || pin.resolvingAddress}
            onPress={handleConfirm}
          />
        </View>
      </SafeAreaView>
    </Modal>
  );
};
