import React, { useCallback, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Linking,
  Modal,
  RefreshControl,
  ScrollView,
  Share,
  Switch,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { router, useFocusEffect } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Header } from '../../../src/components/common/Header';
import { COLORS } from '../../../src/constants/colors';
import { CustomerService } from '../../../src/services/customer.service';
import { SafetyIncidentView, SafetyService } from '../../../src/services/safety.service';
import { AppStorage } from '../../../src/services/storage';
import { styles } from '../../../src/styles/safety.styles';
import type { CustomerPreferences, TrustedContact } from '../../../src/types/customer.types';
import type { RideHistoryItem } from '../../../src/types/ride.types';

const AUDIO_RECORDING_KEY = 'safety_audio_recording_enabled';
const NATIONAL_EMERGENCY_NUMBER = '112';
const SAFETY_HELPLINE_NUMBER = '1800123456';

export default function SafetyPreferencesScreen() {
  // 1. Contacts & Preferences State
  const [contacts, setContacts] = useState<TrustedContact[]>([]);
  const [preferences, setPreferences] = useState<CustomerPreferences>({
    quietRide: false,
    autoShareTrips: false,
    temperaturePreference: 'MILD',
    defaultPaymentMethod: 'WALLET',
  });
  const [audioRecordingEnabled, setAudioRecordingEnabled] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  // 2. Dynamic Live Ride & SOS State
  const [liveRide, setLiveRide] = useState<RideHistoryItem | null>(null);
  const [activeSosIncidents, setActiveSosIncidents] = useState<SafetyIncidentView[]>([]);
  const [sharingLoading, setSharingLoading] = useState(false);
  const [sosSubmitting, setSosSubmitting] = useState(false);

  // 3. Modals State
  const [isAudioModalVisible, setIsAudioModalVisible] = useState(false);
  const [isSosModalVisible, setIsSosModalVisible] = useState(false);

  // 4. Load Data from Backend
  const loadData = useCallback(async () => {
    try {
      const [contactsData, prefsData, audioPref, liveRideData] = await Promise.allSettled([
        CustomerService.listTrustedContacts(),
        CustomerService.getPreferences(),
        AppStorage.getItem(AUDIO_RECORDING_KEY),
        SafetyService.findLiveRide(),
      ]);

      if (contactsData.status === 'fulfilled' && Array.isArray(contactsData.value)) {
        setContacts(contactsData.value);
      } else {
        setContacts([]);
      }

      if (prefsData.status === 'fulfilled' && prefsData.value) {
        setPreferences(prefsData.value);
      }

      if (audioPref.status === 'fulfilled') {
        setAudioRecordingEnabled(audioPref.value === 'true');
      }

      if (liveRideData.status === 'fulfilled' && liveRideData.value) {
        const found = liveRideData.value;
        setLiveRide(found);
        const rideKey = found.bookingId || found.id;
        if (rideKey) {
          const sosList = await SafetyService.getActiveSos(rideKey);
          setActiveSosIncidents(sosList);
        }
      } else {
        setLiveRide(null);
        setActiveSosIncidents([]);
      }
    } catch {
      // Handled gracefully with fallbacks
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      loadData();
    }, [loadData])
  );

  const onRefresh = async () => {
    setRefreshing(true);
    await loadData();
    setRefreshing(false);
  };

  // ========================================================
  // RIDE SHARING FEATURE (Dynamic Backend Connection)
  // ========================================================
  const handleToggleShareTripPref = async (val: boolean) => {
    if (val && contacts.length === 0) {
      Alert.alert(
        'Add Emergency Contact',
        'Please add at least one emergency contact before turning on automatic trip sharing.',
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Add Contact',
            onPress: () => router.push('/(app)/contacts' as any),
          },
        ]
      );
      return;
    }

    const updated = { ...preferences, autoShareTrips: val };
    setPreferences(updated);
    try {
      await CustomerService.updatePreferences({ autoShareTrips: val });
    } catch {
      Alert.alert('Error', 'Could not save trip sharing preference.');
      setPreferences(preferences);
    }
  };

  /** Dynamically share active ride via POST /rides/:rideId/share and open OS Share Drawer */
  const handleShareActiveRide = async () => {
    if (!liveRide) {
      Alert.alert(
        'No Active Ride',
        'Live trip sharing is activated during an ongoing trip. When you start your next ride, you can share your real-time tracking link directly from here.'
      );
      return;
    }

    const rideId = liveRide.bookingId || liveRide.id;
    if (!rideId) return;

    setSharingLoading(true);
    try {
      const res = await SafetyService.shareTrip(rideId);
      const trackingUrl = SafetyService.getPublicTrackingUrl(res.token);
      const destination = liveRide.dropLabel || liveRide.dropoff?.address || 'destination';

      await Share.share({
        title: 'Track My Cab Ride',
        message: `I'm travelling to ${destination}. Track my live cab location and route in real-time here: ${trackingUrl}`,
        url: trackingUrl,
      });
    } catch (err) {
      Alert.alert(
        'Trip Sharing Error',
        err instanceof Error ? err.message : 'Could not generate live tracking link.'
      );
    } finally {
      setSharingLoading(false);
    }
  };

  // ========================================================
  // SOS EMERGENCY FEATURE (Dynamic Backend Connection)
  // ========================================================
  const handleTriggerSos = () => {
    if (!liveRide) {
      setIsSosModalVisible(true);
      return;
    }

    Alert.alert(
      'Trigger Emergency SOS?',
      'This will instantly alert our 24/7 Safety Operations Desk and send an SMS with your live GPS location to all your emergency contacts.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Trigger SOS Alert',
          style: 'destructive',
          onPress: async () => {
            const rideId = liveRide.bookingId || liveRide.id;
            if (!rideId) return;

            setSosSubmitting(true);
            try {
              const res = await SafetyService.triggerSos(rideId, 'Rider triggered in-app emergency SOS');
              setActiveSosIncidents([res]);
              setIsSosModalVisible(false);
              Alert.alert(
                '🚨 SOS Alert Dispatched',
                'Our safety operations team has been notified, and an SMS with your live tracking link has been sent to your emergency contacts.'
              );
            } catch (err) {
              Alert.alert(
                'SOS Alert Failed',
                err instanceof Error ? err.message : 'Could not send SOS alert. Please dial 112 immediately.'
              );
            } finally {
              setSosSubmitting(false);
            }
          },
        },
      ]
    );
  };

  const handleCallNationalHelpline = () => {
    Linking.openURL(`tel:${NATIONAL_EMERGENCY_NUMBER}`).catch(() => {
      Alert.alert('Unable to Call', `Please dial ${NATIONAL_EMERGENCY_NUMBER} directly on your phone.`);
    });
  };

  const handleCallSafetyLine = () => {
    Linking.openURL(`tel:${SAFETY_HELPLINE_NUMBER}`).catch(() => {
      Alert.alert('Unable to Call', `Please dial ${SAFETY_HELPLINE_NUMBER} directly on your phone.`);
    });
  };

  // Toggle Audio Recording
  const handleToggleAudioRecording = async (val: boolean) => {
    setAudioRecordingEnabled(val);
    await AppStorage.setItem(AUDIO_RECORDING_KEY, val ? 'true' : 'false');
  };

  // Contact names summary for display
  const contactsSummary = useMemo(() => {
    if (contacts.length === 0) return null;
    return contacts.map((c) => c.name.split(' ')[0]).join(', ');
  }, [contacts]);

  const hasOpenSos = activeSosIncidents.some((i) => i.status === 'OPEN' || i.status === 'ACKNOWLEDGED');

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar style="dark" />
      <Header
        title="Safety preferences"
        showBack
        onBack={() => {
          if (router.canGoBack()) {
            router.back();
          } else {
            router.replace('/(app)/profile');
          }
        }}
      />

      <ScrollView
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
        }
      >
        {/* Title & Subtitle */}
        <View style={styles.headerSection}>
          <Text style={styles.pageTitle}>Safety preferences</Text>
          <Text style={styles.pageSubtitle}>
            Manage and schedule your safety features.
          </Text>
        </View>

        {/* ========================================================
         * Dynamic Active Ride Banner (When Ride is Underway)
         * ======================================================== */}
        {liveRide && (
          <View style={styles.activeRideBanner}>
            <View style={styles.activeRideHeader}>
              <View style={styles.activeRideBadge}>
                <View style={styles.activeRideDot} />
                <Text style={styles.activeRideBadgeText}>ACTIVE TRIP UNDERWAY</Text>
              </View>
              {hasOpenSos && (
                <View style={[styles.activeRideBadge, { backgroundColor: '#FEE2E2' }]}>
                  <Text style={[styles.activeRideBadgeText, { color: '#DC2626' }]}>🚨 SOS ACTIVE</Text>
                </View>
              )}
            </View>

            <Text style={styles.activeRideTitle}>
              Ride to {liveRide.dropLabel || liveRide.dropoff?.address || 'Destination'}
            </Text>
            <Text style={styles.activeRideSubtitle}>
              Live protections are enabled for this ongoing trip.
            </Text>

            <View style={styles.activeRideActionsRow}>
              <TouchableOpacity
                style={styles.shareLiveBtn}
                onPress={handleShareActiveRide}
                disabled={sharingLoading}
                activeOpacity={0.8}
              >
                {sharingLoading ? (
                  <ActivityIndicator size="small" color={COLORS.white} />
                ) : (
                  <>
                    <Ionicons name="share-social" size={16} color={COLORS.white} />
                    <Text style={styles.shareLiveBtnText}>Share Live GPS</Text>
                  </>
                )}
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.sosQuickBtn}
                onPress={handleTriggerSos}
                disabled={sosSubmitting}
                activeOpacity={0.8}
              >
                {sosSubmitting ? (
                  <ActivityIndicator size="small" color={COLORS.white} />
                ) : (
                  <>
                    <Ionicons name="shield-checkmark" size={16} color={COLORS.white} />
                    <Text style={styles.sosQuickBtnText}>SOS</Text>
                  </>
                )}
              </TouchableOpacity>
            </View>
          </View>
        )}

        {/* ========================================================
         * The Core Safety Features Card
         * ======================================================== */}
        <View style={styles.cardContainer}>
          {/* 1. Emergency contacts (Core) -> Opens Full Screen */}
          <TouchableOpacity
            style={[styles.featureRow, styles.featureRowDivider]}
            onPress={() => router.push('/(app)/contacts' as any)}
            activeOpacity={0.7}
          >
            <View style={[styles.iconBox, styles.iconBoxContacts]}>
              <Ionicons name="people" size={22} color={COLORS.primary} />
            </View>
            <View style={styles.featureTextCol}>
              <Text style={styles.featureTitle}>Emergency contacts</Text>
              <Text style={styles.featureSubtitle}>
                We'll call them in case of emergency.
              </Text>
              {contacts.length > 0 ? (
                <View style={styles.featureStatusPill}>
                  <Text style={styles.featureStatusText}>
                    {contacts.length} saved: {contactsSummary}
                  </Text>
                </View>
              ) : (
                <View style={styles.featureStatusPill}>
                  <Text style={styles.featureStatusText}>0 contacts added</Text>
                </View>
              )}
            </View>
            <Ionicons
              name="chevron-forward"
              size={20}
              color={COLORS.textSecondary}
            />
          </TouchableOpacity>

          {/* 2. Share trip location (Ride Sharing -> Dynamic Backend Connection) */}
          <TouchableOpacity
            style={[styles.featureRow, styles.featureRowDivider]}
            onPress={liveRide ? handleShareActiveRide : undefined}
            activeOpacity={liveRide ? 0.7 : 1}
          >
            <View style={[styles.iconBox, styles.iconBoxShare]}>
              <Ionicons name="navigate" size={22} color="#16A34A" />
            </View>
            <View style={styles.featureTextCol}>
              <Text style={styles.featureTitle}>Share trip location</Text>
              <Text style={styles.featureSubtitle}>
                {liveRide
                  ? 'Active trip found. Tap to share live tracking link.'
                  : preferences.autoShareTrips && contactsSummary
                  ? `Auto-sharing with ${contactsSummary}`
                  : 'Automatically share live ride tracking with trusted contacts.'}
              </Text>
              {liveRide && (
                <View style={[styles.featureStatusPill, { backgroundColor: '#DCFCE7' }]}>
                  <Text style={[styles.featureStatusText, { color: '#15803D' }]}>
                    Active ride ready to share →
                  </Text>
                </View>
              )}
            </View>
            <Switch
              value={preferences.autoShareTrips}
              onValueChange={handleToggleShareTripPref}
              trackColor={{ false: COLORS.border, true: COLORS.primary }}
            />
          </TouchableOpacity>

          {/* 3. Emergency SOS (Dynamic Backend Connection) */}
          <TouchableOpacity
            style={[styles.featureRow, styles.featureRowDivider]}
            onPress={() => setIsSosModalVisible(true)}
            activeOpacity={0.7}
          >
            <View style={[styles.iconBox, styles.iconBoxSos]}>
              <Ionicons name="alert-circle" size={22} color="#DC2626" />
            </View>
            <View style={styles.featureTextCol}>
              <Text style={styles.featureTitle}>Emergency SOS</Text>
              <Text style={styles.featureSubtitle}>
                {hasOpenSos
                  ? 'SOS Alert Active — Safety Response Team notified.'
                  : liveRide
                  ? 'Active trip underway • 1-tap emergency dispatch.'
                  : 'Direct access to National Emergency (112) and 24/7 Safety Desk.'}
              </Text>
              {hasOpenSos ? (
                <View style={[styles.featureStatusPill, { backgroundColor: '#FEE2E2' }]}>
                  <Text style={[styles.featureStatusText, { color: '#DC2626' }]}>
                    🚨 Incident Open
                  </Text>
                </View>
              ) : (
                <View style={styles.featureStatusPill}>
                  <Text style={styles.featureStatusText}>24/7 Monitored</Text>
                </View>
              )}
            </View>
            <Ionicons
              name="chevron-forward"
              size={20}
              color={COLORS.textSecondary}
            />
          </TouchableOpacity>

          {/* 4. Audio recording (Untouched) */}
          <TouchableOpacity
            style={styles.featureRow}
            onPress={() => setIsAudioModalVisible(true)}
            activeOpacity={0.7}
          >
            <View style={[styles.iconBox, styles.iconBoxAudio]}>
              <Ionicons name="mic" size={22} color="#9333EA" />
            </View>
            <View style={styles.featureTextCol}>
              <Text style={styles.featureTitle}>Audio recording</Text>
              <Text style={styles.featureSubtitle}>
                Record audio while you ride.
              </Text>
              {audioRecordingEnabled && (
                <View style={styles.featureStatusPill}>
                  <Text style={[styles.featureStatusText, { color: '#9333EA' }]}>
                    Active on all rides
                  </Text>
                </View>
              )}
            </View>
            {audioRecordingEnabled && <View style={styles.activeIndicatorDot} />}
            <Ionicons
              name="chevron-forward"
              size={20}
              color={COLORS.textSecondary}
            />
          </TouchableOpacity>
        </View>
      </ScrollView>

      {/* ========================================================
       * Emergency SOS Modal (Dynamic 1-Tap Trigger & Helplines)
       * ======================================================== */}
      <Modal
        visible={isSosModalVisible}
        animationType="slide"
        transparent
        onRequestClose={() => setIsSosModalVisible(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.sheetContainer}>
            <View style={styles.sheetHeader}>
              <Text style={styles.sheetHeaderTitle}>Emergency Assistance</Text>
              <TouchableOpacity
                onPress={() => setIsSosModalVisible(false)}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              >
                <Ionicons name="close" size={24} color={COLORS.text} />
              </TouchableOpacity>
            </View>

            <View style={styles.sosSheetContent}>
              <View style={styles.sosHeroBox}>
                <View style={styles.sosIconCircle}>
                  <Ionicons name="shield-checkmark" size={34} color="#DC2626" />
                </View>
                <Text style={styles.sosHeroTitle}>Emergency SOS Response</Text>
                <Text style={styles.sosHeroText}>
                  {liveRide
                    ? 'Triggering SOS freezes your live vehicle GPS snapshot, sounds an immediate alert at our control room, and texts your emergency contacts.'
                    : 'Ride SOS connects to active trips. For immediate assistance right now, you can connect directly with emergency responders below.'}
                </Text>
              </View>

              {hasOpenSos && (
                <View style={styles.sosStatusActiveBanner}>
                  <Text style={styles.sosStatusActiveTitle}>🚨 Active Alert in Progress</Text>
                  <Text style={styles.sosStatusActiveSub}>
                    Our safety operators have received your snapshot and are actively coordinating assistance.
                  </Text>
                </View>
              )}

              <View style={styles.sosActionList}>
                {liveRide && (
                  <TouchableOpacity
                    style={styles.sosPrimaryTriggerBtn}
                    onPress={handleTriggerSos}
                    disabled={sosSubmitting}
                    activeOpacity={0.8}
                  >
                    {sosSubmitting ? (
                      <ActivityIndicator size="small" color={COLORS.white} />
                    ) : (
                      <>
                        <Ionicons name="alert-circle" size={22} color={COLORS.white} />
                        <Text style={styles.sosPrimaryTriggerBtnText}>
                          Trigger Cab SOS Alert
                        </Text>
                      </>
                    )}
                  </TouchableOpacity>
                )}

                <TouchableOpacity
                  style={styles.sosDialerBtn}
                  onPress={handleCallNationalHelpline}
                  activeOpacity={0.8}
                >
                  <Ionicons name="call" size={18} color="#DC2626" />
                  <Text style={styles.sosDialerBtnText}>Call National Emergency (112)</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={styles.sosSupportBtn}
                  onPress={handleCallSafetyLine}
                  activeOpacity={0.8}
                >
                  <Ionicons name="headset" size={18} color={COLORS.primary} />
                  <Text style={styles.sosSupportBtnText}>Call 24/7 Safety Helpline</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </View>
      </Modal>

      {/* ========================================================
       * Audio Recording Information & Toggle Sheet (Untouched)
       * ======================================================== */}
      <Modal
        visible={isAudioModalVisible}
        animationType="slide"
        transparent
        onRequestClose={() => setIsAudioModalVisible(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.sheetContainer}>
            <View style={styles.sheetHeader}>
              <Text style={styles.sheetHeaderTitle}>Audio recording</Text>
              <TouchableOpacity
                onPress={() => setIsAudioModalVisible(false)}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              >
                <Ionicons name="close" size={24} color={COLORS.text} />
              </TouchableOpacity>
            </View>

            <View style={styles.audioSheetContent}>
              <View style={styles.audioHeroBox}>
                <View style={styles.audioIconCircle}>
                  <Ionicons name="mic" size={28} color="#9333EA" />
                </View>
                <Text style={styles.audioHeroTitle}>Record audio while you ride</Text>
                <Text style={styles.audioHeroText}>
                  Record audio during your trips for peace of mind. Audio is kept private and encrypted on your device.
                </Text>
              </View>

              <View style={styles.privacyHighlightBox}>
                <View style={styles.privacyPointRow}>
                  <Ionicons name="shield-checkmark" size={16} color="#16A34A" />
                  <Text style={styles.privacyPointText}>
                    Encrypted on-device: Neither the driver nor customer can listen to the recording.
                  </Text>
                </View>
                <View style={styles.privacyPointRow}>
                  <Ionicons name="lock-closed" size={16} color="#2563EB" />
                  <Text style={styles.privacyPointText}>
                    Only decrypted if you submit a safety incident report to support.
                  </Text>
                </View>
              </View>

              <View style={styles.audioToggleCard}>
                <View style={styles.audioToggleTextCol}>
                  <Text style={styles.audioToggleTitle}>
                    Enable for all rides
                  </Text>
                  <Text style={styles.audioToggleSub}>
                    Automatically start audio recording when your ride begins.
                  </Text>
                </View>
                <Switch
                  value={audioRecordingEnabled}
                  onValueChange={handleToggleAudioRecording}
                  trackColor={{ false: COLORS.border, true: '#9333EA' }}
                />
              </View>
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}
