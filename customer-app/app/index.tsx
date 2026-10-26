import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { StatusBar } from "expo-status-bar";
import { router } from "expo-router";
import { Ionicons } from "@expo/vector-icons";

import ScreenContainer from "../src/components/layout/ScreenContainer";
import AppButton from "../src/components/common/AppButton";
import { COLORS, SPACING, TYPOGRAPHY, RADIUS } from "../src/constants/colors";

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
          onPress={() => router.push("/auth/register")}
        />

        <View style={styles.loginRow}>
          <Text style={styles.loginText}>Already have an account?</Text>

          <Text
            accessibilityRole="link"
            onPress={() => router.push("/auth/login")}
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

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: "space-between",
    backgroundColor: COLORS.background,
  },

  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: SPACING.sm,
    paddingTop: SPACING.md,
  },

  logo: {
    width: 42,
    height: 42,
    borderRadius: RADIUS.md,
    backgroundColor: COLORS.primary,
    alignItems: "center",
    justifyContent: "center",
  },

  logoText: {
    color: COLORS.white,
    fontSize: TYPOGRAPHY.heading,
    fontWeight: "800",
  },

  brandName: {
    color: COLORS.text,
    fontSize: TYPOGRAPHY.subtitle,
    fontWeight: "700",
  },

  content: {
    alignItems: "flex-start",
    marginVertical: SPACING.xl,
  },

  illustration: {
    width: 150,
    height: 150,
    borderRadius: 75,
    backgroundColor: "#DBEAFE",
    alignItems: "center",
    justifyContent: "center",
    alignSelf: "center",
    marginBottom: SPACING.xl,
  },

  title: {
    color: COLORS.text,
    fontSize: 36,
    lineHeight: 44,
    fontWeight: "800",
    marginBottom: SPACING.md,
  },

  description: {
    color: COLORS.textSecondary,
    fontSize: TYPOGRAPHY.body,
    lineHeight: 25,
  },

  footer: {
    gap: SPACING.md,
    paddingBottom: SPACING.md,
  },

  loginRow: {
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "center",
    gap: SPACING.xs,
    flexWrap: "wrap",
  },

  loginText: {
    color: COLORS.textSecondary,
    fontSize: TYPOGRAPHY.caption + 2,
  },

  loginLink: {
    color: COLORS.primary,
    fontSize: TYPOGRAPHY.caption + 2,
    fontWeight: "700",
    padding: SPACING.xs,
  },

  terms: {
    color: COLORS.textSecondary,
    fontSize: TYPOGRAPHY.caption,
    textAlign: "center",
    lineHeight: 18,
  },
});
