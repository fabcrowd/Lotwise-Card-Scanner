import { router } from 'expo-router';
import { useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useReviewCards } from '../src/state/session';
import { Button } from '../src/ui/Button';
import { Message } from '../src/ui/Notice';
import { ReviewBlock } from '../src/ui/ReviewBlock';
import { canSave, errorText, saveCard } from '../src/ui/reviewActions';
import { space, usePalette } from '../src/ui/theme';

export default function ReviewScreen() {
  const palette = usePalette();
  const insets = useSafeAreaInsets();
  const cards = useReviewCards();
  const [savingAll, setSavingAll] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const waiting = cards.filter((card) => !card.row.userConfirmed).length;
  const savable = cards.filter(canSave);

  const saveAll = async (): Promise<void> => {
    setSavingAll(true);
    setError(null);
    try {
      for (const card of savable) await saveCard(card);
    } catch (err) {
      console.error('[review] save all failed:', errorText(err));
      setError('Some cards could not be saved. The ones already saved are in the library.');
    } finally {
      setSavingAll(false);
    }
  };

  return (
    <ScrollView
      style={{ backgroundColor: palette.bg }}
      contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + space.xl }]}
    >
      <Text style={[styles.header, { color: palette.ink }]}>
        {cards.length} {cards.length === 1 ? 'card' : 'cards'} · {waiting} still need you
      </Text>
      {cards.length === 0 ? <Text style={[styles.empty, { color: palette.ink2 }]}>No cards to review.</Text> : null}
      {cards.map((card) => (
        <ReviewBlock key={card.id} card={card} />
      ))}
      {error ? <Message tone="error" text={error} onDismiss={() => setError(null)} /> : null}
      <View style={styles.footer}>
        <Button label="Save all confirmed" disabled={savable.length === 0} busy={savingAll} onPress={() => void saveAll()} />
        <Button label="Done" variant="primary" onPress={() => router.replace('/')} />
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { padding: space.lg, gap: space.md },
  header: { fontSize: 17, fontWeight: '700' },
  empty: { fontSize: 15 },
  footer: { gap: space.sm },
});
