import React, { useRef, useState } from 'react';
import {
  NativeSyntheticEvent,
  TextInput,
  View,
} from 'react-native';
import { styles } from './OtpInput.styles';

export type OtpInputProps = {
  length?: number;
  value: string;
  onChange: (otp: string) => void;
  error?: boolean;
};

export const OtpInput: React.FC<OtpInputProps> = ({
  length = 6,
  value,
  onChange,
  error = false,
}) => {
  const [focusedIndex, setFocusedIndex] = useState<number>(0);
  const inputsRef = useRef<(any | null)[]>([]);

  const digits = value.split('').concat(Array(length).fill('')).slice(0, length);

  const handleChangeText = (text: string, index: number) => {
    const cleaned = text.replace(/[^0-9]/g, '');
    if (!cleaned) {
      const nextDigits = [...digits];
      nextDigits[index] = '';
      onChange(nextDigits.join(''));
      return;
    }

    if (cleaned.length > 1) {
      // Pasting full OTP
      const pasted = cleaned.slice(0, length);
      onChange(pasted);
      const targetIndex = Math.min(pasted.length, length - 1);
      inputsRef.current[targetIndex]?.focus();
      return;
    }

    const nextDigits = [...digits];
    nextDigits[index] = cleaned;
    onChange(nextDigits.join(''));

    if (index < length - 1) {
      inputsRef.current[index + 1]?.focus();
    }
  };

  const handleKeyPress = (
    e: NativeSyntheticEvent<{ key: string }>,
    index: number,
  ) => {
    if (e.nativeEvent.key === 'Backspace' && !digits[index] && index > 0) {
      inputsRef.current[index - 1]?.focus();
      const nextDigits = [...digits];
      nextDigits[index - 1] = '';
      onChange(nextDigits.join(''));
    }
  };

  return (
    <View style={styles.container}>
      {Array.from({ length }).map((_, index) => (
        <TextInput
          key={index}
          ref={(ref) => {
            inputsRef.current[index] = ref;
          }}
          style={[
            styles.input,
            focusedIndex === index && styles.inputFocused,
            Boolean(digits[index]) && styles.inputFilled,
            error && styles.inputError,
          ]}
          keyboardType="number-pad"
          maxLength={length}
          value={digits[index] || ''}
          onChangeText={(text) => handleChangeText(text, index)}
          onKeyPress={(e) => handleKeyPress(e, index)}
          onFocus={() => setFocusedIndex(index)}
          onBlur={() => setFocusedIndex(-1)}
          selectTextOnFocus
        />
      ))}
    </View>
  );
};
