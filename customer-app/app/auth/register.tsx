import React, { useState } from "react";
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  Text,
  TextInput,
  View,
} from "react-native";
import { router } from "expo-router";

import CountryPicker, {
  Country,
  CountryCode,
} from "react-native-country-picker-modal";

import ScreenContainer from "../../src/components/layout/ScreenContainer";
import AppButton from "../../src/components/common/AppButton";
import { COLORS } from "../../src/constants/colors";
import { styles } from "./registerScreen.Styling";

export default function RegisterScreen() {
  const [phone, setPhone] = useState("");
  const [countryCode, setCountryCode] = useState<CountryCode>("IN");
  const [callingCode, setCallingCode] = useState("91");
  const [countryPickerVisible, setCountryPickerVisible] = useState(false);
  const [error, setError] = useState("");

  const handleCountrySelect = (country: Country) => {
    setCountryCode(country.cca2);
    setCallingCode(country.callingCode[0] ?? "");
    setPhone("");
    setError("");
    setCountryPickerVisible(false);
  };

  const handleContinue = () => {
    const cleanedPhone = phone.replace(/\D/g, "");

    if (!cleanedPhone) {
      setError("Please enter your phone number.");
      return;
    }

    // Indian phone numbers must contain exactly 10 digits.
    if (countryCode === "IN" && !/^\d{10}$/.test(cleanedPhone)) {
      setError("Enter a valid 10-digit Indian mobile number.");
      return;
    }

    // General length validation for other countries.
    if (
      countryCode !== "IN" &&
      (cleanedPhone.length < 7 || cleanedPhone.length > 15)
    ) {
      setError("Please enter a valid phone number.");
      return;
    }

    setError("");

    router.push({
      pathname: "/auth/verifyOtp",
      params: {
        phone: cleanedPhone,
        callingCode,
        countryCode,
        flow: "register",
      },
    });
  };

  return (
    <ScreenContainer style={styles.screen}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <Pressable
          onPress={() => router.back()}
          style={styles.backButton}
          accessibilityRole="button"
          accessibilityLabel="Go back"
        >
          <Text style={styles.backText}>‹</Text>
        </Pressable>

        <View style={styles.content}>
          <View style={styles.iconCircle}>
            <Text style={styles.phoneIcon}>☎</Text>
          </View>

          <Text style={styles.title}>What's your number?</Text>

          <Text style={styles.description}>
            Enter your phone number. We'll send you a verification code to
            confirm it's yours.
          </Text>

          <Text style={styles.label}>Phone number</Text>

          <View style={[styles.phoneRow, error ? styles.inputError : null]}>
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
              onChangeText={(value) => {
                setPhone(value.replace(/\D/g, "").slice(0, 15));
                setError("");
              }}
              placeholder="Phone number"
              placeholderTextColor={COLORS.textSecondary}
              keyboardType="phone-pad"
              autoComplete="tel"
              textContentType="telephoneNumber"
              accessibilityLabel="Phone number"
              style={styles.phoneInput}
              maxLength={15}
            />
          </View>

          {error ? <Text style={styles.error}>{error}</Text> : null}

          <Text style={styles.privacy}>
            By continuing, you agree to our Terms of Service and Privacy Policy.
            Message and data rates may apply.
          </Text>
        </View>

        <View style={styles.footer}>
          <AppButton title="Continue" onPress={handleContinue} />

          <Pressable
            onPress={() => router.replace("/auth/login")}
            style={styles.loginLink}
          >
            <Text style={styles.loginText}>
              Already have an account?{" "}
              <Text style={styles.loginHighlight}>Log in</Text>
            </Text>
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </ScreenContainer>
  );
}
