import React from 'react';
import { Tabs } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { COLORS } from '../../src/constants/colors';

export default function AppLayout() {
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: COLORS.primary,
        tabBarInactiveTintColor: COLORS.textSecondary,
        tabBarStyle: {
          backgroundColor: COLORS.surface,
          borderTopColor: COLORS.border,
          height: 60,
          paddingBottom: 8,
          paddingTop: 8,
        },
        tabBarLabelStyle: {
          fontSize: 11,
          fontWeight: '600',
        },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: 'Home',
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="home" color={color as string} size={size} />
          ),
        }}
      />
      <Tabs.Screen
        name="rides/index"
        options={{
          title: 'Activity',
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="time" color={color as string} size={size} />
          ),
        }}
      />
      <Tabs.Screen
        name="wallet/index"
        options={{
          title: 'Wallet',
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="wallet" color={color as string} size={size} />
          ),
        }}
      />
      <Tabs.Screen
        name="profile/index"
        options={{
          title: 'Account',
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="person" color={color as string} size={size} />
          ),
        }}
      />

      {/* Hidden sub-routes from bottom tab bar */}
      <Tabs.Screen
        name="rides/[id]"
        options={{
          href: null,
        }}
      />
      <Tabs.Screen
        name="rides/receipt/[id]"
        options={{
          href: null,
        }}
      />
      <Tabs.Screen
        name="places/index"
        options={{
          href: null,
        }}
      />
      <Tabs.Screen
        name="support/index"
        options={{
          href: null,
        }}
      />
      <Tabs.Screen
        name="support/[id]"
        options={{
          href: null,
        }}
      />
      <Tabs.Screen
        name="notifications/index"
        options={{
          href: null,
        }}
      />
      <Tabs.Screen
        name="sessions/index"
        options={{
          href: null,
        }}
      />
      <Tabs.Screen
        name="contacts/index"
        options={{
          href: null,
        }}
      />
      <Tabs.Screen
        name="preferences/index"
        options={{
          href: null,
        }}
      />
    </Tabs>
  );
}
