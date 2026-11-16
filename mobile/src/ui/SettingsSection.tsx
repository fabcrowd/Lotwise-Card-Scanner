import type { ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { radius, space, usePalette } from './theme';

export function SettingsSection({ title, children }: { title: string; children: ReactNode }) {
  const palette = usePalette();
  return (
    <View style={[styles.section, { backgroundColor: palette.surface, borderColor: palette.border }]}>
      <Text accessibilityRole="header" style={[styles.title, { color: palette.ink }]}>{title}</Text>
      {children}
    </View>
  );
}

export function Note({ text }: { text: string }) {
  const palette = usePalette();
  return <Text style={[styles.note, { color: palette.ink2 }]}>{text}</Text>;
}

const styles = StyleSheet.create({
  section: { borderWidth: 1, borderRadius: radius.md, padding: space.lg, gap: space.sm },
  title: { fontSize: 18, fontWeight: '700' },
  note: { fontSize: 14, lineHeight: 20 },
});
