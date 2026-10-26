import React, { useState } from 'react';
import {
  Modal,
  Text,
  TouchableOpacity,
  TouchableWithoutFeedback,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { COLORS } from '../../constants/colors';
import type { RideRatingInput } from '../../types/ride.types';
import { AppButton } from '../common/AppButton';
import { AppInput } from '../common/AppInput';
import { styles } from './RatingModal.styles';

export type RatingModalProps = {
  visible: boolean;
  onClose: () => void;
  onSubmit: (input: RideRatingInput) => Promise<void>;
  isLoading?: boolean;
};

const FEEDBACK_TAGS = [
  'Clean Car',
  'Polite Driver',
  'Safe Driving',
  'Smooth Route',
  'On Time',
  'Great Music',
];

export const RatingModal: React.FC<RatingModalProps> = ({
  visible,
  onClose,
  onSubmit,
  isLoading = false,
}) => {
  const [stars, setStars] = useState<number>(5);
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [comment, setComment] = useState<string>('');

  const toggleTag = (tag: string) => {
    setSelectedTags((prev) =>
      prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag],
    );
  };

  const handleSubmit = async () => {
    await onSubmit({
      stars,
      comment: comment.trim() || undefined,
      tags: selectedTags.length > 0 ? selectedTags : undefined,
    });
    onClose();
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <TouchableWithoutFeedback onPress={onClose}>
        <View style={styles.overlay}>
          <TouchableWithoutFeedback>
            <View style={styles.modal}>
              <Text style={styles.title}>How was your ride?</Text>
              <Text style={styles.subtitle}>Your feedback helps improve your experience</Text>

              {/* 5-star rating selector */}
              <View style={styles.starsRow}>
                {[1, 2, 3, 4, 5].map((star) => (
                  <TouchableOpacity
                    key={star}
                    style={styles.starButton}
                    onPress={() => setStars(star)}
                    activeOpacity={0.7}
                  >
                    <Ionicons
                      name={star <= stars ? 'star' : 'star-outline'}
                      size={36}
                      color={star <= stars ? '#F59E0B' : COLORS.disabled}
                    />
                  </TouchableOpacity>
                ))}
              </View>

              {/* Tags */}
              <View style={styles.tagsContainer}>
                {FEEDBACK_TAGS.map((tag) => {
                  const active = selectedTags.includes(tag);
                  return (
                    <TouchableOpacity
                      key={tag}
                      style={[styles.tagChip, active && styles.tagChipActive]}
                      onPress={() => toggleTag(tag)}
                    >
                      <Text style={[styles.tagText, active && styles.tagTextActive]}>
                        {tag}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>

              <AppInput
                placeholder="Leave an optional compliment or note..."
                value={comment}
                onChangeText={setComment}
                multiline
                numberOfLines={2}
              />

              <View style={styles.btnRow}>
                <View style={styles.btnFlex}>
                  <AppButton
                    title="Skip"
                    variant="outline"
                    onPress={onClose}
                    disabled={isLoading}
                  />
                </View>
                <View style={styles.btnFlex}>
                  <AppButton
                    title="Submit Rating"
                    onPress={handleSubmit}
                    loading={isLoading}
                  />
                </View>
              </View>
            </View>
          </TouchableWithoutFeedback>
        </View>
      </TouchableWithoutFeedback>
    </Modal>
  );
};
