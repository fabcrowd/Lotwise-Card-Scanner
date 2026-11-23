import { StyleSheet, Text, View } from 'react-native';

import { radius, space, usePalette } from './theme';

export function Tag({ text, tone = 'info' }: { text: string; tone?: 'info' | 'ask' | 'ok' }) {
  const palette = usePalette();
  const colors = {
    info: { bg: palette.infoTint, fg: palette.info },
    ask: { bg: palette.askTint, fg: palette.ask },
    ok: { bg: palette.okTint, fg: palette.ok },
  }[tone];
  return (
    <View style={[styles.tag, { backgroundColor: colors.bg }]}>
      <Text style={[styles.text, { color: colors.fg }]}>{text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  tag: { borderRadius: radius.sm, paddingHorizontal: space.sm, paddingVertical: 2 },
  text: { fontSize: 12, fontWeight: '700' },
});
