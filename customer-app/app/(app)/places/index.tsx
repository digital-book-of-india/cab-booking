import React, { useCallback, useEffect, useState } from 'react';
import {
  Alert,
  FlatList,
  RefreshControl,
  Text,
  View,
} from 'react-native';
import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { AppButton } from '../../../src/components/common/AppButton';
import { EmptyState } from '../../../src/components/common/EmptyState';
import { Header } from '../../../src/components/common/Header';
import { PlaceModal } from '../../../src/components/places/PlaceModal';
import { SavedPlaceItem } from '../../../src/components/places/SavedPlaceItem';
import { CustomerService } from '../../../src/services/customer.service';
import { styles } from '../../../src/styles/places.styles';
import type {
  CreateSavedPlaceInput,
  SavedPlace,
} from '../../../src/types/customer.types';

export default function SavedPlacesScreen() {
  const [places, setPlaces] = useState<SavedPlace[]>([]);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [modalVisible, setModalVisible] = useState(false);
  const [selectedPlace, setSelectedPlace] = useState<SavedPlace | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const fetchPlaces = useCallback(async () => {
    try {
      setLoading(true);
      const data = await CustomerService.listSavedPlaces();
      setPlaces(data);
    } catch (err) {
      Alert.alert('Error', err instanceof Error ? err.message : 'Could not fetch saved places');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchPlaces();
  }, [fetchPlaces]);

  const onRefresh = async () => {
    setRefreshing(true);
    await fetchPlaces();
    setRefreshing(false);
  };

  const handleOpenAddModal = () => {
    setSelectedPlace(null);
    setModalVisible(true);
  };

  const handleOpenEditModal = (place: SavedPlace) => {
    setSelectedPlace(place);
    setModalVisible(true);
  };

  const handleDelete = (place: SavedPlace) => {
    Alert.alert('Delete Place', `Are you sure you want to remove "${place.name}"?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          try {
            await CustomerService.deleteSavedPlace(place.id);
            setPlaces((prev) => prev.filter((p) => p.id !== place.id));
          } catch (err) {
            Alert.alert('Error', err instanceof Error ? err.message : 'Could not delete place');
          }
        },
      },
    ]);
  };

  const handleSubmitModal = async (input: CreateSavedPlaceInput) => {
    setSubmitting(true);
    try {
      if (selectedPlace) {
        const updated = await CustomerService.updateSavedPlace(selectedPlace.id, input);
        setPlaces((prev) => prev.map((p) => (p.id === selectedPlace.id ? updated : p)));
      } else {
        const created = await CustomerService.createSavedPlace(input);
        setPlaces((prev) => [created, ...prev]);
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <Header title="Saved Places" showBack onBack={() => router.back()} />

      <FlatList
        data={places}
        keyExtractor={(item, index) => item.id || String(index)}
        contentContainerStyle={styles.listContent}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
        }
        ListHeaderComponent={
          places.length > 0 ? (
            <Text style={styles.limitNote}>
              Saved places make booking quick. You have {places.length} of 20 places saved.
            </Text>
          ) : undefined
        }
        renderItem={({ item }) => (
          <SavedPlaceItem
            place={item}
            onEdit={handleOpenEditModal}
            onDelete={handleDelete}
          />
        )}
        ListEmptyComponent={
          !loading ? (
            <EmptyState
              icon="location-outline"
              title="No saved places yet"
              subtitle="Save your Home, Work or favorite destinations for one-tap booking."
              actionTitle="Add New Place"
              onAction={handleOpenAddModal}
            />
          ) : undefined
        }
      />

      <View style={styles.addBtnContainer}>
        <AppButton
          title="+ Add New Place"
          onPress={handleOpenAddModal}
          disabled={places.length >= 20}
        />
      </View>

      <PlaceModal
        visible={modalVisible}
        placeToEdit={selectedPlace}
        onClose={() => setModalVisible(false)}
        onSubmit={handleSubmitModal}
        isLoading={submitting}
      />
    </SafeAreaView>
  );
}
