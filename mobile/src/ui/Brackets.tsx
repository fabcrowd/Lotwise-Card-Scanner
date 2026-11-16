// The brand mark: four L-shaped corners, no fill.

import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

interface BracketsProps {
  color: string;
  arm?: number;
  thickness?: number;
  style?: StyleProp<ViewStyle>;
}

export function Brackets({ color, arm = 28, thickness = 4, style }: BracketsProps) {
  const base = { position: 'absolute', width: arm, height: arm, borderColor: color } as const;
  const t = thickness;
  return (
    <View pointerEvents="none" style={[StyleSheet.absoluteFill, style]}>
      <View style={[base, { top: 0, left: 0, borderTopWidth: t, borderLeftWidth: t, borderTopLeftRadius: 6 }]} />
      <View style={[base, { top: 0, right: 0, borderTopWidth: t, borderRightWidth: t, borderTopRightRadius: 6 }]} />
      <View style={[base, { bottom: 0, left: 0, borderBottomWidth: t, borderLeftWidth: t, borderBottomLeftRadius: 6 }]} />
      <View style={[base, { bottom: 0, right: 0, borderBottomWidth: t, borderRightWidth: t, borderBottomRightRadius: 6 }]} />
    </View>
  );
}
