import React, { useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  Text,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { AppButton } from '../../src/components/common/AppButton';
import { AppInput } from '../../src/components/common/AppInput';
import { COLORS } from '../../src/constants/colors';
import { APP_CONFIG } from '../../src/constants/config';
import { useAuth } from '../../src/context/AuthContext';
import { styles } from '../../src/styles/login.styles';

export default function LoginScreen() {
  const [phone, setPhone] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const { requestOtp } = useAuth();

  const handleSendOtp = async () => {
    const rawDigits = phone.replace(/[^0-9]/g, '');
    if (!rawDigits || rawDigits.length < 10) {
      setError('Please enter a valid 10-digit mobile number');
      return;
    }

    const fullPhone = `${APP_CONFIG.defaultCountryCode}${rawDigits.slice(-10)}`;

    try {
      setError(null);
      setLoading(true);
      await requestOtp(fullPhone);
      router.push({
        pathname: '/(auth)/otp',
        params: { phone: fullPhone },
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not send OTP. Try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={{ flex: 1, justifyContent: 'space-between' }}
      >
        <View style={styles.header}>
          <View style={styles.brandBadge}>
            <Ionicons name="car" size={18} color={COLORS.primary} />
            <Text style={styles.brandText}>{APP_CONFIG.appName.toUpperCase()}</Text>
          </View>
          <Text style={styles.title}>Enter your mobile number</Text>
          <Text style={styles.subtitle}>
            We will send a 6-digit verification code to confirm your phone.
          </Text>

          <View style={styles.form}>
            <View style={styles.phoneRow}>
              <View style={styles.countryCodeBox}>
                <Text style={styles.countryCodeText}>{APP_CONFIG.defaultCountryCode}</Text>
              </View>
              <View style={styles.phoneInputWrapper}>
                <AppInput
                  placeholder="98765 43210"
                  keyboardType="phone-pad"
                  maxLength={10}
                  value={phone}
                  onChangeText={(text: string) => {
                    setPhone(text);
                    setError(null);
                  }}
                  error={error || undefined}
                />
              </View>
            </View>
          </View>
        </View>

        <View style={styles.footer}>
          <AppButton
            title="Continue"
            onPress={handleSendOtp}
            loading={loading}
            disabled={phone.replace(/[^0-9]/g, '').length < 10}
          />
          <Text style={styles.disclaimer}>
            By continuing, you agree to our Terms of Service & Privacy Policy.
          </Text>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
