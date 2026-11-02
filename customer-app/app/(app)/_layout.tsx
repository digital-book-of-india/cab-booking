import React from "react";
import { Platform, StyleSheet, View } from "react-native";
import { Tabs } from "expo-router";
import { Ionicons } from "@expo/vector-icons";

// Sub-screens that should not appear on the bottom tab dock and should be full-screen.
// In Expo Router 58, setting `href: null` flags screens with `hidden: true`,
// which causes `useVisibleTabsWithRedirect` to force a redirect to the initial tab (Home).
// Using `tabBarButton: () => null` and `tabBarItemStyle: { display: "none" }` safely hides them from the dock
// without triggering that redirect.
const HIDDEN_SUB_SCREEN_OPTIONS = {
  headerShown: false,
  tabBarStyle: { display: "none" as const },
  tabBarItemStyle: { display: "none" as const },
  tabBarButton: () => null,
};

export default function AppLayout() {
  return (
    <Tabs
      backBehavior="history"
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: "#FFFFFF",
        tabBarInactiveTintColor: "#94A3B8",
        tabBarShowLabel: true,
        tabBarLabelStyle: {
          fontSize: 11,
          fontWeight: "700",
          marginTop: -2,
        },
        // Modern Floating Dock Tab Bar
        tabBarStyle: {
          position: "absolute",
          bottom: Platform.OS === "ios" ? 24 : 16,
          left: 16,
          right: 16,
          height: 66,
          borderRadius: 36,
          backgroundColor: "#1E293B", // Sleek dark dock from modern ride apps
          borderTopWidth: 0,
          paddingTop: 8,
          paddingBottom: 8,
          paddingHorizontal: 8,
          elevation: 12,
          shadowColor: "#000",
          shadowOffset: { width: 0, height: 6 },
          shadowOpacity: 0.25,
          shadowRadius: 12,
        },
      }}
    >
      {/* 1. HOME TAB */}
      <Tabs.Screen
        name="index"
        options={{
          title: "Home",
          tabBarIcon: ({ color, focused }) => (
            <View style={[styles.pillContainer, focused && styles.activePill]}>
              <Ionicons
                name={focused ? "home" : "home-outline"}
                size={22}
                color={focused ? "#FFFFFF" : (color as string)}
              />
            </View>
          ),
        }}
      />

      {/* 2. SERVICES TAB (New Tab) */}
      <Tabs.Screen
        name="services/index"
        options={{
          title: "Services",
          tabBarIcon: ({ color, focused }) => (
            <View style={[styles.pillContainer, focused && styles.activePill]}>
              <Ionicons
                name={focused ? "grid" : "grid-outline"}
                size={22}
                color={focused ? "#FFFFFF" : (color as string)}
              />
            </View>
          ),
        }}
      />

      {/* 3. ACTIVITY TAB */}
      <Tabs.Screen
        name="rides/index"
        options={{
          title: "Activity",
          tabBarIcon: ({ color, focused }) => (
            <View style={[styles.pillContainer, focused && styles.activePill]}>
              <Ionicons
                name={focused ? "receipt" : "receipt-outline"}
                size={22}
                color={focused ? "#FFFFFF" : (color as string)}
              />
            </View>
          ),
        }}
      />

      {/* 4. ACCOUNT TAB */}
      <Tabs.Screen
        name="profile/index"
        options={{
          title: "Account",
          tabBarIcon: ({ color, focused }) => (
            <View style={[styles.pillContainer, focused && styles.activePill]}>
              <Ionicons
                name={focused ? "person" : "person-outline"}
                size={22}
                color={focused ? "#FFFFFF" : (color as string)}
              />
            </View>
          ),
        }}
      />

      {/* 5. SUB-ROUTES (Hidden from bottom dock, full-screen, without href:null auto-redirect) */}
      <Tabs.Screen
        name="wallet/index"
        options={HIDDEN_SUB_SCREEN_OPTIONS}
      />
      <Tabs.Screen
        name="family/index"
        options={HIDDEN_SUB_SCREEN_OPTIONS}
      />
      <Tabs.Screen
        name="rewards/index"
        options={HIDDEN_SUB_SCREEN_OPTIONS}
      />
      <Tabs.Screen
        name="rides/[id]"
        options={HIDDEN_SUB_SCREEN_OPTIONS}
      />
      <Tabs.Screen
        name="rides/receipt/[id]"
        options={HIDDEN_SUB_SCREEN_OPTIONS}
      />
      <Tabs.Screen
        name="places/index"
        options={HIDDEN_SUB_SCREEN_OPTIONS}
      />
      <Tabs.Screen
        name="support/index"
        options={HIDDEN_SUB_SCREEN_OPTIONS}
      />
      <Tabs.Screen
        name="support/[id]"
        options={HIDDEN_SUB_SCREEN_OPTIONS}
      />
      <Tabs.Screen
        name="support/tickets"
        options={HIDDEN_SUB_SCREEN_OPTIONS}
      />
      <Tabs.Screen
        name="notifications/index"
        options={HIDDEN_SUB_SCREEN_OPTIONS}
      />
      <Tabs.Screen
        name="sessions/index"
        options={HIDDEN_SUB_SCREEN_OPTIONS}
      />
      <Tabs.Screen
        name="contacts/index"
        options={HIDDEN_SUB_SCREEN_OPTIONS}
      />
      <Tabs.Screen
        name="preferences/index"
        options={HIDDEN_SUB_SCREEN_OPTIONS}
      />
      <Tabs.Screen
        name="safety/index"
        options={HIDDEN_SUB_SCREEN_OPTIONS}
      />
    </Tabs>
  );
}

const styles = StyleSheet.create({
  pillContainer: {
    alignItems: "center",
    justifyContent: "center",
    width: 48,
    height: 30,
    borderRadius: 15,
  },
  activePill: {
    backgroundColor: "#334155", // Pill capsule background behind active icon
  },
});
