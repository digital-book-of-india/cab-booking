import React, { useEffect, useState } from 'react';
import {
  Modal,
  Text,
  TouchableOpacity,
  TouchableWithoutFeedback,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { COLORS } from '../../constants/colors';
import { LocationService } from '../../services/location.service';
import type {
  CreateSavedPlaceInput,
  SavedPlace,
  SavedPlaceType,
} from '../../types/customer.types';
import type { LocationPoint } from '../../types/location.types';
import type { Coordinates } from '../../types/ride.types';
import { AppButton } from '../common/AppButton';
import { AppInput } from '../common/AppInput';
import { LocationSearchModal } from '../home/LocationSearchModal';
import { PinAdjusterModal } from '../home/PinAdjusterModal';
import { styles } from './PlaceModal.styles';

export type PlaceModalProps = {
  visible: boolean;
  placeToEdit?: SavedPlace | null;
  onClose: () => void;
  onSubmit: (input: CreateSavedPlaceInput) => Promise<void>;
  isLoading?: boolean;
};

const PLACE_TYPES: { type: SavedPlaceType; icon: keyof typeof Ionicons.glyphMap }[] = [
  { type: 'home', icon: 'home' },
  { type: 'work', icon: 'briefcase' },
  { type: 'other', icon: 'location' },
];

type InnerPlaceFormProps = Omit<PlaceModalProps, 'visible'>;

const PlaceModalContent: React.FC<InnerPlaceFormProps> = ({
  placeToEdit,
  onClose,
  onSubmit,
  isLoading = false,
}) => {
  const [name, setName] = useState(placeToEdit?.name ?? '');
  const [address, setAddress] = useState(placeToEdit?.address ?? '');
  const [type, setType] = useState<SavedPlaceType>(placeToEdit?.type ?? 'home');
  const [coords, setCoords] = useState<Coordinates | null>(
    placeToEdit ? { lat: placeToEdit.lat, lng: placeToEdit.lng } : null,
  );
  const [currentGps, setCurrentGps] = useState<Coordinates | null>(null);
  const [searchVisible, setSearchVisible] = useState(false);
  const [pinVisible, setPinVisible] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    LocationService.getCurrentLocation().then((res) => {
      if (active && res.status === 'OK') {
        setCurrentGps(res.coords);
      }
    });
    return () => {
      active = false;
    };
  }, []);

  const handlePickedLocation = (_field: 'pickup' | 'drop', point: LocationPoint) => {
    setCoords({ lat: point.lat, lng: point.lng });
    setAddress(point.address || point.label);
    if (!name.trim() && point.label) {
      setName(point.label.split(',')[0].trim());
    }
    setError(null);
  };

  const handleSubmit = async () => {
    if (!name.trim()) {
      setError('Please provide a name for this place (e.g. My Home, Studio)');
      return;
    }
    if (!address.trim() || !coords) {
      setError('Please search or pick a location on the map to set real coordinates.');
      return;
    }

    try {
      setError(null);
      await onSubmit({
        name: name.trim(),
        type,
        address: address.trim(),
        lat: coords.lat,
        lng: coords.lng,
      });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save place');
    }
  };

  return (
    <TouchableWithoutFeedback onPress={onClose}>
      <View style={styles.modalOverlay}>
        <TouchableWithoutFeedback>
          <View style={styles.modalContent}>
            <View style={styles.header}>
              <Text style={styles.title}>
                {placeToEdit ? 'Edit Saved Place' : 'Add New Place'}
              </Text>
              <TouchableOpacity onPress={onClose}>
                <Ionicons name="close" size={24} color={COLORS.textSecondary} />
              </TouchableOpacity>
            </View>

            <View style={styles.typeRow}>
              {PLACE_TYPES.map((item) => (
                <TouchableOpacity
                  key={item.type}
                  style={[styles.typeButton, type === item.type && styles.typeButtonActive]}
                  onPress={() => setType(item.type)}
                >
                  <Ionicons
                    name={item.icon}
                    size={18}
                    color={type === item.type ? COLORS.primary : COLORS.textSecondary}
                  />
                  <Text
                    style={[styles.typeText, type === item.type && styles.typeTextActive]}
                  >
                    {item.type}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            <AppInput
              label="Place Name"
              placeholder="e.g. My Apartment, Branch Office"
              value={name}
              onChangeText={setName}
            />

            <Text style={styles.addressLabel}>Address & Coordinates</Text>
            <TouchableOpacity
              style={styles.addressPickerBox}
              onPress={() => setSearchVisible(true)}
              activeOpacity={0.7}
            >
              <Ionicons name="search-outline" size={18} color={COLORS.primary} />
              <Text
                style={[
                  styles.addressPickerText,
                  !address && { color: COLORS.textSecondary },
                ]}
                numberOfLines={2}
              >
                {address || 'Tap to search address via M06 Locations'}
              </Text>
            </TouchableOpacity>

            <View style={styles.addressActionsRow}>
              <TouchableOpacity
                style={styles.addressChipBtn}
                onPress={() => setSearchVisible(true)}
              >
                <Ionicons name="search" size={14} color={COLORS.primary} />
                <Text style={styles.addressChipText}>Search Address</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.addressChipBtn}
                onPress={() => setPinVisible(true)}
              >
                <Ionicons name="map-outline" size={14} color={COLORS.primary} />
                <Text style={styles.addressChipText}>Pick on Map</Text>
              </TouchableOpacity>
            </View>

            {coords ? (
              <Text style={styles.coordsHint}>
                Pinned coordinates: {coords.lat.toFixed(5)}, {coords.lng.toFixed(5)}
              </Text>
            ) : null}

            {error ? <Text style={styles.errorText}>{error}</Text> : null}

            <View style={styles.btnRow}>
              <View style={styles.btnFlex}>
                <AppButton
                  title="Cancel"
                  variant="outline"
                  onPress={onClose}
                  disabled={isLoading}
                />
              </View>
              <View style={styles.btnFlex}>
                <AppButton
                  title={placeToEdit ? 'Update' : 'Save'}
                  onPress={handleSubmit}
                  loading={isLoading}
                />
              </View>
            </View>
          </View>
        </TouchableWithoutFeedback>

        <LocationSearchModal
          visible={searchVisible}
          initialField="pickup"
          singleFieldMode
          pickupPoint={
            coords
              ? { lat: coords.lat, lng: coords.lng, label: address || name }
              : null
          }
          dropPoint={null}
          currentCoords={currentGps}
          savedPlaces={[]}
          onSelectPoint={handlePickedLocation}
          onOpenMapPicker={() => setPinVisible(true)}
          onClose={() => setSearchVisible(false)}
        />

        <PinAdjusterModal
          visible={pinVisible}
          field="pickup"
          initialCoords={coords ?? currentGps}
          checkServiceability={false}
          onConfirm={handlePickedLocation}
          onClose={() => setPinVisible(false)}
        />
      </View>
    </TouchableWithoutFeedback>
  );
};

export const PlaceModal: React.FC<PlaceModalProps> = ({
  visible,
  placeToEdit,
  onClose,
  onSubmit,
  isLoading = false,
}) => {
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      {visible ? (
        <PlaceModalContent
          key={placeToEdit?.id ?? 'new'}
          placeToEdit={placeToEdit}
          onClose={onClose}
          onSubmit={onSubmit}
          isLoading={isLoading}
        />
      ) : null}
    </Modal>
  );
};
