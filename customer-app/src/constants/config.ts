import Constants from 'expo-constants';
import { Platform } from 'react-native';

function resolveBaseUrl(): string {
  const envUrl = process.env.EXPO_PUBLIC_API_URL?.trim();

  // If envUrl is provided and doesn't use localhost, respect it
  if (envUrl && !envUrl.includes('localhost') && !envUrl.includes('127.0.0.1')) {
    return envUrl.replace(/\/+$/, '');
  }

  // On Web, localhost works fine
  if (Platform.OS === 'web') {
    return envUrl?.replace(/\/+$/, '') || 'http://localhost:4000/api/v1';
  }

  // On native (Android/iOS phone or emulator):
  // 1. Try to extract the host machine's IP from Expo's Metro bundler hostUri
  const hostUri =
    Constants.expoConfig?.hostUri ||
    (Constants as unknown as { manifest2?: { extra?: { expoClient?: { hostUri?: string } } } })
      ?.manifest2?.extra?.expoClient?.hostUri;

  if (hostUri) {
    const hostIp = hostUri.split(':')[0];
    if (hostIp && hostIp !== 'localhost' && hostIp !== '127.0.0.1') {
      return `http://${hostIp}:4000/api/v1`;
    }
  }

  // 2. Fallback to computer's LAN IP on Wi-Fi
  return 'http://172.28.120.181:4000/api/v1';
}

export const API_CONFIG = {
  baseURL: resolveBaseUrl(),
  timeout: 15000,
} as const;

export const APP_CONFIG = {
  appName: 'Cab Booking',
  currency: 'INR',
  currencySymbol: '₹',
  defaultCountryCode: '+91',
} as const;
