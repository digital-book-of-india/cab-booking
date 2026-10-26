import React from 'react';
import { Redirect } from 'expo-router';

export default function AuthVerifyOtpRedirect() {
  return <Redirect href="/(auth)/otp" />;
}
