import React, { useCallback, useEffect, useState } from 'react';
import {
  Alert,
  FlatList,
  Modal,
  RefreshControl,
  Text,
  TouchableOpacity,
  TouchableWithoutFeedback,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { AppButton } from '../../../src/components/common/AppButton';
import { AppInput } from '../../../src/components/common/AppInput';
import { EmptyState } from '../../../src/components/common/EmptyState';
import { Header } from '../../../src/components/common/Header';
import { TicketItem } from '../../../src/components/support/TicketItem';
import { COLORS } from '../../../src/constants/colors';
import { SupportService } from '../../../src/services/support.service';
import { styles } from '../../../src/styles/support.styles';
import type { SupportTicket, TicketCategory } from '../../../src/types/support.types';

const CATEGORIES: { label: string; value: TicketCategory }[] = [
  { label: 'Payment Issue', value: 'PAYMENT_ISSUE' },
  { label: 'Fare Dispute', value: 'FARE_DISPUTE' },
  { label: 'Driver Behavior', value: 'DRIVER_BEHAVIOUR' },
  { label: 'Safety Concern', value: 'SAFETY_CONCERN' },
  { label: 'Lost Item', value: 'LOST_ITEM' },
  { label: 'App Problem', value: 'APP_PROBLEM' },
  { label: 'Other', value: 'OTHER' },
];

export default function SupportTicketsScreen() {
  const params = useLocalSearchParams<{ rideId?: string }>();
  const [tickets, setTickets] = useState<SupportTicket[]>([]);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [modalVisible, setModalVisible] = useState(Boolean(params.rideId));
  const [subject, setSubject] = useState(params.rideId ? `Issue with Ride #${params.rideId.slice(-6)}` : '');
  const [message, setMessage] = useState('');
  const [category, setCategory] = useState<TicketCategory>(params.rideId ? 'FARE_DISPUTE' : 'PAYMENT_ISSUE');
  const [submitting, setSubmitting] = useState(false);

  const fetchTickets = useCallback(async () => {
    try {
      setLoading(true);
      const data = await SupportService.listTickets();
      setTickets(data);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchTickets();
  }, [fetchTickets]);

  const onRefresh = async () => {
    setRefreshing(true);
    await fetchTickets();
    setRefreshing(false);
  };

  const handleCreateTicket = async () => {
    if (!subject.trim()) {
      Alert.alert('Required', 'Please enter a ticket subject.');
      return;
    }
    if (!message.trim()) {
      Alert.alert('Required', 'Please describe the problem.');
      return;
    }

    try {
      setSubmitting(true);
      const created = await SupportService.createTicket({
        subject: subject.trim(),
        message: message.trim(),
        category,
      });

      setTickets((prev) => [created, ...prev]);
      setModalVisible(false);
      setSubject('');
      setMessage('');
      Alert.alert('Ticket Raised', 'Support team has received your ticket.');
    } catch (err) {
      Alert.alert('Error', err instanceof Error ? err.message : 'Could not create ticket');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <Header title="Help & Support" showBack onBack={() => router.back()} />

      <FlatList
        data={tickets}
        keyExtractor={(item) => item.ticketId || item.id || Math.random().toString()}
        contentContainerStyle={styles.listContent}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
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
          !loading ? (
            <EmptyState
              icon="chatbubbles-outline"
              title="No support tickets"
              subtitle="Have a question or facing an issue? Raise a ticket and our 24/7 team will assist you."
              actionTitle="Raise a Ticket"
              onAction={() => setModalVisible(true)}
            />
          ) : undefined
        }
      />

      <View style={styles.bottomBar}>
        <AppButton
          title="+ Raise New Ticket"
          onPress={() => setModalVisible(true)}
        />
      </View>

      {/* New Ticket Modal */}
      <Modal
        visible={modalVisible}
        transparent
        animationType="slide"
        onRequestClose={() => setModalVisible(false)}
      >
        <TouchableWithoutFeedback onPress={() => setModalVisible(false)}>
          <View style={styles.modalOverlay}>
            <TouchableWithoutFeedback>
              <View style={styles.modalContent}>
                <View style={styles.modalHeader}>
                  <Text style={styles.modalTitle}>Raise Support Ticket</Text>
                  <TouchableOpacity onPress={() => setModalVisible(false)}>
                    <Ionicons name="close" size={24} color={COLORS.textSecondary} />
                  </TouchableOpacity>
                </View>

                {/* Category Selector */}
                <Text style={{ fontSize: 13, fontWeight: '600', color: COLORS.text, marginBottom: 8 }}>
                  Category
                </Text>
                <View style={styles.categoryRow}>
                  {CATEGORIES.map((cat) => {
                    const active = category === cat.value;
                    return (
                      <TouchableOpacity
                        key={cat.value}
                        style={[
                          styles.categoryChip,
                          active && styles.categoryChipActive,
                        ]}
                        onPress={() => setCategory(cat.value)}
                      >
                        <Text
                          style={[
                            styles.categoryChipText,
                            active && styles.categoryChipTextActive,
                          ]}
                        >
                          {cat.label}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>

                <AppInput
                  label="Subject"
                  placeholder="Summary of your issue"
                  value={subject}
                  onChangeText={setSubject}
                />

                <AppInput
                  label="Details"
                  placeholder="Describe your issue with full details..."
                  multiline
                  numberOfLines={4}
                  value={message}
                  onChangeText={setMessage}
                />

                <View style={styles.modalActions}>
                  <View style={{ flex: 1 }}>
                    <AppButton
                      title="Cancel"
                      variant="outline"
                      onPress={() => setModalVisible(false)}
                    />
                  </View>
                  <View style={{ flex: 1 }}>
                    <AppButton
                      title="Submit"
                      onPress={handleCreateTicket}
                      loading={submitting}
                    />
                  </View>
                </View>
              </View>
            </TouchableWithoutFeedback>
          </View>
        </TouchableWithoutFeedback>
      </Modal>
    </SafeAreaView>
  );
}
