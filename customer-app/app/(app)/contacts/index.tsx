import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Linking,
  Modal,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Contacts from 'expo-contacts/legacy';
import { router, useFocusEffect } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaView } from 'react-native-safe-area-context';
import { COLORS } from '../../../src/constants/colors';
import { CustomerService } from '../../../src/services/customer.service';
import { styles } from '../../../src/styles/contacts.styles';
import type { TrustedContact } from '../../../src/types/customer.types';

const MAX_CONTACTS = 3;

interface PhonebookContact {
  id: string;
  name: string;
  phone: string;
}

export default function EmergencyContactsScreen() {
  const [contacts, setContacts] = useState<TrustedContact[]>([]);
  const [loading, setLoading] = useState(true);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  // Phonebook Contact Picker State
  const [isPickerOpen, setIsPickerOpen] = useState(false);
  const [deviceContacts, setDeviceContacts] = useState<PhonebookContact[]>([]);
  const [loadingDeviceContacts, setLoadingDeviceContacts] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedContactIds, setSelectedContactIds] = useState<string[]>([]);
  const [savingSelection, setSavingSelection] = useState(false);

  const fetchContacts = useCallback(async () => {
    try {
      const data = await CustomerService.listTrustedContacts();
      setContacts(Array.isArray(data) ? data : []);
    } catch {
      setContacts([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      fetchContacts();
    }, [fetchContacts])
  );

  /** Open device contact list picker */
  const handleOpenContactPicker = async () => {
    if (contacts.length >= MAX_CONTACTS) {
      Alert.alert(
        'Limit Reached',
        `You can save a maximum of ${MAX_CONTACTS} emergency contacts. Please remove an existing contact to add a new one.`
      );
      return;
    }

    setLoadingDeviceContacts(true);
    try {
      const { status } = await Contacts.requestPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert(
          'Permission Needed',
          'We need access to your phone contacts so you can choose your emergency contacts.',
          [
            { text: 'Open Settings', onPress: () => Linking.openSettings() },
            { text: 'Cancel', style: 'cancel' },
          ]
        );
        setLoadingDeviceContacts(false);
        return;
      }

      const res = await Contacts.getContactsAsync({
        fields: [Contacts.Fields.PhoneNumbers, Contacts.Fields.Name],
      });

      if (res && Array.isArray(res.data) && res.data.length > 0) {
        const cleaned: PhonebookContact[] = [];
        const seenPhones = new Set<string>();

        res.data.forEach((c) => {
          const name = (c.name || [c.firstName, c.lastName].filter(Boolean).join(' ')).trim();
          if (!name) return;

          const rawNumber = c.phoneNumbers?.[0]?.number;
          if (!rawNumber) return;

          const cleanPhone = rawNumber.replace(/[\s()-]/g, '');
          if (cleanPhone.length >= 8 && !seenPhones.has(cleanPhone)) {
            seenPhones.add(cleanPhone);
            cleaned.push({
              id: c.id || `${name}_${cleanPhone}`,
              name,
              phone: cleanPhone,
            });
          }
        });

        cleaned.sort((a, b) => a.name.localeCompare(b.name));
        setDeviceContacts(cleaned);
        setSelectedContactIds([]);
        setSearchQuery('');
        setIsPickerOpen(true);
      } else {
        Alert.alert(
          'No Contacts Found',
          'No contacts with phone numbers were found on this device.'
        );
      }
    } catch {
      Alert.alert(
        'Unable to Load Contacts',
        'Could not access device contacts. Please ensure permissions are granted in settings.'
      );
    } finally {
      setLoadingDeviceContacts(false);
    }
  };

  /** Filter device contacts by search query */
  const filteredDeviceContacts = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return deviceContacts;
    return deviceContacts.filter(
      (c) => c.name.toLowerCase().includes(q) || c.phone.includes(q)
    );
  }, [deviceContacts, searchQuery]);

  /** Toggle contact selection */
  const handleToggleSelectContact = (item: PhonebookContact) => {
    const isAlreadySaved = contacts.some(
      (c) => c.phone.replace(/\D/g, '') === item.phone.replace(/\D/g, '')
    );
    if (isAlreadySaved) {
      Alert.alert('Already Saved', `${item.name} is already in your emergency contacts.`);
      return;
    }

    setSelectedContactIds((prev) => {
      if (prev.includes(item.id)) {
        return prev.filter((id) => id !== item.id);
      }
      const remainingSlots = MAX_CONTACTS - contacts.length;
      if (prev.length >= remainingSlots) {
        Alert.alert(
          'Limit Reached',
          `You can select at most ${remainingSlots} contact${remainingSlots > 1 ? 's' : ''} (maximum of ${MAX_CONTACTS} total).`
        );
        return prev;
      }
      return [...prev, item.id];
    });
  };

  /** Save all selected contacts to backend */
  const handleConfirmAddSelected = async () => {
    if (selectedContactIds.length === 0) return;

    setSavingSelection(true);
    try {
      const selectedItems = deviceContacts.filter((c) => selectedContactIds.includes(c.id));
      for (const item of selectedItems) {
        await CustomerService.addTrustedContact({
          name: item.name,
          phone: item.phone,
          relationship: 'Emergency Contact',
        });
      }
      await fetchContacts();
      setIsPickerOpen(false);
      setSelectedContactIds([]);
    } catch (err) {
      Alert.alert(
        'Save Failed',
        err instanceof Error ? err.message : 'Could not add selected contact(s).'
      );
    } finally {
      setSavingSelection(false);
    }
  };

  /** Remove an emergency contact */
  const handleDeleteContact = (contact: TrustedContact) => {
    Alert.alert(
      'Remove Contact?',
      `Are you sure you want to remove ${contact.name} from your emergency contacts?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: async () => {
            try {
              setDeletingId(contact.id);
              await CustomerService.deleteTrustedContact(contact.id);
              await fetchContacts();
            } catch (err) {
              Alert.alert(
                'Delete Failed',
                err instanceof Error ? err.message : 'Could not remove contact.'
              );
            } finally {
              setDeletingId(null);
            }
          },
        },
      ]
    );
  };

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar style="dark" />

      {/* Top Bar with Back Arrow */}
      <View style={styles.topBar}>
        <TouchableOpacity
          style={styles.backButton}
          onPress={() => {
            if (router.canGoBack()) {
              router.back();
            } else {
              router.replace('/(app)/safety' as any);
            }
          }}
          hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
          activeOpacity={0.7}
        >
          <Ionicons name="arrow-back" size={24} color={COLORS.text} />
        </TouchableOpacity>
      </View>

      {/* Screen Title & Subtitle */}
      <View style={styles.headerSection}>
        <Text style={styles.title}>Emergency contacts</Text>
        <Text style={styles.subtitle}>
          Choose people that you want us to alert in case of an emergency.
        </Text>
      </View>

      {/* Main Content: Empty State OR Saved Contacts List */}
      {loading ? (
        <View style={styles.emptyContainer}>
          <ActivityIndicator size="large" color={COLORS.primary} />
        </View>
      ) : contacts.length === 0 ? (
        <View style={styles.emptyContainer}>
          <View style={styles.iconBoxWrapper}>
            <View style={styles.blueIconBox}>
              <Ionicons name="person" size={28} color={COLORS.primary} />
            </View>
            <View style={styles.starBadge}>
              <Text style={styles.starText}>*</Text>
            </View>
          </View>
          <Text style={styles.emptyTitle}>
            You don’t have any emergency contacts yet
          </Text>
        </View>
      ) : (
        <FlatList
          data={contacts}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.listContent}
          renderItem={({ item }) => (
            <View style={styles.contactCard}>
              <View style={styles.avatarBox}>
                <Text style={styles.avatarLetter}>
                  {item.name ? item.name.trim().charAt(0).toUpperCase() : 'C'}
                </Text>
              </View>
              <View style={styles.contactDetails}>
                <View style={styles.nameRow}>
                  <Text style={styles.contactName} numberOfLines={1}>
                    {item.name}
                  </Text>
                </View>
                <Text style={styles.contactPhone}>{item.phone}</Text>
              </View>
              <TouchableOpacity
                style={styles.deleteButton}
                onPress={() => handleDeleteContact(item)}
                disabled={deletingId === item.id}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              >
                {deletingId === item.id ? (
                  <ActivityIndicator size="small" color={COLORS.error} />
                ) : (
                  <Ionicons name="trash-outline" size={20} color={COLORS.error} />
                )}
              </TouchableOpacity>
            </View>
          )}
          ListHeaderComponent={
            <View style={styles.savedHeaderRow}>
              <Text style={styles.savedHeaderTitle}>Saved Contacts</Text>
              <Text style={styles.savedHeaderCount}>
                {contacts.length} of {MAX_CONTACTS} added
              </Text>
            </View>
          }
        />
      )}

      {/* Sticky Bottom Action Bar */}
      <View style={styles.bottomBar}>
        <TouchableOpacity
          style={styles.addContactButton}
          onPress={handleOpenContactPicker}
          activeOpacity={0.8}
          disabled={loadingDeviceContacts}
        >
          {loadingDeviceContacts ? (
            <ActivityIndicator size="small" color={COLORS.white} />
          ) : (
            <Text style={styles.addContactButtonText}>Add contact</Text>
          )}
        </TouchableOpacity>
      </View>

      {/* Device Contacts Picker Bottom Sheet Modal */}
      <Modal
        visible={isPickerOpen}
        animationType="slide"
        transparent
        onRequestClose={() => setIsPickerOpen(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.pickerSheet}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Select from Contacts</Text>
              <TouchableOpacity
                onPress={() => setIsPickerOpen(false)}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              >
                <Ionicons name="close" size={24} color={COLORS.text} />
              </TouchableOpacity>
            </View>

            {/* Search Input */}
            <View style={styles.searchContainer}>
              <Ionicons name="search" size={18} color={COLORS.textSecondary} />
              <TextInput
                style={styles.searchInput}
                placeholder="Search name or phone..."
                placeholderTextColor={COLORS.textSecondary}
                value={searchQuery}
                onChangeText={setSearchQuery}
              />
              {searchQuery.length > 0 && (
                <TouchableOpacity onPress={() => setSearchQuery('')}>
                  <Ionicons name="close-circle" size={16} color={COLORS.textSecondary} />
                </TouchableOpacity>
              )}
            </View>

            {/* Contacts List */}
            <FlatList
              data={filteredDeviceContacts}
              keyExtractor={(item) => item.id}
              initialNumToRender={20}
              maxToRenderPerBatch={20}
              renderItem={({ item }) => {
                const isSelected = selectedContactIds.includes(item.id);
                const isAlreadySaved = contacts.some(
                  (c) => c.phone.replace(/\D/g, '') === item.phone.replace(/\D/g, '')
                );

                return (
                  <TouchableOpacity
                    style={styles.pickerItem}
                    onPress={() => handleToggleSelectContact(item)}
                    activeOpacity={0.7}
                  >
                    <View style={styles.pickerAvatar}>
                      <Text style={styles.pickerAvatarText}>
                        {item.name.charAt(0).toUpperCase()}
                      </Text>
                    </View>
                    <View style={styles.pickerInfo}>
                      <Text style={styles.pickerName} numberOfLines={1}>
                        {item.name}
                      </Text>
                      <Text style={styles.pickerPhone}>{item.phone}</Text>
                    </View>
                    {isAlreadySaved ? (
                      <View style={styles.alreadyAddedBadge}>
                        <Text style={styles.alreadyAddedText}>Added</Text>
                      </View>
                    ) : (
                      <View
                        style={[
                          styles.checkbox,
                          isSelected && styles.checkboxSelected,
                        ]}
                      >
                        {isSelected && (
                          <Ionicons name="checkmark" size={14} color={COLORS.white} />
                        )}
                      </View>
                    )}
                  </TouchableOpacity>
                );
              }}
              ListEmptyComponent={
                <View style={{ padding: 32, alignItems: 'center' }}>
                  <Text style={{ color: COLORS.textSecondary, fontSize: 14 }}>
                    No contacts found matching "{searchQuery}"
                  </Text>
                </View>
              }
            />

            {/* Picker Footer */}
            <View style={styles.pickerFooter}>
              <TouchableOpacity
                style={[
                  styles.confirmButton,
                  selectedContactIds.length === 0 && styles.confirmButtonDisabled,
                ]}
                onPress={handleConfirmAddSelected}
                disabled={selectedContactIds.length === 0 || savingSelection}
                activeOpacity={0.8}
              >
                {savingSelection ? (
                  <ActivityIndicator size="small" color={COLORS.white} />
                ) : (
                  <Text
                    style={[
                      styles.confirmButtonText,
                      selectedContactIds.length === 0 && styles.confirmButtonTextDisabled,
                    ]}
                  >
                    {selectedContactIds.length > 0
                      ? `Add ${selectedContactIds.length} Contact${selectedContactIds.length > 1 ? 's' : ''}`
                      : 'Select Contacts'}
                  </Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}
