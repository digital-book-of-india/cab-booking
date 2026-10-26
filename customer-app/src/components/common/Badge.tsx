import React from 'react';
import { Text, View } from 'react-native';
import { COLORS } from '../../constants/colors';
import { styles } from './Badge.styles';

export type BadgeVariant = 'success' | 'warning' | 'error' | 'info' | 'neutral';

export type BadgeProps = {
  label: string;
  variant?: BadgeVariant;
};

const VARIANT_CONFIG: Record<BadgeVariant, { bg: string; text: string }> = {
  success: { bg: '#DCFCE7', text: '#15803D' },
  warning: { bg: '#FEF3C7', text: '#B45309' },
  error: { bg: '#FEE2E2', text: '#B91C1C' },
  info: { bg: '#DBEAFE', text: '#1D4ED8' },
  neutral: { bg: '#F1F5F9', text: COLORS.textSecondary },
};

export const Badge: React.FC<BadgeProps> = ({ label, variant = 'neutral' }) => {
  const config = VARIANT_CONFIG[variant];
  return (
    <View style={[styles.badge, { backgroundColor: config.bg }]}>
      <Text style={[styles.text, { color: config.text }]}>{label}</Text>
    </View>
  );
};
