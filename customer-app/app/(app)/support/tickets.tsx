import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  RefreshControl,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { router, useFocusEffect } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Header } from '../../../src/components/common/Header';
import { TicketItem } from '../../../src/components/support/TicketItem';
import { COLORS } from '../../../src/constants/colors';
import { SupportService } from '../../../src/services/support.service';
import type { SupportTicket, TicketStatus } from '../../../src/types/support.types';

type FilterTab = 'ALL' | 'OPEN' | 'IN_PROGRESS' | 'RESOLVED' | 'CLOSED';

export default function MyTicketsScreen() {
  const [tickets, setTickets] = useState<SupportTicket[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [activeTab, setActiveTab] = useState<FilterTab>('ALL');

  const loadTickets = useCallback(async () => {
    try {
      const data = await SupportService.listTickets();
      setTickets(Array.isArray(data) ? data : []);
    } catch {
      setTickets([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      loadTickets();
    }, [loadTickets])
  );

  const onRefresh = async () => {
    setRefreshing(true);
    await loadTickets();
    setRefreshing(false);
  };

  // Counts per tab
  const counts = useMemo(() => {
    const res = {
      ALL: tickets.length,
      OPEN: 0,
      IN_PROGRESS: 0,
      RESOLVED: 0,
      CLOSED: 0,
    };
    tickets.forEach((t) => {
      if (t.status === 'OPEN') res.OPEN++;
      else if (t.status === 'IN_PROGRESS' || t.status === 'WAITING_USER') res.IN_PROGRESS++;
      else if (t.status === 'RESOLVED') res.RESOLVED++;
      else if (t.status === 'CLOSED') res.CLOSED++;
    });
    return res;
  }, [tickets]);

  // Filtered tickets
  const filteredTickets = useMemo(() => {
    if (activeTab === 'ALL') return tickets;
    if (activeTab === 'OPEN') return tickets.filter((t) => t.status === 'OPEN');
    if (activeTab === 'IN_PROGRESS') {
      return tickets.filter((t) => t.status === 'IN_PROGRESS' || t.status === 'WAITING_USER');
    }
    if (activeTab === 'RESOLVED') return tickets.filter((t) => t.status === 'RESOLVED');
    if (activeTab === 'CLOSED') return tickets.filter((t) => t.status === 'CLOSED');
    return tickets;
  }, [tickets, activeTab]);

  const tabs: { key: FilterTab; label: string }[] = [
    { key: 'ALL', label: `All (${counts.ALL})` },
    { key: 'OPEN', label: `Open (${counts.OPEN})` },
    { key: 'IN_PROGRESS', label: `In Progress (${counts.IN_PROGRESS})` },
    { key: 'RESOLVED', label: `Resolved (${counts.RESOLVED})` },
    { key: 'CLOSED', label: `Closed (${counts.CLOSED})` },
  ];

  return (
    <SafeAreaView style={styles.container}>
      <Header
        title="My Tickets"
        showBack
        onBack={() => router.back()}
      />

      {/* Segmented Filter Bar */}
      <View style={styles.tabBarWrapper}>
        <FlatList
          horizontal
          showsHorizontalScrollIndicator={false}
          data={tabs}
          keyExtractor={(item) => item.key}
          contentContainerStyle={styles.tabBarContent}
          renderItem={({ item }) => {
            const isActive = activeTab === item.key;
            return (
              <TouchableOpacity
                style={[styles.filterChip, isActive && styles.filterChipActive]}
                onPress={() => setActiveTab(item.key)}
                activeOpacity={0.7}
              >
                <Text
                  style={[
                    styles.filterChipText,
                    isActive && styles.filterChipTextActive,
                  ]}
                >
                  {item.label}
                </Text>
              </TouchableOpacity>
            );
          }}
        />
      </View>

      {/* Main Content List */}
      {loading ? (
        <View style={styles.loadingBox}>
          <ActivityIndicator size="large" color={COLORS.primary} />
        </View>
      ) : (
        <FlatList
          data={filteredTickets}
          keyExtractor={(item, index) => item.ticketId || item.id || `ticket-${index}`}
          contentContainerStyle={styles.listContent}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              colors={[COLORS.primary]}
            />
          }
          renderItem={({ item }) => (
            <TicketItem
              ticket={item}
              onPress={(t) =>
                router.push({
                  pathname: '/(app)/support/[id]',
                  params: { id: t.ticketId || t.id || '' },
                })
              }
            />
          )}
          ListEmptyComponent={
            <View style={styles.emptyBox}>
              <View style={styles.emptyIconCircle}>
                <Ionicons name="ticket-outline" size={36} color={COLORS.textSecondary} />
              </View>
              <Text style={styles.emptyTitle}>No Tickets Found</Text>
              <Text style={styles.emptySubtitle}>
                {activeTab === 'ALL'
                  ? "You haven't submitted any support requests yet."
                  : `No tickets found under the "${activeTab.replace('_', ' ')}" filter.`}
              </Text>
            </View>
          }
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F8FAFC',
  },
  tabBarWrapper: {
    backgroundColor: '#FFFFFF',
    borderBottomWidth: 1,
    borderBottomColor: '#E2E8F0',
    paddingVertical: 10,
  },
  tabBarContent: {
    paddingHorizontal: 16,
    gap: 8,
  },
  filterChip: {
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 20,
    backgroundColor: '#F1F5F9',
  },
  filterChipActive: {
    backgroundColor: COLORS.primary,
  },
  filterChipText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#64748B',
  },
  filterChipTextActive: {
    color: '#FFFFFF',
  },
  listContent: {
    padding: 16,
    paddingBottom: 40,
  },
  loadingBox: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  emptyBox: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 60,
    paddingHorizontal: 24,
  },
  emptyIconCircle: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: '#E2E8F0',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  emptyTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#1E293B',
    marginBottom: 6,
  },
  emptySubtitle: {
    fontSize: 13,
    color: '#64748B',
    textAlign: 'center',
    lineHeight: 18,
  },
});
