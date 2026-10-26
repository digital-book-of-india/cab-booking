import React, { useEffect } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { Slot, useRouter, useSegments } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { AuthProvider, useAuth } from '../src/context/AuthContext';
import { COLORS } from '../src/constants/colors';

function RootNavigationGate() {
  const { isAuthenticated, isLoading, user } = useAuth();
  const segments = useSegments();
  const router = useRouter();

  useEffect(() => {
    if (isLoading) return;

    const firstSegment = (segments as string[])[0];
    const inAuthGroup = firstSegment === '(auth)' || firstSegment === 'auth';
    const isRootWelcome = !firstSegment || firstSegment === 'index';

    if (!isAuthenticated) {
      if (!inAuthGroup && !isRootWelcome) {
        router.replace('/(auth)/login');
      }
    } else {
      // Authenticated
      if (user && !user.profileComplete) {
        // Needs to complete their name/email
        const secondSegment = (segments as string[])[1];
        if (secondSegment !== 'complete-profile') {
          router.replace('/(auth)/complete-profile');
        }
      } else if (inAuthGroup || isRootWelcome) {
        // Already logged in & completed profile -> go to main app
        router.replace('/(app)');
      }
    }
  }, [isAuthenticated, isLoading, user, segments, router]);

  if (isLoading) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: COLORS.surface }}>
        <ActivityIndicator size="large" color={COLORS.primary} />
      </View>
    );
  }

  return <Slot />;
}

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <AuthProvider>
        <StatusBar style="dark" />
        <RootNavigationGate />
      </AuthProvider>
    </SafeAreaProvider>
  );
}
