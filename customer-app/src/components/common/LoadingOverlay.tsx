import React from 'react';
import { ActivityIndicator, Text, View } from 'react-native';
import { COLORS } from '../../constants/colors';
import { styles } from './LoadingOverlay.styles';

export type LoadingOverlayProps = {
  visible: boolean;
  message?: string;
};

export const LoadingOverlay: React.FC<LoadingOverlayProps> = ({
  visible,
  message = 'Please wait...',
}) => {
  if (!visible) return null;

  return (
    <View style={styles.overlay}>
      <View style={styles.card}>
        <ActivityIndicator size="large" color={COLORS.primary} />
        {Boolean(message) && <Text style={styles.text}>{message}</Text>}
      </View>
    </View>
  );
};
