import React, { useEffect, useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { AppButton } from '../../src/components/common/AppButton';
import { Header } from '../../src/components/common/Header';
import { OtpInput } from '../../src/components/common/OtpInput';
import { useAuth } from '../../src/context/AuthContext';
import { styles } from '../../src/styles/otp.styles';

export default function OtpScreen() {
  const params = useLocalSearchParams<{ phone?: string }>();
  const phone = params.phone ?? '';
  const [otp, setOtp] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [resendTimer, setResendTimer] = useState<number>(30);
  const { verifyOtp, requestOtp, activeChallenge } = useAuth();

  useEffect(() => {
    if (activeChallenge?.resendAfterSeconds) {
      setResendTimer(activeChallenge.resendAfterSeconds);
    }
  }, [activeChallenge]);

  useEffect(() => {
    if (resendTimer <= 0) return;
    const interval = setInterval(() => {
      setResendTimer((prev) => (prev > 0 ? prev - 1 : 0));
    }, 1000);
    return () => clearInterval(interval);
  }, [resendTimer]);

  const handleVerify = async () => {
    if (otp.length !== 6) {
      setError('Please enter the complete 6-digit OTP');
      return;
    }

    try {
      setError(null);
      setLoading(true);
      const verifiedUser = await verifyOtp(otp, {
        platform: Platform.OS,
        appVersion: '1.0.0',
      });

      if (!verifiedUser.profileComplete) {
        router.replace('/(auth)/complete-profile');
      } else {
        router.replace('/(app)');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Invalid or expired OTP.');
    } finally {
      setLoading(false);
    }
  };

  const handleResend = async () => {
    if (resendTimer > 0 || !phone) return;
    try {
      setError(null);
      const res = await requestOtp(phone);
      setResendTimer(res.resendAfterSeconds || 30);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to resend OTP.');
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <Header title="Verification" showBack onBack={() => router.back()} />

      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={{ flex: 1, justifyContent: 'space-between' }}
      >
        <View style={styles.header}>
          <Text style={styles.title}>Enter 6-digit OTP</Text>
          <Text style={styles.subtitle}>
            Code sent to <Text style={styles.phoneHighlight}>{phone}</Text>
          </Text>

          <View style={styles.otpSection}>
            <OtpInput
              value={otp}
              onChange={(val) => {
                setOtp(val);
                setError(null);
              }}
              error={Boolean(error)}
            />

            {error ? <Text style={styles.errorText}>{error}</Text> : null}

            {/* Dev Mode Test OTP Helper */}
            <TouchableOpacity
              style={styles.testOtpBanner}
              onPress={() => setOtp('123456')}
              activeOpacity={0.7}
            >
              <Text style={styles.testOtpText}>
                🧪 Test / Demo Mode: Tap here to fill OTP <Text style={{ fontWeight: '800' }}>123456</Text>
              </Text>
            </TouchableOpacity>

            <View style={styles.resendRow}>
              <Text style={styles.resendText}>Didn't receive the code?</Text>
              <TouchableOpacity
                onPress={handleResend}
                disabled={resendTimer > 0}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              >
                <Text
                  style={[
                    styles.resendAction,
                    resendTimer > 0 && styles.resendDisabled,
                  ]}
                >
                  {resendTimer > 0 ? `Resend in ${resendTimer}s` : 'Resend OTP'}
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>

        <View style={styles.footer}>
          <AppButton
            title="Verify & Proceed"
            onPress={handleVerify}
            loading={loading}
            disabled={otp.length !== 6}
          />
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
