import React from 'react';
import { Redirect } from 'expo-router';

export default function AuthLoginRedirect() {
  return <Redirect href="/(auth)/login" />;
}
