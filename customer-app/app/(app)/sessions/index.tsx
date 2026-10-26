import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  RefreshControl,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Badge } from '../../../src/components/common/Badge';
import { Header } from '../../../src/components/common/Header';
import { COLORS } from '../../../src/constants/colors';
import { useAuth } from '../../../src/context/AuthContext';
import { AuthService } from '../../../src/services/auth.service';
import { styles } from '../../../src/styles/sessions.styles';
import type { UserSession } from '../../../src/types/auth.types';

function getDeviceIcon(platform?: string): keyof typeof Ionicons.glyphMap {
  const p = platform?.toLowerCase() || '';
  if (p.includes('android')) return 'logo-android';
  if (p.includes('ios') || p.includes('apple')) return 'logo-apple';
  if (p.includes('web')) return 'globe-outline';
  return 'phone-portrait-outline';
}

function formatSessionDate(dateString?: string | null): string {
  if (!dateString) return 'Active now';
  try {
    const d = new Date(dateString);
    return d.toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return dateString;
  }
}

export default function SessionsScreen() {
  const { logout } = useAuth();
  const [sessions, setSessions] = useState<UserSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [revokingId, setRevokingId] = useState<string | null>(null);

  const fetchSessions = useCallback(async () => {
    try {
      const data = await AuthService.listSessions();
      setSessions(Array.isArray(data) ? data : []);
    } catch (err) {
      Alert.alert(
        'Error',
        err instanceof Error ? err.message : 'Failed to load active sessions',
      );
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    fetchSessions();
  }, [fetchSessions]);

  const onRefresh = () => {
    setRefreshing(true);
    fetchSessions();
  };

  const handleRevoke = (session: UserSession) => {
    Alert.alert(
      session.current ? 'Log Out Current Device?' : 'Revoke Session?',
      session.current
        ? 'You will be logged out of this device and returned to the login screen.'
        : 'This device will be logged out and will need to verify OTP to sign in again.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: session.current ? 'Log Out' : 'Revoke',
          style: 'destructive',
          onPress: async () => {
            try {
              setRevokingId(session.id);
              await AuthService.revokeSession(session.id);

              if (session.current) {
                await logout();
                router.replace('/(auth)/login');
                return;
              }

              setSessions((prev) => prev.filter((s) => s.id !== session.id));
              Alert.alert('Session Revoked', 'The device has been successfully signed out.');
            } catch (err) {
              Alert.alert(
                'Action Failed',
                err instanceof Error ? err.message : 'Could not revoke session',
              );
            } finally {
              setRevokingId(null);
            }
          },
        },
      ],
    );
  };

  const renderSessionItem = ({ item }: { item: UserSession }) => {
    const isCurrent = Boolean(item.current);
    const platform = item.device?.platform || 'Mobile Device';
    const appVer = item.device?.appVersion ? `v${item.device.appVersion}` : '';
    const iconName = getDeviceIcon(platform);

    return (
      <View style={[styles.sessionCard, isCurrent && styles.sessionCardCurrent]}>
        <View style={styles.topRow}>
          <View style={[styles.iconBox, isCurrent && styles.iconBoxCurrent]}>
            <Ionicons
              name={iconName}
              size={24}
              color={isCurrent ? COLORS.primary : COLORS.textSecondary}
            />
          </View>
          <View style={styles.deviceInfo}>
            <Text style={styles.deviceName}>
              {platform.toUpperCase()} {appVer ? `• ${appVer}` : ''}
            </Text>
            <View style={styles.badgeRow}>
              {isCurrent ? (
                <Badge label="Current Device" variant="success" />
              ) : (
                <Badge label="Active Session" variant="neutral" />
              )}
            </View>
            <Text style={styles.metaText}>
              {isCurrent
                ? 'Active right now'
                : `Last active: ${formatSessionDate(item.lastUsedAt || item.createdAt)}`}
            </Text>
          </View>
        </View>

        <View style={styles.actionRow}>
          <TouchableOpacity
            style={styles.revokeButton}
            onPress={() => handleRevoke(item)}
            disabled={revokingId === item.id}
          >
            {revokingId === item.id ? (
              <ActivityIndicator size="small" color={COLORS.error} />
            ) : (
              <Text style={styles.revokeText}>
                {isCurrent ? 'Log Out' : 'Revoke Access'}
              </Text>
            )}
          </TouchableOpacity>
        </View>
      </View>
    );
  };

  return (
    <SafeAreaView style={styles.container}>
      <Header title="Device Sessions" showBack onBack={() => router.back()} />

      {loading ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={COLORS.primary} />
        </View>
      ) : (
        <FlatList
          data={sessions}
          keyExtractor={(item) => item.id}
          renderItem={renderSessionItem}
          contentContainerStyle={styles.listContent}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              colors={[COLORS.primary]}
            />
          }
          ListHeaderComponent={
            <View style={styles.infoBanner}>
              <Ionicons name="shield-checkmark" size={20} color="#1E40AF" />
              <Text style={styles.infoText}>
                Manage active devices signed into your account. If you see a device you do not
                recognize, revoke it immediately to keep your account secure.
              </Text>
            </View>
          }
          ListEmptyComponent={
            <View style={styles.emptyContainer}>
              <Ionicons name="phone-portrait-outline" size={48} color={COLORS.textSecondary} />
              <Text style={styles.emptyTitle}>No Other Active Sessions</Text>
              <Text style={styles.emptySubtitle}>
                Only this current device is signed into your account.
              </Text>
            </View>
          }
        />
      )}
    </SafeAreaView>
  );
}
