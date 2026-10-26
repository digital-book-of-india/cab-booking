const API_URL = process.env.EXPO_PUBLIC_API_URL;

export const API_CONFIG = {
  baseURL: API_URL?.replace(/\/+$/, "") ?? "",
  timeout: 15000,
} as const;

export const APP_CONFIG = {
  appName: "Cab Booking",
  currency: "INR",
  defaultCountryCode: "+91",
} as const;
