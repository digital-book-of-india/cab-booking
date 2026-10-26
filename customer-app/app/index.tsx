import React from "react";
import { Text, View } from "react-native";
import { StatusBar } from "expo-status-bar";
import { router } from "expo-router";
import { Ionicons } from "@expo/vector-icons";

import ScreenContainer from "../src/components/layout/ScreenContainer";
import { AppButton } from "../src/components/common/AppButton";
import { COLORS } from "../src/constants/colors";
import { styles } from "../src/styles/welcome.styles";

export default function WelcomeScreen() {
  return (
    <ScreenContainer style={styles.container}>
      <StatusBar style="dark" />

      {/* Branding */}
      <View style={styles.header}>
        <View style={styles.logo}>
          <Text style={styles.logoText}>C</Text>
        </View>

        <Text style={styles.brandName}>Cab Booking</Text>
      </View>

      {/* Welcome Content */}
      <View style={styles.content}>
        <View style={styles.illustration}>
          <Ionicons name="car-sport" size={90} color={COLORS.primary} />
        </View>

        <Text style={styles.title}>Your journey{"\n"}starts here.</Text>

        <Text style={styles.description}>
          Book your ride in seconds. Travel comfortably, safely, and on your
          schedule.
        </Text>
      </View>

      {/* Actions */}
      <View style={styles.footer}>
        <AppButton
          title="Get Started"
          onPress={() => router.push("/(auth)/login")}
        />

        <View style={styles.loginRow}>
          <Text style={styles.loginText}>Already have an account?</Text>

          <Text
            accessibilityRole="link"
            onPress={() => router.push("/(auth)/login")}
            style={styles.loginLink}
          >
            Log In
          </Text>
        </View>

        <Text style={styles.terms}>
          By continuing, you agree to our Terms of Service and Privacy Policy.
        </Text>
      </View>
    </ScreenContainer>
  );
}
