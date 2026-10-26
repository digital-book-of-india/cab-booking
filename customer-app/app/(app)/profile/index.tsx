import React, { useEffect, useState } from 'react';
import {
  Alert,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
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
import { useAuth } from '../../../src/context/AuthContext';
import { CustomerService } from '../../../src/services/customer.service';
import { styles } from '../../../src/styles/profile.styles';
import type { CustomerProfile } from '../../../src/types/customer.types';

export default function ProfileScreen() {
  const { user, updateProfile, logout } = useAuth();
  const [profile, setProfile] = useState<CustomerProfile | null>(null);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    async function load() {
      try {
        setLoading(true);
        const p = await CustomerService.getProfile();
        if (mounted) {
          setProfile(p);
          setName(p.name || '');
          setEmail(p.email || '');
        }
      } catch {
        // fallback to auth user
        if (mounted && user) {
          setName(user.name || '');
          setEmail(user.email || '');
        }
      } finally {
        if (mounted) setLoading(false);
      }
    }
    load();
    return () => {
      mounted = false;
    };
  }, [user]);

  const handleSave = async () => {
    if (!name.trim()) {
      setError('Name cannot be empty');
      return;
    }

    try {
      setError(null);
      setSuccessMsg(null);
      setSaving(true);
      await updateProfile(name.trim(), email.trim() || null);
      setSuccessMsg('Profile updated successfully!');
      setTimeout(() => setSuccessMsg(null), 3000);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update profile');
    } finally {
      setSaving(false);
    }
  };

  const handleLogout = () => {
    Alert.alert('Sign Out', 'Are you sure you want to log out of your account?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Log Out',
        style: 'destructive',
        onPress: async () => {
          await logout();
          router.replace('/(auth)/login');
        },
      },
    ]);
  };

  return (
    <SafeAreaView style={styles.container}>
      <Header title="Account Settings" />

      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={{ flex: 1 }}
      >
        <ScrollView contentContainerStyle={styles.scrollContent}>
          {/* Avatar Section */}
          <View style={styles.avatarSection}>
            <View style={styles.avatarCircle}>
              <Ionicons name="person" size={42} color={COLORS.primary} />
            </View>
            <Text style={styles.phoneText}>{user?.phone}</Text>
            <View style={styles.statusBadgeContainer}>
              <Badge
                label={profile?.accountStatus || 'ACTIVE'}
                variant={profile?.accountStatus === 'ACTIVE' ? 'success' : 'warning'}
              />
            </View>
          </View>

          {/* Edit Profile Form */}
          <View style={styles.formCard}>
            <Text style={styles.sectionTitle}>Personal Details</Text>

            <AppInput
              label="Full Name"
              value={name}
              onChangeText={(t: string) => {
                setName(t);
                setError(null);
              }}
              placeholder="Your name"
            />

            <AppInput
              label="Email Address"
              value={email}
              onChangeText={(t: string) => {
                setEmail(t);
                setError(null);
              }}
              placeholder="name@domain.com"
              keyboardType="email-address"
              autoCapitalize="none"
              error={error || undefined}
            />

            {successMsg ? (
              <Text style={{ color: COLORS.success, fontSize: 13, marginBottom: 8 }}>
                {successMsg}
              </Text>
            ) : null}

            <View style={styles.saveBtnContainer}>
              <AppButton
                title="Save Changes"
                onPress={handleSave}
                loading={saving}
                disabled={!name.trim()}
              />
            </View>
          </View>

          {/* Quick Account Navigation */}
          <View style={styles.formCard}>
            <Text style={styles.sectionTitle}>Preferences & Services</Text>

            <TouchableOpacity
              style={styles.infoRow}
              onPress={() => router.push('/(app)/places' as any)}
            >
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                <Ionicons name="location-outline" size={20} color={COLORS.primary} />
                <Text style={styles.infoLabel}>Manage Saved Places</Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color={COLORS.textSecondary} />
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.infoRow}
              onPress={() => router.push('/(app)/preferences' as any)}
            >
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                <Ionicons name="options-outline" size={20} color={COLORS.primary} />
                <Text style={styles.infoLabel}>Ride Preferences</Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color={COLORS.textSecondary} />
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.infoRow}
              onPress={() => router.push('/(app)/contacts' as any)}
            >
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                <Ionicons name="shield-outline" size={20} color={COLORS.primary} />
                <Text style={styles.infoLabel}>Trusted & Emergency Contacts</Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color={COLORS.textSecondary} />
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.infoRow}
              onPress={() => router.push('/(app)/sessions' as any)}
            >
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                <Ionicons name="phone-portrait-outline" size={20} color={COLORS.primary} />
                <Text style={styles.infoLabel}>Active Device Sessions</Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color={COLORS.textSecondary} />
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.infoRow}
              onPress={() => router.push('/(app)/wallet' as any)}
            >
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                <Ionicons name="wallet-outline" size={20} color={COLORS.primary} />
                <Text style={styles.infoLabel}>Wallet & Payment Methods</Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color={COLORS.textSecondary} />
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.infoRow}
              onPress={() => router.push('/(app)/support' as any)}
            >
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                <Ionicons name="help-buoy-outline" size={20} color={COLORS.primary} />
                <Text style={styles.infoLabel}>Support Tickets</Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color={COLORS.textSecondary} />
            </TouchableOpacity>
          </View>

          {/* Logout */}
          <View style={styles.logoutBtnContainer}>
            <AppButton
              title="Log Out"
              variant="outline"
              onPress={handleLogout}
            />
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
