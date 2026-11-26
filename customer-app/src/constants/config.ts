import Constants from 'expo-constants';
import { Platform } from 'react-native';

const PRIVATE_LAN_HOST_RE =
  /^(10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|172\.(1[6-9]|2\d|3[0-1])\.\d+\.\d+)$/;

function extractExpoHost(): string | null {
  const hostUri =
    Constants.expoConfig?.hostUri ||
    (
      Constants as unknown as {
        manifest2?: { extra?: { expoClient?: { hostUri?: string } } };
      }
    )?.manifest2?.extra?.expoClient?.hostUri;

  if (!hostUri) return null;
  const host = hostUri.split(':')[0]?.trim();
  return host || null;
}

function isTunnelHost(host: string): boolean {
  return (
    host.endsWith('.exp.direct') ||
    host.endsWith('.ngrok.io') ||
    host.endsWith('.ngrok-free.app')
  );
}

function resolveBaseUrl(): string {
  const envUrl = process.env.EXPO_PUBLIC_API_URL?.trim().replace(/\/+$/, '');

  // On Web, respect envUrl or default to localhost
  if (Platform.OS === 'web') {
    return envUrl || 'http://localhost:4000/api/v1';
  }

  // On native (physical phone or emulator):
  // 1. Always respect explicit HTTPS / public / tunnel URLs from .env
  if (envUrl && envUrl.startsWith('https://')) {
    return envUrl;
  }

  const expoHost = extractExpoHost();

  // 2. If Expo Metro is running on a real LAN IP (Wi-Fi / hotspot), prefer it over
  //    localhost or a stale private LAN IP in .env so IP changes never break dev.
  if (
    expoHost &&
    expoHost !== 'localhost' &&
    expoHost !== '127.0.0.1' &&
    !isTunnelHost(expoHost)
  ) {
    if (!envUrl || envUrl.includes('localhost') || envUrl.includes('127.0.0.1')) {
      return `http://${expoHost}:4000/api/v1`;
    }
    try {
      const parsed = new URL(envUrl);
      if (PRIVATE_LAN_HOST_RE.test(parsed.hostname)) {
        return `http://${expoHost}:4000/api/v1`;
      }
    } catch {
      return `http://${expoHost}:4000/api/v1`;
    }
  }

  // 3. Support USB adb reverse (`expo start --localhost` + `adb reverse tcp:4000 tcp:4000`)
  if (expoHost === 'localhost' || expoHost === '127.0.0.1') {
    if (!envUrl || envUrl.includes('localhost') || envUrl.includes('127.0.0.1')) {
      return 'http://localhost:4000/api/v1';
    }
  }

  // 4. Explicit non-private HTTP URL from .env (or manual override under --tunnel)
  if (envUrl && !envUrl.includes('localhost') && !envUrl.includes('127.0.0.1')) {
    return envUrl;
  }

  // 5. Emulator / simulator fallback (never a hardcoded stale LAN IP)
  if (Platform.OS === 'android') {
    return 'http://10.0.2.2:4000/api/v1';
  }
  return 'http://localhost:4000/api/v1';
}

export const API_CONFIG = {
  baseURL: resolveBaseUrl(),
  timeout: 12000,
} as const;

export const APP_CONFIG = {
  appName: 'Cab Booking',
  currency: 'INR',
  currencySymbol: '₹',
  defaultCountryCode: '+91',
} as const;
