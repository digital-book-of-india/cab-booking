import React from 'react';
import { StyleProp, View, ViewStyle } from 'react-native';
import { styles } from './Card.styles';

export type CardProps = {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
};

export const Card: React.FC<CardProps> = ({ children, style }) => {
  return <View style={[styles.card, style]}>{children}</View>;
};
