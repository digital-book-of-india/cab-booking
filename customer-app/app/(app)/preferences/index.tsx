import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  ScrollView,
  Switch,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Header } from '../../../src/components/common/Header';
import { COLORS } from '../../../src/constants/colors';
import { CustomerService } from '../../../src/services/customer.service';
import { styles } from '../../../src/styles/preferences.styles';
import type { CustomerPreferences } from '../../../src/types/customer.types';

export default function PreferencesScreen() {
  const [preferences, setPreferences] = useState<CustomerPreferences>({
    quietRide: false,
    autoShareTrips: false,
    temperaturePreference: 'MILD',
    defaultPaymentMethod: 'WALLET',
  });
  const [loading, setLoading] = useState(true);
  const [saveStatus, setSaveStatus] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    async function load() {
      try {
        const prefs = await CustomerService.getPreferences();
        if (mounted) setPreferences(prefs);
      } finally {
        if (mounted) setLoading(false);
      }
    }
    load();
    return () => {
      mounted = false;
    };
  }, []);

  const updateAndPersist = async (patch: Partial<CustomerPreferences>) => {
    const updated = { ...preferences, ...patch };
    setPreferences(updated);
    setSaveStatus('Saving...');
    try {
      await CustomerService.updatePreferences(patch);
      setSaveStatus('Preferences saved');
      setTimeout(() => setSaveStatus(null), 2000);
    } catch {
      setSaveStatus('Error saving');
    }
  };

  const tempOptions: {
    key: CustomerPreferences['temperaturePreference'];
    title: string;
    sub: string;
    icon: keyof typeof Ionicons.glyphMap;
  }[] = [
    { key: 'COOL', title: 'Cool & Air Conditioned', sub: 'High AC cooling throughout the trip', icon: 'snow-outline' },
    { key: 'MILD', title: 'Comfortable / Moderate', sub: 'Gentle climate control', icon: 'thermometer-outline' },
    { key: 'NO_PREFERENCE', title: 'No Preference', sub: 'Driver discretion or open windows', icon: 'sparkles-outline' },
  ];

  const paymentOptions: {
    key: CustomerPreferences['defaultPaymentMethod'];
    title: string;
    sub: string;
    icon: keyof typeof Ionicons.glyphMap;
  }[] = [
    { key: 'WALLET', title: 'Cab Wallet', sub: 'Instant 1-tap booking using wallet balance', icon: 'wallet-outline' },
    { key: 'ONLINE', title: 'Online / UPI / Card', sub: 'Pay digitally via Razorpay gateway', icon: 'card-outline' },
    { key: 'CASH', title: 'Cash to Driver', sub: 'Pay exact cash after completing the ride', icon: 'cash-outline' },
  ];

  return (
    <SafeAreaView style={styles.container}>
      <Header title="Ride Preferences" showBack onBack={() => router.back()} />

      {loading ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={COLORS.primary} />
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.scrollContent}>
          {/* Banner */}
          <View style={styles.infoBanner}>
            <Ionicons name="options-outline" size={22} color="#1E40AF" />
            <Text style={styles.infoText}>
              Set your personal ride comforts and trip sharing preferences once. They will automatically
              apply to your future bookings.
            </Text>
          </View>

          {/* Section: Ride Experience */}
          <View style={styles.sectionCard}>
            <View style={styles.sectionTitleRow}>
              <Ionicons name="car-sport" size={20} color={COLORS.primary} />
              <Text style={styles.sectionTitle}>Ride Experience</Text>
            </View>

            {/* Quiet Ride */}
            <View style={styles.toggleRow}>
              <View style={styles.toggleTextCol}>
                <Text style={styles.toggleTitle}>Quiet Ride</Text>
                <Text style={styles.toggleDescription}>
                  Let driver know in advance if you prefer minimal conversation and quiet travel.
                </Text>
              </View>
              <Switch
                value={preferences.quietRide}
                onValueChange={(val) => updateAndPersist({ quietRide: val })}
                trackColor={{ false: COLORS.border, true: COLORS.primary }}
              />
            </View>

            <View style={styles.divider} />

            {/* Temperature */}
            <Text style={styles.subLabel}>Cabin Temperature</Text>
            <View style={styles.optionsGrid}>
              {tempOptions.map((opt) => {
                const isSelected = preferences.temperaturePreference === opt.key;
                return (
                  <TouchableOpacity
                    key={opt.key}
                    style={[styles.optionCard, isSelected && styles.optionCardSelected]}
                    onPress={() => updateAndPersist({ temperaturePreference: opt.key })}
                  >
                    <View style={styles.optionLeft}>
                      <Ionicons
                        name={opt.icon}
                        size={22}
                        color={isSelected ? COLORS.primary : COLORS.textSecondary}
                      />
                      <View>
                        <Text style={styles.optionTitle}>{opt.title}</Text>
                        <Text style={styles.optionSub}>{opt.sub}</Text>
                      </View>
                    </View>
                    <Ionicons
                      name={isSelected ? 'radio-button-on' : 'radio-button-off'}
                      size={20}
                      color={isSelected ? COLORS.primary : COLORS.textSecondary}
                    />
                  </TouchableOpacity>
                );
              })}
            </View>
          </View>

          {/* Section: Safety & Sharing */}
          <View style={styles.sectionCard}>
            <View style={styles.sectionTitleRow}>
              <Ionicons name="shield-checkmark" size={20} color={COLORS.primary} />
              <Text style={styles.sectionTitle}>Safety & Automation</Text>
            </View>

            <View style={styles.toggleRow}>
              <View style={styles.toggleTextCol}>
                <Text style={styles.toggleTitle}>Auto-share Trips</Text>
                <Text style={styles.toggleDescription}>
                  Automatically send a live GPS tracking link to your trusted contacts whenever a trip begins.
                </Text>
              </View>
              <Switch
                value={preferences.autoShareTrips}
                onValueChange={(val) => updateAndPersist({ autoShareTrips: val })}
                trackColor={{ false: COLORS.border, true: COLORS.primary }}
              />
            </View>
          </View>

          {/* Section: Payment Method */}
          <View style={styles.sectionCard}>
            <View style={styles.sectionTitleRow}>
              <Ionicons name="card" size={20} color={COLORS.primary} />
              <Text style={styles.sectionTitle}>Default Payment Preference</Text>
            </View>

            <View style={styles.optionsGrid}>
              {paymentOptions.map((opt) => {
                const isSelected = preferences.defaultPaymentMethod === opt.key;
                return (
                  <TouchableOpacity
                    key={opt.key}
                    style={[styles.optionCard, isSelected && styles.optionCardSelected]}
                    onPress={() => updateAndPersist({ defaultPaymentMethod: opt.key })}
                  >
                    <View style={styles.optionLeft}>
                      <Ionicons
                        name={opt.icon}
                        size={22}
                        color={isSelected ? COLORS.primary : COLORS.textSecondary}
                      />
                      <View>
                        <Text style={styles.optionTitle}>{opt.title}</Text>
                        <Text style={styles.optionSub}>{opt.sub}</Text>
                      </View>
                    </View>
                    <Ionicons
                      name={isSelected ? 'radio-button-on' : 'radio-button-off'}
                      size={20}
                      color={isSelected ? COLORS.primary : COLORS.textSecondary}
                    />
                  </TouchableOpacity>
                );
              })}
            </View>
          </View>
        </ScrollView>
      )}

      {/* Floating Save Pill */}
      {saveStatus ? (
        <View style={styles.saveStatusBanner}>
          <Ionicons name="checkmark-circle" size={16} color="#10B981" />
          <Text style={styles.saveStatusText}>{saveStatus}</Text>
        </View>
      ) : null}
    </SafeAreaView>
  );
}
