import React, { useCallback, useEffect, useState } from 'react';
import {
  FlatList,
  RefreshControl,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { EmptyState } from '../../../src/components/common/EmptyState';
import { Header } from '../../../src/components/common/Header';
import { RideCard } from '../../../src/components/rides/RideCard';
import { RidesService } from '../../../src/services/rides.service';
import { styles } from '../../../src/styles/rides.styles';
import type { RideHistoryItem } from '../../../src/types/ride.types';

type FilterType = 'ALL' | 'COMPLETED' | 'CANCELLED';

export default function RidesHistoryScreen() {
  const [rides, setRides] = useState<RideHistoryItem[]>([]);
  const [filter, setFilter] = useState<FilterType>('ALL');
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const fetchRides = useCallback(async () => {
    try {
      setLoading(true);
      const data = await RidesService.getHistory();
      setRides(data);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchRides();
  }, [fetchRides]);

  const onRefresh = async () => {
    setRefreshing(true);
    await fetchRides();
    setRefreshing(false);
  };

  const filteredRides = rides.filter((r) => {
    if (filter === 'ALL') return true;
    if (filter === 'COMPLETED') return r.status === 'COMPLETED';
    if (filter === 'CANCELLED') return r.status === 'CANCELLED';
    return true;
  });

  return (
    <SafeAreaView style={styles.container}>
      <Header title="Your Rides" />

      {/* Filter Tabs */}
      <View style={styles.filterBar}>
        {(['ALL', 'COMPLETED', 'CANCELLED'] as FilterType[]).map((tab) => (
          <TouchableOpacity
            key={tab}
            style={[styles.filterChip, filter === tab && styles.filterChipActive]}
            onPress={() => setFilter(tab)}
          >
            <Text
              style={[
                styles.filterText,
                filter === tab && styles.filterTextActive,
              ]}
            >
              {tab.charAt(0) + tab.slice(1).toLowerCase()}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      <FlatList
        data={filteredRides}
        keyExtractor={(item, index) => item.rideId || item.id || item.bookingId || String(index)}
        contentContainerStyle={styles.listContent}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
        }
        renderItem={({ item }) => (
          <RideCard
            ride={item}
            onPress={() =>
              router.push({
                pathname: '/(app)/rides/[id]',
                params: { id: item.rideId || item.id || item.bookingId },
              })
            }
          />
        )}
        ListEmptyComponent={
          !loading ? (
            <EmptyState
              icon="car-outline"
              title="No rides found"
              subtitle={
                filter === 'ALL'
                  ? "You haven't booked any rides yet. Take your first trip today!"
                  : `No ${filter.toLowerCase()} rides found.`
              }
            />
          ) : undefined
        }
      />
    </SafeAreaView>
  );
}
