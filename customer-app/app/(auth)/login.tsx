import React, { useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import CountryPicker, {
  Country,
  CountryCode,
} from 'react-native-country-picker-modal';
import { AppButton } from '../../src/components/common/AppButton';
import { COLORS } from '../../src/constants/colors';
import { useAuth } from '../../src/context/AuthContext';
import { styles } from '../../src/styles/login.styles';

export default function LoginScreen() {
  const [phone, setPhone] = useState('');
  const [countryCode, setCountryCode] = useState<CountryCode>('IN');
  const [callingCode, setCallingCode] = useState('91');
  const [countryPickerVisible, setCountryPickerVisible] = useState(false);
  const [isFocused, setIsFocused] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [demoLoading, setDemoLoading] = useState(false);

  const { requestOtp, loginDemoUser } = useAuth();

  const handleCountrySelect = (country: Country) => {
    setCountryCode(country.cca2);
    setCallingCode(country.callingCode[0] ?? '91');
    setPhone('');
    setError(null);
    setCountryPickerVisible(false);
  };

  const handleContinue = async () => {
    const cleanDigits = phone.replace(/\D/g, '');

    if (!cleanDigits) {
      setError('Please enter your mobile number.');
      return;
    }

    if (countryCode === 'IN' && cleanDigits.length !== 10) {
      setError('Please enter a valid 10-digit Indian mobile number.');
      return;
    }

    if (countryCode !== 'IN' && (cleanDigits.length < 7 || cleanDigits.length > 15)) {
      setError('Please enter a valid phone number.');
      return;
    }

    const fullPhone = `+${callingCode}${cleanDigits}`;

    try {
      setError(null);
      setLoading(true);
      // requestOtp will automatically fall back to demo challenge if backend is unreachable
      await requestOtp(fullPhone);
      router.push({
        pathname: '/(auth)/otp',
        params: { phone: fullPhone },
      });
    } catch (err) {
      // In case of unexpected issue, directly take to OTP screen
      router.push({
        pathname: '/(auth)/otp',
        params: { phone: fullPhone },
      });
    } finally {
      setLoading(false);
    }
  };

  const handleDemoLogin = async () => {
    try {
      setDemoLoading(true);
      setError(null);
      const cleanDigits = phone.replace(/\D/g, '');
      const customPhone = cleanDigits.length === 10 ? `+${callingCode}${cleanDigits}` : undefined;
      await loginDemoUser(customPhone);
      router.replace('/(app)');
    } catch (err) {
      setError('Demo login failed. Please try again.');
    } finally {
      setDemoLoading(false);
    }
  };

  const cleanDigits = phone.replace(/\D/g, '');
  const isButtonDisabled =
    countryCode === 'IN' ? cleanDigits.length !== 10 : cleanDigits.length < 7;

  return (
    <SafeAreaView style={styles.container}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.keyboardAvoid}
      >
        <View>
          {/* Top Bar with Back Button & Demo Pill */}
          <View style={styles.topBar}>
            <Pressable
              onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))}
              style={styles.backButton}
              accessibilityRole="button"
              accessibilityLabel="Go back"
            >
              <Ionicons name="chevron-back" size={24} color={COLORS.text} />
            </Pressable>

            <View style={styles.demoPill}>
              <Ionicons name="flash" size={14} color="#1E40AF" />
              <Text style={styles.demoPillText}>Demo Mode Enabled</Text>
            </View>
          </View>

          {/* Form Content */}
          <View style={styles.content}>
            <View style={styles.iconCircle}>
              <Ionicons name="call" size={28} color={COLORS.primary} />
            </View>

            <Text style={styles.title}>What's your number?</Text>
            <Text style={styles.description}>
              Enter your phone number. We'll send you a 6-digit verification code to
              confirm it's yours.
            </Text>

            <Text style={styles.label}>Phone number</Text>

            <View
              style={[
                styles.phoneRow,
                isFocused && styles.phoneRowFocused,
                Boolean(error) && styles.phoneRowError,
              ]}
            >
              <Pressable
                style={styles.countrySelector}
                onPress={() => setCountryPickerVisible(true)}
                accessibilityRole="button"
                accessibilityLabel="Choose country and calling code"
              >
                <CountryPicker
                  countryCode={countryCode}
                  withFlag
                  withCallingCode={false}
                  withFilter
                  withCountryNameButton={false}
                  withEmoji
                  visible={countryPickerVisible}
                  onSelect={handleCountrySelect}
                  onClose={() => setCountryPickerVisible(false)}
                />
                <Text style={styles.callingCode}>+{callingCode}</Text>
                <Text style={styles.chevron}>▾</Text>
              </Pressable>

              <View style={styles.separator} />

              <TextInput
                value={phone}
                onChangeText={(val) => {
                  setPhone(val.replace(/\D/g, '').slice(0, 15));
                  setError(null);
                }}
                onFocus={() => setIsFocused(true)}
                onBlur={() => setIsFocused(false)}
                placeholder={countryCode === 'IN' ? '98765 43210' : 'Phone number'}
                placeholderTextColor={COLORS.textSecondary}
                keyboardType="phone-pad"
                autoComplete="tel"
                textContentType="telephoneNumber"
                accessibilityLabel="Phone number"
                style={styles.phoneInput}
                maxLength={15}
              />
            </View>

            {error ? <Text style={styles.errorText}>{error}</Text> : null}

            <Text style={styles.privacyText}>
              By continuing, you agree to our Terms of Service & Privacy Policy. Message
              and data rates may apply.
            </Text>
          </View>
        </View>

        {/* Footer Actions */}
        <View style={styles.footer}>
          <AppButton
            title="Continue"
            onPress={handleContinue}
            loading={loading}
            disabled={isButtonDisabled}
          />

          <View style={styles.orRow}>
            <View style={styles.orLine} />
            <Text style={styles.orText}>OR</Text>
            <View style={styles.orLine} />
          </View>

          <TouchableOpacity
            style={styles.demoLoginBtn}
            onPress={handleDemoLogin}
            disabled={demoLoading}
            activeOpacity={0.7}
          >
            <Ionicons name="flash" size={18} color="#15803D" />
            <Text style={styles.demoLoginBtnText}>
              {demoLoading ? 'Signing in...' : '⚡ Instant Demo Login (Skip OTP)'}
            </Text>
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
