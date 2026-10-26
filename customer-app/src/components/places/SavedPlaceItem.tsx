import React from 'react';
import { Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { COLORS } from '../../constants/colors';
import type { SavedPlace, SavedPlaceType } from '../../types/customer.types';
import { Badge } from '../common/Badge';
import { styles } from './SavedPlaceItem.styles';

export type SavedPlaceItemProps = {
  place: SavedPlace;
  onEdit?: (place: SavedPlace) => void;
  onDelete?: (place: SavedPlace) => void;
  onSelect?: (place: SavedPlace) => void;
};

const getPlaceIcon = (type: SavedPlaceType): keyof typeof Ionicons.glyphMap => {
  switch (type) {
    case 'home':
      return 'home';
    case 'work':
      return 'briefcase';
    default:
      return 'location';
  }
};

export const SavedPlaceItem: React.FC<SavedPlaceItemProps> = ({
  place,
  onEdit,
  onDelete,
  onSelect,
}) => {
  return (
    <TouchableOpacity
      style={styles.container}
      onPress={() => onSelect?.(place)}
      activeOpacity={onSelect ? 0.7 : 1}
    >
      <View style={styles.iconBox}>
        <Ionicons name={getPlaceIcon(place.type)} size={22} color={COLORS.primary} />
      </View>
      <View style={styles.content}>
        <View style={styles.headerRow}>
          <Text style={styles.name} numberOfLines={1}>
            {place.name}
          </Text>
          <Badge label={place.type} variant="info" />
        </View>
        <Text style={styles.address} numberOfLines={2}>
          {place.address}
        </Text>
      </View>
      {(onEdit || onDelete) && (
        <View style={styles.actions}>
          {onEdit && (
            <TouchableOpacity
              style={styles.actionBtn}
              onPress={() => onEdit(place)}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <Ionicons name="pencil" size={18} color={COLORS.textSecondary} />
            </TouchableOpacity>
          )}
          {onDelete && (
            <TouchableOpacity
              style={styles.actionBtn}
              onPress={() => onDelete(place)}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <Ionicons name="trash-outline" size={18} color={COLORS.error} />
            </TouchableOpacity>
          )}
        </View>
      )}
    </TouchableOpacity>
  );
};
