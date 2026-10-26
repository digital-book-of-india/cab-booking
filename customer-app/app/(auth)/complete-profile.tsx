import React, { useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  Text,
  View,
} from 'react-native';
import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { AppButton } from '../../src/components/common/AppButton';
import { AppInput } from '../../src/components/common/AppInput';
import { useAuth } from '../../src/context/AuthContext';
import { styles } from '../../src/styles/completeProfile.styles';

export default function CompleteProfileScreen() {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const { updateProfile } = useAuth();

  const handleSave = async () => {
    if (!name.trim()) {
      setError('Please enter your full name');
      return;
    }

    if (email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      setError('Please enter a valid email address');
      return;
    }

    try {
      setError(null);
      setLoading(true);
      await updateProfile(name.trim(), email.trim() || null);
      router.replace('/(app)');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save profile.');
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
          <Text style={styles.title}>What's your name?</Text>
          <Text style={styles.subtitle}>
            Let drivers know who they are picking up.
          </Text>

          <View style={styles.form}>
            <AppInput
              label="Full Name *"
              placeholder="e.g. Rahul Sharma"
              value={name}
              onChangeText={(text: string) => {
                setName(text);
                setError(null);
              }}
              error={error || undefined}
            />

            <AppInput
              label="Email Address (Optional)"
              placeholder="rahul@example.com"
              keyboardType="email-address"
              autoCapitalize="none"
              value={email}
              onChangeText={(text: string) => {
                setEmail(text);
                setError(null);
              }}
            />
          </View>
        </View>

        <View style={styles.footer}>
          <AppButton
            title="Complete Setup"
            onPress={handleSave}
            loading={loading}
            disabled={!name.trim()}
          />
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
