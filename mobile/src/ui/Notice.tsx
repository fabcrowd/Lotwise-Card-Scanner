import { StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button } from './Button';
import { radius, space, usePalette } from './theme';

interface FullNoticeProps {
  title: string;
  body: string;
  actions: readonly { label: string; onPress: () => void; primary?: boolean }[];
}

/** A whole-screen message with up to two buttons. */
export function FullNotice({ title, body, actions }: FullNoticeProps) {
  const palette = usePalette();
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.full, { backgroundColor: palette.bg, paddingTop: insets.top + space.xl }]}>
      <Text style={[styles.title, { color: palette.ink }]}>{title}</Text>
      <Text style={[styles.body, { color: palette.ink2 }]}>{body}</Text>
      {actions.map((action) => (
        <Button key={action.label} label={action.label} variant={action.primary ? 'primary' : 'secondary'} onPress={action.onPress} />
      ))}
    </View>
  );
}

interface MessageProps {
  text: string;
  tone?: 'error' | 'info';
  onDismiss?: () => void;
}

/** A short in-place message, for a failure or a result. */
export function Message({ text, tone = 'info', onDismiss }: MessageProps) {
  const palette = usePalette();
  const error = tone === 'error';
  return (
    <View
      accessibilityRole="alert"
      style={[styles.message, { backgroundColor: error ? palette.dangerTint : palette.infoTint, borderColor: error ? palette.danger : palette.info }]}
    >
      <Text style={[styles.messageText, { color: palette.ink }]}>{text}</Text>
      {onDismiss ? <Button label="Dismiss" onPress={onDismiss} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  full: { flex: 1, paddingHorizontal: space.xl, gap: space.lg, justifyContent: 'center' },
  title: { fontSize: 24, fontWeight: '700' },
  body: { fontSize: 16, lineHeight: 22 },
  message: { borderWidth: 1, borderRadius: radius.md, padding: space.md, gap: space.sm },
  messageText: { fontSize: 15, lineHeight: 21 },
});
