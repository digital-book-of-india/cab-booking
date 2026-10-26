import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Modal,
  Platform,
  RefreshControl,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { AppButton } from '../../../src/components/common/AppButton';
import { AppInput } from '../../../src/components/common/AppInput';
import { Badge } from '../../../src/components/common/Badge';
import { Header } from '../../../src/components/common/Header';
import { COLORS } from '../../../src/constants/colors';
import { CustomerService } from '../../../src/services/customer.service';
import { styles } from '../../../src/styles/contacts.styles';
import type { TrustedContact } from '../../../src/types/customer.types';

const RELATIONSHIP_OPTIONS = ['Parent', 'Spouse', 'Sibling', 'Friend', 'Guardian', 'Other'];
const MAX_CONTACTS = 3;

export default function TrustedContactsScreen() {
  const [contacts, setContacts] = useState<TrustedContact[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  // Modal State
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [relationship, setRelationship] = useState('Parent');
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const fetchContacts = useCallback(async () => {
    try {
      const data = await CustomerService.listTrustedContacts();
      setContacts(Array.isArray(data) ? data : []);
    } catch (err) {
      Alert.alert(
        'Error',
        err instanceof Error ? err.message : 'Failed to load emergency contacts',
      );
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    fetchContacts();
  }, [fetchContacts]);

  const onRefresh = () => {
    setRefreshing(true);
    fetchContacts();
  };

  const handleOpenAddModal = () => {
    if (contacts.length >= MAX_CONTACTS) {
      Alert.alert(
        'Limit Reached',
        `You can save a maximum of ${MAX_CONTACTS} emergency contacts.`,
      );
      return;
    }
    setName('');
    setPhone('');
    setRelationship('Parent');
    setFormError(null);
    setIsModalOpen(true);
  };

  const handleSaveContact = async () => {
    if (!name.trim()) {
      setFormError('Please enter the contact name');
      return;
    }
    const cleanPhone = phone.trim().replace(/\s+/g, '');
    if (!cleanPhone || cleanPhone.length < 8) {
      setFormError('Please enter a valid phone number');
      return;
    }

    try {
      setSaving(true);
      setFormError(null);
      const newContact = await CustomerService.addTrustedContact({
        name: name.trim(),
        phone: cleanPhone,
        relationship: relationship || undefined,
      });

      setContacts((prev) => [...prev, newContact]);
      setIsModalOpen(false);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Could not add contact');
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteContact = (contact: TrustedContact) => {
    Alert.alert(
      'Remove Contact?',
      `Are you sure you want to remove ${contact.name} from your trusted emergency contacts?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: async () => {
            try {
              setDeletingId(contact.id);
              await CustomerService.deleteTrustedContact(contact.id);
              setContacts((prev) => prev.filter((c) => c.id !== contact.id));
            } catch (err) {
              Alert.alert(
                'Delete Failed',
                err instanceof Error ? err.message : 'Could not remove contact',
              );
            } finally {
              setDeletingId(null);
            }
          },
        },
      ],
    );
  };

  const renderContactItem = ({ item }: { item: TrustedContact }) => (
    <View style={styles.contactCard}>
      <View style={styles.avatarBox}>
        <Ionicons name="shield" size={22} color={COLORS.primary} />
      </View>
      <View style={styles.contactDetails}>
        <View style={styles.nameRow}>
          <Text style={styles.contactName}>{item.name}</Text>
          {item.relationship ? (
            <Badge label={item.relationship} variant="info" />
          ) : null}
        </View>
        <Text style={styles.contactPhone}>{item.phone}</Text>
      </View>
      <TouchableOpacity
        style={styles.deleteButton}
        onPress={() => handleDeleteContact(item)}
        disabled={deletingId === item.id}
      >
        {deletingId === item.id ? (
          <ActivityIndicator size="small" color={COLORS.error} />
        ) : (
          <Ionicons name="trash-outline" size={20} color={COLORS.error} />
        )}
      </TouchableOpacity>
    </View>
  );

  return (
    <SafeAreaView style={styles.container}>
      <Header title="Trusted Contacts" showBack onBack={() => router.back()} />

      {loading ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={COLORS.primary} />
        </View>
      ) : (
        <>
          <FlatList
            data={contacts}
            keyExtractor={(item) => item.id}
            renderItem={renderContactItem}
            contentContainerStyle={styles.listContent}
            refreshControl={
              <RefreshControl
                refreshing={refreshing}
                onRefresh={onRefresh}
                colors={[COLORS.primary]}
              />
            }
            ListHeaderComponent={
              <>
                <View style={styles.infoBanner}>
                  <Ionicons name="warning" size={22} color="#B45309" />
                  <Text style={styles.infoText}>
                    If you trigger SOS or emergency alert during a ride, your trusted contacts
                    will receive an immediate SMS notification with a live tracking link to your cab.
                  </Text>
                </View>

                <View style={styles.contactCountRow}>
                  <Text style={styles.contactCountText}>Saved Contacts</Text>
                  <Text style={styles.contactLimitText}>
                    {contacts.length} of {MAX_CONTACTS} added
                  </Text>
                </View>
              </>
            }
            ListEmptyComponent={
              <View style={styles.emptyContainer}>
                <Ionicons name="people-outline" size={54} color={COLORS.textSecondary} />
                <Text style={styles.emptyTitle}>No Emergency Contacts</Text>
                <Text style={styles.emptySubtitle}>
                  Add up to {MAX_CONTACTS} trusted family members or friends who can be alerted
                  if you ever need assistance.
                </Text>
              </View>
            }
          />

          {contacts.length < MAX_CONTACTS ? (
            <View style={styles.fabButton}>
              <AppButton
                title="+ Add Trusted Contact"
                onPress={handleOpenAddModal}
              />
            </View>
          ) : null}
        </>
      )}

      {/* Add Contact Modal */}
      <Modal
        visible={isModalOpen}
        animationType="slide"
        transparent
        onRequestClose={() => setIsModalOpen(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Add Emergency Contact</Text>
              <TouchableOpacity onPress={() => setIsModalOpen(false)}>
                <Ionicons name="close" size={24} color={COLORS.text} />
              </TouchableOpacity>
            </View>

            <AppInput
              label="Contact Name"
              placeholder="e.g. Rahul Sharma"
              value={name}
              onChangeText={(t: string) => {
                setName(t);
                setFormError(null);
              }}
            />

            <AppInput
              label="Phone Number"
              placeholder="10-digit mobile number"
              value={phone}
              onChangeText={(t: string) => {
                setPhone(t);
                setFormError(null);
              }}
              keyboardType="phone-pad"
              error={formError || undefined}
            />

            <Text style={styles.relationshipLabel}>Relationship</Text>
            <View style={styles.pillsRow}>
              {RELATIONSHIP_OPTIONS.map((opt) => {
                const isSelected = relationship === opt;
                return (
                  <TouchableOpacity
                    key={opt}
                    style={[styles.pill, isSelected && styles.pillSelected]}
                    onPress={() => setRelationship(opt)}
                  >
                    <Text
                      style={[
                        styles.pillText,
                        isSelected && styles.pillTextSelected,
                      ]}
                    >
                      {opt}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            <View style={styles.modalActions}>
              <View style={styles.modalButton}>
                <AppButton
                  title="Cancel"
                  variant="outline"
                  onPress={() => setIsModalOpen(false)}
                />
              </View>
              <View style={styles.modalButton}>
                <AppButton
                  title="Save Contact"
                  onPress={handleSaveContact}
                  loading={saving}
                />
              </View>
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}
