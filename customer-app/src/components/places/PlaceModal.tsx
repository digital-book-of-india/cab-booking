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
import type {
  CreateSavedPlaceInput,
  SavedPlace,
  SavedPlaceType,
} from '../../types/customer.types';
import { AppButton } from '../common/AppButton';
import { AppInput } from '../common/AppInput';
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

export const PlaceModal: React.FC<PlaceModalProps> = ({
  visible,
  placeToEdit,
  onClose,
  onSubmit,
  isLoading = false,
}) => {
  const [name, setName] = useState('');
  const [address, setAddress] = useState('');
  const [type, setType] = useState<SavedPlaceType>('home');
  const [lat, setLat] = useState('28.6139'); // Default Delhi for mockup/testing
  const [lng, setLng] = useState('77.2090');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (placeToEdit) {
      setName(placeToEdit.name);
      setAddress(placeToEdit.address);
      setType(placeToEdit.type);
      setLat(String(placeToEdit.lat));
      setLng(String(placeToEdit.lng));
    } else {
      setName('');
      setAddress('');
      setType('home');
      setLat('28.6139');
      setLng('77.2090');
    }
    setError(null);
  }, [placeToEdit, visible]);

  const handleSubmit = async () => {
    if (!name.trim()) {
      setError('Please provide a name for this place (e.g. My Home, Studio)');
      return;
    }
    if (!address.trim()) {
      setError('Please enter the street address');
      return;
    }
    const parsedLat = parseFloat(lat);
    const parsedLng = parseFloat(lng);
    if (isNaN(parsedLat) || isNaN(parsedLng)) {
      setError('Invalid coordinates');
      return;
    }

    try {
      setError(null);
      await onSubmit({
        name: name.trim(),
        type,
        address: address.trim(),
        lat: parsedLat,
        lng: parsedLng,
      });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save place');
    }
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
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

              {/* Type selection */}
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

              <AppInput
                label="Full Address"
                placeholder="Building, street, area, city"
                value={address}
                onChangeText={setAddress}
                multiline
                numberOfLines={2}
                error={error || undefined}
              />

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
        </View>
      </TouchableWithoutFeedback>
    </Modal>
  );
};
