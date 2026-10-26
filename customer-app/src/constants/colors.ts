export const COLORS = {
  primary: "#2563EB",
  primaryDark: "#1D4ED8",
  background: "#F8FAFC",
  surface: "#FFFFFF",

  text: "#0F172A",
  textSecondary: "#64748B",

  border: "#E2E8F0",
  success: "#16A34A",
  error: "#DC2626",
  warning: "#D97706",

  disabled: "#CBD5E1",
  white: "#FFFFFF",
  black: "#000000",
} as const;

export const SPACING = {
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
} as const;

export const RADIUS = {
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  full: 999,
} as const;

export const TYPOGRAPHY = {
  caption: 12,
  body: 16,
  subtitle: 18,
  heading: 24,
  title: 30,
} as const;
