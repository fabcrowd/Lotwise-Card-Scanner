import { ActivityIndicator, Pressable, type StyleProp, StyleSheet, Text, type ViewStyle } from 'react-native';

import { radius, space, usePalette } from './theme';

export type ButtonVariant = 'primary' | 'secondary' | 'danger';

interface ButtonProps {
  label: string;
  onPress: () => void;
  variant?: ButtonVariant;
  disabled?: boolean;
  busy?: boolean;
  style?: StyleProp<ViewStyle>;
  /** For a button drawn over the camera, where the system's light or dark colors do not apply. */
  labelColor?: string;
}

export function Button({ label, onPress, variant = 'secondary', disabled = false, busy = false, style, labelColor }: ButtonProps) {
  const palette = usePalette();
  const off = disabled || busy;
  const background = variant === 'primary' ? palette.primaryBg : palette.surface;
  const color = labelColor ?? (variant === 'primary' ? palette.primaryFg : variant === 'danger' ? palette.danger : palette.ink);
  const border = variant === 'danger' ? palette.danger : variant === 'primary' ? palette.primaryBg : palette.borderStrong;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: off, busy }}
      disabled={off}
      onPress={onPress}
      style={[styles.button, { backgroundColor: background, borderColor: border, opacity: off ? 0.5 : 1 }, style]}
    >
      {busy ? <ActivityIndicator color={color} /> : <Text style={[styles.label, { color }]}>{label}</Text>}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    minHeight: 44,
    paddingHorizontal: space.lg,
    borderRadius: radius.md,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  label: { fontSize: 15, fontWeight: '700' },
});
